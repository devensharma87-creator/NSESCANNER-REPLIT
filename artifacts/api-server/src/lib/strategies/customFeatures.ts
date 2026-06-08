/**
 * The cross-surface FEATURE CONTRACT for custom strategies.
 *
 * Both the live F&O engine and the Backtest Lab build a `FeatureSeries` from
 * their own causal bar window and hand it to the single shared evaluator
 * (`customEval.ts`). The series holds index-aligned arrays; the evaluator only
 * ever reads indices ≤ the bar under test, so there is no look-ahead.
 *
 * EMA9/EMA20/EMA50 and RSI14 are computed HERE from the close array via the
 * canonical `@workspace/indicators` primitives, so two surfaces that supply the
 * same closes get byte-identical momentum features (this is the core of the
 * live↔backtest parity guarantee, locked by a parity test).
 *
 * VWAP and ATR are surface-PROVIDED, not recomputed here, because they
 * legitimately differ by data origin: live VWAP uses real traded volume while
 * the backtest uses a session typical-price mean (SPOT candles carry no
 * volume), and the two ATR implementations differ. These differences are
 * documented and honest — VWAP/ATR blocks therefore reflect each surface's best
 * available truth rather than a fabricated common value.
 */
import {
  ema,
  rsi,
  computeSmcSeries,
  DEFAULT_SMC_CONFIG,
  type SmcSeries,
  type SmcBar,
} from "@workspace/indicators";

/** Aligned causal arrays a surface must supply to build a FeatureSeries. */
export interface FeatureSeriesInput {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  /** Surface-provided VWAP (live: volume VWAP; backtest: session typ-price mean). */
  vwap: (number | null)[];
  /** Surface-provided ATR(14). */
  atr14: (number | null)[];
  /** IST minute-of-day per bar (for the execution session window). */
  istMinute: number[];
}

export interface FeatureSeries {
  readonly n: number;
  readonly open: readonly number[];
  readonly high: readonly number[];
  readonly low: readonly number[];
  readonly close: readonly number[];
  readonly ema9: readonly (number | null)[];
  readonly ema20: readonly (number | null)[];
  readonly ema50: readonly (number | null)[];
  readonly rsi14: readonly (number | null)[];
  readonly vwap: readonly (number | null)[];
  readonly atr14: readonly (number | null)[];
  readonly istMinute: readonly number[];
  /**
   * Per-bar Smart-Money-Concepts series, computed ONCE from open/high/low/close
   * + atr14 via the shared causal `computeSmcSeries`. Order-block zones use BODY
   * bounds (pure price), so two surfaces supplying identical OHLC get a
   * byte-identical SMC series — this is what extends the live↔backtest parity
   * guarantee to every SMC block.
   */
  readonly smc: SmcSeries;
}

/** Build the FeatureSeries, computing EMA/RSI/SMC from prices via the shared lib. */
export function projectFeatureSeries(input: FeatureSeriesInput): FeatureSeries {
  const close = input.close;
  return {
    n: close.length,
    open: input.open,
    high: input.high,
    low: input.low,
    close,
    ema9: ema(close, 9),
    ema20: ema(close, 20),
    ema50: ema(close, 50),
    rsi14: rsi(close, 14),
    vwap: input.vwap,
    atr14: input.atr14,
    istMinute: input.istMinute,
    smc: computeSmcSeries(
      {
        open: input.open,
        high: input.high,
        low: input.low,
        close: input.close,
        atr14: input.atr14,
      },
      DEFAULT_SMC_CONFIG,
    ),
  };
}

import type { FeatureKey } from "./customSpec";

function at(arr: readonly (number | null)[] | readonly number[], i: number): number | null {
  if (i < 0 || i >= arr.length) return null;
  const v = arr[i];
  return v != null && Number.isFinite(v) ? v : null;
}

/** Read one scalar feature at bar `i` (null when warming up / out of range). */
export function featureAt(s: FeatureSeries, key: FeatureKey, i: number): number | null {
  switch (key) {
    case "close":
      return at(s.close, i);
    case "ema9":
      return at(s.ema9, i);
    case "ema20":
      return at(s.ema20, i);
    case "ema50":
      return at(s.ema50, i);
    case "rsi14":
      return at(s.rsi14, i);
    case "atr14":
      return at(s.atr14, i);
    case "vwap":
      return at(s.vwap, i);
  }
}

export function closeAt(s: FeatureSeries, i: number): number | null {
  return at(s.close, i);
}
export function atrAt(s: FeatureSeries, i: number): number | null {
  return at(s.atr14, i);
}
export function vwapAt(s: FeatureSeries, i: number): number | null {
  return at(s.vwap, i);
}
export function emaAt(s: FeatureSeries, key: "ema9" | "ema20" | "ema50", i: number): number | null {
  return featureAt(s, key, i);
}
export function istMinuteAt(s: FeatureSeries, i: number): number | null {
  if (i < 0 || i >= s.istMinute.length) return null;
  const v = s.istMinute[i];
  return v != null && Number.isFinite(v) ? v : null;
}

/** Read the per-bar SMC snapshot at bar `i` (null when out of range). */
export function smcAt(s: FeatureSeries, i: number): SmcBar | null {
  if (i < 0 || i >= s.smc.length) return null;
  return s.smc[i] ?? null;
}
