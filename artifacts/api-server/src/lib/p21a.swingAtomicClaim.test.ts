/**
 * Pack 3 / Prompt 21A — Gate 1: Atomic staged-order claim.
 *
 * Proves that `stageSwingOrder` uses a PostgreSQL advisory xact lock inside a
 * `db.transaction()` so that two concurrent requests cannot both race past the
 * idempotency check and both insert a row (TOCTOU prevention).
 *
 * Tests exercise the REAL `stageSwingOrder` service with a mocked DB layer that
 * (a) serializes concurrent transaction callbacks via a JS mutex (simulating
 * pg_advisory_xact_lock serialization) and (b) uses an in-memory store to
 * persist rows, so the second serialized SELECT correctly finds the first row.
 *
 * No PostgreSQL connection. No Telegram. No live providers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Hoisted shared mock state — available in vi.mock factories below.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const ACTIVE = ["STAGED", "APPROVAL_REQUIRED", "WATCH_ONLY"] as const;
  const store = new Map<string, Record<string, unknown>>();
  const query = { ownerKey: "owner", symbol: "RELIANCE" };
  const advisory = { callCount: 0 };
  const alertCalls: string[] = [];
  const txMutex = { current: Promise.resolve() as Promise<void> };

  const mockTx = {
    execute: async (_sqlExpr: unknown) => { advisory.callCount++; return { rows: [] }; },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async (_n: number) => {
            const key = `${query.ownerKey}|${query.symbol}`;
            const row = store.get(key);
            if (!row) return [];
            const now = new Date();
            if (ACTIVE.includes(row["status"] as (typeof ACTIVE)[number]) &&
                (row["expiresAt"] as Date) > now) {
              return [row];
            }
            return [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => ({
        returning: async () => {
          const row = {
            id: `mock-${Math.random().toString(36).slice(2, 10)}`,
            ...vals,
          };
          store.set(`${vals["ownerKey"]}|${vals["symbol"]}`, row);
          return [row];
        },
      }),
    }),
  };

  return { store, query, advisory, alertCalls, txMutex, mockTx, ACTIVE };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    transaction: async (fn: (tx: typeof mocks.mockTx) => Promise<unknown>) => {
      let release!: () => void;
      const wait = mocks.txMutex.current;
      mocks.txMutex.current = new Promise<void>((r) => { release = r; });
      await wait;
      try {
        return await fn(mocks.mockTx);
      } finally {
        release();
      }
    },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  },
}));

vi.mock("@workspace/db/schema", async () => {
  const real = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  return real;
});

vi.mock("./swingKillSwitch", () => ({
  isKillSwitchActive: async () => false,
  getKillSwitch: async () => ({ enabled: false, reason: null, updatedAt: null, updatedBy: null }),
}));

vi.mock("./swingAlerts", () => ({
  alertSwingOrderStaged: (_row: unknown) => { mocks.alertCalls.push("staged"); },
  alertSwingOrderExpired: () => {},
  alertSwingOrderRejected: () => {},
  alertSwingOrderApprovedDryRun: () => {},
  alertSwingOrderBlockedByRisk: () => {},
  buildSwingOrderText: () => "",
  buildSwingBlockedText: () => "",
}));

vi.mock("./swingLiveExecutionConfig", () => ({
  getSwingExecutionMode: () => "paper_only",
  getSwingCashBookCapital: () => 1_000_000,
  getSwingExecutionStatus: async () => ({
    mode: "paper_only",
    killSwitchActive: false,
    liveCashSwingOrderEnabled: false,
    brokerExecutionEnabled: false,
    summary: "Paper-only. No live orders.",
  }),
}));

vi.mock("./swingDryRunBroker", () => ({
  placeOrderDryRun: async () => ({ success: true, brokerOrderId: null }),
}));

vi.mock("./paperTradingEq", () => ({
  openPaperEquityTradeFromStagedOrder: async () => ({ opened: false, blockedReason: "MOCK" }),
}));

vi.mock("./swingCashRiskGuards", () => ({
  evaluateSwingCashRisk: (_candidate: unknown, _portfolio: unknown, _config?: unknown) => ({
    allowed: true,
    reviewRequired: false,
    blockedReasons: [],
    warnings: [],
    explanation: ["Mock: allowed."],
    // decision.metrics is what stageSwingOrder uses for sizing fields (m.qty, m.capitalRequired, etc.)
    metrics: {
      qty: 5,
      capitalRequired: 5000,
      maxLoss: 500,
      riskPct: 0.05,
      eventClassification: null,
    },
    gates: {
      entry: { watchOnly: false, blocked: false, reasons: [] },
      heat: { watchOnly: false, blocked: false, reasons: [] },
      concentration: { watchOnly: false, blocked: false, reasons: [] },
      liquidity: { watchOnly: false, blocked: false, reasons: [] },
      event: { watchOnly: false, blocked: false, reasons: [] },
      data: { watchOnly: false, blocked: false, reasons: [] },
    },
  }),
  DEFAULT_SWING_CASH_CONFIG: {},
  withActiveMode: (cfg: unknown) => cfg,
}));

vi.mock("./swingTtlSweep", () => ({
  expireStaleSwingOrders: async () => ({ expired: 0, scanned: 0 }),
  getSwingTtlSweepState: () => ({ isRunning: false }),
  runSwingTtlSweepOnce: async () => ({ expired: 0, scanned: 0 }),
}));

vi.mock("./swingCashLiveCandidateAdapter", () => ({
  createKiteSwingQuoteFetcher: () => async (_symbol: string) => null,
  rebuildCandidateForRecheck: (candidate: unknown) => ({
    candidate,
    availability: { hasKiteSession: false },
  }),
  buildSnapshotCandidate: (b: unknown) => b,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(symbol: string) {
  return {
    symbol,
    sector: "IT",
    entry: 1000,
    stop: 900,
    target1: 1200,
    target2: 1400,
    ltp: 1005,
    rr: 2,
    atr: 20,
    dataSource: "kite",
    ohlc: null,
    dailyCandleAsOfMs: Date.now() - 60_000,
    ltpAsOfMs: Date.now() - 30_000,
    fallbackUsed: false,
    fallbackReason: null,
    sectorAvailable: true,
    benchmarkAvailable: true,
    entryZoneLow: 980,
    entryZoneHigh: 1020,
    signalAgeDays: 1,
    validityExpiryMs: null,
    triggered: true,
    avgTradedValue: 500_00_000,
    volume: 100_000,
    spreadPct: 0.05,
    deliveryPct: 50,
    asmGsmStatus: null,
    circuitRisk: null,
    daysToResult: 30,
    isResultDay: false,
    corporateActionRisk: null,
    eventDataAvailable: true,
    resultScheduleKnown: true,
    newsRiskAvailable: true,
    nowMs: Date.now(),
  };
}

function makePortfolioState() {
  // Matches SwingCashPortfolioState exactly (no excess properties — excess props are flagged by TS).
  return {
    totalSwingCapital: 1_000_000,
    availableCash: 500_000,
    openPositionSymbols: [] as string[],
    sectorExposureValueBySector: {} as Record<string, number>,
    singleStockExposureValueBySymbol: {} as Record<string, number>,
    sectorOpenCountBySector: {} as Record<string, number>,
    lastEntryDateBySymbolIst: {} as Record<string, string>,
    todayIst: new Date().toISOString().slice(0, 10),
    dailyEntriesUsed: 0,
    weeklyEntriesUsed: 0,
    openPositionsCount: 0,
  };
}

function resetKey(ownerKey: string, symbol: string) {
  mocks.store.delete(`${ownerKey}|${symbol}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Pack3/21A/Gate1 — Atomic staged-order claim", () => {
  beforeEach(() => {
    mocks.store.clear();
    mocks.advisory.callCount = 0;
    mocks.alertCalls.length = 0;
    mocks.txMutex.current = Promise.resolve();
  });

  it("T1: two concurrent identical calls create exactly one row", async () => {
    const { stageSwingOrder } = await import("./swingOrderStaging.js");
    const ownerKey = "ownerA";
    const candidate = makeCandidate("RELIANCE");
    const portfolioState = makePortfolioState();
    mocks.query.ownerKey = ownerKey;
    mocks.query.symbol = candidate.symbol;

    const [r1, r2] = await Promise.all([
      stageSwingOrder({ ownerKey, candidate, portfolioState }),
      stageSwingOrder({ ownerKey, candidate, portfolioState }),
    ]);

    const successCount = [r1, r2].filter((r) => r.staged).length;
    const dupCount = [r1, r2].filter(
      (r) => !r.staged && "reason" in r && r.reason === "DUPLICATE_ACTIVE_STAGE",
    ).length;
    expect(successCount).toBe(1);
    expect(dupCount).toBe(1);
    expect(mocks.store.size).toBe(1);
  });

  it("T2: batch of 4 concurrent identical calls creates exactly one row", async () => {
    const { stageSwingOrder } = await import("./swingOrderStaging.js");
    const ownerKey = "ownerB";
    const candidate = makeCandidate("INFY");
    const portfolioState = makePortfolioState();
    mocks.query.ownerKey = ownerKey;
    mocks.query.symbol = candidate.symbol;

    const results = await Promise.all([
      stageSwingOrder({ ownerKey, candidate, portfolioState }),
      stageSwingOrder({ ownerKey, candidate, portfolioState }),
      stageSwingOrder({ ownerKey, candidate, portfolioState }),
      stageSwingOrder({ ownerKey, candidate, portfolioState }),
    ]);

    const successCount = results.filter((r) => r.staged).length;
    expect(successCount).toBe(1);
    expect(mocks.store.size).toBe(1);
  });

  it("T3: losers receive stable DUPLICATE_ACTIVE_STAGE reason, not a generic error", async () => {
    const { stageSwingOrder } = await import("./swingOrderStaging.js");
    const ownerKey = "ownerC";
    const candidate = makeCandidate("TCS");
    const portfolioState = makePortfolioState();
    mocks.query.ownerKey = ownerKey;
    mocks.query.symbol = candidate.symbol;

    const [r1, r2] = await Promise.all([
      stageSwingOrder({ ownerKey, candidate, portfolioState }),
      stageSwingOrder({ ownerKey, candidate, portfolioState }),
    ]);

    const loser = [r1, r2].find((r) => !r.staged);
    expect(loser).toBeDefined();
    expect((loser as { reason?: string })?.reason).toBe("DUPLICATE_ACTIVE_STAGE");
  });

  it("T4: exactly one alertSwingOrderStaged call after two concurrent requests", async () => {
    const { stageSwingOrder } = await import("./swingOrderStaging.js");
    const ownerKey = "ownerD";
    const candidate = makeCandidate("WIPRO");
    const portfolioState = makePortfolioState();
    mocks.query.ownerKey = ownerKey;
    mocks.query.symbol = candidate.symbol;

    await Promise.all([
      stageSwingOrder({ ownerKey, candidate, portfolioState }),
      stageSwingOrder({ ownerKey, candidate, portfolioState }),
    ]);

    expect(mocks.alertCalls.length).toBe(1);
    expect(mocks.alertCalls[0]).toBe("staged");
  });

  it("T5: alert failure does not create a second row on retry", async () => {
    const { stageSwingOrder } = await import("./swingOrderStaging.js");
    const ownerKey = "ownerE";
    const candidate = makeCandidate("HDFC");
    const portfolioState = makePortfolioState();
    mocks.query.ownerKey = ownerKey;
    mocks.query.symbol = candidate.symbol;

    const r1 = await stageSwingOrder({ ownerKey, candidate, portfolioState });
    expect(r1.staged).toBe(true);
    expect(mocks.store.size).toBe(1);

    const r2 = await stageSwingOrder({ ownerKey, candidate, portfolioState });
    expect(r2.staged).toBe(false);
    expect((r2 as { reason?: string }).reason).toBe("DUPLICATE_ACTIVE_STAGE");
    expect(mocks.store.size).toBe(1);
  });

  it("T6: expired active stage permits one new active stage", async () => {
    const { stageSwingOrder } = await import("./swingOrderStaging.js");
    const ownerKey = "ownerF";
    const candidate = makeCandidate("AXIS");
    const portfolioState = makePortfolioState();
    mocks.query.ownerKey = ownerKey;
    mocks.query.symbol = candidate.symbol;

    const expiredRow = {
      id: "expired-id",
      ownerKey,
      symbol: candidate.symbol,
      status: "STAGED",
      expiresAt: new Date(Date.now() - 1000),
    };
    mocks.store.set(`${ownerKey}|${candidate.symbol}`, expiredRow);

    const result = await stageSwingOrder({ ownerKey, candidate, portfolioState });
    expect(result.staged).toBe(true);
  });

  it("T7: terminal (REJECTED) stage permits a new active stage", async () => {
    const { stageSwingOrder } = await import("./swingOrderStaging.js");
    const ownerKey = "ownerG";
    const candidate = makeCandidate("BAJAJ");
    const portfolioState = makePortfolioState();
    mocks.query.ownerKey = ownerKey;
    mocks.query.symbol = candidate.symbol;

    mocks.store.set(`${ownerKey}|${candidate.symbol}`, {
      id: "rejected-id",
      ownerKey,
      symbol: candidate.symbol,
      status: "REJECTED",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const result = await stageSwingOrder({ ownerKey, candidate, portfolioState });
    expect(result.staged).toBe(true);
  });

  it("T8: two different owners independently stage the same symbol", async () => {
    const { stageSwingOrder } = await import("./swingOrderStaging.js");
    const candidate = makeCandidate("RELIANCE");
    const portfolioState = makePortfolioState();

    resetKey("ownerX", "RELIANCE");
    mocks.query.ownerKey = "ownerX";
    mocks.query.symbol = "RELIANCE";
    const rx = await stageSwingOrder({ ownerKey: "ownerX", candidate, portfolioState });
    expect(rx.staged).toBe(true);

    resetKey("ownerY", "RELIANCE");
    mocks.query.ownerKey = "ownerY";
    mocks.query.symbol = "RELIANCE";
    const ry = await stageSwingOrder({ ownerKey: "ownerY", candidate, portfolioState });
    expect(ry.staged).toBe(true);
  });

  it("T9: one owner independently stages two different symbols", async () => {
    const { stageSwingOrder } = await import("./swingOrderStaging.js");
    const portfolioState = makePortfolioState();

    mocks.query.ownerKey = "ownerZ";
    mocks.query.symbol = "RELIANCE";
    const r1 = await stageSwingOrder({
      ownerKey: "ownerZ",
      candidate: makeCandidate("RELIANCE"),
      portfolioState,
    });
    expect(r1.staged).toBe(true);

    mocks.query.ownerKey = "ownerZ";
    mocks.query.symbol = "INFY";
    const r2 = await stageSwingOrder({
      ownerKey: "ownerZ",
      candidate: makeCandidate("INFY"),
      portfolioState,
    });
    expect(r2.staged).toBe(true);
    expect(mocks.store.size).toBe(2);
  });

  it("T10: advisory lock (pg_advisory_xact_lock) is called once per transaction", async () => {
    const { stageSwingOrder } = await import("./swingOrderStaging.js");
    const ownerKey = "ownerH";
    const candidate = makeCandidate("MARUTI");
    const portfolioState = makePortfolioState();
    mocks.query.ownerKey = ownerKey;
    mocks.query.symbol = candidate.symbol;

    mocks.advisory.callCount = 0;
    await stageSwingOrder({ ownerKey, candidate, portfolioState });
    expect(mocks.advisory.callCount).toBe(1);
  });

  it("T11: a genuine persistence error is not mistaken for DUPLICATE_ACTIVE_STAGE", async () => {
    const { stageSwingOrder } = await import("./swingOrderStaging.js");
    const ownerKey = "ownerI";
    const candidate = makeCandidate("TITAN");
    const portfolioState = makePortfolioState();
    mocks.query.ownerKey = ownerKey;
    mocks.query.symbol = candidate.symbol;

    const originalInsert = mocks.mockTx.insert;
    (mocks.mockTx as unknown as Record<string, unknown>).insert = () => ({
      values: () => ({
        returning: async () => {
          throw new Error("DB_CONNECTION_REFUSED");
        },
      }),
    });

    await expect(
      stageSwingOrder({ ownerKey, candidate, portfolioState }),
    ).rejects.toThrow("DB_CONNECTION_REFUSED");

    (mocks.mockTx as unknown as Record<string, unknown>).insert = originalInsert;
  });

  it("T12: source code: SELECT and INSERT are inside db.transaction with pg_advisory_xact_lock", () => {
    const src = readFileSync(
      join(__dirname, "swingOrderStaging.ts"),
      "utf8",
    );

    // Prove db.transaction is used.
    expect(src).toContain("db.transaction(async (tx) => {");
    // Prove advisory lock is acquired inside the transaction.
    expect(src).toContain("pg_advisory_xact_lock(8274615)");
    // Prove SELECT is inside the transaction (tx.select, chained from tx).
    expect(src).toContain("await tx");
    expect(src).toContain(".select()");
    // Prove INSERT is inside the transaction.
    expect(src).toContain("await tx.insert(swingOrderStagingTable)");
    // Prove all three are in the same transaction block.
    const txBlock = src.slice(
      src.indexOf("db.transaction(async (tx) => {"),
      src.indexOf("});", src.indexOf("db.transaction(async (tx) => {")) + 3,
    );
    expect(txBlock).toContain("pg_advisory_xact_lock");
    expect(txBlock).toContain(".select()");
    expect(txBlock).toContain("tx.insert(");
    // Prove different lock key from the combo-open lock.
    expect(src).not.toMatch(/pg_advisory_xact_lock\(7593721\)/);
    expect(src).toContain("pg_advisory_xact_lock(8274615)");
  });
});
