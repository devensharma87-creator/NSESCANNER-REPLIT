/**
 * Kite provider adapter — wraps the existing Kite modules and stamps every
 * datum as authoritative-tier with a validated `DataMeta`. This is the ONLY
 * place the trusted layer talks to Kite, so freshness/completeness tagging is
 * applied uniformly.
 *
 * Returns `null` (never fabricated data) when Kite is offline so the router can
 * surface an explicit "Kite session inactive" state instead of silently
 * swapping in Yahoo.
 */

import { getKiteIndexQuotes } from "../kiteIndexQuotes";
import { loadKiteQuotes, loadKiteEtfQuote } from "../kiteScanner";
import { getLiveQuote, feedStatus } from "../kiteFeed";
import { getKiteCreds } from "../kiteAuth";
import { fetchKiteEquityIntraday, fetchKiteIntraday, hasKiteIntradayCoverage } from "../kiteIntraday";
import { buildMeta, isQuoteComplete } from "./validator";
import type {
  Candle,
  CandleSeries,
  MarketQuote,
} from "./types";

type KiteInterval =
  | "minute" | "3minute" | "5minute" | "10minute"
  | "15minute" | "30minute" | "60minute" | "day";

export interface KiteProviderHealth {
  credsConfigured: boolean;
  running: boolean;
  connected: boolean;
  subscribed: number;
  liveQuotes: number;
  lastConnectAt: string | null;
  lastError: string | null;
}

export function kiteHealth(): KiteProviderHealth {
  const f = feedStatus();
  return {
    credsConfigured: !!getKiteCreds(),
    running: f.running,
    connected: f.connected,
    subscribed: f.subscribed,
    liveQuotes: f.liveQuotes,
    lastConnectAt: f.lastConnectAt,
    lastError: f.lastError,
  };
}

/** True when Kite can currently serve authoritative live data. */
export function kiteSessionActive(): boolean {
  const f = feedStatus();
  return !!getKiteCreds() && f.running && f.connected;
}

function quoteMeta(asOfMs: number | null, complete: boolean, warnings?: string[]) {
  return buildMeta({
    source: "kite",
    trustTier: "authoritative",
    asOfMs,
    delayed: false,
    notForSignals: false,
    complete,
    warnings,
  });
}

/** Authoritative live quote for a single NSE EQ symbol via the WS tick cache. */
export function getEquityLiveQuote(symbol: string): MarketQuote | null {
  const t = getLiveQuote(symbol);
  if (!t || !(t.ltp > 0)) return null;
  const prev = t.close;
  const core = {
    symbol,
    lastPrice: t.ltp,
    open: t.open,
    high: t.high,
    low: t.low,
    previousClose: prev,
    change: prev != null ? t.ltp - prev : undefined,
    changePercent: t.changePercent,
    volume: t.volume,
  };
  return {
    ...core,
    meta: quoteMeta(t.ts, isQuoteComplete(core)),
  };
}

/** Authoritative batch equity quotes via the REST quote endpoint. */
export async function getEquityQuotes(
  symbols: string[],
): Promise<Map<string, MarketQuote> | null> {
  const raw = await loadKiteQuotes(symbols);
  if (!raw) return null;
  const out = new Map<string, MarketQuote>();
  for (const [sym, q] of raw) {
    const core = {
      symbol: sym,
      name: q.name,
      lastPrice: q.lastPrice,
      open: q.open,
      high: q.high,
      low: q.low,
      previousClose: q.close,
      change: q.change,
      changePercent: q.changePercent,
      volume: q.volume,
    };
    out.set(sym, { ...core, meta: quoteMeta(q.ts, isQuoteComplete(core)) });
  }
  return out;
}

/** Authoritative single ETF quote (kiteScanner ETF path). */
export async function getEtfQuote(symbol: string): Promise<MarketQuote | null> {
  const q = await loadKiteEtfQuote(symbol);
  if (!q) return null;
  const core = {
    symbol: q.symbol,
    name: q.name,
    lastPrice: q.lastPrice,
    open: q.open,
    high: q.high,
    low: q.low,
    previousClose: q.close,
    change: q.change,
    changePercent: q.changePercent,
    volume: q.volume,
  };
  return { ...core, meta: quoteMeta(q.ts, isQuoteComplete(core)) };
}

/** Authoritative index quotes (NIFTY/BANKNIFTY/SENSEX/etc). */
export async function getIndexQuotes(): Promise<Map<string, MarketQuote> | null> {
  const raw = await getKiteIndexQuotes();
  if (!raw) return null;
  const out = new Map<string, MarketQuote>();
  for (const [key, q] of raw) {
    const core = {
      symbol: q.yahooSymbol,
      name: q.name,
      lastPrice: q.price,
      open: q.open,
      high: q.high,
      low: q.low,
      previousClose: q.previousClose,
      change: q.change,
      changePercent: q.changePercent,
    };
    out.set(key, { ...core, meta: quoteMeta(q.asOf, isQuoteComplete(core)) });
  }
  return out;
}

/** Authoritative daily/intraday candles for an NSE EQ symbol. */
export async function getEquityCandles(
  nseSymbol: string,
  interval: KiteInterval,
  daysBack: number,
): Promise<CandleSeries | null> {
  const chart = await fetchKiteEquityIntraday(nseSymbol, interval, daysBack);
  if (!chart || chart.close.length === 0) return null;
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
  return {
    symbol: nseSymbol,
    interval,
    candles,
    meta: buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: lastTsSec != null ? lastTsSec * 1000 : null,
      delayed: false,
      notForSignals: false,
      complete: candles.length > 0,
    }),
  };
}

/**
 * Authoritative index candles (NIFTY, BANKNIFTY, SENSEX, INDIAVIX, etc).
 * Wraps `fetchKiteIntraday` which uses the INDEX_TABLE to resolve Yahoo-style
 * index symbols (e.g. "^NSEI") to Kite instrument tokens.
 *
 * Returns null when Kite is offline — NEVER fabricates bars.
 */
export async function getIndexCandles(
  yahooSymbol: string,
  interval: KiteInterval,
  daysBack: number,
): Promise<CandleSeries | null> {
  const chart = await fetchKiteIntraday(yahooSymbol, interval, daysBack);
  if (!chart || chart.close.length === 0) return null;
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
  return {
    symbol: yahooSymbol,
    interval,
    candles,
    meta: buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: lastTsSec != null ? lastTsSec * 1000 : null,
      delayed: false,
      notForSignals: false,
      complete: candles.length > 0,
    }),
  };
}

/** True when the given Yahoo-style symbol has Kite index coverage. */
export { hasKiteIntradayCoverage as hasIndexCoverage };

