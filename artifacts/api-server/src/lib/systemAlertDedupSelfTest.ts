/**
 * Boot-time, production-safe self-test for the DB-backed system-alert dedup
 * layer (systemAlertDedup.ts).
 *
 * WHY THIS EXISTS: docs/telegram-alert-quality-audit-2026-07-03.md found that
 * `system_alert_state` was missing in production and `system_alert_dedup` had
 * zero rows — the lazy self-heal (`ensureSystemAlertDedupTables`, called only
 * from a real alert dispatch path) had never successfully re-run since a
 * transient boot-time DB hiccup, and no natural alert had fired since to
 * re-trigger it. Waiting for a random natural alert is not an acceptable way
 * to prove a safety mechanism works. This module proves it deterministically,
 * on every boot, without needing one.
 *
 * SAFETY CONTRACT (do not weaken):
 *  - Never imports alerting.ts / fnoSignalAlerts.ts / swingAlerts.ts / any
 *    Telegram-send path. It is structurally impossible for this file to send
 *    a real (or test) Telegram message.
 *  - Never touches trade/strategy/broker logic — it only exercises
 *    systemAlertDedup.ts's generic claim/CAS primitives.
 *  - Uses a dedup_key / family namespace ("SYSTEM_SELFTEST::<runId>",
 *    family `system_selftest_<runId>`) that is per-boot-run-unique (random
 *    runId) and can NEVER collide with a real production key
 *    (KITE_FINAL_WARNING::*, FNO_KITE_SESSION_MISSING::*,
 *    FNO_DATA_WARMUP_FAILED_DIGEST::*, fno_data). This is deliberate: writing
 *    to a REAL key here would risk "poisoning" that key's dedup window and
 *    silently suppressing a genuine future alert for hours — the self-test
 *    must never be able to do that, so it always uses synthetic keys.
 *  - Cleans up its own rows at the end of every run (best-effort) so repeated
 *    autoscale cold starts never accumulate rows.
 *  - Fail-open logging only: any exception is caught, logged, and reported as
 *    a failed check — this function can never throw and can never crash boot.
 */
import { logger } from "./logger";
import {
  ensureSystemAlertDedupTables,
  claimSystemAlert,
  transitionSystemAlertState,
  resetSystemAlertDedupForTest,
  resetSystemAlertStateForTest,
} from "./systemAlertDedup";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface SystemAlertDedupSelfTestResult {
  ranAt: string;
  runId: string;
  checks: {
    dedupTableExists: boolean;
    stateTableExists: boolean;
    dedupPrimaryKeyOnDedupKey: boolean;
    statePrimaryKeyOnFamily: boolean;
    firstClaimSucceeds: boolean;
    duplicateClaimSkipped: boolean;
    stateTransitionClaims: boolean;
    duplicateTransitionSkipped: boolean;
    recoveryTransitionClaims: boolean;
  };
  allPassed: boolean;
  error: string | null;
}

let lastResult: SystemAlertDedupSelfTestResult | null = null;

/** Owner-diagnostics read of the most recent self-test run (in-memory, this process only). */
export function getLastSystemAlertDedupSelfTestResult(): SystemAlertDedupSelfTestResult | null {
  return lastResult;
}

async function tableExists(tableName: string): Promise<boolean> {
  const result = (await db.execute(
    sql`SELECT to_regclass(${tableName}) AS reg`,
  )) as unknown as { rows: Array<{ reg: string | null }> };
  return result.rows[0]?.reg != null;
}

async function primaryKeyIsOn(tableName: string, columnName: string): Promise<boolean> {
  const result = (await db.execute(sql`
    SELECT a.attname AS column_name
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = ${tableName}::regclass AND i.indisprimary
  `)) as unknown as { rows: Array<{ column_name: string }> };
  return result.rows.some(r => r.column_name === columnName);
}

/**
 * Run the full self-heal + claim/CAS self-test once. Non-throwing, non-blocking
 * (callers should fire-and-forget via scheduleBootJob), sends no Telegram, and
 * touches only synthetic self-test keys — see module doc for the safety contract.
 */
export async function runSystemAlertDedupSelfTest(): Promise<SystemAlertDedupSelfTestResult> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dedupKey = `SYSTEM_SELFTEST::${runId}`;
  const stateFamily = `system_selftest_${runId}`;

  const checks: SystemAlertDedupSelfTestResult["checks"] = {
    dedupTableExists: false,
    stateTableExists: false,
    dedupPrimaryKeyOnDedupKey: false,
    statePrimaryKeyOnFamily: false,
    firstClaimSucceeds: false,
    duplicateClaimSkipped: false,
    stateTransitionClaims: false,
    duplicateTransitionSkipped: false,
    recoveryTransitionClaims: false,
  };
  let error: string | null = null;

  try {
    // 1. Self-heal: run the exact same idempotent CREATE TABLE IF NOT EXISTS
    // path a real alert dispatch would run.
    await ensureSystemAlertDedupTables();

    // 2. Confirm both tables now exist (proves self-heal actually worked,
    // not just that it didn't throw).
    checks.dedupTableExists = await tableExists("system_alert_dedup");
    checks.stateTableExists = await tableExists("system_alert_state");

    // 3. Confirm the unique constraints the claim/CAS logic depends on.
    if (checks.dedupTableExists) {
      checks.dedupPrimaryKeyOnDedupKey = await primaryKeyIsOn("system_alert_dedup", "dedup_key");
    }
    if (checks.stateTableExists) {
      checks.statePrimaryKeyOnFamily = await primaryKeyIsOn("system_alert_state", "family");
    }

    // 4. Windowed claim: first claim must succeed, immediate duplicate must be skipped.
    checks.firstClaimSucceeds = await claimSystemAlert(dedupKey, 5 * 60 * 1000, "system_selftest");
    checks.duplicateClaimSkipped = (await claimSystemAlert(dedupKey, 5 * 60 * 1000, "system_selftest")) === false;

    // 5. CAS state transition: OK -> DEGRADED must claim once, a second
    // OK -> DEGRADED call (already DEGRADED) must be skipped, and the
    // recovery DEGRADED -> OK must claim.
    const degrade1 = await transitionSystemAlertState(stateFamily, "OK", "DEGRADED");
    checks.stateTransitionClaims = degrade1.claimed && degrade1.incidentId != null;

    const degrade2 = await transitionSystemAlertState(stateFamily, "OK", "DEGRADED");
    checks.duplicateTransitionSkipped = degrade2.claimed === false;

    const recover = await transitionSystemAlertState(stateFamily, "DEGRADED", "OK");
    checks.recoveryTransitionClaims = recover.claimed === true;
  } catch (err) {
    error = (err as Error).message;
  } finally {
    // Best-effort cleanup — never lets a cleanup failure affect the result.
    await resetSystemAlertDedupForTest(dedupKey).catch(() => undefined);
    await resetSystemAlertStateForTest(stateFamily).catch(() => undefined);
  }

  const allPassed = Object.values(checks).every(Boolean) && error == null;
  const result: SystemAlertDedupSelfTestResult = {
    ranAt: new Date().toISOString(),
    runId,
    checks,
    allPassed,
    error,
  };
  lastResult = result;

  if (allPassed) {
    logger.info(
      { runId, checks },
      "systemAlertDedup self-test: ALL CHECKS PASSED (schema self-heal + claim/CAS verified live)",
    );
  } else {
    logger.error(
      { runId, checks, error },
      "systemAlertDedup self-test: ONE OR MORE CHECKS FAILED",
    );
  }
  return result;
}
