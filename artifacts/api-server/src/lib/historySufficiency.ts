/**
 * Indicator history-sufficiency thresholds — Pack 33 Corrections 1 & 2.
 *
 * Each value is the MINIMUM number of completed daily price observations (bars)
 * required for the named indicator to produce a mathematically valid, non-null
 * output with no NaN, no start-up distortion from an under-warmed EMA/RSI seed.
 *
 * Implementation boundaries are derived from the ACTUAL production functions:
 *
 *   ema(values, period):
 *     • Returns all-null when values.length < period.
 *     • First valid value at index period − 1.
 *     • Minimum price observations = period.
 *
 *   rsi(values, period=14):
 *     • Returns all-null when values.length < period + 1.
 *     • First valid value at index period.
 *     • Minimum price observations = period + 1 = 15.
 *     • RSI works on CHANGES (deltas), not prices: period changes = period + 1 prices.
 *     • Off-by-one risk: 14 prices → 0 valid values; 15 prices → first valid RSI(14).
 *
 *   macd(values, fast=12, slow=26, signalP=9):
 *     • EMA(26) first valid at index 25 (needs 26 bars).
 *     • MACD line first valid at index 25.
 *     • Signal EMA(9) applied to MACD from startIdx=25; first valid at index 25+8=33.
 *     • Histogram first valid at index 33 → minimum 34 price observations.
 *
 * Binding constraint summary
 * ──────────────────────────
 *   52-week high/low is MANDATORY for the curated scanner (it drives the
 *   "near 52W high" bullish confirmation and the annual-range display).
 *   HIGH_LOW_52W = 252 is the binding constraint for evaluation.
 *
 *   A row with 200–251 completed bars:
 *     • Has a valid EMA(200), RSI(14), MACD.
 *     • DOES NOT have a reliable 52-week range (< 1 full trading year).
 *     • MUST remain NOT_EVALUATED: signal=NOT_EVALUATED, score=null,
 *       confidence=null, reason=INSUFFICIENT_CANONICAL_HISTORY.
 *
 *   Only rows with barCount ≥ 252 (allMandatoryInputsReady=true) are
 *   evaluation-eligible when Phase B is authorized.
 *
 * Calendar range required
 * ───────────────────────
 *   252 trading sessions ≈ 353 calendar days (5/7 ratio + ~15 Indian holidays).
 *   WAREHOUSE_HISTORY_DAYS = 400 calendar days → ~276 trading days → ≥ 252 ✓
 *   Buffer: ~24 extra trading days. Sufficient even if last bar is today's
 *   incomplete session (which the Kite daily historical API excludes when
 *   requested during market hours; but the buffer covers any edge case).
 */

export const INDICATOR_MIN_BARS = {
  /**
   * RSI(14): Wilder's RSI implementation.
   * Returns all-null when values.length < period + 1.
   * First valid RSI at index 14 → requires 15 price points (14 changes).
   *
   * Off-by-one note: 14 price points → 13 changes → first seed is impossible
   * (needs 14 changes). 15 price points → 14 changes → first valid RSI(14).
   *
   * Implementation: `if (values.length < period + 1) return all-null`
   */
  RSI_14: 15,

  /** EMA(9): 9-bar EMA. First valid at index 8. Min 9 bars. */
  EMA_9: 9,

  /** EMA(20): 20-bar EMA. First valid at index 19. Min 20 bars. */
  EMA_20: 20,

  /** EMA(21): 21-bar EMA. First valid at index 20. Min 21 bars. */
  EMA_21: 21,

  /** EMA(50): 50-bar EMA. First valid at index 49. Min 50 bars. */
  EMA_50: 50,

  /** EMA(100): 100-bar EMA. First valid at index 99. Min 100 bars. */
  EMA_100: 100,

  /**
   * EMA(200): 200-bar EMA. First valid at index 199. Min 200 bars.
   * Implementation: `if (values.length < period) return all-null`
   * NOT the binding constraint — HIGH_LOW_52W (252) is.
   */
  EMA_200: 200,

  /**
   * MACD(12, 26, 9):
   *   slow EMA(26): first valid at index 25 (26 bars)
   *   MACD line: first valid at index 25
   *   Signal EMA(9) of MACD from startIdx=25: first valid at 25+8=33
   *   Histogram first non-null at index 33 → 34 bars required.
   *
   * Verified against actual implementation in indicators.ts:
   *   const startIdx = macdLine.findIndex(v => v !== null);   // = 25
   *   const sigSeed = ema(macdLine.slice(startIdx).map(...), 9);
   *   // ema(9 values, 9) → first valid at index 8 → mapped back to sigLine[33]
   */
  MACD_12_26_9: 34,

  /**
   * 52-week high/low: BINDING CONSTRAINT for full evaluation.
   * Requires ≥ 252 completed trading sessions (1 Indian market year ≈ 252 days).
   * Below this threshold, yearRange and yrHi/yrLo cover < 1 trading year:
   * the "near 52W high" bullish confirmation rule is unreliable.
   *
   * A row with < 252 completed bars MUST NOT be evaluated (score=null,
   * signal=NOT_EVALUATED, reason=INSUFFICIENT_CANONICAL_HISTORY).
   */
  HIGH_LOW_52W: 252,

  /**
   * Volume baseline: minimum sessions for a statistically meaningful
   * average daily volume (20-day ADV).
   */
  VOLUME_BASELINE: 20,
} as const;

export type IndicatorName = keyof typeof INDICATOR_MIN_BARS;

// ─── Public thresholds ────────────────────────────────────────────────────────

/**
 * MIN_BARS_FOR_STORAGE — minimum bars to warrant storing a row in kite_candle_store.
 *
 * Any positive bar history is worth persisting:
 *   - avoids re-downloading the same history on the next cycle
 *   - allows growth tracking (a new listing will reach 252 bars eventually)
 *   - serves partial indicator display (EMA20/50 where available)
 *
 * Rows with barCount < MIN_BARS_FOR_EVALUATION are always NOT_EVALUATED
 * (INSUFFICIENT_CANONICAL_HISTORY) but are still stored.
 */
export const MIN_BARS_FOR_STORAGE = 1;

/**
 * MIN_BARS_FOR_EVALUATION — minimum daily bars required for a row to be
 * evaluation-complete (signal, score, confidence, action all computed).
 *
 * Binding constraint: HIGH_LOW_52W = 252 (52-week high/low is mandatory).
 * A row with 200–251 bars has EMA200 available but not a reliable annual range.
 *
 * Below this threshold, regardless of other data quality:
 *   signal     = "NOT_EVALUATED"
 *   score      = null
 *   confidence = null
 *   reasons    = []
 *   reason     = "INSUFFICIENT_CANONICAL_HISTORY"
 *
 * See also: INDICATOR_MIN_BARS for per-indicator details.
 * See also: getIndicatorReadiness() for the per-field readiness map.
 */
export const MIN_BARS_FOR_EVALUATION: number = INDICATOR_MIN_BARS.HIGH_LOW_52W; // 252

// ─── Per-field readiness ───────────────────────────────────────────────────────

/**
 * Per-indicator readiness flags for a given bar count.
 *
 * Only `allMandatoryInputsReady=true` rows are eligible for Phase-B evaluation.
 * Intermediate states (e.g. ema200Ready=true, week52Ready=false) are stored and
 * displayed but never evaluated.
 *
 * Mandatory inputs for the curated NSE scanner:
 *   RSI(14), EMA(200), MACD(12,26,9), 52-week H/L, 20-day volume baseline.
 */
export interface IndicatorReadiness {
  /** RSI(14): needs period + 1 = 15 price points. */
  rsiReady: boolean;
  /** EMA(20): needs 20 bars. */
  ema20Ready: boolean;
  /** EMA(50): needs 50 bars. */
  ema50Ready: boolean;
  /** EMA(100): needs 100 bars. */
  ema100Ready: boolean;
  /** EMA(200): needs 200 bars. */
  ema200Ready: boolean;
  /** MACD(12,26,9): needs 34 bars. */
  macdReady: boolean;
  /** 20-day average volume: needs 20 bars. */
  volumeBaselineReady: boolean;
  /**
   * 52-week high/low: needs 252 completed bars.
   * This is the BINDING CONSTRAINT — the last field to become ready.
   */
  week52Ready: boolean;
  /**
   * ALL mandatory scanner inputs are ready.
   * This is the ONLY flag that gates Phase-B evaluation.
   * Even if ema200Ready=true, a row is NOT_EVALUATED until allMandatoryInputsReady=true.
   */
  allMandatoryInputsReady: boolean;
}

/**
 * Return per-field readiness for a given completed bar count.
 *
 * The `allMandatoryInputsReady` flag is the single gate for Phase-B evaluation.
 * A row where allMandatoryInputsReady=false must return:
 *   signal='NOT_EVALUATED', score=null, confidence=null, reason=INSUFFICIENT_CANONICAL_HISTORY
 *
 * @example
 *   getIndicatorReadiness(200)
 *   // { rsiReady:true, ema200Ready:true, week52Ready:false, allMandatoryInputsReady:false }
 *
 *   getIndicatorReadiness(252)
 *   // { rsiReady:true, ema200Ready:true, week52Ready:true, allMandatoryInputsReady:true }
 */
export function getIndicatorReadiness(barCount: number): IndicatorReadiness {
  const n = Number.isFinite(barCount) && barCount >= 0 ? barCount : 0;
  const rsiReady           = n >= INDICATOR_MIN_BARS.RSI_14;         // 15
  const ema20Ready         = n >= INDICATOR_MIN_BARS.EMA_20;         // 20
  const ema50Ready         = n >= INDICATOR_MIN_BARS.EMA_50;         // 50
  const ema100Ready        = n >= INDICATOR_MIN_BARS.EMA_100;        // 100
  const ema200Ready        = n >= INDICATOR_MIN_BARS.EMA_200;        // 200
  const macdReady          = n >= INDICATOR_MIN_BARS.MACD_12_26_9;  // 34
  const volumeBaselineReady = n >= INDICATOR_MIN_BARS.VOLUME_BASELINE; // 20
  const week52Ready        = n >= INDICATOR_MIN_BARS.HIGH_LOW_52W;  // 252
  return {
    rsiReady,
    ema20Ready,
    ema50Ready,
    ema100Ready,
    ema200Ready,
    macdReady,
    volumeBaselineReady,
    week52Ready,
    allMandatoryInputsReady:
      rsiReady && ema200Ready && macdReady && week52Ready && volumeBaselineReady,
  };
}

// ─── Utility functions ────────────────────────────────────────────────────────

/**
 * Return whether a candle series has sufficient history for full indicator
 * evaluation (52-week H/L binding constraint: 252 bars).
 *
 * Used by: scanner.ts, fullNseWarehouse.ts, and any other consumer
 * that needs to gate on evaluation completeness.
 */
export function hasEvaluationSufficientHistory(barCount: number): boolean {
  return Number.isFinite(barCount) && barCount >= MIN_BARS_FOR_EVALUATION;
}

/**
 * Return whether a candle series has at least partial indicator history.
 * (EMA20 + RSI14 — excludes EMA100/200 and 52W.)
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
  const shortfall = MIN_BARS_FOR_EVALUATION - barCount;
  if (barCount >= INDICATOR_MIN_BARS.EMA_200 && barCount < MIN_BARS_FOR_EVALUATION) {
    // EMA200 ready, but 52W not yet complete
    return (
      `INSUFFICIENT_CANONICAL_HISTORY: ${barCount} bars available, ` +
      `${MIN_BARS_FOR_EVALUATION} required for 52-week H/L (HIGH_LOW_52W, binding constraint). ` +
      `EMA200 IS available but 52-week range is incomplete (${shortfall} bars short). ` +
      `~${Math.ceil(shortfall / 21)} trading months until evaluation-eligible.`
    );
  }
  return (
    `INSUFFICIENT_CANONICAL_HISTORY: ${barCount} bars available, ` +
    `${MIN_BARS_FOR_EVALUATION} required for 52-week H/L (HIGH_LOW_52W, binding constraint; ` +
    `${shortfall} bars short). ` +
    `~${Math.ceil(shortfall / 21)} trading months until evaluation-eligible.`
  );
}
