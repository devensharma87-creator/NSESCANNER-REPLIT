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
  fetchKiteIntraday,
  fetchKiteEquityIntraday,
} from "./kiteIntraday";
import { fetchChart, fetchChartRaw, fetchIntraday, type YahooChart } from "./yahoo";
import { resolveInstrument, type ChartSegment } from "./chartInstruments";
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

export interface ChartCandlesResult {
  symbol: string;
  segment: ChartSegment;
  timeframe: ChartTimeframe;
  source: ChartSource;
  fresh: boolean;
  asOf: number | null;
  message?: string;
  candles: ChartCandlePoint[];
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
  return out;
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

function finalize(
  symbol: string,
  segment: ChartSegment,
  tf: ChartTimeframe,
  source: ChartSource,
  candles: ChartCandlePoint[],
  message?: string,
): ChartCandlesResult {
  const { asOf, fresh } = deriveFreshness(candles, tf);
  return { symbol, segment, timeframe: tf, source, fresh, asOf, candles, ...(message ? { message } : {}) };
}

async function tryKite(
  meta: { segment: ChartSegment; symbol: string; yahoo: string },
  cfg: TimeframeConfig,
): Promise<ChartCandlePoint[] | null> {
  let chart: YahooChart | null = null;
  if (meta.segment === "index") {
    chart = await fetchKiteIntraday(meta.yahoo, cfg.kiteInterval, cfg.kiteDaysBack);
  } else if (meta.segment === "equity") {
    chart = await fetchKiteEquityIntraday(meta.symbol, cfg.kiteInterval, cfg.kiteDaysBack);
  } else {
    return null; // global: Kite has no coverage
  }
  if (!chart) return null;
  let candles = normalizeChart(chart);
  if (cfg.aggregateTo) candles = aggregateCandles(candles, cfg.aggregateTo);
  return candles.length > 0 ? candles : null;
}

async function tryYahoo(
  meta: { segment: ChartSegment; symbol: string; yahoo: string },
  cfg: TimeframeConfig,
): Promise<ChartCandlePoint[] | null> {
  if (!cfg.yahoo) return null;
  let chart: YahooChart | null = null;
  if (cfg.yahoo.kind === "intraday") {
    chart = await fetchIntraday(meta.yahoo, cfg.yahoo.interval, cfg.yahoo.range);
  } else if (meta.segment === "equity") {
    // fetchChart appends .NS + applies rename overrides itself.
    chart = await fetchChart(meta.symbol, cfg.yahoo.range, cfg.yahoo.interval, "NS");
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
  const meta = resolveInstrument(symbol, segment);
  if (!meta || meta.segment !== segment) {
    return {
      symbol, segment, timeframe: tf, source: "none", fresh: false, asOf: null,
      candles: [], message: "Unknown instrument for this segment.",
    };
  }
  const cfg = TIMEFRAME_CONFIG[tf];

  try {
    const kite = await tryKite(meta, cfg);
    if (kite && kite.length > 0) return finalize(meta.symbol, segment, tf, "kite", kite);
  } catch (err) {
    logger.warn({ err: (err as Error).message, symbol, segment, tf }, "chart: Kite source failed");
  }

  try {
    const yahoo = await tryYahoo(meta, cfg);
    if (yahoo && yahoo.length > 0) return finalize(meta.symbol, segment, tf, "yahoo", yahoo);
  } catch (err) {
    logger.warn({ err: (err as Error).message, symbol, segment, tf }, "chart: Yahoo source failed");
  }

  const noYahoo = cfg.yahoo == null;
  return finalize(
    meta.symbol, segment, tf, "none", [],
    noYahoo
      ? "Data unavailable for this timeframe from the fallback source — connect a live Kite session for intraday minute data."
      : "Data unavailable for this timeframe/source right now.",
  );
}
