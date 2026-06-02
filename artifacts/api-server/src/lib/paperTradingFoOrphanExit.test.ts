import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  paperTradeFoTable,
  optionSignalHistoryTable,
} from "@workspace/db";
import type { PaperTradeFoRow } from "@workspace/db";
import type { OcResponse } from "./optionChain";
import {
  evaluateOrphanedOpenTrades,
  getOrphanExitSweepHealth,
  __resetOrphanExitSweepHealthForTests,
} from "./paperTradingFO";

/**
 * P0 hotfix — Orphaned-OPEN spot-exit re-evaluation tests.
 *
 * Same zero-footprint pattern as `paperTradingFoMtmSweep.test.ts`: open a real
 * transaction, do EVERYTHING inside it via `tx`, always `rollback()`. The
 * production function is passed the same `tx` handle (`dbHandle`) AND a
 * tx-aware `closer`, so the lifecycle CAS, the seeded rows, and the paper-trade
 * close all run on the same connection and the rollback leaves zero footprint.
 */

function swallowIntentionalRollback(err: unknown): void {
  if (err instanceof TransactionRollbackError) return;
  throw err;
}

const hasDb = Boolean(process.env.DATABASE_URL);
const dbit = hasDb ? it : it.skip;

afterAll(async () => {
  if (hasDb) await pool.end().catch(() => {});
});

const TEST_DATE = "2099-12-30";

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Chain with an explicit spot decoupled from the leg strike. */
function makeChain(
  spot: number,
  strike: number,
  ce?: number,
  pe?: number,
): OcResponse {
  return {
    underlying: "NIFTY",
    underlyingName: "NIFTY",
    kind: "INDEX",
    spot,
    prevClose: spot,
    changePercent: 0,
    expiry: "2099-12-31",
    expiries: ["2099-12-31"],
    atmStrike: strike,
    strikeStep: 50,
    rows: [
      {
        strike,
        ce: ce != null ? { ltp: ce } : undefined,
        pe: pe != null ? { ltp: pe } : undefined,
      },
    ],
    source: "TEST",
    generatedAt: new Date().toISOString(),
  };
}

type PaperSpec = {
  indexSymbol: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  optionType: "CE" | "PE";
  strike: number;
  status?: "OPEN" | "CLOSED";
};

async function seedPaper(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  s: PaperSpec,
): Promise<string> {
  const inserted = await tx
    .insert(paperTradeFoTable)
    .values({
      signalDate: TEST_DATE,
      indexSymbol: s.indexSymbol,
      setupKey: s.setupKey,
      direction: s.direction,
      indexName: s.indexSymbol,
      optionType: s.optionType,
      strike: s.strike.toFixed(4),
      lots: 1,
      lotSize: 50,
      entryPremium: "100.0000",
      stopPremium: "70.0000",
      target1Premium: "130.0000",
      target2Premium: "160.0000",
      capitalDeployed: "5000.00",
      lastPremium: "100.0000",
      status: s.status ?? "OPEN",
    })
    .returning({ id: paperTradeFoTable.id });
  return inserted[0]!.id;
}

type LifecycleSpec = {
  indexSymbol: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  optionType: "CE" | "PE";
  strike: number;
  status: string;
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  exitedAt?: Date | null;
};

async function seedLifecycle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  s: LifecycleSpec,
): Promise<void> {
  await tx.insert(optionSignalHistoryTable).values({
    signalDate: TEST_DATE,
    indexSymbol: s.indexSymbol,
    setupKey: s.setupKey,
    direction: s.direction,
    indexName: s.indexSymbol,
    strike: s.strike.toFixed(4),
    optionType: s.optionType,
    entry: s.entry.toFixed(4),
    stopLoss: s.stopLoss.toFixed(4),
    target1: s.target1.toFixed(4),
    target2: s.target2.toFixed(4),
    confidence: 70,
    status: s.status,
    triggeredAt: s.status === "PENDING" ? null : new Date(),
    exitedAt: s.exitedAt ?? null,
    lastSpot: s.entry.toFixed(4),
  });
}

/** tx-aware closer: mirrors closePaperTradeForSignal's idempotent CAS close. */
function makeTxCloser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
): {
  closer: (
    signalDate: string,
    indexSymbol: string,
    setupKey: string,
    direction: "BULLISH" | "BEARISH",
    reason: string,
  ) => Promise<PaperTradeFoRow | null>;
  calls: Array<{ direction: string; reason: string }>;
} {
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
      .set({
        status: "CLOSED",
        exitedAt: new Date(),
        exitReason: reason,
      })
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
// Fail-safe (no DB required for the first; rest auto-skip without DATABASE_URL)
// ─────────────────────────────────────────────────────────────────────────

describe("evaluateOrphanedOpenTrades — fail-safe", () => {
  beforeEach(() => __resetOrphanExitSweepHealthForTests());

  dbit("resolves cleanly with zero OPEN rows for an unused date", async () => {
    const stats = await evaluateOrphanedOpenTrades("1999-01-01");
    expect(stats.considered).toBe(0);
    expect(stats.errors).toBe(0);
  });

  dbit("chainFetcher throw is swallowed per row → counted as staleMtm, no close", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => {
            throw new Error("synthetic chain failure");
          },
          tx,
          closer,
        );
        expect(stats.considered).toBe(1);
        expect(stats.staleMtm).toBe(1);
        expect(stats.stopped).toBe(0);
        expect(calls.length).toBe(0);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DB-backed: real schema, real updates, ALL inside one rolled-back txn
// ─────────────────────────────────────────────────────────────────────────

describe("evaluateOrphanedOpenTrades — DB integration (rolled back)", () => {
  beforeEach(() => __resetOrphanExitSweepHealthForTests());

  dbit("BULLISH frozen orphan whose spot breached the stop → STOPPED close", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => makeChain(23850, 24000, 40), // spot below stop
          tx,
          closer,
        );
        expect(stats.considered).toBe(1);
        expect(stats.stopped).toBe(1);
        expect(stats.target2).toBe(0);
        expect(calls).toEqual([{ direction: "BULLISH", reason: "STOPPED" }]);

        // Lifecycle row advanced to terminal STOPPED with an exit recorded.
        const lc = await tx
          .select()
          .from(optionSignalHistoryTable)
          .where(
            and(
              eq(optionSignalHistoryTable.signalDate, TEST_DATE),
              eq(optionSignalHistoryTable.indexSymbol, "NIFTY"),
              eq(optionSignalHistoryTable.setupKey, "EMA_PULLBACK"),
              eq(optionSignalHistoryTable.direction, "BULLISH"),
            ),
          );
        expect(lc[0]!.status).toBe("STOPPED");
        expect(lc[0]!.exitedAt).not.toBeNull();
        expect(lc[0]!.exitReason).toBe("STOPPED");
        expect(Number(lc[0]!.exitPrice)).toBeCloseTo(23900, 2);

        // Paper trade closed by the (tx-aware) closer.
        const paper = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(paper[0]!.status).toBe("CLOSED");

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("CLOSE-FIRST failure safety: closer throw keeps lifecycle non-terminal; next sweep retries → STOPPED", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
        });

        const fetcher = async () => makeChain(23850, 24000, 40); // spot below stop

        // Sweep 1: the close FAILS. Because we close BEFORE advancing the
        // lifecycle, the lifecycle must stay non-terminal (TRIGGERED) and the
        // paper trade must stay OPEN — otherwise the next sweep would skip the
        // row as alreadyTerminal and 15:20 would settle it at the stale LTP.
        const throwingCloser = async () => {
          throw new Error("simulated close failure");
        };
        const s1 = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          fetcher,
          tx,
          throwingCloser,
        );
        expect(s1.considered).toBe(1);
        expect(s1.stopped).toBe(0);
        expect(s1.errors).toBe(1);

        const lc1 = await tx
          .select()
          .from(optionSignalHistoryTable)
          .where(
            and(
              eq(optionSignalHistoryTable.signalDate, TEST_DATE),
              eq(optionSignalHistoryTable.indexSymbol, "NIFTY"),
              eq(optionSignalHistoryTable.setupKey, "EMA_PULLBACK"),
              eq(optionSignalHistoryTable.direction, "BULLISH"),
            ),
          );
        expect(lc1[0]!.status).toBe("TRIGGERED");
        expect(lc1[0]!.exitedAt).toBeNull();

        const paper1 = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(paper1[0]!.status).toBe("OPEN");

        // Sweep 2: a healthy closer retries the SAME row and settles it.
        const { closer, calls } = makeTxCloser(tx);
        const s2 = await evaluateOrphanedOpenTrades(TEST_DATE, fetcher, tx, closer);
        expect(s2.considered).toBe(1);
        expect(s2.stopped).toBe(1);
        expect(calls).toEqual([{ direction: "BULLISH", reason: "STOPPED" }]);

        const lc2 = await tx
          .select()
          .from(optionSignalHistoryTable)
          .where(
            and(
              eq(optionSignalHistoryTable.signalDate, TEST_DATE),
              eq(optionSignalHistoryTable.indexSymbol, "NIFTY"),
              eq(optionSignalHistoryTable.setupKey, "EMA_PULLBACK"),
              eq(optionSignalHistoryTable.direction, "BULLISH"),
            ),
          );
        expect(lc2[0]!.status).toBe("STOPPED");
        expect(lc2[0]!.exitedAt).not.toBeNull();

        const paper2 = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(paper2[0]!.status).toBe("CLOSED");

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("residual: close succeeds but lifecycle advance throws → paper still CLOSED, counter records cosmetic miss", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
        });

        // The closer runs on the real tx and settles the paper trade. The
        // dbHandle delegates SELECTs to the tx but makes every UPDATE throw —
        // i.e. the post-close lifecycle advance fails. The paper trade must
        // remain CLOSED (immune to 15:20) and the failure must NOT surface as a
        // row error; it is recorded only via the cosmetic counter.
        const { closer, calls } = makeTxCloser(tx);
        const brokenHandle = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          select: (...args: any[]) => (tx as any).select(...args),
          update: () => {
            throw new Error("simulated lifecycle advance failure");
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        const stats = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => makeChain(23850, 24000, 40), // spot below stop
          brokenHandle,
          closer,
        );
        expect(stats.stopped).toBe(1);
        expect(stats.errors).toBe(0);
        expect(calls).toEqual([{ direction: "BULLISH", reason: "STOPPED" }]);
        expect(getOrphanExitSweepHealth().lifecycleAdvanceFailures).toBe(1);

        // Paper trade settled correctly despite the lifecycle write failing.
        const paper = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(paper[0]!.status).toBe("CLOSED");

        // Lifecycle row stayed non-terminal (cosmetic residue only).
        const lc = await tx
          .select()
          .from(optionSignalHistoryTable)
          .where(
            and(
              eq(optionSignalHistoryTable.signalDate, TEST_DATE),
              eq(optionSignalHistoryTable.indexSymbol, "NIFTY"),
              eq(optionSignalHistoryTable.setupKey, "EMA_PULLBACK"),
              eq(optionSignalHistoryTable.direction, "BULLISH"),
            ),
          );
        expect(lc[0]!.status).toBe("TRIGGERED");

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("BULLISH spot past T2 → TARGET2_HIT close", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "TREND_CONTINUATION",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "TREND_CONTINUATION",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => makeChain(24250, 24000, 220), // spot above T2
          tx,
          closer,
        );
        expect(stats.target2).toBe(1);
        expect(stats.stopped).toBe(0);
        expect(calls).toEqual([{ direction: "BULLISH", reason: "TARGET2_HIT" }]);

        const lc = await tx
          .select()
          .from(optionSignalHistoryTable)
          .where(
            and(
              eq(optionSignalHistoryTable.signalDate, TEST_DATE),
              eq(optionSignalHistoryTable.indexSymbol, "NIFTY"),
              eq(optionSignalHistoryTable.setupKey, "TREND_CONTINUATION"),
              eq(optionSignalHistoryTable.direction, "BULLISH"),
            ),
          );
        expect(lc[0]!.status).toBe("TARGET2_HIT");
        expect(Number(lc[0]!.exitPrice)).toBeCloseTo(24200, 2);

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("BEARISH spot above stop → STOPPED close (direction-correct)", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "VWAP_RECLAIM",
          direction: "BEARISH",
          optionType: "PE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "VWAP_RECLAIM",
          direction: "BEARISH",
          optionType: "PE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 24100, // bearish stop sits ABOVE entry
          target1: 23900,
          target2: 23800,
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => makeChain(24150, 24000, undefined, 40), // spot above bearish stop
          tx,
          closer,
        );
        expect(stats.stopped).toBe(1);
        expect(calls).toEqual([{ direction: "BEARISH", reason: "STOPPED" }]);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("T1 touch advances lifecycle to TARGET1_HIT but does NOT close (runner)", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "VOLUME_BREAKOUT",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "VOLUME_BREAKOUT",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => makeChain(24120, 24000, 150), // past T1, below T2
          tx,
          closer,
        );
        expect(stats.target1Advanced).toBe(1);
        expect(stats.stopped).toBe(0);
        expect(stats.target2).toBe(0);
        expect(calls.length).toBe(0);

        const lc = await tx
          .select()
          .from(optionSignalHistoryTable)
          .where(
            and(
              eq(optionSignalHistoryTable.signalDate, TEST_DATE),
              eq(optionSignalHistoryTable.indexSymbol, "NIFTY"),
              eq(optionSignalHistoryTable.setupKey, "VOLUME_BREAKOUT"),
              eq(optionSignalHistoryTable.direction, "BULLISH"),
            ),
          );
        expect(lc[0]!.status).toBe("TARGET1_HIT");
        expect(lc[0]!.exitedAt).toBeNull();

        const paper = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(paper[0]!.status).toBe("OPEN"); // runner stays open

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("no breach → no exit, no lifecycle change, no close", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "MEAN_REVERSION",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "MEAN_REVERSION",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => makeChain(24050, 24000, 110), // between entry and T1
          tx,
          closer,
        );
        expect(stats.noExit).toBe(1);
        expect(stats.stopped).toBe(0);
        expect(stats.target1Advanced).toBe(0);
        expect(calls.length).toBe(0);

        const lc = await tx
          .select()
          .from(optionSignalHistoryTable)
          .where(
            and(
              eq(optionSignalHistoryTable.signalDate, TEST_DATE),
              eq(optionSignalHistoryTable.indexSymbol, "NIFTY"),
              eq(optionSignalHistoryTable.setupKey, "MEAN_REVERSION"),
              eq(optionSignalHistoryTable.direction, "BULLISH"),
            ),
          );
        expect(lc[0]!.status).toBe("TRIGGERED"); // unchanged
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("already-terminal lifecycle is skipped (left to reconcile)", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "STOPPED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
          exitedAt: new Date(),
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => makeChain(23800, 24000, 30),
          tx,
          closer,
        );
        expect(stats.considered).toBe(1);
        expect(stats.alreadyTerminal).toBe(1);
        expect(stats.stopped).toBe(0);
        expect(calls.length).toBe(0);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("OPEN paper trade with no lifecycle row → lifecycleNotFound, no close", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        // No lifecycle row seeded.
        const { closer, calls } = makeTxCloser(tx);
        const stats = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => makeChain(23800, 24000, 30),
          tx,
          closer,
        );
        expect(stats.considered).toBe(1);
        expect(stats.lifecycleNotFound).toBe(1);
        expect(calls.length).toBe(0);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("no fresh spot (null chain) → staleMtm, no close", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => null,
          tx,
          closer,
        );
        expect(stats.staleMtm).toBe(1);
        expect(stats.stopped).toBe(0);
        expect(calls.length).toBe(0);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("stop hit but leg has no chain LTP → still STOPPED + staleMtm telemetry", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => makeChain(23850, 24000), // spot present, no LTP at leg
          tx,
          closer,
        );
        expect(stats.stopped).toBe(1); // exit still fires off locked levels
        expect(stats.staleMtm).toBe(1); // frozen-MTM telemetry recorded
        expect(calls).toEqual([{ direction: "BULLISH", reason: "STOPPED" }]);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("idempotent: a second sweep after exit yields alreadyTerminal", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
        });
        const { closer } = makeTxCloser(tx);
        const fetcher = async () => makeChain(23850, 24000, 40);

        const first = await evaluateOrphanedOpenTrades(TEST_DATE, fetcher, tx, closer);
        expect(first.stopped).toBe(1);

        // Paper row is now CLOSED → not considered; lifecycle is terminal.
        const second = await evaluateOrphanedOpenTrades(TEST_DATE, fetcher, tx, closer);
        expect(second.considered).toBe(0);
        expect(second.stopped).toBe(0);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("getOrphanExitSweepHealth reflects the last cycle + closedTotal", async () => {
    await db
      .transaction(async (tx) => {
        await seedPaper(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
        });
        await seedLifecycle(tx, {
          indexSymbol: "NIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          optionType: "CE",
          strike: 24000,
          status: "TRIGGERED",
          entry: 24000,
          stopLoss: 23900,
          target1: 24100,
          target2: 24200,
        });
        const { closer } = makeTxCloser(tx);
        await evaluateOrphanedOpenTrades(
          TEST_DATE,
          async () => makeChain(23850, 24000, 40),
          tx,
          closer,
        );
        const h = getOrphanExitSweepHealth();
        expect(h.cyclesTotal).toBeGreaterThanOrEqual(1);
        expect(h.closedTotal).toBeGreaterThanOrEqual(1);
        expect(h.lastCycle?.stopped).toBe(1);
        expect(h.lastSuccessAt).not.toBeNull();
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });
});
