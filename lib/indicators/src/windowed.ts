/**
 * Pure, causal WINDOWED indicator primitives shared by the custom-strategy
 * evaluator (live F&O engine + Backtest Lab) so both surfaces derive structure
 * from identical math. Every function reads only indices ≤ the requested `i`
 * (no look-ahead) and is null-safe: a missing/NaN input yields a conservative
 * `false`/`null` result — it is NEVER assumed favourable.
 *
 * These are low-level building blocks (slope, cross, swing pivots, Fibonacci
 * geometry, distance). The strategy-specific interpretation (which side a block
 * favours, tolerances, layering) lives in the api-server evaluator, not here.
 */

export type SlopeDir = "rising" | "falling" | "flat";

function fin(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

/** Direction of a series over `lookback` bars ending at `i`. null if unavailable. */
export function slopeDir(
  series: readonly (number | null)[],
  i: number,
  lookback: number,
  flatEps = 0,
): SlopeDir | null {
  if (lookback < 1) return null;
  const j = i - lookback;
  if (j < 0) return null;
  const a = series[j];
  const b = series[i];
  if (!fin(a) || !fin(b)) return null;
  const d = b - a;
  if (Math.abs(d) <= flatEps) return "flat";
  return d > 0 ? "rising" : "falling";
}

/** `a` crosses strictly ABOVE `b` exactly at bar `i` (was ≤ at i-1, > at i). */
export function crossedUpAt(
  a: readonly (number | null)[],
  b: readonly (number | null)[],
  i: number,
): boolean {
  if (i < 1) return false;
  const a0 = a[i - 1];
  const b0 = b[i - 1];
  const a1 = a[i];
  const b1 = b[i];
  if (!fin(a0) || !fin(b0) || !fin(a1) || !fin(b1)) return false;
  return a0 <= b0 && a1 > b1;
}

/** `a` crosses strictly BELOW `b` exactly at bar `i` (was ≥ at i-1, < at i). */
export function crossedDownAt(
  a: readonly (number | null)[],
  b: readonly (number | null)[],
  i: number,
): boolean {
  if (i < 1) return false;
  const a0 = a[i - 1];
  const b0 = b[i - 1];
  const a1 = a[i];
  const b1 = b[i];
  if (!fin(a0) || !fin(b0) || !fin(a1) || !fin(b1)) return false;
  return a0 >= b0 && a1 < b1;
}

/** Signed percentage distance of `value` from `ref`: (value-ref)/|ref|*100. */
export function distancePct(value: number | null, ref: number | null): number | null {
  if (!fin(value) || !fin(ref) || ref === 0) return null;
  return ((value - ref) / Math.abs(ref)) * 100;
}

/** Whether `value` is within `tolPct` percent of `ref` (absolute). */
export function withinPct(
  value: number | null,
  ref: number | null,
  tolPct: number,
): boolean {
  const d = distancePct(value, ref);
  if (d == null) return false;
  return Math.abs(d) <= tolPct;
}

export interface ConfirmedSwings {
  highIdx: number | null;
  highPrice: number | null;
  lowIdx: number | null;
  lowPrice: number | null;
}

/**
 * Most recent CONFIRMED fractal swing high and swing low at or before bar `i`.
 *
 * A pivot at index k is a swing high when `highs[k]` is strictly greater than
 * the `span` bars on each side; symmetrically for swing lows. It is only
 * CONFIRMED once `span` bars have closed after it — i.e. it is eligible only
 * when `k <= i - span`. This is what makes the result non-repainting: a fresh
 * pivot cannot be claimed until the bars that confirm it actually exist.
 *
 * Scans back at most `maxLookback` bars from the confirmation horizon for speed.
 */
export function lastConfirmedSwings(
  highs: readonly number[],
  lows: readonly number[],
  i: number,
  span: number,
  maxLookback = 120,
): ConfirmedSwings {
  const out: ConfirmedSwings = { highIdx: null, highPrice: null, lowIdx: null, lowPrice: null };
  if (span < 1) return out;
  const horizon = i - span; // newest index that can be confirmed by bar i
  const floor = Math.max(span, horizon - maxLookback);
  for (let k = horizon; k >= floor; k--) {
    if (k - span < 0 || k + span >= highs.length) continue;
    if (out.highIdx == null && isSwingHigh(highs, k, span)) {
      out.highIdx = k;
      out.highPrice = highs[k]!;
    }
    if (out.lowIdx == null && isSwingLow(lows, k, span)) {
      out.lowIdx = k;
      out.lowPrice = lows[k]!;
    }
    if (out.highIdx != null && out.lowIdx != null) break;
  }
  return out;
}

function isSwingHigh(highs: readonly number[], k: number, span: number): boolean {
  const v = highs[k];
  if (!fin(v)) return false;
  for (let d = 1; d <= span; d++) {
    const a = highs[k - d];
    const b = highs[k + d];
    if (!fin(a) || !fin(b)) return false;
    if (!(v > a) || !(v > b)) return false;
  }
  return true;
}

function isSwingLow(lows: readonly number[], k: number, span: number): boolean {
  const v = lows[k];
  if (!fin(v)) return false;
  for (let d = 1; d <= span; d++) {
    const a = lows[k - d];
    const b = lows[k + d];
    if (!fin(a) || !fin(b)) return false;
    if (!(v < a) || !(v < b)) return false;
  }
  return true;
}

/** Canonical Fibonacci ratios used for retracement zones and extension targets. */
export const FIB_RETRACE_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786] as const;
export const FIB_EXTENSION_RATIOS = [1.272, 1.618, 2.0] as const;
export type FibRatio = number;

/**
 * Price of a Fibonacci RETRACEMENT level given the dominant swing.
 *  - `dir="up"`   : impulse low→high; a retracement of `ratio` sits at
 *                   high - ratio*(high-low) (price pulling back down).
 *  - `dir="down"` : impulse high→low; a retracement of `ratio` sits at
 *                   low + ratio*(high-low) (price pulling back up).
 */
export function fibRetracePrice(
  high: number | null,
  low: number | null,
  ratio: FibRatio,
  dir: "up" | "down",
): number | null {
  if (!fin(high) || !fin(low) || high <= low) return null;
  const range = high - low;
  return dir === "up" ? high - ratio * range : low + ratio * range;
}

/**
 * Price of a Fibonacci EXTENSION target (ratio ≥ 1) measured from the swing.
 *  - `dir="up"`   : projection above the high  → low + ratio*(high-low).
 *  - `dir="down"` : projection below the low    → high - ratio*(high-low).
 */
export function fibExtensionPrice(
  high: number | null,
  low: number | null,
  ratio: FibRatio,
  dir: "up" | "down",
): number | null {
  if (!fin(high) || !fin(low) || high <= low) return null;
  const range = high - low;
  return dir === "up" ? low + ratio * range : high - ratio * range;
}
