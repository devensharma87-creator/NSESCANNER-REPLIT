/**
 * Paper trading equity provenance — DB integration tests.
 *
 * DB INTEGRATION FILE (.db.test.ts)
 * ----------------------------------------
 * These tests require a live PostgreSQL database. They run ONLY via
 * `pnpm run test:db` (dbTestPreflightRunner) with an isolated test database.
 * They must never run against the operational DATABASE_URL.
 *
 * NOTE: pure mapWriteSourceToProvenance tests have been extracted to
 * paperTradingEqProvenance.pure.test.ts (P0.1B refactor).
 *
 * NOTE: These live-DB tests use real commit + explicit cleanup (NOT the
 * usual tx-rollback pattern) because `applyPaperEqProvenanceColumns()` runs
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on every call, which always
 * requests an ACCESS EXCLUSIVE lock even when the column already exists.
 * Wrapping the seed inserts in an open `db.transaction` and then calling the
 * backfill (on the separate `db` pool connection) from inside that same
 * transaction deadlocks — the ALTER blocks forever waiting for the open
 * transaction's row lock to release, and the transaction never rolls back
 * because it's still awaiting the ALTER. See memory:
 * fno-exit-monitor-ddl-lock-deadlock.md for the general pattern.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkDbTestIsolation } from "../test-infra/dbTestGuard.js";

// ---------------------------------------------------------------------------
// P0.1 Isolation guard — must pass before any DB describe block runs.
// ---------------------------------------------------------------------------
const isolationResult = checkDbTestIsolation(process.env as Record<string, string | undefined>);
if (!isolationResult.ok) {
  console.warn(
    `[paperTradingEqProvenance] DB-backed tests SKIPPED — isolation guard: ${isolationResult.code}: ${isolationResult.reason}`,
  );
}
const describeDb = isolationResult.ok ? describe : describe.skip;

// ---------------------------------------------------------------------------
// P0.1B import-time safety: DB-connected modules are loaded dynamically
// inside beforeAll() — AFTER the isolation guard passes.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let pool: any;
let paperTradeEqTable: any;
let paperEqAuditTable: any;
let applyPaperEqProvenanceColumns: any;
let eq: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

let _provModulesLoaded = false;
async function loadProvModules(): Promise<void> {
  if (_provModulesLoaded) return;
  _provModulesLoaded = true;
  const [dbMod, drizzle, ptMod] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
    import("./paperTradingEq.js"),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbModAny = dbMod as any;
  db                          = dbModAny.db;
  pool                        = dbModAny.pool;
  paperTradeEqTable           = dbModAny.paperTradeEqTable;
  paperEqAuditTable           = dbModAny.paperEqAuditTable;
  eq                          = drizzle.eq;
  applyPaperEqProvenanceColumns = ptMod.applyPaperEqProvenanceColumns;
}

function swallowIntentionalRollback(_err: unknown): void {
  // unused now that we no longer roll back; kept as a no-op stub in case a
  // future edit reintroduces a tx — see file-level note above.
}
void swallowIntentionalRollback;

async function cleanup(symbol: string): Promise<void> {
  await db.delete(paperEqAuditTable).where(eq(paperEqAuditTable.symbol, symbol));
  await db.delete(paperTradeEqTable).where(eq(paperTradeEqTable.symbol, symbol));
}

describeDb("applyPaperEqProvenanceColumns — live DB backfill idempotency", () => {
  beforeAll(async () => {
    await loadProvModules();
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  it("backfills a pre-Checkpoint-2 trade row from its matching AUTO audit row, is idempotent, and never touches an already-sourced row", async () => {
    const symbol = "__PROV_TEST_AUTO__";
    try {
      await db.insert(paperTradeEqTable).values({
        symbol,
        name: "Provenance backfill regression (AUTO)",
        signalDate: "2099-02-01",
        signalTriggeredAt: new Date("2099-02-01T03:45:00Z"),
        qty: 1,
        entryPrice: "100",
        stopPrice: "95",
        target1Price: "110",
        target2Price: "120",
        capitalDeployed: "100",
        lastPrice: "100",
        status: "OPEN",
        // source intentionally omitted -> simulates a pre-Checkpoint-2 NULL row
      });

      await db.insert(paperEqAuditTable).values({
        ts: new Date("2099-02-01T03:45:10Z"),
        symbol,
        decision: "OPEN",
        reason: "SIGNAL_TRIGGERED",
        source: "AUTO",
      });

      await applyPaperEqProvenanceColumns();

      const [row] = await db.select().from(paperTradeEqTable).where(eq(paperTradeEqTable.symbol, symbol));
      expect(row?.source).toBe("AUTO_STRONG_BUY");

      const [auditRow] = await db
        .select()
        .from(paperEqAuditTable)
        .where(eq(paperEqAuditTable.symbol, symbol));
      expect(auditRow?.paperTradeId).toBe(row?.id);

      // Re-running must be a no-op (idempotent) — value stays identical.
      await applyPaperEqProvenanceColumns();
      const [rowAgain] = await db.select().from(paperTradeEqTable).where(eq(paperTradeEqTable.symbol, symbol));
      expect(rowAgain?.source).toBe("AUTO_STRONG_BUY");
    } finally {
      await cleanup(symbol);
    }
  }, 20000);

  it("labels an orphan trade row (no matching audit row) as LEGACY_UNKNOWN — never fabricated as AUTO/MANUAL", async () => {
    const symbol = "__PROV_TEST_ORPHAN__";
    try {
      await db.insert(paperTradeEqTable).values({
        symbol,
        name: "Provenance backfill regression (orphan)",
        signalDate: "2099-02-02",
        signalTriggeredAt: new Date("2099-02-02T03:45:00Z"),
        qty: 1,
        entryPrice: "100",
        stopPrice: "95",
        target1Price: "110",
        target2Price: "120",
        capitalDeployed: "100",
        lastPrice: "100",
        status: "OPEN",
        // no matching paper_eq_audit row inserted at all
      });

      await applyPaperEqProvenanceColumns();

      const [row] = await db.select().from(paperTradeEqTable).where(eq(paperTradeEqTable.symbol, symbol));
      expect(row?.source).toBe("LEGACY_UNKNOWN");
    } finally {
      await cleanup(symbol);
    }
  }, 20000);

  it("does not overwrite a row that already has a source stamped at write time", async () => {
    const symbol = "__PROV_TEST_ALREADY_SOURCED__";
    try {
      await db.insert(paperTradeEqTable).values({
        symbol,
        name: "Provenance backfill regression (already sourced)",
        signalDate: "2099-02-03",
        signalTriggeredAt: new Date("2099-02-03T03:45:00Z"),
        qty: 1,
        entryPrice: "100",
        stopPrice: "95",
        target1Price: "110",
        target2Price: "120",
        capitalDeployed: "100",
        lastPrice: "100",
        status: "OPEN",
        source: "MANUAL_BUY",
      });

      // Even with a contradicting AUTO audit row present, an already-sourced
      // trade must not be reclassified — the backfill only fills NULLs.
      await db.insert(paperEqAuditTable).values({
        ts: new Date("2099-02-03T03:45:10Z"),
        symbol,
        decision: "OPEN",
        reason: "SIGNAL_TRIGGERED",
        source: "AUTO",
      });

      await applyPaperEqProvenanceColumns();

      const [row] = await db.select().from(paperTradeEqTable).where(eq(paperTradeEqTable.symbol, symbol));
      expect(row?.source).toBe("MANUAL_BUY");
    } finally {
      await cleanup(symbol);
    }
  }, 20000);
});
