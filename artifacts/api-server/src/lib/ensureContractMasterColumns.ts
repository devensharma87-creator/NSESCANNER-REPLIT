/**
 * Contract Master provenance columns — memoized schema migration.
 *
 * Additive nullable columns on paper_trade_fo and backtest_trades, applied via
 * raw `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (never `drizzle-kit push`,
 * which would attempt to DROP out-of-schema tables in this DB). Pattern mirrors
 * `fnoExitMonitorHealth.ts` and `fnoMarketShadowCapture.ts`.
 *
 * paper_trade_fo:
 *   lot_size_source TEXT            — "instrument_master" | "static_fallback"
 *   contract_instrument_token TEXT  — Kite instrument_token (stringified int)
 *   contract_grade TEXT             — "trade_grade" | "info_only" | "fallback"
 *   contract_fallback_reason TEXT   — why fallback was used (null when trade_grade)
 *
 * backtest_trades:
 *   lot_size_source TEXT   — "static_map" (backtest always uses LOT_SIZES)
 *   lot_size_regime TEXT   — lot-size table version label (e.g. "2026-JAN-NSE-REVISION")
 *
 * Callers must await `ensureContractMasterSchemaColumns()` before the first
 * INSERT that writes these columns. The exported promise is memoized — one DB
 * round-trip total per process lifetime.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

export async function applyContractMasterColumns(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE paper_trade_fo
      ADD COLUMN IF NOT EXISTS lot_size_source TEXT,
      ADD COLUMN IF NOT EXISTS contract_instrument_token TEXT,
      ADD COLUMN IF NOT EXISTS contract_grade TEXT,
      ADD COLUMN IF NOT EXISTS contract_fallback_reason TEXT
  `);
  await db.execute(sql`
    ALTER TABLE backtest_trades
      ADD COLUMN IF NOT EXISTS lot_size_source TEXT,
      ADD COLUMN IF NOT EXISTS lot_size_regime TEXT
  `);
  logger.info("ensureContractMasterColumns: contract-master provenance columns ready");
}

let migrationPromise: Promise<void> | null = null;

/**
 * Memoized, idempotent schema-ready gate. First caller triggers the migration;
 * every subsequent caller in this process lifetime awaits the same resolved
 * promise — effectively free after the first call. On failure the promise is
 * cleared so a later call can retry.
 */
export function ensureContractMasterSchemaColumns(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = applyContractMasterColumns().catch((err: unknown) => {
      migrationPromise = null;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "ensureContractMasterColumns: migration failed (will retry next call)",
      );
      throw err;
    });
  }
  return migrationPromise;
}
