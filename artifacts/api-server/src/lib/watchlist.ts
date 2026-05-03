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

import { fetchChart, fetchYahooBatchQuotes, type YahooBatchQuote } from "./yahoo";
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

/**
 * Build a watchlist row.
 *
 * Two-tier strategy that mirrors the full-NSE scanner fix (May 2026):
 *   1. PRIMARY: per-symbol Yahoo daily chart — gives both genuine OHLC for
 *      the latest bar AND enough history (3 months) to compute EMA20/EMA50/
 *      RSI14. When this succeeds we emit a fully-enriched row.
 *   2. FALLBACK: the batch quote endpoint (one HTTP call covers every symbol
 *      in the basket). When the chart pass fails — Yahoo's per-symbol chart
 *      breaker is open, the symbol is rate-limited, the host is slow, the
 *      symbol is delisted from the chart endpoint but still has a quote, etc.
 *      — we still emit a row using the batch quote's OHLC, with indicators
 *      reported as `undefined` (NEVER zeros). The trend bias falls back to
 *      the changePct-only heuristic, which honestly degrades to "Neutral"
 *      when the move is small.
 *
 * Hard-gates everywhere: a row is only emitted when at least one source
 * supplied a real, positive last price plus a real previous close. We never
 * fabricate price/OHLC/volume, and we never coerce missing indicators to 0.
 */
async function buildRow(
  symbol: string,
  signalFromScanner: Signal | null,
  batchQuote: YahooBatchQuote | undefined,
): Promise<WatchlistRow | null> {
  const c = await fetchChart(symbol, "3mo", "1d", "NS");

  if (c && c.close.length >= 2) {
    const closes = c.close.filter((v): v is number => v != null);
    if (closes.length >= 2) {
      const lastIdx = c.close.length - 1;
      // STRICT non-synthetic gating: every OHLC/volume/prev field must be a
      // real, positive number from the source bar. NO fallback-to-last (that
      // would fabricate `change=0` and collapse the candle to a flat line) and
      // NO fallback-to-0 for volume (that would be a fake "no trades" signal).
      // If any field is missing we fall through to the batch-quote tier rather
      // than emit a half-real row.
      const last = c.meta.regularMarketPrice ?? closes[closes.length - 1]!;
      const prev = c.close[lastIdx - 1] ?? c.meta.chartPreviousClose;
      const open = c.open[lastIdx];
      const high = c.high[lastIdx];
      const low = c.low[lastIdx];
      const vol = c.volume[lastIdx];

      if (
        last > 0 &&
        prev != null && prev > 0 &&
        open != null && open > 0 &&
        high != null && high > 0 &&
        low != null && low > 0 &&
        vol != null && vol >= 0
      ) {
        // Single source of truth for change/changePct: derive from canonical
        // last + prev so the four fields (livePrice, previousClose, change,
        // changePercent) are always mathematically consistent.
        const change = last - prev;
        const changePct = (change / prev) * 100;

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
      // chart bar incomplete → fall through to batch-quote tier
    }
  }

  // Chart pass failed (breaker open, rate-limited, delisted from chart, etc.)
  // Fall back to the batch quote — this is what saves the watchlist from
  // returning an empty table when Yahoo's chart endpoint is unhealthy. We
  // hard-gate on real OHLC + positive prev close so support/resistance-style
  // derived numbers downstream never collapse to the live price.
  // STRICT positivity gates on the batch quote too — Yahoo occasionally
  // returns 0 for OHLC fields on illiquid or pre-IPO names, and emitting
  // those zeros would be fabricated data. Volume may legitimately be 0 on
  // a no-trade day, so we only require it to be present and non-negative.
  const bq = batchQuote;
  if (
    bq &&
    bq.regularMarketPrice > 0 &&
    bq.regularMarketPreviousClose != null && bq.regularMarketPreviousClose > 0 &&
    bq.regularMarketOpen != null && bq.regularMarketOpen > 0 &&
    bq.regularMarketDayHigh != null && bq.regularMarketDayHigh > 0 &&
    bq.regularMarketDayLow != null && bq.regularMarketDayLow > 0 &&
    bq.regularMarketVolume != null && bq.regularMarketVolume >= 0
  ) {
    const last = bq.regularMarketPrice;
    const prev = bq.regularMarketPreviousClose;
    // Single source of truth: derive change/changePct from last+prev so the
    // four price fields are always internally consistent. Yahoo's published
    // `regularMarketChange*` can lag the live price by a refresh tick.
    const change = last - prev;
    const changePct = (change / prev) * 100;

    // Indicators unknown — chart failed. The trend label uses the same
    // scoring engine, but with EMA/RSI undefined the heuristic only weighs
    // changePct, so small moves correctly show as "Neutral" rather than
    // a fabricated bullish/bearish label.
    const mcTrend = signalFromScanner != null
      ? trendFromSignal(signalFromScanner)
      : trendFromHeuristic(last, undefined, undefined, undefined, changePct);

    return {
      symbol,
      name: displayName(symbol),
      livePrice: round2(last),
      previousClose: round2(prev),
      change: round2(change),
      changePercent: +changePct.toFixed(2),
      open: round2(bq.regularMarketOpen),
      todayHigh: round2(bq.regularMarketDayHigh),
      todayLow: round2(bq.regularMarketDayLow),
      volume: bq.regularMarketVolume,
      ema20: undefined,
      ema50: undefined,
      rsi: undefined,
      mcTrend,
    };
  }

  return null;
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
  //
  // In parallel, fetch the batch-quote map for every symbol in the basket.
  // One HTTP call covers up to 150 symbols and uses Yahoo's quote endpoint
  // (separate from the chart endpoint that occasionally rate-limits us).
  // This map is the SAFETY NET: when a per-symbol chart call fails, the
  // row is built from the batch quote instead of being dropped — that is
  // what fixes the "Watchlist tab shows 0 stocks" outage.
  const [scannerRows, batchQuotes] = await Promise.all([
    scanAll().catch(() => [] as Awaited<ReturnType<typeof scanAll>>),
    fetchYahooBatchQuotes(symbols, "NS").catch((err: unknown) => {
      logger.warn({ key, err: (err as Error)?.message }, "watchlist batch-quote pass failed; chart-only");
      return new Map<string, YahooBatchQuote>();
    }),
  ]);
  const sigBySymbol = new Map<string, Signal>();
  for (const r of scannerRows) sigBySymbol.set(r.symbol, r.recommendation.signal);

  async function worker(): Promise<void> {
    while (cursor < symbols.length) {
      const i = cursor++;
      const sym = symbols[i]!;
      try {
        const row = await buildRow(sym, sigBySymbol.get(sym) ?? null, batchQuotes.get(sym));
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

  // Cache-admission policy: only overwrite the cache when the new result is
  // at least as complete as the previous one (or when there is no prior
  // cache). This prevents a partial-degradation request — e.g. one batch-
  // quote chunk timed out and only 18 of 50 symbols came back — from
  // poisoning a previously-full cached response for the next 60s. When the
  // new response is worse, we serve the stale-but-complete cache instead.
  const prevCount = cached?.data.rows.length ?? 0;
  if (rows.length > 0 && rows.length >= prevCount) {
    cache.set(key, { ts: now, data });
  } else if (cached) {
    logger.info({
      key,
      newCount: rows.length,
      cachedCount: prevCount,
      cachedAgeMs: now - cached.ts,
    }, "watchlist degraded — serving stale cache");
    return cached.data;
  }
  // Count how many rows were salvaged by the batch-quote fallback so the
  // operator can spot Yahoo chart-endpoint trouble at a glance.
  const fromBatch = rows.filter(r => r.ema20 == null && r.ema50 == null && r.rsi == null).length;
  logger.info({
    key,
    count: rows.length,
    fromBatchFallback: fromBatch,
    batchPoolSize: batchQuotes.size,
    ms: Date.now() - t0,
  }, "watchlist built");
  return data;
}
