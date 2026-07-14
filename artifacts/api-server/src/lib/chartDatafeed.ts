/**
 * Read-only candle datafeed for the Charting tab.
 *
 * Sourcing priority: Kite (live broker) first, Yahoo Finance fallback,
 * else `source: "none"` with an empty series. Bars are NEVER fabricated —
 * if neither source returns data, the UI shows an explicit empty state.
 *
 * This module is import-isolated from every signal / paper-trade path. It
 * only calls the existing read fetchers (`fetchKiteIntraday`,
 * `fetchKiteEquityIntraday`, Yahoo chart helpers).
 */
import {
  centralEquityCandlesByToken as fetchKiteEquityIntradayByToken,
} from "./marketData/compat";
import { centralIndexCandles, centralEquityCandles } from "./marketData/compat";
import { fetchChart, fetchChartRaw, fetchIntraday, type YahooChart } from "./marketData/analyticsYahoo";
import { resolveInstrument, type ChartSegment, type ChartInstrumentMeta } from "./chartInstruments";
import { resolveInstrument as resolveMasterInstrument } from "./marketData/instrumentResolver";
import { fetchIndexFuturesVolume } from "./indexFuturesVolume";
import { logger } from "./logger";

export type ChartTimeframe =
  | "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "1D" | "1W" | "1M";

export interface ChartCandlePoint {
  /** Epoch seconds (UTC) of the candle open. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

export type ChartSource = "kite" | "yahoo" | "none";

/** Provenance / trust tier for chart candle responses. */
export type ChartSourceTier = "authoritative" | "secondary_analytics" | "unavailable";

/** Volume data origin for transparency. */
export type ChartVolumeSource =
  | "actual"           // Real traded volume from the same instrument
  | "futures_proxy"    // Nearest-month futures volume merged onto spot index
  | "unavailable"      // No volume data (e.g. spot index with no futures merge)
  | "none";            // No candles at all

export interface ChartCandlesResult {
  symbol: string;
  segment: ChartSegment;
  timeframe: ChartTimeframe;
  source: ChartSource;
  fresh: boolean;
  asOf: number | null;
  message?: string;
  errorType?: "TOKEN_NOT_FOUND" | "CANDLES_UNAVAILABLE" | "UNKNOWN_INSTRUMENT";
  candles: ChartCandlePoint[];

  // --- Provenance (Phase 2) ---
  /** Normalised provider that produced these candles. */
  sourceProvider: ChartSource;
  /** Trust tier of the source. */
  sourceTier: ChartSourceTier;
  /** True when the data is from a live session feed. */
  live: boolean;
  /** True for delayed / end-of-day feeds (Yahoo). */
  delayed: boolean;
  /** True when older than the freshness budget for this timeframe. */
  stale: boolean;
  /** True when a fallback source was used instead of the preferred one. */
  fallbackUsed: boolean;
  /** True when any candle data is synthetic / derived. */
  synthetic: boolean;
  /** True when data should be treated as visual reference only, not trade-grade. */
  visualOnly: boolean;
  /** ISO timestamp of when this response was generated. */
  lastUpdatedAt: string;
  /** Timezone convention for candle timestamps. */
  timezone: "UTC";
  /** How candle timestamps should be interpreted. */
  candleTimeConvention: "open";
  /** Origin of volume data. */
  volumeSource: ChartVolumeSource;
  /** Instrument from which volume was sourced (when futures_proxy). */
  volumeSourceInstrument: string | null;
  /** True when volume is from a proxy instrument. */
  volumeProxy: boolean;
  /** Human-readable notes about degradations, fallbacks, or missing data. */
  warnings: string[];
}

type KiteInterval =
  | "minute" | "3minute" | "5minute" | "10minute" | "15minute"
  | "30minute" | "60minute" | "day";

interface YahooIntradaySpec {
  kind: "intraday";
  interval: "5m" | "15m" | "30m" | "60m";
  range: "1d" | "5d";
}
interface YahooDailySpec {
  kind: "daily";
  interval: "1d" | "1wk" | "1mo";
  range: "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "3y" | "5y";
}

interface TimeframeConfig {
  /** Kite interval to request. For 1W/1M we pull "day" and aggregate. */
  kiteInterval: KiteInterval;
  kiteDaysBack: number;
  /** Aggregate fetched daily Kite bars up to this period (null = use as-is). */
  aggregateTo: "week" | "month" | null;
  /** Yahoo fallback spec, or null when Yahoo has no matching resolution. */
  yahoo: YahooIntradaySpec | YahooDailySpec | null;
  /** Newest bar must be within this many seconds to be considered "fresh". */
  freshnessSec: number;
}

export const TIMEFRAME_CONFIG: Record<ChartTimeframe, TimeframeConfig> = {
  "1m":  { kiteInterval: "minute",   kiteDaysBack: 4,    aggregateTo: null,    yahoo: null, freshnessSec: 180 },
  "3m":  { kiteInterval: "3minute",  kiteDaysBack: 8,    aggregateTo: null,    yahoo: null, freshnessSec: 540 },
  "5m":  { kiteInterval: "5minute",  kiteDaysBack: 12,   aggregateTo: null,    yahoo: { kind: "intraday", interval: "5m",  range: "5d" }, freshnessSec: 900 },
  "15m": { kiteInterval: "15minute", kiteDaysBack: 30,   aggregateTo: null,    yahoo: { kind: "intraday", interval: "15m", range: "5d" }, freshnessSec: 2700 },
  "30m": { kiteInterval: "30minute", kiteDaysBack: 60,   aggregateTo: null,    yahoo: { kind: "intraday", interval: "30m", range: "5d" }, freshnessSec: 5400 },
  "1h":  { kiteInterval: "60minute", kiteDaysBack: 120,  aggregateTo: null,    yahoo: { kind: "intraday", interval: "60m", range: "5d" }, freshnessSec: 10800 },
  "1D":  { kiteInterval: "day",      kiteDaysBack: 400,  aggregateTo: null,    yahoo: { kind: "daily", interval: "1d",  range: "1y" }, freshnessSec: 4 * 86400 },
  "1W":  { kiteInterval: "day",      kiteDaysBack: 1800, aggregateTo: "week",  yahoo: { kind: "daily", interval: "1wk", range: "2y" }, freshnessSec: 12 * 86400 },
  "1M":  { kiteInterval: "day",      kiteDaysBack: 2500, aggregateTo: "month", yahoo: { kind: "daily", interval: "1mo", range: "5y" }, freshnessSec: 45 * 86400 },
};

export const ALL_TIMEFRAMES: ChartTimeframe[] = [
  "1m", "3m", "5m", "15m", "30m", "1h", "1D", "1W", "1M",
];

/** Normalize a YahooChart-shaped payload into clean, finite candles. */
export function normalizeChart(chart: YahooChart): ChartCandlePoint[] {
  const out: ChartCandlePoint[] = [];
  const n = chart.timestamps.length;
  for (let i = 0; i < n; i++) {
    const t = chart.timestamps[i];
    const o = chart.open[i];
    const h = chart.high[i];
    const l = chart.low[i];
    const c = chart.close[i];
    const v = chart.volume[i];
    if (t == null || !Number.isFinite(t)) continue;
    if (![o, h, l, c].every(x => x != null && Number.isFinite(x) && (x as number) > 0)) continue;
    out.push({
      t: Math.floor(t),
      o: o as number,
      h: h as number,
      l: l as number,
      c: c as number,
      v: v != null && Number.isFinite(v) ? (v as number) : null,
    });
  }
  out.sort((a, b) => a.t - b.t);
  // Collapse any duplicate timestamps (keep the last occurrence) so the chart
  // library always receives a strictly-ascending, unique series.
  const deduped: ChartCandlePoint[] = [];
  for (const c of out) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.t === c.t) deduped[deduped.length - 1] = c;
    else deduped.push(c);
  }
  return deduped;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST calendar parts for an epoch-seconds timestamp. */
function istParts(tSec: number): { y: number; m: number; d: number; dow: number } {
  const d = new Date(tSec * 1000 + IST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    d: d.getUTCDate(),
    dow: d.getUTCDay(),
  };
}

/** Monday-anchored ISO-week key (IST) for weekly grouping. */
function weekKey(tSec: number): string {
  const p = istParts(tSec);
  // Shift to the Monday of this IST week, then key by that date.
  const dayMs = 86400 * 1000;
  const istMidday = Date.UTC(p.y, p.m, p.d) ; // date-only anchor (UTC midnight of the IST calendar date)
  const dowMon = (p.dow + 6) % 7; // 0 = Monday
  const monday = istMidday - dowMon * dayMs;
  return new Date(monday).toISOString().slice(0, 10);
}

function monthKey(tSec: number): string {
  const p = istParts(tSec);
  return `${p.y}-${String(p.m + 1).padStart(2, "0")}`;
}

/**
 * Aggregate ascending daily candles into weekly or monthly bars. Open =
 * first bar's open, High/Low = extremes, Close = last bar's close, Volume
 * = sum, `t` = the first bar's timestamp in the period. Pure + real-data.
 */
export function aggregateCandles(
  candles: ChartCandlePoint[],
  period: "week" | "month",
): ChartCandlePoint[] {
  if (candles.length === 0) return [];
  const keyFn = period === "week" ? weekKey : monthKey;
  const buckets = new Map<string, ChartCandlePoint[]>();
  const order: string[] = [];
  for (const c of candles) {
    const k = keyFn(c.t);
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
      order.push(k);
    }
    arr.push(c);
  }
  const out: ChartCandlePoint[] = [];
  for (const k of order) {
    const arr = buckets.get(k)!;
    const first = arr[0]!;
    let high = first.h;
    let low = first.l;
    let vol = 0;
    let volSeen = false;
    for (const c of arr) {
      if (c.h > high) high = c.h;
      if (c.l < low) low = c.l;
      if (c.v != null) { vol += c.v; volSeen = true; }
    }
    out.push({
      t: first.t,
      o: first.o,
      h: high,
      l: low,
      c: arr[arr.length - 1]!.c,
      v: volSeen ? vol : null,
    });
  }
  return out;
}

/** Derive `asOf` + `fresh` from a candle series and the timeframe budget. */
export function deriveFreshness(
  candles: ChartCandlePoint[],
  tf: ChartTimeframe,
  nowMs: number = Date.now(),
): { asOf: number | null; fresh: boolean } {
  if (candles.length === 0) return { asOf: null, fresh: false };
  const asOf = candles[candles.length - 1]!.t;
  const ageSec = nowMs / 1000 - asOf;
  return { asOf, fresh: ageSec <= TIMEFRAME_CONFIG[tf].freshnessSec };
}

/**
 * Generic freshness check for candle paths that already know their newest
 * bar instant but do NOT carry a `ChartCandlePoint[]` (the swing daily-bar
 * tally and the index-trend intraday tally). Sharing this keeps every
 * candle surface on ONE `{ source, asOf, fresh }` contract derived from the
 * SAME per-timeframe budgets in `TIMEFRAME_CONFIG`.
 *
 * @param asOfSec newest bar timestamp in epoch SECONDS, or null when none.
 */
export function isFreshFor(
  asOfSec: number | null,
  tf: ChartTimeframe,
  nowMs: number = Date.now(),
): boolean {
  if (asOfSec == null || !Number.isFinite(asOfSec)) return false;
  return nowMs / 1000 - asOfSec <= TIMEFRAME_CONFIG[tf].freshnessSec;
}

interface FinalizeOpts {
  volumeSource?: ChartVolumeSource;
  volumeSourceInstrument?: string | null;
  warnings?: string[];
  errorType?: "TOKEN_NOT_FOUND" | "CANDLES_UNAVAILABLE" | "UNKNOWN_INSTRUMENT";
}

function finalize(
  symbol: string,
  segment: ChartSegment,
  tf: ChartTimeframe,
  source: ChartSource,
  candles: ChartCandlePoint[],
  message?: string,
  opts?: FinalizeOpts,
): ChartCandlesResult {
  const { asOf, fresh } = deriveFreshness(candles, tf);
  const isYahoo = source === "yahoo";
  const isNone = source === "none";
  const volumeSource = opts?.volumeSource ?? (isNone ? "none" : "actual");
  const warnings = [...(opts?.warnings ?? [])];
  if (isYahoo && (segment === "index" || segment === "equity")) {
    warnings.push("YAHOO DELAYED · VISUAL ONLY · NOT FOR SIGNALS");
  }
  if (volumeSource === "futures_proxy") {
    warnings.push(`Volume: nearest-month futures proxy${opts?.volumeSourceInstrument ? ` (${opts.volumeSourceInstrument})` : ""}`);
  }
  if (volumeSource === "unavailable") {
    warnings.push("Volume unavailable for this instrument.");
  }

  return {
    symbol, segment, timeframe: tf, source, fresh, asOf, candles,
    ...(message ? { message } : {}),
    ...(opts?.errorType ? { errorType: opts.errorType } : {}),
    // Provenance
    sourceProvider: source,
    sourceTier: source === "kite" ? "authoritative" : source === "yahoo" ? "secondary_analytics" : "unavailable",
    live: source === "kite" && fresh,
    delayed: isYahoo,
    stale: !fresh && candles.length > 0,
    fallbackUsed: isYahoo,
    synthetic: false,
    visualOnly: isYahoo && (segment === "index" || segment === "equity"),
    lastUpdatedAt: new Date().toISOString(),
    timezone: "UTC",
    candleTimeConvention: "open",
    volumeSource,
    volumeSourceInstrument: opts?.volumeSourceInstrument ?? null,
    volumeProxy: volumeSource === "futures_proxy",
    warnings,
  };
}

async function tryKite(
  meta: { segment: ChartSegment; symbol: string; yahoo: string; instrumentToken?: number },
  cfg: TimeframeConfig,
): Promise<ChartCandlePoint[] | null> {
  let chart: YahooChart | null = null;
  if (meta.segment === "index") {
    chart = await centralIndexCandles(meta.yahoo, cfg.kiteInterval, cfg.kiteDaysBack);
  } else if (meta.segment === "equity") {
    // Prefer the canonical resolver's instrument_token when present: it works
    // for BSE-listed equities (e.g. NSDL) too, whereas the NSE-only symbol
    // lookup would miss and force a Yahoo fallback. Curated NSE names carry no
    // token here and keep the existing symbol path (unchanged behaviour).
    chart = meta.instrumentToken != null
      ? await fetchKiteEquityIntradayByToken(meta.instrumentToken, meta.symbol, cfg.kiteInterval, cfg.kiteDaysBack)
      : await centralEquityCandles(meta.symbol, cfg.kiteInterval, cfg.kiteDaysBack);
  } else {
    return null; // global: Kite has no coverage
  }
  if (!chart) return null;
  const candles = normalizeChart(chart);
  return candles.length > 0 ? candles : null;
}

/**
 * Overlay nearest-month index-futures volume onto spot index candles, matched
 * by epoch-second open. Bars with no futures match keep their original volume
 * (0 for a spot index). Never throws — fabricates nothing.
 */
async function mergeIndexFuturesVolume(
  symbol: string,
  cfg: TimeframeConfig,
  candles: ChartCandlePoint[],
): Promise<{ candles: ChartCandlePoint[]; volumeSource: ChartVolumeSource; volumeSourceInstrument: string | null }> {
  try {
    const volMap = await fetchIndexFuturesVolume(symbol, cfg.kiteInterval, cfg.kiteDaysBack);
    if (!volMap || volMap.size === 0) {
      return { candles, volumeSource: "unavailable", volumeSourceInstrument: null };
    }
    const merged = candles.map(c => {
      const v = volMap.get(c.t);
      return v != null && v > 0 ? { ...c, v } : c;
    });
    return {
      candles: merged,
      volumeSource: "futures_proxy",
      volumeSourceInstrument: `${symbol} nearest-month futures`,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message, symbol }, "chart: index futures volume merge failed");
    return { candles, volumeSource: "unavailable", volumeSourceInstrument: null };
  }
}

async function tryYahoo(
  meta: { segment: ChartSegment; symbol: string; yahoo: string; exchange?: string | null },
  cfg: TimeframeConfig,
): Promise<ChartCandlePoint[] | null> {
  if (!cfg.yahoo) return null;
  let chart: YahooChart | null = null;
  if (cfg.yahoo.kind === "intraday") {
    chart = await fetchIntraday(meta.yahoo, cfg.yahoo.interval, cfg.yahoo.range);
  } else if (meta.segment === "equity") {
    // fetchChart appends the suffix + applies rename overrides itself. BSE-only
    // instruments (e.g. NSDL) resolve via the `.BO` Yahoo suffix; everything
    // else uses `.NS`.
    const suffix = meta.exchange === "BSE" ? "BO" : "NS";
    chart = await fetchChart(meta.symbol, cfg.yahoo.range, cfg.yahoo.interval, suffix);
  } else {
    // index / global use already-qualified Yahoo tickers.
    chart = await fetchChartRaw(meta.yahoo, cfg.yahoo.range, cfg.yahoo.interval);
  }
  if (!chart) return null;
  const candles = normalizeChart(chart);
  return candles.length > 0 ? candles : null;
}

/**
 * Resolve candles for an instrument + timeframe. Kite first, Yahoo
 * fallback, else `none`. Each upstream call is wrapped so one failing
 * source never blocks the other.
 */
export async function getChartCandles(
  symbol: string,
  segment: ChartSegment,
  tf: ChartTimeframe,
): Promise<ChartCandlesResult> {
  let meta = resolveInstrument(symbol, segment);
  let resolvedFromResolver = false;

  // Always query the canonical resolver for equities so we get the authoritative exchange + token.
  if (segment === "equity") {
    const r = resolveMasterInstrument(symbol, { preferExchange: "NSE" });
    if (r.resolved && r.instrument) {
      const inst = r.instrument;
      const isEtf = inst.instrument_type.endsWith("ETF");
      meta = {
        symbol: inst.canonical_symbol,
        name: inst.display_name,
        segment: "equity",
        exchange: inst.exchange,
        type: isEtf ? "ETF" : "Equity",
        yahoo: `${inst.canonical_symbol}.${inst.exchange === "BSE" ? "BO" : "NS"}`,
        instrumentToken: inst.instrument_token,
      };
      resolvedFromResolver = true;
    }
  }

  if (!meta || meta.segment !== segment) {
    const isTokenNotFound = segment === "equity" && !resolvedFromResolver;
    return {
      symbol, segment, timeframe: tf, source: "none", fresh: false, asOf: null,
      candles: [],
      message: isTokenNotFound ? "TOKEN NOT FOUND" : "Unknown instrument for this segment.",
      errorType: isTokenNotFound ? "TOKEN_NOT_FOUND" : "UNKNOWN_INSTRUMENT",
      // Provenance fields (none/empty)
      sourceProvider: "none",
      sourceTier: "unavailable",
      live: false,
      delayed: false,
      stale: false,
      fallbackUsed: false,
      synthetic: false,
      visualOnly: false,
      lastUpdatedAt: new Date().toISOString(),
      timezone: "UTC",
      candleTimeConvention: "open",
      volumeSource: "none",
      volumeSourceInstrument: null,
      volumeProxy: false,
      warnings: isTokenNotFound
        ? ["Instrument token not found in Kite master."]
        : ["No data source available for this instrument."],
    };
  }
  const cfg = TIMEFRAME_CONFIG[tf];

  let volumeSource: ChartVolumeSource = segment === "equity" ? "actual" : "unavailable";
  let volumeSourceInstrument: string | null = null;

  try {
    let kiteCandles = await tryKite(meta, cfg);
    if (kiteCandles && kiteCandles.length > 0) {
      // Spot index volume merge
      if (meta.segment === "index") {
        const merged = await mergeIndexFuturesVolume(meta.symbol, cfg, kiteCandles);
        kiteCandles = merged.candles;
        volumeSource = merged.volumeSource;
        volumeSourceInstrument = merged.volumeSourceInstrument;
      }
      if (cfg.aggregateTo) kiteCandles = aggregateCandles(kiteCandles, cfg.aggregateTo);
      return finalize(meta.symbol, segment, tf, "kite", kiteCandles, undefined, {
        volumeSource,
        volumeSourceInstrument,
      });
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, symbol, segment, tf }, "chart: Kite source failed");
  }
  // ── Yahoo fallback — ONLY for global instruments ─────────────────────────
  // Indian equity/index segments MUST NOT silently fall back to Yahoo.
  // If Kite candles are unavailable for Indian instruments, we return
  // source: "none" with a clear message. Global segment has no Kite
  // coverage, so Yahoo is the correct (and only) data source there.
  if (segment === "global") {
    try {
      const yahoo = await tryYahoo(meta, cfg);
      if (yahoo && yahoo.length > 0) {
        return finalize(meta.symbol, segment, tf, "yahoo", yahoo, undefined, {
          volumeSource: "actual",
        });
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message, symbol, segment, tf }, "chart: Yahoo source failed");
    }
  } else {
    // Indian equity/index: log the miss but do NOT fall through to Yahoo.
    logger.info(
      { symbol, segment, tf },
      "chart: Kite candles unavailable for Indian instrument — returning unavailable (no Yahoo fallback)",
    );
  }

  // All sources exhausted (or Indian instrument with Kite offline).
  const isIndian = segment === "equity" || segment === "index";
  const isCandlesUnavailable = segment === "equity" && resolvedFromResolver;
  return finalize(
    meta.symbol, segment, tf, "none", [],
    isCandlesUnavailable
      ? "CANDLES UNAVAILABLE"
      : isIndian
        ? "Trusted candles (Kite) unavailable — connect a live Kite session for Indian instrument data."
        : "Data unavailable for this timeframe/source right now.",
    {
      volumeSource: "none",
      warnings: isIndian
        ? ["No trusted candle source available. Kite session required for Indian instruments."]
        : [],
      errorType: isCandlesUnavailable ? "CANDLES_UNAVAILABLE" : undefined,
    },
  );
}
