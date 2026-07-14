/**
 * Binance spot REST adapter — used for live tickers and historical klines for
 * the global scanner's crypto universe.
 *
 * No API key is needed for the public endpoints we use:
 *   GET https://api.binance.com/api/v3/ticker/24hr      (24h tickers)
 *   GET https://api.binance.com/api/v3/klines           (OHLCV candles)
 *
 * Real data only — if the upstream call fails we surface the error to the
 * caller; we never fabricate prices.
 */

import { logger } from "../logger";
import type { GlobalTimeframe } from "./universe";

// `data-api.binance.vision` is Binance's public, geo-unrestricted market-data
// mirror — `api.binance.com` returns HTTP 451 from many cloud regions
// (including Replit). The endpoints / response shapes are identical.
const BINANCE_BASE = "https://data-api.binance.vision";

const TF_TO_BINANCE: Record<GlobalTimeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

const FETCH_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/json", "User-Agent": "global-scanner/1.0" },
    });
  } finally {
    clearTimeout(t);
  }
}

export interface BinanceTicker24h {
  symbol: string;
  lastPrice: number;
  prevClosePrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;       // base asset volume
  quoteVolume: number;
  openTime: number;
  closeTime: number;
}

/**
 * Fetch 24h ticker for many symbols in one batch call.
 * Empty result on upstream failure; the caller flags affected rows stale.
 */
export async function fetchBinanceTickers(symbols: string[]): Promise<BinanceTicker24h[]> {
  if (symbols.length === 0) return [];
  // Binance accepts a JSON array as the `symbols=` query value.
  const symbolsParam = encodeURIComponent(JSON.stringify(symbols.map(s => s.toUpperCase())));
  const url = `${BINANCE_BASE}/api/v3/ticker/24hr?symbols=${symbolsParam}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`binance ticker24hr ${res.status}: ${txt.slice(0, 200)}`);
  }
  const raw = (await res.json()) as Array<Record<string, string>>;
  return raw.map(r => ({
    symbol: String(r["symbol"] ?? ""),
    lastPrice: Number(r["lastPrice"] ?? 0),
    prevClosePrice: Number(r["prevClosePrice"] ?? 0),
    priceChange: Number(r["priceChange"] ?? 0),
    priceChangePercent: Number(r["priceChangePercent"] ?? 0),
    highPrice: Number(r["highPrice"] ?? 0),
    lowPrice: Number(r["lowPrice"] ?? 0),
    volume: Number(r["volume"] ?? 0),
    quoteVolume: Number(r["quoteVolume"] ?? 0),
    openTime: Number(r["openTime"] ?? 0),
    closeTime: Number(r["closeTime"] ?? 0),
  }));
}

export interface BinanceKline {
  t: number;          // ms open time
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;     // base asset volume
}

const TF_LIMIT_DEFAULT: Record<GlobalTimeframe, number> = {
  "1m": 240,
  "5m": 240,
  "15m": 240,
  "1h": 240,
  "4h": 240,
  "1d": 365,
};

export async function fetchBinanceKlines(
  symbol: string,
  timeframe: GlobalTimeframe,
  limit?: number,
): Promise<BinanceKline[]> {
  const interval = TF_TO_BINANCE[timeframe];
  const lim = Math.min(1000, Math.max(1, limit ?? TF_LIMIT_DEFAULT[timeframe]));
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=${interval}&limit=${lim}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`binance klines ${symbol}/${timeframe} ${res.status}: ${txt.slice(0, 200)}`);
  }
  const raw = (await res.json()) as Array<unknown[]>;
  // Each kline row: [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBaseVol, takerQuoteVol, ignore]
  return raw.map(row => ({
    t: Number(row[0] ?? 0),
    open: Number(row[1] ?? 0),
    high: Number(row[2] ?? 0),
    low: Number(row[3] ?? 0),
    close: Number(row[4] ?? 0),
    volume: Number(row[5] ?? 0),
  }));
}

export function logBinanceModuleBoot(): void {
  logger.info({ source: "binance" }, "Global scanner Binance adapter ready");
}
