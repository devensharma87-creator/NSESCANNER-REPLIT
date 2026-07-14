import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  paperAccountTable,
  paperCapitalEventTable,
} from "@workspace/db";
import type { Segment } from "./paperAccount";
import {
  topupAccount,
  withdrawAccount,
  getCapitalMovements,
} from "./paperAccount";

/**
 * Live-DB tests for the capital-movement ledger (ADD_CAPITAL /
 * WITHDRAW_CAPITAL). `topupAccount` / `withdrawAccount` each manage their
 * own transaction internally, so we can't isolate them with an outer
 * rollback — instead we operate on a UNIQUE throwaway segment and delete
 * its rows in afterAll, leaving zero footprint on the real FNO/EQUITY rows.
 *
 * Pins the OWNER-APPROVED invariants:
 *   - add ↑ balance, withdraw ↓ balance, both write a ledger row in lockstep
 *   - withdrawal that exceeds available cash is BLOCKED (balance never < 0)
 *   - getCapitalMovements sums the ledger by direction
 *   - a capital move is NOT P&L (day_realized_pnl is never touched)
 *
 * Skips cleanly when DATABASE_URL is unset (CI without a DB).
 */
const dbAvailable = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("dummy"));
const describeDb = dbAvailable ? describe : describe.skip;

// Unique per-process so parallel test files (threads pool) never collide.
const TEST_SEG = `__CAPTEST_${process.pid}_${Date.now()}__` as Segment;

async function cleanup(): Promise<void> {
  await db.delete(paperCapitalEventTable).where(eq(paperCapitalEventTable.segment, TEST_SEG));
  await db.delete(paperAccountTable).where(eq(paperAccountTable.segment, TEST_SEG));
}

async function readAccount(): Promise<{ balance: number; dayRealizedPnl: number }> {
  const rows = await db
    .select({
      balance: paperAccountTable.balance,
      dayRealizedPnl: paperAccountTable.dayRealizedPnl,
    })
    .from(paperAccountTable)
    .where(eq(paperAccountTable.segment, TEST_SEG))
    .limit(1);
  const r = rows[0]!;
  return { balance: parseFloat(r.balance), dayRealizedPnl: parseFloat(r.dayRealizedPnl) };
}

describeDb("paper capital events — add / withdraw / ledger", () => {
  afterAll(async () => {
    await cleanup().catch(() => {});
    await pool.end().catch(() => {});
  });

  it("ADD_CAPITAL raises the balance and writes a ledger row", async () => {
    await cleanup();
    const r = await topupAccount(TEST_SEG, 5_000);
    expect(r.ok).toBe(true);
    // Test segment seeds at 0 (no SEED_CAPITAL entry), so balance == amount.
    expect(r.newBalance).toBeCloseTo(5_000, 6);

    const moves = await getCapitalMovements(TEST_SEG);
    expect(moves.added).toBeCloseTo(5_000, 6);
    expect(moves.withdrawn).toBeCloseTo(0, 6);

    const acct = await readAccount();
    expect(acct.balance).toBeCloseTo(5_000, 6);
  });

  it("WITHDRAW_CAPITAL lowers the balance and accumulates in the ledger", async () => {
    const r = await withdrawAccount(TEST_SEG, 2_000);
    expect(r.ok).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.newBalance).toBeCloseTo(3_000, 6);

    const moves = await getCapitalMovements(TEST_SEG);
    expect(moves.added).toBeCloseTo(5_000, 6);
    expect(moves.withdrawn).toBeCloseTo(2_000, 6);
  });

  it("withdrawal exceeding available cash is BLOCKED — balance can't go negative", async () => {
    const before = await readAccount();
    const r = await withdrawAccount(TEST_SEG, 999_999);
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("INSUFFICIENT_CASH");
    expect(r.newBalance).toBeCloseTo(before.balance, 6);

    const after = await readAccount();
    expect(after.balance).toBeCloseTo(before.balance, 6);
    expect(after.balance).toBeGreaterThanOrEqual(0);

    // Blocked attempt must NOT write a ledger row.
    const moves = await getCapitalMovements(TEST_SEG);
    expect(moves.withdrawn).toBeCloseTo(2_000, 6);
  });

  it("a capital move is NOT P&L — day_realized_pnl is never touched", async () => {
    const before = await readAccount();
    await topupAccount(TEST_SEG, 1_000);
    await withdrawAccount(TEST_SEG, 500);
    const after = await readAccount();
    expect(after.dayRealizedPnl).toBeCloseTo(before.dayRealizedPnl, 6);
  });

  it("persists optional note + created_by on the ledger row", async () => {
    await topupAccount(TEST_SEG, 1_234, { note: "  manual reload  ", createdBy: "owner" });
    const rows = await db
      .select({
        note: paperCapitalEventTable.note,
        createdBy: paperCapitalEventTable.createdBy,
        amount: paperCapitalEventTable.amount,
      })
      .from(paperCapitalEventTable)
      .where(eq(paperCapitalEventTable.segment, TEST_SEG))
      .orderBy(sql`${paperCapitalEventTable.createdAt} DESC`)
      .limit(1);
    expect(rows[0]!.note).toBe("manual reload"); // trimmed
    expect(rows[0]!.createdBy).toBe("owner");
    expect(parseFloat(rows[0]!.amount)).toBeCloseTo(1_234, 6);

    // Withdraw with no note → stored as NULL, not empty string.
    await withdrawAccount(TEST_SEG, 100, { note: "   ", createdBy: "owner" });
    const wrows = await db
      .select({ note: paperCapitalEventTable.note, kind: paperCapitalEventTable.kind })
      .from(paperCapitalEventTable)
      .where(eq(paperCapitalEventTable.segment, TEST_SEG))
      .orderBy(sql`${paperCapitalEventTable.createdAt} DESC`)
      .limit(1);
    expect(wrows[0]!.kind).toBe("WITHDRAW_CAPITAL");
    expect(wrows[0]!.note).toBeNull();
  });

  it("rejects non-positive / non-finite amounts without ledger writes", async () => {
    const movesBefore = await getCapitalMovements(TEST_SEG);
    expect((await topupAccount(TEST_SEG, 0)).ok).toBe(false);
    expect((await topupAccount(TEST_SEG, -100)).ok).toBe(false);
    expect((await withdrawAccount(TEST_SEG, 0)).ok).toBe(false);
    expect((await withdrawAccount(TEST_SEG, Number.NaN)).ok).toBe(false);
    const movesAfter = await getCapitalMovements(TEST_SEG);
    expect(movesAfter.added).toBeCloseTo(movesBefore.added, 6);
    expect(movesAfter.withdrawn).toBeCloseTo(movesBefore.withdrawn, 6);
  });
});
