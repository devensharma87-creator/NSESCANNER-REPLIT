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

export interface LegEdge {
  strike: number;
  type: OptionType;
  action: "BUY" | "SELL";
  mid: number;          // ₹/share — what the chain quoted
  theoretical: number;  // ₹/share — BS price using a single reference IV (ATM)
  edge: number;         // ₹/share — signed (positive = good for the trader)
}

export interface DistMetrics {
  /** Expected payoff in ₹/lot under the risk-neutral lognormal distribution. */
  expectedValue: number;
  /** σ of the payoff distribution in ₹/lot — gives a "typical swing" feel. */
  stdDev: number;
  /** P(payoff > 0). Replaces the old approxPop. */
  pop: number;
  /** Mean of payoff conditional on a winning outcome (₹/lot). */
  avgWin: number;
  /** Mean of |payoff| conditional on a losing outcome (₹/lot). */
  avgLoss: number;
  /**
   * **Probabilistic R:R = avgWin / avgLoss.** This is the R:R that actually
   * matters to a trader: "when I win, this is what I make on average; when I
   * lose, this is what I lose on average." Unlike chart-range R:R it's a real
   * statistical quantity, defined even when payoff is unbounded.
   */
  probabilisticRr: number | null;
  /** ±1σ price band at expiry (₹ from spot, both directions equal in % terms). */
  expectedMove1Sigma: number;
  /** ±2σ price band at expiry. */
  expectedMove2Sigma: number;
}

export interface StrategySnapshot {
  kind: StrategyKind;
  name: string;
  category: "DEBIT" | "CREDIT" | "STOCK_PLUS";
  outlook: string;
  description: string;
  legs: StrategyLeg[];
  netDebit: number;          // positive = pay (debit), negative = receive (credit)
  netGreeks: { delta: number; gamma: number; vega: number; theta: number };
  maxProfit: number | null;  // theoretical, null = unbounded
  maxLoss: number | null;    // theoretical, null = unbounded; signed (negative if loss)
  breakevens: number[];
  payoff: PayoffPoint[];
  pop: number | null;        // = dist.pop (kept top-level for backwards compat)
  rrRatio: number | null;    // |maxProfit / maxLoss| (theoretical), when both bounded
  // Display-mode (chart-range) extrema. These are what the user actually
  // sees on the curve and what the UI should headline. For Long Put on
  // NIFTY this is ~₹150K, not the theoretical ₹15L+ at S=0.
  displayMaxProfit: number;
  displayMaxLoss: number;
  displayRrRatio: number | null;
  /** Distributional metrics — see DistMetrics. Always present. */
  dist: DistMetrics;
  /** Per-leg edge vs ATM-IV-flat BS price. Sum reflects net skew capture. */
  legEdges: LegEdge[];
  /** ₹/lot net edge across all legs (positive = trader benefits from skew). */
  netEdge: number;
  /**
   * Capital required to hold the position for one lot in ₹.
   * - Debit strategies → net premium paid (max loss).
   * - Defined-risk credit spreads (condor/butterfly/vertical) → |max loss|.
   * - Naked-credit (short straddle / strangle) → SPAN+exposure proxy
   *   (≈ 18% of underlying notional minus the credit received).
   */
  marginRequired: number;
  /** Expected return on the capital required (decimal, e.g. 0.04 = +4%). */
  returnOnCapital: number | null;
  lotSize: number;
  perLot: {
    maxProfit: number | null;        // theoretical, ₹/lot
    maxLoss: number | null;          // theoretical, ₹/lot
    netDebit: number;                // ₹/lot
    displayMaxProfit: number;        // chart-range, ₹/lot
    displayMaxLoss: number;          // chart-range, ₹/lot
  };
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

function buildPayoff(
  legs: StrategyLeg[],
  spot: number,
  lotSize: number,
  expectedMove2Sigma: number,
): {
  payoff: PayoffPoint[];
  maxProfit: number | null;        // theoretical, evaluated at S=0 and S→∞
  maxLoss: number | null;
  // Realistic extrema — max/min P&L within the **±2σ expected-move window**
  // by expiry (lognormal model). For Long Put on NIFTY, chart-range max would
  // sit at spot*0.9 (~₹135K), theoretical max sits at S=0 (~₹18L+), but the
  // 2σ-bounded value is the only one a trader can actually reason about
  // ("what's likely if the move plays out as priced"). For bounded strategies
  // (verticals, condors, etc.) the 2σ window typically envelops the kinks so
  // the realistic value equals the theoretical max — both safe and meaningful.
  // Falls back to chart-range if expectedMove2Sigma is 0 (no IV available).
  displayMaxProfit: number;
  displayMaxLoss: number;
  breakevens: number[];
}  {
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

  // ── Realistic display extrema: max/min P&L over the **±2σ expected-move
  // window** by expiry. This is the only economically meaningful "max"
  // for unbounded-direction strategies (Long Put theoretical max at S=0 is
  // mathematically true but uneconomic; chart-range max at spot*0.9 is an
  // arbitrary visualization artefact). For bounded strategies (verticals,
  // condors), the 2σ window typically envelops every kink so the realistic
  // value equals the theoretical max — both correct.
  //
  // The realistic window is clamped to the chart range so we never quote a
  // P&L the chart doesn't render. Falls back to chart-range when no IV is
  // available (expectedMove2Sigma <= 0) — preserves prior behaviour.
  let realisticLo: number;
  let realisticHi: number;
  if (expectedMove2Sigma > 0) {
    realisticLo = Math.max(lo, spot - expectedMove2Sigma);
    realisticHi = Math.min(hi, spot + expectedMove2Sigma);
    if (realisticLo < 0) realisticLo = 0;
    // Sanity: if window collapsed (e.g. tiny T), fall back to chart range
    if (realisticHi <= realisticLo) { realisticLo = lo; realisticHi = hi; }
  } else {
    realisticLo = lo;
    realisticHi = hi;
  }
  let displayMaxProfit = -Infinity;
  let displayMaxLoss = +Infinity;
  // (a) include both window endpoints (exact P&L at the 2σ edges)
  // (b) include any leg-strike kink within the window (where extrema may sit)
  // (c) include all sampled chart points that fall within the window
  const realisticEval: number[] = [realisticLo, realisticHi];
  for (const k of legStrikes) {
    if (k >= realisticLo && k <= realisticHi) realisticEval.push(k);
  }
  for (const v of realisticEval) {
    const pnl = sampleAt(v);
    if (pnl > displayMaxProfit) displayMaxProfit = pnl;
    if (pnl < displayMaxLoss)   displayMaxLoss   = pnl;
  }
  for (const p of payoff) {
    if (p.spot < realisticLo || p.spot > realisticHi) continue;
    if (p.pnl > displayMaxProfit) displayMaxProfit = p.pnl;
    if (p.pnl < displayMaxLoss)   displayMaxLoss   = p.pnl;
  }
  if (!Number.isFinite(displayMaxProfit)) displayMaxProfit = 0;
  if (!Number.isFinite(displayMaxLoss))   displayMaxLoss   = 0;
  displayMaxProfit = +displayMaxProfit.toFixed(2);
  displayMaxLoss   = +displayMaxLoss.toFixed(2);

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

  return { payoff, maxProfit, maxLoss, displayMaxProfit, displayMaxLoss, breakevens: uniq };
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
 * Compute the full distributional summary of a strategy's payoff at expiry
 * under the **risk-neutral lognormal** model:
 *   ln(S_T) ~ N( ln(F) - σ²T/2 , σ²T )   where F = S₀ · e^((r-q)T)
 *
 * Why this replaces the old `approxPop`: it uses one numerical integration
 * pass on a dense grid spanning ±5σ in log-space and computes everything we
 * need from the same set of samples — POP, expected value, σ of P/L, mean
 * win, mean loss, **probabilistic R:R = E[win]/E[loss]**.
 *
 * The probabilistic R:R is the only R:R that's defined for unbounded payoffs
 * (Long Call, Long Straddle, Short Straddle): you can't divide by ∞, but you
 * CAN ask "if I win, on average how much; if I lose, on average how much."
 * This is exactly what traders mean when they say "I want 1:2 R:R on this".
 *
 * The drift uses the forward (S₀·e^((r-q)T)), which is the proper risk-
 * neutral mean — for short-dated indices in India this nudges POP up by ~1%
 * vs the old "spot-as-center" assumption, but it's the textbook-correct call.
 */
function distributionalMetrics(
  legs: StrategyLeg[],
  lotSize: number,
  spot: number,
  T: number,
  sigma: number,
  r: number,
  q: number,
): DistMetrics | null {
  if (!Number.isFinite(sigma) || sigma <= 0 || T <= 0 || spot <= 0) return null;
  const stdLn = sigma * Math.sqrt(T);
  const forward = spot * Math.exp((r - q) * T);
  const muLn = Math.log(forward) - 0.5 * stdLn * stdLn;

  // 1001 samples across ±5σ in log-space ≈ 0.99999% of total mass. The
  // remaining tail (Long Call's payoff at S→∞, etc.) contributes negligibly
  // to E[X] for all the strategies in this list because the lognormal pdf
  // decays super-exponentially while payoff grows only linearly in S.
  const N = 1001;
  const lnLo = muLn - 5 * stdLn;
  const lnHi = muLn + 5 * stdLn;
  const dLn = (lnHi - lnLo) / (N - 1);
  const norm = 1 / (Math.sqrt(2 * Math.PI) * stdLn);

  let ev = 0, eX2 = 0, prob = 0, evWin = 0, evLossAbs = 0;
  for (let i = 0; i < N; i++) {
    const lnS = lnLo + i * dLn;
    const S = Math.exp(lnS);
    const z = (lnS - muLn) / stdLn;
    // Probability mass in this lnS slice (∫ pdf(lnS) dlnS):
    const w = norm * Math.exp(-0.5 * z * z) * dLn;
    const pnl = legs.reduce((acc, l) => acc + legPayoff(l, S), 0) * lotSize;
    ev   += pnl * w;
    eX2  += pnl * pnl * w;
    if (pnl > 0)      { prob      += w; evWin     += pnl * w; }
    else if (pnl < 0) {                 evLossAbs += -pnl * w; }
  }

  const variance = Math.max(0, eX2 - ev * ev);
  const stdDev   = Math.sqrt(variance);
  const pop      = Math.max(0, Math.min(1, prob));
  const probLoss = Math.max(0, Math.min(1, 1 - prob));
  const avgWin   = pop      > 1e-6 ? evWin     / pop      : 0;
  const avgLoss  = probLoss > 1e-6 ? evLossAbs / probLoss : 0;
  const probabilisticRr = avgLoss > 1e-6 ? avgWin / avgLoss : null;

  // ±1σ / ±2σ moves in price units (the lognormal is asymmetric — strictly
  // speaking the up-move and down-move are not equal — but at typical
  // short-dated σ ≈ 1-3% the symmetric approximation is well within rounding).
  const expectedMove1Sigma = spot * stdLn;
  const expectedMove2Sigma = spot * 2 * stdLn;

  return {
    expectedValue:     +ev.toFixed(2),
    stdDev:            +stdDev.toFixed(2),
    pop:               +pop.toFixed(4),
    avgWin:            +avgWin.toFixed(2),
    avgLoss:           +avgLoss.toFixed(2),
    probabilisticRr:   probabilisticRr == null ? null : +probabilisticRr.toFixed(3),
    expectedMove1Sigma: +expectedMove1Sigma.toFixed(2),
    expectedMove2Sigma: +expectedMove2Sigma.toFixed(2),
  };
}

/**
 * For each leg, compute the BS theoretical price using **a single reference
 * IV (ATM)** and report the per-share edge:
 *   - BUY  edge = theoretical - market      (paid less than fair → positive)
 *   - SELL edge = market      - theoretical (received more than fair → positive)
 *
 * Because each leg's `iv` was solved FROM the leg's market price, comparing
 * theoretical(leg.iv) to market would always return zero. Using the ATM IV as
 * the reference surfaces volatility skew: a far-OTM put trading at IV 30%
 * while ATM IV is 15% will look "rich" — selling it carries positive edge.
 */
function computeLegEdges(
  legs: StrategyLeg[],
  spot: number,
  T: number,
  refSigma: number,
  r: number,
  q: number,
): { edges: LegEdge[]; netEdge: number } {
  const edges: LegEdge[] = [];
  let netEdge = 0;
  for (const l of legs) {
    if (l.strike <= 0) continue; // synthetic stock leg in covered call
    const theoretical = priceAndGreeks({
      S: spot, K: l.strike, T, r, q, sigma: refSigma, type: l.optionType,
    }).price;
    const edgePerShare = l.action === "BUY"
      ? (theoretical - l.premium)
      : (l.premium - theoretical);
    edges.push({
      strike: l.strike,
      type: l.optionType,
      action: l.action,
      mid:         +l.premium.toFixed(2),
      theoretical: +theoretical.toFixed(2),
      edge:        +edgePerShare.toFixed(2),
    });
    netEdge += edgePerShare * l.qty;
  }
  return { edges, netEdge };
}

/**
 * Capital required to put on one lot of the strategy in INR.
 *
 * For exchange-cleared margin in India this is approximated, not exact —
 * SPAN+exposure depends on real-time portfolio risk that we don't model.
 * The proxy errs on the side of being usable for sizing decisions:
 *   - Pure debit (long call, long straddle, etc.)         → premium paid
 *   - Defined-risk credit (spreads, condor, butterfly)    → |max loss|
 *   - Naked credit (short straddle / strangle, unbounded) → 18% of underlying
 *     notional minus the credit received (the SPAN+exposure rough rule of
 *     thumb for sold index naked options).
 */
function estimateMargin(
  netDebitPerShare: number,
  maxLossLot: number | null,
  spot: number,
  lotSize: number,
): number {
  const cashflowLot = netDebitPerShare * lotSize;
  // Pure debit → cost is the capital
  if (cashflowLot > 0) return +cashflowLot.toFixed(2);
  const creditReceived = -cashflowLot;
  if (maxLossLot != null) {
    // Defined-risk credit spread (vertical, condor, butterfly).
    //
    // Capital at risk = |maxLoss|. The maxLoss returned by buildPayoff is
    // ALREADY the net P/L at the worst expiry point — i.e. it already nets
    // the credit you kept. For a 100-wide bull-put spread sold for ₹50
    // credit, |maxLoss| = ₹50 (= width − credit) per share, which is exactly
    // the working capital. Do NOT subtract creditReceived again — that
    // double-counts the credit and drives capital to ~₹0.
    return +Math.abs(maxLossLot).toFixed(2);
  }
  // Unbounded credit (short straddle / strangle): SPAN+exposure proxy.
  // ~18% of underlying notional, less the credit retained in cash (brokers
  // typically allow the premium received to offset part of the SPAN block).
  const notional = spot * lotSize;
  return +Math.max(0, 0.18 * notional - creditReceived).toFixed(2);
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
      // Indices (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/NIFTYNXT50/SENSEX) are
      // cash-settled — there is no deliverable "share" you can buy and hold.
      // The classic Covered Call (long stock + short OTM call) is meaningless
      // for an index, so we surface it as unavailable instead of synthesizing
      // a fake "buy NIFTY at spot" leg (which made Max Loss = full underlying
      // value, e.g. -₹15.4L on NIFTY for a +₹16k premium — a non-trade).
      if (chain.kind === "INDEX") {
        return { error: "Covered Call needs ownership of the underlying — indices are cash-settled, so this strategy doesn't apply. (Use a futures-based covered call separately if you want similar exposure.)" };
      }
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
    // ±2σ expected move in price units — used to bound the realistic
    // display extrema. Lognormal stdev × spot, doubled. Falls back to 0
    // when no IV is available, in which case buildPayoff reverts to its
    // chart-range behaviour (preserves prior output for IV-blind cases).
    const stdLnATM = Number.isFinite(atmSigma) && atmSigma > 0 && T > 0
      ? atmSigma * Math.sqrt(T) : 0;
    const expectedMove2Sigma = spot > 0 ? spot * 2 * stdLnATM : 0;
    const { payoff, maxProfit, maxLoss, displayMaxProfit, displayMaxLoss, breakevens } =
      buildPayoff(legs, spot, lotSize, expectedMove2Sigma);
    const dist = distributionalMetrics(legs, lotSize, spot, T, atmSigma, RISK_FREE, q);
    const { edges: legEdges, netEdge: netEdgeRaw } = computeLegEdges(legs, spot, T, atmSigma, RISK_FREE, q);
    const netEdge = +(netEdgeRaw * lotSize).toFixed(2);

    const marginRequired = estimateMargin(debit, maxLoss, spot, lotSize);
    const recommended = isRecommended(tpl, ivContext, analytics.bias);
    const rationale = recommended ? buildRationale(tpl, ivContext, analytics.bias) : undefined;

    // Display R:R now uses **±2σ realistic** numbers. For a Long Put on
    // NIFTY this turns the old chart-range "1:25" (and the absurd theoretical
    // "1:287") into a tradeable "1:1.4" or so — matching what a trader
    // actually sees if the move plays out as priced.
    const displayRrRatio = displayMaxLoss < 0 && displayMaxProfit > 0
      ? +Math.abs(displayMaxProfit / displayMaxLoss).toFixed(3)
      : null;

    // Fall back gracefully when distributional metrics couldn't be built
    // (no IV available) — preserve the old behaviour so the strategy still
    // renders, just without EV/probabilistic R:R/etc.
    const safeDist: DistMetrics = dist ?? {
      expectedValue: 0, stdDev: 0, pop: 0, avgWin: 0, avgLoss: 0,
      probabilisticRr: null, expectedMove1Sigma: 0, expectedMove2Sigma: 0,
    };
    const returnOnCapital = marginRequired > 0
      ? +(safeDist.expectedValue / marginRequired).toFixed(4)
      : null;

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
      pop: dist ? safeDist.pop : null,
      rrRatio: maxProfit != null && maxLoss != null && maxLoss !== 0
        ? +Math.abs(maxProfit / maxLoss).toFixed(3) : null,
      displayMaxProfit,
      displayMaxLoss,
      displayRrRatio,
      dist: safeDist,
      legEdges,
      netEdge,
      marginRequired,
      returnOnCapital,
      lotSize,
      perLot: {
        maxProfit: maxProfit != null ? +maxProfit.toFixed(2) : null,
        maxLoss:   maxLoss   != null ? +maxLoss.toFixed(2)   : null,
        netDebit:  +(debit * lotSize).toFixed(2),
        displayMaxProfit,
        displayMaxLoss,
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
