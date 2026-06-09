/**
 * Rich watchlist BASKET builder — the trust-tagged sibling of `getWatchlist`.
 *
 * Where `getWatchlist` returns display-oriented rows, this builds an honest,
 * fully-provenanced basket: every row flows through the central market-data
 * router (Kite authoritative), carries source/asof/freshness/stale/trust-tier/
 * validation metadata, and missing constituents are reported with a concrete
 * reason (never silently dropped, never fabricated).
 *
 * Trend is enriched from the live scanner recommendation when the symbol is in
 * the scanner universe (reusing the SAME signal the scanner page shows — no new
 * scoring math); otherwise it is honestly null.
 */

import { router as marketRouter } from "./marketData";
import type {
  DataMeta,
  ProviderName,
  TrustTier,
  TrustedQuote,
  ValidationStatus,
} from "./marketData";
import {
  type WatchlistKey,
  WATCHLIST_META,
  getWatchlistSymbols,
  watchlistName,
} from "./watchlistLists";
import { scanAll } from "./scanner";
import { getEntry } from "./universe";
import { logger } from "./logger";
import type { Signal, StockRow } from "@workspace/api-zod";

export type BasketTrend =
  | "Very Bullish"
  | "Bullish"
  | "Neutral"
  | "Bearish"
  | "Very Bearish";

export interface BasketRow {
  symbol: string;
  name: string;
  lastPrice: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  /** From the scanner system signal when covered; null otherwise (honest). */
  trend: BasketTrend | null;
  /** RSI(14) passed through from the live scanner row when covered; null otherwise (honest). */
  rsi: number | null;
  source: ProviderName;
  trustTier: TrustTier;
  asOf: string | null;
  fetchedAt: string;
  freshnessSec: number | null;
  isStale: boolean;
  validationStatus: ValidationStatus;
  warnings: string[];
}

export interface BasketResponse {
  key: WatchlistKey;
  alias: string;
  label: string;
  description: string;
  generatedAt: string;
  sourcePolicy: {
    authoritative: "kite";
    note: string;
  };
  requested: number;
  returned: number;
  missing: Array<{ symbol: string; reason: string }>;
  summary: {
    bySource: Record<string, number>;
    fresh: number;
    stale: number;
    tradeable: number;
  };
  rows: BasketRow[];
  /** Aggregate provenance envelope for the whole basket. */
  meta: DataMeta;
}

/**
 * Accept both the canonical WatchlistKeys and the friendlier basket aliases
 * the task calls out (NIFTY100 / MIDCAP100 / SMALLCAP100). Returns null for an
 * unknown key so the route can 400 honestly.
 */
export function resolveBasketKey(raw: string): WatchlistKey | null {
  const k = raw.trim().toUpperCase();
  const aliases: Record<string, WatchlistKey> = {
    NIFTY100: "NIFTY100",
    MIDCAP100: "NIFTYMIDCAP100",
    NIFTYMIDCAP100: "NIFTYMIDCAP100",
    SMALLCAP100: "NIFTYSMALLCAP100",
    NIFTYSMALLCAP100: "NIFTYSMALLCAP100",
    NIFTY50: "NIFTY50",
    NIFTY500: "NIFTY500",
    SENSEX: "SENSEX",
    BANKNIFTY: "BANKNIFTY",
  };
  return aliases[k] ?? null;
}

function trendFromSignal(s: Signal): BasketTrend {
  switch (s) {
    case "STRONG_BUY": return "Very Bullish";
    case "BUY": return "Bullish";
    case "SELL": return "Bearish";
    case "STRONG_SELL": return "Very Bearish";
    case "NEUTRAL":
    default: return "Neutral";
  }
}

function displayName(symbol: string): string {
  return getEntry(symbol)?.name ?? watchlistName(symbol);
}

function rowFromTrusted(
  q: TrustedQuote,
  trend: BasketTrend | null,
  rsi: number | null,
): BasketRow {
  const m = q.meta;
  return {
    symbol: q.symbol,
    name: q.name ?? displayName(q.symbol),
    lastPrice: q.lastPrice,
    previousClose: q.previousClose ?? null,
    change: q.change ?? null,
    changePercent: q.changePercent ?? null,
    open: q.open ?? null,
    high: q.high ?? null,
    low: q.low ?? null,
    volume: q.volume ?? null,
    trend,
    rsi,
    source: m.source,
    trustTier: m.trustTier,
    asOf: m.asOf,
    fetchedAt: m.fetchedAt,
    freshnessSec: m.freshnessSec,
    isStale: m.isStale,
    validationStatus: m.validationStatus,
    warnings: m.warnings,
  };
}

export async function buildBasket(
  key: WatchlistKey,
  alias: string,
): Promise<BasketResponse> {
  const symbols = getWatchlistSymbols(key);
  const meta = WATCHLIST_META[key];

  // Authoritative quotes via the trusted router (Kite-only; never Yahoo).
  const batch = await marketRouter.getEquityQuotes(symbols);

  // Trend enrichment from the live scanner signal (same signal the scanner page
  // shows). Best-effort: a scanner miss just means trend=null, never a guess.
  const signalBySymbol = new Map<string, Signal>();
  const rsiBySymbol = new Map<string, number>();
  try {
    const scannerRows = (await scanAll()) as StockRow[];
    for (const r of scannerRows) {
      signalBySymbol.set(r.symbol, r.recommendation.signal);
      const rsi14 = r.indicators?.rsi14;
      if (rsi14 != null) rsiBySymbol.set(r.symbol, rsi14);
    }
  } catch (err) {
    logger.warn({ key, err: (err as Error).message }, "basket trend enrichment skipped (scanner unavailable)");
  }

  const rows: BasketRow[] = [];
  const bySource: Record<string, number> = {};
  let fresh = 0;
  let stale = 0;

  // Preserve canonical basket order.
  for (const sym of symbols) {
    const q = batch.quotes.get(sym);
    if (!q) continue;
    const sig = signalBySymbol.get(sym);
    rows.push(rowFromTrusted(q, sig != null ? trendFromSignal(sig) : null, rsiBySymbol.get(sym) ?? null));
    bySource[q.meta.source] = (bySource[q.meta.source] ?? 0) + 1;
    if (q.meta.isStale) stale++;
    else fresh++;
  }

  return {
    key,
    alias: alias.trim().toUpperCase(),
    label: meta.label,
    description: meta.description,
    generatedAt: new Date().toISOString(),
    sourcePolicy: {
      authoritative: "kite",
      note: "All prices are Kite-authoritative. Yahoo is never used for basket prices; missing symbols are reported with a reason rather than back-filled from a delayed source.",
    },
    requested: symbols.length,
    returned: rows.length,
    missing: batch.missing,
    summary: {
      bySource,
      fresh,
      stale,
      // Every returned row is already guard-branded TrustedQuote, so all are tradeable.
      tradeable: rows.length,
    },
    rows,
    meta: batch.meta,
  };
}
