/**
 * Indicator history-sufficiency thresholds — Pack 33 Correction 2.
 *
 * Each value is the MINIMUM number of completed daily bars required for the
 * named indicator to produce a mathematically valid output (no NaN, no
 * start-up distortion from an under-warmed EMA/RSI seed).
 *
 * These are the MINIMUM inputs for correct computation. A well-warmed
 * indicator benefits from more history, but values below these thresholds
 * are definitionally corrupt or undefined.
 *
 * Binding constraint summary
 * ──────────────────────────
 *   EMA(200) requires exactly 200 bars. All other indicators used by the
 *   curated scanner have lower minimums. Therefore:
 *
 *     MIN_BARS_FOR_EVALUATION = 200  (EMA_200 binding constraint)
 *
 *   A row with barCount < 200 MUST return:
 *     signal     = "NOT_EVALUATED"
 *     score      = null
 *     confidence = null
 *     action     = null
 *     reason     = "INSUFFICIENT_CANONICAL_HISTORY"
 *
 *   The row may still be stored and display partial indicators
 *   (EMA20/50 where available) — storage is not gated on evaluation.
 */

export const INDICATOR_MIN_BARS = {
  /**
   * RSI(14): 14-bar period.
   * First valid value at index 14 (requires 14 completed bars plus 1 seed).
   * A common warm-up convention uses 2× period = 28 bars for the initial SMA
   * seed to stabilise. Scanner uses 14 strictly.
   */
  RSI_14: 14,

  /** EMA(9): 9-bar exponential moving average. */
  EMA_9: 9,

  /** EMA(20): 20-bar EMA. Used as fast trend filter. */
  EMA_20: 20,

  /** EMA(21): 21-bar EMA. Used alongside EMA(20) in some paths. */
  EMA_21: 21,

  /** EMA(50): 50-bar EMA. Intermediate-term trend anchor. */
  EMA_50: 50,

  /** EMA(100): 100-bar EMA. Medium-term trend filter. */
  EMA_100: 100,

  /**
   * EMA(200): 200-bar EMA.
   * This is the BINDING CONSTRAINT for full-indicator evaluation.
   * Requires 200 completed daily bars — approximately 10 months of trading.
   * All other indicators are available within this range.
   */
  EMA_200: 200,

  /**
   * MACD(12, 26, 9):
   *   slow EMA period = 26 bars
   *   signal EMA period = 9 bars, applied to the MACD line
   *   Minimum bars = 26 (slow) + 9 (signal warm-up) − 1 = 34
   */
  MACD_12_26_9: 34,

  /**
   * 52-week high/low: approximately 252 trading days (1 Indian market year).
   * Below this, the high/low field covers less than a complete annual range.
   * Note: the scanner stores and displays high/low with whatever history is
   * available — but a "52-week" label requires ≥ 252 bars to be accurate.
   */
  HIGH_LOW_52W: 252,

  /**
   * Volume baseline: minimum sessions for a statistically meaningful
   * average daily volume.
   */
  VOLUME_BASELINE: 20,
} as const;

export type IndicatorName = keyof typeof INDICATOR_MIN_BARS;

// ─── Public thresholds ────────────────────────────────────────────────────────

/**
 * MIN_BARS_FOR_STORAGE — minimum bars to warrant storing a row in kite_candle_store.
 *
 * Any positive bar history is worth persisting. It:
 *   - serves partial indicator display (EMA20/50 where available)
 *   - avoids re-downloading the same history on the next cycle
 *   - allows growth tracking (a new listing will reach 200 bars eventually)
 *
 * Rows with barCount < MIN_BARS_FOR_EVALUATION are always NOT_EVALUATED
 * (INSUFFICIENT_CANONICAL_HISTORY) but are still stored.
 */
export const MIN_BARS_FOR_STORAGE = 1;

/**
 * MIN_BARS_FOR_EVALUATION — minimum daily bars required for a row to be
 * evaluation-complete (signal, score, confidence, action all computed).
 *
 * Binding constraint: EMA(200) requires exactly 200 bars.
 *
 * Below this threshold, regardless of other data quality:
 *   signal     = "NOT_EVALUATED"
 *   score      = null
 *   confidence = null
 *   action     = null
 *   reason     = "INSUFFICIENT_CANONICAL_HISTORY"
 *
 * See also: INDICATOR_MIN_BARS for per-indicator details.
 */
export const MIN_BARS_FOR_EVALUATION: number = INDICATOR_MIN_BARS.EMA_200; // 200

/**
 * MIN_BARS_FOR_FULL_52W — minimum bars for an accurate 52-week high/low field.
 * Below this threshold, the range covers < 1 trading year. The field is still
 * populated with the available range; callers must note the truncation.
 */
export const MIN_BARS_FOR_FULL_52W: number = INDICATOR_MIN_BARS.HIGH_LOW_52W; // 252

// ─── Utility functions ────────────────────────────────────────────────────────

/**
 * Return whether a candle series has sufficient history for full indicator
 * evaluation (EMA200 binding constraint).
 *
 * Used by: scanner.ts, fullNseWarehouse.ts, and any other consumer
 * that needs to gate on evaluation completeness.
 */
export function hasEvaluationSufficientHistory(barCount: number): boolean {
  return Number.isFinite(barCount) && barCount >= MIN_BARS_FOR_EVALUATION;
}

/**
 * Return whether a candle series has at least partial indicator history.
 * (EMA20 + RSI14 — excludes EMA100/200.)
 */
export function hasPartialIndicatorHistory(barCount: number): boolean {
  return (
    Number.isFinite(barCount) &&
    barCount >= INDICATOR_MIN_BARS.EMA_20 &&
    barCount >= INDICATOR_MIN_BARS.RSI_14
  );
}

/**
 * Return which indicators are available for a given bar count.
 * Useful for UI "available indicators" display.
 */
export function availableIndicators(barCount: number): IndicatorName[] {
  if (!Number.isFinite(barCount) || barCount < 1) return [];
  return (Object.entries(INDICATOR_MIN_BARS) as [IndicatorName, number][])
    .filter(([, min]) => barCount >= min)
    .map(([name]) => name);
}

/**
 * Human-readable reason why a bar count is insufficient.
 * Returns null if evaluation-sufficient.
 */
export function insufficiencyReason(barCount: number): string | null {
  if (hasEvaluationSufficientHistory(barCount)) return null;
  const bindingIndicator = "EMA_200";
  const required = MIN_BARS_FOR_EVALUATION;
  const shortfall = required - barCount;
  return (
    `INSUFFICIENT_CANONICAL_HISTORY: ${barCount} bars available, ` +
    `${required} required for ${bindingIndicator} (${shortfall} bars short). ` +
    `~${Math.ceil(shortfall / 21)} trading months until evaluation-eligible.`
  );
}
