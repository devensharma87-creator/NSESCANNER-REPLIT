/**
 * Pure technical-indicator math for the read-only Charting tab.
 *
 * Every function takes plain numeric series (or candle objects) and returns
 * a result array index-aligned with the input, using `null` wherever the
 * indicator is not yet defined. No network, no React, no fabrication —
 * gaps stay null rather than being filled with synthetic values.
 */

import { ema, rsi } from "@workspace/indicators";

/**
 * EMA and the series RSI are re-exported from the shared `@workspace/indicators`
 * single source of truth (byte-identical to the api-server + global copies).
 * The candle-typed convenience wrappers and VWAP below stay local.
 */
export { ema, rsi };

export interface IndicatorCandle {
  /** Epoch seconds (UTC) of the candle open. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

/** Convenience: EMA over candle closes. */
export function emaClose(candles: IndicatorCandle[], period: number): (number | null)[] {
  return ema(candles.map(c => c.c), period);
}

/** RSI over candle closes. */
export function rsiClose(candles: IndicatorCandle[], period = 14): (number | null)[] {
  return rsi(candles.map(c => c.c), period);
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST calendar date key (YYYY-MM-DD) for epoch seconds — for session resets. */
export function istDateKey(tSec: number): string {
  return new Date(tSec * 1000 + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * VWAP using typical price ((H+L+C)/3) weighted by volume.
 *
 * When `sessionReset` is true (intraday) the cumulative sums restart at each
 * new IST trading day. Bars with null/zero volume contribute nothing and
 * carry the prior VWAP forward. If a session has never seen positive volume,
 * those bars stay null (no fabrication).
 */
export function vwap(
  candles: IndicatorCandle[],
  sessionReset = true,
): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  let curKey: string | null = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (sessionReset) {
      const key = istDateKey(c.t);
      if (key !== curKey) {
        curKey = key;
        cumPV = 0;
        cumV = 0;
      }
    }
    const vol = c.v != null && Number.isFinite(c.v) && c.v > 0 ? c.v : 0;
    const typical = (c.h + c.l + c.c) / 3;
    cumPV += typical * vol;
    cumV += vol;
    out[i] = cumV > 0 ? cumPV / cumV : null;
  }
  return out;
}

export const EMA_PERIODS = [11, 20, 50, 100, 200] as const;
export type EmaPeriod = (typeof EMA_PERIODS)[number];

/** Compute the full EMA-ribbon used by the chart in one pass. */
export function emaRibbon(
  candles: IndicatorCandle[],
): Record<EmaPeriod, (number | null)[]> {
  const closes = candles.map(c => c.c);
  return EMA_PERIODS.reduce(
    (acc, p) => {
      acc[p] = ema(closes, p);
      return acc;
    },
    {} as Record<EmaPeriod, (number | null)[]>,
  );
}
