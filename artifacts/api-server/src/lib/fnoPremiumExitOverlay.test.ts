import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { and, eq } from "drizzle-orm";
import { db, pool, paperTradeFoTable } from "@workspace/db";
import type { PaperTradeFoRow } from "@workspace/db";
import {
  decidePremiumHardStop,
  runPremiumHardStopSweep,
  getPremiumOverlayHealth,
  __resetPremiumOverlayHealthForTests,
  simulateProtectionRule,
  PREMIUM_OVERLAY_FRESHNESS_WINDOW_MS,
  type SimTradeInput,
} from "./fnoPremiumExitOverlay";

/**
 * F&O Premium Exit Overlay v1 tests.
 *
 * Pure decision + pure simulation need no DB. The sweep tests use the same
 * zero-footprint pattern as `paperTradingFoOrphanExit.test.ts`: everything runs
 * inside one transaction via an injected `tx` handle + a tx-aware closer, and
 * the txn is always rolled back so the dev DB is untouched.
 */

function swallowIntentionalRollback(err: unknown): void {
  if (err instanceof TransactionRollbackError) return;
  throw err;
}

function skipReasonOf(
  d: ReturnType<typeof decidePremiumHardStop>,
): string | undefined {
  return d.action === "SKIP" ? d.skipReason : undefined;
}

const hasDb = Boolean(process.env.DATABASE_URL);
const dbit = hasDb ? it : it.skip;

afterAll(async () => {
  if (hasDb) await pool.end().catch(() => {});
});

const TEST_DATE = "2099-12-30";
const NOW_MS = Date.UTC(2099, 11, 30, 6, 0, 0); // fixed clock for determinism

// ─────────────────────────────────────────────────────────────────────────
// Pure decision — decidePremiumHardStop
// ─────────────────────────────────────────────────────────────────────────

describe("decidePremiumHardStop — pure", () => {
  const base = {
    status: "OPEN",
    entryPremium: 100,
    stopPremium: 70,
    lastEvaluatedAtMs: NOW_MS,
    nowMs: NOW_MS,
  };

  it("STOP when fresh and last premium at/below stop (long CE/PE identical)", () => {
    expect(decidePremiumHardStop({ ...base, lastPremium: 65 })).toEqual({
      action: "STOP",
      reasonTag: "PREMIUM_STOP_HIT",
    });
    // exactly at stop also stops
    expect(decidePremiumHardStop({ ...base, lastPremium: 70 }).action).toBe("STOP");
  });

  it("SKIP ABOVE_STOP when premium still above stop", () => {
    expect(decidePremiumHardStop({ ...base, lastPremium: 80 })).toEqual({
      action: "SKIP",
      skipReason: "ABOVE_STOP",
    });
  });

  it("SKIP STALE_MTM when last_evaluated_at is older than the window", () => {
    const stale = {
      ...base,
      lastPremium: 65,
      lastEvaluatedAtMs: NOW_MS - PREMIUM_OVERLAY_FRESHNESS_WINDOW_MS - 1,
    };
    expect(decidePremiumHardStop(stale)).toEqual({
      action: "SKIP",
      skipReason: "STALE_MTM",
    });
  });

  it("SKIP NOT_OPEN for a non-open row", () => {
    expect(
      skipReasonOf(decidePremiumHardStop({ ...base, lastPremium: 65, status: "CLOSED" })),
    ).toBe("NOT_OPEN");
  });

  it("SKIP MISSING_* for non-finite / non-positive premiums", () => {
    expect(skipReasonOf(decidePremiumHardStop({ ...base, lastPremium: 0 }))).toBe(
      "MISSING_LAST_PREMIUM",
    );
    expect(
      skipReasonOf(decidePremiumHardStop({ ...base, lastPremium: 65, stopPremium: 0 })),
    ).toBe("MISSING_STOP_PREMIUM");
    expect(
      skipReasonOf(decidePremiumHardStop({ ...base, lastPremium: 65, entryPremium: NaN })),
    ).toBe("MISSING_ENTRY_PREMIUM");
  });

  it("SKIP INVALID_PREMIUM_RISK when stop is not below entry", () => {
    expect(
      skipReasonOf(
        decidePremiumHardStop({
          ...base,
          lastPremium: 60,
          entryPremium: 70,
          stopPremium: 80,
        }),
      ),
    ).toBe("INVALID_PREMIUM_RISK");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Pure simulation — simulateProtectionRule
// ─────────────────────────────────────────────────────────────────────────

describe("simulateProtectionRule — pure what-if", () => {
  // 1R = (entry-stop)*lots*lotSize. Use lots*lotSize=50 and 30-pt risk → 1R=₹1500.
  const mk = (
    id: string,
    realizedR: number,
    mfeR: number,
    maeR: number,
  ): SimTradeInput => ({
    id,
    index: "NIFTY",
    setup: "EMA_PULLBACK",
    entryPremium: 100,
    stopPremium: 70,
    lots: 1,
    lotSize: 50,
    realizedPnl: realizedR * 1500,
    maxRunup: mfeR * 1500,
    maxDrawdown: maeR * 1500,
  });

  it("GIVEBACK rescues a winner→loser round-trip", () => {
    // MFE 1.55R, ended -0.74R, worst -0.74R. arm 1R + giveback 40% → trigger
    // 1.55*0.6 = 0.93R; trade fell below → fires at 0.93R.
    const agg = simulateProtectionRule([mk("a", -0.74, 1.55, -0.74)], {
      arming: { kind: "R", threshold: 1, label: "+1R" },
      mode: "GIVEBACK",
      givebackPct: 0.4,
      label: "arm +1R → giveback 40%",
    });
    expect(agg.improved).toBe(1);
    expect(agg.winnersProtected).toBe(1);
    expect(agg.perTrade[0]!.alternativeR).toBeCloseTo(0.93, 2);
  });

  it("BREAKEVEN rescues an armed round-tripper to 0R", () => {
    const agg = simulateProtectionRule([mk("a", -0.74, 1.55, -0.74)], {
      arming: { kind: "R", threshold: 1, label: "+1R" },
      mode: "BREAKEVEN",
      label: "arm +1R → breakeven",
    });
    expect(agg.improved).toBe(1);
    expect(agg.perTrade[0]!.alternativeR).toBe(0);
  });

  it("GIVEBACK does NOT damage a trend winner that never fell to the trigger", () => {
    // MFE 5.76R, ended 4.56R, worst stayed positive. arm 1R + giveback 40% →
    // trigger 3.46R; trade never dipped that low → unchanged, not damaged.
    const agg = simulateProtectionRule([mk("a", 4.56, 5.76, 0.5)], {
      arming: { kind: "R", threshold: 1, label: "+1R" },
      mode: "GIVEBACK",
      givebackPct: 0.4,
      label: "arm +1R → giveback 40%",
    });
    expect(agg.trendWinnersDamaged).toBe(0);
    expect(agg.unchanged).toBe(1);
    expect(agg.perTrade[0]!.deltaR).toBeCloseTo(0, 6);
  });

  it("never-armed trade is unchanged", () => {
    const agg = simulateProtectionRule([mk("a", -1, 0.2, -1)], {
      arming: { kind: "R", threshold: 1, label: "+1R" },
      mode: "GIVEBACK",
      givebackPct: 0.4,
      label: "arm +1R → giveback 40%",
    });
    expect(agg.armedCount).toBe(0);
    expect(agg.unchanged).toBe(1);
    expect(agg.perTrade[0]!.deltaR).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Sweep helpers
// ─────────────────────────────────────────────────────────────────────────

type SeedSpec = {
  indexSymbol?: string;
  setupKey?: string;
  direction?: "BULLISH" | "BEARISH";
  optionType?: "CE" | "PE";
  entryPremium: number;
  stopPremium: number;
  lastPremium: number;
  lastEvaluatedAt: Date;
  status?: "OPEN" | "CLOSED";
  tags?: string[] | null;
  journal?: string | null;
};

async function seedPaper(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  s: SeedSpec,
): Promise<string> {
  const inserted = await tx
    .insert(paperTradeFoTable)
    .values({
      signalDate: TEST_DATE,
      indexSymbol: s.indexSymbol ?? "NIFTY",
      setupKey: s.setupKey ?? "EMA_PULLBACK",
      direction: s.direction ?? "BULLISH",
      indexName: s.indexSymbol ?? "NIFTY",
      optionType: s.optionType ?? "CE",
      strike: "24000.0000",
      lots: 1,
      lotSize: 50,
      entryPremium: s.entryPremium.toFixed(4),
      stopPremium: s.stopPremium.toFixed(4),
      target1Premium: "130.0000",
      target2Premium: "160.0000",
      capitalDeployed: "5000.00",
      lastPremium: s.lastPremium.toFixed(4),
      lastEvaluatedAt: s.lastEvaluatedAt,
      status: s.status ?? "OPEN",
      tags: s.tags ?? null,
      journal: s.journal ?? null,
    })
    .returning({ id: paperTradeFoTable.id });
  return inserted[0]!.id;
}

/** tx-aware closer mirroring closePaperTradeForSignal's idempotent CAS close. */
function makeTxCloser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
) {
  const calls: Array<{ direction: string; reason: string }> = [];
  const closer = async (
    signalDate: string,
    indexSymbol: string,
    setupKey: string,
    direction: "BULLISH" | "BEARISH",
    reason: string,
  ): Promise<PaperTradeFoRow | null> => {
    calls.push({ direction, reason });
    const updated = await tx
      .update(paperTradeFoTable)
      .set({ status: "CLOSED", exitedAt: new Date(), exitReason: reason })
      .where(
        and(
          eq(paperTradeFoTable.signalDate, signalDate),
          eq(paperTradeFoTable.indexSymbol, indexSymbol),
          eq(paperTradeFoTable.setupKey, setupKey),
          eq(paperTradeFoTable.direction, direction),
          eq(paperTradeFoTable.status, "OPEN"),
        ),
      )
      .returning();
    return (updated[0] as PaperTradeFoRow | undefined) ?? null;
  };
  return { closer, calls };
}

// ─────────────────────────────────────────────────────────────────────────
// Sweep — DB integration (rolled back)
// ─────────────────────────────────────────────────────────────────────────

describe("runPremiumHardStopSweep — DB integration (rolled back)", () => {
  beforeEach(() => __resetPremiumOverlayHealthForTests());

  dbit("fresh CE long with premium below stop → STOPPED close + tags/journal", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, {
          optionType: "CE",
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 65,
          lastEvaluatedAt: new Date(NOW_MS),
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);

        expect(stats.considered).toBe(1);
        expect(stats.stopped).toBe(1);
        expect(stats.tagWriteFailures).toBe(0);
        expect(calls).toEqual([{ direction: "BULLISH", reason: "STOPPED" }]);
        expect(getPremiumOverlayHealth().stoppedTotal).toBe(1);

        const row = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(row[0]!.status).toBe("CLOSED");
        expect(row[0]!.exitReason).toBe("STOPPED");
        expect(row[0]!.tags).toEqual(
          expect.arrayContaining(["PREMIUM_STOP_HIT", "PREMIUM_BACKSTOP"]),
        );
        expect(row[0]!.journal).toContain("premium hard-stop backstop");

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("fresh PE long with premium below stop → STOPPED close (long-side identical)", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          setupKey: "VWAP_RECLAIM",
          direction: "BEARISH",
          optionType: "PE",
          entryPremium: 120,
          stopPremium: 84,
          lastPremium: 80,
          lastEvaluatedAt: new Date(NOW_MS),
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);
        expect(stats.stopped).toBe(1);
        expect(calls).toEqual([{ direction: "BEARISH", reason: "STOPPED" }]);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("premium still above stop → no close", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, {
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 85,
          lastEvaluatedAt: new Date(NOW_MS),
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);
        expect(stats.stopped).toBe(0);
        expect(stats.skippedAboveStop).toBe(1);
        expect(calls.length).toBe(0);

        const row = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(row[0]!.status).toBe("OPEN");
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("stale MTM with premium below stop → no close, wouldStopButStale counted", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, {
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 60,
          lastEvaluatedAt: new Date(
            NOW_MS - PREMIUM_OVERLAY_FRESHNESS_WINDOW_MS - 60_000,
          ),
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);
        expect(stats.stopped).toBe(0);
        expect(stats.skippedStaleMtm).toBe(1);
        expect(stats.wouldStopButStale).toBe(1);
        expect(calls.length).toBe(0);

        const row = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(row[0]!.status).toBe("OPEN");
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("CLOSED rows are never considered", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 50,
          lastEvaluatedAt: new Date(NOW_MS),
          status: "CLOSED",
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);
        expect(stats.considered).toBe(0);
        expect(stats.stopped).toBe(0);
        expect(calls.length).toBe(0);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("CAS race: closer returns null (already closed) → no double count, no tag write", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 60,
          lastEvaluatedAt: new Date(NOW_MS),
        });
        const calls: number[] = [];
        const nullCloser = async () => {
          calls.push(1);
          return null;
        };
        const stats = await runPremiumHardStopSweep(
          TEST_DATE,
          tx,
          nullCloser,
          NOW_MS,
        );
        expect(calls.length).toBe(1); // decision said STOP → closer was called
        expect(stats.stopped).toBe(0); // but it lost the race
        expect(stats.tagWriteFailures).toBe(0);
        expect(getPremiumOverlayHealth().stoppedTotal).toBe(0);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("appends to existing tags/journal without dropping them", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, {
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 65,
          lastEvaluatedAt: new Date(NOW_MS),
          tags: ["HC"],
          journal: "opened high-conviction",
        });
        const { closer } = makeTxCloser(tx);
        await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);
        const row = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(row[0]!.tags).toEqual(
          expect.arrayContaining(["HC", "PREMIUM_STOP_HIT", "PREMIUM_BACKSTOP"]),
        );
        expect(row[0]!.journal).toContain("opened high-conviction");
        expect(row[0]!.journal).toContain("premium hard-stop backstop");
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("zero OPEN rows for an unused date → clean no-op", async () => {
    const stats = await runPremiumHardStopSweep("1999-01-01");
    expect(stats.considered).toBe(0);
    expect(stats.stopped).toBe(0);
    expect(stats.errors).toBe(0);
  });
});
