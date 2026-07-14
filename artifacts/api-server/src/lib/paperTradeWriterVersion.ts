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
 */
export const CURRENT_WRITER_VERSION = "paper-writer-v1.0.0";

async function applyWriterVersionColumn(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE paper_trade_fo
      ADD COLUMN IF NOT EXISTS writer_version TEXT
  `);
  await db.execute(sql`
    ALTER TABLE paper_trade_eq
      ADD COLUMN IF NOT EXISTS writer_version TEXT
  `);
}

let migrationPromise: Promise<void> | null = null;

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
