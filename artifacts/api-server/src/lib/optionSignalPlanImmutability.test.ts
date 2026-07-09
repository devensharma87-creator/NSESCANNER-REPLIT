import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, pool, optionSignalHistoryTable } from "@workspace/db";
import type { OptionSignal } from "@workspace/api-zod";
import {
  recordOrUpdate,
  persistOptionPremiums,
} from "./optionSignalLifecycle";

/**
 * P0-00 — Signal-plan immutability regression tests.
 *
 * The bug: every status-transition UPDATE in recordOrUpdate spread an
 * `optionPremiumPatch` built from the CURRENT cycle's live re-projection,
 * silently overwriting the persisted premium plan on every poll. The fix:
 * status transitions never touch premium columns; persistOptionPremiums is
 * the ONLY writer, one-shot (IS NULL guard + optionPremiumLockedAt stamp)
 * and strike-guarded.
 *
 * These tests run against the live dev DB (auto-skip without DATABASE_URL)
 * using a unique per-run index symbol far outside the real F&O universe
 * (OPTION_INDICES = NIFTY/BANKNIFTY/SENSEX), so the paper-trading hook and
 * real signal pipeline never see these rows. All rows are deleted in
 * afterAll.
 */

const hasDb = Boolean(
  process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("dummy"),
);
const dbit = hasDb ? it : it.skip;

// Unique per-run key so parallel/repeated runs never collide.
const TEST_INDEX = `TESTIDX_P000_${process.pid}`;

afterAll(async () => {
  if (!hasDb) return;
  await db
    .delete(optionSignalHistoryTable)
    .where(eq(optionSignalHistoryTable.indexSymbol, TEST_INDEX))
    .catch(() => {});
  await pool.end().catch(() => {});
});

function istDateKey(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Minimal signal fixture — only the fields recordOrUpdate /
 * persistOptionPremiums actually read. Cast because the full generated
 * OptionSignal shape carries dozens of display-only fields irrelevant here.
 */
function makeSignal(over: {
  setupKey: string;
  strike: number;
  entry: number;
  stopLoss: number;
  target1: number;
  target2?: number;
  optionEntry?: number;
  optionStopLoss?: number;
  optionTarget1?: number;
  optionTarget2?: number;
  confidence?: number;
  tier?: string;
}): OptionSignal {
  return {
    index: TEST_INDEX,
    indexName: TEST_INDEX,
    spot: over.entry - 20,
    bias: "BULLISH",
    confidence: over.confidence ?? 70,
    tier: over.tier ?? "HIGH_CONVICTION",
    setupKey: over.setupKey,
    entryTrigger: `Spot crosses above ${over.entry}`,
    generatedAt: new Date().toISOString(),
    drivers: [],
    leg: {
      type: "CALL",
      strike: over.strike,
      expiry: "2099-12-31",
      entry: over.entry,
      stopLoss: over.stopLoss,
      target1: over.target1,
      target2: over.target2 ?? over.target1 + 50,
    },
    optionEntry: over.optionEntry,
    optionStopLoss: over.optionStopLoss,
    optionTarget1: over.optionTarget1,
    optionTarget2: over.optionTarget2,
  } as unknown as OptionSignal;
}

async function fetchRow(setupKey: string) {
  const rows = await db
    .select()
    .from(optionSignalHistoryTable)
    .where(
      and(
        eq(optionSignalHistoryTable.signalDate, istDateKey()),
        eq(optionSignalHistoryTable.indexSymbol, TEST_INDEX),
        eq(optionSignalHistoryTable.setupKey, setupKey),
        eq(optionSignalHistoryTable.direction, "BULLISH"),
      ),
    )
    .limit(1);
  return rows[0];
}

describe("P0-00 plan immutability", () => {
  dbit(
    "persistOptionPremiums locks the premium plan exactly once (IS NULL guard + lockedAt stamp)",
    async () => {
      const setupKey = "P000_ONESHOT";
      const sig = makeSignal({
        setupKey,
        strike: 77100,
        entry: 77150,
        stopLoss: 77000,
        target1: 77400,
      });
      // Emission: insert path (premiums null — enrichment hasn't run).
      const lc0 = await recordOrUpdate({ signal: sig, snapshot: { spot: 77120 } });
      expect(lc0).not.toBeNull();
      expect(lc0!.lockedOptionEntry).toBeNull();
      expect(lc0!.optionPremiumLockedAt).toBeNull();

      // First enrichment backfill locks the plan.
      sig.optionEntry = 165.4;
      sig.optionStopLoss = 120.1;
      sig.optionTarget1 = 240.9;
      sig.optionTarget2 = 300.5;
      await persistOptionPremiums([sig]);
      const afterLock = await fetchRow(setupKey);
      expect(Number(afterLock!.optionEntry)).toBeCloseTo(165.4, 2);
      expect(afterLock!.optionPremiumLockedAt).not.toBeNull();
      const lockedAt = afterLock!.optionPremiumLockedAt!.getTime();

      // Second cycle re-projects different premiums — must be a no-op.
      sig.optionEntry = 999.99;
      sig.optionStopLoss = 900;
      sig.optionTarget1 = 1100;
      await persistOptionPremiums([sig]);
      const afterSecond = await fetchRow(setupKey);
      expect(Number(afterSecond!.optionEntry)).toBeCloseTo(165.4, 2);
      expect(Number(afterSecond!.optionStopLoss)).toBeCloseTo(120.1, 2);
      expect(Number(afterSecond!.optionTarget1)).toBeCloseTo(240.9, 2);
      expect(afterSecond!.optionPremiumLockedAt!.getTime()).toBe(lockedAt);
    },
  );

  dbit(
    "strike guard: premiums projected for a drifted ATM strike never backfill the locked row",
    async () => {
      const setupKey = "P000_STRIKEGUARD";
      const sig = makeSignal({
        setupKey,
        strike: 77100,
        entry: 77150,
        stopLoss: 77000,
        target1: 77400,
      });
      await recordOrUpdate({ signal: sig, snapshot: { spot: 77120 } });

      // ATM drifts before the chain first becomes available: the live leg
      // now prices a DIFFERENT contract (77300) than the locked row (77100).
      const drifted = makeSignal({
        setupKey,
        strike: 77300,
        entry: 77150,
        stopLoss: 77000,
        target1: 77400,
        optionEntry: 88.8,
        optionStopLoss: 60,
        optionTarget1: 130,
      });
      await persistOptionPremiums([drifted]);
      const row = await fetchRow(setupKey);
      expect(row!.optionEntry).toBeNull();
      expect(row!.optionPremiumLockedAt).toBeNull();
    },
  );

  dbit(
    "PENDING→TRIGGERED transition leaves the locked premium plan untouched",
    async () => {
      const setupKey = "P000_TRIGGER";
      const sig = makeSignal({
        setupKey,
        strike: 77100,
        entry: 77150,
        stopLoss: 77000,
        target1: 77400,
      });
      // Emit PENDING, then lock the plan.
      await recordOrUpdate({ signal: sig, snapshot: { spot: 77100 } });
      sig.optionEntry = 165.4;
      sig.optionStopLoss = 120.1;
      sig.optionTarget1 = 240.9;
      await persistOptionPremiums([sig]);

      // Next poll: live re-projection has moved AND spot crosses the trigger.
      sig.optionEntry = 210.75;
      sig.optionStopLoss = 150;
      sig.optionTarget1 = 280;
      const lc = await recordOrUpdate({
        signal: sig,
        snapshot: { spot: 77160, high: 77170, low: 77090 },
      });
      expect(lc).not.toBeNull();
      expect(lc!.status).toBe("TRIGGERED");
      // The returned LifecycleFields carry the LOCKED plan, not the live one.
      expect(lc!.lockedOptionEntry).toBeCloseTo(165.4, 2);
      expect(lc!.lockedOptionStopLoss).toBeCloseTo(120.1, 2);
      expect(lc!.optionPremiumLockedAt).not.toBeNull();
      expect(lc!.lockedStrike).toBe(77100);

      const row = await fetchRow(setupKey);
      expect(Number(row!.optionEntry)).toBeCloseTo(165.4, 2);
      expect(Number(row!.optionStopLoss)).toBeCloseTo(120.1, 2);
      expect(row!.status).toBe("TRIGGERED");
    },
  );

  dbit(
    "two-poll stability: repeated polls return an identical locked plan while live projections keep moving",
    async () => {
      const setupKey = "P000_TWOPOLL";
      const sig = makeSignal({
        setupKey,
        strike: 77100,
        entry: 77150,
        stopLoss: 77000,
        target1: 77400,
        optionEntry: 165.4,
        optionStopLoss: 120.1,
        optionTarget1: 240.9,
      });
      await recordOrUpdate({ signal: sig, snapshot: { spot: 77100 } });
      await persistOptionPremiums([sig]);
      const poll1 = await recordOrUpdate({ signal: sig, snapshot: { spot: 77110 } });

      // Live premiums change between polls (spot moved / theta decay).
      sig.optionEntry = 158.2;
      sig.optionTarget1 = 231.0;
      const poll2 = await recordOrUpdate({ signal: sig, snapshot: { spot: 77125 } });

      expect(poll1!.lockedOptionEntry).toBeCloseTo(165.4, 2);
      expect(poll2!.lockedOptionEntry).toBeCloseTo(165.4, 2);
      expect(poll2!.lockedOptionTarget1).toBeCloseTo(240.9, 2);
      expect(poll2!.optionPremiumLockedAt?.getTime()).toBe(
        poll1!.optionPremiumLockedAt?.getTime(),
      );
      expect(poll2!.lockedStrike).toBe(77100);
      expect(poll2!.lockedConfidence).toBe(70);
    },
  );

  dbit(
    "plan-audit ledger table exists, is append-only shaped, and enforces the 4-reason CHECK",
    async () => {
      // Structural: the sanctioned-correction path exists in the schema.
      const res = await db.execute(
        sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'option_signal_plan_audit'`,
      );
      const cols = res.rows.map((r) => (r as { column_name: string }).column_name);
      for (const c of [
        "signal_date",
        "index_symbol",
        "setup_key",
        "direction",
        "field",
        "old_value",
        "new_value",
        "reason",
        "changed_by",
        "changed_at",
      ]) {
        expect(cols).toContain(c);
      }
      // Invalid reason must be rejected by the CHECK constraint — silent
      // drift is not a sanctioned correction category.
      await expect(
        db.execute(
          sql`INSERT INTO option_signal_plan_audit
                (signal_date, index_symbol, setup_key, direction, field, old_value, new_value, reason, changed_by)
              VALUES ('2099-12-30', ${TEST_INDEX}, 'P000_AUDIT', 'BULLISH', 'option_entry', '1', '2', 'SILENT_DRIFT', 'test')`,
        ),
      ).rejects.toThrow();
    },
  );
});
