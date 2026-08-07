/**
 * Full-NSE Candle Warehouse Population — Pack 33 Control 3.
 *
 * Background job that asynchronously populates the kite_candle_store with
 * daily candle history for ALL eligible NSE EQ instruments, not just the
 * 199 curated-signal-universe stocks.
 *
 * Architecture:
 *   - Loads eligible instruments from the Kite NSE instrument master
 *     (via centralKiteNseEqInstruments — the compat-layer re-export).
 *   - Excludes ETF/SME securities (via kiteScanner.looksLikeEtf).
 *   - Excludes CURATED_SIGNAL_UNIVERSE symbols (they are refreshed by the
 *     main runKiteCandleRefresh() cycle on its own schedule).
 *   - Uses the same kiteHistoricalBucket token-bucket (3 req/s shared quota)
 *     and the same kite_candle_store PostgreSQL table.
 *   - Never holds the curated-refresh advisory lock (88_274_615).
 *     Uses its own advisory lock (88_274_616) to prevent concurrent runs
 *     across replicas while sharing the same token-bucket budget.
 *   - Never blocks the scanner API — runs in a detached background loop.
 *   - Rows become eligible individually only after their canonical inputs
 *     pass validation (valid Kite instrument + ≥30 daily bars).
 *   - While SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=false (Phase A),
 *     full-NSE rows are NOT_EVALUATED regardless of candle availability
 *     (the evaluation gate is in scanner.ts, not here).
 *
 * Rate limiting:
 *   With ~8,705 non-curated symbols and 3 req/s shared budget, a full
 *   initial backfill takes ~2,900 seconds (~48 min). This is expected and
 *   acceptable since the job is async, non-blocking, and idempotent.
 *
 * Advisory lock key: 88_274_616 (distinct from curated 88_274_615).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";
import { centralKiteNseEqInstruments, centralEquityCandles, centralLooksLikeEtf } from "../marketData/compat";
import { CURATED_SIGNAL_UNIVERSE, INACTIVE_SYMBOLS } from "../universe";
import { kiteHistoricalBucket } from "./tokenBucket";
import {
  getKiteCandleSeries,
  storeKiteCandleEntry,
  type KiteCandleEntry,
} from "./kiteCandleStore";

// ─── Config ──────────────────────────────────────────────────────────────────

/** Advisory lock key for the full-NSE warehouse job (must not equal 88_274_615). */
export const FULL_NSE_WAREHOUSE_LOCK_KEY = 88_274_616;

/** Minimum bars for a full-NSE entry to be stored (must have some history). */
const MIN_WAREHOUSE_BARS = 30;

/**
 * How long to wait between warehouse backfill cycles.
 * 24 hours: the history changes only with one new bar per trading day,
 * so nightly re-population is sufficient.
 */
const WAREHOUSE_CYCLE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/** Concurrency per batch within the warehouse job. Same as curated refresh. */
const WAREHOUSE_BATCH_SIZE = 6;

/** How many days of daily history to fetch per symbol. */
const WAREHOUSE_HISTORY_DAYS = 400;

// ─── State ───────────────────────────────────────────────────────────────────

let warehouseRunning = false;
let warehouseTimer: NodeJS.Timeout | null = null;
let lastWarehouseAt: Date | null = null;
let lastWarehouseSuccessCount: number | null = null;
let lastWarehouseFailCount: number | null = null;
let lastWarehouseTotalSymbols: number | null = null;
let lastWarehouseDurationMs: number | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function tryAcquireWarehouseLock(): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT pg_try_advisory_lock(${FULL_NSE_WAREHOUSE_LOCK_KEY}::bigint) AS locked`,
  );
  return (result.rows[0] as { locked: boolean }).locked === true;
}

async function releaseWarehouseLock(): Promise<void> {
  await db.execute(
    sql`SELECT pg_advisory_unlock(${FULL_NSE_WAREHOUSE_LOCK_KEY}::bigint)`,
  ).catch(() => { /* best-effort */ });
}

// ─── Eligible symbol list ─────────────────────────────────────────────────────

/**
 * Compute the set of eligible NSE EQ symbols for warehouse population.
 *
 * Eligible = all Kite NSE EQ instruments MINUS:
 *   - ETF/SME securities (looksLikeEtf filter)
 *   - CURATED_SIGNAL_UNIVERSE symbols (refreshed separately)
 *   - Symbols with existing ok store entry with today's sessionDate
 *     (INCREMENTAL logic — skip already-populated symbols on repeat runs)
 *
 * @param mode "initial" = all eligible; "incremental" = only missing/stale
 */
export async function getEligibleNseSymbols(
  mode: "initial" | "incremental" = "initial",
): Promise<{
  symbols: string[];
  totalEligible: number;
  excluded: number;
  curated: number;
  etfOrSme: number;
}> {
  const instruments = await centralKiteNseEqInstruments();
  if (!instruments) {
    return { symbols: [], totalEligible: 0, excluded: 0, curated: 0, etfOrSme: 0 };
  }

  const curatedSymbols = new Set(
    CURATED_SIGNAL_UNIVERSE
      .filter(u => !u.inactive && !INACTIVE_SYMBOLS.has(u.symbol.toUpperCase()))
      .map(u => u.symbol),
  );

  let etfOrSmeCount = 0;
  let curatedCount = 0;
  const eligibleSymbols: string[] = [];

  for (const [sym, inst] of instruments.bySymbol) {
    if (centralLooksLikeEtf(sym, inst.name)) { etfOrSmeCount++; continue; }
    if (curatedSymbols.has(sym)) { curatedCount++; continue; }
    eligibleSymbols.push(sym);
  }

  if (mode === "initial") {
    return {
      symbols: eligibleSymbols,
      totalEligible: eligibleSymbols.length,
      excluded: etfOrSmeCount,
      curated: curatedCount,
      etfOrSme: etfOrSmeCount,
    };
  }

  // INCREMENTAL: skip symbols already stored with a today's session date.
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const filtered = eligibleSymbols.filter(sym => {
    const entry = getKiteCandleSeries(sym);
    if (entry.status === "ok" && entry.sessionDate === today) return false;
    return true;
  });

  return {
    symbols: filtered,
    totalEligible: eligibleSymbols.length,
    excluded: etfOrSmeCount,
    curated: curatedCount,
    etfOrSme: etfOrSmeCount,
  };
}

// ─── Per-symbol fetch ─────────────────────────────────────────────────────────

async function fetchWarehouseEntry(sym: string): Promise<KiteCandleEntry> {
  await kiteHistoricalBucket.acquire();
  try {
    const chart = await centralEquityCandles(sym, "day", WAREHOUSE_HISTORY_DAYS);
    if (!chart) {
      return {
        symbol: sym, exchange: "NSE", timeframe: "day",
        sessionDate: null, barCount: 0, chart: null,
        fetchedAt: new Date(), status: "unavailable", errorCode: "KITE_OFFLINE",
      };
    }
    const barCount = chart.close.length;
    if (barCount < MIN_WAREHOUSE_BARS) {
      return {
        symbol: sym, exchange: "NSE", timeframe: "day",
        sessionDate: null, barCount, chart: null,
        fetchedAt: new Date(), status: "insufficient", errorCode: "INSUFFICIENT_HISTORY",
      };
    }
    const lastTs = chart.timestamps[chart.timestamps.length - 1];
    const sessionDate = lastTs
      ? new Date(lastTs * 1000 + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : null;
    return {
      symbol: sym, exchange: "NSE", timeframe: "day",
      sessionDate, barCount, chart,
      fetchedAt: new Date(), status: "ok", errorCode: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const is429 = msg.toLowerCase().includes("429") || msg.toLowerCase().includes("too many requests");
    if (is429) await kiteHistoricalBucket.reportRateLimit();
    return {
      symbol: sym, exchange: "NSE", timeframe: "day",
      sessionDate: null, barCount: 0, chart: null,
      fetchedAt: new Date(), status: "unavailable",
      errorCode: is429 ? "RATE_LIMIT_EXHAUSTED" : "FETCH_FAILED",
    };
  }
}

// ─── Main warehouse population run ───────────────────────────────────────────

export interface WarehouseRunResult {
  skipped?: boolean;
  skipReason?: string;
  mode: "initial" | "incremental";
  totalEligible: number;
  symbolsAttempted: number;
  successCount: number;
  failCount: number;
  insufficientCount: number;
  durationMs: number;
  kiteRequests: number;
}

/**
 * Run one warehouse population cycle for all eligible non-curated NSE EQ symbols.
 *
 * This function:
 *   1. Acquires a per-replica advisory lock (88_274_616) to prevent duplicate runs.
 *   2. Loads eligible symbols from the Kite instrument master.
 *   3. For each symbol, fetches daily candle history using the shared token bucket.
 *   4. Stores results in kite_candle_store (PostgreSQL + L1 memCache).
 *   5. Logs progress every 100 symbols so operator can monitor long backfills.
 *
 * Safe to call from multiple replicas — the loser skips without any Kite calls.
 * Never blocks the scanner API — call this inside a background setTimeout.
 */
export async function runFullNseWarehousePopulation(
  mode: "initial" | "incremental" = "incremental",
): Promise<WarehouseRunResult> {
  const empty: WarehouseRunResult = {
    mode, totalEligible: 0, symbolsAttempted: 0,
    successCount: 0, failCount: 0, insufficientCount: 0,
    durationMs: 0, kiteRequests: 0,
  };

  if (warehouseRunning) {
    return { ...empty, skipped: true, skipReason: "ALREADY_RUNNING" };
  }

  const locked = await tryAcquireWarehouseLock();
  if (!locked) {
    logger.info("fullNseWarehouse: refresh skipped — advisory lock held (another replica running)");
    return { ...empty, skipped: true, skipReason: "LOCK_HELD" };
  }

  warehouseRunning = true;
  const start = Date.now();
  let kiteRequests = 0;
  let successCount = 0;
  let failCount = 0;
  let insufficientCount = 0;

  try {
    const { symbols, totalEligible, excluded, curated, etfOrSme } =
      await getEligibleNseSymbols(mode);

    logger.info(
      {
        mode, totalEligible, excluded, curated, etfOrSme,
        symbolsToAttempt: symbols.length,
      },
      "fullNseWarehouse: population cycle started",
    );

    kiteHistoricalBucket.resetMetrics();
    const batches = chunk(symbols, WAREHOUSE_BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]!;

      await Promise.all(batch.map(async sym => {
        kiteRequests++;
        const entry = await fetchWarehouseEntry(sym);

        // Store in L1 + L2 via the public API.
        await storeKiteCandleEntry(entry);

        if (entry.status === "ok") successCount++;
        else if (entry.status === "insufficient") insufficientCount++;
        else failCount++;
      }));

      // Progress log every 100 symbols
      if ((batchIdx + 1) % Math.ceil(100 / WAREHOUSE_BATCH_SIZE) === 0) {
        const done = Math.min((batchIdx + 1) * WAREHOUSE_BATCH_SIZE, symbols.length);
        logger.info(
          {
            done, total: symbols.length, pct: Math.round(done / symbols.length * 100),
            successCount, failCount, insufficientCount, kiteRequests,
            elapsedMs: Date.now() - start,
            rlMetrics: kiteHistoricalBucket.metrics,
          },
          "fullNseWarehouse: progress",
        );
      }
    }

    const durationMs = Date.now() - start;
    lastWarehouseAt = new Date();
    lastWarehouseSuccessCount = successCount;
    lastWarehouseFailCount = failCount;
    lastWarehouseTotalSymbols = symbols.length;
    lastWarehouseDurationMs = durationMs;

    logger.info(
      {
        mode, totalEligible, symbolsAttempted: symbols.length,
        successCount, failCount, insufficientCount, kiteRequests, durationMs,
        rlMetrics: kiteHistoricalBucket.metrics,
      },
      "fullNseWarehouse: population cycle complete",
    );

    return {
      mode, totalEligible, symbolsAttempted: symbols.length,
      successCount, failCount, insufficientCount, durationMs, kiteRequests,
    };
  } finally {
    warehouseRunning = false;
    await releaseWarehouseLock();
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Start the background full-NSE warehouse population scheduler.
 *
 * Call once from initKiteCandleStore() after the curated store is initialized.
 * The first run uses "incremental" mode (only symbols not yet populated), so
 * it won't starve the curated refresh. Subsequent runs repeat every 24h.
 *
 * Never throws — any error is caught and logged; the scheduler always reschedules.
 */
export function initFullNseWarehouseScheduler(): void {
  if (warehouseTimer) return; // already started

  // Delay first run by 5 minutes after boot to let the curated refresh
  // run first and warm L1 from DB before the long warehouse cycle starts.
  const firstDelayMs = 5 * 60 * 1_000;

  warehouseTimer = setTimeout(async () => {
    try {
      // First run: incremental (skip symbols already in store with today's date)
      await runFullNseWarehousePopulation("incremental");
    } catch (err) {
      logger.warn({ err }, "fullNseWarehouse: first population cycle failed");
    } finally {
      // Subsequent runs: incremental every 24h
      scheduleNextWarehouseRun();
    }
  }, firstDelayMs);

  logger.info(
    { firstDelayMs, intervalMs: WAREHOUSE_CYCLE_INTERVAL_MS },
    "fullNseWarehouse: scheduler started",
  );
}

function scheduleNextWarehouseRun(): void {
  warehouseTimer = setTimeout(async () => {
    try {
      await runFullNseWarehousePopulation("incremental");
    } catch (err) {
      logger.warn({ err }, "fullNseWarehouse: scheduled population cycle failed");
    } finally {
      scheduleNextWarehouseRun();
    }
  }, WAREHOUSE_CYCLE_INTERVAL_MS);
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface FullNseWarehouseMetrics {
  warehouseRunning: boolean;
  lastWarehouseAt: string | null;
  lastWarehouseSuccessCount: number | null;
  lastWarehouseFailCount: number | null;
  lastWarehouseTotalSymbols: number | null;
  lastWarehouseDurationMs: number | null;
  lockKey: number;
}

export function getFullNseWarehouseMetrics(): FullNseWarehouseMetrics {
  return {
    warehouseRunning,
    lastWarehouseAt: lastWarehouseAt?.toISOString() ?? null,
    lastWarehouseSuccessCount,
    lastWarehouseFailCount,
    lastWarehouseTotalSymbols,
    lastWarehouseDurationMs,
    lockKey: FULL_NSE_WAREHOUSE_LOCK_KEY,
  };
}

/** Exported for unit tests only. */
export const _warehouseTestOnly = {
  reset(): void {
    warehouseRunning = false;
    if (warehouseTimer) { clearTimeout(warehouseTimer); warehouseTimer = null; }
    lastWarehouseAt = null;
    lastWarehouseSuccessCount = null;
    lastWarehouseFailCount = null;
    lastWarehouseTotalSymbols = null;
    lastWarehouseDurationMs = null;
  },
  isRunning(): boolean { return warehouseRunning; },
  getLastAt(): Date | null { return lastWarehouseAt; },
};
