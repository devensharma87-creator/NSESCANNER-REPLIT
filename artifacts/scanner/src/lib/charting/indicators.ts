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

// ── Fixed Volume Profile lookback windows ───────────────────────────────────

export type VpWindow = "ALL" | "1Y" | "6M" | "1M" | "1W" | "1D";

/** Window options for the Fixed Volume Profile, longest → shortest. */
export const VP_WINDOWS: { value: VpWindow; label: string; days: number | null }[] = [
  { value: "ALL", label: "All", days: null },
  { value: "1Y", label: "1Y", days: 365 },
  { value: "6M", label: "6M", days: 182 },
  { value: "1M", label: "1M", days: 30 },
  { value: "1W", label: "1W", days: 7 },
  { value: "1D", label: "1D", days: 1 },
];

/**
 * Slice candles to a trailing time window measured back from the LAST candle's
 * timestamp. "ALL" (since inception) returns the input untouched. The cut is by
 * wall-clock time, so it stays correct across any candle timeframe.
 */
export function sliceByWindow(candles: IndicatorCandle[], window: VpWindow): IndicatorCandle[] {
  if (window === "ALL" || candles.length === 0) return candles;
  const days = VP_WINDOWS.find(w => w.value === window)?.days ?? null;
  if (days == null) return candles;
  const lastT = candles[candles.length - 1]!.t;
  const cutoff = lastT - days * 86400;
  return candles.filter(c => c.t >= cutoff);
}

// ── Fibonacci retracement / extension ───────────────────────────────────────

export interface FibLevel {
  ratio: number;
  price: number;
  label: string;
  kind: "retracement" | "extension";
}

export interface FibResult {
  high: number;
  low: number;
  /** "up" = swing low precedes swing high (uptrend); "down" = high precedes low. */
  direction: "up" | "down";
  highIndex: number;
  lowIndex: number;
  levels: FibLevel[];
}

const FIB_RETRACEMENTS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
const FIB_EXTENSIONS = [1.272, 1.618] as const;

function fibLabel(r: number): string {
  return r.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Auto Fibonacci retracement + extension over the dominant swing in the data.
 *
 * The dominant swing is the absolute highest high and lowest low across the
 * provided candles. Trend direction is inferred from which extreme is more
 * recent: low-before-high → uptrend (retraces DOWN from the high, extends UP);
 * high-before-low → downtrend (retraces UP from the low, extends DOWN).
 *
 * Returns null (honestly unavailable) when there are <2 candles or the range is
 * degenerate — never a fabricated level.
 */
export function fibLevels(candles: IndicatorCandle[]): FibResult | null {
  if (candles.length < 2) return null;
  let high = -Infinity;
  let low = Infinity;
  let highIndex = 0;
  let lowIndex = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (Number.isFinite(c.h) && c.h > high) {
      high = c.h;
      highIndex = i;
    }
    if (Number.isFinite(c.l) && c.l < low) {
      low = c.l;
      lowIndex = i;
    }
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return null;
  const range = high - low;
  const direction: "up" | "down" = highIndex >= lowIndex ? "up" : "down";
  const levels: FibLevel[] = [];
  for (const r of FIB_RETRACEMENTS) {
    const price = direction === "up" ? high - r * range : low + r * range;
    levels.push({ ratio: r, price, label: fibLabel(r), kind: "retracement" });
  }
  for (const r of FIB_EXTENSIONS) {
    const price = direction === "up" ? high + (r - 1) * range : low - (r - 1) * range;
    levels.push({ ratio: r, price, label: fibLabel(r), kind: "extension" });
  }
  return { high, low, direction, highIndex, lowIndex, levels };
}

// ── Fixed Volume Profile (volume-by-price) ──────────────────────────────────

export interface VolumeProfileRow {
  priceLo: number;
  priceHi: number;
  mid: number;
  vol: number;
}

export interface FixedVolumeProfile {
  rows: VolumeProfileRow[];
  /** Point of Control — mid-price of the heaviest-volume bin. */
  poc: number;
  /** Value-Area High / Low bounding `vaPct` of total volume around the POC. */
  vah: number;
  val: number;
  totalVol: number;
  maxVol: number;
  /** Number of bars (with positive volume) that fed the profile. */
  bars: number;
}

/**
 * Fixed-range Volume Profile — volume distributed by price across `bins`.
 *
 * APPROXIMATION: without intrabar tick data each candle's volume is spread
 * evenly across the bins its [low, high] range overlaps (same model as
 * `volumeProfilePoc`). POC is the heaviest bin; the value area grows outward
 * from the POC until it covers `vaPct` (default 70%) of total volume.
 *
 * Returns null (honestly unavailable) when no bar has positive volume or the
 * price range is degenerate — never a fabricated profile.
 */
export function fixedVolumeProfile(
  candles: IndicatorCandle[],
  bins = 48,
  vaPct = 0.7,
): FixedVolumeProfile | null {
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
  const vols = new Array(bins).fill(0) as number[];
  for (const c of withVol) {
    const v = c.v as number;
    const startBin = Math.max(0, Math.min(bins - 1, Math.floor((c.l - lo) / binSize)));
    const endBin = Math.max(0, Math.min(bins - 1, Math.floor((c.h - lo) / binSize)));
    const span = endBin - startBin + 1;
    const per = v / span;
    for (let b = startBin; b <= endBin; b++) vols[b]! += per;
  }
  let pocIdx = 0;
  for (let b = 1; b < bins; b++) if (vols[b]! > vols[pocIdx]!) pocIdx = b;
  const totalVol = vols.reduce((a, b) => a + b, 0);
  const target = totalVol * vaPct;
  let vaVol = vols[pocIdx]!;
  let lower = pocIdx;
  let upper = pocIdx;
  while (vaVol < target && (lower > 0 || upper < bins - 1)) {
    const lv = lower > 0 ? vols[lower - 1]! : -1;
    const uv = upper < bins - 1 ? vols[upper + 1]! : -1;
    if (uv >= lv && upper < bins - 1) {
      upper++;
      vaVol += uv;
    } else if (lower > 0) {
      lower--;
      vaVol += lv;
    } else break;
  }
  const rows: VolumeProfileRow[] = vols.map((vol, b) => ({
    priceLo: lo + b * binSize,
    priceHi: lo + (b + 1) * binSize,
    mid: lo + (b + 0.5) * binSize,
    vol,
  }));
  let maxVol = 0;
  for (const r of rows) if (r.vol > maxVol) maxVol = r.vol;
  return {
    rows,
    poc: lo + (pocIdx + 0.5) * binSize,
    val: lo + lower * binSize,
    vah: lo + (upper + 1) * binSize,
    totalVol,
    maxVol,
    bars: withVol.length,
  };
}

// ── Price-action swing pivots + major Support/Resistance ────────────────────

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: "high" | "low";
}

/**
 * Fractal swing pivots: a bar whose high is the strict maximum (or low the
 * strict minimum) of the window ±`span`. Pure price geometry — used as the
 * price-action seed for Support/Resistance. The leading/trailing `span` bars
 * can never be pivots (no confirming bars), so they are skipped.
 */
export function swingPivots(candles: IndicatorCandle[], span = 3): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = span; i < candles.length - span; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue;
      if (candles[j]!.h >= c.h) isHigh = false;
      if (candles[j]!.l <= c.l) isLow = false;
    }
    if (isHigh) out.push({ index: i, time: c.t, price: c.h, type: "high" });
    if (isLow) out.push({ index: i, time: c.t, price: c.l, type: "low" });
  }
  return out;
}

export type LevelSource = "Fib" | "Price Action" | "Call OI" | "Put OI";

export interface KeyLevel {
  price: number;
  sources: LevelSource[];
  score: number;
  kind: "support" | "resistance";
  /** S1/S2/S3 (nearest support first) or R1/R2/R3 (nearest resistance first). */
  label: string;
}

export interface OptionLevels {
  /** Strikes with the heaviest PUT OI — option-chain support. */
  supports: number[];
  /** Strikes with the heaviest CALL OI — option-chain resistance. */
  resistances: number[];
}

export interface KeyLevelsResult {
  supports: KeyLevel[];
  resistances: KeyLevel[];
  /** True only when option-chain levels actually contributed (F&O underlyings). */
  usedOptionChain: boolean;
}

const SOURCE_WEIGHT: Record<LevelSource, number> = {
  "Call OI": 1.2,
  "Put OI": 1.2,
  "Price Action": 1.0,
  Fib: 0.8,
};

const SOURCE_ORDER: Record<LevelSource, number> = {
  "Price Action": 0,
  Fib: 1,
  "Put OI": 2,
  "Call OI": 3,
};

interface LevelCandidate {
  price: number;
  source: LevelSource;
  weight: number;
}

/**
 * Major Support/Resistance from three independent sources — Fibonacci, Price
 * Action (swing pivots), and Option Chain (heaviest CALL/PUT OI strikes).
 *
 * Candidate levels are clustered within `tolerancePct` of the current price;
 * each cluster's score sums its members' source weights with a confluence bonus
 * for agreement across distinct sources. The top `maxPerSide` clusters below the
 * price become supports (numbered nearest-first), the top above become
 * resistances. Each returned level carries the source tags that back it.
 *
 * `optionLevels` is optional and only present for F&O underlyings; when absent,
 * S/R is honestly computed from the two available sources and `usedOptionChain`
 * is false. Returns null when there is too little data to seed any candidate.
 */
export function computeKeyLevels(
  candles: IndicatorCandle[],
  currentPrice: number,
  optionLevels?: OptionLevels | null,
  opts?: { tolerancePct?: number; maxPerSide?: number },
): KeyLevelsResult | null {
  if (candles.length < 5 || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  const tolerancePct = opts?.tolerancePct ?? 0.4;
  const maxPerSide = opts?.maxPerSide ?? 3;
  const candidates: LevelCandidate[] = [];

  // Price action: most-recent swing pivots.
  for (const p of swingPivots(candles, 3).slice(-16)) {
    candidates.push({ price: p.price, source: "Price Action", weight: SOURCE_WEIGHT["Price Action"] });
  }

  // Fibonacci levels.
  const fib = fibLevels(candles);
  if (fib) {
    for (const l of fib.levels) {
      candidates.push({ price: l.price, source: "Fib", weight: SOURCE_WEIGHT.Fib });
    }
  }

  // Option chain (F&O only).
  let usedOptionChain = false;
  if (optionLevels) {
    for (const s of optionLevels.supports) {
      if (Number.isFinite(s) && s > 0) {
        candidates.push({ price: s, source: "Put OI", weight: SOURCE_WEIGHT["Put OI"] });
        usedOptionChain = true;
      }
    }
    for (const r of optionLevels.resistances) {
      if (Number.isFinite(r) && r > 0) {
        candidates.push({ price: r, source: "Call OI", weight: SOURCE_WEIGHT["Call OI"] });
        usedOptionChain = true;
      }
    }
  }

  if (candidates.length === 0) return null;

  // Cluster nearby candidates (sorted by price) within tolerance.
  const tol = currentPrice * (tolerancePct / 100);
  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  interface Cluster {
    sumW: number;
    wPriceSum: number;
    sources: Set<LevelSource>;
  }
  const clusters: Cluster[] = [];
  for (const cand of sorted) {
    const last = clusters[clusters.length - 1];
    const lastPrice = last ? last.wPriceSum / last.sumW : null;
    if (last && lastPrice != null && Math.abs(cand.price - lastPrice) <= tol) {
      last.sumW += cand.weight;
      last.wPriceSum += cand.price * cand.weight;
      last.sources.add(cand.source);
    } else {
      clusters.push({
        sumW: cand.weight,
        wPriceSum: cand.price * cand.weight,
        sources: new Set([cand.source]),
      });
    }
  }

  const built = clusters.map(cl => ({
    price: cl.wPriceSum / cl.sumW,
    sources: [...cl.sources].sort((a, b) => SOURCE_ORDER[a] - SOURCE_ORDER[b]),
    score: cl.sumW * (1 + 0.5 * (cl.sources.size - 1)),
  }));

  // Rank by confluence score; on ties prefer the level NEAREST the current price
  // (smaller distance first) so the strongest, closest levels survive the top-N
  // slice. Then renumber nearest-first for S1..S3 / R1..R3 labels.
  const byScoreThenNearest = (a: { price: number; score: number }, b: { price: number; score: number }) =>
    b.score - a.score || Math.abs(currentPrice - a.price) - Math.abs(currentPrice - b.price);

  const supports: KeyLevel[] = built
    .filter(b => b.price < currentPrice)
    .sort(byScoreThenNearest)
    .slice(0, maxPerSide)
    .sort((a, b) => b.price - a.price)
    .map((b, i) => ({ ...b, kind: "support" as const, label: `S${i + 1}` }));

  const resistances: KeyLevel[] = built
    .filter(b => b.price > currentPrice)
    .sort(byScoreThenNearest)
    .slice(0, maxPerSide)
    .sort((a, b) => a.price - b.price)
    .map((b, i) => ({ ...b, kind: "resistance" as const, label: `R${i + 1}` }));

  return { supports, resistances, usedOptionChain };
}
