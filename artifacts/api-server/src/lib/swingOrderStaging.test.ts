/**
 * Swing CASH Live-Readiness — Phase 2 staging service tests (Part L cases 1-20).
 *
 * DB-backed cases run only when DATABASE_URL is set (dev DB) and are isolated by
 * a per-run ownerKey prefix that is swept in afterAll — they never touch real
 * rows. The static-guard cases (19/20: no destructive schema change, no F&O
 * coupling) need no DB and always run.
 *
 * ABSOLUTE INVARIANTS asserted here:
 *   - Broker execution stays HARD-disabled: an approved order is BROKER_DISABLED
 *     with null broker id, or a clearly-synthetic DRYRUN- record. Never a real
 *     order.
 *   - Kill switch blocks staging AND approval (fail-closed).
 *   - Approval re-checks LIVE data fail-closed (stale / chased / sector / dup /
 *     event-review all block).
 *   - Yahoo is never staged as trade-grade.
 *   - Missing intraday path → MISSED_PNL_UNAVAILABLE (honest, never fabricated).
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@workspace/db";
import { swingOrderStagingTable } from "@workspace/db/schema";
import {
  approveSwingOrder,
  buildMissedOpportunity,
  deriveStageStatus,
  expireStaleSwingOrders,
  getSwingOrder,
  listSwingOrders,
  markWatchOnlySwingOrder,
  refreshAndRecheckSwingOrder,
  rejectSwingOrder,
  stageSwingOrder,
} from "./swingOrderStaging";
import {
  __resetKillSwitchCacheForTests,
  getKillSwitch,
  setKillSwitch,
  type SwingKillSwitchState,
} from "./swingKillSwitch";
import { isLiveCashSwingOrderEnabled } from "./swingLiveExecutionConfig";
import type { SwingCashCandidate, SwingCashPortfolioState } from "./swingCashTypes";
import type { SwingLiveQuote, SwingQuoteFetcher } from "./swingCashLiveCandidateAdapter";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Builders — a clean candidate that stages as STAGED in paper_only mode.
// ---------------------------------------------------------------------------

function cleanCandidate(t: number, o: Partial<SwingCashCandidate> = {}): SwingCashCandidate {
  return {
    symbol: "TESTSTK",
    sector: "IT",
    entry: 100,
    stop: 95,
    target1: 115,
    target2: 125,
    atr: 4,
    ltp: 100.5,
    rr: 3,
    dataSource: "kite",
    ohlc: { open: 100, high: 101, low: 99, close: 100.5 },
    dailyCandleAsOfMs: t,
    ltpAsOfMs: t,
    fallbackUsed: false,
    fallbackReason: null,
    benchmarkAvailable: true,
    sectorAvailable: true,
    entryZoneLow: 99,
    entryZoneHigh: 101,
    signalAgeDays: 0,
    validityExpiryMs: t + 24 * 60 * 60 * 1000,
    triggered: true,
    avgTradedValue: 2e8,
    volume: 1e6,
    spreadPct: 0.1,
    deliveryPct: 50,
    asmGsmStatus: "NONE",
    circuitRisk: false,
    daysToResult: 30,
    isResultDay: false,
    corporateActionRisk: false,
    eventDataAvailable: true,
    resultScheduleKnown: true,
    newsRiskAvailable: true,
    nowMs: t,
    ...o,
  };
}

function cleanPortfolio(o: Partial<SwingCashPortfolioState> = {}): SwingCashPortfolioState {
  return {
    totalSwingCapital: 1_000_000,
    availableCash: 1_000_000,
    openPositionSymbols: [],
    sectorExposureValueBySector: {},
    singleStockExposureValueBySymbol: {},
    sectorOpenCountBySector: {},
    lastEntryDateBySymbolIst: {},
    todayIst: "2026-06-29",
    dailyEntriesUsed: 0,
    weeklyEntriesUsed: 0,
    openPositionsCount: 0,
    ...o,
  };
}

function freshKiteQuote(symbol: string, ltp: number, asOf: number): SwingLiveQuote {
  return {
    symbol,
    ok: true,
    ltp,
    dataSource: "kite",
    ltpAsOfMs: asOf,
    dailyCandleAsOfMs: asOf,
    ohlc: { open: ltp, high: ltp, low: ltp, close: ltp },
    isStale: false,
    validationStatus: "validated",
    reason: null,
  };
}

function makeFetcher(quote: SwingLiveQuote | null): SwingQuoteFetcher {
  return vi.fn(async () => quote);
}

function restoreEnv(key: string, val: string | undefined): void {
  if (val === undefined) delete process.env[key];
  else process.env[key] = val;
}

// ===========================================================================
// DB-backed cases (1-18) — isolated by ownerKey prefix.
// ===========================================================================

describe.skipIf(!process.env.DATABASE_URL)("swingOrderStaging (DB)", () => {
  const OWNER_PREFIX = `test-swing-stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-`;
  let ownerCounter = 0;
  const nextOwner = (): string => `${OWNER_PREFIX}${++ownerCounter}`;

  let origMode: string | undefined;
  let origFlag: string | undefined;
  let origKill: SwingKillSwitchState;

  beforeAll(async () => {
    origMode = process.env.SWING_CASH_EXECUTION_MODE;
    origFlag = process.env.LIVE_CASH_SWING_ORDER_ENABLED;
    origKill = await getKillSwitch();
  });

  afterAll(async () => {
    // Restore the kill switch to its original persisted state.
    __resetKillSwitchCacheForTests();
    await setKillSwitch(origKill.enabled, origKill.reason, origKill.updatedBy);
    __resetKillSwitchCacheForTests();
    // Sweep only the rows this run created.
    await db
      .delete(swingOrderStagingTable)
      .where(like(swingOrderStagingTable.ownerKey, `${OWNER_PREFIX}%`));
    restoreEnv("SWING_CASH_EXECUTION_MODE", origMode);
    restoreEnv("LIVE_CASH_SWING_ORDER_ENABLED", origFlag);
  });

  beforeEach(async () => {
    process.env.SWING_CASH_EXECUTION_MODE = "paper_only";
    delete process.env.LIVE_CASH_SWING_ORDER_ENABLED;
    __resetKillSwitchCacheForTests();
    await setKillSwitch(false, null, null);
  });

  // 1 ----------------------------------------------------------------------
  it("Case 1: stages a valid candidate (broker stays disabled)", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const res = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    expect(res.staged).toBe(true);
    expect(res.status).toBe("STAGED");
    expect(res.row).toBeDefined();
    expect(res.row!.brokerStatus).toBe("BROKER_DISABLED");
    expect(res.row!.brokerOrderId).toBeNull();
    expect(res.row!.executionMode).toBe("paper_only");
  });

  // 2 ----------------------------------------------------------------------
  it("Case 2: refuses to stage when a hard risk guard blocks (not stored)", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const res = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t, { circuitRisk: true }),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    expect(res.staged).toBe(false);
    expect(res.status).toBe("REJECTED");
    expect(res.reason).toBe("NOT_STAGEABLE_HARD_BLOCK");
    expect(res.decision.reasons).toContain("CIRCUIT_RISK");
    // Nothing persisted.
    const rows = await listSwingOrders(owner);
    expect(rows.length).toBe(0);
  });

  // 3 ----------------------------------------------------------------------
  it("Case 3: a staged order stores the full risk-decision JSON + snapshot", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const res = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    expect(res.staged).toBe(true);
    const row = res.row!;
    const decision = row.riskDecisionJson as Record<string, unknown>;
    expect(decision).toBeTruthy();
    expect(decision.allowed).toBe(true);
    expect(decision.gates).toBeTruthy();
    expect((decision.metrics as { qty: number }).qty).toBeGreaterThanOrEqual(1);
    const snap = row.candidateSnapshotJson as { candidate: { symbol: string } };
    expect(snap.candidate.symbol).toBe("TESTSTK");
  });

  // 4 ----------------------------------------------------------------------
  it("Case 4: a staged order expires after its TTL (expiry-on-read)", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const res = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
      ttlMs: 1000,
    });
    expect(res.staged).toBe(true);
    const later = new Date(t + 3 * 60 * 60 * 1000);
    const row = await getSwingOrder(owner, res.row!.id, later);
    expect(row).toBeTruthy();
    expect(row!.status).toBe("EXPIRED");
    expect(row!.approvalStatus).toBe("EXPIRED");
  });

  // 5 ----------------------------------------------------------------------
  it("Case 5: approval re-checks LIVE data and approves (broker disabled)", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    const fetchQuote = makeFetcher(freshKiteQuote("TESTSTK", 100.5, t));
    const res = await approveSwingOrder(owner, staged.row!.id, "owner", {
      fetchQuote,
      now: new Date(t),
    });
    expect(fetchQuote).toHaveBeenCalledWith("TESTSTK");
    expect(res.approved).toBe(true);
    if (res.approved) {
      expect(res.status).toBe("APPROVED");
      expect(res.availability.ltpRefreshed).toBe(true);
      expect(res.availability.quoteSource).toBe("kite");
      expect(res.row.brokerStatus).toBe("BROKER_DISABLED");
      expect(res.row.brokerOrderId).toBeNull();
      expect(res.row.recheckDecisionJson).toBeTruthy();
    }
  });

  // 6 ----------------------------------------------------------------------
  it("Case 6: approval fails when the live quote is stale", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    // 10-min-old LTP > the 5-min trade-grade freshness window.
    const stale = freshKiteQuote("TESTSTK", 100.5, t - 10 * 60 * 1000);
    const res = await approveSwingOrder(owner, staged.row!.id, "owner", {
      fetchQuote: makeFetcher(stale),
      now: new Date(t),
    });
    expect(res.approved).toBe(false);
    if (!res.approved) {
      expect(res.reason).toBe("RECHECK_BLOCKED");
      expect(res.decision?.reasons).toContain("DATA_STALE");
    }
  });

  // 7 ----------------------------------------------------------------------
  it("Case 7: approval fails when entry has been chased", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    // LTP 110 is > entry + 0.5*ATR (=102) → chased.
    const chased = freshKiteQuote("TESTSTK", 110, t);
    const res = await approveSwingOrder(owner, staged.row!.id, "owner", {
      fetchQuote: makeFetcher(chased),
      now: new Date(t),
    });
    expect(res.approved).toBe(false);
    if (!res.approved) {
      expect(res.reason).toBe("RECHECK_BLOCKED");
      expect(res.decision?.reasons).toContain("ENTRY_CHASED");
    }
  });

  // 8 ----------------------------------------------------------------------
  it("Case 8: approval fails when the sector exposure cap is exceeded", async () => {
    const owner = nextOwner();
    const t = Date.now();
    // Stageable via event-review (eventDataAvailable=false), but the frozen
    // portfolio already breaches the IT sector cap (25% of the ₹100k live base).
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t, { eventDataAvailable: false }),
      portfolioState: cleanPortfolio({ sectorExposureValueBySector: { IT: 30_000 } }),
      now: new Date(t),
    });
    expect(staged.staged).toBe(true);
    expect(staged.status).toBe("APPROVAL_REQUIRED");
    const res = await approveSwingOrder(owner, staged.row!.id, "owner", {
      fetchQuote: makeFetcher(freshKiteQuote("TESTSTK", 100.5, t)),
      now: new Date(t),
    });
    expect(res.approved).toBe(false);
    if (!res.approved) {
      expect(res.reason).toBe("RECHECK_BLOCKED");
      expect(res.decision?.reasons).toContain("SECTOR_EXPOSURE_EXCEEDED");
    }
  });

  // 9 ----------------------------------------------------------------------
  it("Case 9: approval fails when the stock is already open (duplicate)", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t, { eventDataAvailable: false }),
      portfolioState: cleanPortfolio({
        openPositionSymbols: ["TESTSTK"],
        openPositionsCount: 1,
      }),
      now: new Date(t),
    });
    expect(staged.staged).toBe(true);
    expect(staged.status).toBe("APPROVAL_REQUIRED");
    const res = await approveSwingOrder(owner, staged.row!.id, "owner", {
      fetchQuote: makeFetcher(freshKiteQuote("TESTSTK", 100.5, t)),
      now: new Date(t),
    });
    expect(res.approved).toBe(false);
    if (!res.approved) {
      expect(res.reason).toBe("RECHECK_BLOCKED");
      expect(res.decision?.reasons).toContain("DUPLICATE_POSITION");
    }
  });

  // 10 ---------------------------------------------------------------------
  it("Case 10: event-risk forces review; owner override clears it", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t, { eventDataAvailable: false, resultScheduleKnown: false }),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    expect(staged.staged).toBe(true);
    expect(staged.status).toBe("APPROVAL_REQUIRED");

    // Approve WITHOUT override → still blocked (event calendar unavailable).
    const blocked = await approveSwingOrder(owner, staged.row!.id, "owner", {
      fetchQuote: makeFetcher(freshKiteQuote("TESTSTK", 100.5, t)),
      now: new Date(t),
    });
    expect(blocked.approved).toBe(false);
    if (!blocked.approved) expect(blocked.reason).toBe("RECHECK_BLOCKED");

    // Approve WITH an owner event affirmation → clears review, approves.
    const ok = await approveSwingOrder(owner, staged.row!.id, "owner", {
      fetchQuote: makeFetcher(freshKiteQuote("TESTSTK", 100.5, t)),
      eventOverride: { resultDateKnown: true, resultDate: "2026-08-01", corporateActionRisk: false },
      now: new Date(t),
    });
    expect(ok.approved).toBe(true);
    if (ok.approved) expect(ok.status).toBe("APPROVED");
  });

  // 11 ---------------------------------------------------------------------
  it("Case 11: a staged order can be rejected", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    const res = await rejectSwingOrder(owner, staged.row!.id, "not now");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.row.status).toBe("REJECTED");
      expect(res.row.approvalStatus).toBe("REJECTED");
      expect(res.row.rejectionReason).toBe("not now");
    }
  });

  // 12 ---------------------------------------------------------------------
  it("Case 12: a staged order can be moved to watch-only", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    const res = await markWatchOnlySwingOrder(owner, staged.row!.id);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.row.status).toBe("WATCH_ONLY");
  });

  // 13 ---------------------------------------------------------------------
  it("Case 13: dry-run mode records a SYNTHETIC placement, never a real order", async () => {
    process.env.SWING_CASH_EXECUTION_MODE = "live_dry_run";
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    // live_dry_run requires manual approval first.
    expect(staged.staged).toBe(true);
    const res = await approveSwingOrder(owner, staged.row!.id, "owner", {
      fetchQuote: makeFetcher(freshKiteQuote("TESTSTK", 100.5, t)),
      now: new Date(t),
    });
    expect(res.approved).toBe(true);
    if (res.approved) {
      expect(res.status).toBe("DRY_RUN_PLACED");
      expect(res.row.brokerStatus).toBe("DRY_RUN_PLACED");
      expect(res.row.brokerOrderId).toMatch(/^DRYRUN-/);
      const resp = res.row.brokerResponseJson as { placed: boolean };
      expect(resp.placed).toBe(false);
    }
  });

  // 14 ---------------------------------------------------------------------
  it("Case 14: LIVE_CASH_SWING_ORDER_ENABLED=false keeps approval broker-disabled", async () => {
    process.env.SWING_CASH_EXECUTION_MODE = "live_staged_approval";
    delete process.env.LIVE_CASH_SWING_ORDER_ENABLED;
    expect(isLiveCashSwingOrderEnabled()).toBe(false);
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    const res = await approveSwingOrder(owner, staged.row!.id, "owner", {
      fetchQuote: makeFetcher(freshKiteQuote("TESTSTK", 100.5, t)),
      now: new Date(t),
    });
    expect(res.approved).toBe(true);
    if (res.approved) {
      expect(res.status).toBe("APPROVED");
      expect(res.row.brokerStatus).toBe("BROKER_DISABLED");
      expect(res.row.brokerOrderId).toBeNull();
    }
  });

  // 15 ---------------------------------------------------------------------
  it("Case 15: kill switch blocks staging", async () => {
    const owner = nextOwner();
    const t = Date.now();
    __resetKillSwitchCacheForTests();
    await setKillSwitch(true, "test", "owner");
    const res = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    expect(res.staged).toBe(false);
    expect(res.reason).toBe("KILL_SWITCH_ACTIVE");
    const rows = await listSwingOrders(owner);
    expect(rows.length).toBe(0);
  });

  // 16 ---------------------------------------------------------------------
  it("Case 16: kill switch blocks approval", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    expect(staged.staged).toBe(true);
    __resetKillSwitchCacheForTests();
    await setKillSwitch(true, "test", "owner");
    const res = await approveSwingOrder(owner, staged.row!.id, "owner", {
      fetchQuote: makeFetcher(freshKiteQuote("TESTSTK", 100.5, t)),
      now: new Date(t),
    });
    expect(res.approved).toBe(false);
    if (!res.approved) expect(res.reason).toBe("KILL_SWITCH_ACTIVE");
  });

  // 17 ---------------------------------------------------------------------
  it("Case 17: expiry stamps an honest missed-opportunity record", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
      ttlMs: 1000,
    });
    const later = new Date(t + 3 * 60 * 60 * 1000);
    const expired = await expireStaleSwingOrders(owner, {
      now: later,
      fetchQuote: makeFetcher(freshKiteQuote("TESTSTK", 101, t + 3 * 60 * 60 * 1000)),
    });
    expect(expired).toBeGreaterThanOrEqual(1);
    const row = await getSwingOrder(owner, staged.row!.id, later);
    const missed = row!.missedOpportunityJson as {
      status: string;
      priceAtExpiry: number | null;
      pathHigh: null;
      pathLow: null;
    };
    expect(missed).toBeTruthy();
    expect(missed.status).toBe("PRICE_AT_EXPIRY_RECORDED");
    expect(missed.priceAtExpiry).toBe(101);
    // Intraday path is never fabricated.
    expect(missed.pathHigh).toBeNull();
    expect(missed.pathLow).toBeNull();

    // Without a live quote the true missed P&L is honestly UNAVAILABLE.
    const unavailable = buildMissedOpportunity(
      { entryPrice: 100, stopLoss: 95, target1: 115, target2: 125 },
      null,
      later.getTime(),
    );
    expect(unavailable.status).toBe("MISSED_PNL_UNAVAILABLE");
    expect(unavailable.priceAtExpiry).toBeNull();
  });

  // 18 ---------------------------------------------------------------------
  it("Case 18: a Yahoo quote is never staged as trade-grade", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const res = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t, { dataSource: "yahoo" }),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    // Yahoo is info-only: never a clean STAGED order and never allowed.
    expect(res.status).not.toBe("STAGED");
    expect(res.decision.allowed).toBe(false);
    expect(res.decision.gates.dataTrust.trustedForTrade).toBe(false);
    expect(res.decision.gates.dataTrust.classification).toBe("INFO_ONLY_YAHOO");
  });

  // Extra: refresh-and-recheck does not transition status.
  it("refreshAndRecheckSwingOrder records a recheck without changing status", async () => {
    const owner = nextOwner();
    const t = Date.now();
    const staged = await stageSwingOrder({
      ownerKey: owner,
      candidate: cleanCandidate(t),
      portfolioState: cleanPortfolio(),
      now: new Date(t),
    });
    const res = await refreshAndRecheckSwingOrder(owner, staged.row!.id, {
      fetchQuote: makeFetcher(freshKiteQuote("TESTSTK", 100.5, t)),
      now: new Date(t),
    });
    expect(res.ok).toBe(true);
    const row = await getSwingOrder(owner, staged.row!.id, new Date(t));
    expect(row!.status).toBe("STAGED");
    expect(row!.recheckDecisionJson).toBeTruthy();
  });
});

// ===========================================================================
// Pure deriveStageStatus mapping (no DB).
// ===========================================================================

describe("deriveStageStatus", () => {
  const base = (over: Record<string, unknown>) =>
    ({
      allowed: false,
      reviewRequired: false,
      gates: { entry: { watchOnly: false } },
      ...over,
    }) as never;

  it("maps a clean allowed decision to STAGED", () => {
    expect(deriveStageStatus(base({ allowed: true })).status).toBe("STAGED");
  });
  it("maps review-required to APPROVAL_REQUIRED (stageable)", () => {
    const d = deriveStageStatus(base({ reviewRequired: true }));
    expect(d.status).toBe("APPROVAL_REQUIRED");
    expect(d.stageable).toBe(true);
  });
  it("maps waiting-for-trigger to WATCH_ONLY", () => {
    expect(deriveStageStatus(base({ gates: { entry: { watchOnly: true } } })).status).toBe(
      "WATCH_ONLY",
    );
  });
  it("maps an un-reviewable hard block to REJECTED (not stored)", () => {
    const d = deriveStageStatus(base({}));
    expect(d.status).toBe("REJECTED");
    expect(d.stageable).toBe(false);
  });
});

// ===========================================================================
// Static guards (19/20) — no DB required.
// ===========================================================================

describe("Phase-2 static safety guards", () => {
  const swingSourceFiles = (): string[] =>
    readdirSync(__dirname)
      .filter((f) => f.startsWith("swing") && f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(__dirname, f));

  // Strip block + line comments so cautionary docs (e.g. "NEVER drizzle-kit
  // push") are not mistaken for destructive CODE.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  // 19 ---------------------------------------------------------------------
  it("Case 19: no destructive schema change in Phase-2 sources", () => {
    const schemaPath = join(
      __dirname,
      "../../../../lib/db/src/schema/swingOrderStaging.ts",
    );
    const files = [...swingSourceFiles()];
    if (existsSync(schemaPath)) files.push(schemaPath);

    const destructive = [
      /\bDROP\s+TABLE\b/i,
      /\bDROP\s+COLUMN\b/i,
      /\bALTER\s+TABLE\b[\s\S]*\bDROP\b/i,
      /\bTRUNCATE\b/i,
      /drizzle-kit\s+push/i,
    ];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const re of destructive) {
        expect(re.test(src), `${f} must not contain executable ${re}`).toBe(false);
      }
    }
    // The migration approach is additive: non-destructive CREATE TABLE.
    if (existsSync(schemaPath)) {
      expect(readFileSync(schemaPath, "utf8")).toContain("pgTable");
    }
  });

  // 20 ---------------------------------------------------------------------
  it("Case 20: no F&O / option-chain / paper-trade / capital-ledger imports", () => {
    const forbidden = [
      /optionSignals/i,
      /optionChain/i,
      /\boiLab/i,
      /fnoPaper/i,
      /fnoCost/i,
      /fnoSignal/i,
      /paperAccount/i,
      /paperTrade/i,
      /capitalLedger/i,
      /kiteOptionChain/i,
      /kiteFno/i,
      /kiteIndexQuotes/i,
    ];
    const importRe = /(?:from|import)\s*["']([^"']+)["']/g;
    for (const f of swingSourceFiles()) {
      const src = readFileSync(f, "utf8");
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) {
        const source = m[1];
        for (const re of forbidden) {
          expect(re.test(source), `${f} imports forbidden module ${source}`).toBe(false);
        }
      }
    }
  });
});
