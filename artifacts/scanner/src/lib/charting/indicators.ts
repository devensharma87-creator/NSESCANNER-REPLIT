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

/**
 * Cumulative Volume Delta — candle-direction PROXY (not true order-flow delta).
 *
 * True CVD requires tick-level buy/sell aggression (bid/ask trades), which this
 * datafeed does not provide. As an honest approximation each bar contributes
 * `+volume` on an up close, `-volume` on a down close, and `0` on a doji; the
 * result is the running cumulative sum. Bars with null/zero volume contribute 0.
 *
 * Returns an all-null series (nothing to plot) when NO bar in the input has
 * positive volume — e.g. delayed Yahoo / global symbols — rather than drawing a
 * flat fabricated line. Callers MUST label this as a proxy in the UI.
 */
export function cvdProxy(candles: IndicatorCandle[]): (number | null)[] {
  const hasVolume = candles.some(c => c.v != null && Number.isFinite(c.v) && c.v > 0);
  if (!hasVolume) return new Array(candles.length).fill(null);
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let cum = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const vol = c.v != null && Number.isFinite(c.v) && c.v > 0 ? c.v : 0;
    const dir = c.c > c.o ? 1 : c.c < c.o ? -1 : 0;
    cum += vol * dir;
    out[i] = cum;
  }
  return out;
}

/**
 * Point of Control — the price level with the most traded volume, derived from a
 * simple volume profile over the visible candles.
 *
 * APPROXIMATION: without intrabar tick data we cannot know the true intrabar
 * volume distribution, so each candle's volume is spread evenly across the price
 * bins its [low, high] range overlaps. The bin with the greatest accumulated
 * volume is the POC, returned as that bin's mid-price.
 *
 * Returns null (honestly unavailable) when no bar has positive volume or the
 * price range is degenerate — never a fabricated level.
 */
export function volumeProfilePoc(candles: IndicatorCandle[], bins = 60): number | null {
  const withVol = candles.filter(
    c => c.v != null && Number.isFinite(c.v) && (c.v as number) > 0,
  );
  if (withVol.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (Number.isFinite(c.l)) lo = Math.min(lo, c.l);
    if (Number.isFinite(c.h)) hi = Math.max(hi, c.h);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const binSize = (hi - lo) / bins;
  const vols = new Array(bins).fill(0);
  for (const c of withVol) {
    const v = c.v as number;
    const startBin = Math.max(0, Math.min(bins - 1, Math.floor((c.l - lo) / binSize)));
    const endBin = Math.max(0, Math.min(bins - 1, Math.floor((c.h - lo) / binSize)));
    const span = endBin - startBin + 1;
    const per = v / span;
    for (let b = startBin; b <= endBin; b++) vols[b] += per;
  }
  let maxVol = -1;
  let maxBin = 0;
  for (let b = 0; b < bins; b++) {
    if (vols[b] > maxVol) {
      maxVol = vols[b];
      maxBin = b;
    }
  }
  return lo + (maxBin + 0.5) * binSize;
}

/** A 3-candle Fair Value Gap (imbalance) zone. `time` is the third candle's open. */
export interface FvgZone {
  time: number;
  top: number;
  bottom: number;
  type: "bullish" | "bearish";
}

/**
 * Fair Value Gaps — 3-candle price imbalances where the wicks of candle 1 and
 * candle 3 fail to overlap, leaving an unfilled gap around candle 2.
 *  - bullish: candle1.high < candle3.low (gap above)
 *  - bearish: candle1.low  > candle3.high (gap below)
 *
 * Pure price geometry (no volume needed). Returns at most the `maxZones` most
 * recent gaps to keep the chart readable.
 */
export function detectFvgs(candles: IndicatorCandle[], maxZones = 6): FvgZone[] {
  const zones: FvgZone[] = [];
  for (let i = 0; i + 2 < candles.length; i++) {
    const c1 = candles[i]!;
    const c3 = candles[i + 2]!;
    if (c1.h < c3.l) {
      zones.push({ time: c3.t, top: c3.l, bottom: c1.h, type: "bullish" });
    } else if (c1.l > c3.h) {
      zones.push({ time: c3.t, top: c1.l, bottom: c3.h, type: "bearish" });
    }
  }
  return maxZones > 0 ? zones.slice(-maxZones) : zones;
}

/** A liquidity-sweep event: a stop-run beyond recent extremes that snaps back. */
export interface SweepMarker {
  time: number;
  type: "HIGH_SWEEP" | "LOW_SWEEP";
}

/**
 * Liquidity Sweeps — bars that pierce the prior `lookback`-bar high/low (running
 * stops) but close back inside the range, with the next bar confirming the
 * rejection.
 *  - HIGH_SWEEP: high > priorHigh AND close < priorHigh AND next close < this high
 *  - LOW_SWEEP : low  < priorLow  AND close > priorLow  AND next close > this low
 *
 * Pure price geometry (no volume needed); requires one confirming bar so the
 * final, still-forming bar is never flagged.
 */
export function detectSweeps(candles: IndicatorCandle[], lookback = 5): SweepMarker[] {
  const out: SweepMarker[] = [];
  for (let i = lookback; i + 1 < candles.length; i++) {
    const window = candles.slice(i - lookback, i);
    const priorHigh = Math.max(...window.map(c => c.h));
    const priorLow = Math.min(...window.map(c => c.l));
    const cur = candles[i]!;
    const next = candles[i + 1]!;
    if (cur.h > priorHigh && cur.c < priorHigh && next.c < cur.h) {
      out.push({ time: cur.t, type: "HIGH_SWEEP" });
    } else if (cur.l < priorLow && cur.c > priorLow && next.c > cur.l) {
      out.push({ time: cur.t, type: "LOW_SWEEP" });
    }
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
