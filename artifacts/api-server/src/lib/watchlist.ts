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
 * Data policy (Task #125 — Watchlist migrated onto the central trusted layer):
 *   - PRICES / OHLC / volume / previous-close come ONLY from the central
 *     market-data router (`marketRouter.getEquityQuotes`), which is Kite
 *     authoritative. Yahoo is NEVER consulted here — there is no direct
 *     provider import in this module.
 *   - The live scanner (`scanAll`) is reused ONLY to ENRICH a row with the
 *     system signal (→ trend) and EMA20/EMA50/RSI14. It never supplies price.
 *   - Constituents the router cannot price are reported in
 *     `provenance.missingSymbols` with a concrete reason — never back-filled
 *     from a delayed/secondary source, never fabricated.
 */

import { router as marketRouter } from "./marketData";
import { sourcePriority } from "./marketData";
import type {
  DataMeta,
  ProviderName,
  TrustedQuote,
} from "./marketData";
import { scanAll } from "./scanner";
import { logger } from "./logger";
import {
  type WatchlistKey,
  WATCHLIST_META,
  getWatchlistSymbols,
  watchlistName,
} from "./watchlistLists";
import { getEntry } from "./universe";
import type { Signal, StockRow } from "@workspace/api-zod";

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

/**
 * Response-level provenance envelope (Task #125). Lets the frontend show where
 * the watchlist prices came from, how fresh they are, whether any failover
 * occurred, and which constituents could not be priced — without breaking the
 * existing UI shape (these are additive fields; the legacy fields are intact).
 *
 * Field-name note: the central layer + DB columns use snake_case
 * (source_provider, source_priority, freshness_sec, is_stale, fallback_used,
 * missing_symbols); the JSON API surface is camelCase throughout, so the same
 * concepts are exposed here as sourceProvider / sourcePriority / freshnessSec /
 * isStale / fallbackUsed / missingSymbols.
 */
export interface WatchlistProvenance {
  /** Dominant upstream that produced the batch (Kite when authoritative). */
  sourceProvider: ProviderName;
  /** Trust priority of the source (1 authoritative / 2 validation / 3 analytics / 99 unknown). */
  sourcePriority: number;
  /** ISO data-instant of the freshest row in the batch, or null when unknown. */
  asOf: string | null;
  /** Age of the batch data in seconds (now − asOf), or null when unknown. */
  freshnessSec: number | null;
  /** True when the batch is older than the freshness budget. */
  isStale: boolean;
  /** True if any returned row came from a non-authoritative (failover) source. */
  fallbackUsed: boolean;
  /** Human-readable degradation / fallback notes from the layer. */
  warnings: string[];
  /** Constituents that could not be priced, each with a concrete reason. */
  missingSymbols: Array<{ symbol: string; reason: string }>;
}

export interface WatchlistResponse {
  key: WatchlistKey;
  label: string;
  description: string;
  asOf: string;
  count: number;
  rows: WatchlistRow[];
  provenance: WatchlistProvenance;
}

interface CacheEntry { ts: number; data: WatchlistResponse }
const cache = new Map<WatchlistKey, CacheEntry>();
const TTL_MS = 60 * 1000; // 60s

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
 * just the data we have on hand. Score is on the same -100..+100 scale and
 * uses the same band thresholds as `buildRecommendation`, so the resulting
 * label is comparable. */
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

function round2(v: number): number { return Math.round(v * 100) / 100; }

/** Per-symbol enrichment pulled from the live scanner (NEVER price). */
export interface WatchlistEnrichment {
  signal?: Signal;
  ema20?: number;
  ema50?: number;
  rsi14?: number;
}

/**
 * Build a watchlist row from a TRUSTED central-layer quote (Kite authoritative)
 * plus optional scanner enrichment.
 *
 * STRICT non-synthetic gating: a row is emitted only when the trusted quote
 * carries a real, positive last price, previous close and full OHLC, plus a
 * present (non-negative) volume. We never fabricate price/OHLC/volume and never
 * coerce missing indicators to 0. When a required field is absent the caller
 * records the symbol as missing rather than emitting a half-real row.
 *
 * Returns null when the quote is incomplete (caller → missingSymbols).
 */
export function rowFromTrustedQuote(
  q: TrustedQuote,
  enrich: WatchlistEnrichment | undefined,
): WatchlistRow | null {
  const last = q.lastPrice;
  const prev = q.previousClose;
  const open = q.open;
  const high = q.high;
  const low = q.low;
  const vol = q.volume;

  if (
    !(last > 0) ||
    prev == null || !(prev > 0) ||
    open == null || !(open > 0) ||
    high == null || !(high > 0) ||
    low == null || !(low > 0) ||
    vol == null || !(vol >= 0)
  ) {
    return null;
  }

  // Single source of truth for change/changePct: derive from canonical
  // last + prev so the four price fields are always mathematically consistent.
  const change = last - prev;
  const changePct = (change / prev) * 100;

  const e20 = enrich?.ema20;
  const e50 = enrich?.ema50;
  const r = enrich?.rsi14;

  // Prefer the full system signal if the scanner already covers this symbol —
  // that signal incorporates ADX, MACD, VWAP, volume, delivery %, value-area
  // and breakout detection, far richer than what we can derive locally. When
  // the symbol is off-universe the heuristic only weighs available EMA/RSI +
  // changePct, so small moves correctly degrade to "Neutral".
  const mcTrend = enrich?.signal != null
    ? trendFromSignal(enrich.signal)
    : trendFromHeuristic(last, e20, e50, r, changePct);

  return {
    symbol: q.symbol,
    name: q.name ?? displayName(q.symbol),
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

/** Roll a batch envelope + returned quotes into the response-level provenance. */
function buildProvenance(
  meta: DataMeta,
  quotes: TrustedQuote[],
  missing: Array<{ symbol: string; reason: string }>,
): WatchlistProvenance {
  // The central equity router is Kite-only (authoritative); fallbackUsed is
  // computed honestly from what actually came back rather than assumed false.
  const fallbackUsed = quotes.some((q) => q.meta.trustTier !== "authoritative");
  return {
    sourceProvider: meta.source,
    sourcePriority: sourcePriority(meta.trustTier),
    asOf: meta.asOf,
    freshnessSec: meta.freshnessSec,
    isStale: meta.isStale,
    fallbackUsed,
    warnings: meta.warnings,
    missingSymbols: missing,
  };
}

export async function getWatchlist(key: WatchlistKey): Promise<WatchlistResponse> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.ts < TTL_MS) return cached.data;

  const symbols = getWatchlistSymbols(key);
  const t0 = Date.now();

  // PRICES: authoritative quotes via the trusted central router (Kite-only;
  // never Yahoo). One batched call covers the whole basket, so baskets stay
  // full without per-symbol fetches (the cause of the earlier "0 stocks"
  // outage). Missing constituents are reported, not back-filled.
  const batch = await marketRouter.getEquityQuotes(symbols);

  // ENRICHMENT ONLY (never price): the live scanner already holds the full
  // multi-factor system signal + EMA20/EMA50/RSI14 for the NSE EQ universe.
  // Best-effort — a scanner miss just means the trend falls back to the local
  // heuristic, never a guess.
  const enrichBySymbol = new Map<string, WatchlistEnrichment>();
  try {
    const scannerRows = (await scanAll()) as StockRow[];
    for (const r of scannerRows) {
      enrichBySymbol.set(r.symbol, {
        signal: r.recommendation.signal,
        ema20: r.indicators?.ema20 ?? undefined,
        ema50: r.indicators?.ema50 ?? undefined,
        rsi14: r.indicators?.rsi14 ?? undefined,
      });
    }
  } catch (err) {
    logger.warn({ key, err: (err as Error).message }, "watchlist trend enrichment skipped (scanner unavailable)");
  }

  const rows: WatchlistRow[] = [];
  const missing: Array<{ symbol: string; reason: string }> = [...batch.missing];

  // Preserve canonical basket order (matches the input list).
  for (const sym of symbols) {
    const q = batch.quotes.get(sym);
    if (!q) continue; // already accounted for in batch.missing
    const row = rowFromTrustedQuote(q, enrichBySymbol.get(sym));
    if (row) rows.push(row);
    else missing.push({ symbol: sym, reason: "incomplete quote: missing required price/OHLC/volume field" });
  }

  const meta = WATCHLIST_META[key];
  const data: WatchlistResponse = {
    key,
    label: meta.label,
    description: meta.description,
    asOf: new Date().toISOString(),
    count: rows.length,
    rows,
    provenance: buildProvenance(batch.meta, [...batch.quotes.values()], missing),
  };

  // Cache-admission policy: only overwrite the cache when the new result is at
  // least as complete as the previous one (or when there is no prior cache).
  // This prevents a partial-degradation request — e.g. Kite returned fewer
  // symbols on one tick — from poisoning a previously-full cached response for
  // the next 60s. When the new response is worse, we serve the stale-but-
  // complete cache instead.
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

  logger.info({
    key,
    count: rows.length,
    requested: symbols.length,
    missing: missing.length,
    source: batch.meta.source,
    stale: batch.meta.isStale,
    ms: Date.now() - t0,
  }, "watchlist built (central trusted layer)");
  return data;
}
