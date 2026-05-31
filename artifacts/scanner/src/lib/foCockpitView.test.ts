import { describe, it, expect } from "vitest";
import {
  toNum,
  parseTs,
  getQuantity,
  effectivePnl,
  hasMfeMaeEvidence,
  deriveFoPnlPct,
  getP25EligibilityReason,
  isP25EligibleTrade,
  deriveP25Summary,
  summarizeFoCockpit,
  deriveFoRiskBadges,
  DEFAULT_FO_FILTERS,
  applyFoFilters,
  sortFoRows,
  groupFoRows,
  getTimeInTradeMs,
  getFoLastActivityAt,
  isFoQuoteStale,
  deriveFoEmptyState,
  uniqueIndexes,
  uniqueSetups,
  uniqueExitReasons,
  deriveP25Headline,
  deriveFoFreshness,
  FO_SAFETY_STATIC_LINES,
  type FoTradeRow,
  type FoFilters,
} from "./foCockpitView";

// ── fixtures ──────────────────────────────────────────────────────────────────

const closedEligible = (over: Partial<FoTradeRow> = {}): FoTradeRow => ({
  id: "c1",
  signalDate: "2026-05-29",
  indexSymbol: "NIFTY",
  indexName: "Nifty 50",
  setupKey: "TREND_CONTINUATION",
  direction: "LONG",
  optionType: "CE",
  strike: 23000,
  lots: 10,
  lotSize: 50,
  entryPremium: 100,
  exitPremium: 130,
  capitalDeployed: 50000,
  realizedPnl: 15000,
  exitReason: "TARGET1",
  maxRunup: 18000,
  maxDrawdown: -4000,
  openedAt: "2026-05-29T04:00:00.000Z",
  exitedAt: "2026-05-29T06:00:00.000Z",
  lastEvaluatedAt: "2026-05-29T06:00:00.000Z",
  status: "CLOSED",
  ...over,
});

const openRow = (over: Partial<FoTradeRow> = {}): FoTradeRow => ({
  id: "o1",
  signalDate: "2026-05-31",
  indexSymbol: "BANKNIFTY",
  setupKey: "VWAP_RECLAIM",
  direction: "SHORT",
  optionType: "PE",
  strike: 48000,
  lots: 15,
  lotSize: 15,
  entryPremium: 200,
  lastPremium: 180,
  capitalDeployed: 45000,
  unrealizedPnl: -4500,
  maxRunup: 1200,
  maxDrawdown: -5000,
  openedAt: "2026-05-31T05:00:00.000Z",
  lastEvaluatedAt: "2026-05-31T05:30:00.000Z",
  status: "OPEN",
  ...over,
});

// ── safe primitives ────────────────────────────────────────────────────────────

describe("safe primitives", () => {
  it("toNum parses numbers, numeric strings, and rejects junk", () => {
    expect(toNum(12)).toBe(12);
    expect(toNum("12.5")).toBe(12.5);
    expect(toNum(" 3 ")).toBe(3);
    expect(toNum(null)).toBeNaN();
    expect(toNum(undefined)).toBeNaN();
    expect(toNum("")).toBeNaN();
    expect(toNum("abc")).toBeNaN();
    expect(toNum(NaN)).toBeNaN();
    expect(toNum(Infinity)).toBeNaN();
  });

  it("parseTs parses ISO and rejects junk", () => {
    expect(parseTs("2026-05-29T06:00:00.000Z")).toBe(Date.parse("2026-05-29T06:00:00.000Z"));
    expect(parseTs(null)).toBeNaN();
    expect(parseTs("not-a-date")).toBeNaN();
  });

  it("getQuantity multiplies lots × lotSize and guards missing", () => {
    expect(getQuantity({ lots: 10, lotSize: 50 })).toBe(500);
    expect(getQuantity({ lots: "10", lotSize: "50" })).toBe(500);
    expect(getQuantity({ lots: null, lotSize: 50 })).toBeNaN();
    expect(getQuantity({ lots: 10, lotSize: null })).toBeNaN();
  });

  it("effectivePnl picks realised for closed, unrealised for open", () => {
    expect(effectivePnl(closedEligible({ realizedPnl: 100 }))).toBe(100);
    expect(effectivePnl(openRow({ unrealizedPnl: -50 }))).toBe(-50);
  });

  it("hasMfeMaeEvidence rejects missing and 0/0", () => {
    expect(hasMfeMaeEvidence({ maxRunup: 1, maxDrawdown: -1 })).toBe(true);
    expect(hasMfeMaeEvidence({ maxRunup: 0, maxDrawdown: 0 })).toBe(false);
    expect(hasMfeMaeEvidence({ maxRunup: null, maxDrawdown: -1 })).toBe(false);
    expect(hasMfeMaeEvidence({ maxRunup: 5, maxDrawdown: null })).toBe(false);
  });
});

// ── 1. P25 eligibility ──────────────────────────────────────────────────────────

describe("P25 official eligibility", () => {
  it("eligible closed trade with non-zero MFE/MAE passes", () => {
    expect(getP25EligibilityReason(closedEligible())).toBe("eligible");
    expect(isP25EligibleTrade(closedEligible())).toBe(true);
  });

  it("closed trade with maxRunup=0 AND maxDrawdown=0 is excluded", () => {
    const row = closedEligible({ maxRunup: 0, maxDrawdown: 0 });
    expect(getP25EligibilityReason(row)).toBe("excluded_zero_zero_mfe_mae");
    expect(isP25EligibleTrade(row)).toBe(false);
  });

  it("non-zero on only one side still counts (NOT a 0/0 placeholder)", () => {
    expect(isP25EligibleTrade(closedEligible({ maxRunup: 0, maxDrawdown: -10 }))).toBe(true);
    expect(isP25EligibleTrade(closedEligible({ maxRunup: 10, maxDrawdown: 0 }))).toBe(true);
  });

  it("raw non-null MFE/MAE is NOT sufficient — 0/0 present but non-null is excluded", () => {
    // Both fields are present (non-null) yet the row must NOT count.
    const row = closedEligible({ maxRunup: 0, maxDrawdown: 0 });
    expect(row.maxRunup).not.toBeNull();
    expect(row.maxDrawdown).not.toBeNull();
    expect(isP25EligibleTrade(row)).toBe(false);
  });

  it("open trade is excluded (not_closed)", () => {
    expect(getP25EligibilityReason(openRow())).toBe("not_closed");
    expect(isP25EligibleTrade(openRow())).toBe(false);
  });

  it("missing exit premium excluded", () => {
    expect(getP25EligibilityReason(closedEligible({ exitPremium: null }))).toBe(
      "missing_exit_premium",
    );
  });

  it("invalid entry premium excluded (zero / negative / missing)", () => {
    expect(getP25EligibilityReason(closedEligible({ entryPremium: 0 }))).toBe(
      "invalid_entry_premium",
    );
    expect(getP25EligibilityReason(closedEligible({ entryPremium: -5 }))).toBe(
      "invalid_entry_premium",
    );
    expect(getP25EligibilityReason(closedEligible({ entryPremium: null }))).toBe(
      "invalid_entry_premium",
    );
  });

  it("invalid quantity excluded (lots or lotSize missing / zero)", () => {
    expect(getP25EligibilityReason(closedEligible({ lots: 0 }))).toBe("invalid_quantity");
    expect(getP25EligibilityReason(closedEligible({ lotSize: null }))).toBe("invalid_quantity");
  });

  it("missing MFE/MAE excluded", () => {
    expect(getP25EligibilityReason(closedEligible({ maxRunup: null }))).toBe("missing_mfe_mae");
    expect(getP25EligibilityReason(closedEligible({ maxDrawdown: undefined }))).toBe(
      "missing_mfe_mae",
    );
  });

  it("official summary count uses only eligible trades; remaining = threshold - count", () => {
    const rows = [
      closedEligible({ id: "a" }),
      closedEligible({ id: "b" }),
      closedEligible({ id: "z", maxRunup: 0, maxDrawdown: 0 }), // excluded 0/0
      openRow({ id: "o" }), // not closed
      closedEligible({ id: "c", exitPremium: null }), // missing exit
    ];
    const s = deriveP25Summary(rows, 20);
    expect(s.eligibleCount).toBe(2);
    expect(s.remaining).toBe(18);
    expect(s.threshold).toBe(20);
    expect(s.gateOpen).toBe(true);
    expect(s.excludedZeroZeroCount).toBe(1);
    expect(s.reasonCounts.eligible).toBe(2);
    expect(s.reasonCounts.excluded_zero_zero_mfe_mae).toBe(1);
    expect(s.reasonCounts.not_closed).toBe(1);
    expect(s.reasonCounts.missing_exit_premium).toBe(1);
  });

  it("gate closes when eligible count reaches the threshold", () => {
    const rows = Array.from({ length: 20 }, (_, i) => closedEligible({ id: `t${i}` }));
    const s = deriveP25Summary(rows, 20);
    expect(s.eligibleCount).toBe(20);
    expect(s.remaining).toBe(0);
    expect(s.gateOpen).toBe(false);
  });

  it("lastEligible is the most recently exited eligible trade", () => {
    const rows = [
      closedEligible({ id: "old", exitedAt: "2026-05-20T06:00:00.000Z" }),
      closedEligible({ id: "new", exitedAt: "2026-05-28T06:00:00.000Z" }),
      closedEligible({ id: "zz", maxRunup: 0, maxDrawdown: 0, exitedAt: "2026-05-31T06:00:00.000Z" }),
    ];
    expect(deriveP25Summary(rows).lastEligible?.id).toBe("new");
  });

  it("deriveP25Summary does not mutate input", () => {
    const rows = [closedEligible(), openRow()];
    const snapshot = JSON.stringify(rows);
    deriveP25Summary(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

// ── 2. Summary aggregation ──────────────────────────────────────────────────────

describe("summarizeFoCockpit", () => {
  it("aggregates counts, P&L, win/loss, averages, extrema", () => {
    const open = [openRow({ id: "o1", unrealizedPnl: -4500 }), openRow({ id: "o2", unrealizedPnl: 2000 })];
    const closed = [
      closedEligible({ id: "w", realizedPnl: 15000, maxRunup: 18000, maxDrawdown: -4000 }),
      closedEligible({ id: "l", realizedPnl: -6000, maxRunup: 2000, maxDrawdown: -9000 }),
    ];
    const s = summarizeFoCockpit({ openTrades: open, closedTrades: closed });
    expect(s.openCount).toBe(2);
    expect(s.closedCount).toBe(2);
    expect(s.realizedPnl).toBe(9000);
    expect(s.unrealizedPnl).toBe(-2500);
    expect(s.winCount).toBe(1);
    expect(s.lossCount).toBe(1);
    expect(s.avgMfe).toBe(10000); // (18000 + 2000) / 2
    expect(s.avgMae).toBe(-6500); // (-4000 + -9000) / 2
    expect(s.bestTrade?.id).toBe("w");
    expect(s.worstTrade?.id).toBe("l");
  });

  it("closedTodayCount is null without a date, and filters by exit date when supplied", () => {
    const closed = [
      closedEligible({ id: "today", exitedAt: "2026-05-31T06:00:00.000Z" }),
      closedEligible({ id: "yesterday", exitedAt: "2026-05-30T06:00:00.000Z" }),
    ];
    expect(summarizeFoCockpit({ openTrades: [], closedTrades: closed }).closedTodayCount).toBeNull();
    expect(
      summarizeFoCockpit({ openTrades: [], closedTrades: closed, todayDate: "2026-05-31" })
        .closedTodayCount,
    ).toBe(1);
  });

  it("last open / evaluation timestamps are the latest seen", () => {
    const s = summarizeFoCockpit({
      openTrades: [openRow({ openedAt: "2026-05-31T05:00:00.000Z", lastEvaluatedAt: "2026-05-31T05:45:00.000Z" })],
      closedTrades: [closedEligible({ openedAt: "2026-05-29T04:00:00.000Z", lastEvaluatedAt: "2026-05-29T06:00:00.000Z" })],
    });
    expect(s.lastOpenAt).toBe("2026-05-31T05:00:00.000Z");
    expect(s.lastEvaluatedAt).toBe("2026-05-31T05:45:00.000Z");
  });

  it("P25 fields reflect only eligible closed trades", () => {
    const s = summarizeFoCockpit({
      openTrades: [openRow()],
      closedTrades: [closedEligible(), closedEligible({ maxRunup: 0, maxDrawdown: 0 })],
      threshold: 20,
    });
    expect(s.p25Count).toBe(1);
    expect(s.remainingToThreshold).toBe(19);
    expect(s.gateOpen).toBe(true);
  });

  it("handles empty arrays without throwing", () => {
    const s = summarizeFoCockpit({ openTrades: [], closedTrades: [] });
    expect(s.openCount).toBe(0);
    expect(s.closedCount).toBe(0);
    expect(s.realizedPnl).toBe(0);
    expect(s.unrealizedPnl).toBe(0);
    expect(s.winCount).toBe(0);
    expect(s.lossCount).toBe(0);
    expect(s.avgMfe).toBeNull();
    expect(s.avgMae).toBeNull();
    expect(s.bestTrade).toBeNull();
    expect(s.worstTrade).toBeNull();
    expect(s.lastOpenAt).toBeNull();
    expect(s.lastEvaluatedAt).toBeNull();
    expect(s.p25Count).toBe(0);
  });

  it("ignores non-finite P&L when summing", () => {
    const s = summarizeFoCockpit({
      openTrades: [openRow({ unrealizedPnl: null })],
      closedTrades: [closedEligible({ realizedPnl: "oops" as unknown as number })],
    });
    expect(s.realizedPnl).toBe(0);
    expect(s.unrealizedPnl).toBe(0);
    expect(s.winCount).toBe(0);
    expect(s.lossCount).toBe(0);
  });
});

// ── 3. Risk badges ───────────────────────────────────────────────────────────

const labels = (row: FoTradeRow, opts = {}): string[] =>
  deriveFoRiskBadges(row, opts).map((b) => b.label);

describe("deriveFoRiskBadges", () => {
  it("always tags paper-only", () => {
    expect(labels(closedEligible())).toContain("paper-only");
    expect(labels(openRow())).toContain("paper-only");
  });

  it("tags open/closed position status", () => {
    expect(labels(openRow())).toContain("open-position");
    expect(labels(closedEligible())).toContain("closed-position");
  });

  it("tags profit and loss from effective P&L", () => {
    expect(labels(closedEligible({ realizedPnl: 100 }))).toContain("profit");
    expect(labels(closedEligible({ realizedPnl: -100 }))).toContain("loss");
    expect(labels(openRow({ unrealizedPnl: 50 }))).toContain("profit");
    expect(labels(openRow({ unrealizedPnl: -50 }))).toContain("loss");
  });

  it("tags evidence-eligible and evidence-excluded-0/0", () => {
    expect(labels(closedEligible())).toContain("evidence-eligible");
    expect(labels(closedEligible({ maxRunup: 0, maxDrawdown: 0 }))).toContain(
      "evidence-excluded-0/0",
    );
  });

  it("tags no-MFE-data when MFE/MAE missing", () => {
    expect(labels(closedEligible({ maxRunup: null, maxDrawdown: null }))).toContain("no-MFE-data");
  });

  it("tags high-drawdown relative to deployed capital", () => {
    const row = closedEligible({ capitalDeployed: 50000, maxDrawdown: -30000 });
    expect(labels(row, { highDrawdownPct: 0.5 })).toContain("high-drawdown");
    const mild = closedEligible({ capitalDeployed: 50000, maxDrawdown: -1000 });
    expect(labels(mild, { highDrawdownPct: 0.5 })).not.toContain("high-drawdown");
  });

  it("tags exit type from exitReason", () => {
    expect(labels(closedEligible({ exitReason: "TIME_EXIT_1520" }))).toContain("time-exit");
    expect(labels(closedEligible({ exitReason: "STOP_LOSS" }))).toContain("stop-exit");
    expect(labels(closedEligible({ exitReason: "TARGET1" }))).toContain("target-exit");
  });

  it("tags stale-quote only for open rows past the window", () => {
    const now = Date.parse("2026-05-31T06:00:00.000Z");
    const stale = openRow({ lastEvaluatedAt: "2026-05-31T05:00:00.000Z" }); // 60m old
    const fresh = openRow({ lastEvaluatedAt: "2026-05-31T05:58:00.000Z" }); // 2m old
    expect(labels(stale, { now, staleMinutes: 15 })).toContain("stale-quote");
    expect(labels(fresh, { now, staleMinutes: 15 })).not.toContain("stale-quote");
    // closed rows never stale
    expect(labels(closedEligible(), { now, staleMinutes: 15 })).not.toContain("stale-quote");
  });

  it("tags snapshot-missing and low-sample-warning from options", () => {
    expect(labels(openRow(), { snapshotMissing: true })).toContain("missing-option-snapshot");
    expect(labels(openRow(), { lowSampleWarning: true })).toContain("low-sample-warning");
  });
});

// ── 4. Filters ─────────────────────────────────────────────────────────────────

const mixedRows = (): FoTradeRow[] => [
  closedEligible({ id: "n1", indexSymbol: "NIFTY", setupKey: "TREND", direction: "LONG", optionType: "CE", realizedPnl: 1000, exitReason: "TARGET1", signalDate: "2026-05-28" }),
  closedEligible({ id: "b1", indexSymbol: "BANKNIFTY", setupKey: "VWAP", direction: "SHORT", optionType: "PE", realizedPnl: -500, exitReason: "STOP_LOSS", signalDate: "2026-05-29", maxRunup: 0, maxDrawdown: 0 }),
  openRow({ id: "o1", indexSymbol: "NIFTY", setupKey: "TREND", direction: "LONG", optionType: "CE", unrealizedPnl: 250, signalDate: "2026-05-31" }),
];

describe("applyFoFilters", () => {
  const base = (over: Partial<FoFilters> = {}): FoFilters => ({ ...DEFAULT_FO_FILTERS, ...over });

  it("default filters keep everything", () => {
    const rows = mixedRows();
    expect(applyFoFilters(rows, DEFAULT_FO_FILTERS)).toHaveLength(rows.length);
  });

  it("filters by index", () => {
    expect(applyFoFilters(mixedRows(), base({ index: "BANKNIFTY" }))).toHaveLength(1);
  });

  it("filters by setup", () => {
    expect(applyFoFilters(mixedRows(), base({ setup: "TREND" }))).toHaveLength(2);
  });

  it("filters by direction and option type", () => {
    expect(applyFoFilters(mixedRows(), base({ direction: "SHORT" }))).toHaveLength(1);
    expect(applyFoFilters(mixedRows(), base({ optionType: "PE" }))).toHaveLength(1);
  });

  it("filters by status", () => {
    expect(applyFoFilters(mixedRows(), base({ status: "OPEN" }))).toHaveLength(1);
    expect(applyFoFilters(mixedRows(), base({ status: "CLOSED" }))).toHaveLength(2);
  });

  it("filters by P&L sign using effective P&L", () => {
    const pos = applyFoFilters(mixedRows(), base({ pnlSign: "POSITIVE" })).map((r) => r.id);
    expect(pos).toEqual(["n1", "o1"]);
    const neg = applyFoFilters(mixedRows(), base({ pnlSign: "NEGATIVE" })).map((r) => r.id);
    expect(neg).toEqual(["b1"]);
  });

  it("filters by P25 eligibility", () => {
    const out = applyFoFilters(mixedRows(), base({ p25EligibleOnly: true })).map((r) => r.id);
    expect(out).toEqual(["n1"]); // b1 is 0/0 excluded, o1 is open
  });

  it("filters by exit reason", () => {
    expect(applyFoFilters(mixedRows(), base({ exitReason: "STOP_LOSS" }))).toHaveLength(1);
  });

  it("filters by evidence available", () => {
    const out = applyFoFilters(mixedRows(), base({ evidenceAvailableOnly: true })).map((r) => r.id);
    // n1 has evidence, o1 (open) has 1200/-5000 evidence, b1 is 0/0 → excluded
    expect(out).toEqual(["n1", "o1"]);
  });

  it("filters by date range (inclusive) on signalDate", () => {
    const out = applyFoFilters(
      mixedRows(),
      base({ dateFrom: "2026-05-29", dateTo: "2026-05-31" }),
    ).map((r) => r.id);
    expect(out).toEqual(["b1", "o1"]);
  });

  it("combines multiple filters", () => {
    const out = applyFoFilters(
      mixedRows(),
      base({ index: "NIFTY", status: "CLOSED", pnlSign: "POSITIVE" }),
    ).map((r) => r.id);
    expect(out).toEqual(["n1"]);
  });

  it("paperOnly never removes rows", () => {
    expect(applyFoFilters(mixedRows(), base({ paperOnly: true }))).toHaveLength(3);
  });

  it("does not mutate the input array", () => {
    const rows = mixedRows();
    const snapshot = JSON.stringify(rows);
    applyFoFilters(rows, base({ index: "NIFTY" }));
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

// ── 5. Sorting ─────────────────────────────────────────────────────────────────

describe("sortFoRows", () => {
  it("sorts by realised P&L asc and desc", () => {
    const rows = [
      closedEligible({ id: "a", realizedPnl: 100 }),
      closedEligible({ id: "b", realizedPnl: -50 }),
      closedEligible({ id: "c", realizedPnl: 200 }),
    ];
    expect(sortFoRows(rows, "realizedPnl", "asc").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortFoRows(rows, "realizedPnl", "desc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by unrealised P&L", () => {
    const rows = [openRow({ id: "a", unrealizedPnl: -10 }), openRow({ id: "b", unrealizedPnl: 30 })];
    expect(sortFoRows(rows, "unrealizedPnl", "desc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("sorts by MFE and MAE", () => {
    const rows = [
      closedEligible({ id: "a", maxRunup: 5, maxDrawdown: -2 }),
      closedEligible({ id: "b", maxRunup: 9, maxDrawdown: -8 }),
    ];
    expect(sortFoRows(rows, "mfe", "desc").map((r) => r.id)).toEqual(["b", "a"]);
    expect(sortFoRows(rows, "mae", "asc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("sorts by entry time and exit time", () => {
    const rows = [
      closedEligible({ id: "a", openedAt: "2026-05-29T04:00:00.000Z", exitedAt: "2026-05-29T07:00:00.000Z" }),
      closedEligible({ id: "b", openedAt: "2026-05-29T05:00:00.000Z", exitedAt: "2026-05-29T06:00:00.000Z" }),
    ];
    expect(sortFoRows(rows, "entryTime", "asc").map((r) => r.id)).toEqual(["a", "b"]);
    expect(sortFoRows(rows, "exitTime", "asc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("sorts by time in trade", () => {
    const rows = [
      closedEligible({ id: "short", openedAt: "2026-05-29T05:00:00.000Z", exitedAt: "2026-05-29T05:30:00.000Z" }),
      closedEligible({ id: "long", openedAt: "2026-05-29T04:00:00.000Z", exitedAt: "2026-05-29T07:00:00.000Z" }),
    ];
    expect(sortFoRows(rows, "timeInTrade", "desc").map((r) => r.id)).toEqual(["long", "short"]);
  });

  it("sorts by symbol alphabetically", () => {
    const rows = [closedEligible({ id: "a", indexSymbol: "SENSEX" }), closedEligible({ id: "b", indexSymbol: "BANKNIFTY" })];
    expect(sortFoRows(rows, "symbol", "asc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("puts NaN/null values last regardless of direction", () => {
    const rows = [
      closedEligible({ id: "a", realizedPnl: 100 }),
      closedEligible({ id: "bad", realizedPnl: null }),
      closedEligible({ id: "b", realizedPnl: -100 }),
    ];
    expect(sortFoRows(rows, "realizedPnl", "asc").map((r) => r.id)).toEqual(["b", "a", "bad"]);
    expect(sortFoRows(rows, "realizedPnl", "desc").map((r) => r.id)).toEqual(["a", "b", "bad"]);
  });

  it("does not mutate the input array", () => {
    const rows = [closedEligible({ id: "a", realizedPnl: 1 }), closedEligible({ id: "b", realizedPnl: 2 })];
    const order = rows.map((r) => r.id);
    sortFoRows(rows, "realizedPnl", "desc");
    expect(rows.map((r) => r.id)).toEqual(order);
  });
});

// ── 6. Grouping ──────────────────────────────────────────────────────────────

describe("groupFoRows", () => {
  it("none returns a single All group", () => {
    const g = groupFoRows(mixedRows(), "none");
    expect(g).toHaveLength(1);
    expect(g[0]!.key).toBe("All");
    expect(g[0]!.rows).toHaveLength(3);
  });

  it("groups by index", () => {
    const g = groupFoRows(mixedRows(), "index");
    const nifty = g.find((x) => x.key === "NIFTY");
    expect(nifty?.rows).toHaveLength(2);
    expect(g.find((x) => x.key === "BANKNIFTY")?.rows).toHaveLength(1);
  });

  it("groups by setup", () => {
    const g = groupFoRows(mixedRows(), "setup");
    expect(g.find((x) => x.key === "TREND")?.rows).toHaveLength(2);
  });

  it("groups by status", () => {
    const g = groupFoRows(mixedRows(), "status");
    expect(g.find((x) => x.key === "CLOSED")?.rows).toHaveLength(2);
    expect(g.find((x) => x.key === "OPEN")?.rows).toHaveLength(1);
  });

  it("groups by exit reason", () => {
    const g = groupFoRows(mixedRows(), "exitReason");
    expect(g.find((x) => x.key === "STOP_LOSS")?.rows).toHaveLength(1);
    expect(g.find((x) => x.key === "TARGET1")?.rows).toHaveLength(1);
  });

  it("groups by P25 status", () => {
    const g = groupFoRows(mixedRows(), "p25Status");
    expect(g.find((x) => x.key === "P25 eligible")?.rows).toHaveLength(1);
    expect(g.find((x) => x.key === "Excluded 0/0")?.rows).toHaveLength(1);
    expect(g.find((x) => x.key === "Open / not closed")?.rows).toHaveLength(1);
  });

  it("groups by P&L sign", () => {
    const g = groupFoRows(mixedRows(), "pnlSign");
    expect(g.find((x) => x.key === "Profit")?.rows).toHaveLength(2); // n1 (+1000), o1 (+250)
    expect(g.find((x) => x.key === "Loss")?.rows).toHaveLength(1); // b1 (-500)
  });
});

// ── 7. Time helpers ────────────────────────────────────────────────────────────

describe("time helpers", () => {
  it("getTimeInTradeMs uses exit for closed rows", () => {
    const row = closedEligible({ openedAt: "2026-05-29T04:00:00.000Z", exitedAt: "2026-05-29T06:00:00.000Z" });
    expect(getTimeInTradeMs(row)).toBe(2 * 60 * 60 * 1000);
  });

  it("getTimeInTradeMs uses nowMs for open rows when supplied", () => {
    const row = openRow({ openedAt: "2026-05-31T05:00:00.000Z", exitedAt: null });
    const now = Date.parse("2026-05-31T06:00:00.000Z");
    expect(getTimeInTradeMs(row, now)).toBe(60 * 60 * 1000);
  });

  it("getTimeInTradeMs returns NaN when open time missing", () => {
    expect(getTimeInTradeMs(closedEligible({ openedAt: null }))).toBeNaN();
  });

  it("getFoLastActivityAt returns the latest of exit/eval/open", () => {
    expect(
      getFoLastActivityAt(
        closedEligible({
          openedAt: "2026-05-29T04:00:00.000Z",
          lastEvaluatedAt: "2026-05-29T05:00:00.000Z",
          exitedAt: "2026-05-29T06:00:00.000Z",
        }),
      ),
    ).toBe("2026-05-29T06:00:00.000Z");
    expect(getFoLastActivityAt({})).toBeNull();
  });

  it("isFoQuoteStale flags open rows past window and treats missing eval as stale", () => {
    const now = Date.parse("2026-05-31T06:00:00.000Z");
    expect(isFoQuoteStale(openRow({ lastEvaluatedAt: "2026-05-31T05:00:00.000Z" }), now, 15)).toBe(true);
    expect(isFoQuoteStale(openRow({ lastEvaluatedAt: "2026-05-31T05:58:00.000Z" }), now, 15)).toBe(false);
    expect(isFoQuoteStale(openRow({ lastEvaluatedAt: null }), now, 15)).toBe(true);
    expect(isFoQuoteStale(closedEligible(), now, 15)).toBe(false);
    expect(isFoQuoteStale(openRow(), undefined, 15)).toBe(false);
  });
});

// ── 8. Empty state + option lists ───────────────────────────────────────────────

describe("empty-state and option lists", () => {
  it("deriveFoEmptyState classifies sections", () => {
    expect(deriveFoEmptyState("open", null)).toBe("no_data");
    expect(deriveFoEmptyState("open", [])).toBe("no_open_trades");
    expect(deriveFoEmptyState("closed", [])).toBe("no_closed_trades");
    expect(deriveFoEmptyState("open", [openRow()])).toBe("ok");
  });

  it("builds sorted unique option lists", () => {
    const rows = mixedRows();
    expect(uniqueIndexes(rows)).toEqual(["BANKNIFTY", "NIFTY"]);
    expect(uniqueSetups(rows)).toEqual(["TREND", "VWAP"]);
    expect(uniqueExitReasons(rows)).toEqual(["STOP_LOSS", "TARGET1"]);
  });
});

// ── P25 evidence headline ───────────────────────────────────────────────────────

describe("deriveP25Headline", () => {
  it("uses the official eligible count and default threshold 20", () => {
    const h = deriveP25Headline({ officialCount: 5 });
    expect(h.available).toBe(true);
    expect(h.officialCount).toBe(5);
    expect(h.threshold).toBe(20);
    expect(h.remaining).toBe(15);
    expect(h.thresholdMet).toBe(false);
    expect(h.gateStatus).toBe("OPEN");
    expect(h.gateLabel).toBe("Evidence gate open");
    expect(h.ratioLabel).toBe("5/20");
  });

  it("baseline 5/20 → 15 remaining, gate open (official rule)", () => {
    const h = deriveP25Headline({ officialCount: 5, threshold: 20 });
    expect(h.ratioLabel).toBe("5/20");
    expect(h.remaining).toBe(15);
    expect(h.gateStatus).toBe("OPEN");
  });

  it("never goes negative and flips to THRESHOLD_MET at/above the threshold", () => {
    const met = deriveP25Headline({ officialCount: 20 });
    expect(met.remaining).toBe(0);
    expect(met.thresholdMet).toBe(true);
    expect(met.gateStatus).toBe("THRESHOLD_MET");
    expect(met.gateLabel).toBe("Evidence gate: threshold met");

    const over = deriveP25Headline({ officialCount: 25 });
    expect(over.remaining).toBe(0);
    expect(over.thresholdMet).toBe(true);
  });

  it("treats null/undefined/NaN count as unavailable (safe placeholder, gate stays OPEN)", () => {
    for (const v of [null, undefined, NaN]) {
      const h = deriveP25Headline({ officialCount: v as number });
      expect(h.available).toBe(false);
      expect(h.officialCount).toBe(0);
      expect(h.remaining).toBe(20);
      expect(h.thresholdMet).toBe(false);
      expect(h.gateStatus).toBe("OPEN");
      expect(h.ratioLabel).toBe("—/20");
    }
  });

  it("does NOT change the threshold of 20 by default", () => {
    expect(deriveP25Headline({ officialCount: 0 }).threshold).toBe(20);
  });
});

// ── Safety / freshness banner state ─────────────────────────────────────────────

describe("deriveFoFreshness + FO_SAFETY_STATIC_LINES", () => {
  const now = Date.parse("2026-05-31T10:00:00.000Z");

  it("exposes the fixed compliance lines", () => {
    expect(FO_SAFETY_STATIC_LINES).toContain("Paper trading only");
    expect(FO_SAFETY_STATIC_LINES).toContain("No live order placement");
    expect(FO_SAFETY_STATIC_LINES).toContain("No exit-rule change approved");
  });

  it("is healthy when the MTM sweep is recent", () => {
    const r = deriveFoFreshness({
      now,
      mtmSweepLastSuccessAt: new Date(now - 60_000).toISOString(),
    });
    expect(r.level).toBe("healthy");
    expect(r.lastMtmSweepAt).not.toBeNull();
  });

  it("is stale when the MTM sweep is older than the window", () => {
    const r = deriveFoFreshness({
      now,
      mtmSweepLastSuccessAt: new Date(now - 60 * 60_000).toISOString(),
      staleMinutes: 20,
    });
    expect(r.level).toBe("stale");
  });

  it("falls back to last open-eval timestamp when sweep is missing", () => {
    const r = deriveFoFreshness({
      now,
      mtmSweepLastSuccessAt: null,
      lastOpenEvalAt: new Date(now - 30_000).toISOString(),
    });
    expect(r.level).toBe("healthy");
  });

  it("is unknown when no timestamp or no now (safe placeholder, never throws)", () => {
    expect(deriveFoFreshness({ now }).level).toBe("unknown");
    expect(
      deriveFoFreshness({ mtmSweepLastSuccessAt: new Date().toISOString() }).level,
    ).toBe("unknown");
    expect(deriveFoFreshness({ now, mtmSweepLastSuccessAt: "not-a-date" }).level).toBe("unknown");
  });
});

// ── deriveFoPnlPct ──────────────────────────────────────────────────────────────

describe("deriveFoPnlPct", () => {
  it("returns unrealisedPnl / capitalDeployed for an open trade", () => {
    const r: FoTradeRow = {
      status: "OPEN", unrealizedPnl: 1500, capitalDeployed: 30000,
    };
    expect(deriveFoPnlPct(r)).toBeCloseTo(0.05, 10);
  });

  it("uses realizedPnl for a closed trade", () => {
    const r: FoTradeRow = {
      status: "CLOSED", realizedPnl: -600, capitalDeployed: 12000,
    };
    expect(deriveFoPnlPct(r)).toBeCloseTo(-0.05, 10);
  });

  it("coerces numeric strings safely", () => {
    const r: FoTradeRow = {
      status: "OPEN", unrealizedPnl: "750", capitalDeployed: "15000",
    };
    expect(deriveFoPnlPct(r)).toBeCloseTo(0.05, 10);
  });

  it("returns null on zero / missing / non-finite capital (no divide-by-zero)", () => {
    expect(deriveFoPnlPct({ status: "OPEN", unrealizedPnl: 100, capitalDeployed: 0 })).toBeNull();
    expect(deriveFoPnlPct({ status: "OPEN", unrealizedPnl: 100 })).toBeNull();
    expect(deriveFoPnlPct({ status: "OPEN", unrealizedPnl: 100, capitalDeployed: -5 })).toBeNull();
    expect(deriveFoPnlPct({ status: "OPEN", unrealizedPnl: 100, capitalDeployed: "x" })).toBeNull();
  });

  it("returns null when P&L is missing/non-finite", () => {
    expect(deriveFoPnlPct({ status: "OPEN", capitalDeployed: 10000 })).toBeNull();
  });

  it("does not mutate the input row", () => {
    const r: FoTradeRow = { status: "OPEN", unrealizedPnl: 1500, capitalDeployed: 30000 };
    const snap = JSON.stringify(r);
    deriveFoPnlPct(r);
    expect(JSON.stringify(r)).toBe(snap);
  });
});
