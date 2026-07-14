/**
 * Pure technical-indicator math used by the global scanner.
 *
 * Every function takes raw OHLCV arrays and returns an aligned series the
 * same length as the input (indicator value or `null` for warm-up bars).
 *
 * No third-party indicator library — keeps the dependency surface small and
 * makes the math auditable for the screener.
 */

import { ema, rsi } from "@workspace/indicators";

/**
 * EMA and the series RSI come from the shared `@workspace/indicators` single
 * source of truth (byte-identical to the api-server + scanner-charting copies).
 * The remaining functions (sma / atr / macd / bollinger / vwap / supertrend)
 * are global-specific algorithms and intentionally stay local — see the note in
 * `@workspace/indicators` on why they are NOT unified.
 */
export { ema, rsi };

export interface OHLCV {
  t: number;          // ms since epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

function nullArr(n: number): Array<number | null> {
  return new Array(n).fill(null);
}

export function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = nullArr(values.length);
  if (period <= 0 || values.length === 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export interface MACDResult {
  macd: Array<number | null>;
  signal: Array<number | null>;
  hist: Array<number | null>;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  sig = 9,
): MACDResult {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const m: Array<number | null> = closes.map((_, i) => {
    const f = fastEma[i]; const s = slowEma[i];
    return f != null && s != null ? f - s : null;
  });
  // Signal line = EMA of MACD where MACD is defined.
  const macdNumeric = m.map(v => v ?? 0);
  const startIdx = m.findIndex(v => v !== null);
  const sigSeed = startIdx >= 0 ? ema(macdNumeric.slice(startIdx), sig) : [];
  const signal: Array<number | null> = nullArr(closes.length);
  if (startIdx >= 0) {
    for (let i = 0; i < sigSeed.length; i++) {
      signal[startIdx + i] = sigSeed[i] ?? null;
    }
  }
  const hist = m.map((v, i) => {
    const sg = signal[i];
    return v != null && sg != null ? v - sg : null;
  });
  return { macd: m, signal, hist };
}

export interface BBResult {
  upper: Array<number | null>;
  middle: Array<number | null>;
  lower: Array<number | null>;
}

export function bollinger(closes: number[], period = 20, mult = 2): BBResult {
  const middle = sma(closes, period);
  const upper: Array<number | null> = nullArr(closes.length);
  const lower: Array<number | null> = nullArr(closes.length);
  for (let i = period - 1; i < closes.length; i++) {
    const m = middle[i]; if (m == null) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j]! - m;
      sumSq += d * d;
    }
    const stdev = Math.sqrt(sumSq / period);
    upper[i] = m + mult * stdev;
    lower[i] = m - mult * stdev;
  }
  return { upper, middle, lower };
}

export function atr(candles: OHLCV[], period = 14): Array<number | null> {
  const out: Array<number | null> = nullArr(candles.length);
  if (candles.length === 0) return out;
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (i === 0) { trs.push(c.high - c.low); continue; }
    const prev = candles[i - 1]!;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    trs.push(tr);
  }
  if (trs.length < period) return out;
  let avg = 0;
  for (let i = 0; i < period; i++) avg += trs[i]!;
  avg /= period;
  out[period - 1] = avg;
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]!) / period;
    out[i] = avg;
  }
  return out;
}

/**
 * Rolling VWAP — volume-weighted average price across the entire input.
 * For intraday charts this is effectively a session VWAP when given a single
 * trading day's candles, and a rolling VWAP otherwise.
 */
export function vwap(candles: OHLCV[]): Array<number | null> {
  const out: Array<number | null> = nullArr(candles.length);
  let cumPV = 0; let cumV = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const tp = (c.high + c.low + c.close) / 3;
    const v = c.volume ?? 0;
    if (v <= 0) {
      // VWAP requires real volume; if the source doesn't provide it (e.g. FX)
      // we must not synthesize one.
      if (cumV > 0) out[i] = cumPV / cumV;
      continue;
    }
    cumPV += tp * v;
    cumV += v;
    out[i] = cumPV / cumV;
  }
  return out;
}

export interface SupertrendResult {
  values: Array<number | null>;
  direction: Array<-1 | 1 | null>;
}

export function supertrend(
  candles: OHLCV[],
  period = 10,
  multiplier = 3,
): SupertrendResult {
  const atrSeries = atr(candles, period);
  const values: Array<number | null> = nullArr(candles.length);
  const direction: Array<-1 | 1 | null> = nullArr(candles.length) as Array<-1 | 1 | null>;
  let prevUpper = NaN;
  let prevLower = NaN;
  let prevValue: number | null = null;
  let prevDir: -1 | 1 | null = null;
  for (let i = 0; i < candles.length; i++) {
    const a = atrSeries[i];
    if (a == null) continue;
    const c = candles[i]!;
    const hl2 = (c.high + c.low) / 2;
    const upperBasic = hl2 + multiplier * a;
    const lowerBasic = hl2 - multiplier * a;
    const prevClose = i > 0 ? candles[i - 1]!.close : c.close;
    const upper = !isNaN(prevUpper) && (upperBasic < prevUpper || prevClose > prevUpper)
      ? upperBasic : (isNaN(prevUpper) ? upperBasic : prevUpper);
    const lower = !isNaN(prevLower) && (lowerBasic > prevLower || prevClose < prevLower)
      ? lowerBasic : (isNaN(prevLower) ? lowerBasic : prevLower);
    let dir: -1 | 1;
    if (prevDir === null) {
      dir = c.close > upper ? 1 : -1;
    } else if (prevDir === 1) {
      dir = c.close < lower ? -1 : 1;
    } else {
      dir = c.close > upper ? 1 : -1;
    }
    values[i] = dir === 1 ? lower : upper;
    direction[i] = dir;
    prevUpper = upper;
    prevLower = lower;
    prevValue = values[i];
    prevDir = dir;
  }
  void prevValue;
  return { values, direction };
}

/** Convenience: percent-change between first and last close in `closes`. */
export function pctChange(values: Array<number | null>): number | null {
  const first = values.find(v => v != null);
  const last = [...values].reverse().find(v => v != null);
  if (first == null || last == null || first === 0) return null;
  return ((last - first) / first) * 100;
}

export function lastNonNull<T>(arr: Array<T | null>): T | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as T;
  return null;
}

export function highestHigh(candles: OHLCV[], period: number): number | null {
  if (candles.length === 0) return null;
  const slice = candles.slice(-period);
  let h = -Infinity;
  for (const c of slice) if (c.high > h) h = c.high;
  return Number.isFinite(h) ? h : null;
}

export function lowestLow(candles: OHLCV[], period: number): number | null {
  if (candles.length === 0) return null;
  const slice = candles.slice(-period);
  let l = Infinity;
  for (const c of slice) if (c.low < l) l = c.low;
  return Number.isFinite(l) ? l : null;
}
