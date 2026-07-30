import { checkDbTestIsolation } from "../test-infra/dbTestGuard.js";

// ── dynamic module handles (loaded after isolation check) ──────────────────
let db: Awaited<typeof import("@workspace/db")>["db"];
let pool: Awaited<typeof import("@workspace/db")>["pool"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let paperTradeFoTable: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let eq: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let markAllOpenFnoTradesToMarket: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pickLtpFromChain: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getMtmSweepHealth: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let __resetMtmSweepHealthForTests: any;

let _loaded = false;
async function loadDbModules(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  checkDbTestIsolation();
  const [dbMod, ormMod, ftMod] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
    import("./paperTradingFO.js"),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _db = dbMod as any;
  db = _db.db;
  pool = _db.pool;
  paperTradeFoTable = _db.paperTradeFoTable;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _orm = ormMod as any;
  eq = _orm.eq;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _ftMod = ftMod as any;
  markAllOpenFnoTradesToMarket = _ftMod.markAllOpenFnoTradesToMarket;
  pickLtpFromChain = _ftMod.pickLtpFromChain;
  getMtmSweepHealth = _ftMod.getMtmSweepHealth;
  __resetMtmSweepHealthForTests = _ftMod.__resetMtmSweepHealthForTests;
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TransactionRollbackError } from "drizzle-orm/errors";
import type { OcResponse } from "./optionChain";

/**
 * P22 — All-Open F&O MTM Coverage tests.
 *
 * Pure-helper tests run unconditionally. DB-backed tests share the
 * `paperHeatSql.test.ts` pattern: open a real transaction, do EVERYTHING
 * inside it via `tx`, always `rollback()`. Critically the production
 * function is passed the same `tx` handle so seeded rows and the sweep
 * run on the same connection and the rollback leaves zero footprint.
 */

function swallowIntentionalRollback(err: unknown): void {
  if (err instanceof TransactionRollbackError) return;
  throw err;
}


afterAll(async () => {
  await pool.end().catch(() => {});
});

// ─────────────────────────────────────────────────────────────────────────
// Pure helper: pickLtpFromChain
// ─────────────────────────────────────────────────────────────────────────

function makeChain(strike: number, ce?: number, pe?: number): OcResponse {
  return {
    underlying: "BANKNIFTY",
    underlyingName: "BANKNIFTY",
    kind: "INDEX",
    spot: strike,
    prevClose: strike,
    changePercent: 0,
    expiry: "2026-05-29",
    expiries: ["2026-05-29"],
    atmStrike: strike,
    strikeStep: 100,
    rows: [
      {
        strike,
        ce: ce != null ? { ltp: ce } : undefined,
        pe: pe != null ? { ltp: pe } : undefined,
      },
    ],
    source: "TEST",
    generatedAt: new Date().toISOString(),
    spotSource: "kite" as const,
    spotTrusted: true,
  };
}

describe("pickLtpFromChain — pure", () => {
  beforeAll(loadDbModules);
  it("returns CE ltp at the matching strike", () => {
    expect(pickLtpFromChain(makeChain(48000, 712.5, 805.2), 48000, "CE")).toBe(712.5);
  });

  it("returns PE ltp at the matching strike", () => {
    expect(pickLtpFromChain(makeChain(48000, 712.5, 805.2), 48000, "PE")).toBe(805.2);
  });

  it("returns null when chain is null/undefined", () => {
    expect(pickLtpFromChain(null, 48000, "CE")).toBeNull();
    expect(pickLtpFromChain(undefined, 48000, "CE")).toBeNull();
  });

  it("returns null when strike is not in chain (stale/missing quote)", () => {
    expect(pickLtpFromChain(makeChain(48000, 712.5), 49000, "CE")).toBeNull();
  });

  it("returns null when side has no ltp", () => {
    expect(pickLtpFromChain(makeChain(48000, 712.5), 48000, "PE")).toBeNull();
  });

  it("returns null for non-finite or non-positive ltp", () => {
    const c = makeChain(48000);
    c.rows[0]!.ce = { ltp: 0 };
    expect(pickLtpFromChain(c, 48000, "CE")).toBeNull();
    c.rows[0]!.ce = { ltp: -5 };
    expect(pickLtpFromChain(c, 48000, "CE")).toBeNull();
    c.rows[0]!.ce = { ltp: Number.NaN };
    expect(pickLtpFromChain(c, 48000, "CE")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Top-level fail-safe: errors must never break the signal loop
// ─────────────────────────────────────────────────────────────────────────

describe("markAllOpenFnoTradesToMarket — fail-safe (no DB required)", () => {
  beforeEach(() => __resetMtmSweepHealthForTests());

  it("resolves cleanly when chainFetcher throws (zero considered rows)", async () => {
    const stats = await markAllOpenFnoTradesToMarket(
      "1999-01-01",
      async () => {
        throw new Error("synthetic chain failure");
      },
    );
    expect(stats.considered).toBe(0);
    expect(stats.errors).toBe(0);
  });

  it("chainFetcher throw is swallowed per row; sweep still resolves", async () => {
    await db
      .transaction(async (tx) => {
        await seedTrade(tx, {
          signalDate: TEST_DATE,
          indexSymbol: "BANKNIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          indexName: "BANKNIFTY",
          optionType: "CE",
          strike: 48000,
          lots: 1,
          lotSize: 30,
          entryPremium: 700,
          stopPremium: 600,
          target1Premium: 760,
          target2Premium: 820,
          lastEvaluatedAt: new Date(Date.now() - 5 * 60_000),
        });
        const throwingFetcher = async () => {
          throw new Error("synthetic chain failure");
        };
        const stats = await markAllOpenFnoTradesToMarket(
          TEST_DATE,
          throwingFetcher,
          tx,
        );
        // The internal `.catch(() => null)` around chainFetcher converts the
        // throw into a null chain, which then routes through the no-quote
        // path. The sweep MUST resolve and the per-row try/catch MUST NOT
        // re-throw into the caller.
        expect(stats.considered).toBe(1);
        expect(stats.updatedFromChain).toBe(0);
        expect(stats.skippedNoQuote).toBe(1);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("strike float-jitter (48000.0000 vs 48000) still matches", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedTrade(tx, {
          signalDate: TEST_DATE,
          indexSymbol: "BANKNIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          indexName: "BANKNIFTY",
          optionType: "CE",
          strike: 48000, // stored as numeric(_,4) → "48000.0000"
          lots: 1,
          lotSize: 30,
          entryPremium: 700,
          stopPremium: 600,
          target1Premium: 760,
          target2Premium: 820,
          lastEvaluatedAt: new Date(Date.now() - 5 * 60_000),
        });
        // Chain returns the strike as the bare integer — the most common
        // case. Verifies the epsilon match in pickLtpFromChain works through
        // the full numeric-string round-trip.
        const stats = await markAllOpenFnoTradesToMarket(
          TEST_DATE,
          async () => makeChain(48000, 720),
          tx,
        );
        expect(stats.updatedFromChain).toBe(1);
        const after = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(Number(after[0]!.lastPremium)).toBeCloseTo(720, 2);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DB-backed: real schema, real updates, ALL inside one rolled-back txn
// ─────────────────────────────────────────────────────────────────────────

type SeedSpec = {
  signalDate: string;
  indexSymbol: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  indexName: string;
  optionType: "CE" | "PE";
  strike: number;
  lots: number;
  lotSize: number;
  entryPremium: number;
  stopPremium: number;
  target1Premium: number;
  target2Premium: number;
  status?: "OPEN" | "CLOSED";
  lastEvaluatedAt?: Date;
};

async function seedTrade(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  row: SeedSpec,
): Promise<string> {
  const inserted = await tx
    .insert(paperTradeFoTable)
    .values({
      signalDate: row.signalDate,
      indexSymbol: row.indexSymbol,
      setupKey: row.setupKey,
      direction: row.direction,
      indexName: row.indexName,
      optionType: row.optionType,
      strike: row.strike.toFixed(4),
      lots: row.lots,
      lotSize: row.lotSize,
      entryPremium: row.entryPremium.toFixed(4),
      stopPremium: row.stopPremium.toFixed(4),
      target1Premium: row.target1Premium.toFixed(4),
      target2Premium: row.target2Premium.toFixed(4),
      capitalDeployed: (row.entryPremium * row.lots * row.lotSize).toFixed(2),
      lastPremium: row.entryPremium.toFixed(4),
      status: row.status ?? "OPEN",
      ...(row.lastEvaluatedAt ? { lastEvaluatedAt: row.lastEvaluatedAt } : {}),
    })
    .returning({ id: paperTradeFoTable.id });
  return inserted[0]!.id;
}

const TEST_DATE = "2099-12-31";

describe("markAllOpenFnoTradesToMarket — DB integration (rolled back)", () => {
  beforeEach(() => __resetMtmSweepHealthForTests());

  it("updates last_premium / max_runup on a favourable move", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedTrade(tx, {
          signalDate: TEST_DATE,
          indexSymbol: "BANKNIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          indexName: "BANKNIFTY",
          optionType: "CE",
          strike: 48000,
          lots: 1,
          lotSize: 30,
          entryPremium: 700,
          stopPremium: 600,
          target1Premium: 760,
          target2Premium: 820,
          lastEvaluatedAt: new Date(Date.now() - 5 * 60_000),
        });

        const stats = await markAllOpenFnoTradesToMarket(
          TEST_DATE,
          async () => makeChain(48000, 750),
          tx,
        );
        expect(stats.considered).toBe(1);
        expect(stats.updatedFromChain).toBe(1);
        expect(stats.errors).toBe(0);

        const after = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(Number(after[0]!.lastPremium)).toBeCloseTo(750, 2);
        expect(Number(after[0]!.maxRunup)).toBeCloseTo(1500, 1); // (750-700)*30
        expect(Number(after[0]!.maxDrawdown)).toBeCloseTo(0, 6);
        // Decision-affecting fields untouched.
        expect(after[0]!.status).toBe("OPEN");
        expect(after[0]!.exitedAt).toBeNull();
        expect(after[0]!.exitPremium).toBeNull();
        expect(after[0]!.exitReason).toBeNull();
        expect(after[0]!.realizedPnl).toBeNull();
        expect(Number(after[0]!.entryPremium)).toBeCloseTo(700, 2);
        expect(Number(after[0]!.stopPremium)).toBeCloseTo(600, 2);
        expect(Number(after[0]!.target1Premium)).toBeCloseTo(760, 2);
        expect(Number(after[0]!.target2Premium)).toBeCloseTo(820, 2);

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("adverse move grows max_drawdown (LEAST)", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedTrade(tx, {
          signalDate: TEST_DATE,
          indexSymbol: "BANKNIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          indexName: "BANKNIFTY",
          optionType: "CE",
          strike: 48000,
          lots: 1,
          lotSize: 30,
          entryPremium: 700,
          stopPremium: 600,
          target1Premium: 760,
          target2Premium: 820,
          lastEvaluatedAt: new Date(Date.now() - 5 * 60_000),
        });
        const stats = await markAllOpenFnoTradesToMarket(
          TEST_DATE,
          async () => makeChain(48000, 680),
          tx,
        );
        expect(stats.updatedFromChain).toBe(1);

        const after = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(Number(after[0]!.maxDrawdown)).toBeCloseTo(-600, 1); // (680-700)*30
        expect(Number(after[0]!.maxRunup)).toBeCloseTo(0, 6);
        expect(after[0]!.status).toBe("OPEN");

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("CLOSED trades are NOT considered or updated", async () => {
    await db
      .transaction(async (tx) => {
        const id = await seedTrade(tx, {
          signalDate: TEST_DATE,
          indexSymbol: "BANKNIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          indexName: "BANKNIFTY",
          optionType: "CE",
          strike: 48000,
          lots: 1,
          lotSize: 30,
          entryPremium: 700,
          stopPremium: 600,
          target1Premium: 760,
          target2Premium: 820,
          status: "CLOSED",
        });
        await tx
          .update(paperTradeFoTable)
          .set({
            exitedAt: new Date(),
            exitPremium: "650.0000",
            exitReason: "STOPPED",
            realizedPnl: "-1500.00",
            lastPremium: "650.0000",
          })
          .where(eq(paperTradeFoTable.id, id));

        const stats = await markAllOpenFnoTradesToMarket(
          TEST_DATE,
          async () => makeChain(48000, 999),
          tx,
        );
        expect(stats.considered).toBe(0);
        expect(stats.updatedFromChain).toBe(0);

        const after = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(Number(after[0]!.lastPremium)).toBeCloseTo(650, 2);
        expect(after[0]!.status).toBe("CLOSED");
        expect(after[0]!.exitReason).toBe("STOPPED");

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("missing-quote rows do not throw; counted as skippedNoQuote", async () => {
    await db
      .transaction(async (tx) => {
        await seedTrade(tx, {
          signalDate: TEST_DATE,
          indexSymbol: "BANKNIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          indexName: "BANKNIFTY",
          optionType: "CE",
          strike: 48000, // chain returns 49000 → mismatch
          lots: 1,
          lotSize: 30,
          entryPremium: 700,
          stopPremium: 600,
          target1Premium: 760,
          target2Premium: 820,
          lastEvaluatedAt: new Date(Date.now() - 5 * 60_000),
        });
        const stats = await markAllOpenFnoTradesToMarket(
          TEST_DATE,
          async () => makeChain(49000, 100),
          tx,
        );
        expect(stats.considered).toBe(1);
        expect(stats.updatedFromChain).toBe(0);
        expect(stats.skippedNoQuote).toBe(1);
        expect(stats.errors).toBe(0);

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("processes multiple OPEN trades and fetches chain once per unique index", async () => {
    await db
      .transaction(async (tx) => {
        await seedTrade(tx, {
          signalDate: TEST_DATE,
          indexSymbol: "BANKNIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          indexName: "BANKNIFTY",
          optionType: "CE",
          strike: 48000,
          lots: 1,
          lotSize: 30,
          entryPremium: 700,
          stopPremium: 600,
          target1Premium: 760,
          target2Premium: 820,
          lastEvaluatedAt: new Date(Date.now() - 5 * 60_000),
        });
        await seedTrade(tx, {
          signalDate: TEST_DATE,
          indexSymbol: "BANKNIFTY",
          setupKey: "TREND_CONTINUATION",
          direction: "BULLISH",
          indexName: "BANKNIFTY",
          optionType: "CE",
          strike: 48000,
          lots: 1,
          lotSize: 30,
          entryPremium: 700,
          stopPremium: 600,
          target1Premium: 760,
          target2Premium: 820,
          lastEvaluatedAt: new Date(Date.now() - 5 * 60_000),
        });
        await seedTrade(tx, {
          signalDate: TEST_DATE,
          indexSymbol: "NIFTY",
          setupKey: "VWAP_RECLAIM",
          direction: "BEARISH",
          indexName: "NIFTY",
          optionType: "PE",
          strike: 24000,
          lots: 1,
          lotSize: 50,
          entryPremium: 120,
          stopPremium: 100,
          target1Premium: 140,
          target2Premium: 160,
          lastEvaluatedAt: new Date(Date.now() - 5 * 60_000),
        });

        let calls = 0;
        const fakeFetcher = async (sym: string) => {
          calls += 1;
          if (sym === "BANKNIFTY") return makeChain(48000, 750);
          if (sym === "NIFTY") return makeChain(24000, undefined, 130);
          return null;
        };
        const stats = await markAllOpenFnoTradesToMarket(
          TEST_DATE,
          fakeFetcher,
          tx,
        );
        expect(stats.considered).toBe(3);
        expect(stats.updatedFromChain).toBe(3);
        expect(calls).toBe(2); // 2 unique indices

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("skips rows already freshly marked by the cohort path", async () => {
    await db
      .transaction(async (tx) => {
        await seedTrade(tx, {
          signalDate: TEST_DATE,
          indexSymbol: "BANKNIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          indexName: "BANKNIFTY",
          optionType: "CE",
          strike: 48000,
          lots: 1,
          lotSize: 30,
          entryPremium: 700,
          stopPremium: 600,
          target1Premium: 760,
          target2Premium: 820,
          lastEvaluatedAt: new Date(Date.now() - 2_000), // within 45s window
        });

        let calls = 0;
        const fakeFetcher = async () => {
          calls += 1;
          return makeChain(48000, 999);
        };
        const stats = await markAllOpenFnoTradesToMarket(
          TEST_DATE,
          fakeFetcher,
          tx,
        );
        expect(stats.considered).toBe(1);
        expect(stats.skippedAlreadyFresh).toBe(1);
        expect(stats.updatedFromChain).toBe(0);
        expect(calls).toBe(0); // no chain fetch when everything is fresh

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("getMtmSweepHealth reflects the last cycle", async () => {
    await db
      .transaction(async (tx) => {
        await seedTrade(tx, {
          signalDate: TEST_DATE,
          indexSymbol: "BANKNIFTY",
          setupKey: "EMA_PULLBACK",
          direction: "BULLISH",
          indexName: "BANKNIFTY",
          optionType: "CE",
          strike: 48000,
          lots: 1,
          lotSize: 30,
          entryPremium: 700,
          stopPremium: 600,
          target1Premium: 760,
          target2Premium: 820,
          lastEvaluatedAt: new Date(Date.now() - 5 * 60_000),
        });
        await markAllOpenFnoTradesToMarket(
          TEST_DATE,
          async () => makeChain(48000, 720),
          tx,
        );
        const h = getMtmSweepHealth();
        expect(h.cyclesTotal).toBeGreaterThanOrEqual(1);
        expect(h.rowsUpdatedTotal).toBeGreaterThanOrEqual(1);
        expect(h.lastCycle?.updatedFromChain).toBeGreaterThanOrEqual(1);
        expect(h.lastSuccessAt).not.toBeNull();

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });
});
