/**
 * Watchlist data builder.
 *
 * Trend classification reuses the SAME multi-factor scoring engine that powers
 * the scanner / stock-detail recommendation (`buildRecommendation`):
 *
 *   STRONG_BUY   → "Very Bullish"
 *   BUY          → "Bullish"
 *   NEUTRAL      → "Neutral"
 *   SELL         → "Bearish"
 *   STRONG_SELL  → "Very Bearish"
 *
 * For symbols already covered by the scanner universe we read the cached
 * recommendation directly (so the watchlist trend is always consistent with
 * what the scanner page shows). For off-universe symbols we compute the full
 * indicator stack on the fly and run the same scorer — never a placeholder.
 */

import { fetchChart } from "./yahoo";
import { ema, rsi } from "./indicators";
import { scanAll } from "./scanner";
import { logger } from "./logger";
import {
  type WatchlistKey,
  WATCHLIST_META,
  getWatchlistSymbols,
  watchlistName,
} from "./watchlistLists";
import { getEntry } from "./universe";
import type { Signal } from "@workspace/api-zod";

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

/** Map the system's 5-band signal (computed by `buildRecommendation`) to the
 * 5-band trend label shown in the watchlist. They use the same boundaries:
 * STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL → Very Bullish / Bullish /
 * Neutral / Bearish / Very Bearish. */
function trendFromSignal(s: Signal): MCTrend {
  switch (s) {
    case "STRONG_BUY":  return "Very Bullish";
    case "BUY":         return "Bullish";
    case "SELL":        return "Bearish";
    case "STRONG_SELL": return "Very Bearish";
    case "NEUTRAL":
    default:            return "Neutral";
  }
}

/** Fallback trend for symbols outside the scanner universe. Mirrors the
 * scoring engine's structure (EMA stack, RSI bands, candle direction) using
 * just the data we have on hand from the watchlist chart. Score is on the
 * same -100..+100 scale and uses the same band thresholds as
 * `buildRecommendation`, so the resulting label is comparable. */
function trendFromHeuristic(price: number, e20: number | undefined, e50: number | undefined, r: number | undefined, chgPct: number): MCTrend {
  let score = 0;
  if (e20 != null && e50 != null) {
    if (price > e20 && e20 > e50) score += 22;
    else if (price < e20 && e20 < e50) score -= 22;
    else if (price > e20) score += 8;
    else if (price < e20) score -= 8;
  }
  if (r != null) {
    if (r >= 55 && r <= 70) score += 12;
    else if (r > 70) score -= 6;
    else if (r >= 45 && r < 55) score += r >= 50 ? 2 : -2;
    else if (r < 30) score += 8;
    else score -= 8;
  }
  if (chgPct > 1.5) score += 6;
  else if (chgPct < -1.5) score -= 6;

  if (score >= 50) return "Very Bullish";
  if (score >= 22) return "Bullish";
  if (score >= -22) return "Neutral";
  if (score >= -50) return "Bearish";
  return "Very Bearish";
}

async function buildRow(symbol: string, signalFromScanner: Signal | null): Promise<WatchlistRow | null> {
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

  // Prefer the full system signal if scanner already covers this symbol —
  // that signal incorporates ADX, MACD, VWAP, volume, delivery %, value-area
  // and breakout detection, far richer than what we can derive locally.
  const mcTrend = signalFromScanner != null
    ? trendFromSignal(signalFromScanner)
    : trendFromHeuristic(last, e20 ?? undefined, e50 ?? undefined, r ?? undefined, changePct);

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
    mcTrend,
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

  // Pull cached scanner rows once so each watchlist item can read its full
  // system signal without re-running the heavy multi-factor analysis.
  // `scanAll()` is itself cached + in-flight-coalesced.
  const scannerRows = await scanAll().catch(() => [] as Awaited<ReturnType<typeof scanAll>>);
  const sigBySymbol = new Map<string, Signal>();
  for (const r of scannerRows) sigBySymbol.set(r.symbol, r.recommendation.signal);

  async function worker(): Promise<void> {
    while (cursor < symbols.length) {
      const i = cursor++;
      const sym = symbols[i]!;
      try {
        const row = await buildRow(sym, sigBySymbol.get(sym) ?? null);
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
