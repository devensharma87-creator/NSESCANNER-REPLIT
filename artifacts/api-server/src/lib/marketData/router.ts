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
import { isIndstocksEnabled, getFullQuotes } from "./indstocksProvider";
import { assertTradeable, isTradeableMeta } from "./guard";
import { unavailableMeta, isQuoteComplete } from "./validator";
import { getVerifiedIndstocksScrip } from "./instrumentMapStore";
import { validateQuotePair, type ValidationResult } from "./sourceValidation";
import { recordValidation, recordFailover } from "./validationStats";
import type { InstrumentAssetClass } from "@workspace/db";
import type {
  BatchQuoteResult,
  CandleSeries,
  DataMeta,
  MarketDataResult,
  MarketQuote,
  MissingSymbol,
  ProviderName,
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

// ───────────────────────────────────────────────────────────────────────────
// INDstocks cross-validation + explicit failover (secondary tier).
//
// These NEVER return a branded TrustedQuote — INDstocks is secondary_validation,
// so the guard would (correctly) reject it. They return UNBRANDED quotes plus a
// loud, visible warning. No consumer wired here may feed a signal/trade off an
// INDstocks failover; surfacing it honestly is the whole point. Full signal-path
// blocking on DATA_CONFLICT is deferred to task #124.
// ───────────────────────────────────────────────────────────────────────────

export interface CrossValidation {
  symbol: string;
  /** Whether a VERIFIED INDstocks mapping was usable. */
  mappingOk: boolean;
  /** Mapping/availability reason when validation could not run. */
  reason: string | null;
  /** The secondary INDstocks quote, when fetched. */
  indstocks: MarketQuote | null;
  /** The comparison verdict, when both quotes were available. */
  result: ValidationResult | null;
}

export interface ResolvedQuote {
  ok: boolean;
  /** Unbranded quote — Kite-authoritative on the happy path, INDstocks on failover. */
  data: MarketQuote | null;
  meta: DataMeta;
  source: ProviderName;
  /** True when this came from INDstocks because Kite was unavailable. */
  failover: boolean;
  /** Cross-provider validation result (only on the Kite happy path). */
  validation: ValidationResult | null;
  reason?: string;
}

/**
 * Cross-validate an already-fetched authoritative Kite quote against INDstocks.
 * No-ops honestly (mappingOk=false + reason) when INDstocks is disabled, the
 * mapping is not VERIFIED, or the secondary quote is unavailable — it NEVER
 * throws into the caller and NEVER mutates the Kite quote.
 */
export async function validateAgainstIndstocks(
  symbol: string,
  kiteQuote: MarketQuote,
  assetClass: InstrumentAssetClass = "EQUITY",
): Promise<CrossValidation> {
  const sym = symbol.toUpperCase();
  if (!isIndstocksEnabled()) {
    return { symbol: sym, mappingOk: false, reason: "INDstocks disabled.", indstocks: null, result: null };
  }
  const resolved = await getVerifiedIndstocksScrip(sym, assetClass).catch((e) => ({
    ok: false,
    scripCode: null,
    securityId: null,
    status: "MISSING" as const,
    reason: e instanceof Error ? e.message : String(e),
  }));
  if (!resolved.ok || !resolved.scripCode) {
    return { symbol: sym, mappingOk: false, reason: resolved.reason, indstocks: null, result: null };
  }
  const quotes = await getFullQuotes(new Map([[sym, resolved.scripCode]])).catch((e) => {
    void e;
    return null;
  });
  const ind = quotes?.get(sym) ?? null;
  if (!ind) {
    return { symbol: sym, mappingOk: true, reason: "No INDstocks quote returned.", indstocks: null, result: null };
  }
  // Only cross-validate (and record a verdict) against a COMPLETE secondary
  // quote — otherwise the validation stats would overstate how often INDstocks
  // actually agreed/diverged. Incomplete quotes are surfaced honestly, not scored.
  if (!isQuoteComplete(ind) || ind.meta.validationStatus === "incomplete") {
    return { symbol: sym, mappingOk: true, reason: "INDstocks quote incomplete; cross-validation skipped.", indstocks: ind, result: null };
  }
  const result = validateQuotePair(kiteQuote, ind);
  recordValidation(result.verdict);
  return { symbol: sym, mappingOk: true, reason: null, indstocks: ind, result };
}

/** INDstocks failover — only when mapping VERIFIED, quote complete + just-fetched. */
async function tryIndstocksFailover(
  symbol: string,
  assetClass: InstrumentAssetClass,
): Promise<ResolvedQuote | null> {
  const sym = symbol.toUpperCase();
  const resolved = await getVerifiedIndstocksScrip(sym, assetClass).catch(() => null);
  if (!resolved || !resolved.ok || !resolved.scripCode) return null;
  const quotes = await getFullQuotes(new Map([[sym, resolved.scripCode]])).catch(() => null);
  const ind = quotes?.get(sym) ?? null;
  // Completeness gate: require a fully-formed quote (positive last price AND a
  // previous close), not merely ltp>0 — an incomplete secondary quote must never
  // stand in for the authoritative feed. The quote is freshly fetched here, so
  // "freshness" is satisfied by the fetch + the loud fetch-based-freshness
  // warning the provider already attaches (INDstocks REST has no server stamp).
  if (!ind || !isQuoteComplete(ind) || ind.meta.validationStatus === "incomplete") return null;

  const warnings = [
    "FAILOVER: Kite unavailable — served by INDstocks (secondary validation tier). " +
      "NOT authoritative; must not power trade/signal execution.",
    ...ind.meta.warnings,
  ];
  const meta: DataMeta = { ...ind.meta, warnings };
  recordFailover();
  return {
    ok: true,
    data: { ...ind, meta },
    meta,
    source: "indstocks",
    failover: true,
    validation: null,
  };
}

/**
 * Resolved equity quote — the failover-aware entry point.
 *   1. Always tries authoritative Kite first.
 *   2. On success, opportunistically cross-validates against INDstocks (the
 *      validation is attached but the returned quote stays Kite-authoritative).
 *   3. ONLY if Kite is unavailable AND INDstocks is enabled with a VERIFIED,
 *      complete, just-fetched quote does it fail over — clearly flagged
 *      (source=indstocks, failover=true, loud warning), never branded tradeable.
 */
export async function getEquityQuoteResolved(
  symbol: string,
  assetClass: InstrumentAssetClass = "EQUITY",
): Promise<ResolvedQuote> {
  const sym = symbol.toUpperCase();
  const primary = await getEquityQuote(sym);
  if (primary.ok && primary.data) {
    let validation: ValidationResult | null = null;
    if (isIndstocksEnabled()) {
      const cv = await validateAgainstIndstocks(sym, primary.data, assetClass).catch(() => null);
      validation = cv?.result ?? null;
    }
    return {
      ok: true,
      data: primary.data,
      meta: primary.meta,
      source: "kite",
      failover: false,
      validation,
    };
  }

  if (isIndstocksEnabled()) {
    const fo = await tryIndstocksFailover(sym, assetClass).catch(() => null);
    if (fo) return fo;
  }

  return {
    ok: false,
    data: null,
    meta: primary.meta,
    source: "kite",
    failover: false,
    validation: null,
    reason: primary.reason,
  };
}

export { isIndstocksEnabled };
