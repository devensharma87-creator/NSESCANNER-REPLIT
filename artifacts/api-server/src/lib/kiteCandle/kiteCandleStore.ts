/**
 * Canonical Kite Candle Store — centralized persistent cache for Kite daily candle series.
 *
 * Architecture:
 *   L2 — PostgreSQL `kite_candle_store` table (persistent, cross-replica).
 *   L1 — In-memory Map per replica (loaded from L2 at startup, zero Kite calls on UI path).
 *
 * UI requests MUST call getKiteCandleSeries() only — never trigger Kite HTTP calls.
 * Background refresh (runKiteCandleRefresh) is the only function that contacts Kite.
 *
 * Thundering-herd protection:
 *   - Advisory lock (pg_try_advisory_lock) prevents concurrent refreshes across replicas.
 *   - Startup DB warm-load populates L1 before the first refresh fires.
 *   - initKiteCandleStore() is the single entry point; call once at server boot.
 *
 * Stale-while-revalidate:
 *   - Entries with status='stale' (age > STALE_THRESHOLD) are served while a refresh runs.
 *   - 'ok' entries from today's session are never replaced by Yahoo.
 *
 * Circuit breaker:
 *   - If ≥50 % of symbols fail in a refresh, the circuit opens and interval doubles.
 *   - After CIRCUIT_HALF_OPEN_AFTER_MS, the circuit enters half-open and retries one batch.
 *   - Three consecutive full-fail refreshes → CIRCUIT_OPEN for 1 h.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";
import { centralEquityCandles } from "../marketData/compat";
import type { YahooChart } from "../marketData/analyticsYahoo";
import { UNIVERSE, INACTIVE_SYMBOLS, KITE_NSE_SYMBOL_OVERRIDE, validateKiteSymbolOverrides } from "../universe";
import { centralKiteNseEqInstruments } from "../marketData/compat";
import { kiteHistoricalBucket, type TokenBucketMetrics } from "./tokenBucket";

// ─── Types ───────────────────────────────────────────────────────────────────

export type KiteCandleStatus =
  | "pending"       // never fetched; store not yet populated
  | "ok"            // fresh Kite data, fetched this session
  | "stale"         // last-good data from a prior session (served while refreshing)
  | "unavailable"   // Kite offline / symbol not in universe
  | "insufficient"; // Kite returned < MIN_BARS bars (too short for any indicators)

export interface KiteCandleEntry {
  symbol: string;
  exchange: string;
  timeframe: string;
  sessionDate: string | null;   // YYYY-MM-DD IST date of last completed bar
  barCount: number;             // number of bars in chart (0 when chart is null)
  chart: YahooChart | null;     // null when unavailable / pending / barCount < MIN_DISPLAY_BARS
  fetchedAt: Date | null;
  status: KiteCandleStatus;
  errorCode: string | null;     // machine-readable: KITE_OFFLINE | FETCH_FAILED | INSUFFICIENT_HISTORY | KITE_CANDLE_STORE_PENDING
}

/**
 * Refresh mode controls which symbols are fetched in a refresh cycle.
 *
 *   FULL             — all active universe symbols (initial/backfill + manual owner refresh).
 *   INCREMENTAL      — only symbols with status≠'ok' OR session_date < today's IST date.
 *                      Used post-market-close to capture the completed daily bar without
 *                      downloading history that hasn't changed.
 *   FAILED_RETRY     — only symbols with status='unavailable'|'insufficient'.
 *                      Used in off-hours cadence to recover from transient Kite failures.
 *   INSTRUMENT_CHANGE— symbols added to the universe since the last refresh (new entries
 *                      with no store record). Used to detect new listings or universe updates.
 */
export type RefreshMode = "FULL" | "INCREMENTAL" | "FAILED_RETRY" | "INSTRUMENT_CHANGE";

export interface RefreshResult {
  skipped?: boolean;
  skipReason?: string;
  refreshMode: RefreshMode;
  kiteRequests: number;
  symbolsConsidered: number;
  successCount: number;
  failCount: number;
  insufficientCount: number;
  instrumentUnresolvedCount: number;
  durationMs: number;
  circuitOpen: boolean;
  errors: Array<{ symbol: string; errorCode: string }>;
  /** Rate-limiter diagnostics for this refresh cycle. */
  rateLimiterMetrics: TokenBucketMetrics;
  /** Alias validation results: universe symbol → resolution status. */
  instrumentValidation: Record<string, "VERIFIED" | "UNVERIFIED" | "INSTRUMENT_IDENTITY_UNRESOLVED">;
}

export interface KiteCandleStoreMetrics {
  // Universe coverage
  totalSymbols: number;
  okCount: number;
  staleCount: number;
  unavailableCount: number;
  insufficientCount: number;
  pendingCount: number;
  evaluatedReadyCount: number; // ok|stale with barCount >= MIN_INDICATOR_BARS
  // Last refresh stats
  lastRefreshAt: string | null;
  lastRefreshMode: RefreshMode | null;
  lastRefreshDurationMs: number | null;
  lastKiteRequestCount: number | null;
  lastRefreshSuccessCount: number | null;
  lastRefreshFailCount: number | null;
  lastInstrumentUnresolvedCount: number | null;
  /** Last refresh rate-limiter diagnostics. */
  lastRateLimiterMetrics: TokenBucketMetrics | null;
  /** Alias validation state from last refresh. */
  lastInstrumentValidation: Record<string, "VERIFIED" | "UNVERIFIED" | "INSTRUMENT_IDENTITY_UNRESOLVED"> | null;
  // Scheduler state
  nextScheduledRefreshAt: string | null;
  nextScheduledRefreshMode: RefreshMode | null;
  schedulerActive: boolean;
  circuitBreakerOpen: boolean;
  circuitBreakerOpenUntil: string | null;
  // Cache efficiency
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: number | null;
  // Advisory lock key (for cross-replica dedup audit)
  lockKey: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Unique advisory lock key; must not collide with other pg_advisory_lock uses in this codebase.
 *  Known: 8274615 (swingOrderStaging), 7593721 (paperTradingCombo), option snapshot ingestor. */
export const ADVISORY_LOCK_KEY = 88_274_615;

/** Minimum bars for displaying any indicators (pivot, RSI, EMA9/21). */
const MIN_DISPLAY_BARS = 30;

/** Minimum bars for a full signal (EMA200 requires 200 completed bars). */
export const MIN_INDICATOR_BARS = 200;

/** Days of history to request from Kite. 365 calendar ≈ 252 trading bars. */
const KITE_HISTORY_DAYS = 365;

/**
 * Kite Historical Data API rate limit: ≈ 3 requests/second per account.
 * Source: Kite Connect API documentation (historical data endpoint).
 *
 * With REFRESH_CONCURRENCY=6 parallel requests and BATCH_PAUSE_MS=2000 ms
 * between batches, the effective rate is:
 *   6 req / (avg_call_latency_ms + 2000 ms) ≈ 6/4000 ≈ 1.5 req/s
 * which is comfortably within the 3 req/s limit.
 */
const KITE_HISTORICAL_RPS_LIMIT = 3; // documented Kite historical API rate (req/sec)
const REFRESH_CONCURRENCY = 6;       // parallel Kite calls per batch

/**
 * Pause between batches ensures effective rate ≤ KITE_HISTORICAL_RPS_LIMIT.
 * Formula: BATCH_PAUSE_MS ≥ (REFRESH_CONCURRENCY / KITE_HISTORICAL_RPS_LIMIT) * 1000
 *          = (6 / 3) * 1000 = 2000 ms minimum.
 * We use 2000 ms; actual rate is lower because each Kite call takes ~1-3 s.
 */
const BATCH_PAUSE_MS = 2_000;        // ms between concurrency batches (rate limiter)

/** Data older than this is promoted from 'ok' → 'stale' in memory. */
const STALE_THRESHOLD_MS = 18 * 60 * 60 * 1000; // 18 h

/** Off-hours / weekends: 4-hour refresh cadence for failure recovery + new listings. */
const REFRESH_INTERVAL_OFF_HOURS_MS = 4 * 60 * 60 * 1000; // 4 h

/**
 * Refresh schedule policy:
 *
 *   DURING MARKET HOURS (Mon–Fri 09:15–15:30 IST = 03:45–10:00 UTC):
 *     EOD daily bars do not finalize until the session closes. Refreshing during
 *     market hours re-downloads the same in-progress partial bar — wasteful and
 *     semantically wrong. The partial bar is always appended from the Kite batch
 *     quote in buildRowFromKiteCandles(). Schedule next refresh for 15:35 IST.
 *
 *   POST-CLOSE (15:30–21:00 IST on trading days = 10:00–15:30 UTC):
 *     Refresh captures the completed final daily bar for today.
 *     Then fall through to 4 h off-hours cadence for any retry needs.
 *
 *   OFF-HOURS / WEEKENDS (all other times):
 *     4-hour cadence for failure recovery and new-listing detection.
 *
 * IST↔UTC offsets (no daylight-saving in India):
 *   09:15 IST = 03:45 UTC  (market open; utcMins=225)
 *   15:30 IST = 10:00 UTC  (session close; utcMins=600)
 *   15:35 IST = 10:05 UTC  (5 min post-close; utcMins=605)
 */
function computeNextRefreshDelayMs(): number {
  const now = new Date();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat

  // Off-hours base: 4 hours
  let delayMs = REFRESH_INTERVAL_OFF_HOURS_MS;

  // On weekdays only (Mon=1 … Fri=5):
  if (day >= 1 && day <= 5) {
    if (utcMins >= 225 && utcMins < 605) {
      // During/around market hours — schedule for 5 min post-close (605 utcMins)
      const minsToPostClose = 605 - utcMins;
      delayMs = Math.min(delayMs, minsToPostClose * 60 * 1000);
    }
    // Post-close (utcMins ≥ 605): fall through to 4 h off-hours
  }

  // Minimum 5 min to prevent tight retry storms
  delayMs = Math.max(delayMs, 5 * 60 * 1000);

  // Double if circuit breaker open (half-open retry cadence)
  if (isCircuitBreakerOpen()) delayMs *= 2;

  return delayMs;
}

/** First refresh delay after server boot — gives Kite session time to establish. */
const INITIAL_REFRESH_DELAY_MS = 90_000; // 90 s

// Kite NSE symbol overrides are defined in universe.ts (KITE_NSE_SYMBOL_OVERRIDE)
// and imported above. The store uses the universe canonical symbol as its primary
// key; the Kite override is applied only at the Kite API call boundary.

/** Circuit breaker: open for this duration after CIRCUIT_OPEN_THRESHOLD failures. */
const CIRCUIT_OPEN_DURATION_MS = 60 * 60 * 1000; // 1 h

/** Number of consecutive full-fail refreshes that open the circuit. */
const CIRCUIT_OPEN_THRESHOLD = 3;

/** Fraction of failures that counts as a "full-fail" refresh. */
const CIRCUIT_FAIL_FRACTION = 0.5;

// ─── In-memory L1 cache ───────────────────────────────────────────────────────

const memCache = new Map<string, KiteCandleEntry>();

// Scheduler state
let schedulerActive = false;
let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let nextScheduledRefreshAt: Date | null = null;

// Refresh stats
let lastRefreshAt: Date | null = null;
let lastRefreshMode: RefreshMode | null = null;
let lastRefreshDurationMs: number | null = null;
let lastKiteRequestCount: number | null = null;
let lastRefreshSuccessCount: number | null = null;
let lastRefreshFailCount: number | null = null;
let lastInstrumentUnresolvedCount: number | null = null;
let lastRateLimiterMetrics: TokenBucketMetrics | null = null;
let lastInstrumentValidation: Record<string, "VERIFIED" | "UNVERIFIED" | "INSTRUMENT_IDENTITY_UNRESOLVED"> | null = null;
// Next scheduled refresh mode (for metrics reporting)
let nextScheduledRefreshMode: RefreshMode | null = null;

// Circuit breaker state
let circuitBreakerFailStreak = 0;
let circuitBreakerOpenUntil: Date | null = null;

// Cache efficiency counters
let cacheHitCount = 0;
let cacheMissCount = 0;

// Schema initialisation (memoised promise — runs once per process)
let schemaEnsurePromise: Promise<void> | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cacheKey(symbol: string, exchange = "NSE", timeframe = "day"): string {
  return `${exchange}:${timeframe}:${symbol}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

/** True during NSE equity market hours (09:15–15:30 IST, Mon–Fri). */
export function isMarketHours(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false; // weekend
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  // 09:15 IST = 03:45 UTC, 15:30 IST = 10:00 UTC
  return utcMins >= 225 && utcMins <= 600;
}

function isCircuitBreakerOpen(): boolean {
  if (!circuitBreakerOpenUntil) return false;
  if (Date.now() >= circuitBreakerOpenUntil.getTime()) {
    circuitBreakerOpenUntil = null;
    circuitBreakerFailStreak = 0;
    logger.info("kiteCandleStore: circuit breaker reset (half-open)");
    return false;
  }
  return true;
}

// ─── Schema (memoised, CREATE TABLE IF NOT EXISTS) ───────────────────────────

export async function ensureKiteCandleSchema(): Promise<void> {
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS kite_candle_store (
          symbol              TEXT NOT NULL,
          exchange            TEXT NOT NULL DEFAULT 'NSE',
          timeframe           TEXT NOT NULL DEFAULT 'day',
          session_date        DATE,
          bar_count           INT,
          bars_json           JSONB,
          fetched_at          TIMESTAMPTZ,
          status              TEXT NOT NULL DEFAULT 'pending',
          error_code          TEXT,
          refresh_attempt_at  TIMESTAMPTZ,
          PRIMARY KEY (symbol, exchange, timeframe)
        )
      `);
      logger.info("kiteCandleStore: schema ensured (kite_candle_store)");
    })().catch(err => {
      schemaEnsurePromise = null; // allow retry on next call
      throw err;
    });
  }
  return schemaEnsurePromise;
}

// ─── DB row → KiteCandleEntry ─────────────────────────────────────────────────

interface DbRow {
  symbol: string;
  exchange: string;
  timeframe: string;
  session_date: string | null;
  bar_count: string | number | null;
  bars_json: unknown;
  fetched_at: string | null;
  status: string;
  error_code: string | null;
}

function dbRowToEntry(row: DbRow): KiteCandleEntry {
  let chart: YahooChart | null = null;
  if (row.bars_json && typeof row.bars_json === "object") {
    chart = row.bars_json as YahooChart;
  }

  const barCount = row.bar_count != null ? Number(row.bar_count) : 0;
  const fetchedAt = row.fetched_at ? new Date(row.fetched_at) : null;
  const ageMs = fetchedAt ? Date.now() - fetchedAt.getTime() : Infinity;

  // Promote 'ok' to 'stale' if the data is old.
  const rawStatus = row.status as KiteCandleStatus;
  const effectiveStatus: KiteCandleStatus =
    rawStatus === "ok" && ageMs > STALE_THRESHOLD_MS ? "stale" : rawStatus;

  return {
    symbol: row.symbol,
    exchange: row.exchange,
    timeframe: row.timeframe,
    sessionDate: row.session_date ?? null,
    barCount,
    chart,
    fetchedAt,
    status: effectiveStatus,
    errorCode: row.error_code ?? null,
  };
}

// ─── DB operations ────────────────────────────────────────────────────────────

async function loadFromDb(): Promise<number> {
  const result = (await db.execute(sql`
    SELECT symbol, exchange, timeframe, session_date, bar_count, bars_json,
           fetched_at, status, error_code
    FROM kite_candle_store
  `)) as unknown as { rows: DbRow[] };

  let loaded = 0;
  for (const row of result.rows ?? []) {
    const entry = dbRowToEntry(row);
    memCache.set(cacheKey(entry.symbol, entry.exchange, entry.timeframe), entry);
    loaded++;
  }
  return loaded;
}

async function upsertToDb(entry: KiteCandleEntry): Promise<void> {
  const barsJsonStr = entry.chart ? JSON.stringify(entry.chart) : null;
  const sessionDateStr = entry.sessionDate ?? null;
  const fetchedAtStr = entry.fetchedAt?.toISOString() ?? null;

  await db.execute(sql`
    INSERT INTO kite_candle_store
      (symbol, exchange, timeframe, session_date, bar_count, bars_json,
       fetched_at, status, error_code, refresh_attempt_at)
    VALUES
      (${entry.symbol}, ${entry.exchange}, ${entry.timeframe},
       ${sessionDateStr}::date, ${entry.barCount},
       ${barsJsonStr}::jsonb,
       ${fetchedAtStr}::timestamptz,
       ${entry.status}, ${entry.errorCode},
       NOW())
    ON CONFLICT (symbol, exchange, timeframe) DO UPDATE SET
      session_date       = EXCLUDED.session_date,
      bar_count          = EXCLUDED.bar_count,
      bars_json          = EXCLUDED.bars_json,
      fetched_at         = EXCLUDED.fetched_at,
      status             = EXCLUDED.status,
      error_code         = EXCLUDED.error_code,
      refresh_attempt_at = NOW()
  `);
}

// ─── Advisory lock ────────────────────────────────────────────────────────────

async function tryAcquireRefreshLock(): Promise<boolean> {
  try {
    const result = (await db.execute(
      sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS acquired`,
    )) as unknown as { rows: Array<{ acquired: boolean }> };
    return result.rows[0]?.acquired === true;
  } catch {
    return true; // fail-open: better to run than stall
  }
}

async function releaseRefreshLock(): Promise<void> {
  try {
    await db.execute(sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
  } catch { /* best-effort */ }
}

// ─── Public read API (zero Kite calls) ───────────────────────────────────────

/**
 * Return the cached candle entry for a symbol.
 * NEVER triggers a Kite HTTP call — reads from in-memory L1 only.
 *
 * Returns a synthetic 'pending' entry for symbols not yet in the store.
 * Callers must treat chart===null as "data unavailable" and fall back accordingly.
 */
export function getKiteCandleSeries(
  symbol: string,
  exchange = "NSE",
  timeframe = "day",
): KiteCandleEntry {
  const key = cacheKey(symbol, exchange, timeframe);
  const entry = memCache.get(key);
  if (entry) {
    cacheHitCount++;
    return entry;
  }
  cacheMissCount++;
  return {
    symbol,
    exchange,
    timeframe,
    sessionDate: null,
    barCount: 0,
    chart: null,
    fetchedAt: null,
    status: "pending",
    errorCode: "KITE_CANDLE_STORE_PENDING",
  };
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export function getKiteCandleStoreMetrics(): KiteCandleStoreMetrics {
  const entries = Array.from(memCache.values());
  const total = cacheHitCount + cacheMissCount;
  return {
    totalSymbols: entries.length,
    okCount:           entries.filter(e => e.status === "ok").length,
    staleCount:        entries.filter(e => e.status === "stale").length,
    unavailableCount:  entries.filter(e => e.status === "unavailable").length,
    insufficientCount: entries.filter(e => e.status === "insufficient").length,
    pendingCount:      entries.filter(e => e.status === "pending").length,
    evaluatedReadyCount: entries.filter(
      e => (e.status === "ok" || e.status === "stale") && e.barCount >= MIN_INDICATOR_BARS
    ).length,
    lastRefreshAt:               lastRefreshAt?.toISOString() ?? null,
    lastRefreshMode,
    lastRefreshDurationMs,
    lastKiteRequestCount,
    lastRefreshSuccessCount,
    lastRefreshFailCount,
    lastInstrumentUnresolvedCount,
    lastRateLimiterMetrics,
    lastInstrumentValidation,
    nextScheduledRefreshAt:      nextScheduledRefreshAt?.toISOString() ?? null,
    nextScheduledRefreshMode,
    schedulerActive,
    circuitBreakerOpen:          circuitBreakerOpenUntil != null && Date.now() < circuitBreakerOpenUntil.getTime(),
    circuitBreakerOpenUntil:     circuitBreakerOpenUntil?.toISOString() ?? null,
    cacheHits:   cacheHitCount,
    cacheMisses: cacheMissCount,
    cacheHitRatio: total > 0 ? Math.round((cacheHitCount / total) * 1000) / 1000 : null,
    lockKey: ADVISORY_LOCK_KEY,
  };
}

// ─── Symbol set selection by refresh mode ────────────────────────────────────

/**
 * Current IST date as YYYY-MM-DD string.
 * India Standard Time = UTC+5:30 (no DST).
 */
function todayIst(): string {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(now.getTime() + istOffsetMs).toISOString().slice(0, 10);
}

/**
 * Select the symbols to refresh based on the current refresh mode.
 *
 * FULL:             All active universe symbols (initial backfill + manual refresh).
 * INCREMENTAL:      Only symbols where session_date < today OR status !== 'ok'.
 *                   Captures the newly completed daily bar without re-downloading
 *                   history that hasn't changed since the last refresh.
 * FAILED_RETRY:     Only symbols with status='unavailable' or 'insufficient'.
 *                   Used in off-hours cadence to recover from transient errors.
 * INSTRUMENT_CHANGE: Only symbols not yet present in the store (new universe entries).
 *                    Used to detect new listings or universe additions.
 */
export function getSymbolsForMode(mode: RefreshMode): string[] {
  const active = UNIVERSE
    .filter(u => !u.inactive && !INACTIVE_SYMBOLS.has(u.symbol.toUpperCase()))
    .map(u => u.symbol);

  if (mode === "FULL") return active;

  const today = todayIst();

  return active.filter(sym => {
    const key = cacheKey(sym, "NSE", "day");
    const entry = memCache.get(key);
    switch (mode) {
      case "INCREMENTAL":
        if (!entry) return true;
        if (entry.status !== "ok") return true;
        if (entry.sessionDate !== today) return true;
        return false;
      case "FAILED_RETRY":
        if (!entry) return true;
        return entry.status === "unavailable" || entry.status === "insufficient";
      case "INSTRUMENT_CHANGE":
        return !entry; // no store record → new symbol
      default:
        return true;
    }
  });
}

// ─── Per-symbol Kite fetch ────────────────────────────────────────────────────

/**
 * Fetch one symbol's daily candle history from Kite.
 *
 * Rate limiting: calls rateLimiter.acquire() before each attempt.
 * 429 handling: backs off via rateLimiter.reportRateLimit() and retries once.
 * Symbol resolution: applies KITE_NSE_SYMBOL_OVERRIDE at the Kite API boundary.
 *   The result is stored under the canonical universe symbol so that
 *   getKiteCandleSeries(universeSymbol) always works without knowing the Kite symbol.
 *
 * @param symbol       Canonical universe symbol (e.g. "LTIM", "ZOMATO")
 * @param kiteSymbol   Resolved Kite NSE trading symbol (from override or == symbol)
 * @param rateLimiter  Token-bucket limiter — must acquire a token before each request
 */
async function fetchEntryFromKite(
  symbol: string,
  kiteSymbol: string,
  rateLimiter: typeof kiteHistoricalBucket,
): Promise<KiteCandleEntry> {
  const exchange = "NSE";
  const timeframe = "day";
  const MAX_RETRIES = 1; // one retry after a 429

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Acquire a rate-limit token (blocks until one is available).
    await rateLimiter.acquire();
    try {
      const chart = await centralEquityCandles(kiteSymbol, "day", KITE_HISTORY_DAYS);
      if (!chart) {
        return {
          symbol, exchange, timeframe,
          sessionDate: null, barCount: 0, chart: null,
          fetchedAt: new Date(), status: "unavailable", errorCode: "KITE_OFFLINE",
        };
      }

      const barCount = chart.close.length;
      if (barCount < MIN_DISPLAY_BARS) {
        // Too few bars even for display indicators — store without chart.
        return {
          symbol, exchange, timeframe,
          sessionDate: null, barCount, chart: null,
          fetchedAt: new Date(), status: "insufficient", errorCode: "INSUFFICIENT_HISTORY",
        };
      }

      // Derive session date from the last completed bar timestamp (Unix seconds → IST date).
      const lastTs = chart.timestamps[chart.timestamps.length - 1];
      // Convert from Unix seconds to IST (UTC+5:30) date string
      const sessionDate = lastTs
        ? new Date(lastTs * 1000 + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : null;

      return {
        symbol, exchange, timeframe,
        sessionDate, barCount, chart,
        fetchedAt: new Date(), status: "ok", errorCode: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const msgLower = msg.toLowerCase();
      const is429 = msgLower.includes("429") ||
                    msgLower.includes("too many requests") ||
                    msgLower.includes("rate limit");

      if (is429 && attempt < MAX_RETRIES) {
        // Back off and retry
        await rateLimiter.reportRateLimit();
        continue;
      }

      logger.debug(
        { symbol, kiteSymbol, attempt, err: msg.slice(0, 100) },
        "kiteCandleStore: per-symbol fetch failed",
      );
      return {
        symbol, exchange, timeframe,
        sessionDate: null, barCount: 0, chart: null,
        fetchedAt: new Date(), status: "unavailable",
        errorCode: is429 ? "RATE_LIMIT_EXHAUSTED" : "FETCH_FAILED",
      };
    }
  }

  // Should not reach here, but TypeScript requires a return
  return {
    symbol, exchange, timeframe,
    sessionDate: null, barCount: 0, chart: null,
    fetchedAt: new Date(), status: "unavailable", errorCode: "FETCH_FAILED",
  };
}

// ─── Background refresh ───────────────────────────────────────────────────────

/**
 * Run a candle refresh cycle.
 *
 * @param mode  Controls which symbols are fetched. Defaults to FULL (all active
 *              universe symbols). See RefreshMode for when each mode is used.
 *
 * Rate limiting: uses the module-level KiteHistoricalTokenBucket (3 tokens/sec).
 *   Each symbol call acquires one token before dispatching, enforcing a true
 *   rolling-rate limit rather than a batch-pause approximation.
 *
 * Symbol validation: at the start of each cycle, KITE_NSE_SYMBOL_OVERRIDE aliases
 *   are verified against the live Kite instrument master. Unresolvable aliases
 *   get status="unavailable" / errorCode="INSTRUMENT_IDENTITY_UNRESOLVED" without
 *   making a Kite historical API call.
 *
 * Cross-replica safety: pg_try_advisory_lock prevents concurrent refreshes.
 *   The losing replica waits 15 s then reloads from DB so it still benefits from
 *   the winner's work. No replica remains permanently empty.
 */
export async function runKiteCandleRefresh(mode: RefreshMode = "FULL"): Promise<RefreshResult> {
  const emptyMetrics: TokenBucketMetrics = { requestCount: 0, rate429Count: 0, retryCount: 0, maxObservedRollingRps: 0, currentTokens: 0 };
  const emptyResult: RefreshResult = {
    refreshMode: mode,
    kiteRequests: 0, symbolsConsidered: 0, successCount: 0, failCount: 0,
    insufficientCount: 0, instrumentUnresolvedCount: 0, durationMs: 0,
    circuitOpen: false, errors: [],
    rateLimiterMetrics: emptyMetrics, instrumentValidation: {},
  };

  // Circuit breaker check
  if (isCircuitBreakerOpen()) {
    logger.info(
      { openUntil: circuitBreakerOpenUntil?.toISOString(), mode },
      "kiteCandleStore: refresh skipped — circuit breaker open",
    );
    return { ...emptyResult, skipped: true, skipReason: "CIRCUIT_BREAKER_OPEN", circuitOpen: true };
  }

  // Try advisory lock — skip if another replica holds it
  const locked = await tryAcquireRefreshLock();
  if (!locked) {
    logger.info({ mode }, "kiteCandleStore: refresh skipped — advisory lock held (another replica refreshing)");
    // Another replica holds the lock and is refreshing. Wait, then reload from DB
    // so this replica gets the other's results without duplicating Kite calls.
    await sleep(15_000);
    const reloaded = await loadFromDb();
    logger.info({ reloaded, mode }, "kiteCandleStore: reloaded from DB after lock miss");
    return { ...emptyResult, skipped: true, skipReason: "LOCK_HELD" };
  }

  const start = Date.now();
  let kiteRequests = 0;
  let successCount = 0;
  let failCount = 0;
  let insufficientCount = 0;
  let instrumentUnresolvedCount = 0;
  const errors: Array<{ symbol: string; errorCode: string }> = [];

  // Reset rate-limiter metrics for this refresh cycle.
  kiteHistoricalBucket.resetMetrics();

  try {
    // ── Step 1: Symbol resolution validation ─────────────────────────────
    // Verify KITE_NSE_SYMBOL_OVERRIDE aliases against the current Kite instrument
    // master. If the cache is unavailable (Kite not logged in yet), all aliases
    // are returned as UNVERIFIED — non-fatal, the check is repeated next cycle.
    let instrumentsBySymbol: ReadonlyMap<string, unknown> | null = null;
    try {
      const instrumentCache = await centralKiteNseEqInstruments();
      instrumentsBySymbol = instrumentCache?.bySymbol ?? null;
    } catch { /* instrument cache unavailable — proceed with UNVERIFIED */ }

    const validation = validateKiteSymbolOverrides(instrumentsBySymbol);
    const unresolvedAliases = Object.entries(validation)
      .filter(([, v]) => v === "INSTRUMENT_IDENTITY_UNRESOLVED")
      .map(([k]) => k);

    if (unresolvedAliases.length > 0) {
      logger.error(
        { unresolvedAliases, validation },
        "kiteCandleStore: INSTRUMENT_IDENTITY_UNRESOLVED — aliases not found in Kite instrument master; those symbols will be marked unavailable",
      );
    } else if (Object.values(validation).every(v => v === "VERIFIED")) {
      logger.info({ validation }, "kiteCandleStore: all symbol overrides VERIFIED in Kite instrument master");
    }

    // ── Step 2: Select symbols for this mode ─────────────────────────────
    const symbols = getSymbolsForMode(mode);

    logger.info(
      { mode, symbols: symbols.length, concurrency: REFRESH_CONCURRENCY },
      "kiteCandleStore: refresh started",
    );

    // ── Step 3: Fetch each symbol (token-bucket rate-limited) ─────────────
    const batches = chunk(symbols, REFRESH_CONCURRENCY);

    for (const batch of batches) {
      await Promise.all(batch.map(async symbol => {
        // Resolve Kite NSE symbol — check override, then validate against master.
        const kiteSymbol = KITE_NSE_SYMBOL_OVERRIDE[symbol] ?? symbol;
        const aliasStatus = validation[symbol] ?? "VERIFIED"; // non-override symbols are always verified

        // If alias is positively unresolved → fail closed without a Kite API call.
        if (aliasStatus === "INSTRUMENT_IDENTITY_UNRESOLVED") {
          instrumentUnresolvedCount++;
          const entry: KiteCandleEntry = {
            symbol, exchange: "NSE", timeframe: "day",
            sessionDate: null, barCount: 0, chart: null,
            fetchedAt: new Date(), status: "unavailable",
            errorCode: "INSTRUMENT_IDENTITY_UNRESOLVED",
          };
          memCache.set(cacheKey(symbol, "NSE", "day"), entry);
          try { await upsertToDb(entry); } catch { /* best-effort */ }
          errors.push({ symbol, errorCode: "INSTRUMENT_IDENTITY_UNRESOLVED" });
          failCount++;
          return;
        }

        kiteRequests++;
        const entry = await fetchEntryFromKite(symbol, kiteSymbol, kiteHistoricalBucket);

        // Update L1 immediately (stale-while-revalidate: serves the old value
        // to concurrent readers until the new one arrives).
        memCache.set(cacheKey(symbol, entry.exchange, entry.timeframe), entry);

        // Write to L2 — best-effort (L1 is authoritative for this replica).
        try {
          await upsertToDb(entry);
        } catch (dbErr) {
          logger.warn({ symbol, err: (dbErr as Error).message }, "kiteCandleStore: DB upsert failed for symbol");
        }

        if (entry.status === "ok") {
          successCount++;
        } else if (entry.status === "insufficient") {
          insufficientCount++;
          errors.push({ symbol, errorCode: entry.errorCode ?? "INSUFFICIENT_HISTORY" });
        } else {
          failCount++;
          errors.push({ symbol, errorCode: entry.errorCode ?? "UNKNOWN" });
        }
      }));
      // NOTE: No batch-pause between groups. The token bucket enforces the rolling
      // rate limit (3 req/s) directly. Workers naturally wait for tokens to refill.
    }

    const durationMs = Date.now() - start;
    const rlMetrics = kiteHistoricalBucket.metrics;

    lastRefreshAt = new Date();
    lastRefreshMode = mode;
    lastRefreshDurationMs = durationMs;
    lastKiteRequestCount = kiteRequests;
    lastRefreshSuccessCount = successCount;
    lastRefreshFailCount = failCount;
    lastInstrumentUnresolvedCount = instrumentUnresolvedCount;
    lastRateLimiterMetrics = rlMetrics;
    lastInstrumentValidation = validation;

    // Circuit breaker: if ≥50 % failed (excluding INSTRUMENT_IDENTITY_UNRESOLVED),
    // increment fail streak. INSTRUMENT_IDENTITY_UNRESOLVED is a config error, not
    // a transient Kite outage, so it doesn't count toward the circuit breaker.
    const realFails = failCount - instrumentUnresolvedCount;
    const realRequests = kiteRequests;
    const failFraction = realRequests > 0 ? (realFails / realRequests) : 0;
    if (failFraction >= CIRCUIT_FAIL_FRACTION) {
      circuitBreakerFailStreak++;
      if (circuitBreakerFailStreak >= CIRCUIT_OPEN_THRESHOLD) {
        circuitBreakerOpenUntil = new Date(Date.now() + CIRCUIT_OPEN_DURATION_MS);
        logger.warn(
          { failStreak: circuitBreakerFailStreak, openUntil: circuitBreakerOpenUntil.toISOString() },
          "kiteCandleStore: circuit breaker OPEN — too many consecutive failing refreshes",
        );
      }
    } else {
      circuitBreakerFailStreak = 0;
    }

    const storeMetrics = getKiteCandleStoreMetrics();
    logger.info(
      {
        mode, kiteRequests, symbolsConsidered: symbols.length,
        successCount, failCount, insufficientCount, instrumentUnresolvedCount, durationMs,
        okCount: storeMetrics.okCount, staleCount: storeMetrics.staleCount,
        evaluatedReadyCount: storeMetrics.evaluatedReadyCount,
        totalSymbols: storeMetrics.totalSymbols,
        failFraction: Math.round(failFraction * 100),
        circuitBreakerFailStreak,
        maxObservedRps: rlMetrics.maxObservedRollingRps,
        rate429Count: rlMetrics.rate429Count,
        retryCount: rlMetrics.retryCount,
      },
      "kiteCandleStore: refresh complete",
    );

    return {
      refreshMode: mode,
      kiteRequests, symbolsConsidered: symbols.length,
      successCount, failCount, insufficientCount, instrumentUnresolvedCount, durationMs,
      circuitOpen: false, errors,
      rateLimiterMetrics: rlMetrics,
      instrumentValidation: validation,
    };
  } finally {
    await releaseRefreshLock();
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Compute the refresh mode for the next scheduled refresh.
 *
 * Post-close (15:35–23:59 IST on trading days):
 *   INCREMENTAL — capture today's completed daily bar for symbols that don't have it.
 *
 * Off-hours / weekends:
 *   FAILED_RETRY — only recover symbols with status=unavailable|insufficient.
 *   Full history doesn't change during off-hours, so re-downloading all 199
 *   symbols would waste Kite API quota without any new data.
 */
function computeNextRefreshMode(): RefreshMode {
  const now = new Date();
  const day = now.getUTCDay();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();

  // Post-close window on weekdays: 15:35 IST (10:05 UTC) to midnight
  if (day >= 1 && day <= 5 && utcMins >= 605) {
    return "INCREMENTAL";
  }
  return "FAILED_RETRY";
}

function scheduleNextRefresh(): void {
  if (schedulerTimer) clearTimeout(schedulerTimer);

  const intervalMs = computeNextRefreshDelayMs();
  const mode = computeNextRefreshMode();
  nextScheduledRefreshAt = new Date(Date.now() + intervalMs);
  nextScheduledRefreshMode = mode;

  schedulerTimer = setTimeout(async () => {
    try {
      await runKiteCandleRefresh(mode);
    } catch (err) {
      logger.warn({ err, mode }, "kiteCandleStore: scheduled refresh failed");
    } finally {
      scheduleNextRefresh(); // always reschedule (fail-open)
    }
  }, intervalMs);
}

// ─── Initialisation ──────────────────────────────────────────────────────────

/**
 * Initialise the canonical Kite Candle Store.
 * Must be called ONCE at server startup. Safe to call multiple times (idempotent).
 *
 * Flow:
 *   1. Ensure DB schema (CREATE TABLE IF NOT EXISTS — idempotent).
 *   2. Load existing entries from DB into L1 (fast — no Kite calls, warm-start).
 *   3. Schedule background refresh:
 *      • If L1 has fresh 'ok' entries → first refresh fires after the normal interval.
 *      • If L1 is empty or all-stale → first refresh fires after INITIAL_REFRESH_DELAY_MS.
 *
 * The function returns quickly (non-blocking). The refresh runs in background.
 * During the INITIAL_REFRESH_DELAY_MS window, the scanner will serve:
 *   - Stale last-good rows (if DB had prior-session data).
 *   - NOT_EVALUATED rows falling back to Yahoo (if DB was empty).
 */
export async function initKiteCandleStore(): Promise<void> {
  if (schedulerActive) {
    logger.warn("kiteCandleStore: initKiteCandleStore called more than once — ignored");
    return;
  }
  schedulerActive = true;

  try {
    await ensureKiteCandleSchema();
  } catch (err) {
    logger.warn({ err }, "kiteCandleStore: schema ensure failed — will retry on first refresh");
  }

  let loaded = 0;
  try {
    loaded = await loadFromDb();
    logger.info({ loaded }, "kiteCandleStore: warm-started from DB");
  } catch (err) {
    logger.warn({ err }, "kiteCandleStore: DB load failed — starting with empty L1 cache");
  }

  // Determine first-refresh delay:
  // • Empty or all-stale → fire sooner (90 s) so first scan has data quickly.
  // • Has fresh ok entries → fire after a normal interval.
  const hasFreshData = Array.from(memCache.values()).some(e => e.status === "ok");
  // Fresh data loaded: use the smart schedule (avoids redundant market-hours refreshes).
  // Empty or stale: fire sooner (INITIAL_REFRESH_DELAY_MS) so the first scan has data.
  const firstDelayMs = hasFreshData
    ? computeNextRefreshDelayMs()
    : INITIAL_REFRESH_DELAY_MS;

  nextScheduledRefreshAt = new Date(Date.now() + firstDelayMs);
  logger.info(
    { loaded, hasFreshData, firstDelayMs, nextAt: nextScheduledRefreshAt.toISOString() },
    "kiteCandleStore: scheduler starting",
  );

  schedulerTimer = setTimeout(async () => {
    try {
      await runKiteCandleRefresh();
    } catch (err) {
      logger.warn({ err }, "kiteCandleStore: first refresh failed");
    } finally {
      scheduleNextRefresh();
    }
  }, firstDelayMs);
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Exported for unit tests only. Do not use in production code. */
export const _testOnly = {
  setMemCacheEntry(entry: KiteCandleEntry): void {
    memCache.set(cacheKey(entry.symbol, entry.exchange, entry.timeframe), entry);
  },
  clearMemCache(): void { memCache.clear(); },
  resetCounters(): void { cacheHitCount = 0; cacheMissCount = 0; },
  resetCircuitBreaker(): void {
    circuitBreakerFailStreak = 0;
    circuitBreakerOpenUntil = null;
  },
  resetSchedulerState(): void {
    schedulerActive = false;
    if (schedulerTimer) clearTimeout(schedulerTimer);
    schedulerTimer = null;
    nextScheduledRefreshAt = null;
    nextScheduledRefreshMode = null;
  },
  resetLastRefreshStats(): void {
    lastRefreshAt = null;
    lastRefreshMode = null;
    lastRefreshDurationMs = null;
    lastKiteRequestCount = null;
    lastRefreshSuccessCount = null;
    lastRefreshFailCount = null;
    lastInstrumentUnresolvedCount = null;
    lastRateLimiterMetrics = null;
    lastInstrumentValidation = null;
  },
  setMemCacheRaw(key: string, entry: KiteCandleEntry): void {
    memCache.set(key, entry);
  },
  getMemCacheSize(): number { return memCache.size; },
  getMemCacheRaw(): Map<string, KiteCandleEntry> { return memCache; },
  STALE_THRESHOLD_MS,
  MIN_DISPLAY_BARS,
  MIN_INDICATOR_BARS,
  chunk,
  isMarketHours,
  dbRowToEntry,
  cacheKey,
  computeNextRefreshMode,
  getSymbolsForMode,
  todayIst,
};
