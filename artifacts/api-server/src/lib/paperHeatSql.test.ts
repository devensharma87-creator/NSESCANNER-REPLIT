import { afterAll, describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { db, pool, paperTradeEqTable } from "@workspace/db";
import { HEAT_SQL_EQ, HEAT_SQL_FNO, parseHeatRow } from "./paperAccount";

/**
 * Regression tests for the heat-cap SQL fragments in paperAccount.ts.
 *
 * The 2026-05-13 incident was a column-name typo: HEAT_SQL_EQ referenced
 * non-existent `entry` / `stop_loss` columns (the schema is `entry_price` /
 * `stop_price`). Every equity swing open under heat-cap evaluation threw
 * `Failed query` and the wrapper silently skipped the trade with a
 * "continuing" warn — so real trades were missed for days before anyone
 * noticed. These tests pin both the rendered SQL text AND a live DB
 * round-trip so a future schema rename or fragment edit can't recreate
 * the silent breakage.
 */

const dialect = new PgDialect();

function renderSql(fragment: ReturnType<typeof sql>): string {
  return dialect.sqlToQuery(fragment).sql;
}

describe("HEAT_SQL_EQ — text shape (catches column-name drift at typecheck-equivalent)", () => {
  const text = renderSql(HEAT_SQL_EQ);

  it("references the actual schema columns entry_price + stop_price", () => {
    expect(text).toMatch(/\bentry_price\b/);
    expect(text).toMatch(/\bstop_price\b/);
  });

  it("does NOT reference the legacy / typo columns entry / stop_loss", () => {
    // Word-boundary checks so "entry_price" doesn't accidentally match "entry".
    expect(text).not.toMatch(/\bentry\b(?!_price)/);
    expect(text).not.toMatch(/\bstop_loss\b/);
  });

  it("scopes the heat to OPEN equity rows only", () => {
    expect(text).toMatch(/FROM\s+paper_trade_eq/i);
    expect(text).toMatch(/status\s*=\s*'OPEN'/i);
  });

  it("uses GREATEST(entry-stop, 0) so an inverted stop can't subtract from heat", () => {
    expect(text).toMatch(/GREATEST\s*\(\s*entry_price\s*-\s*stop_price\s*,\s*0\s*\)/i);
  });
});

describe("HEAT_SQL_FNO — text shape (companion fragment, pinned for parity)", () => {
  const text = renderSql(HEAT_SQL_FNO);

  it("references the actual schema columns entry_premium + stop_premium", () => {
    expect(text).toMatch(/\bentry_premium\b/);
    expect(text).toMatch(/\bstop_premium\b/);
    expect(text).toMatch(/\blots\b/);
    expect(text).toMatch(/\blot_size\b/);
  });
});

/**
 * Live DB round-trip: insert a known OPEN equity row inside a transaction,
 * execute HEAT_SQL_EQ, assert the heat matches qty * (entry_price - stop_price),
 * then ROLLBACK so the test leaves zero footprint on the dev DB. Skips
 * cleanly when DATABASE_URL is unset (CI without DB).
 */
const dbAvailable = Boolean(process.env.DATABASE_URL);
const describeDb = dbAvailable ? describe : describe.skip;

describeDb("HEAT_SQL_EQ — live DB execution against the real schema", () => {
  afterAll(async () => {
    // Release the shared pool so vitest can exit cleanly.
    await pool.end().catch(() => {});
  });

  it("computes heat = qty * GREATEST(entry_price - stop_price, 0) on a seeded OPEN row", async () => {
    await db.transaction(async (tx) => {
      // Capture the pre-existing live heat so we can subtract it out and
      // assert ONLY the seeded row's contribution. (We can't assume an
      // empty table — the dev DB has real OPEN rows from the live system.)
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

      // Roll back so the test row never lands.
      tx.rollback();
    }).catch((err: unknown) => {
      // drizzle's tx.rollback() throws a sentinel; rethrow real errors.
      const isRollbackSentinel =
        err instanceof Error && /rollback/i.test(err.message);
      if (!isRollbackSentinel) throw err;
    });
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
        stopPrice: "120", // stop ABOVE entry — heat would go negative without GREATEST
        target1Price: "110",
        target2Price: "130",
        capitalDeployed: "1000",
        lastPrice: "100",
        status: "OPEN",
      });

      const heatAfter = parseHeatRow(await tx.execute(HEAT_SQL_EQ));
      expect(heatAfter - heatBefore).toBeCloseTo(0, 6);

      tx.rollback();
    }).catch((err: unknown) => {
      const isRollbackSentinel =
        err instanceof Error && /rollback/i.test(err.message);
      if (!isRollbackSentinel) throw err;
    });
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
        stopPrice: "180", // would contribute 50 * 20 = 1000 if OPEN
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
    }).catch((err: unknown) => {
      const isRollbackSentinel =
        err instanceof Error && /rollback/i.test(err.message);
      if (!isRollbackSentinel) throw err;
    });
  });
});
