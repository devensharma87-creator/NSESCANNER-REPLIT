/**
 * SystemMode state machine (fix-file BUG-28).
 *
 * Global operating mode ∈ {NORMAL, DEGRADED, READ_ONLY, HALT}:
 *   NORMAL     — everything runs.
 *   DEGRADED   — existing positions managed, NO new auto-opens.
 *   READ_ONLY  — no trades at all; tabs still display last known data.
 *   HALT       — everything paused (manual emergency latch).
 *
 * Derivation (pure, unit-tested):
 *   - Kite session invalid                       → READ_ONLY
 *   - WS feed down > 30s during market hours     → DEGRADED
 *   - DB health-check failed or latency > 500ms  → DEGRADED
 * Effective mode = worst of (derived, manual override). Manual override is
 * persisted in app_state (`system_mode_override`) so it survives restarts.
 *
 * Enforcement: `paperAutoTradeFlag.isPaperAutoTradingEnabled()` reads the
 * cached effective mode and refuses new auto-opens unless NORMAL. Manual
 * user-driven closes are never gated. Transitions alert the owner (Telegram).
 */
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db, pool, getDbPoolStats } from "@workspace/db";
import { getKiteReadiness } from "./kiteReadiness";
import { getStalenessSnapshot } from "./marketData/stalenessWatchdog";
import { isInstrumentsRefreshFailedToday } from "./marketData/instrumentsIntegrity";
import { getAppState, setAppState, deleteAppState } from "./appStateStore";
import { alertOwner } from "./alerting";
import { logger } from "./logger";
import {
  SYSTEM_MODES,
  SYSTEM_MODE_RANK,
  setCachedSystemMode,
  type SystemMode,
} from "./systemModeCache";

export type { SystemMode };
export { SYSTEM_MODES };

export const WS_DOWN_DEGRADE_MS = 30_000;
export const DB_LATENCY_DEGRADE_MS = 500;
export const MODE_TICK_MS = 10_000;
const OVERRIDE_KEY = "system_mode_override";

export interface SystemModeInputs {
  sessionValid: boolean;
  feedConnected: boolean;
  feedDisconnectedForMs: number;
  marketSession: "open" | "closed" | "pre_open";
  dbLatencyMs: number | null; // null = health check failed
  tokenStalenessDegrade?: boolean; // BUG-30: >5% of subscribed tokens stale
  instrumentsRefreshFailed?: boolean; // BUG-35: daily dump refresh failed today
}

// ---------------------------------------------------------------------------
// DB measurement types
// ---------------------------------------------------------------------------

/** Pool-like interface used by measureDbHealthWithPool — injectable for testing. */
export interface PoolClientLike {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
  ): Promise<{ rows: T[] }>;
  release(): void;
}

export interface MeasurablePool {
  connect(): Promise<PoolClientLike>;
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
  options?: { max?: number };
}

export type DbMeasurementStatus = "ok" | "acquire_failed" | "query_failed";

export interface DbMeasurementResult {
  /** Total wall-clock ms (acquireMs + queryMs). null when either phase failed. */
  totalMs: number | null;
  /** Time from pool.connect() call to client returned. null when failed. */
  acquireMs: number | null;
  /** Time from query start to result returned. null when acquire or query failed. */
  queryMs: number | null;
  /** Pool snapshot before connection acquire. */
  poolTotalCountBefore: number | null;
  poolIdleCountBefore: number | null;
  poolWaitingCountBefore: number | null;
  /** Pool snapshot after query, before release (reflects in-flight state). */
  poolTotalCountAfter: number | null;
  poolIdleCountAfter: number | null;
  poolWaitingCountAfter: number | null;
  /** pg_backend_pid() from the acquired connection. null when query failed. */
  backendPid: number | null;
  /**
   * true  = backend PID differs from the previous measurement → new PG backend (cold connect).
   * false = same PID → connection was reused from pool.
   * null  = no prior measurement to compare against.
   */
  backendPidChanged: boolean | null;
  dbMeasurementStatus: DbMeasurementStatus;
}

export interface SystemModeSnapshot {
  derived: SystemMode;
  override: SystemMode | null;
  effective: SystemMode;
  drivers: string[];
  /** Backward-compatible total latency (= dbDiagnostics.totalMs). null = check failed. */
  dbLatencyMs: number | null;
  checkedAt: string;
  autoOpensAllowed: boolean;
  /** Full DB measurement breakdown. Populated on every tick. */
  dbDiagnostics: DbMeasurementResult | null;
  /**
   * SHA-256(host:port/dbname) first 16 hex chars. Identifies the DB instance
   * without exposing any connection secret. null when DATABASE_URL not parseable.
   */
  dbInstanceFingerprint: string | null;
}

/** PURE — first-principles derivation per the fix-file transition table. */
export function deriveSystemMode(i: SystemModeInputs): { mode: SystemMode; drivers: string[] } {
  const drivers: string[] = [];
  let mode: SystemMode = "NORMAL";
  const bump = (m: SystemMode, driver: string) => {
    drivers.push(driver);
    if (SYSTEM_MODE_RANK[m] > SYSTEM_MODE_RANK[mode]) mode = m;
  };
  if (!i.sessionValid) {
    bump("READ_ONLY", "KITE_SESSION_INVALID");
  } else if (i.marketSession === "open" && !i.feedConnected && i.feedDisconnectedForMs > WS_DOWN_DEGRADE_MS) {
    bump("DEGRADED", `KITE_WS_DOWN_${Math.round(i.feedDisconnectedForMs / 1000)}S`);
  }
  if (i.dbLatencyMs === null) {
    bump("DEGRADED", "DB_HEALTH_CHECK_FAILED");
  } else if (i.dbLatencyMs > DB_LATENCY_DEGRADE_MS) {
    bump("DEGRADED", `DB_LATENCY_${i.dbLatencyMs}MS`);
  }
  if (i.tokenStalenessDegrade) {
    bump("DEGRADED", "TOKEN_STALENESS_OVER_5PCT");
  }
  if (i.instrumentsRefreshFailed) {
    bump("DEGRADED", "INSTRUMENTS_REFRESH_FAILED");
  }
  return { mode, drivers };
}

/** PURE — worst-of combination of derived mode and manual override. */
export function combineWithOverride(derived: SystemMode, override: SystemMode | null): SystemMode {
  if (override === null) return derived;
  return SYSTEM_MODE_RANK[override] >= SYSTEM_MODE_RANK[derived] ? override : derived;
}

export function isValidSystemMode(v: unknown): v is SystemMode {
  return typeof v === "string" && (SYSTEM_MODES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// DB instance fingerprint
// Computed once per process from DATABASE_URL. Never exposes the source values.
// ---------------------------------------------------------------------------

let _dbInstanceFingerprint: string | null | undefined = undefined; // undefined = not yet computed

export function computeDbFingerprint(): string | null {
  if (_dbInstanceFingerprint !== undefined) return _dbInstanceFingerprint;
  try {
    const raw = process.env["DATABASE_URL"];
    if (!raw) {
      _dbInstanceFingerprint = null;
      return null;
    }
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port || "5432";
    const dbname = parsed.pathname.replace(/^\//, "").toLowerCase();
    if (!host || !dbname) {
      _dbInstanceFingerprint = null;
      return null;
    }
    _dbInstanceFingerprint = createHash("sha256")
      .update(`${host}:${port}/${dbname}`)
      .digest("hex")
      .slice(0, 16);
    return _dbInstanceFingerprint;
  } catch {
    _dbInstanceFingerprint = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// DB health measurement — testable core
// ---------------------------------------------------------------------------

/**
 * Measures DB health by acquiring a real pool connection and running
 * `SELECT 1, pg_backend_pid()` on it. Separates acquisition time from
 * query execution time and captures pool counters before and after.
 *
 * Exported for unit testing with mock pools. Production callers use
 * the private `measureDbHealth()` wrapper which supplies the real pool
 * and tracks module-level prevBackendPid state.
 *
 * @param poolSrc  Pool to acquire a connection from.
 * @param prevPid  The backend_pid from the previous measurement, or null if
 *                 no prior measurement exists (first tick).
 * @returns { result, nextPid } — nextPid is the PID to carry forward, or
 *          null when the query failed.
 */
export async function measureDbHealthWithPool(
  poolSrc: MeasurablePool,
  prevPid: number | null,
): Promise<{ result: DbMeasurementResult; nextPid: number | null }> {
  // Snapshot pool counters before acquisition
  const statsBefore = getDbPoolStats(
    poolSrc as Parameters<typeof getDbPoolStats>[0],
  );
  const poolTotalCountBefore = statsBefore?.total ?? null;
  const poolIdleCountBefore = statsBefore?.idle ?? null;
  const poolWaitingCountBefore = statsBefore?.waiting ?? null;

  let client: PoolClientLike | null = null;
  let acquireMs: number | null = null;
  let queryMs: number | null = null;
  let backendPid: number | null = null;
  let dbMeasurementStatus: DbMeasurementStatus = "ok";

  const t0 = Date.now();
  try {
    client = await poolSrc.connect();
    acquireMs = Date.now() - t0;

    const qt0 = Date.now();
    const rows = await client.query<{ ok: number; backend_pid: number }>(
      "SELECT 1 AS ok, pg_backend_pid() AS backend_pid",
    );
    queryMs = Date.now() - qt0;

    const pid = rows.rows[0]?.backend_pid;
    backendPid = pid != null ? Number(pid) : null;
  } catch {
    if (acquireMs === null) {
      // Failed before connect() returned
      dbMeasurementStatus = "acquire_failed";
    } else {
      // Connect succeeded; query threw
      dbMeasurementStatus = "query_failed";
    }
  } finally {
    if (client !== null) {
      client.release();
    }
  }

  // Snapshot pool counters after query (before release settles, reflects in-flight)
  const statsAfter = getDbPoolStats(
    poolSrc as Parameters<typeof getDbPoolStats>[0],
  );
  const poolTotalCountAfter = statsAfter?.total ?? null;
  const poolIdleCountAfter = statsAfter?.idle ?? null;
  const poolWaitingCountAfter = statsAfter?.waiting ?? null;

  const totalMs =
    acquireMs !== null && queryMs !== null ? acquireMs + queryMs : null;

  // backendPidChanged: compare against previous PID (null = first measurement)
  let backendPidChanged: boolean | null = null;
  if (backendPid !== null && prevPid !== null) {
    backendPidChanged = backendPid !== prevPid;
  }
  const nextPid = backendPid;

  return {
    result: {
      totalMs,
      acquireMs,
      queryMs,
      poolTotalCountBefore,
      poolIdleCountBefore,
      poolWaitingCountBefore,
      poolTotalCountAfter,
      poolIdleCountAfter,
      poolWaitingCountAfter,
      backendPid,
      backendPidChanged,
      dbMeasurementStatus,
    },
    nextPid,
  };
}

// ---------------------------------------------------------------------------
// Monitor loop (module state)
// ---------------------------------------------------------------------------

let lastFeedConnectedAt = Date.now();
let lastSnapshot: SystemModeSnapshot | null = null;
let timer: NodeJS.Timeout | null = null;
let prevBackendPid: number | null = null;

async function measureDbHealth(): Promise<DbMeasurementResult> {
  const { result, nextPid } = await measureDbHealthWithPool(
    pool as MeasurablePool,
    prevBackendPid,
  );
  if (nextPid !== null) prevBackendPid = nextPid;
  return result;
}

export async function getSystemModeOverride(): Promise<SystemMode | null> {
  const raw = await getAppState(OVERRIDE_KEY);
  return isValidSystemMode(raw) ? raw : null;
}

export async function setSystemModeOverride(mode: SystemMode | null): Promise<void> {
  if (mode === null) {
    await deleteAppState(OVERRIDE_KEY);
  } else {
    await setAppState(OVERRIDE_KEY, mode);
  }
  await runSystemModeTick(); // apply immediately, don't wait for next tick
}

export async function runSystemModeTick(): Promise<SystemModeSnapshot> {
  const [readiness, dbMeasurement, override] = await Promise.all([
    getKiteReadiness(),
    measureDbHealth(),
    getSystemModeOverride(),
  ]);
  const now = Date.now();
  if (readiness.feedConnected) lastFeedConnectedAt = now;

  const dbLatencyMs = dbMeasurement.totalMs;

  const { mode: derived, drivers } = deriveSystemMode({
    sessionValid: readiness.sessionValid,
    feedConnected: readiness.feedConnected,
    feedDisconnectedForMs: now - lastFeedConnectedAt,
    marketSession: readiness.marketSession,
    dbLatencyMs,
    tokenStalenessDegrade: getStalenessSnapshot().degrade,
    instrumentsRefreshFailed: isInstrumentsRefreshFailedToday(),
  });
  if (override !== null) drivers.push(`MANUAL_OVERRIDE_${override}`);
  const effective = combineWithOverride(derived, override);

  const prev = lastSnapshot?.effective ?? null;
  const snapshot: SystemModeSnapshot = {
    derived,
    override,
    effective,
    drivers,
    dbLatencyMs,
    checkedAt: new Date().toISOString(),
    autoOpensAllowed: effective === "NORMAL",
    dbDiagnostics: dbMeasurement,
    dbInstanceFingerprint: computeDbFingerprint(),
  };
  lastSnapshot = snapshot;
  setCachedSystemMode(effective);

  if (prev !== null && prev !== effective) {
    const msg = `SystemMode ${prev} → ${effective} (drivers: ${drivers.join(", ") || "none"})`;
    logger.warn({ prev, effective, drivers }, "system mode transition");
    // R1-tail: replay recorder read-only tap. Fail-open, wrapped so a
    // buffer failure NEVER touches the mode transition path.
    try {
      const { tapPushSystemEvent } = await import("./liveTapRing");
      tapPushSystemEvent({
        emittedAtMs: Date.now(),
        kind: "SYSTEM_MODE_TRANSITION",
        detail: { from: prev, to: effective, drivers },
      });
    } catch { /* fail-open */ }
    alertOwner(
      "SYSTEM_MODE_CHANGED",
      msg,
      undefined,
      5 * 60_000,
      `SYSTEM_MODE_CHANGED::${prev}->${effective}`,
    );
  }
  return snapshot;
}

export function getSystemModeSnapshot(): SystemModeSnapshot | null {
  return lastSnapshot;
}

export function startSystemModeMonitor(): void {
  if (timer) return;
  void runSystemModeTick().catch((err) =>
    logger.warn({ err: (err as Error).message }, "system-mode tick failed"),
  );
  timer = setInterval(() => {
    void runSystemModeTick().catch((err) =>
      logger.warn({ err: (err as Error).message }, "system-mode tick failed"),
    );
  }, MODE_TICK_MS);
  timer.unref?.();
  logger.info({ tickMs: MODE_TICK_MS }, "system-mode monitor started (BUG-28)");
}
