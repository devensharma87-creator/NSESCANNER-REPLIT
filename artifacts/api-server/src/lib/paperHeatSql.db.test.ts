import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { checkDbTestIsolation } from "../test-infra/dbTestGuard.js";

// ── dynamic module handles (loaded after isolation check) ──────────────────
let db: Awaited<typeof import("@workspace/db")>["db"];
let pool: Awaited<typeof import("@workspace/db")>["pool"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let paperTradeEqTable: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let HEAT_SQL_EQ: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parseHeatRow: any;

let _loaded = false;
async function loadDbModules(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  checkDbTestIsolation();
  const [dbMod, accMod] = await Promise.all([
    import("@workspace/db"),
    import("./paperAccount.js"),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _db = dbMod as any;
  db = _db.db;
  pool = _db.pool;
  paperTradeEqTable = _db.paperTradeEqTable;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _acc = accMod as any;
  HEAT_SQL_EQ = _acc.HEAT_SQL_EQ;
  parseHeatRow = _acc.parseHeatRow;
}

function swallowIntentionalRollback(err: unknown): void {
  if (err instanceof TransactionRollbackError) return;
  throw err;
}

/**
 * Live DB round-trip: insert a known OPEN equity row inside a transaction,
 * execute HEAT_SQL_EQ, assert the heat matches qty * (entry_price - stop_price),
 * then ROLLBACK so the test leaves zero footprint.
 */
describe("HEAT_SQL_EQ — live DB execution against the real schema", () => {
  beforeAll(loadDbModules);

  afterAll(async () => {
    if (pool) await pool.end().catch(() => {});
  });

  it("computes heat = qty * GREATEST(entry_price - stop_price, 0) on a seeded OPEN row", async () => {
    await db.transaction(async (tx) => {
      const heatBefore = parseHeatRow(await tx.execute(HEAT_SQL_EQ));

      const QTY = 7;
      const ENTRY = 100;
      const STOP = 95;
      const expectedDelta = QTY * (ENTRY - STOP); // = 35

      await tx.insert(paperTradeEqTable).values({
        symbol: "__HEAT_TEST__",
        name: "Heat SQL regression",
        signalDate: "2099-01-01",
        signalTriggeredAt: new Date("2099-01-01T03:45:00Z"),
        qty: QTY,
        entryPrice: ENTRY.toString(),
        stopPrice: STOP.toString(),
        target1Price: (ENTRY * 1.05).toString(),
        target2Price: (ENTRY * 1.10).toString(),
        capitalDeployed: (QTY * ENTRY).toString(),
        lastPrice: ENTRY.toString(),
        status: "OPEN",
      });

      const heatAfter = parseHeatRow(await tx.execute(HEAT_SQL_EQ));
      expect(heatAfter - heatBefore).toBeCloseTo(expectedDelta, 6);

      tx.rollback();
    }).catch(swallowIntentionalRollback);
  });

  it("inverted stop (stop > entry) contributes 0 — GREATEST clamp works", async () => {
    await db.transaction(async (tx) => {
      const heatBefore = parseHeatRow(await tx.execute(HEAT_SQL_EQ));

      await tx.insert(paperTradeEqTable).values({
        symbol: "__HEAT_TEST_INV__",
        name: "Heat SQL inverted-stop",
        signalDate: "2099-01-02",
        signalTriggeredAt: new Date("2099-01-02T03:45:00Z"),
        qty: 10,
        entryPrice: "100",
        stopPrice: "120",
        target1Price: "110",
        target2Price: "130",
        capitalDeployed: "1000",
        lastPrice: "100",
        status: "OPEN",
      });

      const heatAfter = parseHeatRow(await tx.execute(HEAT_SQL_EQ));
      expect(heatAfter - heatBefore).toBeCloseTo(0, 6);

      tx.rollback();
    }).catch(swallowIntentionalRollback);
  });

  it("CLOSED rows are excluded from the heat calculation", async () => {
    await db.transaction(async (tx) => {
      const heatBefore = parseHeatRow(await tx.execute(HEAT_SQL_EQ));

      await tx.insert(paperTradeEqTable).values({
        symbol: "__HEAT_TEST_CLOSED__",
        name: "Heat SQL closed-row",
        signalDate: "2099-01-03",
        signalTriggeredAt: new Date("2099-01-03T03:45:00Z"),
        qty: 50,
        entryPrice: "200",
        stopPrice: "180",
        target1Price: "220",
        target2Price: "240",
        capitalDeployed: "10000",
        lastPrice: "200",
        status: "CLOSED",
        exitedAt: new Date("2099-01-03T09:50:00Z"),
        exitPrice: "210",
        exitReason: "TARGET1_HIT",
        realizedPnl: "500",
      });

      const heatAfter = parseHeatRow(await tx.execute(HEAT_SQL_EQ));
      expect(heatAfter - heatBefore).toBeCloseTo(0, 6);

      tx.rollback();
    }).catch(swallowIntentionalRollback);
  });
});
