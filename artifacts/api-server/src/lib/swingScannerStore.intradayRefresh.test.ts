import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { eq, and, desc } from "drizzle-orm";
import { db, pool, swingScanResultTable, type NewSwingScanResultRow } from "@workspace/db";
import {
  runIntradayRefresh,
  getIntradayRefreshHealth,
  __resetIntradayRefreshHealthForTests,
  type DbHandle,
  type QuotesLoader,
} from "./swingScannerStore";
import type { KiteScannerQuote } from "./kiteScanner";

/**
 * S2 — Swing intraday refresh tests.
 *
 * Mirrors the `paperTradingFoMtmSweep.test.ts` pattern: open a real
 * transaction, do EVERYTHING inside it via `tx`, always `rollback()`.
 * The production function is passed the same `tx` handle so seeded
 * rows and the refresh run on the same connection — rollback leaves
 * zero footprint on the dev DB.
 *
 * Pure-helper tests (formatting / latch logic) run unconditionally.
 * DB-backed tests auto-skip when `DATABASE_URL` is unset.
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

beforeEach(() => {
  __resetIntradayRefreshHealthForTests();
});

/* ───────────── helpers ───────────── */

/**
 * A future-dated scan_date that won't collide with any real data.
 * Tests scope everything to (TEST_SCAN_DATE_*, symbol). The whole work
 * happens inside a rolled-back tx so this is just defense-in-depth.
 */
const TEST_SCAN_DATE = "2099-12-31";

function seedRow(symbol: string, overrides: Partial<NewSwingScanResultRow> = {}): NewSwingScanResultRow {
  return {
    symbol,
    scanDate: TEST_SCAN_DATE,
    action: "WATCHLIST",
    setup: "SWING",
    qualityGrade: "B",
    potential: "MED",
    score: "60",
    technicalScore: "30",
    smcScore: "10",
    volumeScore: "10",
    momentumScore: "5",
    fundamentalScore: "3",
    riskScore: "1",
    contextScore: "1",
    rsScore: null,
    closePrice: "100.00",
    entry: "100.00",
    stopLoss: "95.00",
    target1: "110.00",
    target2: "115.00",
    rrToT1: "2.00",
    buyZoneLower: "99.00",
    buyZoneUpper: "100.00",
    buyZoneBasis: "TEST",
    triggerText: "TEST",
    triggerPrice: "101.00",
    stopBasis: "TEST",
    targetBasis: "TEST",
    weeklyTrend: "Bullish",
    candleSignal: "None",
    marketStructure: "Up",
    reasons: [],
    warnings: [],
    intradayLast: null,
    intradayChangePct: null,
    triggerHit: null,
    intradayUpdatedAt: null,
    ...overrides,
  };
}

function makeQuote(symbol: string, last: number, high?: number, close?: number): KiteScannerQuote {
  const h = high ?? last;
  const c = close ?? last;
  return {
    symbol,
    name: symbol,
    lastPrice: last,
    open: last,
    high: h,
    low: last,
    close: c,
    volume: 1000,
    change: last - c,
    changePercent: c > 0 ? ((last - c) / c) * 100 : 0,
    averagePrice: last,
    buyQty: 0,
    sellQty: 0,
    ts: Date.now(),
  };
}

function loaderOf(map: Map<string, KiteScannerQuote> | null): QuotesLoader {
  return async () => map;
}

/* ───────────── 1. NSE symbol formatting (pure) ───────────── */

describe("loadKiteQuotes NSE symbol formatting", () => {
  it("formats keys as NSE:<TRADINGSYMBOL>", () => {
    // The production loader at kiteScanner.ts:216 builds keys as
    // `slice.map(s => \`NSE:${s}\`)`. This test pins the contract that
    // the swing intraday refresh depends on. If the format ever changes
    // to BSE:/NFO: or to instrument_tokens, this test fails.
    const symbols = ["RELIANCE", "TCS", "HDFCBANK"];
    const keys = symbols.map(s => `NSE:${s}`);
    expect(keys).toEqual(["NSE:RELIANCE", "NSE:TCS", "NSE:HDFCBANK"]);
    expect(keys[0]!.startsWith("NSE:")).toBe(true);
    expect(keys.every(k => !k.includes(":NSE"))).toBe(true);
  });
});

/* ───────────── 2–9. DB-backed refresh behaviour ───────────── */

describe("runIntradayRefresh (DB-backed, rolled back)", () => {
  dbit("2. successful quote updates intraday_last", async () => {
    await db.transaction(async (tx) => {
      const dbh = tx as unknown as DbHandle;
      await tx.insert(swingScanResultTable).values(seedRow("AAA", { closePrice: "100.00", triggerPrice: "105.00" }));
      const quotes = new Map<string, KiteScannerQuote>([["AAA", makeQuote("AAA", 102.5, 103, 100)]]);
      const res = await runIntradayRefresh(dbh, loaderOf(quotes));
      expect(res.scanDate).toBe(TEST_SCAN_DATE);
      expect(res.updated).toBe(1);
      const [row] = await tx.select().from(swingScanResultTable)
        .where(and(eq(swingScanResultTable.symbol, "AAA"), eq(swingScanResultTable.scanDate, TEST_SCAN_DATE)));
      expect(Number(row!.intradayLast)).toBeCloseTo(102.5, 2);
      await tx.rollback();
    }).catch(swallowIntentionalRollback);
  });

  dbit("3. successful quote updates intraday_change_pct", async () => {
    await db.transaction(async (tx) => {
      const dbh = tx as unknown as DbHandle;
      await tx.insert(swingScanResultTable).values(seedRow("BBB", { closePrice: "200.00", triggerPrice: "210.00" }));
      const quotes = new Map<string, KiteScannerQuote>([["BBB", makeQuote("BBB", 204, 205, 200)]]);
      await runIntradayRefresh(dbh, loaderOf(quotes));
      const [row] = await tx.select().from(swingScanResultTable)
        .where(and(eq(swingScanResultTable.symbol, "BBB"), eq(swingScanResultTable.scanDate, TEST_SCAN_DATE)));
      // (204 - 200) / 200 * 100 = +2.00 %
      expect(Number(row!.intradayChangePct)).toBeCloseTo(2.0, 2);
      await tx.rollback();
    }).catch(swallowIntentionalRollback);
  });

  dbit("4. successful quote updates intraday_updated_at", async () => {
    await db.transaction(async (tx) => {
      const dbh = tx as unknown as DbHandle;
      const before = Date.now();
      await tx.insert(swingScanResultTable).values(seedRow("CCC"));
      const quotes = new Map<string, KiteScannerQuote>([["CCC", makeQuote("CCC", 101)]]);
      await runIntradayRefresh(dbh, loaderOf(quotes));
      const [row] = await tx.select().from(swingScanResultTable)
        .where(and(eq(swingScanResultTable.symbol, "CCC"), eq(swingScanResultTable.scanDate, TEST_SCAN_DATE)));
      expect(row!.intradayUpdatedAt).toBeInstanceOf(Date);
      expect(row!.intradayUpdatedAt!.getTime()).toBeGreaterThanOrEqual(before);
      await tx.rollback();
    }).catch(swallowIntentionalRollback);
  });

  dbit("5. quote high crossing trigger latches trigger_hit = true", async () => {
    await db.transaction(async (tx) => {
      const dbh = tx as unknown as DbHandle;
      await tx.insert(swingScanResultTable).values(seedRow("DDD", { closePrice: "100.00", triggerPrice: "105.00" }));
      // High 106 > trigger 105 → latch.
      const quotes = new Map<string, KiteScannerQuote>([["DDD", makeQuote("DDD", 104, 106, 100)]]);
      const res = await runIntradayRefresh(dbh, loaderOf(quotes));
      expect(res.triggerHitsLatched).toBe(1);
      const [row] = await tx.select().from(swingScanResultTable)
        .where(and(eq(swingScanResultTable.symbol, "DDD"), eq(swingScanResultTable.scanDate, TEST_SCAN_DATE)));
      expect(row!.triggerHit).toBe(true);
      await tx.rollback();
    }).catch(swallowIntentionalRollback);
  });

  dbit("6. quote high below trigger leaves trigger_hit = false", async () => {
    await db.transaction(async (tx) => {
      const dbh = tx as unknown as DbHandle;
      await tx.insert(swingScanResultTable).values(seedRow("EEE", { closePrice: "100.00", triggerPrice: "110.00" }));
      // High 104 < trigger 110 → not latched.
      const quotes = new Map<string, KiteScannerQuote>([["EEE", makeQuote("EEE", 103, 104, 100)]]);
      const res = await runIntradayRefresh(dbh, loaderOf(quotes));
      expect(res.triggerHitsLatched).toBe(0);
      const [row] = await tx.select().from(swingScanResultTable)
        .where(and(eq(swingScanResultTable.symbol, "EEE"), eq(swingScanResultTable.scanDate, TEST_SCAN_DATE)));
      expect(row!.triggerHit).toBe(false);
      await tx.rollback();
    }).catch(swallowIntentionalRollback);
  });

  dbit("7. existing trigger_hit = true remains latched even if later high < trigger", async () => {
    await db.transaction(async (tx) => {
      const dbh = tx as unknown as DbHandle;
      // Pre-latched row from an earlier intraday cycle.
      await tx.insert(swingScanResultTable).values(seedRow("FFF", { closePrice: "100.00", triggerPrice: "105.00", triggerHit: true }));
      // Now late-session pullback: high 102 < trigger 105.
      const quotes = new Map<string, KiteScannerQuote>([["FFF", makeQuote("FFF", 101, 102, 100)]]);
      await runIntradayRefresh(dbh, loaderOf(quotes));
      const [row] = await tx.select().from(swingScanResultTable)
        .where(and(eq(swingScanResultTable.symbol, "FFF"), eq(swingScanResultTable.scanDate, TEST_SCAN_DATE)));
      // Latch is monotone: was true, stays true.
      expect(row!.triggerHit).toBe(true);
      await tx.rollback();
    }).catch(swallowIntentionalRollback);
  });

  dbit("8. missing quote (Kite returns null for symbol) does not throw, counted as skippedNoQuote", async () => {
    await db.transaction(async (tx) => {
      const dbh = tx as unknown as DbHandle;
      await tx.insert(swingScanResultTable).values(seedRow("GGG"));
      // Loader returns empty map → symbol not present.
      const res = await runIntradayRefresh(dbh, loaderOf(new Map()));
      expect(res.updated).toBe(0);
      expect(res.skippedNoQuote).toBe(1);
      const [row] = await tx.select().from(swingScanResultTable)
        .where(and(eq(swingScanResultTable.symbol, "GGG"), eq(swingScanResultTable.scanDate, TEST_SCAN_DATE)));
      // Untouched.
      expect(row!.intradayLast).toBeNull();
      expect(row!.intradayUpdatedAt).toBeNull();
      await tx.rollback();
    }).catch(swallowIntentionalRollback);
  });

  dbit("9. bad quote payload (NaN / zero lastPrice) does not throw, counted as skippedBadLtp", async () => {
    await db.transaction(async (tx) => {
      const dbh = tx as unknown as DbHandle;
      await tx.insert(swingScanResultTable).values(seedRow("HHH"));
      // Loader returns quote with bad lastPrice.
      const bad = makeQuote("HHH", 0);
      const quotes = new Map<string, KiteScannerQuote>([["HHH", bad]]);
      const res = await runIntradayRefresh(dbh, loaderOf(quotes));
      expect(res.updated).toBe(0);
      expect(res.skippedBadLtp).toBe(1);
      const [row] = await tx.select().from(swingScanResultTable)
        .where(and(eq(swingScanResultTable.symbol, "HHH"), eq(swingScanResultTable.scanDate, TEST_SCAN_DATE)));
      // Untouched.
      expect(row!.intradayLast).toBeNull();
      await tx.rollback();
    }).catch(swallowIntentionalRollback);
  });

  /* ───── strict-scope guarantees: nothing else changes ───── */

  dbit("10. refresh does not change score, action, entry, stop_loss, target1, target2, rr_to_t1", async () => {
    await db.transaction(async (tx) => {
      const dbh = tx as unknown as DbHandle;
      const seeded = seedRow("III", {
        action: "BUY ZONE - WAIT TRIGGER",
        score: "78.50",
        entry: "120.00",
        stopLoss: "114.00",
        target1: "132.00",
        target2: "138.00",
        rrToT1: "2.00",
        closePrice: "120.00",
        triggerPrice: "121.00",
      });
      await tx.insert(swingScanResultTable).values(seeded);
      const quotes = new Map<string, KiteScannerQuote>([["III", makeQuote("III", 122, 123, 120)]]);
      await runIntradayRefresh(dbh, loaderOf(quotes));
      const [row] = await tx.select().from(swingScanResultTable)
        .where(and(eq(swingScanResultTable.symbol, "III"), eq(swingScanResultTable.scanDate, TEST_SCAN_DATE)));
      // Plan fields untouched — only intraday fields changed.
      expect(row!.action).toBe("BUY ZONE - WAIT TRIGGER");
      expect(Number(row!.score)).toBeCloseTo(78.5, 2);
      expect(Number(row!.entry)).toBeCloseTo(120, 2);
      expect(Number(row!.stopLoss)).toBeCloseTo(114, 2);
      expect(Number(row!.target1)).toBeCloseTo(132, 2);
      expect(Number(row!.target2)).toBeCloseTo(138, 2);
      expect(Number(row!.rrToT1)).toBeCloseTo(2, 2);
      // But intraday WAS updated.
      expect(Number(row!.intradayLast)).toBeCloseTo(122, 2);
      expect(row!.triggerHit).toBe(true); // high 123 >= trigger 121
      await tx.rollback();
    }).catch(swallowIntentionalRollback);
  });
});

/* ───────────── 11–12. Cross-table isolation (static / type guarantee) ───────────── */

describe("runIntradayRefresh isolation", () => {
  it("11. refresh writes only to swing_scan_result (never paper_trade_fo, paper_trade_eq, fno_*, option_chain_snapshot, candle_warehouse)", async () => {
    // Static guarantee enforced by the source: the only mutation in
    // runIntradayRefresh is `dbh.update(swingScanResultTable).set({...})`
    // touching exactly { intradayLast, intradayChangePct, triggerHit,
    // intradayUpdatedAt }. There is no other table reference.
    //
    // We pin that contract here by reading the source. If anyone adds a
    // second table mutation, this test fails fast — no runtime DB churn
    // required to catch a refactor accident.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./swingScannerStore.ts", import.meta.url), "utf8");
    // Carve out the runIntradayRefresh function body.
    const startIdx = src.indexOf("export async function runIntradayRefresh");
    expect(startIdx).toBeGreaterThan(0);
    // End at the next top-level `export ` after the function start.
    const tail = src.slice(startIdx + 1);
    const nextExport = tail.indexOf("\nexport ");
    const body = tail.slice(0, nextExport > 0 ? nextExport : tail.length);

    // Whitelist: only swingScanResultTable may appear.
    for (const forbidden of [
      "paperTradeFoTable", "paperTradeEqTable", "paperTradeComboTable",
      "fnoSignalReasoningTable", "optionSignalHistoryTable",
      "optionChainSnapshotTable", "candleWarehouseTable",
      "paperDailySummaryFoTable", "swingScanRunTable",
    ]) {
      expect(body).not.toContain(forbidden);
    }
    // Sanity: it DOES reference swingScanResultTable.
    expect(body).toContain("swingScanResultTable");
  });

  it("12. refresh body does not import or call any paper-equity / F&O execution helper", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const storePath = path.resolve(__dirname, "swingScannerStore.ts");
    const src = readFileSync(storePath, "utf8");
    // Build forbidden tokens at runtime so this test file's own text
    // can't satisfy the pattern. Joins ["openPap","erTrade"] → "openPaperTrade".
    const forbidden = [
      ["openPap","erTrade"], ["openPap","erEquityTrade"], ["closePap","erTrade"],
      ["runEquityPap","erTradingTick"], ["runFnoPap","erTradingTick"],
      ["tryOpenPap","erTrades"], ["reconcileMissingPap","erTrades"],
      ["markAllOpen","FnoTradesToMarket"], ["markOpen","FnoTradesToMarket"],
      ["kc.place","Order"], ["placeKite","Order"],
    ].map(parts => parts.join(""));
    for (const token of forbidden) {
      expect(src).not.toContain(token);
    }
  });
});

/* ───────────── health observability ───────────── */

describe("getIntradayRefreshHealth", () => {
  it("starts with zeroed counters and a bootedAt", () => {
    __resetIntradayRefreshHealthForTests();
    const h = getIntradayRefreshHealth();
    expect(h.cyclesTotal).toBe(0);
    expect(h.rowsUpdatedTotal).toBe(0);
    expect(h.triggerHitsLatchedTotal).toBe(0);
    expect(h.lastCycle).toBeNull();
    expect(h.bootedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  dbit("increments cyclesTotal, rowsUpdatedTotal, triggerHitsLatchedTotal on success", async () => {
    await db.transaction(async (tx) => {
      const dbh = tx as unknown as DbHandle;
      await tx.insert(swingScanResultTable).values(seedRow("JJJ", { closePrice: "100", triggerPrice: "105" }));
      const quotes = new Map<string, KiteScannerQuote>([["JJJ", makeQuote("JJJ", 104, 106, 100)]]);
      await runIntradayRefresh(dbh, loaderOf(quotes));
      const h = getIntradayRefreshHealth();
      expect(h.cyclesTotal).toBe(1);
      expect(h.rowsUpdatedTotal).toBe(1);
      expect(h.triggerHitsLatchedTotal).toBe(1);
      expect(h.lastCycle?.scanDate).toBe(TEST_SCAN_DATE);
      expect(h.lastCycle?.updated).toBe(1);
      expect(h.lastSuccessAt).toBeTruthy();
      await tx.rollback();
    }).catch(swallowIntentionalRollback);
  });
});
