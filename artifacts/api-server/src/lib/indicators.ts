export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i]! - values[i - 1]!;
    if (ch >= 0) gains += ch;
    else losses -= ch;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i]! - values[i - 1]!;
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

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
  // ADX = SMA of DX over period
  for (let i = period * 2; i < len; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += dx[j] ?? 0;
    out[i] = sum / period;
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
  const macdLine = values.map((_, i) => {
    const a = e1[i];
    const b = e2[i];
    return a == null || b == null ? null : a - b;
  });
  const macdNumeric = macdLine.map(v => v ?? 0);
  const sigLine = ema(macdNumeric, signalP);
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

/** Rolling daily VWAP using HLC3 weighted by volume across the lookback window. */
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
  if (v === 0) return close[n - 1] ?? null;
  return pv / v;
}

/** Intraday session VWAP (cumulative from start of provided bars). */
export function sessionVwap(
  high: number[],
  low: number[],
  close: number[],
  volume: number[],
): (number | null)[] {
  const out: (number | null)[] = new Array(close.length).fill(null);
  let pv = 0;
  let v = 0;
  for (let i = 0; i < close.length; i++) {
    const typ = (high[i]! + low[i]! + close[i]!) / 3;
    const vol = volume[i] ?? 0;
    pv += typ * vol;
    v += vol;
    out[i] = v > 0 ? pv / v : typ;
  }
  return out;
}

export interface VolumeProfile {
  pointOfControl: number;
  valueAreaHigh: number;
  valueAreaLow: number;
}

export function volumeProfile(
  high: number[],
  low: number[],
  close: number[],
  volume: number[],
  bins = 24,
  lookback = 60,
): VolumeProfile | null {
  const n = close.length;
  if (n < 10) return null;
  const start = Math.max(0, n - lookback);
  const sliceH = high.slice(start);
  const sliceL = low.slice(start);
  const sliceC = close.slice(start);
  const sliceV = volume.slice(start);
  const lo = Math.min(...sliceL);
  const hi = Math.max(...sliceH);
  if (hi <= lo) return null;
  const step = (hi - lo) / bins;
  const buckets = new Array(bins).fill(0) as number[];
  for (let i = 0; i < sliceC.length; i++) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((sliceC[i]! - lo) / step)));
    buckets[idx]! += sliceV[i] ?? 0;
  }
  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (buckets[i]! > buckets[pocIdx]!) pocIdx = i;
  const totalVol = buckets.reduce((a, b) => a + b, 0);
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
