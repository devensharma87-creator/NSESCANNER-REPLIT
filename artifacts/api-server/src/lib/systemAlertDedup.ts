/**
 * DB-backed dedup/state primitives for SYSTEM / DATA-HEALTH Telegram alerts
 * (F&O warmup-failed, Kite final warning, FNO_KITE_SESSION_MISSING,
 * FNO_DATA_RECOVERED). Fixes the root cause identified in
 * docs/telegram-alert-quality-audit-2026-07-03.md: the in-memory `lastAlerted`
 * Map in alerting.ts resets on autoscale cold starts and is not shared across
 * concurrent replicas, causing duplicate sends.
 *
 * Mirrors the already-correct pattern used by daily_report_runs
 * (dailyReports.ts): raw `CREATE TABLE IF NOT EXISTS` (never drizzle-kit push
 * — it drops out-of-schema tables), atomic claim via
 * `INSERT ... ON CONFLICT ... RETURNING`, fail-OPEN on DB error (a duplicate
 * alert is preferable to a silently-dropped one).
 *
 * Two primitives, two different problems:
 *  - `claimSystemAlert`: WINDOWED dedup — "at most one alert per dedup_key per
 *    window_ms". Used for day-scoped or interval-scoped alerts (warmup digest,
 *    Kite final warning, FNO_KITE_SESSION_MISSING).
 *  - `transitionSystemAlertState`: CAS state-machine dedup — "exactly one
 *    alert per genuine degrade→recover transition", independent of elapsed
 *    time. Used for FNO_DATA_RECOVERED, where a windowed key cannot express
 *    "this specific recovery event" (a second real degrade→recover cycle on
 *    the same day must still alert once).
 *
 * NOTE: dedupWindowMs === 0 bypasses the DB claim entirely and always returns
 * true. This preserves existing [MANUAL TEST]/[SAMPLE] alert-route behavior
 * (alerting.ts callers already pass 0 for manual test sends) — those calls
 * must never persist real dedup state.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

const WORKER_ID = `pid-${process.pid}`;

let tablesReady = false;

/**
 * Idempotent table creation — raw SQL, safe to call on every server start.
 * NOT drizzle-kit push (would attempt to drop out-of-schema tables).
 */
export async function ensureSystemAlertDedupTables(): Promise<void> {
  if (tablesReady) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS system_alert_dedup (
        dedup_key TEXT PRIMARY KEY,
        family TEXT NOT NULL,
        window_ms BIGINT NOT NULL,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        worker_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS system_alert_state (
        family TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        incident_id TEXT,
        transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        worker_id TEXT
      )
    `);
    tablesReady = true;
    logger.info({ worker: WORKER_ID }, "systemAlertDedup: tables ready");
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "systemAlertDedup: failed to ensure dedup tables",
    );
  }
}

/** Reset the in-process "tables ready" latch (test-only). */
export function resetSystemAlertDedupTablesReadyForTest(): void {
  tablesReady = false;
}

/**
 * Attempt to atomically claim a windowed alert slot.
 *
 * Returns true if the CALLER may send (either this worker won the claim, or
 * DB is unavailable and we fail-open). Returns false if another claim for the
 * same `dedupKey` already happened within `windowMs`.
 *
 * `windowMs === 0` bypasses the DB entirely (manual-test / sample isolation).
 */
export async function claimSystemAlert(
  dedupKey: string,
  windowMs: number,
  family: string,
): Promise<boolean> {
  if (windowMs <= 0) return true;

  await ensureSystemAlertDedupTables();
  try {
    const result = (await db.execute(sql`
      INSERT INTO system_alert_dedup (dedup_key, family, window_ms, sent_at, worker_id)
      VALUES (${dedupKey}, ${family}, ${windowMs}, NOW(), ${WORKER_ID})
      ON CONFLICT (dedup_key) DO UPDATE
        SET sent_at = NOW(), worker_id = ${WORKER_ID}, window_ms = ${windowMs}
        WHERE system_alert_dedup.sent_at < NOW() - (${windowMs}::text || ' milliseconds')::interval
      RETURNING dedup_key
    `)) as unknown as { rows: Array<{ dedup_key: string }> };
    return result.rows.length > 0;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, dedupKey, family },
      "systemAlertDedup: claim failed — proceeding fail-open",
    );
    return true;
  }
}

/** Reset dedup state for a key (or all keys) — test-only. */
export async function resetSystemAlertDedupForTest(dedupKey?: string): Promise<void> {
  try {
    if (dedupKey) {
      await db.execute(sql`DELETE FROM system_alert_dedup WHERE dedup_key = ${dedupKey}`);
    } else {
      await db.execute(sql`DELETE FROM system_alert_dedup`);
    }
  } catch {
    // best-effort — table may not exist yet in a fresh test DB
  }
}

// ── CAS state-machine dedup (degrade → recover transitions) ────────────────

export type SystemAlertState = "OK" | "DEGRADED";

export interface TransitionResult {
  /** True if THIS call caused the transition (i.e. should alert). */
  claimed: boolean;
  /** Stable id for this specific incident, present once a transition claims. */
  incidentId: string | null;
}

/**
 * Attempt to atomically transition `family` from `fromState` to `toState`.
 * Returns `claimed: true` only for the caller that wins the CAS update — this
 * guarantees exactly one alert per genuine state transition, no matter how
 * many replicas observe it concurrently.
 *
 * Transitioning OK → DEGRADED mints a fresh incidentId (used to key the
 * eventual recovery alert, e.g. `FNO_DATA_RECOVERED::<incidentId>`), so a
 * second real degrade→recover cycle on the same day is a NEW incident and is
 * allowed to alert again — this is intentionally NOT time-windowed.
 *
 * Fails open (claimed: true, incidentId: null) on DB error — the caller
 * should fall back to a synthetic dedup key in that case.
 */
export async function transitionSystemAlertState(
  family: string,
  fromState: SystemAlertState,
  toState: SystemAlertState,
): Promise<TransitionResult> {
  await ensureSystemAlertDedupTables();
  try {
    if (toState === "DEGRADED") {
      const incidentId = `${family}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = (await db.execute(sql`
        INSERT INTO system_alert_state (family, state, incident_id, transitioned_at, worker_id)
        VALUES (${family}, ${toState}, ${incidentId}, NOW(), ${WORKER_ID})
        ON CONFLICT (family) DO UPDATE
          SET state = ${toState}, incident_id = ${incidentId}, transitioned_at = NOW(), worker_id = ${WORKER_ID}
          WHERE system_alert_state.state = ${fromState}
        RETURNING incident_id
      `)) as unknown as { rows: Array<{ incident_id: string }> };
      if (result.rows.length > 0) {
        return { claimed: true, incidentId: result.rows[0]!.incident_id };
      }
      return { claimed: false, incidentId: null };
    }

    // Recovering: CAS DEGRADED -> OK, return the incidentId that was active.
    const result = (await db.execute(sql`
      UPDATE system_alert_state
      SET state = ${toState}, transitioned_at = NOW(), worker_id = ${WORKER_ID}
      WHERE family = ${family} AND state = ${fromState}
      RETURNING incident_id
    `)) as unknown as { rows: Array<{ incident_id: string | null }> };
    if (result.rows.length > 0) {
      return { claimed: true, incidentId: result.rows[0]!.incident_id };
    }
    return { claimed: false, incidentId: null };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, family, fromState, toState },
      "systemAlertDedup: state transition failed — proceeding fail-open",
    );
    return { claimed: true, incidentId: null };
  }
}

/** Read current state for a family (owner diagnostics use). Null if unknown. */
export async function getSystemAlertState(
  family: string,
): Promise<{ state: SystemAlertState; incidentId: string | null; transitionedAt: string } | null> {
  try {
    const result = (await db.execute(sql`
      SELECT state, incident_id, transitioned_at
      FROM system_alert_state
      WHERE family = ${family}
    `)) as unknown as {
      rows: Array<{ state: SystemAlertState; incident_id: string | null; transitioned_at: string }>;
    };
    const row = result.rows[0];
    if (!row) return null;
    return { state: row.state, incidentId: row.incident_id, transitionedAt: row.transitioned_at };
  } catch {
    return null;
  }
}

/** Reset state for a family (or all) — test-only. */
export async function resetSystemAlertStateForTest(family?: string): Promise<void> {
  try {
    if (family) {
      await db.execute(sql`DELETE FROM system_alert_state WHERE family = ${family}`);
    } else {
      await db.execute(sql`DELETE FROM system_alert_state`);
    }
  } catch {
    // best-effort
  }
}

// ── Diagnostics surface (owner-only, no secrets) ────────────────────────────

export interface SystemAlertDedupDiagnosticRow {
  dedupKey: string;
  family: string;
  windowMs: number;
  sentAt: string;
}

/** Returns recent dedup claims, most-recent-first — for the diagnostics endpoint. */
export async function listRecentSystemAlertClaims(
  limit = 50,
): Promise<SystemAlertDedupDiagnosticRow[]> {
  try {
    const result = (await db.execute(sql`
      SELECT dedup_key, family, window_ms, sent_at
      FROM system_alert_dedup
      ORDER BY sent_at DESC
      LIMIT ${limit}
    `)) as unknown as {
      rows: Array<{ dedup_key: string; family: string; window_ms: number; sent_at: string }>;
    };
    return result.rows.map(r => ({
      dedupKey: r.dedup_key,
      family: r.family,
      windowMs: Number(r.window_ms),
      sentAt: r.sent_at,
    }));
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "systemAlertDedup: failed to list recent claims",
    );
    return [];
  }
}

/** Returns all tracked family states — for the diagnostics endpoint. */
export async function listSystemAlertStates(): Promise<
  Array<{ family: string; state: SystemAlertState; incidentId: string | null; transitionedAt: string }>
> {
  try {
    const result = (await db.execute(sql`
      SELECT family, state, incident_id, transitioned_at FROM system_alert_state ORDER BY family
    `)) as unknown as {
      rows: Array<{ family: string; state: SystemAlertState; incident_id: string | null; transitioned_at: string }>;
    };
    return result.rows.map(r => ({
      family: r.family,
      state: r.state,
      incidentId: r.incident_id,
      transitionedAt: r.transitioned_at,
    }));
  } catch {
    return [];
  }
}
