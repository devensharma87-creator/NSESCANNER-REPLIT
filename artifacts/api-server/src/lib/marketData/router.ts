/**
 * The trusted market-data router — the single entry point every consumer should
 * use to get Indian equity/index quotes and candles.
 *
 * Contract:
 *   - Kite is the only authoritative source. When Kite is offline the router
 *     returns an explicit "unavailable" result (with a reason) — it NEVER
 *     silently falls back to Yahoo for trusted data.
 *   - Every returned quote is run through `assertTradeable`, so what callers
 *     receive is branded `TrustedQuote` and provably authoritative + fresh
 *     enough + complete.
 *   - Analytics (Yahoo) lives behind `analyticsYahoo.ts` and is intentionally
 *     NOT reachable from these methods.
 */

import * as kite from "./kiteProvider";
import { isIndstocksEnabled } from "./indstocksProvider";
import { assertTradeable, isTradeableMeta } from "./guard";
import { unavailableMeta } from "./validator";
import type {
  BatchQuoteResult,
  CandleSeries,
  DataMeta,
  MarketDataResult,
  MarketQuote,
  MissingSymbol,
  TrustedCandleSeries,
  TrustedQuote,
} from "./types";

type KiteInterval =
  | "minute" | "3minute" | "5minute" | "10minute"
  | "15minute" | "30minute" | "60minute" | "day";

const KITE_OFFLINE_REASON =
  "Kite session inactive — official market data unavailable.";

function brandOrMissing(
  q: MarketQuote,
  missing: MissingSymbol[],
): TrustedQuote | null {
  if (!isTradeableMeta(q.meta)) {
    missing.push({
      symbol: q.symbol,
      reason: q.meta.warnings[0] ?? `Not tradeable (${q.meta.validationStatus}).`,
    });
    return null;
  }
  return assertTradeable(q);
}

/** Aggregate envelope for a batch — newest asOf wins, stale if any row stale. */
function aggregateMeta(quotes: Map<string, TrustedQuote>, nowMs = Date.now()): DataMeta {
  if (quotes.size === 0) {
    return unavailableMeta("kite", "authoritative", "No quotes returned.", nowMs);
  }
  let newestAsOf: number | null = null;
  let anyStale = false;
  const warnings: string[] = [];
  for (const q of quotes.values()) {
    if (q.meta.asOf) {
      const ms = Date.parse(q.meta.asOf);
      if (Number.isFinite(ms)) newestAsOf = newestAsOf == null ? ms : Math.max(newestAsOf, ms);
    }
    if (q.meta.isStale) anyStale = true;
  }
  if (anyStale) warnings.push("One or more rows are stale.");
  return {
    source: "kite",
    trustTier: "authoritative",
    asOf: newestAsOf != null ? new Date(newestAsOf).toISOString() : null,
    fetchedAt: new Date(nowMs).toISOString(),
    freshnessSec: newestAsOf != null ? Math.max(0, Math.round((nowMs - newestAsOf) / 1000)) : null,
    isStale: anyStale,
    delayed: false,
    notForSignals: false,
    validationStatus: "validated",
    warnings,
  };
}

/** Batch authoritative equity quotes with honest partial/missing reporting. */
export async function getEquityQuotes(symbols: string[]): Promise<BatchQuoteResult> {
  const requested = [...new Set(symbols.map(s => s.toUpperCase()))];
  const quotes = new Map<string, TrustedQuote>();
  const missing: MissingSymbol[] = [];

  if (requested.length === 0) {
    return { requested, quotes, missing, meta: aggregateMeta(quotes) };
  }

  const raw = await kite.getEquityQuotes(requested).catch(() => null);
  if (!raw) {
    for (const s of requested) missing.push({ symbol: s, reason: KITE_OFFLINE_REASON });
    return {
      requested,
      quotes,
      missing,
      meta: unavailableMeta("kite", "authoritative", KITE_OFFLINE_REASON),
    };
  }

  for (const s of requested) {
    const q = raw.get(s);
    if (!q) {
      missing.push({ symbol: s, reason: "No Kite quote for symbol." });
      continue;
    }
    const t = brandOrMissing(q, missing);
    if (t) quotes.set(s, t);
  }

  return { requested, quotes, missing, meta: aggregateMeta(quotes) };
}

/** Single authoritative equity quote: live WS tick first, REST batch fallback. */
export async function getEquityQuote(symbol: string): Promise<MarketDataResult<TrustedQuote>> {
  const sym = symbol.toUpperCase();
  const live = kite.getEquityLiveQuote(sym);
  if (live && isTradeableMeta(live.meta)) {
    return { ok: true, data: assertTradeable(live), meta: live.meta };
  }
  const batch = await getEquityQuotes([sym]);
  const q = batch.quotes.get(sym);
  if (q) return { ok: true, data: q, meta: q.meta };
  const reason = batch.missing.find(m => m.symbol === sym)?.reason ?? KITE_OFFLINE_REASON;
  return {
    ok: false,
    data: null,
    meta: unavailableMeta("kite", "authoritative", reason),
    reason,
  };
}

/** Authoritative last-traded-price for a symbol. */
export async function getLtp(symbol: string): Promise<MarketDataResult<number>> {
  const r = await getEquityQuote(symbol);
  if (!r.ok || !r.data) return { ok: false, data: null, meta: r.meta, reason: r.reason };
  return { ok: true, data: r.data.lastPrice, meta: r.meta };
}

/** Authoritative index quotes (keyed by the Yahoo-style index key). */
export async function getIndexQuotes(): Promise<BatchQuoteResult> {
  const raw = await kite.getIndexQuotes().catch(() => null);
  const quotes = new Map<string, TrustedQuote>();
  const missing: MissingSymbol[] = [];
  if (!raw) {
    return {
      requested: [],
      quotes,
      missing,
      meta: unavailableMeta("kite", "authoritative", KITE_OFFLINE_REASON),
    };
  }
  for (const [key, q] of raw) {
    const t = brandOrMissing(q, missing);
    if (t) quotes.set(key, t);
  }
  return { requested: [...raw.keys()], quotes, missing, meta: aggregateMeta(quotes) };
}

/** Authoritative candles for an NSE EQ symbol (charting/historical). */
export async function getEquityCandles(
  symbol: string,
  interval: KiteInterval,
  daysBack: number,
): Promise<MarketDataResult<TrustedCandleSeries>> {
  let series: CandleSeries | null = null;
  try {
    series = await kite.getEquityCandles(symbol.toUpperCase(), interval, daysBack);
  } catch {
    series = null;
  }
  if (!series) {
    const reason = KITE_OFFLINE_REASON;
    return {
      ok: false,
      data: null,
      meta: unavailableMeta("kite", "authoritative", reason),
      reason,
    };
  }
  if (!isTradeableMeta(series.meta)) {
    return {
      ok: false,
      data: null,
      meta: series.meta,
      reason: series.meta.warnings[0] ?? "Candles not tradeable.",
    };
  }
  return { ok: true, data: series as TrustedCandleSeries, meta: series.meta };
}

export { isIndstocksEnabled };
