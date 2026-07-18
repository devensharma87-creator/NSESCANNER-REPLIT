/**
 * P0-00 runtime schema-ensure for the signal-plan immutability objects:
 *
 *   1. `option_signal_history.option_premium_locked_at` (TIMESTAMPTZ, nullable)
 *      — the one-shot premium lock stamp.
 *   2. `option_signal_plan_audit` — append-only plan-revision ledger with a
 *      CHECK constraint allowing exactly 4 sanctioned revision reasons.
 *
 * Same production-deploy pattern as `daily_report_runs` (dailyReports.ts),
 * `system_alert_dedup` (systemAlertDedup.ts) and
 * `ensureFnoExitMonitorSchemaColumns` (fnoExitMonitorHealth.ts): raw
 * idempotent DDL executed lazily at first use, NEVER `drizzle-kit push`
 * (an unguarded push offers to DROP live out-of-schema tables). The Drizzle
 * declarations in `lib/db/src/schema/optionSignals.ts` exist so drizzle-kit
 * never sees these objects as out-of-schema; THIS module is what actually
 * creates them in an environment (dev already has them; production gets
 * them on first boot after publish).
 *
 * Memoized-promise gate (fnoExitMonitorHealth pattern): the first caller in
 * a process lifetime runs the DDL, concurrent callers await the same
 * promise, and a failure clears the memo so a later call can retry —
 * a transient DB blip must not permanently wedge the signal lifecycle.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

async function applyOptionSignalPlanSchema(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE option_signal_history
      ADD COLUMN IF NOT EXISTS option_premium_locked_at TIMESTAMPTZ
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS option_signal_plan_audit (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      signal_date DATE NOT NULL,
      index_symbol TEXT NOT NULL,
      setup_key TEXT NOT NULL,
      direction TEXT NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      reason TEXT NOT NULL CONSTRAINT option_signal_plan_audit_reason_check
        CHECK (reason IN (
          'MANUAL_OWNER_EDIT',
          'CONTRACT_CORRECTION_WITH_AUDIT',
          'CORPORATE_ACTION_ADJUSTMENT',
          'DATA_ERROR_CORRECTION_WITH_AUDIT'
        )),
      changed_by TEXT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS option_signal_plan_audit_signal_idx
      ON option_signal_plan_audit (signal_date, index_symbol, setup_key, direction)
  `);
  // Apply the reason CHECK constraint as a SEPARATE ALTER TABLE so it takes
  // effect even when CREATE TABLE IF NOT EXISTS was silently skipped (i.e. the
  // table already existed without the constraint). Uses a DO block for idempotency
  // (PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS syntax). NOT VALID skips a
  // full-table scan, allowing existing historical rows to remain without being
  // rejected — any historical reason values must be classified and migrated via a
  // documented owner-approved procedure BEFORE removing NOT VALID.
  //
  // MIGRATION PROTOCOL for historical rows with non-canonical reason values:
  //   1. Owner identifies each row's origin and classifies it.
  //   2. If test-artifact: delete with documented record (see afterAll in
  //      optionSignalPlanImmutability.test.ts for the cleanup gap that was fixed).
  //   3. If legitimate historical event: map to a canonical reason (insert a
  //      correction row with DATA_ERROR_CORRECTION_WITH_AUDIT, preserve original).
  //   4. After all non-canonical rows are resolved, run:
  //      ALTER TABLE option_signal_plan_audit VALIDATE CONSTRAINT
  //        option_signal_plan_audit_reason_check;
  //   5. Remove NOT VALID from this DDL.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'option_signal_plan_audit_reason_check'
          AND conrelid = 'option_signal_plan_audit'::regclass
      ) THEN
        ALTER TABLE option_signal_plan_audit
          ADD CONSTRAINT option_signal_plan_audit_reason_check
            CHECK (reason IN (
              'MANUAL_OWNER_EDIT',
              'CONTRACT_CORRECTION_WITH_AUDIT',
              'CORPORATE_ACTION_ADJUSTMENT',
              'DATA_ERROR_CORRECTION_WITH_AUDIT'
            ))
            NOT VALID;
      END IF;
    END
    $$
  `);
}

let schemaPromise: Promise<void> | null = null;

/**
 * Memoized, idempotent schema-ready gate for the P0-00 plan-immutability
 * objects. Callers that can tolerate a missing column (fail-open display
 * paths) should `.catch()` — the underlying query will surface the real
 * error anyway if the DDL genuinely could not be applied.
 */
export function ensureOptionSignalPlanSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = applyOptionSignalPlanSchema()
      .then(() => {
        logger.info("optionSignalPlanSchema: plan-immutability schema ready");
      })
      .catch((err: unknown) => {
        schemaPromise = null;
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "optionSignalPlanSchema: ensure failed, will retry on next call",
        );
        throw err;
      });
  }
  return schemaPromise;
}

/** @internal Reset the memoized schema promise for tests. */
export function __resetOptionSignalPlanSchemaGuardForTests(): void {
  schemaPromise = null;
}
