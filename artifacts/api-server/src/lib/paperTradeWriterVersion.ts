/**
 * B.8 — Paper-trade row provenance tag.
 *
 * Adds a nullable `writer_version` text column to `paper_trade_fo` and
 * `paper_trade_eq`. New rows are stamped with `CURRENT_WRITER_VERSION`
 * (a hardcoded string that bumps whenever the writer path materially
 * changes — new column, new charge model, new lifecycle transition,
 * etc). Old rows carry NULL and stay honestly unlabelled — never
 * back-filled, never fabricated.
 *
 * Consumer contract:
 *   • NULL             → row was written before B.8; treat as legacy.
 *                        Do NOT assume any charges / audit columns are
 *                        populated. Reports must label these clearly.
 *   • non-NULL         → row was written by a specific writer version.
 *                        Consumers can key on this to know which fix
 *                        window applied (e.g. B.5 block-reason clarity,
 *                        B.6/B.7 charges when durable).
 *
 * Pattern mirrors `applyFnoExitMonitorSchemaColumns` — additive nullable
 * columns via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, NEVER
 * `drizzle-kit push` (would attempt to drop tables in this DB). Memoized
 * so the ALTER runs once per process lifetime; retries on transient DB
 * blips instead of wedging permanently.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Semver-ish string that identifies the current writer version. Bump the
 * suffix whenever the paper-trade writer path changes materially so the
 * consumer can key on the tag to know which fix window applied.
 *
 *   v1.0.0 — 2026-07-14: B.8 tagging introduced. Reconciliation identity
 *            + chargesEstimate readable but not persisted; no durable
 *            charges column yet.
 *   v1.1.0-charges — 2026-07-14: P0 Phase A. Durable charges columns
 *            stamped on close (gross/charges/net + status='CURRENT').
 *            Balance still gross — chargesTotal was NOT subtracted from
 *            paper_account.balance.
 *   v1.2.0-ledger-net — 2026-07-15: P0 Phase B (owner-approved). Balance
 *            writer path now subtracts chargesTotal on every close. The
 *            reconciliation identity keys on charges_status: rows tagged
 *            'CURRENT' contribute NET pnl (gross − charges) to the
 *            identity; LEGACY_NOT_STORED rows contribute gross (their
 *            historical balance write did not deduct charges).
 */
export const CURRENT_WRITER_VERSION = "paper-writer-v1.2.0-ledger-net";

// ── P0 durable charges (Phase A) ────────────────────────────────────────

/** Enum-by-convention values for `charges_status`. Kept as a plain
 *  string union so consumers can key on the exact values without a
 *  runtime enum table. LEGACY_NOT_STORED = pre-P0 row (writer_version
 *  is null OR < "paper-writer-v1.1.0-charges"). CURRENT = new writer
 *  stamped all seven charges columns. RECONSTRUCTED_FROM_CURRENT_MODEL
 *  is reserved for a future owner-approved back-fill; never written by
 *  this pack. */
export type ChargesStatus =
  | "CURRENT"
  | "LEGACY_NOT_STORED"
  | "RECONSTRUCTED_FROM_CURRENT_MODEL";

async function applyWriterVersionColumn(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE paper_trade_fo
      ADD COLUMN IF NOT EXISTS writer_version TEXT
  `);
  await db.execute(sql`
    ALTER TABLE paper_trade_eq
      ADD COLUMN IF NOT EXISTS writer_version TEXT
  `);
  await db.execute(sql`
    ALTER TABLE paper_trade_combo
      ADD COLUMN IF NOT EXISTS writer_version TEXT
  `);
}

/**
 * P0 Phase A — additive nullable durable charges columns on
 * paper_trade_fo / paper_trade_eq / paper_trade_combo.
 *
 * Every column below is created with `ADD COLUMN IF NOT EXISTS`, so
 * calling this multiple times is safe. Nullable — pre-P0 rows keep
 * NULL and are labelled `charges_status = 'LEGACY_NOT_STORED'`. New
 * rows get stamped by the writer at close time.
 *
 * The paper_account.balance writer path is NOT altered in Phase A
 * (owner approval Q4=b) — reconciliation identity stays gross. Phase
 * B (decrement balance by charges + seed refill migration) will need
 * a separate owner sign-off.
 */
async function applyDurableChargesColumns(): Promise<void> {
  const tables = ["paper_trade_fo", "paper_trade_eq", "paper_trade_combo"];
  for (const t of tables) {
    // Individual statements so a partial-apply on one table still
    // makes forward progress on the others. `ADD COLUMN IF NOT EXISTS`
    // is idempotent — safe to re-run every boot.
    await db.execute(sql.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS gross_pnl NUMERIC(18,2)`));
    await db.execute(sql.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS charges_total NUMERIC(18,2)`));
    await db.execute(sql.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS charges_breakdown_json JSONB`));
    await db.execute(sql.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS charges_model_version TEXT`));
    await db.execute(sql.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS charges_calculated_at TIMESTAMPTZ`));
    await db.execute(sql.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS net_pnl NUMERIC(18,2)`));
    await db.execute(sql.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS charges_status TEXT`));
  }
}

let migrationPromise: Promise<void> | null = null;
let chargesMigrationPromise: Promise<void> | null = null;

/** Memoized, idempotent schema-ready gate. First caller triggers the
 *  migration; every subsequent caller (this process lifetime) awaits
 *  the same resolved promise — free after the first call. Cleared on
 *  failure so a later call can retry. */
export function ensurePaperTradeWriterVersionColumn(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = applyWriterVersionColumn().catch((err: unknown) => {
      migrationPromise = null;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "paper-trade writer_version column migration failed, will retry",
      );
      throw err;
    });
  }
  return migrationPromise;
}

/** P0 Phase A companion to ensurePaperTradeWriterVersionColumn — adds
 *  the seven durable-charges columns on all three paper-trade tables.
 *  Same memoize + retry contract. */
export function ensurePaperTradeChargesColumns(): Promise<void> {
  if (!chargesMigrationPromise) {
    chargesMigrationPromise = applyDurableChargesColumns().catch((err: unknown) => {
      chargesMigrationPromise = null;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "paper-trade durable-charges column migration failed, will retry",
      );
      throw err;
    });
  }
  return chargesMigrationPromise;
}
