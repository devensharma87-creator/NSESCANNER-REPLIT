/**
 * Central market-data compatibility adapters.
 *
 * These functions wrap the central router's services to return the legacy
 * `YahooChart | null` shape that many consumers (optionSignals, signalGates,
 * liveBias, scanner, chartDatafeed) currently expect.
 *
 * ALL DATA FLOWS THROUGH THE CENTRAL BACKBONE — these are NOT bypasses.
 * They are format adapters that ensure existing signal/chart logic is
 * preserved during the migration while the import path is honest.
 *
 * Owner rule: "This is only a data path migration. Do not change signal logic."
 */

import * as router from "./router";
import type { CandleSeries } from "./types";
import type { YahooChart, YahooMeta } from "../yahoo";

// ─── Shape converters ──────────────────────────────────────────────────────

/** Convert a CandleSeries (central format) to YahooChart (legacy format). */
function seriesToYahooChart(series: CandleSeries): YahooChart {
  const timestamps: number[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  const volume: number[] = [];
  for (const c of series.candles) {
    timestamps.push(Math.floor(new Date(c.t).getTime() / 1000));
    open.push(c.open);
    high.push(c.high);
    low.push(c.low);
    close.push(c.close);
    volume.push(c.volume);
  }
  const lastClose = close[close.length - 1] ?? 0;
  const meta: YahooMeta = {
    symbol: series.symbol,
    regularMarketPrice: lastClose,
    regularMarketDayHigh: high.length > 0 ? Math.max(...high) : 0,
    regularMarketDayLow: low.length > 0 ? Math.min(...low) : 0,
    regularMarketTime: timestamps[timestamps.length - 1],
    chartPreviousClose: close[0],
  };
  return { symbol: series.symbol, meta, timestamps, open, high, low, close, volume };
}

// ─── Index candle compat ─────────────────────────────────────────────────

/**
 * Authoritative index candles via the central backbone, returned in legacy
 * YahooChart format. Drop-in replacement for `fetchKiteIntraday()`.
 *
 * Data path: consumer → centralIndexCandles() → router.getIndexCandles()
 *            → kiteProvider.getIndexCandles() → fetchKiteIntraday()
 *            → Kite getHistoricalData API
 */
export async function centralIndexCandles(
  yahooSymbol: string,
  interval: "minute" | "3minute" | "5minute" | "10minute" | "15minute" | "30minute" | "60minute" | "day",
  daysBack: number,
): Promise<YahooChart | null> {
  const result = await router.getIndexCandles(yahooSymbol, interval, daysBack);
  if (!result.ok || !result.data) return null;
  return seriesToYahooChart(result.data);
}

/** True when the given Yahoo-style symbol has Kite index coverage. */
export function centralHasIndexCoverage(yahooSymbol: string): boolean {
  return router.hasIndexCoverage(yahooSymbol);
}

// ─── Equity candle compat ────────────────────────────────────────────────

/**
 * Authoritative equity candles via the central backbone, returned in legacy
 * YahooChart format. Drop-in replacement for `fetchKiteEquityIntraday()`.
 */
export async function centralEquityCandles(
  nseSymbol: string,
  interval: "minute" | "3minute" | "5minute" | "10minute" | "15minute" | "30minute" | "60minute" | "day",
  daysBack: number,
): Promise<YahooChart | null> {
  const result = await router.getEquityCandles(nseSymbol, interval, daysBack);
  if (!result.ok || !result.data) return null;
  return seriesToYahooChart(result.data);
}

// ─── Index quote compat ──────────────────────────────────────────────────

/**
 * Authoritative index quotes via the central backbone, returned in legacy
 * Map<string, IndexQuote> format. Drop-in replacement for `getKiteIndexQuotes()`.
 */
export async function centralIndexQuotes(): Promise<Map<string, {
  yahooSymbol: string;
  name: string;
  price: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  asOf: number | null;
}> | null> {
  const result = await router.getIndexQuotes();
  if (result.quotes.size === 0 && result.missing.length > 0) return null;
  const out = new Map<string, any>();
  for (const [key, q] of result.quotes) {
    out.set(key, {
      yahooSymbol: q.symbol,
      name: q.name ?? key,
      price: q.lastPrice,
      open: q.open,
      high: q.high,
      low: q.low,
      previousClose: q.previousClose,
      change: q.change,
      changePercent: q.changePercent,
      asOf: q.meta.asOf ? new Date(q.meta.asOf).getTime() : null,
    });
  }
  return out;
}

// ─── Live quote compat (feed cache) ─────────────────────────────────────

/**
 * Central live equity quote from the WebSocket feed cache.
 * Wraps `kiteFeed.getLiveQuote()`. Consumer files must use this, not the
 * raw feed module.
 */
export { getLiveQuote as centralLiveQuote } from "../kiteFeed";

// ─── Batch equity quotes compat ─────────────────────────────────────────

/**
 * Central batch equity quotes (Kite scanner `getQuote` batches).
 * Wraps `kiteScanner.loadKiteQuotes`. Consumer files must use this, not
 * the raw scanner module.
 */
export { loadKiteQuotes as centralBatchEquityQuotes } from "../kiteScanner";
export type { KiteScannerQuote } from "../kiteScanner";

// ─── Kite instrument resolution compat ──────────────────────────────────

/**
 * Central instrument token resolver (from the WebSocket feed cache).
 * Wraps `kiteFeed.getInstrumentToken`.
 */
export { getInstrumentToken as centralInstrumentToken } from "../kiteFeed";

/**
 * Central Kite NSE EQ instrument list (for universe resolution).
 * Wraps `kiteScanner.loadKiteNseEqInstruments`.
 */
export { loadKiteNseEqInstruments as centralKiteNseEqInstruments } from "../kiteScanner";

// ─── Token-based equity candles ─────────────────────────────────────────

export async function centralEquityCandlesByToken(
  instrumentToken: number,
  label: string,
  interval: "minute" | "3minute" | "5minute" | "10minute" | "15minute" | "30minute" | "60minute" | "day",
  daysBack: number,
): Promise<YahooChart | null> {
  const result = await router.getEquityCandlesByToken(instrumentToken, label, interval, daysBack);
  if (!result.ok || !result.data) return null;
  return seriesToYahooChart(result.data);
}

/**
 * Central Kite historical data by token (for swing benchmark + daily bars).
 * Wraps `kiteIntraday.fetchKiteHistoricalByToken`.
 */
export { fetchKiteHistoricalByToken as centralKiteHistoricalByToken } from "../kiteIntraday";

/**
 * Central index token map (for swing benchmark Kite fallback).
 * Wraps `kiteIntraday.getIndexTokenMap`.
 */
export { getIndexTokenMap as centralIndexTokenMap } from "../kiteIntraday";

// ─── ETF quote compat ───────────────────────────────────────────────────

/**
 * Central ETF helpers (recognition + Kite quote).
 * Wraps `kiteScanner.isRecognisedEtf`, `loadKiteEtfQuote`,
 * `getEtfRecognitionDiagnostics`, `checkEtfRecognition`.
 */
export {
  isRecognisedEtf as centralIsRecognisedEtf,
  loadKiteEtfQuote as centralLoadKiteEtfQuote,
  getEtfRecognitionDiagnostics as centralGetEtfRecognitionDiagnostics,
  checkEtfRecognition as centralCheckEtfRecognition,
} from "../kiteScanner";

// ─── F&O instruments compat ─────────────────────────────────────────────────

/**
 * Central F&O instrument cache (lot-size lookup + full instrument rows).
 * Wraps `kiteFnoInstruments` helpers. Consumers must use these, not the
 * raw provider directly — see PROVIDER_IMPORT_BURNDOWN.md.
 */
export {
  getCachedLotSizeForIndex as centralCachedLotSizeForIndex,
  getCachedFnoInstruments as centralCachedFnoInstruments,
} from "../kiteFnoInstruments";

// ─── Kite session compat ────────────────────────────────────────────────────

/**
 * Central active-session accessor (wraps `kiteAuth.getActiveSession`). Exposed
 * here so consumers can check session presence/login-time WITHOUT importing the
 * raw `kiteAuth` provider directly (keeps them out of the provider-import
 * burn-down allowlist — see docs/PROVIDER_IMPORT_BURNDOWN.md).
 */
export { getActiveSession as centralActiveSession } from "../kiteAuth";
export type { ActiveSession } from "../kiteAuth";

/**
 * Central active-session-status accessor (wraps `kiteAuth.getActiveSessionStatus`).
 * Same rationale as `centralActiveSession` above — keeps consumers off the raw
 * `kiteAuth` provider import.
 */
export { getActiveSessionStatus as centralActiveSessionStatus } from "../kiteAuth";
export type { ActiveSessionStatus } from "../kiteAuth";

/**
 * Central feed-status accessor (wraps `kiteFeed.feedStatus`). Keeps consumers
 * that only need websocket/feed diagnostics off the raw `kiteFeed` provider
 * import — see docs/PROVIDER_IMPORT_BURNDOWN.md.
 */
export { feedStatus as centralFeedStatus } from "../kiteFeed";

/**
 * Central Kite readiness accessor (wraps `kiteReadiness.getKiteReadiness`).
 * Exposed here so consumers (e.g. `kiteWarmup`) can read market-session /
 * feed-connected context for diagnostics WITHOUT importing the raw
 * `kiteFeed`/`kiteAuth` providers directly.
 */
export { getKiteReadiness as centralKiteReadiness } from "../kiteReadiness";
export type { KiteReadiness } from "../kiteReadiness";
