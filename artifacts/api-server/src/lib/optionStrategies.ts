/**
 * Multi-leg option strategy builder.
 *
 * Given a fetched option chain and current spot, builds a portfolio of
 * pre-canned strategies (long call, straddle, condor, etc.) with fully
 * computed payoff curves, breakevens, max P/L, and net Greeks.
 *
 * Premiums prefer the chain's mid (between bid/ask) when available, falling
 * back to LTP. IV missing on a leg is solved via Newton-Raphson.
 *
 * No "synthetic" data — if the chain doesn't have a real strike at the desired
 * distance, the strategy is skipped (returned in `unavailable`) instead of
 * fabricating values.
 */

import type { OcResponse, OcRow, OcSide } from "./optionChain";
import type { OptionAnalytics } from "./optionAnalytics";
import { priceAndGreeks, impliedVolatility, yearsToExpiry, type OptionType } from "./blackScholes";

// India 10y G-Sec yield ~6.75% in Apr 2026; close enough for short-dated options.
const RISK_FREE = 0.0675;

export interface StrategyLeg {
  action: "BUY" | "SELL";
  optionType: OptionType;
  strike: number;
  premium: number;        // per share (₹)
  iv: number;             // decimal, e.g. 0.18
  delta: number;
  gamma: number;
  vega: number;
  theta: number;          // per calendar day
  qty: number;            // number of lots (positive); BUY = +qty contracts, SELL = -qty
  source: "chain" | "bs"; // "chain" = used quoted price, "bs" = derived
}

export interface PayoffPoint { spot: number; pnl: number }

export type StrategyKind =
  | "LONG_CALL" | "LONG_PUT"
  | "LONG_STRADDLE" | "SHORT_STRADDLE"
  | "LONG_STRANGLE" | "SHORT_STRANGLE"
  | "BULL_CALL_SPREAD" | "BEAR_PUT_SPREAD"
  | "BULL_PUT_SPREAD"  | "BEAR_CALL_SPREAD"
  | "IRON_CONDOR"      | "IRON_BUTTERFLY"
  | "COVERED_CALL";

export interface StrategySnapshot {
  kind: StrategyKind;
  name: string;
  category: "DEBIT" | "CREDIT" | "STOCK_PLUS";
  outlook: string;
  description: string;
  legs: StrategyLeg[];
  netDebit: number;          // positive = pay (debit), negative = receive (credit)
  netGreeks: { delta: number; gamma: number; vega: number; theta: number };
  maxProfit: number | null;  // null = unbounded
  maxLoss: number | null;    // null = unbounded; signed (negative if loss)
  breakevens: number[];
  payoff: PayoffPoint[];
  pop: number | null;        // approximate probability of profit (decimal)
  rrRatio: number | null;    // |maxProfit / maxLoss|, when both bounded
  lotSize: number;
  perLot: { maxProfit: number | null; maxLoss: number | null; netDebit: number };
  suitability: { ivContext: "LOW" | "HIGH" | "ANY"; biasFit: ("BULLISH" | "BEARISH" | "NEUTRAL")[] };
  recommended: boolean;
  rationale?: string;
}

export interface StrategyBundle {
  underlying: string;
  spot: number;
  expiry: string;
  daysToExpiry: number;
  ivContext: "LOW" | "HIGH" | "UNKNOWN";
  bias: OptionAnalytics["bias"];
  strategies: StrategySnapshot[];
  unavailable: { kind: StrategyKind; reason: string }[];
  generatedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function midOrLtp(side: OcSide | undefined): number | null {
  if (!side) return null;
  if (side.bid != null && side.ask != null && side.bid > 0 && side.ask > 0 && side.ask >= side.bid) {
    return +(((side.bid + side.ask) / 2)).toFixed(2);
  }
  return side.ltp != null && side.ltp > 0 ? side.ltp : null;
}

function nearestRow(rows: OcRow[], target: number): OcRow | null {
  if (!rows.length) return null;
  let best = rows[0];
  let bestDist = Math.abs(rows[0].strike - target);
  for (const r of rows) {
    const d = Math.abs(r.strike - target);
    if (d < bestDist) { best = r; bestDist = d; }
  }
  return best;
}

/**
 * Pick a strike `n` steps away from ATM. Returns null if no row exists at
 * the requested distance (do NOT extrapolate).
 */
function strikeOffset(chain: OcResponse, fromStrike: number, n: number): OcRow | null {
  const target = fromStrike + n * chain.strikeStep;
  const exact = chain.rows.find(r => r.strike === target);
  if (exact) return exact;
  // accept ±1 step tolerance to handle non-uniform strike grids near ATM
  const near = chain.rows.filter(r => Math.abs(r.strike - target) <= chain.strikeStep);
  if (!near.length) return null;
  return nearestRow(near, target);
}

interface BuiltLeg { row: OcRow; side: OcSide; type: OptionType }

function buildLeg(
  built: BuiltLeg,
  action: "BUY" | "SELL",
  qty: number,
  spot: number,
  T: number,
  q: number,
): StrategyLeg | null {
  const premium = midOrLtp(built.side);
  if (premium == null) return null;

  // IV: prefer chain IV. Fall back to BS solver. If both fail, skip leg.
  let iv = built.side.iv != null && built.side.iv > 0 ? built.side.iv / 100 : null;
  if (iv == null) {
    iv = impliedVolatility({
      S: spot, K: built.row.strike, T, r: RISK_FREE, q,
      type: built.type, marketPrice: premium,
    });
  }
  if (iv == null) return null;

  const greeks = priceAndGreeks({
    S: spot, K: built.row.strike, T, r: RISK_FREE, q, sigma: iv, type: built.type,
  });

  return {
    action,
    optionType: built.type,
    strike: built.row.strike,
    premium,
    iv,
    delta: greeks.delta,
    gamma: greeks.gamma,
    vega: greeks.vega,
    theta: greeks.theta,
    qty,
    source: built.side.iv != null ? "chain" : "bs",
  };
}

function legPayoff(leg: StrategyLeg, spotAtExpiry: number): number {
  const intrinsic = leg.optionType === "CE"
    ? Math.max(0, spotAtExpiry - leg.strike)
    : Math.max(0, leg.strike - spotAtExpiry);
  const sign = leg.action === "BUY" ? 1 : -1;
  // BUY: pay premium (negative cashflow), receive intrinsic at expiry
  // SELL: receive premium (positive), owe intrinsic at expiry
  return sign * (intrinsic - leg.premium) * leg.qty;
}

function buildPayoff(legs: StrategyLeg[], spot: number, lotSize: number): {
  payoff: PayoffPoint[];
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[];
} {
  const sampleAt = (s: number) =>
    legs.reduce((acc, l) => acc + legPayoff(l, s), 0) * lotSize;

  // ── Visualization grid: focus around the actual leg strikes so the
  // kinks (which is where the strategy's edge lives) are visible. We zoom
  // out to the wider of (a) ±10% of spot, or (b) the leg strike span padded
  // by 4 strike widths on each side. Sample 201 points and **always include
  // every leg strike exactly** so the recharts `linear` interpolation draws
  // crisp kinks instead of smoothing them off.
  const legStrikes = legs.map(l => l.strike).filter(k => k > 0);
  const sortedLegStrikes = [...new Set(legStrikes)].sort((a, b) => a - b);
  const minK = sortedLegStrikes.length ? sortedLegStrikes[0] : spot;
  const maxK = sortedLegStrikes.length ? sortedLegStrikes[sortedLegStrikes.length - 1] : spot;
  // Strike-width estimate: smallest gap between adjacent strikes; fall back to 0.5% of spot
  let strikeWidth = Math.max(1, Math.round(spot * 0.005));
  if (sortedLegStrikes.length >= 2) {
    let minGap = Infinity;
    for (let i = 1; i < sortedLegStrikes.length; i++) {
      const g = sortedLegStrikes[i] - sortedLegStrikes[i - 1];
      if (g > 0 && g < minGap) minGap = g;
    }
    if (Number.isFinite(minGap)) strikeWidth = minGap;
  }
  const padding = Math.max(strikeWidth * 4, spot * 0.025);
  let lo = Math.min(minK, spot) - padding;
  let hi = Math.max(maxK, spot) + padding;
  // Always show at least ±10% around spot so the chart never looks "zoomed in"
  // for single-strike strategies (long call, etc.) on stocks with wide ranges.
  lo = Math.min(lo, spot * 0.90);
  hi = Math.max(hi, spot * 1.10);
  if (lo < 0) lo = 0;

  const N = 201;
  const step = (hi - lo) / (N - 1);
  const sampleSet = new Set<number>();
  for (let i = 0; i < N; i++) sampleSet.add(+(lo + i * step).toFixed(2));
  // Force-include strike kinks + spot so the linear interpolation has anchor
  // points exactly at the discontinuities of the payoff slope.
  for (const k of legStrikes) sampleSet.add(+k.toFixed(2));
  sampleSet.add(+spot.toFixed(2));
  const sortedSpots = Array.from(sampleSet).sort((a, b) => a - b);
  const payoff: PayoffPoint[] = sortedSpots.map(s => ({
    spot: s, pnl: +sampleAt(s).toFixed(2),
  }));

  // ── Analytical extrema ────────────────────────────────────────────────
  // Payoff is piecewise-linear in S with kinks at each strike. Therefore
  // the extrema (over the bounded portion) are achieved at one of:
  //   {0, each leg strike, +∞}.
  // The behaviour at +∞ is dictated by the sum of slopes contributed by
  // each leg above all strikes:
  //   - CE (long):  slope = +qty
  //   - CE (short): slope = -qty
  //   - PE (any):   slope = 0  (puts are worthless above strike)
  // Stock leg is encoded as long CE strike=0 → contributes +qty (correct).
  const slopeAtInf = legs.reduce((acc, l) => {
    if (l.optionType !== "CE") return acc;
    return acc + (l.action === "BUY" ? +1 : -1) * l.qty;
  }, 0) * lotSize;

  // Critical evaluation points: S=0, each unique strike (>0), and S=2*max strike (a "far" point used to
  // verify slope direction beyond the last kink).
  const uniqStrikes = [...new Set(legs.map(l => l.strike).filter(k => k > 0))].sort((a, b) => a - b);
  const farS = Math.max(2 * (uniqStrikes[uniqStrikes.length - 1] ?? spot), spot * 3);
  const breakpointSpots = [0, ...uniqStrikes];
  let maxBp = -Infinity, minBp = Infinity;
  for (const s of breakpointSpots) {
    const v = sampleAt(s);
    if (v > maxBp) maxBp = v;
    if (v < minBp) minBp = v;
  }
  // Include the far-right sample so a sharply-rising/falling tail still anchors the bounded extremum
  const vFar = sampleAt(farS);

  // maxProfit unbounded iff payoff grows without bound as S→∞ (slopeAtInf>0).
  // maxLoss  unbounded iff payoff falls without bound as S→∞ (slopeAtInf<0).
  // Note: S has hard lower bound 0, so the S→0 side is always bounded.
  const SLOPE_EPS = 1e-6;
  let maxProfit: number | null;
  let maxLoss: number | null;
  if (slopeAtInf > SLOPE_EPS) {
    maxProfit = null;
    maxLoss   = +Math.min(minBp, vFar).toFixed(2);
  } else if (slopeAtInf < -SLOPE_EPS) {
    maxProfit = +Math.max(maxBp, vFar).toFixed(2);
    maxLoss   = null;
  } else {
    // Flat tail (e.g. credit spread, condor) — extremum reached at a kink or at the flat tail itself
    maxProfit = +Math.max(maxBp, vFar).toFixed(2);
    maxLoss   = +Math.min(minBp, vFar).toFixed(2);
  }

  // ── Breakevens: zero crossings on the analytical breakpoint ladder ────
  // Walk the kinks in order (0, strikes, far) and interpolate linearly between
  // adjacent breakpoints. This is exact for piecewise-linear payoffs.
  const ladderXs = [0, ...uniqStrikes, farS];
  const ladder = ladderXs.map(s => ({ spot: s, pnl: sampleAt(s) }));
  const breakevens: number[] = [];
  for (let i = 1; i < ladder.length; i++) {
    const a = ladder[i - 1], b = ladder[i];
    if ((a.pnl <= 0 && b.pnl >= 0) || (a.pnl >= 0 && b.pnl <= 0)) {
      if (a.pnl === 0)        breakevens.push(+a.spot.toFixed(2));
      else if (b.pnl === 0)   breakevens.push(+b.spot.toFixed(2));
      else if (b.pnl !== a.pnl) {
        const t = -a.pnl / (b.pnl - a.pnl);
        breakevens.push(+(a.spot + t * (b.spot - a.spot)).toFixed(2));
      }
    }
  }
  // Dedupe near-equal breakevens
  const uniq: number[] = [];
  for (const b of breakevens) if (!uniq.some(u => Math.abs(u - b) < 0.01)) uniq.push(b);

  return { payoff, maxProfit, maxLoss, breakevens: uniq };
}

function netDebit(legs: StrategyLeg[]): number {
  let total = 0;
  for (const l of legs) {
    const sign = l.action === "BUY" ? +1 : -1;
    total += sign * l.premium * l.qty;
  }
  return total; // per share. Multiply by lotSize for ₹ per lot.
}

function netGreeks(legs: StrategyLeg[]) {
  let d = 0, g = 0, v = 0, t = 0;
  for (const l of legs) {
    const sign = l.action === "BUY" ? +1 : -1;
    d += sign * l.delta * l.qty;
    g += sign * l.gamma * l.qty;
    v += sign * l.vega  * l.qty;
    t += sign * l.theta * l.qty;
  }
  return { delta: +d.toFixed(4), gamma: +g.toFixed(6), vega: +v.toFixed(4), theta: +t.toFixed(4) };
}

/**
 * Approximate probability of profit using the lognormal model.
 * For each breakeven and the +/- tails being profitable, we sum the
 * normal CDF mass over the profit regions.
 */
function approxPop(payoff: PayoffPoint[], spot: number, T: number, sigma: number): number | null {
  if (!Number.isFinite(sigma) || sigma <= 0 || T <= 0 || !payoff.length) return null;
  const stdDev = sigma * Math.sqrt(T);
  // Standard normal CDF (same approximation as in blackScholes.ts)
  const cdf = (x: number) => {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + p * ax);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return 0.5 * (1 + sign * y);
  };
  // Lognormal: ln(S_T/S_0) ~ N((-σ²/2)T, σ²T)
  const mu = -0.5 * stdDev * stdDev;
  const probSpotBelow = (s: number) => cdf((Math.log(s / spot) - mu) / stdDev);

  let prob = 0;
  let currentlyProfit = payoff[0].pnl > 0;
  let regionStart = payoff[0].spot;
  for (let i = 1; i < payoff.length; i++) {
    const profitNow = payoff[i].pnl > 0;
    if (profitNow !== currentlyProfit) {
      // Crossed boundary at approximately payoff[i-1]/payoff[i] interpolation
      const a = payoff[i - 1], b = payoff[i];
      const t = -a.pnl / (b.pnl - a.pnl);
      const cross = a.spot + t * (b.spot - a.spot);
      if (currentlyProfit) prob += probSpotBelow(cross) - probSpotBelow(regionStart);
      regionStart = cross;
      currentlyProfit = profitNow;
    }
  }
  if (currentlyProfit) prob += 1 - probSpotBelow(regionStart);
  return Math.max(0, Math.min(1, +prob.toFixed(4)));
}

// ─── Strategy templates ─────────────────────────────────────────────────────

interface BuildContext {
  chain: OcResponse;
  spot: number;
  T: number;
  q: number;
  lotSize: number;
  atmRow: OcRow;
  ivContext: "LOW" | "HIGH" | "UNKNOWN";
  bias: OptionAnalytics["bias"];
  atmSigma: number; // for POP estimation (decimal)
}

type Template = {
  kind: StrategyKind;
  name: string;
  category: "DEBIT" | "CREDIT" | "STOCK_PLUS";
  outlook: string;
  description: string;
  suitability: StrategySnapshot["suitability"];
  build: (ctx: BuildContext) => { legs: StrategyLeg[] } | { error: string };
};

const TEMPLATES: Template[] = [
  {
    kind: "LONG_CALL",
    name: "Long Call",
    category: "DEBIT",
    outlook: "Strongly bullish — buying upside with capped risk = premium paid.",
    description: "Pay premium to gain unlimited upside above breakeven.",
    suitability: { ivContext: "LOW", biasFit: ["BULLISH"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      const ce = atmRow.ce;
      if (!ce) return { error: "ATM call leg not quoted" };
      const leg = buildLeg({ row: atmRow, side: ce, type: "CE" }, "BUY", 1, spot, T, q);
      return leg ? { legs: [leg] } : { error: "Cannot price ATM call" };
    },
  },
  {
    kind: "LONG_PUT",
    name: "Long Put",
    category: "DEBIT",
    outlook: "Strongly bearish — buying downside with capped risk = premium paid.",
    description: "Pay premium to gain downside protection / profit below breakeven.",
    suitability: { ivContext: "LOW", biasFit: ["BEARISH"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      const pe = atmRow.pe;
      if (!pe) return { error: "ATM put leg not quoted" };
      const leg = buildLeg({ row: atmRow, side: pe, type: "PE" }, "BUY", 1, spot, T, q);
      return leg ? { legs: [leg] } : { error: "Cannot price ATM put" };
    },
  },
  {
    kind: "LONG_STRADDLE",
    name: "Long Straddle",
    category: "DEBIT",
    outlook: "Big move expected, direction unknown (e.g. ahead of earnings/Fed/budget).",
    description: "Buy ATM call + ATM put. Profits when |spot-strike| > sum of premiums.",
    suitability: { ivContext: "LOW", biasFit: ["NEUTRAL", "BULLISH", "BEARISH"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      if (!atmRow.ce || !atmRow.pe) return { error: "ATM CE/PE not both quoted" };
      const ce = buildLeg({ row: atmRow, side: atmRow.ce, type: "CE" }, "BUY", 1, spot, T, q);
      const pe = buildLeg({ row: atmRow, side: atmRow.pe, type: "PE" }, "BUY", 1, spot, T, q);
      if (!ce || !pe) return { error: "Cannot price ATM legs" };
      return { legs: [ce, pe] };
    },
  },
  {
    kind: "SHORT_STRADDLE",
    name: "Short Straddle",
    category: "CREDIT",
    outlook: "Range-bound — collect premium when spot stays pinned to strike.",
    description: "Sell ATM call + ATM put. Max profit at strike. Unlimited risk both sides.",
    suitability: { ivContext: "HIGH", biasFit: ["NEUTRAL"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      if (!atmRow.ce || !atmRow.pe) return { error: "ATM CE/PE not both quoted" };
      const ce = buildLeg({ row: atmRow, side: atmRow.ce, type: "CE" }, "SELL", 1, spot, T, q);
      const pe = buildLeg({ row: atmRow, side: atmRow.pe, type: "PE" }, "SELL", 1, spot, T, q);
      if (!ce || !pe) return { error: "Cannot price ATM legs" };
      return { legs: [ce, pe] };
    },
  },
  {
    kind: "LONG_STRANGLE",
    name: "Long Strangle",
    category: "DEBIT",
    outlook: "Big move expected — cheaper than straddle, needs larger move to profit.",
    description: "Buy OTM call + OTM put 2 strikes away. Limited risk, unlimited reward.",
    suitability: { ivContext: "LOW", biasFit: ["NEUTRAL"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      const otmCall = strikeOffset(chain, atmRow.strike, +2);
      const otmPut  = strikeOffset(chain, atmRow.strike, -2);
      if (!otmCall?.ce || !otmPut?.pe) return { error: "OTM legs not quoted" };
      const ce = buildLeg({ row: otmCall, side: otmCall.ce, type: "CE" }, "BUY", 1, spot, T, q);
      const pe = buildLeg({ row: otmPut,  side: otmPut.pe,  type: "PE" }, "BUY", 1, spot, T, q);
      if (!ce || !pe) return { error: "Cannot price OTM legs" };
      return { legs: [ce, pe] };
    },
  },
  {
    kind: "SHORT_STRANGLE",
    name: "Short Strangle",
    category: "CREDIT",
    outlook: "Range-bound, lower IV-rank floor than short straddle. Defined area of profit.",
    description: "Sell OTM call + OTM put 2 strikes away. Wider profit zone, unlimited risk.",
    suitability: { ivContext: "HIGH", biasFit: ["NEUTRAL"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      const otmCall = strikeOffset(chain, atmRow.strike, +2);
      const otmPut  = strikeOffset(chain, atmRow.strike, -2);
      if (!otmCall?.ce || !otmPut?.pe) return { error: "OTM legs not quoted" };
      const ce = buildLeg({ row: otmCall, side: otmCall.ce, type: "CE" }, "SELL", 1, spot, T, q);
      const pe = buildLeg({ row: otmPut,  side: otmPut.pe,  type: "PE" }, "SELL", 1, spot, T, q);
      if (!ce || !pe) return { error: "Cannot price OTM legs" };
      return { legs: [ce, pe] };
    },
  },
  {
    kind: "BULL_CALL_SPREAD",
    name: "Bull Call Spread",
    category: "DEBIT",
    outlook: "Moderately bullish — wants upside but offsets cost by selling higher strike.",
    description: "Buy ATM call + sell call 2 strikes higher. Defined risk, defined reward.",
    suitability: { ivContext: "ANY", biasFit: ["BULLISH"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      const upper = strikeOffset(chain, atmRow.strike, +2);
      if (!atmRow.ce || !upper?.ce) return { error: "Spread strikes not both quoted" };
      const long  = buildLeg({ row: atmRow, side: atmRow.ce, type: "CE" }, "BUY",  1, spot, T, q);
      const short = buildLeg({ row: upper,  side: upper.ce,  type: "CE" }, "SELL", 1, spot, T, q);
      if (!long || !short) return { error: "Cannot price spread legs" };
      return { legs: [long, short] };
    },
  },
  {
    kind: "BEAR_PUT_SPREAD",
    name: "Bear Put Spread",
    category: "DEBIT",
    outlook: "Moderately bearish — wants downside profit with reduced cost.",
    description: "Buy ATM put + sell put 2 strikes lower. Defined risk, defined reward.",
    suitability: { ivContext: "ANY", biasFit: ["BEARISH"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      const lower = strikeOffset(chain, atmRow.strike, -2);
      if (!atmRow.pe || !lower?.pe) return { error: "Spread strikes not both quoted" };
      const long  = buildLeg({ row: atmRow, side: atmRow.pe, type: "PE" }, "BUY",  1, spot, T, q);
      const short = buildLeg({ row: lower,  side: lower.pe,  type: "PE" }, "SELL", 1, spot, T, q);
      if (!long || !short) return { error: "Cannot price spread legs" };
      return { legs: [long, short] };
    },
  },
  {
    kind: "BULL_PUT_SPREAD",
    name: "Bull Put Spread",
    category: "CREDIT",
    outlook: "Moderately bullish, prefers credit — ideal in higher IV regimes.",
    description: "Sell ATM put + buy put 2 strikes lower. Defined risk, max profit = net credit.",
    suitability: { ivContext: "HIGH", biasFit: ["BULLISH"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      const lower = strikeOffset(chain, atmRow.strike, -2);
      if (!atmRow.pe || !lower?.pe) return { error: "Spread strikes not both quoted" };
      const short = buildLeg({ row: atmRow, side: atmRow.pe, type: "PE" }, "SELL", 1, spot, T, q);
      const long  = buildLeg({ row: lower,  side: lower.pe,  type: "PE" }, "BUY",  1, spot, T, q);
      if (!short || !long) return { error: "Cannot price spread legs" };
      return { legs: [short, long] };
    },
  },
  {
    kind: "BEAR_CALL_SPREAD",
    name: "Bear Call Spread",
    category: "CREDIT",
    outlook: "Moderately bearish, prefers credit — ideal in higher IV regimes.",
    description: "Sell ATM call + buy call 2 strikes higher. Defined risk, max profit = net credit.",
    suitability: { ivContext: "HIGH", biasFit: ["BEARISH"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      const upper = strikeOffset(chain, atmRow.strike, +2);
      if (!atmRow.ce || !upper?.ce) return { error: "Spread strikes not both quoted" };
      const short = buildLeg({ row: atmRow, side: atmRow.ce, type: "CE" }, "SELL", 1, spot, T, q);
      const long  = buildLeg({ row: upper,  side: upper.ce,  type: "CE" }, "BUY",  1, spot, T, q);
      if (!short || !long) return { error: "Cannot price spread legs" };
      return { legs: [short, long] };
    },
  },
  {
    kind: "IRON_CONDOR",
    name: "Iron Condor",
    category: "CREDIT",
    outlook: "Range-bound — collect credit while spot stays inside short strikes.",
    description: "Sell OTM put & call (2 steps from ATM) + buy further OTM wings (4 steps).",
    suitability: { ivContext: "HIGH", biasFit: ["NEUTRAL"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      const shortPutR  = strikeOffset(chain, atmRow.strike, -2);
      const longPutR   = strikeOffset(chain, atmRow.strike, -4);
      const shortCallR = strikeOffset(chain, atmRow.strike, +2);
      const longCallR  = strikeOffset(chain, atmRow.strike, +4);
      if (!shortPutR?.pe || !longPutR?.pe || !shortCallR?.ce || !longCallR?.ce) {
        return { error: "Condor wings not all quoted" };
      }
      const sp = buildLeg({ row: shortPutR,  side: shortPutR.pe,  type: "PE" }, "SELL", 1, spot, T, q);
      const lp = buildLeg({ row: longPutR,   side: longPutR.pe,   type: "PE" }, "BUY",  1, spot, T, q);
      const sc = buildLeg({ row: shortCallR, side: shortCallR.ce, type: "CE" }, "SELL", 1, spot, T, q);
      const lc = buildLeg({ row: longCallR,  side: longCallR.ce,  type: "CE" }, "BUY",  1, spot, T, q);
      if (!sp || !lp || !sc || !lc) return { error: "Cannot price condor legs" };
      return { legs: [lp, sp, sc, lc] };
    },
  },
  {
    kind: "IRON_BUTTERFLY",
    name: "Iron Butterfly",
    category: "CREDIT",
    outlook: "Strong pin to ATM — narrower than condor, larger credit, smaller profit zone.",
    description: "Sell ATM call + ATM put + buy OTM wings (2 steps each side).",
    suitability: { ivContext: "HIGH", biasFit: ["NEUTRAL"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      const longPutR  = strikeOffset(chain, atmRow.strike, -2);
      const longCallR = strikeOffset(chain, atmRow.strike, +2);
      if (!atmRow.ce || !atmRow.pe || !longPutR?.pe || !longCallR?.ce) {
        return { error: "Butterfly wings not all quoted" };
      }
      const sp = buildLeg({ row: atmRow,    side: atmRow.pe,    type: "PE" }, "SELL", 1, spot, T, q);
      const sc = buildLeg({ row: atmRow,    side: atmRow.ce,    type: "CE" }, "SELL", 1, spot, T, q);
      const lp = buildLeg({ row: longPutR,  side: longPutR.pe,  type: "PE" }, "BUY",  1, spot, T, q);
      const lc = buildLeg({ row: longCallR, side: longCallR.ce, type: "CE" }, "BUY",  1, spot, T, q);
      if (!sp || !sc || !lp || !lc) return { error: "Cannot price butterfly legs" };
      return { legs: [lp, sp, sc, lc] };
    },
  },
  {
    kind: "COVERED_CALL",
    name: "Covered Call",
    category: "STOCK_PLUS",
    outlook: "Own the underlying, sell upside above OTM call strike for income.",
    description: "Long 1 lot of stock + short 1 OTM call (2 strikes above ATM). Reduces basis.",
    suitability: { ivContext: "ANY", biasFit: ["NEUTRAL", "BULLISH"] },
    build: ({ chain, spot, T, q, atmRow }) => {
      const otmCall = strikeOffset(chain, atmRow.strike, +2);
      if (!otmCall?.ce) return { error: "OTM call leg not quoted" };
      const short = buildLeg({ row: otmCall, side: otmCall.ce, type: "CE" }, "SELL", 1, spot, T, q);
      if (!short) return { error: "Cannot price OTM call" };
      // Synthesize a "long stock" leg as a deep ITM call with strike=0, premium=spot.
      // (For payoff math, long stock at S₀ behaves identically: payoff = S_T - S₀.)
      const stockLeg: StrategyLeg = {
        action: "BUY", optionType: "CE", strike: 0, premium: spot,
        iv: 0, delta: 1, gamma: 0, vega: 0, theta: 0, qty: 1, source: "bs",
      };
      return { legs: [stockLeg, short] };
    },
  },
];

// ─── Public entry point ─────────────────────────────────────────────────────

export function buildStrategies(chain: OcResponse, analytics: OptionAnalytics): StrategyBundle {
  const spot = chain.spot;
  const lotSize = chain.lotSize ?? 1;
  const T = yearsToExpiry(chain.expiry);
  // Equities pay dividends; indices don't. We don't have per-stock dividend yield
  // here without another fetch — assume 0 (close to truth for short-dated options).
  const q = 0;

  const atmRow = chain.rows.find(r => r.strike === chain.atmStrike)
    ?? nearestRow(chain.rows, spot)
    ?? chain.rows[0];

  // Determine IV context from chain analytics + IV percentile if available.
  let ivContext: "LOW" | "HIGH" | "UNKNOWN" = "UNKNOWN";
  if (analytics.ivPercentile != null) {
    if (analytics.ivPercentile >= 70) ivContext = "HIGH";
    else if (analytics.ivPercentile <= 30) ivContext = "LOW";
    else ivContext = "UNKNOWN";
  } else if (analytics.atmIv != null) {
    // Heuristic absolute thresholds when no history exists yet
    if (analytics.atmIv >= 25) ivContext = "HIGH";
    else if (analytics.atmIv <= 12) ivContext = "LOW";
  }

  const atmSigma = analytics.atmIv != null ? analytics.atmIv / 100 : 0.18;

  const ctx: BuildContext = { chain, spot, T, q, lotSize, atmRow, ivContext, bias: analytics.bias, atmSigma };

  const out: StrategySnapshot[] = [];
  const unavailable: { kind: StrategyKind; reason: string }[] = [];

  for (const tpl of TEMPLATES) {
    const built = tpl.build(ctx);
    if ("error" in built) {
      unavailable.push({ kind: tpl.kind, reason: built.error });
      continue;
    }
    const legs = built.legs;
    const debit = +netDebit(legs).toFixed(2);
    const greeksAgg = netGreeks(legs);
    const { payoff, maxProfit, maxLoss, breakevens } = buildPayoff(legs, spot, lotSize);
    const pop = approxPop(payoff, spot, T, atmSigma);
    const recommended = isRecommended(tpl, ivContext, analytics.bias);
    const rationale = recommended ? buildRationale(tpl, ivContext, analytics.bias) : undefined;

    out.push({
      kind: tpl.kind,
      name: tpl.name,
      category: tpl.category,
      outlook: tpl.outlook,
      description: tpl.description,
      legs,
      netDebit: debit,                                   // per share
      netGreeks: greeksAgg,
      maxProfit,
      maxLoss,
      breakevens,
      payoff,
      pop,
      rrRatio: maxProfit != null && maxLoss != null && maxLoss !== 0
        ? +Math.abs(maxProfit / maxLoss).toFixed(3) : null,
      lotSize,
      perLot: {
        maxProfit: maxProfit != null ? +maxProfit.toFixed(2) : null,
        maxLoss:   maxLoss   != null ? +maxLoss.toFixed(2)   : null,
        netDebit:  +(debit * lotSize).toFixed(2),
      },
      suitability: tpl.suitability,
      recommended,
      rationale,
    });
  }

  return {
    underlying: chain.underlying,
    spot,
    expiry: chain.expiry,
    daysToExpiry: Math.max(0, Math.round(T * 365)),
    ivContext,
    bias: analytics.bias,
    strategies: out,
    unavailable,
    generatedAt: new Date().toISOString(),
  };
}

function isRecommended(
  tpl: Template,
  ivContext: "LOW" | "HIGH" | "UNKNOWN",
  bias: OptionAnalytics["bias"],
): boolean {
  const biasOk = tpl.suitability.biasFit.includes(bias);
  if (!biasOk) return false;
  if (tpl.suitability.ivContext === "ANY") return true;
  if (ivContext === "UNKNOWN") return false;
  return tpl.suitability.ivContext === ivContext;
}

function buildRationale(
  tpl: Template,
  ivContext: "LOW" | "HIGH" | "UNKNOWN",
  bias: OptionAnalytics["bias"],
): string {
  const ivPart =
    tpl.suitability.ivContext === "LOW"  ? "IV looks compressed → directional debit plays are cheap."
    : tpl.suitability.ivContext === "HIGH" ? "IV is elevated → premium-selling has positive edge."
    : "Works across IV regimes.";
  return `Bias is ${bias} and ${ivPart}`;
}
