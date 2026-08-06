/**
 * Option-chain snapshot ingestor (Priority 3 — write-only data layer).
 *
 * Periodically pulls option chains for the active F&O index universe
 * (NIFTY / BANKNIFTY / SENSEX — same set as `OPTION_INDICES` in
 * `optionSignals.ts` and `FNO_INDICES` in `oiLab.ts`) and persists
 * one row per (underlying, expiry, strike, side, captured_at) to
 * `option_chain_snapshot`. One run-summary row per cycle to
 * `option_chain_snapshot_run`.
 *
 * **Strict scope guarantees:**
 *   - Read path only from `fetchOptionChain()` — does NOT touch the
 *     F&O signal pipeline, paper-trader, scoring, Kite order placement,
 *     swing scanner, or the OI-Lab in-memory tracker.
 *   - Write path only inserts into the two new snapshot tables.
 *   - Nothing in this module is consumed by any trading decision.
 *
 * Pack 9A hardening additions:
 *   - Circuit-breaker: after CIRCUIT_BREAKER_THRESHOLD consecutive full
 *     failures, ticks are skipped for CIRCUIT_RESET_MINUTES. Resets on any
 *     partial success.
 *   - Alert deduplication: owner alerts fire at most once per
 *     ALERT_COOLDOWN_MINUTES on failure, once on recovery. No per-tick noise.
 *   - Advisory lock: pg_try_advisory_lock prevents duplicate concurrent ticks
 *     in multi-replica deployments (idempotent — single-replica has no cost).
 *   - Tick timeout: tick is abandoned after TICK_TIMEOUT_MS.
 *   - Schema fields: lot_size, market_status, schema_version='v1',
 *     canary_marker are populated on every row.
 *   - Archive-before-delete: runRetentionSweep is fail-closed — it refuses
 *     deletion when OPTION_SNAPSHOT_ARCHIVE_PATH is not configured.
 *
 * Configuration (env, with safe defaults):
 *   - `OPTION_SNAPSHOT_ENABLED`          — explicit override
 *                                          ("1"/"true"/"yes"/"on" → on,
 *                                          anything else → off; if unset,
 *                                          auto-detect: enabled iff
 *                                          `REPLIT_DEPLOYMENT === "1"`).
 *   - `OPTION_SNAPSHOT_INTERVAL_MIN`     — bucket / cadence (default 5).
 *   - `OPTION_SNAPSHOT_STRIKE_WINDOW`    — ATM ± N strikes (default 10).
 *   - `OPTION_SNAPSHOT_RETENTION_DAYS`   — daily retention sweep (default 825,
 *                                          ≈ 27 months). Long by design.
 *   - `OPTION_SNAPSHOT_EXPIRIES`         — number of expiries from the
 *                                          front (default 2 — current + next).
 *   - `OPTION_SNAPSHOT_ARCHIVE_PATH`     — durable archive directory. If unset,
 *                                          retention sweep is fail-closed.
 *
 * Root-cause forensics (Pack 9A Gate 1):
 *   The option_chain_snapshot table had 0 rows and 0 ingestion runs because:
 *   1. OPTION_SNAPSHOT_ENABLED was not set explicitly.
 *   2. Auto-detect: enabled only when REPLIT_DEPLOYMENT === "1" (production).
 *   3. The api-server was not republished after the ingestor code was added,
 *      so production never ran with REPLIT_DEPLOYMENT="1" and this code.
 *   4. In the dev environment (REPLIT_DEPLOYMENT unset), the ingestor silently
 *      no-ops, leaving the table permanently empty in development.
 *   FIX: Set OPTION_SNAPSHOT_ENABLED=1 as a persistent secret to enable capture
 *   in both dev and production, then republish to activate in production.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  optionChainSnapshotTable,
  optionChainSnapshotRunTable,
  type NewOptionChainSnapshotRow,
} from "@workspace/db/schema";
import { logger } from "./logger";
import { fetchOptionChain } from "./optionChain";
import type { OcResponse, OcSide } from "./optionChain";
import { computeMarketStatus } from "./marketEvents";
import { ensureOptionSnapshotV1Schema } from "./optionSnapshotMigrations";
import {
  archiveSnapshotPartitionBeforeCutoff,
  getArchiveInfrastructureRequirement,
  getArchivePath,
} from "./optionSnapshotArchive";

// ───────────── Universe ─────────────
// Mirror `FNO_INDICES` exactly.
export const SNAPSHOT_INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
export type SnapshotIndex = (typeof SNAPSHOT_INDICES)[number];

// ───────────── Lot sizes (date-effective at Pack 9A, 2026-01-JAN revision) ─────
export const SNAPSHOT_LOT_SIZES: Record<string, number> = {
  NIFTY: 65,
  BANKNIFTY: 30,
  SENSEX: 20,
} as const;

// ───────────── Reliability constants ─────────────
/** Number of consecutive full-failure ticks before circuit trips. */
export const CIRCUIT_BREAKER_THRESHOLD = 5;
/** Minutes the circuit stays open after tripping. */
export const CIRCUIT_RESET_MINUTES = 15;
/** Minimum minutes between owner failure/recovery alerts. */
export const ALERT_COOLDOWN_MINUTES = 60;
/** Milliseconds before a tick is aborted with tick_timeout. */
export const TICK_TIMEOUT_MS = 60_000;
/** Stable advisory lock key for snapshot ingestor (any unique integer). */
const ADVISORY_LOCK_KEY = 0x534e4150; // "SNAP" as hex

// ───────────── Config ─────────────
const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

export function isOptionSnapshotEnabled(): boolean {
  const raw = process.env["OPTION_SNAPSHOT_ENABLED"];
  if (raw != null && raw.length > 0) {
    const v = raw.trim().toLowerCase();
    if (TRUTHY.has(v)) return true;
    if (FALSY.has(v)) return false;
    return false; // unrecognised → fail closed
  }
  return process.env["REPLIT_DEPLOYMENT"] === "1";
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function getSnapshotConfig(): {
  intervalMinutes: number;
  strikeWindow: number;
  retentionDays: number;
  expiriesPerUnderlying: number;
} {
  return {
    intervalMinutes: intEnv("OPTION_SNAPSHOT_INTERVAL_MIN", 5, 1, 60),
    strikeWindow: intEnv("OPTION_SNAPSHOT_STRIKE_WINDOW", 10, 1, 50),
    retentionDays: intEnv("OPTION_SNAPSHOT_RETENTION_DAYS", 825, 1, 1100),
    expiriesPerUnderlying: intEnv("OPTION_SNAPSHOT_EXPIRIES", 2, 1, 6),
  };
}

// ───────────── Pure helpers (exported for tests) ─────────────

/**
 * Round a wall-clock timestamp down to the nearest `intervalMinutes`
 * bucket. Used as `captured_at` so multiple ingestion attempts within
 * the same bucket UPSERT the same row instead of duplicating.
 */
export function bucketTimestamp(now: Date, intervalMinutes: number): Date {
  const ms = intervalMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Pick the strikes from the chain that lie within ±`window` strikes of
 * ATM. Operates on the chain's existing `rows` (already strike-sorted by
 * `fetchOptionChain`) — does NOT widen or narrow what the broker
 * returned, only filters.
 */
export function selectStrikesAroundAtm<T extends { strike: number }>(
  rows: ReadonlyArray<T>,
  atmStrike: number,
  window: number,
): T[] {
  if (rows.length === 0) return [];
  const closest = [...rows]
    .sort((a, b) => Math.abs(a.strike - atmStrike) - Math.abs(b.strike - atmStrike))
    .slice(0, window * 2 + 1);
  closest.sort((a, b) => a.strike - b.strike);
  return closest;
}

/** Coerce numeric → drizzle-numeric string (rounded to dp); null when absent. */
function numStr(n: number | null | undefined, dp = 2): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n.toFixed(dp);
}

/** Coerce numeric → integer; null when absent. */
function intOrNull(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * Flatten one option chain into an array of insert rows, one per leg
 * within the ATM window. Pure — exported for tests.
 *
 * @param opts.lotSize      - Date-effective lot size at capture time. Stored as-is.
 * @param opts.marketStatus - Market session state at capture time (open/pre_open/closed).
 * @param opts.canaryMarker - Set to a non-null string only during canary capture runs.
 */
export function flattenChainToRows(
  chain: OcResponse,
  capturedAt: Date,
  strikeWindow: number,
  opts?: {
    lotSize?: number | null;
    marketStatus?: string | null;
    canaryMarker?: string | null;
  },
): NewOptionChainSnapshotRow[] {
  const atm = chain.atmStrike ?? 0;
  if (atm <= 0) return [];
  const window = selectStrikesAroundAtm(chain.rows, atm, strikeWindow);
  const out: NewOptionChainSnapshotRow[] = [];
  const spotStr = numStr(chain.spot);
  const atmStr = numStr(atm);

  for (const r of window) {
    for (const side of ["CE", "PE"] as const) {
      const leg: OcSide | undefined = side === "CE" ? r.ce : r.pe;
      if (!leg) continue;
      const bid = leg.bid;
      const ask = leg.ask;
      const spread =
        bid != null && ask != null && Number.isFinite(bid) && Number.isFinite(ask)
          ? Math.max(0, ask - bid)
          : null;
      out.push({
        underlying: chain.underlying,
        expiry: chain.expiry,
        strike: r.strike.toFixed(2),
        optType: side,
        capturedAt,
        tradingsymbol: null,
        instrumentToken: null,
        spot: spotStr,
        atmStrike: atmStr,
        ltp: numStr(leg.ltp),
        open: null,
        high: null,
        low: null,
        close: null,
        volume: intOrNull(leg.volume),
        oi: intOrNull(leg.oi),
        oiChange: intOrNull(leg.chgOi),
        iv: numStr(leg.iv),
        bid: numStr(bid),
        ask: numStr(ask),
        bidQty: intOrNull(leg.bidQty),
        askQty: intOrNull(leg.askQty),
        spread: numStr(spread),
        depthSummary: null,
        delta: numStr(leg.delta, 4),
        gamma: numStr(leg.gamma, 6),
        theta: numStr(leg.theta, 4),
        vega: numStr(leg.vega, 4),
        source: chain.source ?? "unknown",
        schemaVersion: "v1",
        lotSize: opts?.lotSize ?? null,
        marketStatus: opts?.marketStatus ?? null,
        canaryMarker: opts?.canaryMarker ?? null,
      });
    }
  }
  return out;
}

// ───────────── DB writes ─────────────

/** Idempotent bulk upsert. Returns number of rows attempted. */
async function upsertRows(rows: NewOptionChainSnapshotRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const BATCH = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await db
      .insert(optionChainSnapshotTable)
      .values(slice)
      .onConflictDoUpdate({
        target: [
          optionChainSnapshotTable.underlying,
          optionChainSnapshotTable.expiry,
          optionChainSnapshotTable.strike,
          optionChainSnapshotTable.optType,
          optionChainSnapshotTable.capturedAt,
        ],
        set: {
          ltp: sql`excluded.ltp`,
          volume: sql`excluded.volume`,
          oi: sql`excluded.oi`,
          oiChange: sql`excluded.oi_change`,
          iv: sql`excluded.iv`,
          bid: sql`excluded.bid`,
          ask: sql`excluded.ask`,
          bidQty: sql`excluded.bid_qty`,
          askQty: sql`excluded.ask_qty`,
          spread: sql`excluded.spread`,
          delta: sql`excluded.delta`,
          gamma: sql`excluded.gamma`,
          theta: sql`excluded.theta`,
          vega: sql`excluded.vega`,
          spot: sql`excluded.spot`,
          atmStrike: sql`excluded.atm_strike`,
          source: sql`excluded.source`,
          lotSize: sql`excluded.lot_size`,
          marketStatus: sql`excluded.market_status`,
          // NOTE: schema_version and canary_marker are NOT updated on conflict
          // to preserve provenance of the row that first claimed the bucket.
        },
      });
    total += slice.length;
  }
  return total;
}

// ───────────── Advisory lock ─────────────

/**
 * Try to acquire a PostgreSQL session-level advisory lock.
 * Returns true if the lock was acquired (safe to proceed).
 * Returns false if another session/replica holds the lock (skip this tick).
 * Fail-open: if the DB call fails, returns true (prefer tick over lock-starvation).
 */
async function tryAcquireAdvisoryLock(): Promise<boolean> {
  try {
    const result = (await db.execute(
      sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS acquired`,
    )) as unknown as { rows: Array<{ acquired: boolean }> };
    return result.rows[0]?.acquired === true;
  } catch {
    return true; // fail-open: better to duplicate than to stall
  }
}

async function releaseAdvisoryLock(): Promise<void> {
  try {
    await db.execute(sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
  } catch { /* best-effort */ }
}

// ───────────── Retention sweep (archive-before-delete) ─────────────

/**
 * Run the daily retention sweep. FAIL-CLOSED:
 *   - Refuses deletion if OPTION_SNAPSHOT_ARCHIVE_PATH is not configured.
 *   - Refuses deletion if archive write or verify fails.
 *   - Only deletes after WRITE_AND_VERIFIED outcome.
 */
export async function runRetentionSweep(): Promise<{
  outcome: "DELETED" | "SKIPPED_ARCHIVE_REQUIRED" | "SKIPPED_ARCHIVE_FAILED" | "NOTHING_TO_ARCHIVE";
  snapshotRowsDeleted: number;
  runRowsDeleted: number;
  archiveOutcome?: string;
}> {
  const cfg = getSnapshotConfig();
  const cutoff = new Date(Date.now() - cfg.retentionDays * 86_400_000);
  const cutoffIso = cutoff.toISOString();

  const archivePath = getArchivePath();
  if (!archivePath) {
    logger.warn(
      { requirement: getArchiveInfrastructureRequirement(), retentionDays: cfg.retentionDays },
      "option-snapshot: retention sweep SKIPPED — archive path not configured; deletion blocked (fail-closed)",
    );
    return {
      outcome: "SKIPPED_ARCHIVE_REQUIRED",
      snapshotRowsDeleted: 0,
      runRowsDeleted: 0,
      archiveOutcome: "ARCHIVE_PROVIDER_NOT_CONFIGURED",
    };
  }

  // Archive-before-delete.
  const { outcome: archiveResult, rowsArchived } = await archiveSnapshotPartitionBeforeCutoff(cutoffIso);

  if (archiveResult === "NO_ROWS_TO_ARCHIVE") {
    return { outcome: "NOTHING_TO_ARCHIVE", snapshotRowsDeleted: 0, runRowsDeleted: 0, archiveOutcome: archiveResult };
  }

  if (archiveResult !== "WRITE_AND_VERIFIED") {
    logger.error(
      { archiveResult, cutoff: cutoffIso },
      "option-snapshot: retention sweep BLOCKED — archive failed; source rows NOT deleted",
    );
    return {
      outcome: "SKIPPED_ARCHIVE_FAILED",
      snapshotRowsDeleted: 0,
      runRowsDeleted: 0,
      archiveOutcome: archiveResult,
    };
  }

  // Archive verified — safe to delete.
  const snap = await db.execute(sql`
    DELETE FROM option_chain_snapshot WHERE captured_at < ${cutoffIso};
  `);
  const runs = await db.execute(sql`
    DELETE FROM option_chain_snapshot_run WHERE started_at < ${cutoffIso};
  `);
  const snapDel = (snap as unknown as { rowCount?: number }).rowCount ?? 0;
  const runDel = (runs as unknown as { rowCount?: number }).rowCount ?? 0;

  logger.info(
    { snapDel, runDel, rowsArchived, cutoff: cutoffIso },
    "option-snapshot: retention sweep complete — archive verified, rows deleted",
  );
  return {
    outcome: "DELETED",
    snapshotRowsDeleted: snapDel,
    runRowsDeleted: runDel,
    archiveOutcome: archiveResult,
  };
}

// ───────────── Run loop ─────────────

interface RunResult {
  underlyingsAttempted: number;
  underlyingsOk: number;
  expiriesCovered: number;
  rowsWritten: number;
  errors: Array<{ underlying: string; expiry?: string; message: string }>;
  source: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  skippedReason?: string;
}

/**
 * One ingestion cycle. Public for the diagnostic endpoint to optionally
 * trigger a manual capture (owner-only).
 *
 * @param opts.force          - Bypass market-hours and circuit-breaker guards.
 * @param opts.canaryMarker   - Set to isolate this run as a canary; rows get
 *                              this marker for exact-key cleanup.
 */
export async function runIngestionTick(opts?: {
  force?: boolean;
  canaryMarker?: string;
}): Promise<RunResult> {
  const startedAt = new Date();
  const cfg = getSnapshotConfig();
  const capturedAt = bucketTimestamp(startedAt, cfg.intervalMinutes);
  const force = opts?.force === true;
  const canaryMarker = opts?.canaryMarker ?? null;

  const errors: RunResult["errors"] = [];
  let okCount = 0;
  let totalRows = 0;
  let expiryCount = 0;
  const seenSources = new Set<string>();

  const marketStatus = computeMarketStatus(startedAt);

  if (!force && marketStatus !== "open") {
    const finishedAt = new Date();
    return {
      underlyingsAttempted: 0,
      underlyingsOk: 0,
      expiriesCovered: 0,
      rowsWritten: 0,
      errors: [{ underlying: "*", message: "market_closed" }],
      source: "none",
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      skippedReason: "market_closed",
    };
  }

  for (const underlying of SNAPSHOT_INDICES) {
    const lotSize = SNAPSHOT_LOT_SIZES[underlying] ?? null;
    let firstChain: OcResponse | null = null;
    try {
      firstChain = await fetchOptionChain(underlying);
    } catch (err) {
      errors.push({ underlying, message: (err as Error).message });
      continue;
    }
    if (!firstChain) {
      errors.push({ underlying, message: "no_chain_returned" });
      continue;
    }

    const expiries = (firstChain.expiries ?? [firstChain.expiry])
      .filter((e) => typeof e === "string" && e.length === 10)
      .slice(0, cfg.expiriesPerUnderlying);

    let underlyingOk = false;
    for (const exp of expiries) {
      try {
        const chain =
          exp === firstChain.expiry ? firstChain : await fetchOptionChain(underlying, exp);
        if (!chain || chain.rows.length === 0) {
          errors.push({ underlying, expiry: exp, message: "empty_chain" });
          continue;
        }
        if (chain.source) seenSources.add(chain.source);
        const rows = flattenChainToRows(chain, capturedAt, cfg.strikeWindow, {
          lotSize,
          marketStatus,
          canaryMarker,
        });
        const n = await upsertRows(rows);
        totalRows += n;
        expiryCount += 1;
        underlyingOk = true;

        // R1-tail: replay recorder read-only tap. Wrapped fail-open.
        try {
          const { tapPushChainSnapshot } = await import("./liveTapRing");
          tapPushChainSnapshot({
            capturedAtMs: capturedAt.getTime(),
            underlying,
            expiry: exp,
            source: chain.source ?? "unknown",
            snapshot: { rows: chain.rows, spot: chain.spot ?? null },
          });
        } catch { /* fail-open */ }
      } catch (err) {
        errors.push({ underlying, expiry: exp, message: (err as Error).message });
      }
    }
    if (underlyingOk) okCount += 1;
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const sourceTag =
    seenSources.size === 0
      ? "none"
      : seenSources.size === 1
        ? [...seenSources][0]!
        : "mixed";

  // Persist the run row for the diagnostic endpoint.
  try {
    await db.insert(optionChainSnapshotRunTable).values({
      startedAt,
      finishedAt,
      durationMs,
      underlyingsAttempted: SNAPSHOT_INDICES.length,
      underlyingsOk: okCount,
      expiriesCovered: expiryCount,
      rowsWritten: totalRows,
      source: sourceTag.slice(0, 16),
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "option-snapshot: failed to persist run row (continuing)",
    );
  }

  return {
    underlyingsAttempted: SNAPSHOT_INDICES.length,
    underlyingsOk: okCount,
    expiriesCovered: expiryCount,
    rowsWritten: totalRows,
    errors,
    source: sourceTag,
    startedAt,
    finishedAt,
    durationMs,
  };
}

// ───────────── Circuit-breaker and alert-dedup state ─────────────

let consecutiveFullFailures = 0;
let circuitOpenUntil: Date | null = null;
let lastFailureAlertAt: Date | null = null;
let lastRecoveryAlertAt: Date | null = null;

/** Returns true if the circuit is currently open (ticks should be skipped). */
export function isCircuitOpen(now: Date): boolean {
  if (!circuitOpenUntil) return false;
  if (now >= circuitOpenUntil) {
    // Auto-reset: circuit window expired.
    circuitOpenUntil = null;
    consecutiveFullFailures = 0;
    return false;
  }
  return true;
}

/**
 * Update circuit-breaker state after a tick completes.
 * A "full failure" means underlyingsOk === 0 and at least one error (not market_closed).
 */
export function updateCircuitBreaker(
  result: RunResult,
  now: Date,
): { circuitTripped: boolean; circuitOpen: boolean } {
  const isFullFailure =
    result.underlyingsOk === 0 &&
    result.errors.length > 0 &&
    !result.skippedReason;

  if (isFullFailure) {
    consecutiveFullFailures += 1;
    if (consecutiveFullFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      circuitOpenUntil = new Date(now.getTime() + CIRCUIT_RESET_MINUTES * 60_000);
      return { circuitTripped: true, circuitOpen: true };
    }
  } else if (result.underlyingsOk > 0) {
    // Any success resets the counter.
    const wasOpen = circuitOpenUntil != null && now < circuitOpenUntil;
    consecutiveFullFailures = 0;
    circuitOpenUntil = null;
    return { circuitTripped: false, circuitOpen: false };
  }
  return { circuitTripped: false, circuitOpen: circuitOpenUntil != null };
}

/**
 * Returns true if an owner alert should be sent (respects cooldown).
 * kind: "failure" | "recovery"
 */
export function shouldSendOwnerAlert(kind: "failure" | "recovery", now: Date): boolean {
  const cooldownMs = ALERT_COOLDOWN_MINUTES * 60_000;
  if (kind === "failure") {
    if (lastFailureAlertAt && now.getTime() - lastFailureAlertAt.getTime() < cooldownMs) {
      return false;
    }
    lastFailureAlertAt = now;
    return true;
  } else {
    if (lastRecoveryAlertAt && now.getTime() - lastRecoveryAlertAt.getTime() < cooldownMs) {
      return false;
    }
    lastRecoveryAlertAt = now;
    return true;
  }
}

/** Reset circuit-breaker and alert state — for tests only. */
export function _resetCircuitBreaker(): void {
  consecutiveFullFailures = 0;
  circuitOpenUntil = null;
  lastFailureAlertAt = null;
  lastRecoveryAlertAt = null;
}

// ───────────── Scheduler ─────────────

let tickTimer: NodeJS.Timeout | null = null;
let retentionTimer: NodeJS.Timeout | null = null;
let inFlight = false;
let lastRun: RunResult | null = null;

export function getLastRun(): RunResult | null {
  return lastRun;
}

export function getCircuitState(): {
  consecutiveFullFailures: number;
  circuitOpenUntil: string | null;
} {
  return {
    consecutiveFullFailures,
    circuitOpenUntil: circuitOpenUntil?.toISOString() ?? null,
  };
}

/**
 * Start the long-running ingestor. Idempotent — safe to call twice.
 * No-ops in three cases:
 *   1. `OPTION_SNAPSHOT_ENABLED` resolves to false (dev / preview default).
 *   2. The timer is already running.
 *   3. `DATABASE_URL` is unset (test environments).
 */
export function startOptionSnapshotIngestor(): void {
  if (tickTimer != null) return;
  if (!process.env["DATABASE_URL"]) {
    logger.info("option-snapshot: DATABASE_URL not set, skipping ingestor");
    return;
  }
  if (!isOptionSnapshotEnabled()) {
    logger.info(
      { reason: "OPTION_SNAPSHOT_ENABLED is off (auto-detected dev or explicit override)" },
      "option-snapshot: ingestor disabled",
    );
    return;
  }
  const cfg = getSnapshotConfig();
  const intervalMs = cfg.intervalMinutes * 60_000;
  logger.info(
    {
      intervalMin: cfg.intervalMinutes,
      strikeWindow: cfg.strikeWindow,
      expiries: cfg.expiriesPerUnderlying,
      retentionDays: cfg.retentionDays,
      universe: SNAPSHOT_INDICES,
      archiveConfigured: getArchivePath() != null,
    },
    "option-snapshot: starting ingestor",
  );

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    const now = new Date();

    // Circuit-breaker check.
    if (isCircuitOpen(now)) {
      logger.debug(
        { openUntil: circuitOpenUntil?.toISOString() },
        "option-snapshot: circuit open — skipping tick",
      );
      return;
    }

    // Advisory lock — skip if another replica is running.
    const locked = await tryAcquireAdvisoryLock();
    if (!locked) {
      logger.debug("option-snapshot: advisory lock not acquired — another replica active");
      return;
    }

    inFlight = true;
    try {
      // Tick with timeout.
      const r = await Promise.race<RunResult>([
        runIngestionTick(),
        new Promise<RunResult>((_, reject) =>
          setTimeout(() => reject(new Error("tick_timeout")), TICK_TIMEOUT_MS),
        ),
      ]);
      lastRun = r;

      const { circuitTripped, circuitOpen } = updateCircuitBreaker(r, new Date());

      if (r.rowsWritten > 0 || r.errors.some((e) => e.message !== "market_closed")) {
        logger.info(
          {
            rows: r.rowsWritten,
            ok: r.underlyingsOk,
            err: r.errors.length,
            src: r.source,
            durationMs: r.durationMs,
          },
          "option-snapshot: tick complete",
        );
      }

      if (circuitTripped && shouldSendOwnerAlert("failure", new Date())) {
        logger.warn(
          {
            consecutiveFullFailures,
            openUntil: circuitOpenUntil?.toISOString(),
            lastErrors: r.errors.slice(0, 3),
          },
          "option-snapshot: CIRCUIT TRIPPED — owner alert (dedup active)",
        );
        // TODO: integrate with Telegram owner alert when sendSystemDataQualityAlert
        // is wired into this module (out of scope for Pack 9A init phase).
      }

      if (!circuitOpen && consecutiveFullFailures === 0 && r.underlyingsOk > 0
          && shouldSendOwnerAlert("recovery", new Date())) {
        logger.info("option-snapshot: capture recovered — owner alert (dedup active)");
        // TODO: Telegram recovery alert.
      }
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn({ err: msg }, "option-snapshot: tick failed/timeout");
      // Treat tick-level errors as full failures for the circuit breaker.
      const syntheticResult: RunResult = {
        underlyingsAttempted: SNAPSHOT_INDICES.length,
        underlyingsOk: 0,
        expiriesCovered: 0,
        rowsWritten: 0,
        errors: [{ underlying: "*", message: msg }],
        source: "none",
        startedAt: now,
        finishedAt: new Date(),
        durationMs: TICK_TIMEOUT_MS,
      };
      updateCircuitBreaker(syntheticResult, new Date());
    } finally {
      inFlight = false;
      await releaseAdvisoryLock();
    }
  };

  // Ensure schema columns exist once before first tick.
  void ensureOptionSnapshotV1Schema()
    .then(() => tick())
    .catch((err) => logger.warn({ err: (err as Error).message }, "option-snapshot: schema ensure failed"));

  tickTimer = setInterval(() => void tick(), intervalMs);

  // Daily retention sweep at boot + every 24h. Fail-closed by design.
  const retentionSweep = (): void => {
    void runRetentionSweep().then((r) => {
      if (r.outcome === "SKIPPED_ARCHIVE_REQUIRED") {
        logger.warn(
          { requirement: getArchiveInfrastructureRequirement() },
          "option-snapshot: retention BLOCKED — configure OPTION_SNAPSHOT_ARCHIVE_PATH",
        );
      }
    }).catch((err) =>
      logger.warn({ err: (err as Error).message }, "option-snapshot: retention sweep error"),
    );
  };
  retentionSweep();
  retentionTimer = setInterval(retentionSweep, 24 * 60 * 60_000);
}

/** Test hook — stops timers so vitest doesn't keep the event loop alive. */
export function stopOptionSnapshotIngestor(): void {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (retentionTimer) { clearInterval(retentionTimer); retentionTimer = null; }
}
