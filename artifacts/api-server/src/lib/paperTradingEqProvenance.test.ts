import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, paperTradeEqTable, paperEqAuditTable } from "@workspace/db";
import { applyPaperEqProvenanceColumns, mapWriteSourceToProvenance } from "./paperTradingEq";

/**
 * Checkpoint 2 (2026-07-03) — source-stamping + backfill regression tests.
 * See `applyPaperEqProvenanceColumns()` doc comment for the 4-step backfill
 * this pins: correlate by (symbol, IST-day), fall back to LEGACY_UNKNOWN,
 * back-link the audit row. Never fabricates AUTO/MANUAL when unknown.
 *
 * NOTE: these live-DB tests use real commit + explicit cleanup (NOT the
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

function swallowIntentionalRollback(_err: unknown): void {
  // unused now that we no longer roll back; kept as a no-op stub in case a
  // future edit reintroduces a tx — see file-level note above.
}
void swallowIntentionalRollback;

describe("mapWriteSourceToProvenance (pure write-path mapping)", () => {
  it("maps MANUAL -> MANUAL_BUY", () => {
    expect(mapWriteSourceToProvenance("MANUAL")).toBe("MANUAL_BUY");
  });

  it("maps AUTO -> AUTO_STRONG_BUY", () => {
    expect(mapWriteSourceToProvenance("AUTO")).toBe("AUTO_STRONG_BUY");
  });

  it("maps undefined -> AUTO_STRONG_BUY (existing callers never pass MANUAL by omission)", () => {
    expect(mapWriteSourceToProvenance(undefined)).toBe("AUTO_STRONG_BUY");
  });

  it("never returns SWING_STAGED_APPROVAL — no live caller feeds that source yet", () => {
    expect(mapWriteSourceToProvenance("AUTO")).not.toBe("SWING_STAGED_APPROVAL");
    expect(mapWriteSourceToProvenance("MANUAL")).not.toBe("SWING_STAGED_APPROVAL");
  });
});

const dbAvailable = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("dummy"));
const describeDb = dbAvailable ? describe : describe.skip;

async function cleanup(symbol: string): Promise<void> {
  await db.delete(paperEqAuditTable).where(eq(paperEqAuditTable.symbol, symbol));
  await db.delete(paperTradeEqTable).where(eq(paperTradeEqTable.symbol, symbol));
}

describeDb("applyPaperEqProvenanceColumns — live DB backfill idempotency", () => {
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
