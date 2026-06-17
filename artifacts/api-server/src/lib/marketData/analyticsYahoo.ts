/**
 * The SINGLE sanctioned Yahoo gateway.
 *
 * Yahoo is secondary analytics ONLY. Every datum that leaves this module is
 * stamped source=yahoo, trustTier=secondary_analytics, delayed=true,
 * notForSignals=true — which makes the trust-tier guard reject it from any
 * price/signal/valuation/F&O path. Legitimate analytics consumers (global
 * commodities/forex/S&P 500, India VIX fallback, portfolio NIFTY 500 / sector
 * benchmark comparisons) call THIS, never the raw `yahoo.ts` fetchers.
 *
 * This wrapper deliberately does NOT expose a generic "get any Indian equity
 * quote" method — that would re-open the banned path. It only exposes the
 * analytics surfaces above.
 */

import { fetchChartRaw, type YahooChart } from "../yahoo";
import { buildMeta } from "./validator";
import type { AnalyticsCandleSeries, AnalyticsQuote, Candle } from "./types";

type YahooRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "3y" | "5y";

function analyticsMeta(asOfMs: number | null, complete: boolean) {
  return buildMeta({
    source: "yahoo",
    trustTier: "secondary_analytics",
    asOfMs,
    delayed: true,
    notForSignals: true,
    complete,
  });
}

/**
 * Analytics-only daily candle series (e.g. an index benchmark, a global asset).
 * Branded `AnalyticsCandleSeries` so it can never be passed where trusted
 * candles are required.
 *
 * @param yahooSymbol e.g. "^CRSLDX", "GC=F", "^GSPC", "^INDIAVIX"
 * @param range       Yahoo range string (e.g. "1y", "6mo")
 */
export async function getAnalyticsDaily(
  yahooSymbol: string,
  range: YahooRange = "1y",
): Promise<AnalyticsCandleSeries | null> {
  let chart: YahooChart | null = null;
  try {
    chart = await fetchChartRaw(yahooSymbol, range, "1d");
  } catch {
    chart = null;
  }
  if (!chart || chart.close.length === 0) {
    return null;
  }
  const candles: Candle[] = [];
  for (let i = 0; i < chart.timestamps.length; i++) {
    const o = chart.open[i];
    const h = chart.high[i];
    const l = chart.low[i];
    const c = chart.close[i];
    const ts = chart.timestamps[i];
    if (o == null || h == null || l == null || c == null || ts == null) continue;
    candles.push({
      t: new Date(ts * 1000).toISOString(),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: chart.volume[i] ?? 0,
    });
  }
  const lastTsSec = chart.timestamps[chart.timestamps.length - 1];
  const series = {
    symbol: yahooSymbol,
    interval: "1d",
    candles,
    meta: analyticsMeta(lastTsSec != null ? lastTsSec * 1000 : null, candles.length > 0),
  };
  return series as AnalyticsCandleSeries;
}

/**
 * Analytics-only last-value quote derived from a Yahoo chart's latest bar.
 * Used for global-asset/VIX-fallback strips that explicitly display delayed
 * data. Branded `AnalyticsQuote` (never tradeable).
 */
export async function getAnalyticsQuote(
  yahooSymbol: string,
  range: YahooRange = "5d",
): Promise<AnalyticsQuote | null> {
  let chart: YahooChart | null = null;
  try {
    chart = await fetchChartRaw(yahooSymbol, range, "1d");
  } catch {
    chart = null;
  }
  if (!chart || chart.close.length < 1) return null;
  const closes = chart.close.filter((v): v is number => v != null);
  if (closes.length < 1) return null;
  const last = chart.meta.regularMarketPrice ?? closes[closes.length - 1]!;
  const prev = closes.length >= 2 ? closes[closes.length - 2] : chart.meta.chartPreviousClose;
  if (!(last > 0)) return null;
  const lastTsSec = chart.meta.regularMarketTime ?? chart.timestamps[chart.timestamps.length - 1];
  const change = prev != null && prev > 0 ? last - prev : undefined;
  const changePercent = prev != null && prev > 0 ? ((last - prev) / prev) * 100 : undefined;
  const quote = {
    symbol: yahooSymbol,
    name: chart.meta.shortName ?? chart.meta.longName,
    lastPrice: last,
    previousClose: prev != null && prev > 0 ? prev : undefined,
    change,
    changePercent,
    meta: analyticsMeta(lastTsSec != null ? lastTsSec * 1000 : null, true),
  };
  return quote as AnalyticsQuote;
}

// ─── Display-only re-exports ────────────────────────────────────────────
//
// These re-export raw Yahoo functions through the central backbone so that
// consumer files never import `./yahoo` directly. ALL data that flows
// through these re-exports is display-only / secondary analytics.
//
// Owner policy: Yahoo is allowed ONLY for global/display-only/secondary
// analytics where there is no Kite equivalent. No value from these
// functions may appear as trade-grade.

/** Yahoo financial statements (quarterly earnings, balance sheet). Display-only. */
export { fetchStatements } from "../yahoo";

/** Yahoo intraday chart (e.g. 15m bars for global indices). Display-only. */
export { fetchIntraday } from "../yahoo";

/** Yahoo index chart (daily candles for display). Display-only. */
export { fetchIndexChart } from "../yahoo";

/** Yahoo chart fetch (daily candles for display). Display-only. */
export { fetchChart } from "../yahoo";

/** Yahoo fundamentals data (P/E, market cap etc). Display-only. */
export { fetchFundamentals } from "../yahoo";

/** Yahoo raw chart fetch. Display-only. */
export { fetchChartRaw } from "../yahoo";

/** Yahoo candle + quote snapshot for global data layer. Display-only. */
export { fetchYahooCandles, fetchYahooQuoteSnapshot } from "../global/yahoo";

/** Yahoo types needed by consumer files. */
export type { YahooChart, YahooMeta } from "../yahoo";
export type { YfCandle } from "../global/yahoo";

/** yahoo-finance2 SDK re-export for display-only consumers (e.g. earnings calendar). */
export { default as YahooFinance } from "yahoo-finance2";

/** Yahoo ticker resolver (e.g. ZOMATO→ETERNAL mapping). Display-only. */
export { yahooTickerFor } from "../yahoo";

/** Yahoo batch-quote endpoint for scanner (Kite-offline fallback). Display-only. */
export { fetchYahooBatchQuotes } from "../yahoo";
export type { YahooBatchQuote } from "../yahoo";

/** Yahoo global breaker state — display-only, so scanners can skip enrichment. */
export { isYahooPaused, yahooPausedForMs } from "../yahoo";

/** Yahoo fundamentals type — used by deepscan/swingScannerData. Display-only. */
export type { YahooFundamentals } from "../yahoo";

