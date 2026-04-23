/**
 * Watchlist data builder.
 *
 * For each watchlist symbol we fetch a recent daily chart from Yahoo Finance,
 * derive intraday quote (price/change/volume/high/low), short-term EMAs and
 * RSI(14), then classify into a Moneycontrol-style "MC Trend Short Term":
 *
 *   Very Bullish : price > EMA20 > EMA50 AND RSI > 60 AND %chg > 0
 *   Bullish      : price > EMA20 AND RSI > 50
 *   Neutral      : price within 0.5% of EMA20
 *   Bearish      : price < EMA20 AND RSI < 50
 *   Very Bearish : price < EMA20 < EMA50 AND RSI < 40
 */

import { fetchChart } from "./yahoo";
import { ema, rsi } from "./indicators";
import { logger } from "./logger";
import {
  type WatchlistKey,
  WATCHLIST_META,
  getWatchlistSymbols,
  watchlistName,
} from "./watchlistLists";
import { getEntry } from "./universe";

function displayName(symbol: string): string {
  return getEntry(symbol)?.name ?? watchlistName(symbol);
}

export type MCTrend = "Very Bullish" | "Bullish" | "Neutral" | "Bearish" | "Very Bearish";

export interface WatchlistRow {
  symbol: string;
  name: string;
  livePrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  open: number;
  todayHigh: number;
  todayLow: number;
  volume: number;
  ema20?: number;
  ema50?: number;
  rsi?: number;
  mcTrend: MCTrend;
}

export interface WatchlistResponse {
  key: WatchlistKey;
  label: string;
  description: string;
  asOf: string;
  count: number;
  rows: WatchlistRow[];
}

interface CacheEntry { ts: number; data: WatchlistResponse }
const cache = new Map<WatchlistKey, CacheEntry>();
const TTL_MS = 60 * 1000; // 60s

const CONCURRENCY = 8;

function classify(price: number, e20?: number, e50?: number, r?: number, chgPct?: number): MCTrend {
  if (e20 != null && e50 != null && r != null && chgPct != null) {
    if (price > e20 && e20 > e50 && r > 60 && chgPct > 0) return "Very Bullish";
    if (price < e20 && e20 < e50 && r < 40) return "Very Bearish";
  }
  if (e20 != null && r != null) {
    if (price > e20 && r > 50) return "Bullish";
    if (price < e20 && r < 50) return "Bearish";
  }
  return "Neutral";
}

async function buildRow(symbol: string): Promise<WatchlistRow | null> {
  const c = await fetchChart(symbol, "3mo", "1d", "NS");
  if (!c || c.close.length < 2) return null;

  const closes = c.close.filter((v): v is number => v != null);
  if (closes.length < 2) return null;
  const lastIdx = c.close.length - 1;
  const last = c.meta.regularMarketPrice ?? closes[closes.length - 1]!;
  const prev = c.close[lastIdx - 1] ?? c.meta.chartPreviousClose ?? last;
  const open = c.open[lastIdx] ?? last;
  const high = c.high[lastIdx] ?? last;
  const low = c.low[lastIdx] ?? last;
  const vol = c.volume[lastIdx] ?? 0;
  const change = last - prev;
  const changePct = prev > 0 ? (change / prev) * 100 : 0;

  const e20Series = ema(closes, 20);
  const e50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const e20 = e20Series.at(-1) ?? undefined;
  const e50 = e50Series.at(-1) ?? undefined;
  const r = rsiSeries.at(-1) ?? undefined;

  return {
    symbol,
    name: displayName(symbol),
    livePrice: round2(last),
    previousClose: round2(prev),
    change: round2(change),
    changePercent: +changePct.toFixed(2),
    open: round2(open),
    todayHigh: round2(high),
    todayLow: round2(low),
    volume: vol,
    ema20: e20 != null ? round2(e20) : undefined,
    ema50: e50 != null ? round2(e50) : undefined,
    rsi: r != null ? +r.toFixed(1) : undefined,
    mcTrend: classify(last, e20 ?? undefined, e50 ?? undefined, r ?? undefined, changePct),
  };
}

function round2(v: number): number { return Math.round(v * 100) / 100; }

export async function getWatchlist(key: WatchlistKey): Promise<WatchlistResponse> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.ts < TTL_MS) return cached.data;

  const symbols = getWatchlistSymbols(key);
  const rows: WatchlistRow[] = [];
  let cursor = 0;
  const t0 = Date.now();

  async function worker(): Promise<void> {
    while (cursor < symbols.length) {
      const i = cursor++;
      const sym = symbols[i]!;
      try {
        const row = await buildRow(sym);
        if (row) rows.push(row);
      } catch (err) {
        logger.warn({ err: (err as Error).message, sym }, "watchlist row failed");
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Stable order: matches the input list order so users see canonical sequence.
  const order = new Map(symbols.map((s, i) => [s, i]));
  rows.sort((a, b) => (order.get(a.symbol) ?? 9999) - (order.get(b.symbol) ?? 9999));

  const meta = WATCHLIST_META[key];
  const data: WatchlistResponse = {
    key,
    label: meta.label,
    description: meta.description,
    asOf: new Date().toISOString(),
    count: rows.length,
    rows,
  };

  if (rows.length > 0) {
    cache.set(key, { ts: now, data });
  } else if (cached) {
    // serve stale cache rather than empty
    return cached.data;
  }
  logger.info({ key, count: rows.length, ms: Date.now() - t0 }, "watchlist built");
  return data;
}
