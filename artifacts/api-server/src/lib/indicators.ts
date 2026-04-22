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

export function avgVolume(vols: number[], period = 20): number {
  if (vols.length === 0) return 0;
  const window = vols.slice(-period);
  return window.reduce((a, b) => a + b, 0) / window.length;
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
