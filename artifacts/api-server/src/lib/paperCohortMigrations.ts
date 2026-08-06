/**
 * Pack 32 — Additive V2 Cohort Persistence Migration Definitions.
 *
 * This module defines the additive DB migrations required to propagate
 * `cohort_id` through the paper-trading tables. The migrations are:
 *
 *   1. Idempotent (safe to run multiple times via IF NOT EXISTS).
 *   2. Non-destructive (no DROP, no TRUNCATE, no UPDATE to existing rows).
 *   3. Backward-compatible (NULL = legacy cohort at the read boundary).
 *   4. Ready but NOT executed without owner authorization.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  AUTHORIZATION GATE                                                  │
 * │                                                                      │
 * │  runV2CohortAdditiveMigration() WILL NOT EXECUTE unless the env var  │
 * │  AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION is set to exactly "YES_I_    │
 * │  AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION" by the owner. This prompt   │
 * │  (Pack 32) is NOT that authorization.                                │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Tables affected (additive ALTER TABLE only):
 *   - paper_trade_fo      : + cohort_id VARCHAR(32)
 *   - paper_trade_eq      : + cohort_id VARCHAR(32)
 *   - paper_capital_event : + cohort_id VARCHAR(32)
 *
 * paper_account:
 *   Adding cohort_id to paper_account is a structural change (PK is
 *   segment; V2 accounts need a different segment+cohort composite key).
 *   This is deferred to a separate, explicitly authorized migration step.
 *   V2 accounts do not inherit any legacy balance — they have no account
 *   row while V2 is locked. The proof: no row = no inherited balance.
 *
 * Legacy backfill (OPTIONAL — not part of this authorization):
 *   UPDATE paper_trade_fo  SET cohort_id = 'FNO_PAPER_LEGACY'  WHERE cohort_id IS NULL;
 *   UPDATE paper_trade_eq  SET cohort_id = 'SWING_PAPER_LEGACY' WHERE cohort_id IS NULL;
 *   UPDATE paper_capital_event SET cohort_id = ...             WHERE cohort_id IS NULL;
 *   This backfill requires a separate authorization and is NOT included here.
 *
 * Migration impact report:
 *   - Table locks: short (ACCESS EXCLUSIVE only for ADD COLUMN; no full rewrite)
 *   - Index builds: CREATE INDEX CONCURRENTLY after column add (separate step)
 *   - Row counts: query at authorization time with the provided SQL
 *   - Rollback plan: DROP COLUMN cohort_id (data-safe, no historical rows deleted)
 *
 * @see paperCohort.ts   for the cohort domain contract
 * @see v2PaperLocks.ts  for the hard locks
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

const AUTHORIZATION_TOKEN = "YES_I_AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION";

/**
 * Static migration SQL — for documentation, audit, and the static impact report.
 * These statements are NEVER executed automatically.
 */
export const V2_COHORT_MIGRATION_SQL = {
  paperTradeFo: [
    `ALTER TABLE paper_trade_fo ADD COLUMN IF NOT EXISTS cohort_id VARCHAR(32);`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS paper_trade_fo_cohort_idx ON paper_trade_fo(cohort_id);`,
    `COMMENT ON COLUMN paper_trade_fo.cohort_id IS 'PaperCohortId; NULL = FNO_PAPER_LEGACY (two-phase compat)';`,
  ],
  paperTradeEq: [
    `ALTER TABLE paper_trade_eq ADD COLUMN IF NOT EXISTS cohort_id VARCHAR(32);`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS paper_trade_eq_cohort_idx ON paper_trade_eq(cohort_id);`,
    `COMMENT ON COLUMN paper_trade_eq.cohort_id IS 'PaperCohortId; NULL = SWING_PAPER_LEGACY (two-phase compat)';`,
  ],
  paperCapitalEvent: [
    `ALTER TABLE paper_capital_event ADD COLUMN IF NOT EXISTS cohort_id VARCHAR(32);`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS paper_capital_event_cohort_idx ON paper_capital_event(cohort_id);`,
    `COMMENT ON COLUMN paper_capital_event.cohort_id IS 'PaperCohortId; NULL = infer from segment (two-phase compat)';`,
  ],
  /** Optional legacy backfill — requires separate authorization. */
  legacyBackfill: [
    `UPDATE paper_trade_fo SET cohort_id = 'FNO_PAPER_LEGACY' WHERE cohort_id IS NULL;`,
    `UPDATE paper_trade_eq SET cohort_id = 'SWING_PAPER_LEGACY' WHERE cohort_id IS NULL;`,
    `UPDATE paper_capital_event SET cohort_id = CASE WHEN segment='FNO' THEN 'FNO_PAPER_LEGACY' WHEN segment='EQUITY' THEN 'SWING_PAPER_LEGACY' ELSE NULL END WHERE cohort_id IS NULL;`,
  ],
  /** Rollback plan — data-safe (no historical rows deleted). */
  rollback: [
    `ALTER TABLE paper_trade_fo DROP COLUMN IF EXISTS cohort_id;`,
    `ALTER TABLE paper_trade_eq DROP COLUMN IF EXISTS cohort_id;`,
    `ALTER TABLE paper_capital_event DROP COLUMN IF EXISTS cohort_id;`,
  ],
  /** Row-count queries for pre-migration impact assessment. */
  rowCountQueries: [
    `SELECT COUNT(*) AS fo_rows, COUNT(cohort_id) AS fo_with_cohort FROM paper_trade_fo;`,
    `SELECT COUNT(*) AS eq_rows, COUNT(cohort_id) AS eq_with_cohort FROM paper_trade_eq;`,
    `SELECT COUNT(*) AS evt_rows, COUNT(cohort_id) AS evt_with_cohort FROM paper_capital_event;`,
  ],
} as const;

/**
 * Returns the static migration impact report as a structured object.
 * Safe to call at any time — no DB access.
 */
export function getMigrationImpactReport(): {
  authorization: string;
  status: "READY_NOT_EXECUTED";
  tables: Array<{ table: string; statements: readonly string[] }>;
  legacyBackfill: readonly string[];
  rollback: readonly string[];
  rowCountQueries: readonly string[];
  notes: string[];
} {
  return {
    authorization: `Requires env var AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION = "${AUTHORIZATION_TOKEN}"`,
    status: "READY_NOT_EXECUTED",
    tables: [
      { table: "paper_trade_fo", statements: V2_COHORT_MIGRATION_SQL.paperTradeFo },
      { table: "paper_trade_eq", statements: V2_COHORT_MIGRATION_SQL.paperTradeEq },
      { table: "paper_capital_event", statements: V2_COHORT_MIGRATION_SQL.paperCapitalEvent },
    ],
    legacyBackfill: V2_COHORT_MIGRATION_SQL.legacyBackfill,
    rollback: V2_COHORT_MIGRATION_SQL.rollback,
    rowCountQueries: V2_COHORT_MIGRATION_SQL.rowCountQueries,
    notes: [
      "ADD COLUMN IF NOT EXISTS takes a brief ACCESS EXCLUSIVE lock but does not rewrite rows (PostgreSQL 11+).",
      "CREATE INDEX CONCURRENTLY does not lock the table; run separately after the ADD COLUMN.",
      "Rollback (DROP COLUMN) is data-safe: it removes only the new column, never existing rows.",
      "Legacy backfill is optional and requires a separate authorization step.",
      "paper_account cohort isolation deferred: V2 accounts will be new rows when activated.",
    ],
  };
}

/**
 * Execute the additive V2 cohort migration. AUTHORIZATION GATE: will NOT run
 * unless AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION === the exact token.
 *
 * This function is NOT called from application startup, scheduler boot, or
 * any other automatic path. It is only callable from a guarded admin endpoint
 * after the owner explicitly sets the authorization env var.
 */
export async function runV2CohortAdditiveMigration(): Promise<{
  authorized: boolean;
  executed: boolean;
  statements: string[];
  errors: string[];
}> {
  const authToken = process.env["AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION"];
  if (authToken !== AUTHORIZATION_TOKEN) {
    logger.warn(
      { providedToken: authToken ? "[SET_BUT_WRONG]" : "[NOT_SET]" },
      "V2 cohort migration: AUTHORIZATION_TOKEN not matched — migration NOT executed",
    );
    return { authorized: false, executed: false, statements: [], errors: [] };
  }

  logger.info("V2 cohort migration: authorization token matched — executing additive migration");
  const executed: string[] = [];
  const errors: string[] = [];

  const statements = [
    ...V2_COHORT_MIGRATION_SQL.paperTradeFo,
    ...V2_COHORT_MIGRATION_SQL.paperTradeEq,
    ...V2_COHORT_MIGRATION_SQL.paperCapitalEvent,
  ].filter((s) => !s.startsWith("CREATE INDEX CONCURRENTLY")); // run CONCURRENTLY steps separately

  for (const stmt of statements) {
    try {
      await db.execute(sql.raw(stmt));
      executed.push(stmt);
      logger.info({ stmt }, "V2 cohort migration: statement OK");
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(`${stmt} → ${msg}`);
      logger.error({ stmt, err: msg }, "V2 cohort migration: statement FAILED");
    }
  }

  return { authorized: true, executed: errors.length === 0, statements: executed, errors };
}

/**
 * Check whether the cohort_id column already exists on the given table.
 * Safe read-only check — used by the diagnostic endpoint.
 */
export async function checkCohortColumnExists(table: "paper_trade_fo" | "paper_trade_eq" | "paper_capital_event"): Promise<boolean> {
  try {
    const result = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = 'cohort_id';
    `)) as unknown as { rows: Array<{ n: number }> };
    return (result.rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
