/**
 * All-in-One F&O Trend + SMC — a faithful, pure-TypeScript port of the attached
 * Pine v5 "All-in-One F&O Trend + SMC v2" indicator, surfaced on the read-only
 * Charting tab as a single combined overlay with a configurable parameter set.
 *
 * Like the rest of `lib/charting`, every function here is pure: it takes candle
 * arrays + params and returns index-aligned data, using `null` wherever a value
 * is genuinely unavailable rather than fabricating one. VWAP (and therefore its
 * bands, and the "price vs VWAP" score factor) needs real volume — on sources
 * without it the VWAP series is null and that factor is honestly counted as
 * neutral. The Higher-Timeframe bias is computed from a SEPARATELY-fetched HTF
 * candle series and aligned to each base bar by timestamp; when no HTF series is
 * supplied the filter reports as Unavailable and drops out of the score.
 *
 * NOTHING here places orders, mutates state, or feeds any trading decision — it
 * is visualization math only.
 */

import type { IndicatorCandle } from "./indicators";
import { ema, vwap } from "./indicators";
import {
  structurePass,
  fvgPass,
  swingZonePass,
  type SmcConfig,
} from "@workspace/indicators";

// ── Dashboard position ──────────────────────────────────────────────────────
export type DashPosition = "Top Right" | "Top Left" | "Bottom Right" | "Bottom Left";

// ── Params (defaults mirror the Pine inputs) ────────────────────────────────
export interface FnoSmcParams {
  // Moving averages
  showEma9: boolean;
  showEma20: boolean;
  showEma50: boolean;
  ema9Len: number;
  ema20Len: number;
  ema50Len: number;
  // VWAP
  showVwap: boolean;
  showVwapBands: boolean;
  // Higher-timeframe filter
  useHtf: boolean;
  htfTimeframe: string;
  // Supply / demand zones
  showZones: boolean;
  zPivot: number;
  zMax: number;
  zoneBody: boolean;
  hideTested: boolean;
  // Fair value gaps
  showFvg: boolean;
  fvgAuto: boolean;
  fvgThrPct: number;
  fvgRemoveMitigated: boolean;
  maxFvg: number;
  // Smart-money structure
  showSmc: boolean;
  smcPivot: number;
  // Trade signals
  showSignals: boolean;
  rrTarget: number;
  slBufAtr: number;
  reqHtf: boolean;
  reqZone: boolean;
  // Dashboard
  showDashboard: boolean;
  dashPosition: DashPosition;
}

export const DEFAULT_FNO_SMC_PARAMS: FnoSmcParams = {
  showEma9: true,
  showEma20: true,
  showEma50: true,
  ema9Len: 9,
  ema20Len: 20,
  ema50Len: 50,
  showVwap: true,
  showVwapBands: true,
  useHtf: true,
  htfTimeframe: "1h",
  showZones: true,
  zPivot: 10,
  zMax: 3,
  zoneBody: true,
  hideTested: true,
  showFvg: true,
  fvgAuto: true,
  fvgThrPct: 0.08,
  fvgRemoveMitigated: true,
  maxFvg: 6,
  showSmc: true,
  smcPivot: 7,
  showSignals: true,
  rrTarget: 2,
  slBufAtr: 0.5,
  reqHtf: true,
  reqZone: true,
  showDashboard: true,
  dashPosition: "Top Right",
};

// EMA colors lifted straight from the Pine `input.color` defaults.
export const FNO_EMA_COLORS = {
  ema9: "#26C6DA",
  ema20: "#FF9800",
  ema50: "#AB47BC",
} as const;

export const FNO_VWAP_COLOR = "#E040FB";

// ── Result shapes ───────────────────────────────────────────────────────────
export interface FnoEmaLine {
  period: number;
  color: string;
  values: (number | null)[];
}

export interface FnoVwapBands {
  vwap: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export interface SmcZone {
  time: number;
  top: number;
  bottom: number;
  type: "demand" | "supply" | "fvgBull" | "fvgBear";
  tested: boolean;
  label?: string;
}

export interface StructureEvent {
  time: number;
  price: number;
  kind: "BOS" | "CHoCH";
  dir: "up" | "down";
}

export interface TradeSignal {
  time: number;
  dir: "long" | "short";
  entry: number;
  sl: number;
  tgt: number;
  rr: number;
}

export interface FnoSmcDashboard {
  trendText: string;
  trendColor: string;
  score: number;
  maxScore: number;
  emaText: "Bullish" | "Bearish" | "Flat";
  vwapText: "Above" | "Below" | "n/a";
  biasText: "Up" | "Down";
  structureText: "Bullish" | "Bearish" | "—";
  htfText: "Bullish" | "Bearish" | "OFF" | "Unavailable";
  signalText: string;
}

export interface FnoSmcResult {
  emas: FnoEmaLine[];
  vwap: FnoVwapBands | null;
  zones: SmcZone[];
  structure: StructureEvent[];
  signals: TradeSignal[];
  latestSignal: TradeSignal | null;
  htfAvailable: boolean;
  dashboard: FnoSmcDashboard;
}

// ── Small numeric helpers ───────────────────────────────────────────────────

/** Wilder's ATR (RMA of true range). Returns null until `period` bars exist. */
export function atr(candles: IndicatorCandle[], period = 14): (number | null)[] {
  const n = candles.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n === 0) return out;
  const tr: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    if (i === 0) {
      tr[i] = c.h - c.l;
    } else {
      const pc = candles[i - 1]!.c;
      tr[i] = Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
    }
  }
  if (n < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/** Rolling population standard deviation over a fixed window. */
export function rollingStdev(values: number[], length: number): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (length <= 0) return out;
  for (let i = length - 1; i < n; i++) {
    let mean = 0;
    for (let k = i - length + 1; k <= i; k++) mean += values[k]!;
    mean /= length;
    let varSum = 0;
    for (let k = i - length + 1; k <= i; k++) {
      const d = values[k]! - mean;
      varSum += d * d;
    }
    out[i] = Math.sqrt(varSum / length);
  }
  return out;
}

/** VWAP + ±1σ bands (σ = rolling stdev of hlc3 over 20). Null where VWAP is. */
export function vwapWithBands(candles: IndicatorCandle[]): FnoVwapBands {
  const vw = vwap(candles, true);
  const hlc3 = candles.map(c => (c.h + c.l + c.c) / 3);
  const sigma = rollingStdev(hlc3, 20);
  const upper: (number | null)[] = new Array(candles.length).fill(null);
  const lower: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const v = vw[i];
    const s = sigma[i];
    if (v != null && Number.isFinite(v) && s != null && Number.isFinite(s)) {
      upper[i] = v + s;
      lower[i] = v - s;
    }
  }
  return { vwap: vw, upper, lower };
}

// ── SMC structure (BOS / CHoCH) ─────────────────────────────────────────────
export interface StructureResult {
  events: StructureEvent[];
  /** Per-bar: was a BOS/CHoCH printed this bar, and the running structure dir. */
  perBar: { bosUp: boolean; bosDn: boolean; structDir: number }[];
}

/**
 * Break of Structure / Change of Character — now a thin chart-shaped adapter
 * over the shared causal `structurePass` in `@workspace/indicators`, so the
 * scanner, the live engine and the Backtest Lab all consume ONE copy of the
 * structure state-machine. Maps each per-bar `StructurePoint` to the chart's
 * `StructureEvent`s (up before down, matching the prior ordering) and `perBar`
 * flags. A CHoCH still counts as a structure break for the per-bar `bosUp/bosDn`
 * direction flags the signal engine reads.
 */
export function smcStructure(candles: IndicatorCandle[], pivot: number): StructureResult {
  const high = candles.map(c => c.h);
  const low = candles.map(c => c.l);
  const close = candles.map(c => c.c);
  const pts = structurePass(high, low, close, pivot);
  const events: StructureEvent[] = [];
  const perBar = pts.map((p, i) => {
    const cur = candles[i]!;
    if (p.bosUp || p.chochUp) {
      events.push({ time: cur.t, price: p.breakHigh!, kind: p.chochUp ? "CHoCH" : "BOS", dir: "up" });
    }
    if (p.bosDn || p.chochDn) {
      events.push({ time: cur.t, price: p.breakLow!, kind: p.chochDn ? "CHoCH" : "BOS", dir: "down" });
    }
    return {
      bosUp: p.bosUp || p.chochUp,
      bosDn: p.bosDn || p.chochDn,
      structDir: p.structDir as number,
    };
  });
  return { events, perBar };
}

// ── Supply / demand zones ───────────────────────────────────────────────────
export interface ZonesResult {
  zones: SmcZone[];
  perBar: { demandRetest: boolean; supplyRetest: boolean }[];
}

/**
 * Tight, freshness-aware supply/demand (order-block) zones at fractal swings —
 * now a thin chart-shaped adapter over the shared causal `swingZonePass` in
 * `@workspace/indicators`, so the scanner, the live engine and the Backtest Lab
 * all detect zones from ONE copy of the math (identical pivot lag, body/wick
 * bounds, and once-per-zone retest rule). The shared pass owns detection +
 * lifecycle; the chart layers its own render policy on top: the latest `zMax`
 * formed zones per side, optionally hiding tested ones (`hideTested`). The
 * per-bar `demand/supplyRetest` flags (consumed by the signal engine) map
 * directly from the shared pass's `demand/supplyTest`.
 */
export function supplyDemandZones(
  candles: IndicatorCandle[],
  params: FnoSmcParams,
  atrArr: (number | null)[],
): ZonesResult {
  const open = candles.map(c => c.o);
  const high = candles.map(c => c.h);
  const low = candles.map(c => c.l);
  const close = candles.map(c => c.c);
  const cfg: SmcConfig = {
    structurePivot: params.smcPivot,
    zonePivot: params.zPivot,
    maxZones: params.zMax,
    fvgAuto: params.fvgAuto,
    fvgThresholdPct: params.fvgThrPct,
    maxFvg: Number.POSITIVE_INFINITY,
    displacementAtrMult: 1.2,
    sweepPivot: 5,
  };
  const { zones: raw, perBar: zoneBars } = swingZonePass(open, high, low, close, atrArr, cfg, params.zoneBody);
  const perBar = zoneBars.map(z => ({ demandRetest: z.demandTest, supplyRetest: z.supplyTest }));
  const mapSide = (type: "demand" | "supply"): SmcZone[] =>
    raw
      .filter(z => z.type === type)
      .slice(-params.zMax)
      .map(z => ({
        time: candles[z.formedIndex]!.t,
        top: z.top,
        bottom: z.bottom,
        type,
        tested: z.firstTestIndex != null,
        label: type === "demand" ? "Demand" : "Supply",
      }));
  let zones = [...mapSide("demand"), ...mapSide("supply")];
  if (params.hideTested) zones = zones.filter(z => !z.tested);
  return { zones, perBar };
}

// ── Fair value gaps (threshold + mitigation) ────────────────────────────────
/**
 * 3-candle Fair Value Gaps — now a chart-shaped adapter over the shared causal
 * `fvgPass` in `@workspace/indicators` (same size gate: auto = running mean of
 * (high-low)/|low|, or a manual % floor; same mitigation rule). The shared pass
 * is run UNCAPPED (`maxFvg: Infinity`) so its first-mitigation indices are exact
 * for every gap; the chart then applies its own `fvgRemoveMitigated` filter and
 * `maxFvg` most-recent slice for rendering, preserving the prior output.
 */
export function fnoFvgs(candles: IndicatorCandle[], params: FnoSmcParams): SmcZone[] {
  const open = candles.map(c => c.o);
  const high = candles.map(c => c.h);
  const low = candles.map(c => c.l);
  const close = candles.map(c => c.c);
  const cfg: SmcConfig = {
    structurePivot: params.smcPivot,
    zonePivot: params.zPivot,
    maxZones: params.zMax,
    fvgAuto: params.fvgAuto,
    fvgThresholdPct: params.fvgThrPct,
    maxFvg: Number.POSITIVE_INFINITY,
    displacementAtrMult: 1.2,
    sweepPivot: 5,
  };
  const { zones } = fvgPass(open, high, low, close, cfg);
  const mapped: SmcZone[] = zones.map(z => ({
    time: candles[z.formedIndex]!.t,
    top: z.top,
    bottom: z.bottom,
    type: z.type,
    tested: z.mitigatedIndex != null,
  }));
  const kept = params.fvgRemoveMitigated ? mapped.filter(z => !z.tested) : mapped;
  return params.maxFvg > 0 ? kept.slice(-params.maxFvg) : kept;
}

// ── HTF bias alignment ──────────────────────────────────────────────────────
/**
 * Per-base-bar HTF bias (1 bull / -1 bear / 0 unknown) computed from the HTF
 * EMA(fast) vs EMA(slow) and aligned by timestamp: each base bar takes the most
 * recent HTF bar that had already closed at or before it (no look-ahead). When
 * `htfCandles` is empty every bar is 0 (unknown) — honestly unavailable.
 */
export function alignHtfBias(
  ltf: IndicatorCandle[],
  htf: IndicatorCandle[],
  fast: number,
  slow: number,
): number[] {
  const out = new Array(ltf.length).fill(0) as number[];
  if (htf.length === 0) return out;
  const closes = htf.map(c => c.c);
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const bias = new Array(htf.length).fill(0) as number[];
  for (let i = 0; i < htf.length; i++) {
    const f = fastE[i];
    const s = slowE[i];
    if (f != null && s != null && Number.isFinite(f) && Number.isFinite(s)) {
      bias[i] = f > s ? 1 : f < s ? -1 : 0;
    }
  }
  let h = 0;
  for (let i = 0; i < ltf.length; i++) {
    const t = ltf[i]!.t;
    while (h + 1 < htf.length && htf[h + 1]!.t <= t) h++;
    out[i] = htf[h]!.t <= t ? bias[h]! : 0;
  }
  return out;
}

// ── Trend score + signals (the orchestrator) ────────────────────────────────

function trendLabel(score: number): { text: string; color: string } {
  if (score >= 4) return { text: "STRONG BULLISH", color: "#00C853" };
  if (score >= 2) return { text: "BULLISH", color: "#43A047" };
  if (score >= 1) return { text: "WEAK BULL", color: "#9CCC65" };
  if (score <= -4) return { text: "STRONG BEARISH", color: "#D50000" };
  if (score <= -2) return { text: "BEARISH", color: "#E53935" };
  if (score <= -1) return { text: "WEAK BEAR", color: "#EF9A9A" };
  return { text: "NEUTRAL / RANGE", color: "#757575" };
}

/**
 * Full combined indicator. Computes EMAs, VWAP+bands, zones, FVGs, structure,
 * the multi-factor trend score (EMA alignment · price vs VWAP · 50-EMA bias ·
 * structure · HTF), the confluence trade signals, and the final-bar dashboard.
 *
 * `htfCandles` is the SEPARATELY-fetched higher-timeframe series; pass an empty
 * array when it is unavailable — the HTF factor then drops out of the score and
 * the dashboard reports it as Unavailable.
 */
export function computeFnoSmc(
  candles: IndicatorCandle[],
  htfCandles: IndicatorCandle[],
  params: FnoSmcParams,
): FnoSmcResult {
  const n = candles.length;
  const closes = candles.map(c => c.c);
  const ema9 = ema(closes, params.ema9Len);
  const ema20 = ema(closes, params.ema20Len);
  const ema50 = ema(closes, params.ema50Len);
  const atrArr = atr(candles, 14);

  const emas: FnoEmaLine[] = [];
  if (params.showEma9) emas.push({ period: params.ema9Len, color: FNO_EMA_COLORS.ema9, values: ema9 });
  if (params.showEma20) emas.push({ period: params.ema20Len, color: FNO_EMA_COLORS.ema20, values: ema20 });
  if (params.showEma50) emas.push({ period: params.ema50Len, color: FNO_EMA_COLORS.ema50, values: ema50 });

  const bands = vwapWithBands(candles);
  const vwapAvailable = bands.vwap.some(v => v != null);
  // `showVwapBands` only controls the ±1σ envelope; the VWAP mid-line still
  // shows whenever `showVwap` is on. Null out the band arrays when disabled so
  // the renderer (which skips all-null bands) draws the mid-line only.
  const vwapOut: FnoVwapBands | null =
    params.showVwap && vwapAvailable
      ? params.showVwapBands
        ? bands
        : { vwap: bands.vwap, upper: bands.vwap.map(() => null), lower: bands.vwap.map(() => null) }
      : null;

  const struct = params.showSmc
    ? smcStructure(candles, params.smcPivot)
    : { events: [], perBar: Array.from({ length: n }, () => ({ bosUp: false, bosDn: false, structDir: 0 })) };

  const zonesRes = params.showZones
    ? supplyDemandZones(candles, params, atrArr)
    : { zones: [], perBar: Array.from({ length: n }, () => ({ demandRetest: false, supplyRetest: false })) };

  const fvgs = params.showFvg ? fnoFvgs(candles, params) : [];

  const htfBias = params.useHtf ? alignHtfBias(candles, htfCandles, params.ema9Len, params.ema20Len) : new Array(n).fill(0);
  const htfAvailable = params.useHtf && htfCandles.length > 0 && htfBias.some(b => b !== 0);
  const useHtfEffective = params.useHtf && htfAvailable;
  const maxScore = useHtfEffective ? 5 : 4;

  // Per-bar score + the signal engine.
  const signals: TradeSignal[] = [];
  const perBarScore = new Array(n).fill(0) as number[];
  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    const e9 = ema9[i];
    const e20 = ema20[i];
    const e50 = ema50[i];
    const v = bands.vwap[i];
    const emaUp = e9 != null && e20 != null && e9 > e20 && c.c > e9;
    const emaDn = e9 != null && e20 != null && e9 < e20 && c.c < e9;
    const vUp = v != null && c.c > v;
    const vDn = v != null && c.c < v;
    const biasUp = e50 != null && c.c > e50;
    const biasDn = e50 != null && c.c < e50;
    const structUp = struct.perBar[i]!.structDir === 1;
    const structDn = struct.perBar[i]!.structDir === -1;
    const htfBull = htfBias[i] === 1;
    const htfBear = htfBias[i] === -1;
    const scoreUp =
      (emaUp ? 1 : 0) + (vUp ? 1 : 0) + (biasUp ? 1 : 0) + (structUp ? 1 : 0) + (useHtfEffective && htfBull ? 1 : 0);
    const scoreDn =
      (emaDn ? 1 : 0) + (vDn ? 1 : 0) + (biasDn ? 1 : 0) + (structDn ? 1 : 0) + (useHtfEffective && htfBear ? 1 : 0);
    const score = scoreUp - scoreDn;
    perBarScore[i] = score;

    if (!params.showSignals) continue;
    const trendUp = score >= 2;
    const trendDn = score <= -2;
    const prev = i > 0 ? candles[i - 1]! : null;
    const e9prev = i > 0 ? ema9[i - 1] : null;
    const crossUp = prev != null && e9prev != null && e9 != null && prev.c <= e9prev && c.c > e9;
    const crossDn = prev != null && e9prev != null && e9 != null && prev.c >= e9prev && c.c < e9;
    const trigUp = crossUp || struct.perBar[i]!.bosUp;
    const trigDn = crossDn || struct.perBar[i]!.bosDn;
    const htfOkUp = params.reqHtf && useHtfEffective ? htfBull : true;
    const htfOkDn = params.reqHtf && useHtfEffective ? htfBear : true;
    const zoneOkUp = params.reqZone ? zonesRes.perBar[i]!.demandRetest : true;
    const zoneOkDn = params.reqZone ? zonesRes.perBar[i]!.supplyRetest : true;
    const a = atrArr[i];
    if (trendUp && htfOkUp && zoneOkUp && trigUp && a != null) {
      const entry = c.c;
      const sl = entry - a * (1 + params.slBufAtr);
      const risk = Math.abs(entry - sl);
      signals.push({ time: c.t, dir: "long", entry, sl, tgt: entry + risk * params.rrTarget, rr: params.rrTarget });
    } else if (trendDn && htfOkDn && zoneOkDn && trigDn && a != null) {
      const entry = c.c;
      const sl = entry + a * (1 + params.slBufAtr);
      const risk = Math.abs(entry - sl);
      signals.push({ time: c.t, dir: "short", entry, sl, tgt: entry - risk * params.rrTarget, rr: params.rrTarget });
    }
  }

  const last = n - 1;
  const lastScore = n > 0 ? perBarScore[last]! : 0;
  const label = trendLabel(lastScore);
  const lc = n > 0 ? candles[last]! : null;
  const e9L = n > 0 ? ema9[last] : null;
  const e20L = n > 0 ? ema20[last] : null;
  const e50L = n > 0 ? ema50[last] : null;
  const vL = n > 0 ? bands.vwap[last] : null;
  const emaText: FnoSmcDashboard["emaText"] =
    lc && e9L != null && e20L != null && e9L > e20L && lc.c > e9L
      ? "Bullish"
      : lc && e9L != null && e20L != null && e9L < e20L && lc.c < e9L
        ? "Bearish"
        : "Flat";
  const vwapText: FnoSmcDashboard["vwapText"] =
    lc && vL != null ? (lc.c > vL ? "Above" : "Below") : "n/a";
  const biasText: FnoSmcDashboard["biasText"] = lc && e50L != null && lc.c > e50L ? "Up" : "Down";
  const lastStructDir = n > 0 ? struct.perBar[last]!.structDir : 0;
  const structureText: FnoSmcDashboard["structureText"] =
    lastStructDir === 1 ? "Bullish" : lastStructDir === -1 ? "Bearish" : "—";
  const htfText: FnoSmcDashboard["htfText"] = !params.useHtf
    ? "OFF"
    : !htfAvailable
      ? "Unavailable"
      : htfBias[last] === 1
        ? "Bullish"
        : htfBias[last] === -1
          ? "Bearish"
          : "Unavailable";

  const latestSignal = signals.length > 0 ? signals[signals.length - 1]! : null;
  const lastSignalSameBar = latestSignal && lc && latestSignal.time === lc.t ? latestSignal : null;
  const trendUpLast = lastScore >= 2;
  const trendDnLast = lastScore <= -2;
  const lastDemandRetest = n > 0 ? zonesRes.perBar[last]!.demandRetest : false;
  const lastSupplyRetest = n > 0 ? zonesRes.perBar[last]!.supplyRetest : false;
  const signalText = !params.showSignals
    ? "Signals off"
    : lastSignalSameBar
      ? lastSignalSameBar.dir === "long"
        ? "LONG SETUP"
        : "SHORT SETUP"
      : trendUpLast && !lastDemandRetest
        ? "Wait: zone retest"
        : trendDnLast && !lastSupplyRetest
          ? "Wait: zone retest"
          : "No setup";

  const allZones = [...zonesRes.zones, ...fvgs];

  return {
    emas,
    vwap: vwapOut,
    zones: allZones,
    structure: struct.events,
    signals,
    latestSignal,
    htfAvailable,
    dashboard: {
      trendText: label.text,
      trendColor: label.color,
      score: lastScore,
      maxScore,
      emaText,
      vwapText,
      biasText,
      structureText,
      htfText,
      signalText,
    },
  };
}
