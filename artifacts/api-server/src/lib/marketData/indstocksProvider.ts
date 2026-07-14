/**
 * INDstocks provider facade — SECONDARY validation/failover source.
 *
 * INDstocks is trust tier "secondary_validation": it may cross-check the
 * authoritative Kite feed and stand in as an explicit, clearly-warned failover —
 * it can NEVER silently power a trading/signal/valuation decision (the guard
 * rejects its tier, and the router only ever returns it UNBRANDED with a visible
 * failover warning). It is DISABLED by default; every function early-returns /
 * throws honestly when `INDSTOCKS_ENABLED` is off.
 *
 * Honesty notes:
 *   - The INDstocks REST full-quote carries NO server timestamp, so quote meta
 *     has `asOf=null` and a warning that freshness is fetch-based. We never
 *     fabricate a data instant.
 *   - Nothing is cached as "fresh forever": health is probed on demand and the
 *     probe result is timestamped.
 */

import { createIndstocksClient, IndstocksError, type IndstocksClient } from "./indstocksClient";
import { getIndstocksToken } from "./indstocksTokenStore";
import { buildMeta, isQuoteComplete } from "./validator";
import { getPolicy } from "./policy";
import type { Candle, CandleSeries, MarketQuote } from "./types";

export interface IndstocksHealth {
  enabled: boolean;
  reachable: boolean;
  reason: string;
  /** ISO timestamp of the last probe, or null when never probed. */
  lastProbeAt?: string | null;
  /** Last probe error message (honest), or null. */
  lastError?: string | null;
}

export function isIndstocksEnabled(): boolean {
  return getPolicy().indstocksEnabled;
}

// ── Module-scoped client + health cache (single-replica, like swing scanner) ──
let sharedClient: IndstocksClient | null = null;
function client(): IndstocksClient {
  // Resolve the token per-request via the DB-backed store (DB-first → env) so a
  // hot-swapped daily token takes effect without rebuilding this shared client.
  if (!sharedClient) sharedClient = createIndstocksClient({ tokenProvider: () => getIndstocksToken() });
  return sharedClient;
}
/** Test seam: inject a client built over a fake fetch. */
export function __setIndstocksClientForTests(c: IndstocksClient | null): void {
  sharedClient = c;
}

let healthCache: IndstocksHealth = {
  enabled: false,
  reachable: false,
  reason: "INDstocks not probed yet.",
  lastProbeAt: null,
  lastError: null,
};

/** Synchronous cached health (diagnostics reads this; never does I/O). */
export function indstocksHealth(): IndstocksHealth {
  const enabled = isIndstocksEnabled();
  if (!enabled) {
    return {
      enabled: false,
      reachable: false,
      reason:
        "INDstocks is disabled. Enable via INDSTOCKS_ENABLED once mappings are VERIFIED.",
      lastProbeAt: healthCache.lastProbeAt ?? null,
      lastError: healthCache.lastError ?? null,
    };
  }
  return { ...healthCache, enabled: true };
}

/**
 * Probe reachability + auth (network only when enabled). Updates the cache that
 * `indstocksHealth()` returns. Uses the small index instrument master as a cheap
 * authenticated round-trip. Never throws — failures are recorded honestly.
 */
export async function probeIndstocksHealth(c: IndstocksClient = client()): Promise<IndstocksHealth> {
  const nowIso = new Date().toISOString();
  if (!isIndstocksEnabled()) {
    healthCache = {
      enabled: false,
      reachable: false,
      reason: "INDstocks is disabled (INDSTOCKS_ENABLED off).",
      lastProbeAt: nowIso,
      lastError: null,
    };
    return healthCache;
  }
  try {
    const csv = await c.getCsv("/market/instruments", { source: "index" });
    const reachable = typeof csv === "string" && csv.trim().length > 0;
    healthCache = {
      enabled: true,
      reachable,
      reason: reachable
        ? "INDstocks reachable and authenticated."
        : "INDstocks responded but returned an empty instrument master.",
      lastProbeAt: nowIso,
      lastError: null,
    };
  } catch (err) {
    const msg = err instanceof IndstocksError ? `${err.kind}: ${err.message}` : String(err);
    healthCache = {
      enabled: true,
      reachable: false,
      reason: "INDstocks unreachable or auth failed.",
      lastProbeAt: nowIso,
      lastError: msg,
    };
  }
  return healthCache;
}

// ── Quotes ────────────────────────────────────────────────────────────────

/** Raw INDstocks full-quote shape (documented subset; extra fields ignored). */
export interface RawFullQuote {
  live_price?: number;
  day_open?: number;
  day_high?: number;
  day_low?: number;
  prev_close?: number;
  day_change?: number;
  day_change_percentage?: number;
  volume?: number;
}

const NO_TIMESTAMP_WARNING =
  "INDstocks REST quote carries no server timestamp; freshness is fetch-based.";

function toMarketQuote(symbol: string, raw: RawFullQuote, nowMs: number): MarketQuote {
  const core = {
    symbol,
    lastPrice: Number(raw.live_price),
    open: raw.day_open,
    high: raw.day_high,
    low: raw.day_low,
    previousClose: raw.prev_close,
    change: raw.day_change,
    changePercent: raw.day_change_percentage,
    volume: raw.volume,
  };
  return {
    ...core,
    meta: buildMeta({
      source: "indstocks",
      trustTier: "secondary_validation",
      asOfMs: null, // honest: no server timestamp
      delayed: false,
      notForSignals: true, // secondary tier is never tradeable
      complete: isQuoteComplete(core),
      warnings: [NO_TIMESTAMP_WARNING],
      nowMs,
    }),
  };
}

/**
 * Full quotes for INDstocks scrip-codes, keyed BY the symbol map you pass in so
 * the result is addressable by canonical symbol. Throws when disabled (callers
 * must check `isIndstocksEnabled()` first — this is a hard guard, never silent).
 *
 * @param scrips  map of canonical symbol → INDstocks scrip-code.
 */
export async function getFullQuotes(
  scrips: Map<string, string>,
  c: IndstocksClient = client(),
  nowMs: number = Date.now(),
): Promise<Map<string, MarketQuote>> {
  if (!isIndstocksEnabled()) {
    throw new IndstocksError("INDstocks is disabled; refusing to fetch quotes.", "config");
  }
  const out = new Map<string, MarketQuote>();
  if (scrips.size === 0) return out;
  const codes = [...new Set(scrips.values())];
  const data = await c.getJson<Record<string, RawFullQuote>>("/market/quotes/full", {
    "scrip-codes": codes.join(","),
  });
  for (const [symbol, scrip] of scrips) {
    const raw = data[scrip];
    if (!raw || !(Number(raw.live_price) > 0)) continue;
    out.set(symbol, toMarketQuote(symbol, raw, nowMs));
  }
  return out;
}

// ── Candles ─────────────────────────────────────────────────────────────

/** Per-interval max span (ms) imposed by the INDstocks historical endpoint. */
export function historicalRangeCapMs(interval: string): number {
  const day = 24 * 60 * 60 * 1000;
  const i = interval.toLowerCase();
  if (i.includes("week") || i.includes("month") || i === "1day" || i === "day") return 365 * day;
  // intraday minute buckets
  const minMatch = /(\d+)\s*min/.exec(i);
  const mins = minMatch ? Number(minMatch[1]) : i === "minute" ? 1 : 0;
  if (mins >= 60) return 14 * day; // 60–240 min
  if (mins >= 1) return mins <= 30 ? 7 * day : 14 * day; // ≤30 min ⇒ 7d
  return 1 * day; // sub-minute / unknown ⇒ 1 day, fail-safe small
}

interface RawCandleResponse {
  candles?: Array<[number, number, number, number, number, number]>;
}

/**
 * Historical candles for an INDstocks scrip-code over [startMs, endMs],
 * transparently splitting the request to respect the per-interval range cap and
 * concatenating the results in chronological order. Throws when disabled.
 */
export async function getCandles(
  symbol: string,
  scripCode: string,
  interval: string,
  startMs: number,
  endMs: number,
  c: IndstocksClient = client(),
): Promise<CandleSeries> {
  if (!isIndstocksEnabled()) {
    throw new IndstocksError("INDstocks is disabled; refusing to fetch candles.", "config");
  }
  const cap = historicalRangeCapMs(interval);
  const candles: Candle[] = [];
  let from = startMs;
  let guard = 0;
  while (from < endMs && guard < 64) {
    guard++;
    const to = Math.min(from + cap, endMs);
    const data = await c.getJson<RawCandleResponse>(`/market/historical/${interval}`, {
      "scrip-codes": scripCode,
      start_time: from,
      end_time: to,
    });
    for (const row of data.candles ?? []) {
      const [ts, o, h, l, cl, v] = row;
      if (!Number.isFinite(ts)) continue;
      candles.push({
        t: new Date(ts).toISOString(),
        open: o,
        high: h,
        low: l,
        close: cl,
        volume: v ?? 0,
      });
    }
    from = to;
  }
  const lastTs = candles.length ? Date.parse(candles[candles.length - 1]!.t) : null;
  return {
    symbol,
    interval,
    candles,
    meta: buildMeta({
      source: "indstocks",
      trustTier: "secondary_validation",
      asOfMs: lastTs,
      delayed: false,
      notForSignals: true,
      complete: candles.length > 0,
      warnings: ["INDstocks secondary candles — cross-validation only, never tradeable."],
    }),
  };
}
