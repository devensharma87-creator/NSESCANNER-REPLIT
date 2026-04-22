import { logger } from "./logger";
import YahooFinance from "yahoo-finance2";

export interface YahooMeta {
  symbol: string;
  regularMarketPrice: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  regularMarketTime?: number;
  chartPreviousClose?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  shortName?: string;
  longName?: string;
  exchangeName?: string;
}

export interface YahooChart {
  symbol: string;
  meta: YahooMeta;
  timestamps: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const RANGE_DAYS: Record<string, number> = {
  "1d": 2,
  "5d": 7,
  "1mo": 32,
  "3mo": 95,
  "6mo": 190,
  "1y": 370,
  "2y": 740,
};

type Interval = "1m" | "5m" | "15m" | "30m" | "60m" | "1d" | "1wk" | "1mo";

async function chartCall(ticker: string, range: string, interval: Interval): Promise<YahooChart | null> {
  const days = RANGE_DAYS[range] ?? 190;
  const period1 = new Date(Date.now() - days * 24 * 3600 * 1000);
  try {
    // The library accepts "1m"/"5m" but typing of `chart` is permissive.
    const res = await yf.chart(ticker, { period1, interval: interval as never });
    if (!res?.meta || !res.quotes?.length) return null;
    const open: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    const volume: number[] = [];
    const timestamps: number[] = [];
    for (const q of res.quotes) {
      if (q.open == null || q.high == null || q.low == null || q.close == null) continue;
      timestamps.push(Math.floor(new Date(q.date).getTime() / 1000));
      open.push(q.open);
      high.push(q.high);
      low.push(q.low);
      close.push(q.close);
      volume.push(q.volume ?? 0);
    }
    const meta: YahooMeta = {
      symbol: ticker,
      regularMarketPrice: res.meta.regularMarketPrice ?? close[close.length - 1] ?? 0,
      regularMarketDayHigh: res.meta.regularMarketDayHigh,
      regularMarketDayLow: res.meta.regularMarketDayLow,
      regularMarketVolume: res.meta.regularMarketVolume,
      regularMarketTime: res.meta.regularMarketTime ? Math.floor(new Date(res.meta.regularMarketTime).getTime() / 1000) : undefined,
      chartPreviousClose: res.meta.chartPreviousClose ?? res.meta.previousClose,
      fiftyTwoWeekHigh: res.meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: res.meta.fiftyTwoWeekLow,
      shortName: res.meta.shortName,
      longName: res.meta.longName,
      exchangeName: res.meta.exchangeName,
    };
    return { symbol: ticker, meta, timestamps, open, high, low, close, volume };
  } catch (err) {
    logger.warn({ err: (err as Error).message, ticker, range, interval }, "Yahoo chart failed");
    return null;
  }
}

export async function fetchChart(
  symbol: string,
  range: "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" = "6mo",
  interval: "1d" | "1wk" | "1mo" = "1d",
  exchange: "NS" | "BO" = "NS",
): Promise<YahooChart | null> {
  const ticker = `${symbol}.${exchange}`;
  const r = await chartCall(ticker, range, interval);
  if (r) return { ...r, symbol };
  return null;
}

export async function fetchIndexChart(yahooSymbol: string): Promise<YahooChart | null> {
  return chartCall(yahooSymbol, "5d", "1d");
}

/** Fetch intraday bars (most recent session) for an index or stock symbol. */
export async function fetchIntraday(
  yahooSymbol: string,
  interval: "5m" | "15m" | "30m" | "60m" = "15m",
  range: "1d" | "5d" = "5d",
): Promise<YahooChart | null> {
  return chartCall(yahooSymbol, range, interval);
}

/** Fundamental key stats from Yahoo Finance quoteSummary. Returned as ₹-friendly numbers
 * (market cap converted from raw INR to crore). Cached per symbol for 1 hour. */
export interface YahooFundamentals {
  marketCapCr?: number;
  peRatio?: number;
  forwardPe?: number;
  pbRatio?: number;
  eps?: number;
  bookValue?: number;
  dividendYield?: number;
  beta?: number;
  roe?: number;
  debtToEquity?: number;
  profitMargin?: number;
  operatingMargin?: number;
  sharesOutstandingCr?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
  revenueGrowthYoy?: number;
  earningsGrowthYoy?: number;
  priceToSales?: number;
}

const FUND_TTL = 60 * 60 * 1000;
const fundCache = new Map<string, { ts: number; data: YahooFundamentals | null }>();

export async function fetchFundamentals(symbol: string, exchange: "NS" | "BO" = "NS"): Promise<YahooFundamentals | null> {
  const ticker = `${symbol}.${exchange}`;
  const c = fundCache.get(ticker);
  if (c && Date.now() - c.ts < FUND_TTL) return c.data;
  try {
    const r = await yf.quoteSummary(ticker, {
      modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData"] as never,
    });
    const price = (r as { price?: { marketCap?: number; sharesOutstanding?: number } }).price ?? {};
    const sd = (r as { summaryDetail?: Record<string, number | undefined> }).summaryDetail ?? {};
    const ks = (r as { defaultKeyStatistics?: Record<string, number | undefined> }).defaultKeyStatistics ?? {};
    const fd = (r as { financialData?: Record<string, number | undefined> }).financialData ?? {};
    const data: YahooFundamentals = {
      marketCapCr: price.marketCap != null ? +(price.marketCap / 1e7).toFixed(2) : undefined,
      peRatio: sd["trailingPE"] != null ? +sd["trailingPE"].toFixed(2) : undefined,
      forwardPe: sd["forwardPE"] != null ? +sd["forwardPE"].toFixed(2) : undefined,
      pbRatio: ks["priceToBook"] != null ? +ks["priceToBook"].toFixed(2) : undefined,
      eps: ks["trailingEps"] != null ? +ks["trailingEps"].toFixed(2) : undefined,
      bookValue: ks["bookValue"] != null ? +ks["bookValue"].toFixed(2) : undefined,
      dividendYield: sd["dividendYield"] != null ? +(sd["dividendYield"] * 100).toFixed(2) : undefined,
      beta: ks["beta"] != null ? +ks["beta"].toFixed(2) : undefined,
      roe: fd["returnOnEquity"] != null ? +(fd["returnOnEquity"] * 100).toFixed(2) : undefined,
      debtToEquity: fd["debtToEquity"] != null ? +fd["debtToEquity"].toFixed(2) : undefined,
      profitMargin: fd["profitMargins"] != null ? +(fd["profitMargins"] * 100).toFixed(2) : undefined,
      operatingMargin: fd["operatingMargins"] != null ? +(fd["operatingMargins"] * 100).toFixed(2) : undefined,
      sharesOutstandingCr: price.sharesOutstanding != null ? +(price.sharesOutstanding / 1e7).toFixed(2) : undefined,
      fiftyDayAverage: sd["fiftyDayAverage"] != null ? +sd["fiftyDayAverage"].toFixed(2) : undefined,
      twoHundredDayAverage: sd["twoHundredDayAverage"] != null ? +sd["twoHundredDayAverage"].toFixed(2) : undefined,
      revenueGrowthYoy: fd["revenueGrowth"] != null ? +(fd["revenueGrowth"] * 100).toFixed(2) : undefined,
      earningsGrowthYoy: fd["earningsGrowth"] != null ? +(fd["earningsGrowth"] * 100).toFixed(2) : undefined,
      priceToSales: sd["priceToSalesTrailing12Months"] != null ? +sd["priceToSalesTrailing12Months"].toFixed(2) : undefined,
    };
    fundCache.set(ticker, { ts: Date.now(), data });
    return data;
  } catch (err) {
    logger.warn({ err: (err as Error).message, ticker }, "Yahoo fundamentals failed");
    fundCache.set(ticker, { ts: Date.now(), data: null });
    return null;
  }
}
