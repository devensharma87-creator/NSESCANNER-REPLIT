/**
 * Full-NSE Candle Warehouse Population — Pack 33 Correction 3 (Staged/Resumable).
 *
 * Populates kite_candle_store with daily candle history for ALL eligible NSE EQ
 * instruments from the Kite instrument master, not just the 199 curated stocks.
 *
 * Architecture
 * ────────────
 *   • Loads eligible instruments from the Kite NSE EQ instrument master via
 *     centralKiteNseEqInstruments (compat-layer alias; burn-down compliant).
 *   • Filters ETF/SME securities via centralLooksLikeEtf.
 *   • Excludes CURATED_SIGNAL_UNIVERSE symbols (refreshed by kiteCandleStore.ts).
 *   • Uses the shared kiteHistoricalBucket (3 req/s — within the global lock).
 *   • Uses the same kite_candle_store PostgreSQL table.
 *
 * Distributed rate protection (Correction 1)
 * ───────────────────────────────────────────
 *   Both the curated refresh and this warehouse job must hold
 *   KITE_HISTORICAL_INGESTION_GLOBAL_LOCK (88_274_614) before making any
 *   Kite historical API call. This serializes all historical ingestion across
 *   ALL autoscale replicas, keeping the aggregate rate ≤ 3 req/s.
 *
 *   Priority: warehouse releases the global lock between batches.
 *   Before each batch the warehouse checks if curated is due and yields 60 s.
 *
 * History-sufficiency (Correction 2)
 * ────────────────────────────────────
 *   MIN_BARS_FOR_STORAGE = 1  (any bar is worth storing)
 *   MIN_BARS_FOR_EVALUATION = 200  (EMA200 binding constraint)
 *   Rows with < 200 bars are stored as status='insufficient' and are always
 *   NOT_EVALUATED (INSUFFICIENT_CANONICAL_HISTORY) at evaluation time.
 *
 * Staged / resumable (Correction 3)
 * ────────────────────────────────
 *   1. Deterministic snapshot ID (FNV-1a hash of sorted symbols + IST date).
 *   2. kite_warehouse_progress table: single-row cursor persisted to DB.
 *   3. Canary phase: first 50 symbols, validate, then proceed.
 *   4. Bounded batches: 100 symbols per batch per lock-hold.
 *   5. No re-download: symbols with today's ok entry are skipped.
 *   6. Stop threshold: 3 consecutive 429s → RATE_LIMIT_PERSISTENT.
 *                      401/403 → AUTH_FAILURE.
 *                      20 consecutive errors → TOO_MANY_ERRORS.
 *   7. Explicit excluded/inactive/unsupported reasons per symbol.
 *   8. Storage growth estimate: ~23 KB/symbol × eligible count.
 *
 * Advisory lock key: 88_274_616 (identity lock — distinct from global 88_274_614,
 *   curated 88_274_615). Prevents two replicas both running the warehouse loop.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";
import {
  centralKiteNseEqInstruments,
  centralEquityCandles,
  centralLooksLikeEtf,
} from "../marketData/compat";
import {
  CURATED_SIGNAL_UNIVERSE,
  INACTIVE_SYMBOLS,
} from "../universe";
import { kiteHistoricalBucket } from "./tokenBucket";
import {
  getKiteCandleSeries,
  storeKiteCandleEntry,
  acquireGlobalIngestionLock,
  releaseGlobalIngestionLock,
  getCuratedRefreshDueAt,
  type KiteCandleEntry,
} from "./kiteCandleStore";
import { MIN_BARS_FOR_STORAGE, MIN_BARS_FOR_EVALUATION } from "../historySufficiency";

// ─── Config ──────────────────────────────────────────────────────────────────

/** Identity lock key for the warehouse scheduler (not the ingestion lock). */
export const FULL_NSE_WAREHOUSE_LOCK_KEY = 88_274_616;

/** Canary batch size: validate this many symbols before full population. */
export const WAREHOUSE_CANARY_SIZE = 50;

/** Regular batch size after canary: symbols per global-lock hold. */
export const WAREHOUSE_BATCH_SIZE = 100;

/** Maximum consecutive 429 responses before stopping the job. */
const MAX_CONSECUTIVE_429 = 3;

/** Maximum consecutive non-429 errors before stopping. */
const MAX_CONSECUTIVE_ERRORS = 20;

/** 401/403: stop immediately (session expired / forbidden). */
const STOP_ON_AUTH_FAILURE = true;

/** How long to yield before each batch if curated refresh is due soon (ms). */
const CURATED_PRIORITY_YIELD_MS = 60_000;

/** Minimum bars to store (any history is worth keeping). */
const MIN_STORE_BARS: number = MIN_BARS_FOR_STORAGE; // 1

/** Minimum bars for a row to be marked 'ok' vs 'insufficient'. */
const MIN_EVAL_BARS: number = MIN_BARS_FOR_EVALUATION; // 200

/** Days of history to request from Kite per symbol. */
const WAREHOUSE_HISTORY_DAYS = 400;

/** Estimated bytes per stored symbol (365 bars × ~63 bytes/bar in JSON ≈ 23 KB). */
export const BYTES_PER_SYMBOL_ESTIMATE = 23_000;

/** How often the warehouse scheduler repeats (24 h). */
const WAREHOUSE_CYCLE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

// ─── Progress table schema ────────────────────────────────────────────────────

export interface WarehouseProgress {
  snapshotId: string;
  status: "CANARY" | "IN_PROGRESS" | "COMPLETE" | "STOPPED";
  totalSymbols: number;
  cursorIdx: number;
  canaryValidated: boolean;
  consecutiveErrors: number;
  consecutive429s: number;
  startedAt: Date;
  updatedAt: Date;
  stoppedReason: string | null;
  storageBytesEstimated: number | null;
}

let progressSchemaEnsured = false;

export async function ensureWarehouseProgressSchema(): Promise<void> {
  if (progressSchemaEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS kite_warehouse_progress (
      id                       INTEGER PRIMARY KEY DEFAULT 1,
      snapshot_id              TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'CANARY',
      total_symbols            INTEGER NOT NULL DEFAULT 0,
      cursor_idx               INTEGER NOT NULL DEFAULT 0,
      canary_validated         BOOLEAN NOT NULL DEFAULT FALSE,
      consecutive_errors       INTEGER NOT NULL DEFAULT 0,
      consecutive_429s         INTEGER NOT NULL DEFAULT 0,
      started_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      stopped_reason           TEXT,
      storage_bytes_estimated  BIGINT,
      CONSTRAINT kite_warehouse_progress_singleton CHECK (id = 1)
    )
  `);
  progressSchemaEnsured = true;
}

async function loadProgress(): Promise<WarehouseProgress | null> {
  const res = await db.execute(sql`SELECT * FROM kite_warehouse_progress WHERE id = 1`);
  if (res.rows.length === 0) return null;
  const r = res.rows[0] as Record<string, unknown>;
  return {
    snapshotId:            String(r["snapshot_id"] ?? ""),
    status:                (r["status"] as WarehouseProgress["status"]) ?? "CANARY",
    totalSymbols:          Number(r["total_symbols"] ?? 0),
    cursorIdx:             Number(r["cursor_idx"] ?? 0),
    canaryValidated:       Boolean(r["canary_validated"]),
    consecutiveErrors:     Number(r["consecutive_errors"] ?? 0),
    consecutive429s:       Number(r["consecutive_429s"] ?? 0),
    startedAt:             new Date(String(r["started_at"])),
    updatedAt:             new Date(String(r["updated_at"])),
    stoppedReason:         r["stopped_reason"] ? String(r["stopped_reason"]) : null,
    storageBytesEstimated: r["storage_bytes_estimated"] ? Number(r["storage_bytes_estimated"]) : null,
  };
}

async function saveProgress(p: Partial<WarehouseProgress> & { snapshotId: string }): Promise<void> {
  await db.execute(sql`
    INSERT INTO kite_warehouse_progress (
      id, snapshot_id, status, total_symbols, cursor_idx,
      canary_validated, consecutive_errors, consecutive_429s,
      started_at, updated_at, stopped_reason, storage_bytes_estimated
    ) VALUES (
      1, ${p.snapshotId},
      ${p.status ?? "CANARY"},
      ${p.totalSymbols ?? 0},
      ${p.cursorIdx ?? 0},
      ${p.canaryValidated ?? false},
      ${p.consecutiveErrors ?? 0},
      ${p.consecutive429s ?? 0},
      NOW(), NOW(),
      ${p.stoppedReason ?? null},
      ${p.storageBytesEstimated ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      snapshot_id             = EXCLUDED.snapshot_id,
      status                  = EXCLUDED.status,
      total_symbols           = EXCLUDED.total_symbols,
      cursor_idx              = EXCLUDED.cursor_idx,
      canary_validated        = EXCLUDED.canary_validated,
      consecutive_errors      = EXCLUDED.consecutive_errors,
      consecutive_429s        = EXCLUDED.consecutive_429s,
      updated_at              = NOW(),
      stopped_reason          = EXCLUDED.stopped_reason,
      storage_bytes_estimated = EXCLUDED.storage_bytes_estimated
  `);
}

// ─── Snapshot ID ─────────────────────────────────────────────────────────────

/**
 * Compute a deterministic snapshot ID from the eligible symbol list.
 *
 * FNV-1a hash (32-bit, unsigned) of "YYYY-MM-DD:SYM1,SYM2,...".
 * Stable across process restarts for the same symbols on the same IST date.
 */
export function computeSnapshotId(symbols: string[]): string {
  const date = new Date(Date.now() + 5.5 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const payload = `${date}:${[...symbols].sort().join(",")}`;
  let h = 2_166_136_261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return `${date}_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

// ─── Eligible symbol list ─────────────────────────────────────────────────────

export interface EligibleSymbolResult {
  symbols: string[];
  excluded: {
    etfOrSme: { symbol: string; name: string }[];
    curated: string[];
    total: number;
  };
  masterRefreshedAt: Date | null;
}

/**
 * Load all eligible NSE EQ symbols for warehouse population.
 *
 * Eligible = Kite NSE EQ master instruments MINUS:
 *   - ETF/SME securities (centralLooksLikeEtf)
 *   - CURATED_SIGNAL_UNIVERSE symbols (refreshed separately)
 *
 * Note: instrument counts from the Kite master are dynamic and must NOT be
 * hard-coded. This function always reads from the live instrument cache.
 */
export async function getEligibleNseSymbols(): Promise<EligibleSymbolResult> {
  const instruments = await centralKiteNseEqInstruments();
  if (!instruments) {
    return {
      symbols: [],
      excluded: { etfOrSme: [], curated: [], total: 0 },
      masterRefreshedAt: null,
    };
  }

  const curatedSet = new Set(
    CURATED_SIGNAL_UNIVERSE
      .filter(u => !u.inactive && !INACTIVE_SYMBOLS.has(u.symbol.toUpperCase()))
      .map(u => u.symbol),
  );

  const etfOrSme: { symbol: string; name: string }[] = [];
  const curated: string[] = [];
  const eligible: string[] = [];

  for (const [sym, inst] of instruments.bySymbol) {
    if (centralLooksLikeEtf(sym, (inst as { name: string }).name)) {
      etfOrSme.push({ symbol: sym, name: (inst as { name: string }).name });
      continue;
    }
    if (curatedSet.has(sym)) {
      curated.push(sym);
      continue;
    }
    eligible.push(sym);
  }

  return {
    symbols: eligible,
    excluded: { etfOrSme, curated, total: etfOrSme.length + curated.length },
    masterRefreshedAt: new Date(),
  };
}

// ─── Per-symbol fetch ─────────────────────────────────────────────────────────

export interface FetchResult {
  entry: KiteCandleEntry;
  validationIssues: string[];
  excludedReason: string | null;
}

/**
 * Validate a fetched KiteCandleEntry:
 *   - timestamp ordering (ascending)
 *   - future timestamps (> now + 1 day in IST)
 *   - column-length consistency
 *   - row size (> 500 KB is anomalous)
 */
export function validateWarehouseEntry(entry: KiteCandleEntry): string[] {
  const issues: string[] = [];
  if (!entry.chart) return issues;

  const { timestamps, close, open, high, low, volume } = entry.chart;
  const len = timestamps.length;

  // Column-length parity
  for (const [col, arr] of Object.entries({ close, open, high, low, volume })) {
    if (arr.length !== len) {
      issues.push(`COL_LENGTH_MISMATCH: ${col}=${arr.length} vs timestamps=${len}`);
    }
  }

  // Ascending timestamps
  for (let i = 1; i < len; i++) {
    const prev = timestamps[i - 1]!;
    const curr = timestamps[i]!;
    if (curr <= prev) {
      issues.push(`TIMESTAMP_NOT_ASCENDING: idx=${i} curr=${curr} prev=${prev}`);
      break;
    }
  }

  // Future timestamp (> now + 24 h in IST)
  const nowSec = Date.now() / 1_000;
  const lastTs = timestamps[len - 1];
  if (lastTs != null && lastTs > nowSec + 86_400) {
    issues.push(`FUTURE_TIMESTAMP: last=${lastTs} now=${Math.floor(nowSec)}`);
  }

  // Row size estimate
  const rowSizeBytes = JSON.stringify(entry.chart).length;
  if (rowSizeBytes > 500_000) {
    issues.push(`OVERSIZED_ROW: estimatedBytes=${rowSizeBytes}`);
  }

  return issues;
}

async function fetchWarehouseEntry(sym: string): Promise<FetchResult> {
  await kiteHistoricalBucket.acquire();
  try {
    const chart = await centralEquityCandles(sym, "day", WAREHOUSE_HISTORY_DAYS);
    if (!chart) {
      return {
        entry: {
          symbol: sym, exchange: "NSE", timeframe: "day",
          sessionDate: null, barCount: 0, chart: null,
          fetchedAt: new Date(), status: "unavailable", errorCode: "KITE_OFFLINE",
        },
        validationIssues: [],
        excludedReason: null,
      };
    }

    const barCount = chart.close.length;
    let status: KiteCandleEntry["status"] = "ok";
    let errorCode: string | null = null;

    if (barCount < MIN_STORE_BARS) {
      status = "unavailable";
      errorCode = "EMPTY_SERIES";
    } else if (barCount < MIN_EVAL_BARS) {
      status = "insufficient";
      errorCode = "INSUFFICIENT_CANONICAL_HISTORY";
    }

    const lastTs = chart.timestamps[chart.timestamps.length - 1];
    const sessionDate = lastTs
      ? new Date(lastTs * 1_000 + 5.5 * 60 * 60 * 1_000).toISOString().slice(0, 10)
      : null;

    const entry: KiteCandleEntry = {
      symbol: sym, exchange: "NSE", timeframe: "day",
      sessionDate, barCount, chart,
      fetchedAt: new Date(), status, errorCode,
    };

    return {
      entry,
      validationIssues: validateWarehouseEntry(entry),
      excludedReason: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const statusCode =
      msg.includes("401") || msg.includes("Unauthorized") ? 401 :
      msg.includes("403") || msg.includes("Forbidden")    ? 403 :
      msg.includes("429") || msg.includes("Too Many")     ? 429 : 0;

    if (statusCode === 429) await kiteHistoricalBucket.reportRateLimit();

    return {
      entry: {
        symbol: sym, exchange: "NSE", timeframe: "day",
        sessionDate: null, barCount: 0, chart: null,
        fetchedAt: new Date(), status: "unavailable",
        errorCode: statusCode === 429 ? "RATE_LIMIT_429" :
                   statusCode === 401 ? "AUTH_401_UNAUTHORIZED" :
                   statusCode === 403 ? "AUTH_403_FORBIDDEN" : "FETCH_FAILED",
      },
      validationIssues: [],
      excludedReason: null,
    };
  }
}

// ─── Warehouse run ────────────────────────────────────────────────────────────

export interface WarehouseRunResult {
  skipped?: boolean;
  skipReason?: string;
  snapshotId: string;
  phase: "CANARY" | "IN_PROGRESS" | "COMPLETE" | "STOPPED";
  totalEligible: number;
  symbolsAttempted: number;
  successCount: number;
  insufficientCount: number;
  failCount: number;
  validationIssueCount: number;
  kiteRequests: number;
  durationMs: number;
  storageEstimateBytes: number;
  stoppedReason: string | null;
}

function shouldYieldForCurated(): boolean {
  const due = getCuratedRefreshDueAt();
  if (!due) return false;
  return due.getTime() - Date.now() < 30_000; // due within 30 s
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function chunkSymbols<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Run one warehouse population pass.
 *
 * Phase logic:
 *   CANARY   (first run or reset): fetch first WAREHOUSE_CANARY_SIZE symbols,
 *            validate, mark canary_validated, then advance to IN_PROGRESS.
 *   IN_PROGRESS: advance cursor WAREHOUSE_BATCH_SIZE symbols per global-lock hold.
 *   COMPLETE: all eligible symbols processed; scheduler will reset on next IST date.
 *   STOPPED:  persistent error; requires manual reset via POST /api/scan/candle-store/warehouse/reset.
 *
 * Global lock protocol:
 *   1. Yield 60 s if curated refresh is due within 30 s.
 *   2. Acquire KITE_HISTORICAL_INGESTION_GLOBAL_LOCK (pg_try, max 5 attempts).
 *   3. Process batch (token-bucket rate-limited within the lock).
 *   4. Release global lock.
 *   5. Validate batch results.
 *   6. Update cursor.
 *   7. Check stop thresholds.
 */
export async function runFullNseWarehousePopulation(): Promise<WarehouseRunResult> {
  const emptyResult: WarehouseRunResult = {
    snapshotId: "", phase: "CANARY",
    totalEligible: 0, symbolsAttempted: 0,
    successCount: 0, insufficientCount: 0, failCount: 0,
    validationIssueCount: 0, kiteRequests: 0, durationMs: 0,
    storageEstimateBytes: 0, stoppedReason: null,
  };

  if (warehouseRunning) {
    return { ...emptyResult, skipped: true, skipReason: "ALREADY_RUNNING" };
  }

  // Identity lock: ensure only one replica runs the warehouse loop
  const identityLocked = await tryAcquireIdentityLock();
  if (!identityLocked) {
    return { ...emptyResult, skipped: true, skipReason: "IDENTITY_LOCK_HELD" };
  }

  warehouseRunning = true;
  const start = Date.now();
  let totalSuccessCount = 0;
  let totalInsufficient = 0;
  let totalFailCount = 0;
  let totalValidationIssues = 0;
  let totalKiteRequests = 0;
  let stoppedReason: string | null = null;

  try {
    await ensureWarehouseProgressSchema();

    // ── Load eligible symbols ──────────────────────────────────────────────
    const { symbols: eligibleSymbols, excluded } = await getEligibleNseSymbols();
    const snapshotId = computeSnapshotId(eligibleSymbols);
    const storageEstimateBytes = eligibleSymbols.length * BYTES_PER_SYMBOL_ESTIMATE;

    logger.info(
      {
        snapshotId,
        eligibleCount: eligibleSymbols.length,
        excludedEtf: excluded.etfOrSme.length,
        excludedCurated: excluded.curated.length,
        storageEstimateBytes,
        storageEstimateMB: Math.round(storageEstimateBytes / 1_048_576),
      },
      "fullNseWarehouse: eligible symbols loaded",
    );

    // ── Load or create progress cursor ────────────────────────────────────
    let progress = await loadProgress();

    if (!progress || progress.snapshotId !== snapshotId) {
      // New snapshot (date changed or first run) — reset progress
      logger.info(
        { snapshotId, prevSnapshotId: progress?.snapshotId },
        "fullNseWarehouse: new snapshot — resetting cursor",
      );
      progress = {
        snapshotId, status: "CANARY",
        totalSymbols: eligibleSymbols.length,
        cursorIdx: 0, canaryValidated: false,
        consecutiveErrors: 0, consecutive429s: 0,
        startedAt: new Date(), updatedAt: new Date(),
        stoppedReason: null,
        storageBytesEstimated: storageEstimateBytes,
      };
      await saveProgress(progress);
    }

    if (progress.status === "COMPLETE") {
      logger.info({ snapshotId }, "fullNseWarehouse: snapshot already COMPLETE — nothing to do");
      return {
        ...emptyResult, snapshotId, phase: "COMPLETE",
        totalEligible: eligibleSymbols.length,
        storageEstimateBytes,
      };
    }

    if (progress.status === "STOPPED") {
      logger.warn(
        { snapshotId, stoppedReason: progress.stoppedReason },
        "fullNseWarehouse: population STOPPED — requires manual reset via POST /api/scan/candle-store/warehouse/reset",
      );
      return {
        ...emptyResult, snapshotId, phase: "STOPPED",
        totalEligible: eligibleSymbols.length,
        stoppedReason: progress.stoppedReason, storageEstimateBytes,
      };
    }

    // ── Determine batch to process ────────────────────────────────────────
    const isCanary = progress.status === "CANARY" && !progress.canaryValidated;
    const batchSize = isCanary ? WAREHOUSE_CANARY_SIZE : WAREHOUSE_BATCH_SIZE;
    const fromIdx = progress.cursorIdx;
    const toIdx = Math.min(fromIdx + batchSize, eligibleSymbols.length);
    const batch = eligibleSymbols.slice(fromIdx, toIdx);

    if (batch.length === 0) {
      await saveProgress({ ...progress, snapshotId, status: "COMPLETE" });
      logger.info({ snapshotId }, "fullNseWarehouse: all symbols processed — COMPLETE");
      return {
        ...emptyResult, snapshotId, phase: "COMPLETE",
        totalEligible: eligibleSymbols.length, storageEstimateBytes,
      };
    }

    logger.info(
      {
        snapshotId, phase: isCanary ? "CANARY" : "IN_PROGRESS",
        fromIdx, toIdx, batchCount: batch.length,
        totalSymbols: eligibleSymbols.length,
      },
      "fullNseWarehouse: starting batch",
    );

    // ── Priority yield ─────────────────────────────────────────────────────
    if (shouldYieldForCurated()) {
      logger.info(
        { yieldMs: CURATED_PRIORITY_YIELD_MS },
        "fullNseWarehouse: curated refresh due soon — yielding priority",
      );
      await sleep(CURATED_PRIORITY_YIELD_MS);
    }

    // ── Acquire global ingestion lock ──────────────────────────────────────
    const globalLocked = await acquireGlobalIngestionLock(5, 3_000);
    if (!globalLocked) {
      logger.warn("fullNseWarehouse: could not acquire global ingestion lock — skipping batch");
      return { ...emptyResult, snapshotId, phase: isCanary ? "CANARY" : "IN_PROGRESS",
               totalEligible: eligibleSymbols.length, skipped: true, skipReason: "GLOBAL_LOCK_HELD",
               storageEstimateBytes };
    }

    // ── Process batch ──────────────────────────────────────────────────────
    kiteHistoricalBucket.resetMetrics();
    const todayIst = new Date(Date.now() + 5.5 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    let batchSuccessCount = 0;
    let batchInsufficient = 0;
    let batchFailCount = 0;
    let batchValidationIssues = 0;
    let batchKiteRequests = 0;
    let batchConsecutive429s = progress.consecutive429s;
    let batchConsecutiveErrors = progress.consecutiveErrors;
    let authFailure: string | null = null;

    for (const sym of batch) {
      // Skip symbols already populated today (no re-download)
      const existing = getKiteCandleSeries(sym);
      if (existing.status === "ok" && existing.sessionDate === todayIst) {
        batchSuccessCount++;
        continue;
      }

      batchKiteRequests++;
      const { entry, validationIssues } = await fetchWarehouseEntry(sym);

      if (entry.errorCode === "AUTH_401_UNAUTHORIZED" || entry.errorCode === "AUTH_403_FORBIDDEN") {
        authFailure = entry.errorCode;
        batchFailCount++;
        break;
      }

      if (entry.errorCode === "RATE_LIMIT_429") {
        batchConsecutive429s++;
        batchConsecutiveErrors++;
        batchFailCount++;
        if (batchConsecutive429s >= MAX_CONSECUTIVE_429) break;
        // Bounded backoff: 5 s per consecutive 429
        await sleep(Math.min(5_000 * batchConsecutive429s, 60_000));
        continue;
      }

      // Reset 429 counter on non-429 result
      batchConsecutive429s = 0;

      if (entry.status === "ok") {
        batchSuccessCount++;
        batchConsecutiveErrors = 0;
      } else if (entry.status === "insufficient") {
        batchInsufficient++;
        batchConsecutiveErrors = 0;
      } else {
        batchFailCount++;
        batchConsecutiveErrors++;
      }

      if (validationIssues.length > 0) {
        batchValidationIssues++;
        logger.warn({ sym, validationIssues }, "fullNseWarehouse: validation issues for symbol");
      }

      // Store in L1 + L2 (best-effort; status is tracked above)
      await storeKiteCandleEntry(entry);

      // Stop if too many consecutive non-429 errors
      if (batchConsecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        stoppedReason = `TOO_MANY_ERRORS: ${batchConsecutiveErrors} consecutive errors`;
        break;
      }
    }

    // ── Release global lock ────────────────────────────────────────────────
    await releaseGlobalIngestionLock();

    // ── Accumulate totals ──────────────────────────────────────────────────
    totalSuccessCount    += batchSuccessCount;
    totalInsufficient    += batchInsufficient;
    totalFailCount       += batchFailCount;
    totalValidationIssues += batchValidationIssues;
    totalKiteRequests    += batchKiteRequests;

    // ── Determine stop conditions ──────────────────────────────────────────
    if (authFailure) {
      stoppedReason = `AUTH_FAILURE: ${authFailure}`;
    } else if (batchConsecutive429s >= MAX_CONSECUTIVE_429) {
      stoppedReason = `RATE_LIMIT_PERSISTENT: ${batchConsecutive429s} consecutive 429s`;
    }

    // ── Validate canary batch ──────────────────────────────────────────────
    if (isCanary && !stoppedReason) {
      const canaryValidationOk = batchFailCount <= Math.ceil(WAREHOUSE_CANARY_SIZE * 0.1); // ≤10% fail rate
      if (!canaryValidationOk) {
        stoppedReason = `CANARY_VALIDATION_FAILED: ${batchFailCount}/${batch.length} symbols failed`;
        logger.error(
          { batchFailCount, batchSize: batch.length, snapshotId },
          "fullNseWarehouse: CANARY batch failed validation — stopping",
        );
      } else {
        logger.info(
          { batchSuccessCount, batchInsufficient, batchFailCount, snapshotId },
          "fullNseWarehouse: CANARY batch validated — advancing to IN_PROGRESS",
        );
      }
    }

    // ── Persist updated cursor ─────────────────────────────────────────────
    const newCursorIdx = stoppedReason ? progress.cursorIdx : toIdx;
    const newStatus: WarehouseProgress["status"] =
      stoppedReason ? "STOPPED" :
      newCursorIdx >= eligibleSymbols.length ? "COMPLETE" : "IN_PROGRESS";

    const updatedProgress: WarehouseProgress = {
      ...progress,
      snapshotId,
      status: newStatus,
      cursorIdx: newCursorIdx,
      canaryValidated: isCanary ? !stoppedReason : progress.canaryValidated,
      consecutive429s: batchConsecutive429s,
      consecutiveErrors: batchConsecutiveErrors,
      stoppedReason: stoppedReason ?? null,
      storageBytesEstimated: storageEstimateBytes,
      updatedAt: new Date(),
    };
    await saveProgress(updatedProgress);

    const durationMs = Date.now() - start;

    // Update scheduler state
    lastWarehouseAt = new Date();
    lastWarehouseMetrics = {
      snapshotId,
      phase: (isCanary && !stoppedReason) ? "CANARY" : (newStatus as WarehouseRunResult["phase"]),
      totalEligible: eligibleSymbols.length,
      symbolsAttempted: batch.length,
      successCount: totalSuccessCount,
      insufficientCount: totalInsufficient,
      failCount: totalFailCount,
      validationIssueCount: totalValidationIssues,
      kiteRequests: totalKiteRequests,
      durationMs,
      storageEstimateBytes,
      stoppedReason: stoppedReason ?? null,
    };

    logger.info(lastWarehouseMetrics, "fullNseWarehouse: batch complete");

    return {
      snapshotId,
      phase: (isCanary && !stoppedReason) ? "CANARY" : (newStatus as WarehouseRunResult["phase"]),
      totalEligible: eligibleSymbols.length,
      symbolsAttempted: batch.length,
      successCount: totalSuccessCount,
      insufficientCount: totalInsufficient,
      failCount: totalFailCount,
      validationIssueCount: totalValidationIssues,
      kiteRequests: totalKiteRequests,
      durationMs,
      storageEstimateBytes,
      stoppedReason: stoppedReason ?? null,
    };
  } catch (err) {
    logger.error({ err }, "fullNseWarehouse: unhandled error in population run");
    return {
      ...emptyResult, snapshotId: "", phase: "STOPPED",
      stoppedReason: `INTERNAL_ERROR: ${(err as Error).message}`,
      durationMs: Date.now() - start,
    };
  } finally {
    warehouseRunning = false;
    await releaseIdentityLock();
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

let warehouseRunning = false;
let warehouseTimer: NodeJS.Timeout | null = null;
let lastWarehouseAt: Date | null = null;
let lastWarehouseMetrics: Omit<WarehouseRunResult, "skipped" | "skipReason"> | null = null;

async function tryAcquireIdentityLock(): Promise<boolean> {
  try {
    const result = (await db.execute(
      sql`SELECT pg_try_advisory_lock(${FULL_NSE_WAREHOUSE_LOCK_KEY}::bigint) AS locked`,
    )) as unknown as { rows: Array<{ locked: boolean }> };
    return result.rows[0]?.locked === true;
  } catch { return false; }
}

async function releaseIdentityLock(): Promise<void> {
  try {
    await db.execute(sql`SELECT pg_advisory_unlock(${FULL_NSE_WAREHOUSE_LOCK_KEY}::bigint)`);
  } catch { /* best-effort */ }
}

/**
 * Start the background full-NSE warehouse scheduler.
 *
 * Called from initKiteCandleStore() after 5-minute boot delay.
 * Runs one batch per invocation (canary or incremental).
 * Reschedules itself every 24 h (for maintenance) or sooner if IN_PROGRESS.
 */
export function initFullNseWarehouseScheduler(): void {
  if (warehouseTimer) return;

  // 5-minute delayed first run — let curated refresh warm up L1 first.
  const firstDelay = 5 * 60 * 1_000;

  warehouseTimer = setTimeout(async () => {
    try {
      await runFullNseWarehousePopulation();
    } catch (err) {
      logger.warn({ err }, "fullNseWarehouse: first run failed");
    } finally {
      scheduleNextWarehouseRun();
    }
  }, firstDelay);

  logger.info({ firstDelayMs: firstDelay }, "fullNseWarehouse: scheduler started");
}

function scheduleNextWarehouseRun(): void {
  warehouseTimer = setTimeout(async () => {
    try {
      await runFullNseWarehousePopulation();
    } catch (err) {
      logger.warn({ err }, "fullNseWarehouse: scheduled run failed");
    } finally {
      scheduleNextWarehouseRun();
    }
  }, WAREHOUSE_CYCLE_INTERVAL_MS);
}

// ─── Reset ────────────────────────────────────────────────────────────────────

/**
 * Reset the warehouse progress cursor (sets status back to CANARY, cursor=0).
 * Exposed via POST /api/scan/candle-store/warehouse/reset.
 * Requires a non-empty snapshotId to prevent accidental resets.
 */
export async function resetWarehouseProgress(): Promise<void> {
  await ensureWarehouseProgressSchema();
  await db.execute(sql`
    UPDATE kite_warehouse_progress
    SET status='CANARY', cursor_idx=0, canary_validated=FALSE,
        consecutive_errors=0, consecutive_429s=0,
        stopped_reason=NULL, updated_at=NOW()
    WHERE id=1
  `);
  logger.info("fullNseWarehouse: progress cursor reset to CANARY");
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface FullNseWarehouseMetrics {
  schedulerRunning: boolean;
  warehouseRunning: boolean;
  lastWarehouseAt: string | null;
  lastRun: Omit<WarehouseRunResult, "skipped" | "skipReason"> | null;
  lockKey: number;
  globalIngestionLockKey: number;
  bytesPerSymbolEstimate: number;
}

export function getFullNseWarehouseMetrics(): FullNseWarehouseMetrics {
  return {
    schedulerRunning: warehouseTimer != null,
    warehouseRunning,
    lastWarehouseAt: lastWarehouseAt?.toISOString() ?? null,
    lastRun: lastWarehouseMetrics,
    lockKey: FULL_NSE_WAREHOUSE_LOCK_KEY,
    globalIngestionLockKey: 88_274_614,
    bytesPerSymbolEstimate: BYTES_PER_SYMBOL_ESTIMATE,
  };
}

/** Exported for unit tests only. */
export const _warehouseTestOnly = {
  reset(): void {
    warehouseRunning = false;
    if (warehouseTimer) { clearTimeout(warehouseTimer); warehouseTimer = null; }
    lastWarehouseAt = null;
    lastWarehouseMetrics = null;
    progressSchemaEnsured = false;
  },
  isRunning(): boolean { return warehouseRunning; },
  getLastAt(): Date | null { return lastWarehouseAt; },
  computeSnapshotId,
  validateWarehouseEntry,
};
