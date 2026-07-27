import { ema, rsi } from "@workspace/indicators";

/**
 * EMA and the (series) RSI are the SINGLE-SOURCE-OF-TRUTH primitives shared
 * with the scanner-charting and global-scanner copies — see
 * `@workspace/indicators`. They are re-exported here verbatim so every existing
 * importer (scoring, the local `atr`/`macd`, route handlers) keeps its import
 * path unchanged while the math lives in exactly one place.
 */
export { ema, rsi };

export function atr(high: number[], low: number[], close: number[], period = 14): (number | null)[] {
  const trs: number[] = [];
  for (let i = 0; i < close.length; i++) {
    if (i === 0) trs.push(high[i]! - low[i]!);
    else {
      const tr = Math.max(
        high[i]! - low[i]!,
        Math.abs(high[i]! - close[i - 1]!),
        Math.abs(low[i]! - close[i - 1]!),
      );
      trs.push(tr);
    }
  }
  return ema(trs, period);
}

export function adx(high: number[], low: number[], close: number[], period = 14): (number | null)[] {
  const len = close.length;
  const out: (number | null)[] = new Array(len).fill(null);
  if (len < period * 2) return out;
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [high[0]! - low[0]!];
  for (let i = 1; i < len; i++) {
    const upMove = high[i]! - high[i - 1]!;
    const downMove = low[i - 1]! - low[i]!;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(high[i]! - low[i]!, Math.abs(high[i]! - close[i - 1]!), Math.abs(low[i]! - close[i - 1]!)));
  }
  // Wilder's smoothing
  const smooth = (arr: number[]) => {
    const s: number[] = new Array(arr.length).fill(0);
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += arr[i] ?? 0;
    s[period] = sum;
    for (let i = period + 1; i < arr.length; i++) {
      s[i] = s[i - 1]! - s[i - 1]! / period + arr[i]!;
    }
    return s;
  };
  const trS = smooth(tr);
  const pS = smooth(plusDM);
  const mS = smooth(minusDM);
  const dx: number[] = new Array(len).fill(0);
  for (let i = period; i < len; i++) {
    const trv = trS[i]!;
    if (trv === 0) continue;
    const pdi = (pS[i]! / trv) * 100;
    const mdi = (mS[i]! / trv) * 100;
    const sum = pdi + mdi;
    dx[i] = sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100;
  }
  // ADX = Wilder's RMA (running moving average) of DX over period.
  // Canonical Wilder smoothing: ADX[i] = (ADX[i-1] * (period-1) + DX[i]) / period
  // The initial ADX seed is the SMA of the first `period` DX values.
  let seedSum = 0;
  for (let j = period; j < period * 2; j++) seedSum += dx[j] ?? 0;
  let prevAdx = seedSum / period;
  out[period * 2 - 1] = prevAdx;
  for (let i = period * 2; i < len; i++) {
    prevAdx = (prevAdx * (period - 1) + (dx[i] ?? 0)) / period;
    out[i] = prevAdx;
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signalP = 9): {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  const e1 = ema(values, fast);
  const e2 = ema(values, slow);
  const macdLine: (number | null)[] = values.map((_, i) => {
    const a = e1[i];
    const b = e2[i];
    return a == null || b == null ? null : a - b;
  });
  // Signal line: seed the EMA only from the first valid MACD value.
  // Do NOT zero-fill nulls before the first valid MACD bar — that trains
  // the signal EMA on fake zeros and produces distorted early histogram
  // values for short-history / new-listing symbols.
  const startIdx = macdLine.findIndex(v => v !== null);
  const sigSeed = startIdx >= 0
    ? ema(macdLine.slice(startIdx).map(v => v ?? 0), signalP)
    : [];
  const sigLine: (number | null)[] = new Array(values.length).fill(null);
  if (startIdx >= 0) {
    for (let i = 0; i < sigSeed.length; i++) {
      sigLine[startIdx + i] = sigSeed[i] ?? null;
    }
  }
  const hist = macdLine.map((m, i) => {
    const s = sigLine[i];
    return m == null || s == null ? null : m - s;
  });
  return { macd: macdLine, signal: sigLine, hist };
}

export function avgVolume(vols: number[], period = 20): number {
  if (vols.length === 0) return 0;
  const window = vols.slice(-period);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

/**
 * Rolling daily VWAP using HLC3 weighted by volume across the lookback window.
 * Returns null when total volume in the window is zero (e.g. cash index candles).
 */
export function rollingVwap(
  high: number[],
  low: number[],
  close: number[],
  volume: number[],
  lookback = 20,
): number | null {
  const n = close.length;
  if (n < 1) return null;
  const start = Math.max(0, n - lookback);
  let pv = 0;
  let v = 0;
  for (let i = start; i < n; i++) {
    const typ = (high[i]! + low[i]! + close[i]!) / 3;
    const vol = volume[i] ?? 0;
    pv += typ * vol;
    v += vol;
  }
  if (v === 0) return null;
  return pv / v;
}

/**
 * Intraday session VWAP (cumulative from start of provided bars).
 *
 * Numeric-validity contract (D-FAB-05):
 *   - Returns null for every bar whose cumulative USABLE volume is still zero.
 *   - Bars with non-finite volume (NaN, ±Infinity) or negative volume are
 *     skipped entirely (zero weight contribution); their output position stays null.
 *   - Bars with non-finite OHLC are skipped; their output position stays null.
 *   - Mismatched array lengths return an all-null series of length close.length.
 *   - Does NOT fall back to HLC3, close, spot, or any price-only substitute
 *     when cumulative volume is zero or invalid.
 *
 * Provider/provenance trust is not enforced here — this function only receives
 * numeric arrays. Upstream callers are responsible for ensuring data provenance
 * meets their requirements before calling this function.
 *
 * Note: the previous behaviour (returning HLC3 when cumVol=0) was silently
 * wrong — it produced fake "VWAP reclaim" and "spot above/below VWAP" signals
 * from a price-only value. That behaviour has been removed.
 */
export function sessionVwap(
  high: number[],
  low: number[],
  close: number[],
  volume: number[],
): (number | null)[] {
  const n = close.length;
  // Mismatched lengths: all positions unavailable.
  if (high.length !== n || low.length !== n || volume.length !== n) {
    return new Array(n).fill(null);
  }
  const out: (number | null)[] = new Array(n).fill(null);
  let pv = 0;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const vol = volume[i]!;
    // Non-finite or negative volume: skip this bar's contribution.
    if (!isFinite(vol) || vol < 0) continue;
    const typ = (high[i]! + low[i]! + close[i]!) / 3;
    // Non-finite OHLC: skip this bar's contribution.
    if (!isFinite(typ)) continue;
    pv += typ * vol;
    v += vol;
    out[i] = v > 0 ? pv / v : null;
  }
  return out;
}

export interface VolumeProfile {
  pointOfControl: number;
  valueAreaHigh: number;
  valueAreaLow: number;
}

/**
 * Volume Profile over the last `lookback` bars.
 *
 * Numeric-validity contract (D-FAB-01):
 *   - Returns null when array lengths are inconsistent.
 *   - Returns null when fewer than 10 bars are provided.
 *   - Returns null when the price range is non-finite or non-positive (hi <= lo).
 *   - Bars with non-finite close or non-finite/negative volume are skipped
 *     (zero contribution); they do not influence the profile.
 *   - Returns null when total usable volume is <= 0 or non-finite — a
 *     degenerate profile (all buckets zero) would produce a POC/VAH/VAL
 *     derived entirely from price range, not volume, and must be rejected.
 *
 * Provider/provenance trust is not enforced here — this function only
 * receives numeric arrays. Upstream callers handle data provenance.
 *
 * Valid-output guarantee: POC, VAH, VAL are finite; VAL <= VAH;
 * all three lie within the supplied price range.
 */
export function volumeProfile(
  high: number[],
  low: number[],
  close: number[],
  volume: number[],
  bins = 24,
  lookback = 60,
): VolumeProfile | null {
  const n = close.length;
  // Mismatched lengths: unavailable.
  if (high.length !== n || low.length !== n || volume.length !== n) return null;
  if (n < 10) return null;
  const start = Math.max(0, n - lookback);
  const sliceH = high.slice(start);
  const sliceL = low.slice(start);
  const sliceC = close.slice(start);
  const sliceV = volume.slice(start);
  const lo = Math.min(...sliceL);
  const hi = Math.max(...sliceH);
  // Non-finite price range (NaN from non-finite OHLC) or zero-range: unavailable.
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return null;
  const step = (hi - lo) / bins;
  const buckets = new Array(bins).fill(0) as number[];
  for (let i = 0; i < sliceC.length; i++) {
    const closeVal = sliceC[i]!;
    const vol = sliceV[i]!;
    // Skip bars with non-finite close or non-finite/negative volume.
    if (!isFinite(closeVal) || !isFinite(vol) || vol < 0) continue;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((closeVal - lo) / step)));
    buckets[idx]! += vol;
  }
  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (buckets[i]! > buckets[pocIdx]!) pocIdx = i;
  const totalVol = buckets.reduce((a, b) => a + b, 0);
  // Return null when total usable volume is zero or non-finite: a degenerate
  // profile (all buckets zero) would produce POC/VAH/VAL derived entirely
  // from the price range rather than actual volume, which is numerically invalid.
  if (!isFinite(totalVol) || totalVol <= 0) return null;
  const targetVA = totalVol * 0.7;
  let vaVol = buckets[pocIdx]!;
  let lower = pocIdx;
  let upper = pocIdx;
  while (vaVol < targetVA && (lower > 0 || upper < bins - 1)) {
    const lv = lower > 0 ? buckets[lower - 1]! : -1;
    const uv = upper < bins - 1 ? buckets[upper + 1]! : -1;
    if (uv >= lv && upper < bins - 1) { upper++; vaVol += uv; }
    else if (lower > 0) { lower--; vaVol += lv; }
    else break;
  }
  return {
    pointOfControl: lo + (pocIdx + 0.5) * step,
    valueAreaLow: lo + lower * step,
    valueAreaHigh: lo + (upper + 1) * step,
  };
}

export function supportResistance(
  high: number[],
  low: number[],
  lookback = 40,
): { support: number; resistance: number } {
  const n = high.length;
  const start = Math.max(0, n - lookback);
  const sliceH = high.slice(start);
  const sliceL = low.slice(start);
  return {
    support: Math.min(...sliceL),
    resistance: Math.max(...sliceH),
  };
}

/** Classic floor pivots from previous session. */
/**
 * Bollinger-band width series. Returns ((upper - lower) / middle) × 100,
 * i.e. width as a percentage of the SMA. NaN-safe for short windows.
 *
 *   middle = SMA(close, period)
 *   upper  = middle + stdDev × stddev(close, period)
 *   lower  = middle − stdDev × stddev(close, period)
 *
 * Used by the regime classifier to flag VOLATILE sessions where
 * directional setups get whipsawed by single bars.
 */
export function bbWidth(values: number[], period = 20, stdDev = 2): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    let varSum = 0;
    for (const v of window) varSum += (v - mean) ** 2;
    const sd = Math.sqrt(varSum / period);
    if (mean === 0) continue;
    const upper = mean + stdDev * sd;
    const lower = mean - stdDev * sd;
    out[i] = ((upper - lower) / mean) * 100;
  }
  return out;
}

export function pivots(prevHigh: number, prevLow: number, prevClose: number): {
  pivot: number; r1: number; s1: number; r2: number; s2: number;
} {
  const p = (prevHigh + prevLow + prevClose) / 3;
  return {
    pivot: p,
    r1: 2 * p - prevLow,
    s1: 2 * p - prevHigh,
    r2: p + (prevHigh - prevLow),
    s2: p - (prevHigh - prevLow),
  };
}
