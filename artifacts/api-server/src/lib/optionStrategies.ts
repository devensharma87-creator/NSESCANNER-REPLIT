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
import type { LiveBiasSnapshot } from "./liveBias";
import { priceAndGreeks, impliedVolatility, yearsToExpiry, type OptionType } from "./blackScholes";

export type MarketStatus = "open" | "pre_open" | "closed";

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
  /** Liquidity & quote-quality fields. Surfaced so the UI can refuse to
   *  mislead the user about a strike that nobody actually trades. All
   *  nullable to honour the no-synthetic-data rule when the chain didn't
   *  return real bid/ask/oi/vol. */
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;   // (ask - bid) / mid, decimal
  oi: number | null;
  volume: number | null;
  /** True only when both bid AND ask were quoted by the chain. False when
   *  we fell back to LTP (a stale-price proxy that's unsafe to work). */
  quoted: boolean;
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
  /** Worst-case execution quality across all legs. Drives a UI badge so the
   *  user knows whether the listed prices are tradeable.
   *   TIGHT — every leg has a real bid/ask quote with spread ≤ 4% of mid
   *   WIDE  — at least one leg has spread between 4–15% (workable but slip)
   *   POOR  — at least one leg has spread > 15% OR fell back to LTP-only.
   *           These plans should be sized down or skipped at the bid/ask. */
  legQuality: "TIGHT" | "WIDE" | "POOR";
  /** Average IV across all option legs (decimal). Lets the card surface a
   *  "characteristic IV" pill without expanding the leg table. */
  avgLegIv: number;
  /** Volume-weighted-mid OI on the strategy's short legs. Useful for the
   *  user to see how thick the wings really are. Null when the chain didn't
   *  return per-leg OI. */
  shortLegOi: number | null;
}

export interface StrategyBundle {
  underlying: string;
  spot: number;
  expiry: string;
  daysToExpiry: number;
  ivContext: "LOW" | "HIGH" | "UNKNOWN";
  /** Bias used to drive recommendations — see `blendedBias`. Kept for
   *  backwards compatibility with the existing UI; identical to `blendedBias`. */
  bias: OptionAnalytics["bias"];
  /** Bias derived purely from option-chain positioning (PCR + max-pain). */
  structuralBias: OptionAnalytics["bias"];
  /** Bias derived from live intraday VWAP/EMA9/EMA21/RSI on the underlying.
   *  Null when intraday data couldn't be fetched (no Kite session AND Yahoo
   *  intraday empty) — caller falls through to structural bias. */
  liveBias: LiveBiasSnapshot | null;
  /** Final bias used by the recommendation engine — agreement of structural
   *  + live = high conviction; disagreement = NEUTRAL (transition zone);
   *  only one available = use that one. */
  blendedBias: OptionAnalytics["bias"];
  /** Plain-English explanation of how the blend was reached. */
  biasReason: string;
  /** Plain-English explanation of how the IV regime was classified. */
  ivRegimeReason: string;
  /** Equity-session state at the moment this bundle was generated.
   *  `closed` / `pre_open` flips the recommendation engine to demote
   *  unbounded-loss naked-credit strategies and surface a UI banner. */
  marketStatus: MarketStatus;
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

/** Returns whether the side has a real two-sided quote, plus the relative
 *  spread (ask - bid) / mid as a decimal. Used by the liquidity gate so the
 *  builder can refuse to ship a strategy that's only "priceable" via stale
 *  LTP, and so the UI can warn on tail-strike legs with a 25%-wide spread. */
function legLiquidity(side: OcSide | undefined): {
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  oi: number | null;
  volume: number | null;
  quoted: boolean;
} {
  if (!side) {
    return { bid: null, ask: null, spreadPct: null, oi: null, volume: null, quoted: false };
  }
  const bid = side.bid != null && side.bid > 0 ? side.bid : null;
  const ask = side.ask != null && side.ask > 0 ? side.ask : null;
  const quoted = bid != null && ask != null && ask >= bid;
  const spreadPct = quoted
    ? +((ask! - bid!) / ((ask! + bid!) / 2)).toFixed(4)
    : null;
  return {
    bid, ask, spreadPct,
    oi:     side.oi     != null ? side.oi     : null,
    volume: side.volume != null ? side.volume : null,
    quoted,
  };
}

/** Compute the option's delta from a chain row using its quoted IV when
 *  available, otherwise solving via the leg's mid price, otherwise falling
 *  back to the strategy's reference ATM IV. Used by `pickStrikeByDelta`. */
function deltaForRow(
  row: OcRow,
  type: OptionType,
  spot: number,
  T: number,
  q: number,
  atmSigma: number,
): number | null {
  const side = type === "CE" ? row.ce : row.pe;
  if (!side) return null;
  const mid = midOrLtp(side);
  if (mid == null) return null;
  let iv = side.iv != null && side.iv > 0 ? side.iv / 100 : null;
  if (iv == null) {
    iv = impliedVolatility({
      S: spot, K: row.strike, T, r: RISK_FREE, q, type, marketPrice: mid,
    });
  }
  if (iv == null) iv = atmSigma;
  if (!Number.isFinite(iv) || iv <= 0) return null;
  return priceAndGreeks({ S: spot, K: row.strike, T, r: RISK_FREE, q, sigma: iv, type }).delta;
}

/**
 * Pick the chain row whose absolute delta is closest to `targetAbsDelta`
 * for the requested option type. This is the **professional standard** for
 * scaling multi-leg strategies to an underlying's actual implied volatility,
 * and replaces the rigid "±N strike steps from ATM" convention which is
 * arbitrary across underlyings (±2 steps is ±0.4% of NIFTY but ±4% of a
 * ₹500 stock — totally different risk profiles).
 *
 * For OTM-only requests (e.g. "the short put wing of an iron condor"), the
 * scan is restricted to strikes on the OTM side of spot, otherwise we'd
 * accidentally pick a deep-ITM call to satisfy a "30Δ short call" goal.
 *
 * Returns `null` when no row meets the criteria — caller is expected to fall
 * back to `strikeOffset` so the strategy still ships on thin chains.
 */
function pickStrikeByDelta(
  chain: OcResponse,
  targetAbsDelta: number,
  type: OptionType,
  side: "OTM" | "ANY",
  spot: number,
  T: number,
  q: number,
  atmSigma: number,
): OcRow | null {
  let best: { row: OcRow; dist: number } | null = null;
  for (const row of chain.rows) {
    if (side === "OTM") {
      if (type === "CE" && row.strike <= spot) continue;
      if (type === "PE" && row.strike >= spot) continue;
    }
    const d = deltaForRow(row, type, spot, T, q, atmSigma);
    if (d == null) continue;
    const dist = Math.abs(Math.abs(d) - targetAbsDelta);
    if (!best || dist < best.dist) best = { row, dist };
  }
  return best ? best.row : null;
}

/** Combined picker: try delta-targeted first, fall back to step-based. */
function pickStrike(
  chain: OcResponse,
  fromStrike: number,
  fallbackStep: number,
  targetAbsDelta: number,
  type: OptionType,
  spot: number,
  T: number,
  q: number,
  atmSigma: number,
): OcRow | null {
  return pickStrikeByDelta(chain, targetAbsDelta, type, "OTM", spot, T, q, atmSigma)
      ?? strikeOffset(chain, fromStrike, fallbackStep);
}

/**
 * Pair-aware picker for the **protective long wing** of a credit spread or
 * condor. Identical to `pickStrike`, but constrained so the chosen strike is
 * strictly *beyond* `anchorStrike` in the OTM direction (i.e. higher for CE,
 * lower for PE). This prevents the delta picker from accidentally placing
 * the long wing on top of (or inside of) the short wing on coarse strike
 * grids, which would collapse the spread width to zero or invert the geometry.
 *
 * Selection algorithm:
 *   1. Try delta-targeted pick restricted to strikes farther OTM than the anchor.
 *   2. If nothing found, fall back to the next strike step in the right
 *      direction from the anchor (always farther OTM, never colliding).
 *   3. If even that doesn't exist on the chain, give up — caller will mark
 *      the strategy unavailable.
 */
function pickStrikeFartherOtm(
  chain: OcResponse,
  anchorStrike: number,
  fallbackStep: number,
  targetAbsDelta: number,
  type: OptionType,
  spot: number,
  T: number,
  q: number,
  atmSigma: number,
): OcRow | null {
  // Scan strikes that meet *both* constraints: real OTM relative to spot AND
  // strictly farther OTM than the anchor (the short leg).
  let best: { row: OcRow; dist: number } | null = null;
  for (const row of chain.rows) {
    if (type === "CE") {
      if (row.strike <= spot) continue;
      if (row.strike <= anchorStrike) continue;
    } else {
      if (row.strike >= spot) continue;
      if (row.strike >= anchorStrike) continue;
    }
    const d = deltaForRow(row, type, spot, T, q, atmSigma);
    if (d == null) continue;
    const dist = Math.abs(Math.abs(d) - targetAbsDelta);
    if (!best || dist < best.dist) best = { row, dist };
  }
  if (best) return best.row;
  // Fallback: walk one step further OTM from the anchor, then keep walking
  // until we find a quoted row on the requested side. Caps at 6 steps to
  // avoid runaway loops on pathological chains.
  const step = type === "CE" ? +1 : -1;
  for (let i = 1; i <= 6; i++) {
    const cand = strikeOffset(chain, anchorStrike, step * i);
    if (!cand) continue;
    const side = type === "CE" ? cand.ce : cand.pe;
    if (side && midOrLtp(side) != null) return cand;
  }
  // Last-resort: respect the original fallbackStep request from the template.
  void fallbackStep;
  return null;
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

  const liq = legLiquidity(built.side);
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
    bid: liq.bid,
    ask: liq.ask,
    spreadPct: liq.spreadPct,
    oi: liq.oi,
    volume: liq.volume,
    quoted: liq.quoted,
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
  underlyingKind: "INDEX" | "EQUITY",
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
  // Unbounded credit (short straddle / strangle): SPAN+exposure proxy
  // tuned to India F&O exchange rules:
  //   SPAN initial margin   ≈ 13% scenario shock for indices, 15% for equity
  //   Exposure margin       ≈ 3% of notional (NSE F&O exposure rule)
  //   Credit retained       reduces the cash blocked
  //
  // The naked-credit strategy here is a short STRANGLE/STRADDLE — both sides
  // open simultaneously. Brokers typically apply the SPAN block once
  // (because shocks on either tail offset on the other side), so we don't
  // double-count.
  const notional = spot * lotSize;
  const spanPct     = underlyingKind === "INDEX" ? 0.13 : 0.15;
  const exposurePct = 0.03;
  const block = (spanPct + exposurePct) * notional;
  return +Math.max(0, block - creditReceived).toFixed(2);
}

/** Roll up per-leg liquidity into a single execution-quality bucket for the
 *  strategy. Drives the colored badge on each card so a glance tells the
 *  user whether the listed prices are tradeable, workable with slippage, or
 *  effectively a placeholder. */
function classifyLegQuality(legs: StrategyLeg[]): "TIGHT" | "WIDE" | "POOR" {
  let worst: "TIGHT" | "WIDE" | "POOR" = "TIGHT";
  for (const l of legs) {
    if (l.strike === 0) continue; // synthetic stock leg — N/A
    if (!l.quoted) { return "POOR"; }
    const sp = l.spreadPct;
    if (sp == null) { worst = worst === "POOR" ? "POOR" : "WIDE"; continue; }
    if (sp > 0.15) return "POOR";
    if (sp > 0.04 && worst === "TIGHT") worst = "WIDE";
  }
  return worst;
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
    description: "Buy ~25Δ OTM call + ~25Δ OTM put (≈ ±1σ wings). Limited risk, unlimited reward.",
    suitability: { ivContext: "LOW", biasFit: ["NEUTRAL"] },
    build: ({ chain, spot, T, q, atmRow, atmSigma }) => {
      // 25-delta wings sit roughly at the ±1σ expected-move band — the
      // textbook "buy the wings of the move" construction for a strangle.
      const otmCall = pickStrike(chain, atmRow.strike, +2, 0.25, "CE", spot, T, q, atmSigma);
      const otmPut  = pickStrike(chain, atmRow.strike, -2, 0.25, "PE", spot, T, q, atmSigma);
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
    outlook: "Range-bound — sell ~16Δ wings (~1σ band, ~68% POP) and let theta work.",
    description: "Sell ~16Δ OTM call + ~16Δ OTM put. Wider profit zone than short straddle, unlimited risk.",
    suitability: { ivContext: "HIGH", biasFit: ["NEUTRAL"] },
    build: ({ chain, spot, T, q, atmRow, atmSigma }) => {
      // 16-delta is the conventional "1σ short wing" used by professional
      // premium sellers — POP ≈ 68%, balances credit vs assignment risk.
      const otmCall = pickStrike(chain, atmRow.strike, +2, 0.16, "CE", spot, T, q, atmSigma);
      const otmPut  = pickStrike(chain, atmRow.strike, -2, 0.16, "PE", spot, T, q, atmSigma);
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
    outlook: "Moderately bullish — buy ATM call, finance by selling ~30Δ call above.",
    description: "Buy ATM call + sell ~30Δ OTM call (≈ +0.7σ). Defined risk, defined reward.",
    suitability: { ivContext: "ANY", biasFit: ["BULLISH"] },
    build: ({ chain, spot, T, q, atmRow, atmSigma }) => {
      // The short call must sit strictly above the ATM long; otherwise the
      // spread collapses to width=0 (or inverts).
      const upper = pickStrikeFartherOtm(chain, atmRow.strike, +2, 0.30, "CE", spot, T, q, atmSigma);
      if (!atmRow.ce || !upper?.ce) return { error: "Spread strikes not both quoted" };
      if (upper.strike <= atmRow.strike) return { error: "Chain too thin — no OTM call above ATM" };
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
    outlook: "Moderately bearish — buy ATM put, finance by selling ~30Δ put below.",
    description: "Buy ATM put + sell ~30Δ OTM put (≈ −0.7σ). Defined risk, defined reward.",
    suitability: { ivContext: "ANY", biasFit: ["BEARISH"] },
    build: ({ chain, spot, T, q, atmRow, atmSigma }) => {
      // The short put must sit strictly below the ATM long.
      const lower = pickStrikeFartherOtm(chain, atmRow.strike, -2, 0.30, "PE", spot, T, q, atmSigma);
      if (!atmRow.pe || !lower?.pe) return { error: "Spread strikes not both quoted" };
      if (lower.strike >= atmRow.strike) return { error: "Chain too thin — no OTM put below ATM" };
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
    outlook: "Moderately bullish — sell ~30Δ put for credit, buy ~15Δ wing for protection.",
    description: "Sell ~30Δ OTM put + buy ~15Δ OTM put. Defined risk, max profit = net credit.",
    suitability: { ivContext: "HIGH", biasFit: ["BULLISH"] },
    build: ({ chain, spot, T, q, atmRow, atmSigma }) => {
      const shortR = pickStrike(chain, atmRow.strike, -2, 0.30, "PE", spot, T, q, atmSigma);
      if (!shortR?.pe) return { error: "Short put leg not quoted" };
      // Long wing must be strictly farther OTM than the short — anchor on
      // shortR so the picker can never collide / invert.
      const longR  = pickStrikeFartherOtm(chain, shortR.strike, -1, 0.15, "PE", spot, T, q, atmSigma);
      if (!longR?.pe) return { error: "Long protective wing unavailable on chain" };
      if (longR.strike >= shortR.strike) return { error: "Chain too thin to seat protective put below short" };
      const short = buildLeg({ row: shortR, side: shortR.pe, type: "PE" }, "SELL", 1, spot, T, q);
      const long  = buildLeg({ row: longR,  side: longR.pe,  type: "PE" }, "BUY",  1, spot, T, q);
      if (!short || !long) return { error: "Cannot price spread legs" };
      return { legs: [short, long] };
    },
  },
  {
    kind: "BEAR_CALL_SPREAD",
    name: "Bear Call Spread",
    category: "CREDIT",
    outlook: "Moderately bearish — sell ~30Δ call for credit, buy ~15Δ wing for protection.",
    description: "Sell ~30Δ OTM call + buy ~15Δ OTM call. Defined risk, max profit = net credit.",
    suitability: { ivContext: "HIGH", biasFit: ["BEARISH"] },
    build: ({ chain, spot, T, q, atmRow, atmSigma }) => {
      const shortR = pickStrike(chain, atmRow.strike, +2, 0.30, "CE", spot, T, q, atmSigma);
      if (!shortR?.ce) return { error: "Short call leg not quoted" };
      const longR  = pickStrikeFartherOtm(chain, shortR.strike, +1, 0.15, "CE", spot, T, q, atmSigma);
      if (!longR?.ce) return { error: "Long protective wing unavailable on chain" };
      if (longR.strike <= shortR.strike) return { error: "Chain too thin to seat protective call above short" };
      const short = buildLeg({ row: shortR, side: shortR.ce, type: "CE" }, "SELL", 1, spot, T, q);
      const long  = buildLeg({ row: longR,  side: longR.ce,  type: "CE" }, "BUY",  1, spot, T, q);
      if (!short || !long) return { error: "Cannot price spread legs" };
      return { legs: [short, long] };
    },
  },
  {
    kind: "IRON_CONDOR",
    name: "Iron Condor",
    category: "CREDIT",
    outlook: "Range-bound — sell ~18Δ wings, buy further OTM ~7Δ guards for defined risk.",
    description: "Sell ~18Δ put & call + buy ~7Δ wings. Profits if spot pins inside the short strikes.",
    suitability: { ivContext: "HIGH", biasFit: ["NEUTRAL"] },
    build: ({ chain, spot, T, q, atmRow, atmSigma }) => {
      // Step 1: pick the short wings by delta.
      const shortPutR  = pickStrike(chain, atmRow.strike, -2, 0.18, "PE", spot, T, q, atmSigma);
      const shortCallR = pickStrike(chain, atmRow.strike, +2, 0.18, "CE", spot, T, q, atmSigma);
      if (!shortPutR?.pe || !shortCallR?.ce) return { error: "Condor short wings not quoted" };
      // Step 2: anchor the protective long wings *off the short wings*, not
      // off ATM, so the long is always strictly farther OTM than its short.
      const longPutR   = pickStrikeFartherOtm(chain, shortPutR.strike,  -1, 0.07, "PE", spot, T, q, atmSigma);
      const longCallR  = pickStrikeFartherOtm(chain, shortCallR.strike, +1, 0.07, "CE", spot, T, q, atmSigma);
      if (!longPutR?.pe || !longCallR?.ce) return { error: "Condor protective wings unavailable on chain" };
      if (shortPutR.strike <= longPutR.strike || shortCallR.strike >= longCallR.strike) {
        return { error: "Chain too thin to construct distinct condor wings" };
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
    description: "Sell ATM call + ATM put + buy ~10Δ OTM wings. Maximum credit, tightest profit zone.",
    suitability: { ivContext: "HIGH", biasFit: ["NEUTRAL"] },
    build: ({ chain, spot, T, q, atmRow, atmSigma }) => {
      // Wider wings than condor's longs (~10Δ) since the short legs are now
      // ATM (50Δ) — keeps net debit on the wings sane while protecting tail.
      // Anchor wings off the ATM strike so they can never collapse onto ATM.
      const longPutR  = pickStrikeFartherOtm(chain, atmRow.strike, -2, 0.10, "PE", spot, T, q, atmSigma);
      const longCallR = pickStrikeFartherOtm(chain, atmRow.strike, +2, 0.10, "CE", spot, T, q, atmSigma);
      if (!atmRow.ce || !atmRow.pe || !longPutR?.pe || !longCallR?.ce) {
        return { error: "Butterfly wings not all quoted" };
      }
      // Belt-and-braces — reject if either wing somehow landed on ATM (e.g.
      // chain only has the ATM strike quoted on one side).
      if (longPutR.strike >= atmRow.strike || longCallR.strike <= atmRow.strike) {
        return { error: "Chain too thin to seat butterfly wings outside ATM" };
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
    outlook: "Own the underlying, sell ~30Δ upside call for income while keeping participation.",
    description: "Long 1 lot of stock + short ~30Δ OTM call. Reduces basis, caps upside above strike.",
    suitability: { ivContext: "ANY", biasFit: ["NEUTRAL", "BULLISH"] },
    build: ({ chain, spot, T, q, atmRow, atmSigma }) => {
      // Indices (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/NIFTYNXT50/SENSEX) are
      // cash-settled — there is no deliverable "share" you can buy and hold.
      // The classic Covered Call (long stock + short OTM call) is meaningless
      // for an index, so we surface it as unavailable instead of synthesizing
      // a fake "buy NIFTY at spot" leg (which made Max Loss = full underlying
      // value, e.g. -₹15.4L on NIFTY for a +₹16k premium — a non-trade).
      if (chain.kind === "INDEX") {
        return { error: "Covered Call needs ownership of the underlying — indices are cash-settled, so this strategy doesn't apply. (Use a futures-based covered call separately if you want similar exposure.)" };
      }
      const otmCall = pickStrike(chain, atmRow.strike, +2, 0.30, "CE", spot, T, q, atmSigma);
      if (!otmCall?.ce) return { error: "OTM call leg not quoted" };
      const short = buildLeg({ row: otmCall, side: otmCall.ce, type: "CE" }, "SELL", 1, spot, T, q);
      if (!short) return { error: "Cannot price OTM call" };
      // Synthesize a "long stock" leg as a deep ITM call with strike=0, premium=spot.
      // (For payoff math, long stock at S₀ behaves identically: payoff = S_T - S₀.)
      // Liquidity fields marked nullable since "stock" isn't an option contract.
      const stockLeg: StrategyLeg = {
        action: "BUY", optionType: "CE", strike: 0, premium: spot,
        iv: 0, delta: 1, gamma: 0, vega: 0, theta: 0, qty: 1, source: "bs",
        bid: null, ask: null, spreadPct: null, oi: null, volume: null, quoted: true,
      };
      return { legs: [stockLeg, short] };
    },
  },
];

// ─── Public entry point ─────────────────────────────────────────────────────

export function buildStrategies(
  chain: OcResponse,
  analytics: OptionAnalytics,
  opts?: {
    /** Live intraday-derived bias for the underlying. Pass `null` (or omit)
     *  when intraday isn't available — the engine then falls through to
     *  structural bias only. */
    liveBias?: LiveBiasSnapshot | null;
    /** Equity-session state. Defaults to "closed" when omitted, which
     *  conservatively suppresses unbounded-loss naked-credit plays. */
    marketStatus?: MarketStatus;
  },
): StrategyBundle {
  const spot = chain.spot;
  const lotSize = chain.lotSize ?? 1;
  const T = yearsToExpiry(chain.expiry);
  // Equities pay dividends; indices don't. We don't have per-stock dividend yield
  // here without another fetch — assume 0 (close to truth for short-dated options).
  const q = 0;

  const atmRow = chain.rows.find(r => r.strike === chain.atmStrike)
    ?? nearestRow(chain.rows, spot)
    ?? chain.rows[0];

  // ── IV regime ────────────────────────────────────────────────────────
  // Per-kind absolute thresholds matter: NIFTY ATM IV typically prints
  // 11–18%, while a single-stock F&O like RELIANCE prints 25–45%. A flat
  // 12/25 cutoff (the old code) classifies almost every index reading as
  // UNKNOWN — which then disqualifies 10 of 13 strategy templates from
  // ever surfacing in the Recommended section.
  let ivContext: "LOW" | "HIGH" | "UNKNOWN" = "UNKNOWN";
  let ivRegimeReason = "ATM IV unavailable on this chain — IV regime classified as UNKNOWN.";
  if (analytics.ivPercentile != null) {
    if (analytics.ivPercentile >= 70) {
      ivContext = "HIGH";
      ivRegimeReason = `IV percentile ${analytics.ivPercentile} is in the top 30% of recent history — premium is rich.`;
    } else if (analytics.ivPercentile <= 30) {
      ivContext = "LOW";
      ivRegimeReason = `IV percentile ${analytics.ivPercentile} is in the bottom 30% of recent history — premium is cheap.`;
    } else {
      ivRegimeReason = `IV percentile ${analytics.ivPercentile} is in the middle range — no edge from selling or buying vol.`;
    }
  } else if (analytics.atmIv != null) {
    const isIndex = chain.kind === "INDEX";
    const hi = isIndex ? 18 : 35;
    const lo = isIndex ? 11 : 20;
    const kindLabel = isIndex ? "index" : "equity";
    if (analytics.atmIv >= hi) {
      ivContext = "HIGH";
      ivRegimeReason = `ATM IV ${analytics.atmIv.toFixed(1)}% is above the ${hi}% ${kindLabel} threshold — premium-selling has positive edge.`;
    } else if (analytics.atmIv <= lo) {
      ivContext = "LOW";
      ivRegimeReason = `ATM IV ${analytics.atmIv.toFixed(1)}% is below the ${lo}% ${kindLabel} threshold — debit plays are cheap.`;
    } else {
      ivRegimeReason = `ATM IV ${analytics.atmIv.toFixed(1)}% sits between the ${lo}% and ${hi}% ${kindLabel} thresholds — neutral vol regime.`;
    }
  }

  // ── Blend live + structural bias ─────────────────────────────────────
  // The structural bias from PCR + max-pain reflects accumulated option
  // positioning (often carry-over from previous sessions). The live bias
  // from VWAP/EMA9/EMA21/RSI on the underlying reflects the *current*
  // intraday read. Recommendations should reflect both:
  //   - both agree                 → use that bias (high conviction)
  //   - live NEUTRAL, structural X → use X (no live signal to flip)
  //   - structural NEUTRAL, live X → use X (live takes over)
  //   - they disagree              → NEUTRAL (transition / mixed signals)
  const structuralBias = analytics.bias;
  const liveBias = opts?.liveBias ?? null;
  let blendedBias: OptionAnalytics["bias"];
  let biasReason: string;
  if (liveBias) {
    if (liveBias.bias === structuralBias) {
      blendedBias = structuralBias;
      biasReason = `Live price action and option positioning both ${blendedBias.toLowerCase()} (${liveBias.reason}).`;
    } else if (liveBias.bias === "NEUTRAL") {
      blendedBias = structuralBias;
      biasReason = `Option positioning ${structuralBias.toLowerCase()}; live price action mixed (${liveBias.reason}).`;
    } else if (structuralBias === "NEUTRAL") {
      blendedBias = liveBias.bias;
      biasReason = `Live price action ${liveBias.bias.toLowerCase()} (${liveBias.reason}); option positioning balanced.`;
    } else {
      blendedBias = "NEUTRAL";
      biasReason = `Live price action ${liveBias.bias.toLowerCase()} (${liveBias.reason}) disagrees with ${structuralBias.toLowerCase()} option positioning — treat as transitional.`;
    }
  } else {
    blendedBias = structuralBias;
    biasReason = `Live intraday data unavailable — using option-positioning bias only (${structuralBias.toLowerCase()}).`;
  }

  const marketStatus: MarketStatus = opts?.marketStatus ?? "closed";

  const atmSigma = analytics.atmIv != null ? analytics.atmIv / 100 : 0.18;

  const ctx: BuildContext = { chain, spot, T, q, lotSize, atmRow, ivContext, bias: blendedBias, atmSigma };

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
    const buildResult = buildPayoff(legs, spot, lotSize, expectedMove2Sigma);
    const { payoff, displayMaxProfit, displayMaxLoss, breakevens } = buildResult;
    let { maxProfit, maxLoss } = buildResult;

    // ── LONG_PUT-specific trader-convention override. Mathematically the
    // Long Put payoff at S=0 is bounded at (strike − premium) × lot — a huge
    // but finite number — because the underlying can't go negative, so the
    // analytic slope-at-infinity classifier in buildPayoff (slopeAtInf=0,
    // flat tail) correctly reports a bounded maxProfit. But every options
    // textbook describes a long put the way the user did: "you pay premium,
    // that's the worst case; the profit grows as the underlying moves your
    // way." LONG_CALL is already null because its slope at S→∞ is positive;
    // LONG_STRADDLE / LONG_STRANGLE are already null thanks to their call
    // leg. Only LONG_PUT trips this presentation mismatch. Force null so the
    // headline prints "Unbounded" symmetrically with Long Call. The realistic
    // 2σ display value (`displayMaxProfit`) and `displayRrRatio` are left
    // untouched and continue to drive the chart, R:R sub-line, EV, and
    // capital math; rrRatio falls to null exactly the way Long Call's does.
    if (tpl.kind === "LONG_PUT") {
      maxProfit = null;
    }
    const dist = distributionalMetrics(legs, lotSize, spot, T, atmSigma, RISK_FREE, q);
    const { edges: legEdges, netEdge: netEdgeRaw } = computeLegEdges(legs, spot, T, atmSigma, RISK_FREE, q);
    const netEdge = +(netEdgeRaw * lotSize).toFixed(2);

    const marginRequired = estimateMargin(debit, maxLoss, spot, lotSize, chain.kind);
    const recommended = isRecommended(tpl, ivContext, blendedBias, marketStatus);
    const rationale = recommended
      ? buildRationale(tpl, ivContext, blendedBias, liveBias, marketStatus, ivRegimeReason)
      : undefined;

    // ── Execution-quality + characteristic IV + short-leg liquidity ─────
    const legQuality = classifyLegQuality(legs);
    const optLegs = legs.filter(l => l.strike > 0);
    const avgLegIv = optLegs.length
      ? +(optLegs.reduce((acc, l) => acc + l.iv, 0) / optLegs.length).toFixed(4)
      : 0;
    const shortLegs = optLegs.filter(l => l.action === "SELL");
    const shortLegOiVals = shortLegs.map(l => l.oi).filter((v): v is number => v != null && v > 0);
    const shortLegOi = shortLegOiVals.length
      ? Math.min(...shortLegOiVals)   // bottleneck on the thinnest short leg
      : null;

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
      legQuality,
      avgLegIv,
      shortLegOi,
    });
  }

  return {
    underlying: chain.underlying,
    spot,
    expiry: chain.expiry,
    daysToExpiry: Math.max(0, Math.round(T * 365)),
    ivContext,
    bias: blendedBias,
    structuralBias,
    liveBias,
    blendedBias,
    biasReason,
    ivRegimeReason,
    marketStatus,
    strategies: out,
    unavailable,
    generatedAt: new Date().toISOString(),
  };
}

function isRecommended(
  tpl: Template,
  ivContext: "LOW" | "HIGH" | "UNKNOWN",
  bias: OptionAnalytics["bias"],
  marketStatus: MarketStatus,
): boolean {
  // ── Bias hard gate ──────────────────────────────────────────────────
  // No point recommending a bullish play when the live blended read is
  // bearish (or vice versa). NEUTRAL bias matches NEUTRAL templates only.
  if (!tpl.suitability.biasFit.includes(bias)) return false;

  // ── Market-status guard ────────────────────────────────────────────
  // Naked-credit strategies have unbounded loss and require active
  // intraday management. When the session is closed (or pre-open), do
  // NOT recommend them — a pre-open gap on a leveraged short straddle
  // can blow up capital before you can even see the move. Defined-risk
  // credit spreads (Iron Condor / Iron Butterfly / verticals) survive
  // gaps because the long wing caps the loss, so they remain eligible.
  if (marketStatus !== "open" && (tpl.kind === "SHORT_STRADDLE" || tpl.kind === "SHORT_STRANGLE")) {
    return false;
  }

  // ── IV regime gate (with soft-fallback for UNKNOWN) ────────────────
  if (tpl.suitability.ivContext === "ANY") return true;
  if (ivContext === "UNKNOWN") {
    // Soft fallback: when we genuinely can't read the IV regime, still
    // surface the bias-aligned plan so the Recommended section is never
    // empty under a clear directional bias. The rationale string makes
    // the IV uncertainty explicit so the user knows it's a softer pick.
    // Naked-credit unbounded plays are excluded from the soft-fallback
    // because their edge depends entirely on selling rich vol — without
    // any IV read at all the trade has no thesis.
    return tpl.kind !== "SHORT_STRADDLE" && tpl.kind !== "SHORT_STRANGLE";
  }
  return tpl.suitability.ivContext === ivContext;
}

function buildRationale(
  tpl: Template,
  ivContext: "LOW" | "HIGH" | "UNKNOWN",
  bias: OptionAnalytics["bias"],
  liveBias: LiveBiasSnapshot | null,
  marketStatus: MarketStatus,
  ivRegimeReason: string,
): string {
  const parts: string[] = [];

  // 1. Live read first — that's what the user wants to see ("am I in
  //    the right side of today's tape?").
  if (liveBias) {
    const liveTag = liveBias.bias === "NEUTRAL" ? "Live mixed" : `Live ${liveBias.bias.toLowerCase()}`;
    parts.push(`${liveTag} (${liveBias.reason}).`);
  }

  // 2. IV-context narrative tuned to the template's suitability + the
  //    actual regime. Surfaces the soft-fallback explicitly.
  if (tpl.suitability.ivContext === "LOW") {
    if (ivContext === "LOW") {
      parts.push("IV is compressed — debit construction is cheap.");
    } else if (ivContext === "UNKNOWN") {
      parts.push("IV regime unclear — debit construction is the safer pick when bias is clear.");
    } else {
      parts.push("IV is elevated — debit is more expensive than ideal but bias still aligns.");
    }
  } else if (tpl.suitability.ivContext === "HIGH") {
    if (ivContext === "HIGH") {
      parts.push("IV is elevated — premium-selling has positive edge.");
    } else if (ivContext === "UNKNOWN") {
      parts.push("IV regime unclear — defined-risk credit play is a measured bet on stillness.");
    } else {
      parts.push("IV is compressed — credit narrower but bias still aligns.");
    }
  } else {
    parts.push("Works across IV regimes.");
  }

  // 3. Market-status nudge so user knows whether to act now or wait.
  if (marketStatus === "closed") {
    parts.push("Market closed — recommendation reflects last available data; entry deferred to next session open.");
  } else if (marketStatus === "pre_open") {
    parts.push("Pre-open session — recommendation reflects pre-market positioning; entry at 09:15 IST open.");
  }

  // Append the IV regime reason as the closing context line so the
  // user can see exactly why the IV regime was classified the way it was.
  parts.push(ivRegimeReason);

  return parts.join(" ");
}

// ─── Custom (free-form) strategy builder ────────────────────────────────────
// Reuses *every* helper above (buildPayoff, distributionalMetrics,
// computeLegEdges, estimateMargin, classifyLegQuality, netGreeks, netDebit).
// No math is duplicated — the only new logic is leg resolution from a
// user-supplied spec and the scenario re-pricer.

export interface CustomLegSpec {
  /** Strike price, must exist as an OcRow in the chain. */
  strike: number;
  optionType: OptionType;
  action: "BUY" | "SELL";
  /** Number of lots (positive). Each lot = chain.lotSize contracts. */
  lots: number;
  /** Override mid/LTP from chain (₹/share). When null/undefined, use chain. */
  premiumOverride?: number | null;
  /** Override IV (decimal, e.g. 0.18). When null/undefined, use chain or BS solve. */
  ivOverride?: number | null;
}

export interface CustomScenario {
  /** % move in spot (e.g. -5 → spot drops 5%). */
  spotShiftPct: number;
  /** % shift in IV applied to every leg (e.g. -10 → IV cut by 10% relative). */
  ivShiftPct: number;
  /** Calendar days that have passed (reduces T). */
  daysPassed: number;
}

export interface ScenarioLegResult {
  strike: number;
  optionType: OptionType;
  action: "BUY" | "SELL";
  /** Theoretical mid-price under the shifted conditions (₹/share). */
  newPrice: number;
  /** Per-share MTM change vs. entry premium (signed by action). */
  mtmPerShare: number;
  /** Total MTM change = mtmPerShare × lots × lotSize (₹). */
  mtmTotal: number;
}

export interface ScenarioResult {
  spotShiftPct: number;
  ivShiftPct: number;
  daysPassed: number;
  /** Spot under the shift. */
  newSpot: number;
  /** Years to expiry remaining after the shift. */
  newT: number;
  /** Total MTM ₹ (sum of leg results). */
  totalPnl: number;
  legs: ScenarioLegResult[];
}

export interface CustomStrategyResponse {
  underlying: string;
  spot: number;
  expiry: string;
  daysToExpiry: number;
  lotSize: number;
  ivContext: "LOW" | "HIGH" | "UNKNOWN";
  /** The composed snapshot for the user's legs. */
  snapshot: CustomStrategySnapshot;
  /** Scenario re-prices, in the same order as the request. */
  scenarios: ScenarioResult[];
  /** Soft warnings — e.g. unknown IV → BS solver couldn't run, no scenario. */
  warnings: string[];
  generatedAt: string;
}

/** Snapshot for a custom strategy. Same shape as `StrategySnapshot` minus
 *  `kind`/`name`/`category`/`outlook`/`description`/`suitability`/`recommended`/
 *  `rationale` (which only make sense for the named templates). */
export interface CustomStrategySnapshot {
  legs: StrategyLeg[];
  netDebit: number;
  netGreeks: { delta: number; gamma: number; vega: number; theta: number };
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[];
  payoff: PayoffPoint[];
  pop: number | null;
  rrRatio: number | null;
  displayMaxProfit: number;
  displayMaxLoss: number;
  displayRrRatio: number | null;
  dist: DistMetrics;
  legEdges: LegEdge[];
  netEdge: number;
  marginRequired: number;
  returnOnCapital: number | null;
  lotSize: number;
  perLot: {
    maxProfit: number | null;
    maxLoss: number | null;
    netDebit: number;
    displayMaxProfit: number;
    displayMaxLoss: number;
  };
  legQuality: "TIGHT" | "WIDE" | "POOR";
  avgLegIv: number;
  shortLegOi: number | null;
}

/** Builds a single StrategySnapshot for an arbitrary user-supplied list of legs.
 *  Rejects with `{ error: string }` when validation fails so the route can
 *  return a structured 400. Successful return is `{ ok: true, response }`. */
export function buildCustomStrategy(
  chain: OcResponse,
  analytics: OptionAnalytics,
  legSpecs: CustomLegSpec[],
  opts?: { scenarios?: CustomScenario[] },
): { ok: true; response: CustomStrategyResponse } | { ok: false; error: string } {
  if (!Array.isArray(legSpecs) || legSpecs.length === 0) {
    return { ok: false, error: "At least one leg is required." };
  }
  if (legSpecs.length > 8) {
    return { ok: false, error: "Maximum 8 legs supported." };
  }

  const spot = chain.spot;
  const lotSize = chain.lotSize ?? 1;
  const T = yearsToExpiry(chain.expiry);
  const q = 0;

  // IV regime — same logic as buildStrategies (extracted-of-band so the UI
  // can render the regime badge without a second call).
  let ivContext: "LOW" | "HIGH" | "UNKNOWN" = "UNKNOWN";
  if (analytics.ivPercentile != null) {
    if (analytics.ivPercentile >= 70) ivContext = "HIGH";
    else if (analytics.ivPercentile <= 30) ivContext = "LOW";
  } else if (analytics.atmIv != null) {
    const isIndex = chain.kind === "INDEX";
    const hi = isIndex ? 18 : 35;
    const lo = isIndex ? 11 : 20;
    if (analytics.atmIv >= hi) ivContext = "HIGH";
    else if (analytics.atmIv <= lo) ivContext = "LOW";
  }

  const atmSigma = analytics.atmIv != null ? analytics.atmIv / 100 : 0.18;
  const warnings: string[] = [];

  // ── Resolve each leg spec to a StrategyLeg ────────────────────────────
  const legs: StrategyLeg[] = [];
  for (let i = 0; i < legSpecs.length; i++) {
    const spec = legSpecs[i];
    const lots = Math.floor(Number(spec.lots));
    if (!Number.isFinite(lots) || lots <= 0) {
      return { ok: false, error: `Leg ${i + 1}: lots must be a positive integer.` };
    }
    if (spec.action !== "BUY" && spec.action !== "SELL") {
      return { ok: false, error: `Leg ${i + 1}: action must be BUY or SELL.` };
    }
    if (spec.optionType !== "CE" && spec.optionType !== "PE") {
      return { ok: false, error: `Leg ${i + 1}: optionType must be CE or PE.` };
    }
    const row = chain.rows.find(r => r.strike === spec.strike);
    if (!row) {
      return { ok: false, error: `Leg ${i + 1}: strike ${spec.strike} not found in chain.` };
    }
    const side = spec.optionType === "CE" ? row.ce : row.pe;
    if (!side) {
      return { ok: false, error: `Leg ${i + 1}: no ${spec.optionType} quote at strike ${spec.strike}.` };
    }

    // Premium: override → midOrLtp → reject
    let premium: number | null = null;
    if (spec.premiumOverride != null && Number.isFinite(spec.premiumOverride) && spec.premiumOverride > 0) {
      premium = +Number(spec.premiumOverride).toFixed(2);
    } else {
      premium = midOrLtp(side);
    }
    if (premium == null) {
      return { ok: false, error: `Leg ${i + 1}: no tradeable premium at ${spec.optionType} ${spec.strike}. Provide a manual premium override.` };
    }

    // IV: override → chain → BS solve. If all fail, leg is unusable for Greeks/scenario.
    let iv: number | null = null;
    if (spec.ivOverride != null && Number.isFinite(spec.ivOverride) && spec.ivOverride > 0) {
      iv = +Number(spec.ivOverride).toFixed(4);
    } else if (side.iv != null && side.iv > 0) {
      iv = side.iv / 100;
    } else {
      iv = impliedVolatility({
        S: spot, K: spec.strike, T, r: RISK_FREE, q,
        type: spec.optionType, marketPrice: premium,
      });
    }
    if (iv == null || !(iv > 0)) {
      return { ok: false, error: `Leg ${i + 1}: could not derive IV at ${spec.optionType} ${spec.strike}. Provide a manual IV override.` };
    }

    const greeks = priceAndGreeks({
      S: spot, K: spec.strike, T, r: RISK_FREE, q, sigma: iv, type: spec.optionType,
    });
    const liq = legLiquidity(side);

    legs.push({
      action: spec.action,
      optionType: spec.optionType,
      strike: spec.strike,
      premium,
      iv,
      delta: greeks.delta,
      gamma: greeks.gamma,
      vega: greeks.vega,
      theta: greeks.theta,
      qty: lots,
      source: spec.ivOverride != null || side.iv != null ? "chain" : "bs",
      bid: liq.bid,
      ask: liq.ask,
      spreadPct: liq.spreadPct,
      oi: liq.oi,
      volume: liq.volume,
      quoted: liq.quoted,
    });
  }

  // ── Compose the snapshot using the SAME pipeline as buildStrategies ───
  const debit = +netDebit(legs).toFixed(2);
  const greeksAgg = netGreeks(legs);
  const stdLnATM = Number.isFinite(atmSigma) && atmSigma > 0 && T > 0 ? atmSigma * Math.sqrt(T) : 0;
  const expectedMove2Sigma = spot > 0 ? spot * 2 * stdLnATM : 0;
  const buildResult = buildPayoff(legs, spot, lotSize, expectedMove2Sigma);
  const { payoff, displayMaxProfit, displayMaxLoss, breakevens, maxProfit, maxLoss } = buildResult;
  const dist = distributionalMetrics(legs, lotSize, spot, T, atmSigma, RISK_FREE, q);
  const { edges: legEdges, netEdge: netEdgeRaw } = computeLegEdges(legs, spot, T, atmSigma, RISK_FREE, q);
  const netEdge = +(netEdgeRaw * lotSize).toFixed(2);
  const marginRequired = estimateMargin(debit, maxLoss, spot, lotSize, chain.kind);
  const legQuality = classifyLegQuality(legs);

  const optLegs = legs.filter(l => l.strike > 0);
  const avgLegIv = optLegs.length
    ? +(optLegs.reduce((acc, l) => acc + l.iv, 0) / optLegs.length).toFixed(4)
    : 0;
  const shortLegOiVals = optLegs.filter(l => l.action === "SELL").map(l => l.oi).filter((v): v is number => v != null && v > 0);
  const shortLegOi = shortLegOiVals.length ? Math.min(...shortLegOiVals) : null;

  const displayRrRatio = displayMaxLoss < 0 && displayMaxProfit > 0
    ? +Math.abs(displayMaxProfit / displayMaxLoss).toFixed(3)
    : null;

  const safeDist: DistMetrics = dist ?? {
    expectedValue: 0, stdDev: 0, pop: 0, avgWin: 0, avgLoss: 0,
    probabilisticRr: null, expectedMove1Sigma: 0, expectedMove2Sigma: 0,
  };
  const returnOnCapital = marginRequired > 0
    ? +(safeDist.expectedValue / marginRequired).toFixed(4)
    : null;

  if (!dist) {
    warnings.push("Distributional metrics unavailable (no ATM IV) — POP and probabilistic R:R are placeholder zeros.");
  }

  const snapshot: CustomStrategySnapshot = {
    legs,
    netDebit: debit,
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
    legQuality,
    avgLegIv,
    shortLegOi,
  };

  // ── Scenarios ─────────────────────────────────────────────────────────
  const scenarios: ScenarioResult[] = [];
  for (const sc of (opts?.scenarios ?? [])) {
    scenarios.push(simulateScenario(legs, spot, T, sc, q, lotSize));
  }

  return {
    ok: true,
    response: {
      underlying: chain.underlying,
      spot,
      expiry: chain.expiry,
      daysToExpiry: Math.max(0, Math.round(T * 365)),
      lotSize,
      ivContext,
      snapshot,
      scenarios,
      warnings,
      generatedAt: new Date().toISOString(),
    },
  };
}

/** Re-prices each leg under (spotShiftPct, ivShiftPct, daysPassed) using
 *  Black-Scholes and sums the MTM change vs. entry premium. The payoff
 *  *at expiry* is unaffected by IV/T shifts (it's just intrinsic) — this
 *  function answers "what's my P&L *now* if I close the position at the
 *  shifted conditions?", which is what the user reads off the sliders. */
export function simulateScenario(
  legs: StrategyLeg[],
  baseSpot: number,
  baseT: number,
  scenario: CustomScenario,
  q: number,
  lotSize: number,
): ScenarioResult {
  const spotMul = 1 + (Number(scenario.spotShiftPct) || 0) / 100;
  const newSpot = +(baseSpot * spotMul).toFixed(2);
  const ivMul = 1 + (Number(scenario.ivShiftPct) || 0) / 100;
  const dayShift = (Number(scenario.daysPassed) || 0) / 365;
  // Floor T at 1 hour so BS doesn't degenerate to pure intrinsic when a
  // user drags the slider past expiry. The expiry-payoff curve already
  // covers that case in the chart.
  const newT = Math.max(baseT - dayShift, 1 / (365 * 24));

  const legResults: ScenarioLegResult[] = [];
  let totalPnl = 0;
  for (const leg of legs) {
    const newIv = Math.max(leg.iv * ivMul, 1e-4);
    const { price } = priceAndGreeks({
      S: newSpot, K: leg.strike, T: newT, r: RISK_FREE, q, sigma: newIv, type: leg.optionType,
    });
    const newPrice = +price.toFixed(2);
    const sign = leg.action === "BUY" ? 1 : -1;
    const mtmPerShare = +(sign * (newPrice - leg.premium)).toFixed(2);
    const mtmTotal = +(mtmPerShare * leg.qty * lotSize).toFixed(2);
    legResults.push({
      strike: leg.strike,
      optionType: leg.optionType,
      action: leg.action,
      newPrice,
      mtmPerShare,
      mtmTotal,
    });
    totalPnl += mtmTotal;
  }

  return {
    spotShiftPct: Number(scenario.spotShiftPct) || 0,
    ivShiftPct: Number(scenario.ivShiftPct) || 0,
    daysPassed: Number(scenario.daysPassed) || 0,
    newSpot,
    newT: +newT.toFixed(6),
    totalPnl: +totalPnl.toFixed(2),
    legs: legResults,
  };
}
