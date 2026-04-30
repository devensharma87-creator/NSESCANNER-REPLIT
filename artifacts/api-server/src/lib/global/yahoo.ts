/**
 * Yahoo Finance adapter for the global scanner — used for both commodities
 * (continuous futures, e.g. GC=F) and forex (e.g. EURUSD=X).
 *
 * Reuses the existing yahoo-finance2 dependency with our own thin
 * timeout wrapper so a slow upstream cannot block global-scanner routes.
 */

import YahooFinance from "yahoo-finance2";
import type {
  ChartResultArray,
  ChartResultArrayQuote,
  ChartMeta,
  ChartOptionsWithReturnArray,
} from "yahoo-finance2/modules/chart";
import { logger } from "../logger";
import type { GlobalTimeframe } from "./universe";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const YF_TIMEOUT_MS = 8_000;

class YahooTimeoutError extends Error {
  constructor(op: string, ms: number) {
    super(`Yahoo ${op} timed out after ${ms}ms`);
    this.name = "YahooTimeoutError";
  }
}

function withTimeout<T>(op: string, p: Promise<T>): Promise<T> {
  let to: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    to = setTimeout(() => reject(new YahooTimeoutError(op, YF_TIMEOUT_MS)), YF_TIMEOUT_MS);
  });
  return Promise.race([p, timer]).finally(() => { if (to) clearTimeout(to); }) as Promise<T>;
}

interface YfChartInterval {
  interval: ChartOptionsWithReturnArray["interval"];
  rangeDays: number;
}

const TF_TO_YF: Record<GlobalTimeframe, YfChartInterval> = {
  "1m":  { interval: "1m",  rangeDays: 1 },
  "5m":  { interval: "5m",  rangeDays: 7 },
  "15m": { interval: "15m", rangeDays: 14 },
  "1h":  { interval: "60m", rangeDays: 30 },
  "4h":  { interval: "60m", rangeDays: 60 },     // Yahoo doesn't expose 4h; we resample
  "1d":  { interval: "1d",  rangeDays: 365 },
};

export interface YfCandle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface YfQuote {
  symbol: string;
  price: number;
  prevClose: number | null;
  changeAbs: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  asOf: number; // ms
}

/**
 * Resample raw 60m candles into 4h buckets (UTC-aligned: 00,04,08,12,16,20).
 * Used because Yahoo doesn't expose a native 4h interval.
 */
function resampleTo4h(candles: YfCandle[]): YfCandle[] {
  if (candles.length === 0) return [];
  const buckets = new Map<number, YfCandle>();
  for (const c of candles) {
    const d = new Date(c.t);
    d.setUTCMinutes(0, 0, 0);
    const hr = d.getUTCHours();
    const bucketHour = hr - (hr % 4);
    d.setUTCHours(bucketHour);
    const key = d.getTime();
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { ...c, t: key });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      if (c.volume != null) existing.volume = (existing.volume ?? 0) + c.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.t - b.t);
}

function quoteToCandle(q: ChartResultArrayQuote): YfCandle | null {
  const t = q.date instanceof Date ? q.date.getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  const { open, high, low, close, volume } = q;
  if (open == null || high == null || low == null || close == null) return null;
  if (![open, high, low, close].every(v => Number.isFinite(v))) return null;
  const vol = volume == null ? null : (Number.isFinite(volume) ? volume : null);
  return { t, open, high, low, close, volume: vol };
}

export async function fetchYahooCandles(
  yahooSymbol: string,
  timeframe: GlobalTimeframe,
): Promise<YfCandle[]> {
  const conf = TF_TO_YF[timeframe];
  const period1 = new Date(Date.now() - conf.rangeDays * 24 * 60 * 60 * 1000);
  const result = await withTimeout<ChartResultArray>(
    `chart(${yahooSymbol}/${conf.interval})`,
    yf.chart(yahooSymbol, { period1, interval: conf.interval }),
  );
  if (!result || !Array.isArray(result.quotes)) return [];
  const raw: YfCandle[] = result.quotes
    .map(quoteToCandle)
    .filter((x): x is YfCandle => x !== null);
  if (timeframe === "4h") return resampleTo4h(raw);
  return raw;
}

function metaNum(meta: ChartMeta | undefined, key: keyof ChartMeta): number | null {
  if (!meta) return null;
  const v = meta[key];
  if (typeof v !== "number") return null;
  return Number.isFinite(v) ? v : null;
}

export async function fetchYahooQuoteSnapshot(yahooSymbol: string): Promise<YfQuote | null> {
  // We re-use the chart endpoint at 1d/2d range — it gives both the latest
  // print and the previous close in a single call without quoteSummary's
  // heavier surface (and quote() endpoint is rate-limited & flaky).
  const period1 = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const result = await withTimeout<ChartResultArray>(
    `chart(${yahooSymbol}/snapshot)`,
    yf.chart(yahooSymbol, { period1, interval: "1d" }),
  );
  if (!result) return null;
  const meta = result.meta;
  const quotes: ChartResultArrayQuote[] = Array.isArray(result.quotes) ? result.quotes : [];
  const last = quotes[quotes.length - 1];
  const prev = quotes[quotes.length - 2];

  const metaPrice = metaNum(meta, "regularMarketPrice");
  const lastClose = last?.close != null && Number.isFinite(last.close) ? last.close : null;
  const price = metaPrice ?? lastClose;
  if (price == null) return null;

  const prevClose = (prev?.close != null && Number.isFinite(prev.close))
    ? prev.close
    : (metaNum(meta, "chartPreviousClose") ?? metaNum(meta, "previousClose"));
  const changeAbs = prevClose != null ? price - prevClose : null;
  const changePct = prevClose != null && prevClose !== 0 && changeAbs != null
    ? (changeAbs / prevClose) * 100
    : null;
  const regularMarketTime = meta?.regularMarketTime instanceof Date
    ? meta.regularMarketTime.getTime()
    : Date.now();
  return {
    symbol: yahooSymbol,
    price,
    prevClose,
    changeAbs,
    changePct,
    dayHigh: metaNum(meta, "regularMarketDayHigh") ?? (last?.high != null && Number.isFinite(last.high) ? last.high : null),
    dayLow:  metaNum(meta, "regularMarketDayLow")  ?? (last?.low  != null && Number.isFinite(last.low)  ? last.low  : null),
    volume:  metaNum(meta, "regularMarketVolume")  ?? (last?.volume != null && Number.isFinite(last.volume) ? last.volume : null),
    asOf:    regularMarketTime,
  };
}

export function logYahooModuleBoot(): void {
  logger.info({ source: "yahoo" }, "Global scanner Yahoo adapter ready");
}
