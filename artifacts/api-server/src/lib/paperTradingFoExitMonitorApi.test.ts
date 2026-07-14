import { afterAll, describe, expect, it } from "vitest";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { db, pool, paperTradeFoTable, optionSignalHistoryTable } from "@workspace/db";
import type { OcResponse } from "./optionChain";
import { evaluateSingleFnoTradeExit } from "./paperTradingFO";

/**
 * F&O Exit Monitoring Reliability (T005) — `evaluateSingleFnoTradeExit`
 * tests. Same zero-footprint pattern as `paperTradingFoOrphanExit.test.ts`:
 * open a real transaction, seed via `tx`, always `rollback()`.
 */

function swallowIntentionalRollback(err: unknown): void {
  if (err instanceof TransactionRollbackError) return;
  throw err;
}

const hasDb = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("dummy"));
const dbit = hasDb ? it : it.skip;

afterAll(async () => {
  if (hasDb) await pool.end().catch(() => {});
});

const TEST_DATE = "2099-11-15";

function makeChain(spot: number, spotSource: "kite" | "nse" = "kite"): OcResponse {
  return {
    underlying: "NIFTY",
    underlyingName: "NIFTY",
    kind: "INDEX",
    spot,
    prevClose: spot,
    changePercent: 0,
    expiry: "2099-12-31",
    expiries: ["2099-12-31"],
    atmStrike: 24000,
    strikeStep: 50,
    rows: [{ strike: 24000, ce: { ltp: 100 }, pe: { ltp: 100 } }],
    source: "TEST",
    generatedAt: new Date().toISOString(),
    spotSource,
    spotTrusted: spotSource === "kite",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedPaper(tx: any, status: "OPEN" | "CLOSED" = "OPEN"): Promise<string> {
  const inserted = await tx
    .insert(paperTradeFoTable)
    .values({
      signalDate: TEST_DATE,
      indexSymbol: "NIFTY",
      setupKey: "EMA_PULLBACK",
      direction: "BULLISH",
      indexName: "NIFTY",
      optionType: "CE",
      strike: "24000.0000",
      lots: 1,
      lotSize: 50,
      entryPremium: "100.0000",
      stopPremium: "70.0000",
      target1Premium: "130.0000",
      target2Premium: "160.0000",
      capitalDeployed: "5000.00",
      lastPremium: "100.0000",
      status,
    })
    .returning({ id: paperTradeFoTable.id });
  return inserted[0]!.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedLifecycle(tx: any): Promise<void> {
  await tx.insert(optionSignalHistoryTable).values({
    signalDate: TEST_DATE,
    indexSymbol: "NIFTY",
    setupKey: "EMA_PULLBACK",
    direction: "BULLISH",
    indexName: "NIFTY",
    strike: "24000.0000",
    optionType: "CE",
    entry: "24000.0000",
    stopLoss: "23900.0000",
    target1: "24100.0000",
    target2: "24200.0000",
    confidence: 70,
    status: "TRIGGERED",
    triggeredAt: new Date(),
    lastSpot: "24000.0000",
  });
}

describe("evaluateSingleFnoTradeExit", () => {
  dbit("returns NOT_FOUND for an unknown id", async () => {
    const result = await evaluateSingleFnoTradeExit("00000000-0000-0000-0000-000000000000");
    expect(result.status).toBe("NOT_FOUND");
    expect(result.trade).toBeUndefined();
  });

  dbit("returns NOT_OPEN for a CLOSED trade", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, "CLOSED");
        const result = await evaluateSingleFnoTradeExit(
          id,
          async () => makeChain(24050),
          tx,
        );
        expect(result.status).toBe("NOT_OPEN");
        expect(result.trade?.id).toBe(id);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("returns LIFECYCLE_NOT_FOUND when no matching history row exists", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, "OPEN");
        const result = await evaluateSingleFnoTradeExit(
          id,
          async () => makeChain(24050),
          tx,
        );
        expect(result.status).toBe("LIFECYCLE_NOT_FOUND");
        expect(result.trade?.id).toBe(id);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("returns NO_FRESH_SPOT when the chain fetcher yields no usable spot", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, "OPEN");
        await seedLifecycle(tx);
        const result = await evaluateSingleFnoTradeExit(id, async () => null, tx);
        expect(result.status).toBe("NO_FRESH_SPOT");
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("returns NO_FRESH_SPOT when the chain fetcher throws", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, "OPEN");
        await seedLifecycle(tx);
        const result = await evaluateSingleFnoTradeExit(
          id,
          async () => {
            throw new Error("synthetic chain failure");
          },
          tx,
        );
        expect(result.status).toBe("NO_FRESH_SPOT");
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("EVALUATED / HOLD when a trade-grade Kite spot is between entry and stop/targets", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, "OPEN");
        await seedLifecycle(tx);
        const result = await evaluateSingleFnoTradeExit(
          id,
          async () => makeChain(24050, "kite"),
          tx,
        );
        expect(result.status).toBe("EVALUATED");
        expect(result.decision?.kind).toBe("HOLD");
        expect(result.decision?.tradeGrade).toBe(true);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("EVALUATED / EXIT (STOPPED) when a trade-grade Kite spot breaches the stop", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, "OPEN");
        await seedLifecycle(tx);
        const result = await evaluateSingleFnoTradeExit(
          id,
          async () => makeChain(23800, "kite"),
          tx,
        );
        expect(result.status).toBe("EVALUATED");
        expect(result.decision?.kind).toBe("EXIT");
        if (result.decision?.kind === "EXIT") {
          expect(result.decision.exitReason).toBe("STOPPED");
        }
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  dbit("EVALUATED / BLOCKED when the spot is non-Kite (not trade-grade), even if it would breach the stop", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedPaper(tx, "OPEN");
        await seedLifecycle(tx);
        const result = await evaluateSingleFnoTradeExit(
          id,
          async () => makeChain(23800, "nse"),
          tx,
        );
        expect(result.status).toBe("EVALUATED");
        expect(result.decision?.kind).toBe("BLOCKED");
        if (result.decision?.kind === "BLOCKED") {
          expect(result.decision.tradeGrade).toBe(false);
        }
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });
});
