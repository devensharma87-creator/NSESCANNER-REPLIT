/**
 * Pro Swing Scanner — TypeScript port of the Python "Pro Swing Scanner v3"
 * spec attached by the owner. Pure deterministic math: takes daily OHLCV
 * arrays + an optional benchmark series + an optional fundamentals
 * snapshot, returns a fully-scored trade plan. No I/O, no globals, no
 * randomness — every call with the same inputs produces the same output,
 * which makes the scoring testable in isolation.
 *
 * The orchestrator (`swingScannerStore.ts`) is responsible for fetching
 * bars / fundamentals and persisting the result. The HTTP route just
 * reads from the cache. This file knows nothing about HTTP, the DB, or
 * Kite.
 *
 * Function names mirror the Python module to keep the audit trail
 * obvious. Where the Python relied on pandas/numpy idioms (rolling,
 * ewm, groupby, histograms) we re-implement the small slice we
 * actually need against plain TypedArrays.
 */

/* ────────────────────────────── Types ────────────────────────────── */

export interface DailyBars {
  /** UTC ms timestamps, ascending. */
  ts: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export interface Zone {
  lower: number;
  upper: number;
  label: string;
  strength: number;
  /** ISO date string (YYYY-MM-DD) when the zone formed; "" for synthetic. */
  created: string;
}

export interface ScanConfig {
  emaFast: number;       // 20
  emaMid: number;        // 50
  emaSlow: number;       // 200
  rsiPeriod: number;     // 14
  atrPeriod: number;     // 14
  adxPeriod: number;     // 14
  zoneLookback: number;  // 140
  fvgLookback: number;   // 120
  volumeProfileDays: number; // 90
  near52wPct: number;    // 5.0
  buyZoneAtrBuffer: number;  // 0.75
  minRr: number;         // 2.0
  minScore: number;      // 55
  minAvgValueLakhs: number;  // 25 (₹25L = ₹25,00,000 daily turnover floor)
  capital: number;       // 500000
  riskPerTradePct: number;   // 1.0
  includeFundamentals: boolean;
  marketContextRequired: boolean;
}

export const DEFAULT_CONFIG: ScanConfig = {
  emaFast: 20,
  emaMid: 50,
  emaSlow: 200,
  rsiPeriod: 14,
  atrPeriod: 14,
  adxPeriod: 14,
  zoneLookback: 140,
  fvgLookback: 120,
  volumeProfileDays: 90,
  near52wPct: 5.0,
  buyZoneAtrBuffer: 0.75,
  minRr: 2.0,
  minScore: 55,
  minAvgValueLakhs: 25,
  capital: 500_000,
  riskPerTradePct: 1.0,
  includeFundamentals: true,
  marketContextRequired: false,
};

export interface FundamentalsSnapshot {
  trailingPe: number;        // P/E ratio
  priceToBook: number;
  debtToEquity: number;
  roe: number;               // 0..1 (e.g. 0.18 = 18%)
  roa: number;               // 0..1
  revenueGrowth: number;     // 0..1
  earningsGrowth: number;    // 0..1
  profitMargins: number;     // 0..1
  operatingMargins: number;  // 0..1
  quarterlyRevenueGrowthPct: number; // % (already × 100)
  quarterlyNetIncomeGrowthPct: number; // %
  sector: string;
  industry: string;
  fundamentalStatus: "Strong" | "Acceptable" | "Weak/Mixed" | "Poor/Unavailable" | "Unavailable" | "Unknown" | "Skipped";
  quarterlyComment: string;
}

export const EMPTY_FUNDAMENTALS: FundamentalsSnapshot = {
  trailingPe: NaN, priceToBook: NaN, debtToEquity: NaN, roe: NaN, roa: NaN,
  revenueGrowth: NaN, earningsGrowth: NaN, profitMargins: NaN, operatingMargins: NaN,
  quarterlyRevenueGrowthPct: NaN, quarterlyNetIncomeGrowthPct: NaN,
  sector: "", industry: "", fundamentalStatus: "Skipped", quarterlyComment: "Skipped",
};

export interface SwingScanResult {
  symbol: string;
  status: "OK" | string;
  action: string;
  setup: string;
  potential: "High" | "Medium" | "Low";
  qualityGrade: "A" | "B+" | "B" | "C / Watch Only" | "D / Avoid";
  score: number;
  technicalScore: number;
  smcScore: number;
  volumeScore: number;
  momentumScore: number;
  fundamentalScore: number;
  riskScore: number;
  contextScore: number;
  rsScore: number;
  weeklyTrend: string;
  weeklyComment: string;
  rs20: number; rs50: number; rs120: number;
  candleSignal: string;
  atrPct: number;
  gapPct: number;
  volatilityRisk: string;
  close: number;
  buyZoneLower: number;
  buyZoneUpper: number;
  buyZoneBasis: string;
  triggerText: string;
  triggerPrice: number;
  entry: number;
  stopLoss: number;
  stopBasis: string;
  target1: number;
  target2: number;
  targetBasis: string;
  rrToT1: number;
  riskPerShare: number;
  quantity: number;
  capitalUsed: number;
  riskAmount: number;
  atr14: number;
  pctFrom52wLow: number;
  pctFrom52wHigh: number;
  marketStructure: string;
  rsi14: number;
  adx14: number;
  volRatio: number;
  avgValueLakhs: number;
  sector: string;
  industry: string;
  fundamentalStatus: string;
  quarterlyComment: string;
  reasons: string[];
  warnings: string[];
}

/* ──────────────────────── Safe-math primitives ──────────────────── */

const isNum = (x: number): boolean => Number.isFinite(x);
const safe = (x: number, fallback = NaN): number => (Number.isFinite(x) ? x : fallback);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function emaArr(values: number[], span: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length === 0) return out;
  const alpha = 2 / (span + 1);
  let prev = values[0]!;
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    if (!isNum(v)) { out[i] = prev; continue; }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing: ewm with alpha = 1/period, min_periods=period. */
function wilderSmooth(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  const alpha = 1 / period;
  // Seed with simple mean of first `period` values
  let acc = 0;
  let count = 0;
  for (let i = 0; i < period; i++) {
    if (isNum(values[i]!)) { acc += values[i]!; count++; }
  }
  if (count === 0) return out;
  let prev = acc / count;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    const v = values[i]!;
    if (!isNum(v)) { out[i] = prev; continue; }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rollingMax(values: number[], window: number, minPeriods = window): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const valid = slice.filter(isNum);
    if (valid.length < minPeriods) continue;
    out[i] = Math.max(...valid);
  }
  return out;
}

function rollingMin(values: number[], window: number, minPeriods = window): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const valid = slice.filter(isNum);
    if (valid.length < minPeriods) continue;
    out[i] = Math.min(...valid);
  }
  return out;
}

function rollingMean(values: number[], window: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (isNum(v)) { sum += v; count++; }
    if (i >= window) {
      const drop = values[i - window]!;
      if (isNum(drop)) { sum -= drop; count--; }
    }
    if (i >= window - 1 && count > 0) out[i] = sum / window;
  }
  return out;
}

function rollingSum(values: number[], window: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += isNum(values[i]!) ? values[i]! : 0;
    if (i >= window) sum -= isNum(values[i - window]!) ? values[i - window]! : 0;
    if (i >= window - 1) out[i] = sum;
  }
  return out;
}

/* ────────────────────────── Indicators ──────────────────────────── */

export function rsi(close: number[], period = 14): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period + 1) return out;
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < n; i++) {
    const d = close[i]! - close[i - 1]!;
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  const avgGain = wilderSmooth(gains, period);
  const avgLoss = wilderSmooth(losses, period);
  for (let i = 0; i < n; i++) {
    const g = avgGain[i]!;
    const l = avgLoss[i]!;
    if (!isNum(g) || !isNum(l)) continue;
    if (l === 0) { out[i] = 100; continue; }
    const rs = g / l;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

export function trueRange(high: number[], low: number[], close: number[]): number[] {
  const n = high.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const hl = high[i]! - low[i]!;
    if (i === 0) { out[i] = hl; continue; }
    const hc = Math.abs(high[i]! - close[i - 1]!);
    const lc = Math.abs(low[i]! - close[i - 1]!);
    out[i] = Math.max(hl, hc, lc);
  }
  return out;
}

export function atr(high: number[], low: number[], close: number[], period = 14): number[] {
  return wilderSmooth(trueRange(high, low, close), period);
}

export interface AdxOutput { adx: number[]; plusDI: number[]; minusDI: number[]; }

export function adx(high: number[], low: number[], close: number[], period = 14): AdxOutput {
  const n = high.length;
  const upMove = new Array<number>(n).fill(0);
  const downMove = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const u = high[i]! - high[i - 1]!;
    const d = low[i - 1]! - low[i]!;
    upMove[i] = u > d && u > 0 ? u : 0;
    downMove[i] = d > u && d > 0 ? d : 0;
  }
  const tr = trueRange(high, low, close);
  const atrSm = wilderSmooth(tr, period);
  const plusSm = wilderSmooth(upMove, period);
  const minusSm = wilderSmooth(downMove, period);
  const plusDI = new Array<number>(n).fill(NaN);
  const minusDI = new Array<number>(n).fill(NaN);
  const dx = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const a = atrSm[i]!;
    if (!isNum(a) || a === 0) continue;
    plusDI[i] = 100 * plusSm[i]! / a;
    minusDI[i] = 100 * minusSm[i]! / a;
    const sum = plusDI[i]! + minusDI[i]!;
    if (sum === 0) continue;
    dx[i] = (Math.abs(plusDI[i]! - minusDI[i]!) / sum) * 100;
  }
  const adxSeries = wilderSmooth(dx, period);
  return { adx: adxSeries, plusDI, minusDI };
}

export function rollingVwap(high: number[], low: number[], close: number[], volume: number[], window = 20): number[] {
  const n = close.length;
  const tp = new Array<number>(n);
  const pv = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    tp[i] = (high[i]! + low[i]! + close[i]!) / 3;
    pv[i] = tp[i]! * volume[i]!;
  }
  const pvSum = rollingSum(pv, window);
  const volSum = rollingSum(volume, window);
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const vs = volSum[i]!;
    if (!isNum(vs) || vs === 0) continue;
    out[i] = pvSum[i]! / vs;
  }
  return out;
}

/** Anchored VWAP — resets cumulative sums at each anchor change.
 *  anchor: "month" | "quarter" | "year" — uses UTC month/quarter/year.
 */
export function anchoredVwap(
  ts: number[],
  high: number[],
  low: number[],
  close: number[],
  volume: number[],
  anchor: "month" | "quarter" | "year",
): number[] {
  const n = ts.length;
  const out = new Array<number>(n).fill(NaN);
  let lastKey: number | null = null;
  let pvSum = 0;
  let vSum = 0;
  for (let i = 0; i < n; i++) {
    const d = new Date(ts[i]!);
    const key =
      anchor === "year" ? d.getUTCFullYear() :
      anchor === "quarter" ? d.getUTCFullYear() * 10 + Math.floor(d.getUTCMonth() / 3) :
      d.getUTCFullYear() * 100 + d.getUTCMonth();
    if (key !== lastKey) { pvSum = 0; vSum = 0; lastKey = key; }
    const tp = (high[i]! + low[i]! + close[i]!) / 3;
    pvSum += tp * volume[i]!;
    vSum += volume[i]!;
    if (vSum > 0) out[i] = pvSum / vSum;
  }
  return out;
}

/* ────────────────── Pivots / market structure / FVG ─────────────── */

export function findPivots(high: number[], low: number[], left = 3, right = 3): { ph: boolean[]; pl: boolean[] } {
  const n = high.length;
  const ph = new Array<boolean>(n).fill(false);
  const pl = new Array<boolean>(n).fill(false);
  if (n < left + right + 1) return { ph, pl };
  for (let i = left; i < n - right; i++) {
    const hWindow = high.slice(i - left, i + right + 1);
    const lWindow = low.slice(i - left, i + right + 1);
    const hMax = Math.max(...hWindow);
    const lMin = Math.min(...lWindow);
    if (high[i] === hMax && hWindow.filter(v => v === hMax).length === 1) ph[i] = true;
    if (low[i] === lMin && lWindow.filter(v => v === lMin).length === 1) pl[i] = true;
  }
  return { ph, pl };
}

export interface MarketStructure {
  bias: "Bullish" | "Bearish" | "Sideways";
  lastSwingHigh: number;
  lastSwingLow: number;
  bosBull: boolean;
  bosBear: boolean;
  bullishSweep: boolean;
  bearishSweep: boolean;
  chochBull: boolean;
  chochBear: boolean;
}

export function marketStructure(bars: DailyBars): MarketStructure {
  const { ph, pl } = findPivots(bars.high, bars.low, 3, 3);
  const phIdx = ph.map((v, i) => v ? i : -1).filter(i => i >= 0).slice(-5);
  const plIdx = pl.map((v, i) => v ? i : -1).filter(i => i >= 0).slice(-5);
  const highs = phIdx.map(i => bars.high[i]!);
  const lows = plIdx.map(i => bars.low[i]!);
  const close = bars.close.at(-1) ?? NaN;
  const prevClose = bars.close.at(-2) ?? close;
  const lastSwingHigh = highs.at(-1) ?? NaN;
  const lastSwingLow = lows.at(-1) ?? NaN;

  const bosBull = isNum(lastSwingHigh) && close > lastSwingHigh;
  const bosBear = isNum(lastSwingLow) && close < lastSwingLow;
  const higherHighs = highs.length >= 2 && highs.at(-1)! > highs.at(-2)!;
  const higherLows = lows.length >= 2 && lows.at(-1)! > lows.at(-2)!;
  const lowerHighs = highs.length >= 2 && highs.at(-1)! < highs.at(-2)!;
  const lowerLows = lows.length >= 2 && lows.at(-1)! < lows.at(-2)!;

  let bias: MarketStructure["bias"] = "Sideways";
  if (bosBull || (higherHighs && higherLows)) bias = "Bullish";
  else if (bosBear || (lowerHighs && lowerLows)) bias = "Bearish";

  const bullishSweep = isNum(lastSwingLow)
    && (bars.low.at(-1) ?? NaN) < lastSwingLow
    && close > lastSwingLow && close > prevClose;
  const bearishSweep = isNum(lastSwingHigh)
    && (bars.high.at(-1) ?? NaN) > lastSwingHigh
    && close < lastSwingHigh && close < prevClose;
  const chochBull = bias !== "Bullish" && isNum(lastSwingHigh) && close > lastSwingHigh;
  const chochBear = bias !== "Bearish" && isNum(lastSwingLow) && close < lastSwingLow;

  return { bias, lastSwingHigh, lastSwingLow, bosBull, bosBear, bullishSweep, bearishSweep, chochBull, chochBear };
}

function isoDateFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function detectFvg(bars: DailyBars, lookback = 120): { bullish: Zone[]; bearish: Zone[] } {
  const start = Math.max(0, bars.close.length - lookback);
  const bullish: Zone[] = [];
  const bearish: Zone[] = [];
  for (let i = start + 2; i < bars.close.length; i++) {
    const c1H = bars.high[i - 2]!, c1L = bars.low[i - 2]!;
    const c2O = bars.open[i - 1]!, c2C = bars.close[i - 1]!, c2H = bars.high[i - 1]!, c2L = bars.low[i - 1]!;
    const c3H = bars.high[i]!, c3L = bars.low[i]!;
    const dt = isoDateFromMs(bars.ts[i]!);
    const rng = Math.max(c2H - c2L, 1e-9);
    const displacement = Math.abs(c2C - c2O);
    const strength = 1 + clamp(displacement / rng, 0, 1.5);
    if (c1H < c3L) bullish.push({ lower: c1H, upper: c3L, label: "Bullish FVG", strength, created: dt });
    if (c1L > c3H) bearish.push({ lower: c3H, upper: c1L, label: "Bearish FVG", strength, created: dt });
  }
  return { bullish, bearish };
}

export function detectSupplyDemandZones(bars: DailyBars, atrSeries: number[], cfg: ScanConfig): { demand: Zone[]; supply: Zone[] } {
  const n = bars.close.length;
  const start = Math.max(0, n - cfg.zoneLookback);
  const close = bars.close.at(-1) ?? NaN;
  const atrNow = safe(atrSeries.at(-1) ?? NaN, Math.max((bars.high.at(-1)! - bars.low.at(-1)!), close * 0.025));
  const buffer = Math.max(0.30 * atrNow, close * 0.0025);
  const avgVol = rollingMean(bars.volume, 20);
  const { ph, pl } = findPivots(bars.high.slice(start), bars.low.slice(start), 3, 3);
  const demand: Zone[] = [];
  const supply: Zone[] = [];
  for (let li = 0; li < ph.length; li++) {
    const i = start + li;
    const dt = isoDateFromMs(bars.ts[i]!);
    const av = avgVol[i] ?? 1;
    const vs = av > 0 ? bars.volume[i]! / av : 1;
    const next = bars.high.slice(i + 1, i + 8);
    const nextLows = bars.low.slice(i + 1, i + 8);
    if (pl[li]) {
      const disp = next.length > 0 ? (Math.max(...next) - bars.low[i]!) / Math.max(atrNow, 1e-9) : 0;
      const strength = clamp(0.8 + 0.4 * vs + 0.25 * disp, 0.5, 4.0);
      const lower = bars.low[i]! - buffer;
      const upper = Math.min(bars.open[i]!, bars.close[i]!) + buffer;
      if (lower < upper) demand.push({ lower, upper, label: "Demand", strength, created: dt });
    }
    if (ph[li]) {
      const disp = nextLows.length > 0 ? (bars.high[i]! - Math.min(...nextLows)) / Math.max(atrNow, 1e-9) : 0;
      const strength = clamp(0.8 + 0.4 * vs + 0.25 * disp, 0.5, 4.0);
      const lower = Math.max(bars.open[i]!, bars.close[i]!) - buffer;
      const upper = bars.high[i]! + buffer;
      if (lower < upper) supply.push({ lower, upper, label: "Supply", strength, created: dt });
    }
  }
  demand.sort((a, b) => (b.strength - a.strength) || (b.created.localeCompare(a.created)));
  supply.sort((a, b) => (b.strength - a.strength) || (b.created.localeCompare(a.created)));
  return { demand: demand.slice(0, 15), supply: supply.slice(0, 15) };
}

export function nearestSupportZone(zones: Zone[], price: number, maxAtrDistance: number, atrNow: number): Zone | null {
  const cand: Array<{ d: number; s: number; z: Zone }> = [];
  for (const z of zones) {
    const touching = z.lower <= price && price <= z.upper;
    const below = z.upper < price;
    if (!touching && !below) continue;
    const dist = touching ? 0 : price - z.upper;
    if (dist <= maxAtrDistance * atrNow) cand.push({ d: dist, s: -z.strength, z });
  }
  if (cand.length === 0) return null;
  cand.sort((a, b) => (a.d - b.d) || (a.s - b.s));
  return cand[0]!.z;
}

export function nearestResistanceZone(zones: Zone[], price: number, maxAtrDistance: number, atrNow: number): Zone | null {
  const cand: Array<{ d: number; s: number; z: Zone }> = [];
  for (const z of zones) {
    const touching = z.lower <= price && price <= z.upper;
    const above = z.lower > price;
    if (!touching && !above) continue;
    const dist = touching ? 0 : z.lower - price;
    if (dist <= maxAtrDistance * atrNow) cand.push({ d: dist, s: -z.strength, z });
  }
  if (cand.length === 0) return null;
  cand.sort((a, b) => (a.d - b.d) || (a.s - b.s));
  return cand[0]!.z;
}

export function fixedVolumeProfile(bars: DailyBars, days = 90, bins = 48): { poc: number; vah: number; val: number } {
  const start = Math.max(0, bars.close.length - days);
  const high = bars.high.slice(start);
  const low = bars.low.slice(start);
  const close = bars.close.slice(start);
  const volume = bars.volume.slice(start);
  if (close.length === 0) return { poc: NaN, vah: NaN, val: NaN };
  const hi = Math.max(...high);
  const lo = Math.min(...low);
  if (hi <= lo) return { poc: NaN, vah: NaN, val: NaN };
  const tps = close.map((c, i) => (high[i]! + low[i]! + c) / 3);
  const binWidth = (hi - lo) / bins;
  const hist = new Array<number>(bins).fill(0);
  for (let i = 0; i < tps.length; i++) {
    let idx = Math.floor((tps[i]! - lo) / binWidth);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    hist[idx]! += volume[i] ?? 0;
  }
  const total = hist.reduce((a, b) => a + b, 0);
  if (total <= 0) return { poc: NaN, vah: NaN, val: NaN };
  const centers = new Array<number>(bins).fill(0).map((_, i) => lo + (i + 0.5) * binWidth);
  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (hist[i]! > hist[pocIdx]!) pocIdx = i;
  const selected = new Set<number>([pocIdx]);
  let volSum = hist[pocIdx]!;
  let left = pocIdx - 1, right = pocIdx + 1;
  while (volSum < total * 0.70 && (left >= 0 || right < bins)) {
    const lv = left >= 0 ? hist[left]! : -1;
    const rv = right < bins ? hist[right]! : -1;
    if (rv >= lv) { selected.add(right); volSum += Math.max(rv, 0); right++; }
    else { selected.add(left); volSum += Math.max(lv, 0); left--; }
  }
  const chosen = Array.from(selected).map(i => centers[i]!);
  return { poc: centers[pocIdx]!, val: Math.min(...chosen), vah: Math.max(...chosen) };
}

/* ─────────────── Weekly / RS / candle / risk modules ────────────── */

function resampleWeekly(bars: DailyBars): DailyBars {
  // W-FRI: each bar ends on Friday (day-of-week 5). Group by ISO-week.
  const buckets = new Map<string, { ts: number; o: number; h: number; l: number; c: number; v: number; lastTs: number }>();
  for (let i = 0; i < bars.ts.length; i++) {
    const d = new Date(bars.ts[i]!);
    // ISO week year-week key
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (tmp.getUTCDay() + 6) % 7;
    tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
    const firstThursday = tmp.valueOf();
    tmp.setUTCMonth(0, 1);
    if (tmp.getUTCDay() !== 4) tmp.setUTCMonth(0, 1 + ((4 - tmp.getUTCDay()) + 7) % 7);
    const week = 1 + Math.ceil((firstThursday - tmp.valueOf()) / 604800000);
    const key = `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    const e = buckets.get(key);
    if (!e) {
      buckets.set(key, { ts: bars.ts[i]!, o: bars.open[i]!, h: bars.high[i]!, l: bars.low[i]!, c: bars.close[i]!, v: bars.volume[i] ?? 0, lastTs: bars.ts[i]! });
    } else {
      e.h = Math.max(e.h, bars.high[i]!);
      e.l = Math.min(e.l, bars.low[i]!);
      e.c = bars.close[i]!;
      e.v += bars.volume[i] ?? 0;
      e.lastTs = bars.ts[i]!;
    }
  }
  const sorted = Array.from(buckets.values()).sort((a, b) => a.ts - b.ts);
  return {
    ts: sorted.map(e => e.lastTs),
    open: sorted.map(e => e.o),
    high: sorted.map(e => e.h),
    low: sorted.map(e => e.l),
    close: sorted.map(e => e.c),
    volume: sorted.map(e => e.v),
  };
}

export interface WeeklyConfirmation { trend: "Bullish" | "Neutral+" | "Neutral" | "Weak" | "Unavailable"; rsi: number; comment: string; }

export function weeklyConfirmation(bars: DailyBars): WeeklyConfirmation {
  const w = resampleWeekly(bars);
  if (w.close.length < 40) return { trend: "Unavailable", rsi: NaN, comment: "Not enough weekly candles" };
  const ema10 = emaArr(w.close, 10);
  const ema30 = emaArr(w.close, 30);
  const rsiW = rsi(w.close, 14);
  const close = w.close.at(-1)!;
  const e10 = ema10.at(-1)!;
  const e30 = ema30.at(-1)!;
  const rW = rsiW.at(-1)!;
  // 4-bar slope %
  const slope = (() => {
    const valid = ema10.filter(isNum);
    if (valid.length <= 5) return NaN;
    const a = valid.at(-5)!;
    const b = valid.at(-1)!;
    return a === 0 ? NaN : (b / a - 1) * 100;
  })();
  if (close > e10 && e10 > e30 && slope > 0) return { trend: "Bullish", rsi: rW, comment: "Weekly close above rising 10W/30W EMA" };
  if (close > e30 && rW >= 45) return { trend: "Neutral+", rsi: rW, comment: "Weekly trend acceptable but not fully strong" };
  if (close < e30) return { trend: "Weak", rsi: rW, comment: "Weekly close below 30W EMA" };
  return { trend: "Neutral", rsi: rW, comment: "Weekly structure mixed" };
}

export function relativeStrengthSnapshot(stockClose: number[], stockTs: number[], benchClose: number[] | null, benchTs: number[] | null): { rs20: number; rs50: number; rs120: number; rsScore: number } {
  const out = { rs20: NaN, rs50: NaN, rs120: NaN, rsScore: 0 };
  if (!benchClose || !benchTs || benchClose.length === 0 || stockClose.length === 0) return out;
  // Align by ISO date (UTC). Build a map for the benchmark.
  const benchByDate = new Map<string, number>();
  for (let i = 0; i < benchTs.length; i++) benchByDate.set(isoDateFromMs(benchTs[i]!), benchClose[i]!);
  const aligned: { s: number; b: number }[] = [];
  for (let i = 0; i < stockTs.length; i++) {
    const b = benchByDate.get(isoDateFromMs(stockTs[i]!));
    if (b !== undefined && isNum(stockClose[i]!) && isNum(b)) aligned.push({ s: stockClose[i]!, b });
  }
  if (aligned.length < 140) return out;
  const computeRS = (bars: number) => {
    if (aligned.length <= bars) return NaN;
    const sNow = aligned.at(-1)!.s;
    const sThen = aligned.at(-1 - bars)!.s;
    const bNow = aligned.at(-1)!.b;
    const bThen = aligned.at(-1 - bars)!.b;
    const sR = (sNow / sThen - 1) * 100;
    const bR = (bNow / bThen - 1) * 100;
    return sR - bR;
  };
  out.rs20 = computeRS(20);
  out.rs50 = computeRS(50);
  out.rs120 = computeRS(120);
  let score = 0;
  if (isNum(out.rs20)) score += clamp(out.rs20, -10, 10) * 0.20;
  if (isNum(out.rs50)) score += clamp(out.rs50, -15, 15) * 0.25;
  if (isNum(out.rs120)) score += clamp(out.rs120, -25, 25) * 0.15;
  out.rsScore = +clamp(score + 5, 0, 10).toFixed(1);
  return out;
}

export interface CandleConfirmation { signal: string; score: number; comment: string; }

export function candleConfirmation(bars: DailyBars): CandleConfirmation {
  if (bars.close.length < 3) return { signal: "Unavailable", score: 0, comment: "Not enough candles" };
  const o = bars.open.at(-1)!, h = bars.high.at(-1)!, l = bars.low.at(-1)!, c = bars.close.at(-1)!;
  const pO = bars.open.at(-2)!, pH = bars.high.at(-2)!, pC = bars.close.at(-2)!;
  const rng = Math.max(h - l, 1e-9);
  const body = Math.abs(c - o);
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const closeLoc = (c - l) / rng;
  if (c > o && pC < pO && c > pO && o <= pC)
    return { signal: "Bullish Engulfing", score: 3.0, comment: "Bullish engulfing candle" };
  if (c > o && lowerWick >= 1.8 * body && closeLoc >= 0.60)
    return { signal: "Hammer / Rejection", score: 2.5, comment: "Lower-wick rejection from support" };
  if (c > pH && closeLoc >= 0.65)
    return { signal: "Previous High Break", score: 2.0, comment: "Close broke previous candle high" };
  if (c > o && closeLoc >= 0.75)
    return { signal: "Strong Bull Close", score: 1.5, comment: "Close in upper part of candle" };
  if (upperWick >= 2.0 * body && closeLoc <= 0.45)
    return { signal: "Rejection / Supply Wick", score: -2.0, comment: "Upper-wick rejection; avoid chasing" };
  return { signal: "Neutral", score: 0, comment: "No clear bullish candle trigger" };
}

export function volatilityAndGapRisk(bars: DailyBars, atrNow: number, close: number): { atrPct: number; gapPct: number; riskLabel: string; warning: string } {
  let atrPct = NaN;
  if (close > 0 && isNum(atrNow)) atrPct = (atrNow / close) * 100;
  let gapPct = NaN;
  if (bars.close.length >= 2) {
    const prevClose = bars.close.at(-2)!;
    const todayOpen = bars.open.at(-1)!;
    if (prevClose > 0) gapPct = (todayOpen / prevClose - 1) * 100;
  }
  const warns: string[] = [];
  let riskLabel = "Normal";
  if (isNum(atrPct) && atrPct > 6.5) { riskLabel = "High Volatility"; warns.push(`ATR% high: ${atrPct.toFixed(1)}%`); }
  else if (isNum(atrPct) && atrPct < 0.8) { riskLabel = "Low Volatility"; warns.push(`ATR% very low: ${atrPct.toFixed(1)}%; move may be slow`); }
  if (isNum(gapPct) && Math.abs(gapPct) > 3.5) { riskLabel = "Gap Risk"; warns.push(`Large opening gap: ${gapPct.toFixed(1)}%`); }
  return { atrPct, gapPct, riskLabel, warning: warns.join("; ") };
}

/* ────────────────────── Fundamental scoring ─────────────────────── */

export function fundamentalScore(f: FundamentalsSnapshot): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const { trailingPe: pe, priceToBook: pb, debtToEquity: de, roe, roa,
          revenueGrowth: rev, earningsGrowth: earn, profitMargins: pm, operatingMargins: om,
          quarterlyRevenueGrowthPct: qr, quarterlyNetIncomeGrowthPct: qn } = f;
  if (isNum(roe) && roe > 0.15) { score += 5; reasons.push("ROE strong"); }
  else if (isNum(roe) && roe > 0.08) { score += 2; reasons.push("ROE acceptable"); }
  if (isNum(roa) && roa > 0.05) { score += 2; reasons.push("ROA positive"); }
  if (isNum(rev) && rev > 0.10) { score += 4; reasons.push("Revenue growth strong"); }
  else if (isNum(rev) && rev > 0) { score += 2; reasons.push("Revenue growth positive"); }
  if (isNum(earn) && earn > 0.10) { score += 4; reasons.push("Earnings growth strong"); }
  else if (isNum(earn) && earn > 0) { score += 2; reasons.push("Earnings growth positive"); }
  if (isNum(pm) && pm > 0.10) { score += 3; reasons.push("Profit margin healthy"); }
  if (isNum(om) && om > 0.12) { score += 2; reasons.push("Operating margin healthy"); }
  if (isNum(de) && de < 100) { score += 3; reasons.push("Debt/equity comfortable"); }
  else if (isNum(de) && de < 180) { score += 1; reasons.push("Debt/equity acceptable"); }
  if (isNum(pe) && pe > 0 && pe < 40) { score += 2; reasons.push("P/E not extreme"); }
  if (isNum(pb) && pb > 0 && pb < 8) { score += 1; reasons.push("P/B acceptable"); }
  if (isNum(qr) && qr > 0) { score += 2; reasons.push("Latest quarter revenue improved"); }
  if (isNum(qn) && qn > 0) { score += 2; reasons.push("Latest quarter profit improved"); }
  return { score: Math.min(score, 30), reasons };
}

export function fundamentalStatusFromScore(score: number): FundamentalsSnapshot["fundamentalStatus"] {
  if (score >= 18) return "Strong";
  if (score >= 11) return "Acceptable";
  if (score >= 5) return "Weak/Mixed";
  return "Poor/Unavailable";
}

/* ──────────────────── Trade plan construction ──────────────────── */

function seriesSlopePct(values: number[], bars: number): number {
  const valid = values.filter(isNum);
  if (valid.length <= bars) return NaN;
  const a = valid.at(-1 - bars)!;
  const b = valid.at(-1)!;
  return a === 0 ? NaN : (b / a - 1) * 100;
}

export function buildBuyZone(close: number, atrNow: number, demand: Zone | null, fvg: Zone | null,
                              volProfile: { poc: number; val: number; vah: number }, ema20: number, cfg: ScanConfig): { zone: { lower: number; upper: number; label: string }; reason: string } {
  const cands: Array<{ dist: number; z: { lower: number; upper: number }; reason: string }> = [];
  if (demand) {
    const dist = (demand.lower <= close && close <= demand.upper) ? 0 : Math.abs(close - demand.upper);
    cands.push({ dist, z: { lower: demand.lower, upper: demand.upper }, reason: "Demand zone" });
  }
  if (fvg) {
    const dist = (fvg.lower <= close && close <= fvg.upper) ? 0 : Math.abs(close - fvg.upper);
    cands.push({ dist, z: { lower: fvg.lower, upper: fvg.upper }, reason: "Bullish FVG" });
  }
  if (isNum(volProfile.val) && isNum(volProfile.poc)) {
    const lower = volProfile.val - 0.20 * atrNow;
    const upper = Math.min(volProfile.poc + 0.20 * atrNow, close + 0.60 * atrNow);
    const dist = (lower <= close && close <= upper) ? 0 : Math.abs(close - upper);
    cands.push({ dist, z: { lower, upper }, reason: "Volume profile value area" });
  }
  if (isNum(ema20)) {
    cands.push({ dist: Math.abs(close - ema20), z: { lower: ema20 - 0.45 * atrNow, upper: ema20 + 0.45 * atrNow }, reason: "EMA20 pullback zone" });
  }
  let lower: number, upper: number, reason: string;
  if (cands.length > 0) {
    cands.sort((a, b) => a.dist - b.dist);
    const base = cands[0]!.z;
    reason = cands[0]!.reason;
    lower = base.lower - 0.10 * atrNow;
    upper = base.upper + cfg.buyZoneAtrBuffer * atrNow;
  } else {
    lower = close - 0.75 * atrNow;
    upper = close + 0.25 * atrNow;
    reason = "ATR pullback zone";
  }
  upper = Math.min(upper, close + 0.50 * atrNow);
  lower = Math.min(lower, upper - 0.10 * atrNow);
  return { zone: { lower, upper, label: "Buy Zone" }, reason };
}

export function buildStop(entry: number, atrNow: number, demand: Zone | null, fvg: Zone | null, lastSwingLow: number, low52: number): { stop: number; basis: string } {
  const supports: Array<[number, string]> = [];
  if (demand) supports.push([demand.lower, "below demand"]);
  if (fvg) supports.push([fvg.lower, "below bullish FVG"]);
  if (isNum(lastSwingLow) && lastSwingLow < entry) supports.push([lastSwingLow, "below swing low"]);
  if (isNum(low52) && low52 < entry) supports.push([low52, "below 52w low"]);
  const atrStop = entry - 1.5 * atrNow;
  if (supports.length === 0) return { stop: atrStop, basis: "ATR stop" };
  supports.sort((a, b) => Math.abs(entry - a[0]) - Math.abs(entry - b[0]));
  const [supportLevel, supportReason] = supports[0]!;
  const structuralStop = supportLevel - 0.25 * atrNow;
  const stop = Math.max(Math.min(structuralStop, entry - 0.65 * atrNow), atrStop);
  return { stop, basis: supportReason };
}

export function buildTargets(entry: number, stop: number, atrNow: number, supply: Zone | null, lastSwingHigh: number, high52: number, volProfile: { vah: number }): { t1: number; t2: number; rr: number; basis: string } {
  const risk = Math.max(entry - stop, 0.10 * atrNow);
  const r2 = entry + 2 * risk;
  const r3 = entry + 3 * risk;
  const candidates: Array<[number, string]> = [];
  if (supply && supply.lower > entry) candidates.push([supply.lower, "nearest supply"]);
  if (isNum(lastSwingHigh) && lastSwingHigh > entry) candidates.push([lastSwingHigh, "swing high"]);
  if (isNum(volProfile.vah) && volProfile.vah > entry) candidates.push([volProfile.vah, "value-area high"]);
  if (isNum(high52) && high52 > entry) candidates.push([high52, "52-week high"]);
  let t1 = r2; let basis = "2R target";
  if (candidates.length > 0) {
    candidates.sort((a, b) => a[0] - b[0]);
    const nearest = candidates[0]!;
    if (nearest[0] >= entry + 1.2 * risk) {
      t1 = Math.min(r2, nearest[0]);
      basis = `2R target / ${nearest[1]}`;
    }
  }
  let t2 = Math.max(r3, t1 + 0.75 * risk);
  if (isNum(high52) && high52 > t1) t2 = Math.min(Math.max(t2, high52), entry + 4.5 * risk);
  const rr = risk > 0 ? (t1 - entry) / risk : NaN;
  return { t1, t2, rr, basis };
}

export function entryTrigger(close: number, buyZone: { lower: number; upper: number }, prevHigh: number, lastSwingHigh: number, monthlyVwap: number, bias: string): { text: string; price: number } {
  const tick = Math.max(0.05, close * 0.0005);
  const inZone = buyZone.lower <= close && close <= buyZone.upper;
  const aboveZone = close > buyZone.upper;
  if (inZone) {
    let trigger = Math.max(prevHigh + tick, isNum(monthlyVwap) ? monthlyVwap : 0);
    trigger = Math.max(trigger, close + tick * 0.5);
    return { text: `Buy only after bullish close above previous high / VWAP: ${trigger.toFixed(2)}`, price: trigger };
  }
  if (aboveZone) {
    const breakout = isNum(lastSwingHigh) && lastSwingHigh > close ? lastSwingHigh : prevHigh + tick;
    if (bias === "Bullish")
      return { text: `Wait for pullback to ${buyZone.lower.toFixed(2)}-${buyZone.upper.toFixed(2)}, then buy bullish reversal; aggressive breakout above ${breakout.toFixed(2)}`, price: breakout };
    return { text: `Wait. Buy only after close above swing high ${breakout.toFixed(2)} or pullback reversal near ${buyZone.upper.toFixed(2)}`, price: breakout };
  }
  const reclaim = buyZone.lower + 0.25 * (buyZone.upper - buyZone.lower);
  return { text: `No buy yet. Wait for reclaim of buy zone and close above ${reclaim.toFixed(2)}`, price: reclaim };
}

export function positionSize(capital: number, riskPct: number, entry: number, stop: number): { qty: number; capitalUsed: number; riskAmount: number; riskPerShare: number } {
  const riskCap = capital * riskPct / 100;
  const riskPerShare = Math.max(entry - stop, 0);
  if (riskPerShare <= 0 || entry <= 0) return { qty: 0, capitalUsed: 0, riskAmount: riskCap, riskPerShare };
  let qty = Math.floor(riskCap / riskPerShare);
  let used = qty * entry;
  if (used > capital) { qty = Math.floor(capital / entry); used = qty * entry; }
  return { qty, capitalUsed: used, riskAmount: qty * riskPerShare, riskPerShare };
}

/* ─────────────────── Action / Setup classification ──────────────── */

export function classifyAction(score: number, close: number, buyZone: { lower: number; upper: number }, rr: number, bias: string, warnings: string[], cfg: ScanConfig): string {
  const inZone = buyZone.lower <= close && close <= buyZone.upper;
  const aboveZone = close > buyZone.upper;
  const belowZone = close < buyZone.lower;
  const weakWarn = warnings.some(w => {
    const lw = w.toLowerCase();
    return lw.startsWith("bearish") || lw.includes("liquidity low") || lw.includes("inside supply");
  });
  if (score < 50 || rr < 1.2 || bias === "Bearish" || weakWarn) return "AVOID / NO TRADE";
  if (score >= 78 && inZone && rr >= cfg.minRr) return "BUY ZONE - WAIT TRIGGER";
  if (score >= 72 && aboveZone && rr >= cfg.minRr) return "BUY BREAKOUT / RETEST ONLY";
  if (score >= 65 && aboveZone) return "WAIT FOR PULLBACK";
  if (score >= 60 && belowZone) return "WAIT FOR RECLAIM";
  if (score >= 58) return "WATCHLIST";
  return "WAIT FOR CONFIRMATION";
}

export function classifySetup(score: number, action: string, nearLow: boolean, nearHigh: boolean): string {
  if (action.includes("BUY ZONE") && score >= 78) return "A+ Buying Zone";
  if (action.includes("BREAKOUT")) return "Breakout / Retest Setup";
  if (nearLow && score >= 60) return "52w Low Reversal Setup";
  if (nearHigh && score >= 65) return "52w High Momentum Setup";
  if (action.includes("WATCHLIST")) return "Watchlist";
  if (action.includes("AVOID")) return "Avoid / Weak Setup";
  return "Wait for Confirmation";
}

export function setupQualityGrade(score: number, rr: number, weeklyTrend: string, rsScore: number, warnings: string): SwingScanResult["qualityGrade"] {
  const lw = warnings.toLowerCase();
  const penalty = ["liquidity low", "inside supply", "bearish structure", "market index context weak"].some(k => lw.includes(k));
  if (score >= 78 && rr >= 2 && (weeklyTrend === "Bullish" || weeklyTrend === "Neutral+") && rsScore >= 5.5 && !penalty) return "A";
  if (score >= 68 && rr >= 1.8 && !penalty) return "B+";
  if (score >= 58 && rr >= 1.5) return "B";
  if (score >= 50) return "C / Watch Only";
  return "D / Avoid";
}

/* ──────────────────────── Main: scoreAndPlan ────────────────────── */

export interface ScoreAndPlanInput {
  symbol: string;
  bars: DailyBars;
  cfg?: Partial<ScanConfig>;
  marketBias?: "Bullish" | "Neutral" | "Weak";
  benchmarkClose?: number[] | null;
  benchmarkTs?: number[] | null;
  fundamentals?: FundamentalsSnapshot | null;
}

export function scoreAndPlan(input: ScoreAndPlanInput): SwingScanResult | { symbol: string; status: string } {
  const cfg: ScanConfig = { ...DEFAULT_CONFIG, ...(input.cfg ?? {}) };
  const bars = input.bars;
  if (!bars || bars.close.length < 220) return { symbol: input.symbol, status: "Insufficient price data" };

  const close = bars.close.at(-1)!;
  const prevClose = bars.close.at(-2)!;
  const prevHigh = bars.high.at(-2)!;
  const ema20 = emaArr(bars.close, cfg.emaFast);
  const ema50 = emaArr(bars.close, cfg.emaMid);
  const ema200 = emaArr(bars.close, cfg.emaSlow);
  const rsiSeries = rsi(bars.close, cfg.rsiPeriod);
  const atrSeries = atr(bars.high, bars.low, bars.close, cfg.atrPeriod);
  const adxOut = adx(bars.high, bars.low, bars.close, cfg.adxPeriod);
  const avgVol20 = rollingMean(bars.volume, 20);
  const closeTimesVol = bars.close.map((c, i) => c * bars.volume[i]!);
  const avgValue20 = rollingMean(closeTimesVol, 20);
  const high20 = rollingMax(bars.high, 20);
  const high52w = rollingMax(bars.high, 252, 120);
  const low52w = rollingMin(bars.low, 252, 120);
  const monthlyAvwap = anchoredVwap(bars.ts, bars.high, bars.low, bars.close, bars.volume, "month");
  const quarterlyAvwap = anchoredVwap(bars.ts, bars.high, bars.low, bars.close, bars.volume, "quarter");
  const ytdAvwap = anchoredVwap(bars.ts, bars.high, bars.low, bars.close, bars.volume, "year");
  const vwap20 = rollingVwap(bars.high, bars.low, bars.close, bars.volume, 20);

  const e20 = ema20.at(-1)!;
  const e50 = ema50.at(-1)!;
  const e200 = ema200.at(-1)!;
  const rsiNow = rsiSeries.at(-1)!;
  const adxNow = adxOut.adx.at(-1)!;
  const plusDI = adxOut.plusDI.at(-1)!;
  const minusDI = adxOut.minusDI.at(-1)!;
  const atrNow = safe(atrSeries.at(-1)!, Math.max(close * 0.025, 1));
  const volRatio = (() => {
    const av = avgVol20.at(-1)!;
    return isNum(av) && av > 0 ? bars.volume.at(-1)! / av : NaN;
  })();
  const avgValueLakhs = (avgValue20.at(-1) ?? 0) / 100_000;
  const high52 = safe(high52w.at(-1)!, Math.max(...bars.high.slice(-252)));
  const low52 = safe(low52w.at(-1)!, Math.min(...bars.low.slice(-252)));
  const pctFromLow = low52 > 0 ? (close / low52 - 1) * 100 : NaN;
  const pctFromHigh = high52 > 0 ? (close / high52 - 1) * 100 : NaN;
  const nearLow = isNum(pctFromLow) && pctFromLow <= cfg.near52wPct;
  const nearHigh = isNum(pctFromHigh) && Math.abs(pctFromHigh) <= cfg.near52wPct;

  const weekly = weeklyConfirmation(bars);
  const rs = relativeStrengthSnapshot(bars.close, bars.ts, input.benchmarkClose ?? null, input.benchmarkTs ?? null);
  const candle = candleConfirmation(bars);
  const risk = volatilityAndGapRisk(bars, atrNow, close);
  const ema20Slope = seriesSlopePct(ema20, 10);
  const ema50Slope = seriesSlopePct(ema50, 20);
  const distEma20Atr = atrNow > 0 ? (close - e20) / atrNow : NaN;
  const ms = marketStructure(bars);
  const fvg = detectFvg(bars, cfg.fvgLookback);
  const zones = detectSupplyDemandZones(bars, atrSeries, cfg);
  const vp = fixedVolumeProfile(bars, cfg.volumeProfileDays);
  const demand = nearestSupportZone(zones.demand, close, 4.0, atrNow);
  const bullFvg = nearestSupportZone(fvg.bullish, close, 4.0, atrNow);
  const supply = nearestResistanceZone(zones.supply, close, 6.0, atrNow);

  let technical = 0, smc = 0, volume = 0, momentum = 0, riskScore = 0, contextScore = 0;
  const reasons: string[] = [];
  const warnings: string[] = [];

  // Trend / market structure (cap 34)
  if (close > e20 && e20 > e50) { technical += 7; reasons.push("Trend bullish: Close > EMA20 > EMA50"); }
  else if (close > e20) { technical += 3; reasons.push("Price above EMA20"); }
  if (close > e200) { technical += 5; reasons.push("Price above EMA200"); }
  else warnings.push("Below EMA200; higher trend is weak");
  if (ms.bias === "Bullish") { technical += 6; reasons.push("Bullish market structure"); }
  else if (ms.bias === "Sideways") { technical += 2; reasons.push("Sideways structure; breakout needed"); }
  else warnings.push("Bearish structure");
  if (plusDI > minusDI && adxNow >= 18) { technical += 4; reasons.push("ADX/DI confirms upward strength"); }
  else if (adxNow < 15) warnings.push("ADX low; trend strength weak");
  const high20Prev = high20.at(-2);
  if (isNum(high20Prev ?? NaN) && close > (high20Prev ?? NaN)) { technical += 3; reasons.push("20-day breakout"); }
  if (weekly.trend === "Bullish") { technical += 5; reasons.push("Weekly trend confirms swing direction"); }
  else if (weekly.trend === "Neutral+") { technical += 2; reasons.push("Weekly trend acceptable"); }
  else if (weekly.trend === "Weak") warnings.push("Weekly trend weak");
  if (isNum(ema20Slope) && ema20Slope > 0) { technical += 2; reasons.push("EMA20 slope positive"); }
  if (isNum(ema50Slope) && ema50Slope > 0) { technical += 2; reasons.push("EMA50 slope positive"); }
  if (isNum(distEma20Atr) && distEma20Atr > 2.5) warnings.push("Price extended far above EMA20; wait for pullback");
  technical = Math.min(technical, 34);

  // SMC / ICT (cap 20)
  const inDemand = !!demand && demand.lower <= close && close <= demand.upper + cfg.buyZoneAtrBuffer * atrNow;
  const inFvg = !!bullFvg && bullFvg.lower <= close && close <= bullFvg.upper + cfg.buyZoneAtrBuffer * atrNow;
  if (inDemand && demand) { smc += 6; reasons.push(`Near demand zone from ${demand.created}`); }
  if (inFvg && bullFvg) { smc += 5; reasons.push(`Near bullish FVG from ${bullFvg.created}`); }
  if (demand && bullFvg && (Math.max(demand.lower, bullFvg.lower) <= Math.min(demand.upper, bullFvg.upper))) {
    smc += 4; reasons.push("Demand overlaps bullish FVG");
  }
  if (ms.bullishSweep) { smc += 3; reasons.push("Bullish liquidity sweep"); }
  if (ms.chochBull) { smc += 2; reasons.push("Bullish CHoCH/BOS"); }
  if (supply && supply.lower <= close && close <= supply.upper) warnings.push("Price is inside supply; avoid chasing");
  smc = Math.min(smc, 20);

  // VWAP / Volume / RS (cap 25)
  const monthlyVwap = monthlyAvwap.at(-1)!;
  if (close > monthlyVwap) { volume += 4; reasons.push("Above monthly anchored VWAP"); }
  if (close > (quarterlyAvwap.at(-1) ?? NaN)) { volume += 3; reasons.push("Above quarterly anchored VWAP"); }
  if (close > (ytdAvwap.at(-1) ?? NaN)) { volume += 2; reasons.push("Above YTD anchored VWAP"); }
  if (close > (vwap20.at(-1) ?? NaN)) { volume += 2; reasons.push("Above 20-day VWAP"); }
  if (isNum(vp.val) && vp.val <= close && close <= vp.vah) { volume += 3; reasons.push("Inside fixed volume value area"); }
  if (isNum(vp.poc) && Math.abs(close - vp.poc) <= 1.25 * atrNow) { volume += 2; reasons.push("Near volume POC"); }
  if (isNum(volRatio) && volRatio > 1.25 && close > prevClose) { volume += 4; reasons.push("Positive volume expansion"); }
  else if (isNum(volRatio) && volRatio >= 0.80) { volume += 1; reasons.push("Volume acceptable"); }
  if (avgValueLakhs < cfg.minAvgValueLakhs) { warnings.push(`Liquidity low: avg traded value ${avgValueLakhs.toFixed(1)} lakhs`); volume -= 4; }
  if (isNum(rs.rs50) && rs.rs50 > 0) { volume += 3; reasons.push("50-day relative strength positive vs benchmark"); }
  if (isNum(rs.rs120) && rs.rs120 > 0) { volume += 2; reasons.push("120-day relative strength positive vs benchmark"); }
  if (isNum(rs.rs20) && rs.rs20 < -3) warnings.push("Short-term relative strength weak vs benchmark");
  volume = clamp(volume, 0, 25);

  // Momentum / 52w (cap 21)
  if (rsiNow >= 45 && rsiNow <= 68) { momentum += 5; reasons.push("RSI in healthy swing zone"); }
  else if (rsiNow >= 35 && rsiNow < 45) { momentum += 2; reasons.push("RSI recovering"); }
  else if (rsiNow > 75) warnings.push("RSI overextended");
  if (nearHigh && close > e50) { momentum += 5; reasons.push("Near 52-week high with trend strength"); }
  if (nearLow && (ms.bullishSweep || close > e20 || rsiNow > 45)) { momentum += 5; reasons.push("Near 52-week low with reversal signs"); }
  else if (!nearLow && !nearHigh) { momentum += 2; reasons.push("Mid-range 52-week location"); }
  if (close > prevHigh) { momentum += 2; reasons.push("Closed above previous candle high"); }
  if (candle.score > 0) { momentum += candle.score; reasons.push(candle.comment); }
  else if (candle.score < 0) warnings.push(candle.comment);
  if (isNum(risk.atrPct) && risk.atrPct >= 1.0 && risk.atrPct <= 5.5) { momentum += 1; reasons.push("ATR% suitable for swing trading"); }
  if (risk.warning) warnings.push(risk.warning);
  momentum = Math.min(momentum, 21);

  // Fundamentals (cap 25)
  const f = input.fundamentals ?? EMPTY_FUNDAMENTALS;
  let fundamentalsComponent = 0;
  if (cfg.includeFundamentals) {
    const fs = fundamentalScore(f);
    fundamentalsComponent = Math.min(fs.score, 25);
    reasons.push(...fs.reasons.slice(0, 5));
  }

  // Market context (cap 5)
  const bias = input.marketBias ?? "Neutral";
  if (bias === "Bullish") { contextScore += 5; reasons.push("Market index context supportive"); }
  else if (bias === "Neutral") contextScore += 2;
  else { warnings.push("Market index context weak"); if (cfg.marketContextRequired) contextScore -= 3; }
  contextScore = clamp(contextScore, 0, 5);

  // Trade plan
  const buy = buildBuyZone(close, atrNow, demand, bullFvg, vp, e20, cfg);
  const trigger = entryTrigger(close, buy.zone, prevHigh, ms.lastSwingHigh, monthlyVwap, ms.bias);
  let plannedEntry: number;
  if (close > buy.zone.upper && ms.bias === "Bullish") plannedEntry = Math.max(trigger.price, close);
  else if (buy.zone.lower <= close && close <= buy.zone.upper) plannedEntry = Math.max(trigger.price, close);
  else plannedEntry = Math.max(trigger.price, buy.zone.lower);
  const stop = buildStop(plannedEntry, atrNow, demand, bullFvg, ms.lastSwingLow, low52);
  const targets = buildTargets(plannedEntry, stop.stop, atrNow, supply, ms.lastSwingHigh, high52, vp);
  const sizing = positionSize(cfg.capital, cfg.riskPerTradePct, plannedEntry, stop.stop);

  if (targets.rr >= cfg.minRr) { riskScore += 7; reasons.push(`R:R acceptable: ${targets.rr.toFixed(2)}R`); }
  else if (targets.rr >= 1.5) { riskScore += 3; warnings.push(`R:R moderate: ${targets.rr.toFixed(2)}R`); }
  else warnings.push(`R:R weak: ${isNum(targets.rr) ? targets.rr.toFixed(2) + "R" : "n/a"}`);
  if (sizing.riskPerShare <= 2.2 * atrNow) riskScore += 3;
  else warnings.push("Stop distance wide versus ATR");
  riskScore = Math.min(riskScore, 10);

  const raw = technical + smc + volume + momentum + fundamentalsComponent + contextScore + riskScore;
  const finalScore = Math.round(clamp(raw / 140 * 100, 0, 100) * 10) / 10;

  const action = classifyAction(finalScore, close, buy.zone, targets.rr, ms.bias, warnings, cfg);
  const setup = classifySetup(finalScore, action, nearLow, nearHigh);
  let potential: SwingScanResult["potential"] = "Low";
  if (finalScore >= 75 && targets.rr >= cfg.minRr) potential = "High";
  else if (finalScore >= 60) potential = "Medium";
  if (action.includes("AVOID")) potential = "Low";
  const grade = setupQualityGrade(finalScore, targets.rr, weekly.trend, rs.rsScore, warnings.join(" | "));

  return {
    symbol: input.symbol,
    status: "OK",
    action,
    setup,
    potential,
    qualityGrade: grade,
    score: finalScore,
    technicalScore: +technical.toFixed(1),
    smcScore: +smc.toFixed(1),
    volumeScore: +volume.toFixed(1),
    momentumScore: +momentum.toFixed(1),
    fundamentalScore: +fundamentalsComponent.toFixed(1),
    riskScore: +riskScore.toFixed(1),
    contextScore: +contextScore.toFixed(1),
    rsScore: rs.rsScore,
    weeklyTrend: weekly.trend,
    weeklyComment: weekly.comment,
    rs20: rs.rs20, rs50: rs.rs50, rs120: rs.rs120,
    candleSignal: candle.signal,
    atrPct: risk.atrPct,
    gapPct: risk.gapPct,
    volatilityRisk: risk.riskLabel,
    close: +close.toFixed(2),
    buyZoneLower: +buy.zone.lower.toFixed(2),
    buyZoneUpper: +buy.zone.upper.toFixed(2),
    buyZoneBasis: buy.reason,
    triggerText: trigger.text,
    triggerPrice: +trigger.price.toFixed(2),
    entry: +plannedEntry.toFixed(2),
    stopLoss: +stop.stop.toFixed(2),
    stopBasis: stop.basis,
    target1: +targets.t1.toFixed(2),
    target2: +targets.t2.toFixed(2),
    targetBasis: targets.basis,
    rrToT1: isNum(targets.rr) ? +targets.rr.toFixed(2) : NaN,
    riskPerShare: +sizing.riskPerShare.toFixed(2),
    quantity: sizing.qty,
    capitalUsed: +sizing.capitalUsed.toFixed(2),
    riskAmount: +sizing.riskAmount.toFixed(2),
    atr14: +atrNow.toFixed(2),
    pctFrom52wLow: isNum(pctFromLow) ? +pctFromLow.toFixed(2) : NaN,
    pctFrom52wHigh: isNum(pctFromHigh) ? +pctFromHigh.toFixed(2) : NaN,
    marketStructure: ms.bias,
    rsi14: +rsiNow.toFixed(1),
    adx14: +adxNow.toFixed(1),
    volRatio: isNum(volRatio) ? +volRatio.toFixed(2) : NaN,
    avgValueLakhs: isNum(avgValueLakhs) ? +avgValueLakhs.toFixed(1) : NaN,
    sector: f.sector,
    industry: f.industry,
    fundamentalStatus: f.fundamentalStatus,
    quarterlyComment: f.quarterlyComment,
    reasons: reasons.slice(0, 14),
    warnings: warnings.slice(0, 8),
  };
}
