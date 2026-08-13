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
import {
  UNIVERSE,
  INACTIVE_SYMBOLS,
  KITE_NSE_SYMBOL_OVERRIDE,
  validateKiteSymbolOverrides,
  CURATED_UNIVERSE_EXCHANGE,
} from "../universe";
import { normalizeCanonicalExchange, type CanonicalExchange } from "../canonicalInstrument";
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
  /**
   * Phase 0.7A: closed-set exchange. Entries arriving from the database or
   * from another module are validated before they are keyed; an unrecognised
   * exchange is dropped, never coerced to NSE.
   */
  exchange: CanonicalExchange;
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

/**
 * Global Kite historical-ingestion serialization lock (Pack 33 Correction 1).
 *
 * BOTH the curated refresh (ADVISORY_LOCK_KEY) AND the full-NSE warehouse job
 * must acquire this single advisory lock before making any Kite historical API
 * calls. Since PostgreSQL advisory locks are session-scoped, only ONE autoscale
 * replica at a time can hold this lock, which serializes ALL historical
 * ingestion globally — ensuring the aggregate request rate across all replicas
 * stays within the 3 req/s Kite provider limit.
 *
 * Priority:
 *   Curated refresh: acquires global lock first, then its own ADVISORY_LOCK_KEY.
 *     Holds both for the full refresh cycle (~100–200 s for 194 symbols).
 *   Full-NSE warehouse: acquires global lock per-batch (100 symbols), releases
 *     between batches. Checks curated due-time before each acquisition and
 *     yields for 60 s if curated is overdue.
 *
 * 429 handling: bounded exponential backoff (Retry-After or 5 s, max 60 s).
 *   After 3 consecutive 429s: job stops with RATE_LIMIT_PERSISTENT.
 *   401/403: job stops immediately with AUTH_FAILURE.
 *
 * Unaffected subsystems:
 *   Option-snapshot ingestion: uses /instruments and /quote endpoints (not
 *     /historical) — no rate conflict.
 *   Live Kite quote processing: uses /quote endpoint — no rate conflict.
 *
 * Lock key range convention:
 *   88_274_613 — reserved
 *   88_274_614 — this key (global ingestion serializer)
 *   88_274_615 — curated refresh identity lock
 *   88_274_616 — full-NSE warehouse identity lock
 */
export const KITE_HISTORICAL_INGESTION_GLOBAL_LOCK = 88_274_614;

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

/**
 * Phase 0.7A: the exchange is a REQUIRED, exchange-qualified argument. It used
 * to default to "NSE", so a caller that simply forgot it silently wrote (or
 * read) an NSE-keyed row — and a BSE listing of the same symbol would have
 * overwritten the NSE one. `CanonicalExchange` is a closed set, so an
 * unqualified call no longer compiles.
 */
function cacheKey(symbol: string, exchange: CanonicalExchange, timeframe: string): string {
  return `${exchange}:${timeframe}:${symbol}`;
}

/**
 * Key an entry whose `exchange` came from an untrusted boundary (a database
 * row, or an entry handed in by another module). Returns null — never an
 * assumed NSE key — when the exchange is missing or outside {NSE, BSE}, so the
 * row is dropped rather than filed under the wrong order book.
 */
function cacheKeyForEntry(entry: KiteCandleEntry): string | null {
  const exchange = normalizeCanonicalExchange(entry.exchange);
  if (exchange == null) return null;
  return cacheKey(entry.symbol, exchange, entry.timeframe);
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
        -- Phase 0.7A: the exchange column deliberately has NO default. A default
        -- of 'NSE' made any writer that omitted the column produce a row that
        -- looks exchange-qualified, which restore-time validation cannot
        -- detect, count or reject. Every writer must state the exchange.
        -- Existing databases created before this change still carry the old
        -- default until docs/migrations/kite_candle_store_exchange_drop_default.sql
        -- is applied — that ALTER is deliberately NOT executed from runtime.
        CREATE TABLE IF NOT EXISTS kite_candle_store (
          symbol              TEXT NOT NULL,
          exchange            TEXT NOT NULL,
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

/** Returns null when the row is not exchange-qualified (Phase 0.7A). */
function dbRowToEntry(row: DbRow): KiteCandleEntry | null {
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

  // Phase 0.7A: the stored exchange is untrusted text. A row that does not
  // carry a recognised exchange is dropped by the caller — it is never read
  // back as NSE, because that would resurrect a mis-filed row under the wrong
  // order book.
  const exchange = normalizeCanonicalExchange(row.exchange);
  if (exchange == null) return null;

  return {
    symbol: row.symbol,
    exchange,
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
  let rejectedExchange = 0;
  for (const row of result.rows ?? []) {
    const entry = dbRowToEntry(row);
    if (entry == null) {
      rejectedExchange++;
      continue;
    }
    const key = cacheKeyForEntry(entry);
    if (key == null) {
      rejectedExchange++;
      continue;
    }
    memCache.set(key, entry);
    loaded++;
  }
  if (rejectedExchange > 0) {
    logger.warn(
      { rejectedExchange, loaded },
      "kiteCandleStore: rows rejected on restore — INVALID_EXCHANGE (not restored under an assumed exchange)",
    );
  }
  return loaded;
}

/**
 * Phase 0.7A — the exchange an L2 write is allowed to persist.
 *
 * `kite_candle_store.exchange` no longer carries a column default, so an
 * omitted or unrecognised exchange is a failed write rather than a silent
 * 'NSE' row. This validator is the single decision point for that, and
 * `upsertToDb` — the only function in the codebase that writes the table —
 * calls it before touching the database.
 */
function validateWriteExchange(entry: Pick<KiteCandleEntry, "symbol" | "exchange">): CanonicalExchange | null {
  return normalizeCanonicalExchange(entry.exchange);
}

async function upsertToDb(entry: KiteCandleEntry): Promise<void> {
  // Fail closed BEFORE any SQL: a row that cannot name its order book is not
  // written at all. Callers treat L2 as best-effort, so this refusal is logged
  // rather than thrown — but nothing reaches the INSERT.
  const writeExchange = validateWriteExchange(entry);
  if (writeExchange == null) {
    logger.warn(
      {
        symbol: entry.symbol,
        exchange: entry.exchange,
        timeframe: entry.timeframe,
        code: entry.exchange == null || String(entry.exchange).trim() === ""
          ? "CANONICAL_IDENTITY_REQUIRED"
          : "INVALID_EXCHANGE",
      },
      "kiteCandleStore: L2 write refused — entry is not exchange-qualified (no row written)",
    );
    return;
  }

  const barsJsonStr = entry.chart ? JSON.stringify(entry.chart) : null;
  const sessionDateStr = entry.sessionDate ?? null;
  const fetchedAtStr = entry.fetchedAt?.toISOString() ?? null;

  await db.execute(sql`
    INSERT INTO kite_candle_store
      (symbol, exchange, timeframe, session_date, bar_count, bars_json,
       fetched_at, status, error_code, refresh_attempt_at)
    VALUES
      (${entry.symbol}, ${writeExchange}, ${entry.timeframe},
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

// ─── Global ingestion lock (shared with full-NSE warehouse) ──────────────────

/**
 * Acquire the global Kite historical-ingestion lock (88_274_614).
 *
 * The curated refresh uses `maxAttempts=3` with 5 s retries (total budget ≤15 s).
 * If the warehouse currently holds the lock, the curated refresh waits for the
 * current warehouse batch (~100 symbols) to finish before getting priority.
 *
 * Exported for warehouse use (both jobs share this function).
 */
export async function acquireGlobalIngestionLock(
  maxAttempts = 3,
  retryDelayMs = 5_000,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = (await db.execute(
        sql`SELECT pg_try_advisory_lock(${KITE_HISTORICAL_INGESTION_GLOBAL_LOCK}) AS acquired`,
      )) as unknown as { rows: Array<{ acquired: boolean }> };
      if (result.rows[0]?.acquired === true) return true;
    } catch {
      // DB error acquiring lock — fail-open for curated (the curated refresh
      // is more critical; better to run than stall on a transient DB error).
      return true;
    }
    if (i < maxAttempts - 1) await sleep(retryDelayMs);
  }
  return false;
}

/**
 * Bounded polling until a Postgres advisory lock is released by the winner,
 * then reloads from DB.
 *
 * Replaces the fixed `sleep(15_000)` that was insufficient for the full
 * warehouse run (~196 s for 199 symbols at 3 req/s). The loser now polls every
 * POLL_INTERVAL_MS for the lock to become acquirable. When it can acquire the
 * lock, the winner has finished and all DB rows are written; the loser then
 * releases the lock immediately and reloads.
 *
 * Max wait: MAX_POLL_MS (10 min). If the winner hasn't finished, reloads
 * whatever is in DB at that point.
 */
async function pollForLockReleaseAndReload(
  lockKey: number,
  lockDescription: string,
  mode: string,
): Promise<number> {
  const POLL_INTERVAL_MS = 5_000;
  const MAX_POLL_MS = 10 * 60 * 1_000; // 10 min maximum
  const pollStart = Date.now();
  let lockFree = false;

  while (Date.now() - pollStart < MAX_POLL_MS) {
    await sleep(POLL_INTERVAL_MS);
    // Try to acquire — success means winner released the lock.
    try {
      const result = (await db.execute(
        sql`SELECT pg_try_advisory_lock(${lockKey}) AS acquired`,
      )) as unknown as { rows: Array<{ acquired: boolean }> };
      if (result.rows[0]?.acquired === true) {
        // Immediately release — we only needed to detect the winner is done.
        await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
        lockFree = true;
        break;
      }
    } catch { /* DB error polling — break and reload with whatever is available */ break; }
  }

  const waitedMs = Date.now() - pollStart;
  const reloaded = await loadFromDb();
  logger.info(
    { reloaded, lockFree, waitedMs, lockDescription, mode },
    "kiteCandleStore: reloaded from DB after winner released lock",
  );
  return reloaded;
}

/**
 * Release the global Kite historical-ingestion lock (88_274_614).
 * Best-effort — lock auto-releases on session close anyway.
 */
export async function releaseGlobalIngestionLock(): Promise<void> {
  try {
    await db.execute(
      sql`SELECT pg_advisory_unlock(${KITE_HISTORICAL_INGESTION_GLOBAL_LOCK})`,
    );
  } catch { /* best-effort */ }
}

/**
 * Return the timestamp of the next scheduled curated refresh.
 * Used by the warehouse job to yield priority to curated.
 */
export function getCuratedRefreshDueAt(): Date | null {
  return nextScheduledRefreshAt;
}

// ─── Public read API (zero Kite calls) ───────────────────────────────────────

/**
 * Return the cached candle entry for a symbol on a SPECIFIC exchange.
 * NEVER triggers a Kite HTTP call — reads from in-memory L1 only.
 *
 * Returns a synthetic 'pending' entry for symbols not yet in the store.
 * Callers must treat chart===null as "data unavailable" and fall back accordingly.
 *
 * Phase 0.7A: `exchange` is required. It previously defaulted to "NSE", so a
 * caller holding a BSE symbol silently read the NSE series for the same
 * trading symbol. The two listings have separate order books and separate
 * candles, and they stay separate here.
 */
export function getKiteCandleSeries(
  symbol: string,
  exchange: CanonicalExchange,
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

// ─── Separate physical-store metrics (Point 8) ───────────────────────────────

export interface KiteCandlePhysicalStoreMetrics {
  /** Description of what each field counts. */
  description: string;
  /** Total rows in kite_candle_store (curated + warehouse). */
  totalPhysicalStoreRows: number;
  /** Curated universe symbols present in kite_candle_store (subset of 199). */
  curatedUniverseCount: number;
  curatedStoredCount: number;
  curatedReadyCount: number;        // barCount >= MIN_BARS_FOR_EVALUATION
  curatedOkCount: number;
  curatedInsufficientCount: number;
  curatedUnavailableCount: number;
  /** Warehouse (non-curated) row counts. */
  warehouseStoredCount: number;
  warehouseOkCount: number;
  warehouseInsufficientCount: number;
  warehouseHardFailureCount: number; // unavailable
  warehouseStaleCount: number;
  /** True if the DB query succeeded; false means counts may be stale in-memory estimates. */
  liveQuerySuccess: boolean;
  queriedAt: string;
}

/**
 * Run a live DB query to count curated vs warehouse rows separately.
 *
 * Motivation (Pack 33 Corrective Point 8): the in-memory storeMetrics conflates
 * curated and warehouse rows in `totalSymbols`. This function provides exact
 * per-universe counts from the physical DB row state (not L1 memCache).
 *
 * Result is NOT cached — callers should cache it externally if needed.
 */
export async function getKiteCandleStorePhysicalMetrics(
  curatedSymbols: string[],
  curatedActiveCount: number,
): Promise<KiteCandlePhysicalStoreMetrics> {
  const queriedAt = new Date().toISOString();
  const description =
    "Physical DB row counts split by curated (199-symbol universe) vs warehouse (all other NSE EQ). " +
    "curatedStoredCount = curated symbols present in DB (subset of curatedUniverseCount). " +
    "warehouseStoredCount = all other rows. " +
    "curatedReadyCount = curated rows with status=ok|stale AND bar_count>=" + MIN_INDICATOR_BARS + ".";

  try {
    await ensureKiteCandleSchema();

    // Single-pass aggregation: label each row as curated or warehouse.
    // Parameterized ANY($1::text[]) avoids N-symbol WHERE IN explosion.
    const result = await db.execute(sql`
      SELECT
        COUNT(*)                                                                  AS total_rows,
        COUNT(*) FILTER (WHERE symbol = ANY(${curatedSymbols}::text[]))           AS curated_stored,
        COUNT(*) FILTER (
          WHERE symbol = ANY(${curatedSymbols}::text[])
            AND status IN ('ok', 'stale')
            AND bar_count >= ${MIN_INDICATOR_BARS}
        )                                                                         AS curated_ready,
        COUNT(*) FILTER (WHERE symbol = ANY(${curatedSymbols}::text[]) AND status = 'ok')          AS curated_ok,
        COUNT(*) FILTER (WHERE symbol = ANY(${curatedSymbols}::text[]) AND status = 'insufficient') AS curated_insufficient,
        COUNT(*) FILTER (WHERE symbol = ANY(${curatedSymbols}::text[]) AND status = 'unavailable')  AS curated_unavailable,
        COUNT(*) FILTER (WHERE NOT (symbol = ANY(${curatedSymbols}::text[])))                       AS warehouse_stored,
        COUNT(*) FILTER (WHERE NOT (symbol = ANY(${curatedSymbols}::text[])) AND status = 'ok')     AS warehouse_ok,
        COUNT(*) FILTER (WHERE NOT (symbol = ANY(${curatedSymbols}::text[])) AND status = 'insufficient') AS warehouse_insufficient,
        COUNT(*) FILTER (WHERE NOT (symbol = ANY(${curatedSymbols}::text[])) AND status = 'unavailable')  AS warehouse_hard_failure,
        COUNT(*) FILTER (WHERE NOT (symbol = ANY(${curatedSymbols}::text[])) AND status = 'stale')        AS warehouse_stale
      FROM kite_candle_store
    `);

    // drizzle wraps pg rows — try both shapes (rows array or plain result)
    const row: Record<string, unknown> = (
      (result as unknown as { rows: Record<string, unknown>[] }).rows?.[0] ?? result
    ) as Record<string, unknown>;

    const n = (k: string): number => Number(row[k] ?? 0);
    return {
      description,
      totalPhysicalStoreRows:  n("total_rows"),
      curatedUniverseCount:    curatedActiveCount,
      curatedStoredCount:      n("curated_stored"),
      curatedReadyCount:       n("curated_ready"),
      curatedOkCount:          n("curated_ok"),
      curatedInsufficientCount: n("curated_insufficient"),
      curatedUnavailableCount:  n("curated_unavailable"),
      warehouseStoredCount:    n("warehouse_stored"),
      warehouseOkCount:        n("warehouse_ok"),
      warehouseInsufficientCount: n("warehouse_insufficient"),
      warehouseHardFailureCount:  n("warehouse_hard_failure"),
      warehouseStaleCount:     n("warehouse_stale"),
      liveQuerySuccess: true,
      queriedAt,
    };
  } catch (err) {
    logger.warn({ err }, "kiteCandleStore: physicalStoreMetrics DB query failed — returning zero counts");
    return {
      description,
      totalPhysicalStoreRows: 0, curatedUniverseCount: curatedActiveCount,
      curatedStoredCount: 0, curatedReadyCount: 0, curatedOkCount: 0,
      curatedInsufficientCount: 0, curatedUnavailableCount: 0,
      warehouseStoredCount: 0, warehouseOkCount: 0, warehouseInsufficientCount: 0,
      warehouseHardFailureCount: 0, warehouseStaleCount: 0,
      liveQuerySuccess: false, queriedAt,
    };
  }
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
    // Phase 0.7A: the exchange comes from the universe's own declaration
    // (CURATED_UNIVERSE_EXCHANGE), not from a literal typed at this call site.
    const key = cacheKey(sym, CURATED_UNIVERSE_EXCHANGE, "day");
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
 * @param exchange     Exchange the symbol was drawn from. Phase 0.7A: supplied
 *                     by the caller from the source's own declaration; this
 *                     function no longer stamps every entry "NSE" itself.
 * @param rateLimiter  Token-bucket limiter — must acquire a token before each request
 */
async function fetchEntryFromKite(
  symbol: string,
  kiteSymbol: string,
  exchange: CanonicalExchange,
  rateLimiter: typeof kiteHistoricalBucket,
): Promise<KiteCandleEntry> {
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

  // ── Distributed rate protection (Correction 1) ────────────────────────────
  // Acquire the global historical-ingestion serialization lock FIRST.
  // This ensures only ONE replica (curated OR warehouse) runs historical
  // ingestion at a time, keeping aggregate rate ≤ 3 req/s provider limit.
  const globalLocked = await acquireGlobalIngestionLock(3, 5_000);
  if (!globalLocked) {
    logger.warn(
      { mode },
      "kiteCandleStore: curated refresh skipped — global ingestion lock held by another replica/job; polling for winner to finish",
    );
    // ── Bounded polling until winner releases lock (Pack 33 Corrective Point 7) ──
    // Fixed 15 s sleep was insufficient: the warehouse winner takes ~196 s for
    // 199 symbols at 3 req/s. Loser reloaded at 15 s got < 50 rows.
    // Fix: poll for global lock release, then reload. Max 10 minutes.
    const reloaded = await pollForLockReleaseAndReload(
      KITE_HISTORICAL_INGESTION_GLOBAL_LOCK,
      "global lock (warehouse winner)",
      mode,
    );
    return { ...emptyResult, skipped: true, skipReason: "GLOBAL_LOCK_HELD", ...(reloaded != null ? { reloadedCount: reloaded } : {}) } as RefreshResult;
  }

  // Then acquire curated-specific lock — prevents duplicate curated runs if
  // two replicas both won the global lock race (cannot happen, but defensive).
  const locked = await tryAcquireRefreshLock();
  if (!locked) {
    await releaseGlobalIngestionLock();
    logger.info({ mode }, "kiteCandleStore: refresh skipped — curated advisory lock held (another replica refreshing); polling for winner");
    // ── Bounded polling for curated lock release ──────────────────────────────
    const reloaded = await pollForLockReleaseAndReload(
      ADVISORY_LOCK_KEY,
      "curated lock (another replica refreshing)",
      mode,
    );
    return { ...emptyResult, skipped: true, skipReason: "CURATED_LOCK_HELD", ...(reloaded != null ? { reloadedCount: reloaded } : {}) } as RefreshResult;
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
            symbol, exchange: CURATED_UNIVERSE_EXCHANGE, timeframe: "day",
            sessionDate: null, barCount: 0, chart: null,
            fetchedAt: new Date(), status: "unavailable",
            errorCode: "INSTRUMENT_IDENTITY_UNRESOLVED",
          };
          memCache.set(cacheKey(symbol, CURATED_UNIVERSE_EXCHANGE, "day"), entry);
          try { await upsertToDb(entry); } catch { /* best-effort */ }
          errors.push({ symbol, errorCode: "INSTRUMENT_IDENTITY_UNRESOLVED" });
          failCount++;
          return;
        }

        kiteRequests++;
        // The symbol set for this loop is the curated universe, whose exchange
        // is declared by the universe table itself (Phase 0.7A).
        const entry = await fetchEntryFromKite(
          symbol,
          kiteSymbol,
          CURATED_UNIVERSE_EXCHANGE,
          kiteHistoricalBucket,
        );

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
    await releaseGlobalIngestionLock();
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
/**
 * Store a single KiteCandleEntry in L1 (memCache) and L2 (PostgreSQL).
 *
 * Public API for external consumers (e.g. fullNseWarehouse) that need to
 * persist warehouse entries without accessing private upsertToDb directly.
 * L2 write is best-effort — L1 is always updated.
 */
export async function storeKiteCandleEntry(entry: KiteCandleEntry): Promise<void> {
  // Phase 0.7A: an entry handed in by another module is an untrusted boundary.
  // An unrecognised exchange is refused outright rather than being stored under
  // an assumed NSE key.
  const key = cacheKeyForEntry(entry);
  if (key == null) {
    logger.warn(
      { symbol: entry.symbol, exchange: entry.exchange },
      "kiteCandleStore: storeKiteCandleEntry refused — INVALID_EXCHANGE",
    );
    return;
  }
  memCache.set(key, entry);
  try {
    await upsertToDb(entry);
  } catch (err) {
    logger.warn(
      { symbol: entry.symbol, err: (err as Error).message },
      "kiteCandleStore: storeKiteCandleEntry DB upsert failed (best-effort)",
    );
  }
}

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

  // Start the full-NSE warehouse population background job (5-min delayed first run).
  // This populates candle history for all ~8,700 non-curated NSE EQ instruments.
  // It runs asynchronously and never blocks the scanner API.
  try {
    const { initFullNseWarehouseScheduler } = await import("./fullNseWarehouse");
    initFullNseWarehouseScheduler();
  } catch (err) {
    logger.warn({ err }, "kiteCandleStore: failed to start full-NSE warehouse scheduler");
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Exported for unit tests only. Do not use in production code. */
export const _testOnly = {
  /** Returns false when the entry's exchange is not a recognised exchange. */
  setMemCacheEntry(entry: KiteCandleEntry): boolean {
    const key = cacheKeyForEntry(entry);
    if (key == null) return false;
    memCache.set(key, entry);
    return true;
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
  validateWriteExchange,
  cacheKey,
  computeNextRefreshMode,
  getSymbolsForMode,
  todayIst,
};
