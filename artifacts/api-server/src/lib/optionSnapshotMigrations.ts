/**
 * Runtime additive migrations for the option_chain_snapshot schema.
 *
 * Uses ALTER TABLE … ADD COLUMN IF NOT EXISTS so that the call is safe on
 * both fresh and already-migrated databases. Each migration is idempotent
 * and append-only — it NEVER drops, renames or alters existing columns.
 *
 * Must be called once before the first snapshot upsert (call from
 * `startOptionSnapshotIngestor` before the first tick fires).
 *
 * Pack 9A adds four columns to the v1 schema:
 *   - schema_version VARCHAR(8)   — replay-compatibility version tag
 *   - lot_size       INTEGER       — date-effective lot size at capture
 *   - market_status  VARCHAR(16)  — open/pre_open/closed at capture time
 *   - canary_marker  VARCHAR(64)  — exact-key canary isolation marker
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

let migrationComplete = false;

/**
 * Lazily (once per process) ensure that the Pack 9A schema columns exist.
 * Idempotent — safe to call redundantly. Throws on unexpected DB errors.
 */
export async function ensureOptionSnapshotV1Schema(): Promise<void> {
  if (migrationComplete) return;
  try {
    await db.execute(sql`
      ALTER TABLE option_chain_snapshot
        ADD COLUMN IF NOT EXISTS schema_version VARCHAR(8)  DEFAULT 'v1',
        ADD COLUMN IF NOT EXISTS lot_size        INTEGER,
        ADD COLUMN IF NOT EXISTS market_status   VARCHAR(16),
        ADD COLUMN IF NOT EXISTS canary_marker   VARCHAR(64);
    `);
    logger.info("option-snapshot-migrations: v1 columns ensured (idempotent)");
    migrationComplete = true;
  } catch (err) {
    // If the table does not yet exist, let the caller handle it.
    // If it does exist and columns already present, IF NOT EXISTS protects us.
    const msg = (err as Error).message ?? String(err);
    if (msg.includes("does not exist")) {
      logger.warn({ msg }, "option-snapshot-migrations: table missing, skipping (will retry)");
      return; // do NOT set migrationComplete — allow retry after schema is created
    }
    throw err;
  }
}

/** Force-reset the idempotency latch — for tests only. */
export function _resetMigrationLatch(): void {
  migrationComplete = false;
}
