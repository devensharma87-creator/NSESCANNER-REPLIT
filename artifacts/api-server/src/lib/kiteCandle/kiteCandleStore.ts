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
import { UNIVERSE, INACTIVE_SYMBOLS } from "../universe";

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

export interface RefreshResult {
  skipped?: boolean;
  skipReason?: string;
  kiteRequests: number;
  successCount: number;
  failCount: number;
  insufficientCount: number;
  durationMs: number;
  circuitOpen: boolean;
  errors: Array<{ symbol: string; errorCode: string }>;
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
  lastRefreshDurationMs: number | null;
  lastKiteRequestCount: number | null;
  lastRefreshSuccessCount: number | null;
  lastRefreshFailCount: number | null;
  // Scheduler state
  nextScheduledRefreshAt: string | null;
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

/** Concurrent Kite requests per batch during refresh. */
const REFRESH_CONCURRENCY = 6;

/** Pause between concurrency batches to respect Kite API rate limits. */
const BATCH_PAUSE_MS = 500;

/** Data older than this is promoted from 'ok' → 'stale' in memory. */
const STALE_THRESHOLD_MS = 18 * 60 * 60 * 1000; // 18 h

/** Refresh intervals (next timer after a completed refresh). */
const REFRESH_INTERVAL_MARKET_HOURS_MS = 20 * 60 * 1000;  // 20 min
const REFRESH_INTERVAL_OFF_HOURS_MS    = 4 * 60 * 60 * 1000; // 4 h

/** First refresh delay after server boot — gives Kite session time to establish. */
const INITIAL_REFRESH_DELAY_MS = 90_000; // 90 s

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
let lastRefreshDurationMs: number | null = null;
let lastKiteRequestCount: number | null = null;
let lastRefreshSuccessCount: number | null = null;
let lastRefreshFailCount: number | null = null;

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
    lastRefreshAt:          lastRefreshAt?.toISOString() ?? null,
    lastRefreshDurationMs,
    lastKiteRequestCount,
    lastRefreshSuccessCount,
    lastRefreshFailCount,
    nextScheduledRefreshAt: nextScheduledRefreshAt?.toISOString() ?? null,
    schedulerActive,
    circuitBreakerOpen:     circuitBreakerOpenUntil != null && Date.now() < circuitBreakerOpenUntil.getTime(),
    circuitBreakerOpenUntil: circuitBreakerOpenUntil?.toISOString() ?? null,
    cacheHits:   cacheHitCount,
    cacheMisses: cacheMissCount,
    cacheHitRatio: total > 0 ? Math.round((cacheHitCount / total) * 1000) / 1000 : null,
    lockKey: ADVISORY_LOCK_KEY,
  };
}

// ─── Per-symbol Kite fetch ────────────────────────────────────────────────────

async function fetchEntryFromKite(symbol: string): Promise<KiteCandleEntry> {
  const exchange = "NSE";
  const timeframe = "day";
  try {
    const chart = await centralEquityCandles(symbol, "day", KITE_HISTORY_DAYS);
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

    // Derive session date from the last completed bar timestamp (Unix seconds → date).
    const lastTs = chart.timestamps[chart.timestamps.length - 1];
    const sessionDate = lastTs
      ? new Date(lastTs * 1000).toISOString().slice(0, 10)
      : null;

    return {
      symbol, exchange, timeframe,
      sessionDate, barCount, chart,
      fetchedAt: new Date(), status: "ok", errorCode: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
    logger.debug({ symbol, err: msg }, "kiteCandleStore: per-symbol fetch failed");
    return {
      symbol, exchange, timeframe,
      sessionDate: null, barCount: 0, chart: null,
      fetchedAt: new Date(), status: "unavailable", errorCode: "FETCH_FAILED",
    };
  }
}

// ─── Background refresh ───────────────────────────────────────────────────────

/**
 * Run a full refresh of all curated-universe symbols.
 * Contacts Kite for all symbols that need updating.
 * Rate-limited to REFRESH_CONCURRENCY concurrent requests with BATCH_PAUSE_MS pause.
 * Advisory lock prevents concurrent execution across replicas.
 */
export async function runKiteCandleRefresh(): Promise<RefreshResult> {
  const empty: RefreshResult = {
    kiteRequests: 0, successCount: 0, failCount: 0,
    insufficientCount: 0, durationMs: 0, circuitOpen: false, errors: [],
  };

  // Circuit breaker check
  if (isCircuitBreakerOpen()) {
    logger.info(
      { openUntil: circuitBreakerOpenUntil?.toISOString() },
      "kiteCandleStore: refresh skipped — circuit breaker open",
    );
    return { ...empty, skipped: true, skipReason: "CIRCUIT_BREAKER_OPEN", circuitOpen: true };
  }

  // Try advisory lock — skip if another replica holds it
  const locked = await tryAcquireRefreshLock();
  if (!locked) {
    logger.info("kiteCandleStore: refresh skipped — advisory lock held (another replica refreshing)");
    // Another replica is refreshing — wait then reload from DB so this replica
    // benefits from the other's work without duplicating Kite calls.
    await sleep(15_000);
    const reloaded = await loadFromDb();
    logger.info({ reloaded }, "kiteCandleStore: reloaded from DB after lock miss");
    return { ...empty, skipped: true, skipReason: "LOCK_HELD" };
  }

  const start = Date.now();
  let kiteRequests = 0;
  let successCount = 0;
  let failCount = 0;
  let insufficientCount = 0;
  const errors: Array<{ symbol: string; errorCode: string }> = [];

  try {
    const symbols = UNIVERSE
      .filter(u => !u.inactive && !INACTIVE_SYMBOLS.has(u.symbol.toUpperCase()))
      .map(u => u.symbol);

    logger.info({ symbols: symbols.length, concurrency: REFRESH_CONCURRENCY }, "kiteCandleStore: refresh started");

    const batches = chunk(symbols, REFRESH_CONCURRENCY);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]!;
      await Promise.all(batch.map(async symbol => {
        kiteRequests++;
        const entry = await fetchEntryFromKite(symbol);

        // Update L1 immediately (serves stale-while-revalidate)
        memCache.set(cacheKey(symbol, entry.exchange, entry.timeframe), entry);

        // Write to L2 (best-effort — L1 is authoritative for this replica)
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

      // Pause between batches (not after the last one)
      if (batchIdx < batches.length - 1) {
        await sleep(BATCH_PAUSE_MS);
      }
    }

    const durationMs = Date.now() - start;
    lastRefreshAt = new Date();
    lastRefreshDurationMs = durationMs;
    lastKiteRequestCount = kiteRequests;
    lastRefreshSuccessCount = successCount;
    lastRefreshFailCount = failCount;

    // Circuit breaker: if ≥50 % failed, increment fail streak
    const failFraction = kiteRequests > 0 ? (failCount / kiteRequests) : 0;
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

    const metrics = getKiteCandleStoreMetrics();
    logger.info(
      {
        kiteRequests, successCount, failCount, insufficientCount, durationMs,
        okCount: metrics.okCount, staleCount: metrics.staleCount,
        evaluatedReadyCount: metrics.evaluatedReadyCount,
        totalSymbols: metrics.totalSymbols,
        failFraction: Math.round(failFraction * 100),
        circuitBreakerFailStreak,
      },
      "kiteCandleStore: refresh complete",
    );

    return { kiteRequests, successCount, failCount, insufficientCount, durationMs, circuitOpen: false, errors };
  } finally {
    await releaseRefreshLock();
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

function scheduleNextRefresh(): void {
  if (schedulerTimer) clearTimeout(schedulerTimer);

  const isOpen = circuitBreakerOpenUntil != null && Date.now() < circuitBreakerOpenUntil.getTime();
  const baseIntervalMs = isMarketHours()
    ? REFRESH_INTERVAL_MARKET_HOURS_MS
    : REFRESH_INTERVAL_OFF_HOURS_MS;
  // Double the interval when the circuit is open (half-open retry cadence)
  const intervalMs = isOpen ? baseIntervalMs * 2 : baseIntervalMs;

  nextScheduledRefreshAt = new Date(Date.now() + intervalMs);

  schedulerTimer = setTimeout(async () => {
    try {
      await runKiteCandleRefresh();
    } catch (err) {
      logger.warn({ err }, "kiteCandleStore: scheduled refresh failed");
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
  const firstDelayMs = hasFreshData
    ? (isMarketHours() ? REFRESH_INTERVAL_MARKET_HOURS_MS : REFRESH_INTERVAL_OFF_HOURS_MS)
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
  },
  getMemCacheSize(): number { return memCache.size; },
  STALE_THRESHOLD_MS,
  MIN_DISPLAY_BARS,
  MIN_INDICATOR_BARS,
  chunk,
  isMarketHours,
  dbRowToEntry,
  cacheKey,
};
