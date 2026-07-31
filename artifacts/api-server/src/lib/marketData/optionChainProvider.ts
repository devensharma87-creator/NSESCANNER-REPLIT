/**
 * Central-layer option-chain provider — SINGLE source of truth for all F&O
 * option chain data in the application.
 *
 * ALL consumers (OI Lab, Option Chain page, F&O signals, strategies, paper
 * trading, GEX, PCR, Max Pain) MUST use this provider instead of directly
 * calling `fetchKiteOptionChain()` or `fetchOptionChain()`.
 *
 * Two modes:
 *   1. TRADE_GRADE — Kite only. If Kite is unavailable, returns unavailable
 *      with an explicit reason. No NSE/Yahoo fallback. Suitable for F&O
 *      signals, paper-trade validation, risk sizing.
 *
 *   2. DISPLAY — Kite primary, NSE fallback allowed. NSE fallback is labelled
 *      `notForSignals = true` and `notForTradeDecisions = true`. Suitable for
 *      OI Lab display, Option Chain table, analytics.
 *
 * Shared TTL cache prevents duplicate Kite API calls when OI Lab and Option
 * Chain page request the same underlying within the cache window.
 *
 * No Yahoo in any path. No silent fallback. Stale data marked stale.
 */

import { fetchKiteOptionChain } from "../kiteOptionChain";
import type { OcResponse } from "../optionChain";
import { fetchOptionChain as fetchWithNseFallback } from "../optionChain";
import { buildMeta, unavailableMeta } from "./validator";
import type { DataMeta, MarketDataResult, TrustTier } from "./types";

// ─── Public types ────────────────────────────────────────────────────────────

export type OptionChainMode = "TRADE_GRADE" | "DISPLAY";

export interface OptionChainMeta extends DataMeta {
  /** Whether NSE fallback was used (true only in DISPLAY mode). */
  fallbackUsed: boolean;
  /** True when the chain contains synthetic/modelled values. */
  synthetic: boolean;
  /** True when the chain is for visual display only (non-actionable). */
  visualOnly: boolean;
  /** True when the chain contains modelled values (GEX, synthetic future). */
  modelled: boolean;
  /** Reason why data is missing/unavailable, or null. */
  missingReason: string | null;
}

export interface TrustedOptionChain {
  chain: OcResponse;
  meta: OptionChainMeta;
  /** Cache diagnostic: true when this response was served from cache. */
  cached: boolean;
}

export interface OptionChainEvaluation {
  ok: boolean;
  reason: string | null;
  warnings: string[];
  /** ms epoch of the chain's generation instant (or null when unknown). */
  asOfMs: number | null;
  complete: boolean;
  expired: boolean;
}

// ─── Shared TTL cache ────────────────────────────────────────────────────────

interface CachedEntry {
  chain: OcResponse;
  meta: OptionChainMeta;
  fetchedAt: number;
}

/**
 * Shared cache keyed by `${underlying}|${expiry}|${mode}`.
 * Short TTL ensures freshness while preventing duplicate Kite API calls.
 */
const chainCache = new Map<string, CachedEntry>();

/** Cache TTL — 20 seconds. Short enough for live trading, long enough to
 *  prevent OI Lab + Option Chain double-fetching the same chain. */
const CACHE_TTL_MS = 20_000;

function cacheKey(underlying: string, expiry: string | undefined, mode: OptionChainMode): string {
  return `${underlying.toUpperCase()}|${expiry ?? "_NEAREST"}|${mode}`;
}

function getCached(key: string, now: number): CachedEntry | null {
  const entry = chainCache.get(key);
  if (!entry) return null;
  if (now - entry.fetchedAt > CACHE_TTL_MS) {
    chainCache.delete(key);
    return null;
  }
  return entry;
}

/** Clear the option chain cache. Called on Kite session change / server restart. */
export function clearOptionChainCache(): void {
  chainCache.clear();
}

/** Return cache stats for diagnostics. */
export function getOptionChainCacheStats(): { size: number; ttlMs: number } {
  return { size: chainCache.size, ttlMs: CACHE_TTL_MS };
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

function isoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Pure evaluation of a raw option chain — no network, fully unit-testable.
 * Decides whether the chain is fit to serve and what to warn about.
 */
export function evaluateOptionChain(
  oc: OcResponse | null,
  nowIso: string = new Date().toISOString(),
): OptionChainEvaluation {
  if (!oc) {
    return {
      ok: false,
      reason: "Kite session inactive — option chain unavailable.",
      warnings: [],
      asOfMs: null,
      complete: false,
      expired: false,
    };
  }
  const asOfMs = isoToMs(oc.generatedAt);
  // Expired-contract rejection — the active expiry must be today or later.
  const nowDay = nowIso.slice(0, 10);
  if (oc.expiry && oc.expiry < nowDay) {
    return {
      ok: false,
      reason: `Active expiry ${oc.expiry} is in the past.`,
      warnings: [],
      asOfMs,
      complete: false,
      expired: true,
    };
  }
  if (!Array.isArray(oc.rows) || oc.rows.length === 0) {
    return { ok: false, reason: "Option chain has no strikes.", warnings: [], asOfMs, complete: false, expired: false };
  }
  if (!(oc.spot > 0)) {
    return { ok: false, reason: "Option chain spot is non-positive.", warnings: [], asOfMs, complete: false, expired: false };
  }
  const warnings: string[] = [];
  const legs = oc.rows.reduce((n, r) => n + (r.ce ? 1 : 0) + (r.pe ? 1 : 0), 0);
  const oiLegs = oc.rows.reduce(
    (n, r) => n + ((r.ce?.oi ?? 0) > 0 ? 1 : 0) + ((r.pe?.oi ?? 0) > 0 ? 1 : 0),
    0,
  );
  if (legs > 0 && oiLegs === 0) {
    warnings.push("Option chain carries no open-interest data.");
  } else if (legs > 0 && oiLegs < legs / 2) {
    warnings.push("Open interest missing on more than half of the legs.");
  }
  return { ok: true, reason: null, warnings, asOfMs, complete: true, expired: false };
}

// ─── Meta builders ───────────────────────────────────────────────────────────

function buildOptionChainMeta(opts: {
  source: "kite" | "nse" | "none";
  trustTier: TrustTier;
  asOfMs: number | null;
  warnings: string[];
  isNseFallback: boolean;
  mode: OptionChainMode;
  hasSyntheticFuture: boolean;
}): OptionChainMeta {
  const baseMeta = buildMeta({
    source: opts.source, // NSE is now a valid ProviderName — no more hiding behind "none"
    trustTier: opts.trustTier,
    asOfMs: opts.asOfMs,
    delayed: opts.trustTier === "secondary_analytics",
    notForSignals: opts.isNseFallback || opts.trustTier !== "authoritative",
    notForTradeDecisions: opts.isNseFallback || opts.trustTier !== "authoritative",
    warnings: opts.warnings,
    complete: true,
  });

  return {
    ...baseMeta,
    // NSE fallback: source is honestly labelled "nse" (ProviderName now includes it)
    source: opts.source,
    fallbackUsed: opts.isNseFallback,
    synthetic: opts.hasSyntheticFuture,
    visualOnly: opts.isNseFallback,
    modelled: opts.hasSyntheticFuture,
    missingReason: null,
  };
}

function buildUnavailableMeta(reason: string, mode: OptionChainMode): OptionChainMeta {
  const baseMeta = unavailableMeta("kite", "authoritative", reason);
  return {
    ...baseMeta,
    fallbackUsed: false,
    synthetic: false,
    visualOnly: false,
    modelled: false,
    missingReason: reason,
  };
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Authoritative option chain for an F&O underlying.
 *
 * @param underlying  NSE/BSE symbol (e.g. "NIFTY", "BANKNIFTY", "RELIANCE")
 * @param mode        TRADE_GRADE (Kite-only) or DISPLAY (Kite + NSE fallback)
 * @param expiry      Optional ISO expiry filter (e.g. "2026-06-26")
 *
 * Returns an explicit unavailable result (never a silent fallback) when:
 *   - TRADE_GRADE: Kite is offline → unavailable with reason
 *   - DISPLAY: Kite offline AND NSE offline → unavailable with reason
 *   - DISPLAY: NSE fallback used → response is labelled notForSignals
 */
export async function getOptionChain(
  underlying: string,
  mode: OptionChainMode = "DISPLAY",
  expiry?: string,
): Promise<MarketDataResult<TrustedOptionChain>> {
  const sym = underlying.toUpperCase();
  const now = Date.now();
  const key = cacheKey(sym, expiry, mode);

  // ── Check shared cache ──────────────────────────────────────────────────
  const cached = getCached(key, now);
  if (cached) {
    return {
      ok: true,
      data: { chain: cached.chain, meta: cached.meta, cached: true },
      meta: cached.meta,
    };
  }

  // ── TRADE_GRADE: Kite only ──────────────────────────────────────────────
  if (mode === "TRADE_GRADE") {
    return fetchKiteOnly(sym, expiry, now, key);
  }

  // ── DISPLAY: Kite primary, NSE fallback ─────────────────────────────────
  return fetchWithFallback(sym, expiry, now, key);
}

async function fetchKiteOnly(
  sym: string,
  expiry: string | undefined,
  now: number,
  key: string,
): Promise<MarketDataResult<TrustedOptionChain>> {
  let oc: OcResponse | null = null;
  try {
    oc = await fetchKiteOptionChain(sym, expiry);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Option chain fetch failed.";
    const meta = buildUnavailableMeta(`Kite option chain unavailable: ${reason}`, "TRADE_GRADE");
    return { ok: false, data: null, meta, reason: meta.missingReason ?? reason };
  }

  const evaluation = evaluateOptionChain(oc);
  if (!evaluation.ok || !oc) {
    const reason = evaluation.reason ?? "Option chain unavailable.";
    const meta = buildUnavailableMeta(reason, "TRADE_GRADE");
    return { ok: false, data: null, meta, reason };
  }

  const hasSynth = oc.syntheticFuture != null && Number.isFinite(oc.syntheticFuture);
  const meta = buildOptionChainMeta({
    source: "kite",
    trustTier: "authoritative",
    asOfMs: evaluation.asOfMs,
    warnings: evaluation.warnings,
    isNseFallback: false,
    mode: "TRADE_GRADE",
    hasSyntheticFuture: hasSynth,
  });

  // B1.1-C1: Future-timestamp gate — reject chains whose generatedAt is
  // materially in the future (beyond CLOCK_SKEW_TOLERANCE_SEC). Such timestamps
  // are unverified and must NOT power trade decisions, paper admission, or
  // exit monitoring regardless of source tier.
  if (meta.isFutureTimestamp === true) {
    const reason =
      "FUTURE_TIMESTAMP: option chain generatedAt is materially in the future — " +
      "unverified, not tradeable. This datum cannot power any TRADE_GRADE path.";
    return { ok: false, data: null, meta: buildUnavailableMeta(reason, "TRADE_GRADE"), reason };
  }

  // Store in shared cache
  chainCache.set(key, { chain: oc, meta, fetchedAt: now });

  return {
    ok: true,
    data: { chain: oc, meta, cached: false },
    meta,
  };
}

async function fetchWithFallback(
  sym: string,
  expiry: string | undefined,
  now: number,
  key: string,
): Promise<MarketDataResult<TrustedOptionChain>> {
  // Try Kite first
  let oc: OcResponse | null = null;
  let isNseFallback = false;

  try {
    oc = await fetchKiteOptionChain(sym, expiry);
  } catch {
    // Kite failed — will try NSE below
  }

  if (oc) {
    const evaluation = evaluateOptionChain(oc);
    if (evaluation.ok) {
      // Kite succeeded — authoritative
      const hasSynth = oc.syntheticFuture != null && Number.isFinite(oc.syntheticFuture);
      const meta = buildOptionChainMeta({
        source: "kite",
        trustTier: "authoritative",
        asOfMs: evaluation.asOfMs,
        warnings: evaluation.warnings,
        isNseFallback: false,
        mode: "DISPLAY",
        hasSyntheticFuture: hasSynth,
      });
      chainCache.set(key, { chain: oc, meta, fetchedAt: now });
      return { ok: true, data: { chain: oc, meta, cached: false }, meta };
    }
  }

  // Kite unavailable or failed evaluation — try NSE fallback (DISPLAY mode only)
  try {
    oc = await fetchWithNseFallback(sym, expiry);
  } catch {
    // NSE also failed
  }

  if (!oc) {
    const meta = buildUnavailableMeta(
      "Option chain unavailable — both Kite and NSE sources failed.",
      "DISPLAY",
    );
    return { ok: false, data: null, meta, reason: meta.missingReason! };
  }

  // NSE fallback — labelled display-only
  isNseFallback = (oc.source ?? "").toUpperCase() === "NSE" || oc.spotSource === "nse";
  const evaluation = evaluateOptionChain(oc);
  if (!evaluation.ok) {
    const reason = evaluation.reason ?? "NSE option chain failed evaluation.";
    const meta = buildUnavailableMeta(reason, "DISPLAY");
    return { ok: false, data: null, meta, reason };
  }

  const hasSynth = oc.syntheticFuture != null && Number.isFinite(oc.syntheticFuture);
  const warnings = [...evaluation.warnings];
  if (isNseFallback) {
    warnings.push("NSE fallback — display only, not for signals or trade decisions.");
  }

  const meta = buildOptionChainMeta({
    source: isNseFallback ? "nse" : "kite",
    trustTier: isNseFallback ? "secondary_validation" : "authoritative",
    asOfMs: evaluation.asOfMs,
    warnings,
    isNseFallback,
    mode: "DISPLAY",
    hasSyntheticFuture: hasSynth,
  });

  chainCache.set(key, { chain: oc, meta, fetchedAt: now });
  return { ok: true, data: { chain: oc, meta, cached: false }, meta };
}
