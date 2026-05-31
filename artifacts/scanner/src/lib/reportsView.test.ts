import { describe, it, expect } from "vitest";
import {
  toNum,
  toNumOr,
  parseTs,
  safePct,
  sumNums,
  avgNums,
  clampNumber,
  dateKeyOf,
  normalizeFoTradeRow,
  normalizeEqTradeRow,
  summarizeReportsOverview,
  filterReportRowsByDate,
  DEFAULT_REPORT_FILTERS,
  applyReportFilters,
  countActiveReportFilters,
  sortReportRows,
  groupReportRows,
  aggregateReportGroup,
  deriveMfeMaeReview,
  shapeEquityCurve,
  deriveDrawdownSummary,
  serializeReportRowsToCsv,
  deriveReportsEmptyState,
  type NormalizedReportRow,
  type ReportFilters,
  type ShadowExitReportLike,
  type FoAnalyticsLike,
} from "./reportsView";

// ---------------------------------------------------------------------------
// helpers for building rows / deep-freeze to assert no mutation
// ---------------------------------------------------------------------------

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    Object.values(obj as Record<string, unknown>).forEach((v) => deepFreeze(v));
    Object.freeze(obj);
  }
  return obj;
}

function row(partial: Partial<NormalizedReportRow> & { id: string }): NormalizedReportRow {
  return { ...partial };
}

// ---------------------------------------------------------------------------
// 1. Safe primitives
// ---------------------------------------------------------------------------

describe("safe primitives", () => {
  it("toNum parses numbers, numeric strings, and rejects malformed", () => {
    expect(toNum(42)).toBe(42);
    expect(toNum("42")).toBe(42);
    expect(toNum("  3.14 ")).toBeCloseTo(3.14);
    expect(toNum("-7")).toBe(-7);
    expect(toNum(null)).toBeNull();
    expect(toNum(undefined)).toBeNull();
    expect(toNum("")).toBeNull();
    expect(toNum("   ")).toBeNull();
    expect(toNum("abc")).toBeNull();
    expect(toNum(NaN)).toBeNull();
    expect(toNum(Infinity)).toBeNull();
    expect(toNum({})).toBeNull();
    expect(toNum([])).toBeNull();
  });

  it("toNumOr falls back when missing/malformed", () => {
    expect(toNumOr("5", 0)).toBe(5);
    expect(toNumOr(null, -1)).toBe(-1);
    expect(toNumOr("nope", 99)).toBe(99);
  });

  it("parseTs parses ISO strings, epoch numbers and Dates", () => {
    expect(parseTs("2026-05-31")).toBe(Date.parse("2026-05-31"));
    expect(parseTs("2026-05-31T10:00:00Z")).toBe(Date.parse("2026-05-31T10:00:00Z"));
    expect(parseTs(1000)).toBe(1000);
    expect(parseTs(new Date(1234))).toBe(1234);
    expect(parseTs(null)).toBeNull();
    expect(parseTs("")).toBeNull();
    expect(parseTs("garbage")).toBeNull();
  });

  it("safePct guards divide-by-zero and malformed", () => {
    expect(safePct(50, 200)).toBe(25);
    expect(safePct(1, 4)).toBe(25);
    expect(safePct(5, 0)).toBeNull();
    expect(safePct(null, 10)).toBeNull();
    expect(safePct(5, null)).toBeNull();
    expect(safePct("x", 10)).toBeNull();
  });

  it("sumNums ignores bad values and never mutates input", () => {
    const input = deepFreeze([1, "2", null, "x", 3, undefined, NaN]);
    expect(sumNums(input)).toBe(6);
    expect(sumNums([])).toBe(0);
  });

  it("avgNums ignores bad values and returns null when none valid", () => {
    expect(avgNums([2, "4", null, "x"])).toBe(3);
    expect(avgNums([])).toBeNull();
    expect(avgNums([null, "x", undefined])).toBeNull();
  });

  it("clampNumber clamps and returns null for missing", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-3, 0, 10)).toBe(0);
    expect(clampNumber(99, 0, 10)).toBe(10);
    expect(clampNumber(5)).toBe(5);
    expect(clampNumber(5, 8)).toBe(8);
    expect(clampNumber(null, 0, 10)).toBeNull();
    expect(clampNumber("bad", 0, 10)).toBeNull();
  });

  it("dateKeyOf extracts YYYY-MM-DD without timezone drift on date strings", () => {
    expect(dateKeyOf("2026-05-31")).toBe("2026-05-31");
    expect(dateKeyOf("2026-05-31T23:59:00Z")).toBe("2026-05-31");
    expect(dateKeyOf("nonsense")).toBeNull();
    expect(dateKeyOf(null)).toBeNull();
  });

  it("dateKeyOf normalises offset timestamps to the UTC day", () => {
    // +/- offsets that cross the day boundary must shift the UTC day.
    expect(dateKeyOf("2026-05-31T23:30:00-02:00")).toBe("2026-06-01");
    expect(dateKeyOf("2026-06-01T00:30:00+02:00")).toBe("2026-05-31");
  });

  it("dateKeyOf rejects malformed calendar dates", () => {
    expect(dateKeyOf("2026-99-99")).toBeNull();
    expect(dateKeyOf("2026-02-30")).toBeNull();
    expect(dateKeyOf("2026-00-10")).toBeNull();
    expect(dateKeyOf("2026-13-01")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizers
// ---------------------------------------------------------------------------

describe("normalizers", () => {
  it("normalizeFoTradeRow maps indexSymbol → index and keeps duration", () => {
    const r = normalizeFoTradeRow({
      id: "f1",
      indexSymbol: "NIFTY",
      indexName: "Nifty 50",
      setupKey: "VWAP_RECLAIM",
      realizedPnl: "1200.5",
      durationSec: "3600",
      exitReason: "TARGET1_HIT",
      signalDate: "2026-05-20",
    });
    expect(r.segment).toBe("FNO");
    expect(r.index).toBe("NIFTY");
    expect(r.realizedPnl).toBe(1200.5);
    expect(r.durationSec).toBe(3600);
    expect(r.daysHeld).toBeUndefined();
  });

  it("normalizeEqTradeRow maps symbol → index, never fabricates an index when symbol missing", () => {
    const r = normalizeEqTradeRow({
      id: "e1",
      symbol: "TCS",
      name: "Tata Consultancy",
      realizedPnl: -300,
      daysHeld: 4,
      exitReason: "STOPPED",
    });
    expect(r.segment).toBe("EQUITY");
    expect(r.index).toBe("TCS");
    expect(r.daysHeld).toBe(4);

    const noSym = normalizeEqTradeRow({ id: "e2", realizedPnl: 10 });
    expect(noSym.index).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Summary
// ---------------------------------------------------------------------------

describe("summarizeReportsOverview", () => {
  const foAnalytics: FoAnalyticsLike = {
    totalTrades: 10,
    scratches: 1,
    winRate: 0.6,
    totalRealizedPnl: 5000,
    profitFactor: 1.8,
    expectancy: 500,
    avgRMultiple: 0.9,
    largestWin: 2000,
    largestLoss: -800,
    maxDrawdown: -1500,
    currentDrawdown: -200,
    peakEquity: 6000,
  };

  it("combines F&O analytics + equity report totals", () => {
    const s = summarizeReportsOverview({
      foAnalytics,
      eqReport: { totals: { realizedPnl: 1500 } },
    });
    expect(s.foRealizedPnl).toBe(5000);
    expect(s.eqRealizedPnl).toBe(1500);
    expect(s.totalRealizedPnl).toBe(6500);
    expect(s.foWinRatePct).toBeCloseTo(60);
    expect(s.foProfitFactor).toBe(1.8);
    expect(s.foMaxDrawdown).toBe(-1500);
    expect(s.foTradeCount).toBe(10);
    expect(s.availability.foAnalytics).toBe(true);
    expect(s.availability.eqReport).toBe(true);
    expect(s.availability.shadowExits).toBe(false);
  });

  it("derives equity comparison fields (count + win rate) from report totals", () => {
    const s = summarizeReportsOverview({
      foAnalytics,
      eqReport: {
        totals: { realizedPnl: 1500, tradeCount: 4, winRatePct: 75 },
      },
    });
    expect(s.eqTradeCount).toBe(4);
    expect(s.eqWinRatePct).toBe(75);
    // F&O comparison fields stay sourced from F&O inputs.
    expect(s.foTradeCount).toBe(10);
    expect(s.foWinRatePct).toBeCloseTo(60);
  });

  it("leaves equity comparison fields null when equity payloads absent", () => {
    const s = summarizeReportsOverview({ foAnalytics });
    expect(s.eqTradeCount).toBeNull();
    expect(s.eqWinRatePct).toBeNull();
  });

  it("does not fabricate a combined total when one segment is missing", () => {
    // F&O present, equity entirely absent -> total cannot imply equity = 0.
    const foOnly = summarizeReportsOverview({ foAnalytics });
    expect(foOnly.foRealizedPnl).toBe(5000);
    expect(foOnly.eqRealizedPnl).toBeNull();
    expect(foOnly.totalRealizedPnl).toBeNull();

    // Equity present, F&O entirely absent -> still null.
    const eqOnly = summarizeReportsOverview({
      eqReport: { totals: { realizedPnl: 1500 } },
    });
    expect(eqOnly.eqRealizedPnl).toBe(1500);
    expect(eqOnly.foRealizedPnl).toBeNull();
    expect(eqOnly.totalRealizedPnl).toBeNull();
  });

  it("sums the total when a segment loaded with zero activity", () => {
    const s = summarizeReportsOverview({
      foAnalytics,
      eqReport: { totals: { realizedPnl: 0 } },
    });
    expect(s.totalRealizedPnl).toBe(5000);
  });

  it("handles entirely missing payloads without fabrication", () => {
    const s = summarizeReportsOverview({});
    expect(s.foRealizedPnl).toBeNull();
    expect(s.eqRealizedPnl).toBeNull();
    expect(s.totalRealizedPnl).toBeNull();
    expect(s.foWinRatePct).toBeNull();
    expect(s.avgMfe).toBeNull();
    expect(s.avgMae).toBeNull();
    expect(s.availability.foAnalytics).toBe(false);
    expect(s.availability.shadowExits).toBe(false);
  });

  it("pulls MFE only from shadow-exits, MAE is always null", () => {
    const shadowExits: ShadowExitReportLike = {
      enabled: true,
      mfeAvailableCount: 3,
      rawRowCount: 5,
      processedRowCount: 5,
      lowSampleWarning: true,
      lowSampleThreshold: 20,
      improvedTopN: [
        { id: "a", mfeAbs: 1000, mfeAvailable: true, actualPnl: 200 },
        { id: "b", mfeAbs: 2000, mfeAvailable: true, actualPnl: 500 },
      ],
      reducedTopN: [],
    };
    const s = summarizeReportsOverview({ foAnalytics, shadowExits });
    expect(s.avgMfe).toBe(1500);
    expect(s.avgMae).toBeNull();
    expect(s.availability.shadowExits).toBe(true);
  });

  it("does not mutate its input", () => {
    const input = deepFreeze({ foAnalytics: { ...foAnalytics } });
    expect(() => summarizeReportsOverview(input)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3 & 4. Date narrowing + filters
// ---------------------------------------------------------------------------

describe("filterReportRowsByDate", () => {
  const rows = deepFreeze([
    row({ id: "1", signalDate: "2026-05-01" }),
    row({ id: "2", signalDate: "2026-05-15" }),
    row({ id: "3", signalDate: "2026-05-31" }),
    row({ id: "4", signalDate: null }),
    row({ id: "5", signalDate: "garbage" }),
  ]);

  it("returns a copy of all rows when no range set", () => {
    const out = filterReportRowsByDate(rows, {});
    expect(out).toHaveLength(5);
    expect(out).not.toBe(rows);
  });

  it("inclusive range drops invalid/missing dates", () => {
    const out = filterReportRowsByDate(rows, { from: "2026-05-01", to: "2026-05-15" });
    expect(out.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("from-only and to-only bounds are inclusive", () => {
    expect(filterReportRowsByDate(rows, { from: "2026-05-31" }).map((r) => r.id)).toEqual(["3"]);
    expect(filterReportRowsByDate(rows, { to: "2026-05-01" }).map((r) => r.id)).toEqual(["1"]);
  });

  it("does not mutate input", () => {
    filterReportRowsByDate(rows, { from: "2026-05-10" });
    expect(rows).toHaveLength(5);
  });
});

describe("applyReportFilters / countActiveReportFilters", () => {
  const rows = deepFreeze<NormalizedReportRow[]>([
    row({ id: "1", segment: "FNO", setupKey: "VWAP_RECLAIM", index: "NIFTY", exitReason: "TARGET1_HIT", realizedPnl: 500, tags: ["good"], journal: "clean entry", signalDate: "2026-05-01" }),
    row({ id: "2", segment: "FNO", setupKey: "EMA_PULLBACK", index: "BANKNIFTY", exitReason: "STOPPED", realizedPnl: -300, tags: ["mistake"], journal: null, signalDate: "2026-05-10" }),
    row({ id: "3", segment: "EQUITY", setupKey: "SWING", exitReason: "TARGET2_HIT", realizedPnl: 0, signalDate: "2026-05-20" }),
    row({ id: "4", segment: "EQUITY", setupKey: "SWING", exitReason: "STOPPED", realizedPnl: -100, tags: ["mistake"], signalDate: "2026-05-25" }),
  ]);

  it("default filters keep everything and count zero", () => {
    expect(applyReportFilters(rows, DEFAULT_REPORT_FILTERS)).toHaveLength(4);
    expect(countActiveReportFilters(DEFAULT_REPORT_FILTERS)).toBe(0);
  });

  it("segment filter", () => {
    const f: ReportFilters = { ...DEFAULT_REPORT_FILTERS, segment: "EQUITY" };
    expect(applyReportFilters(rows, f).map((r) => r.id)).toEqual(["3", "4"]);
    expect(countActiveReportFilters(f)).toBe(1);
  });

  it("setup filter", () => {
    const f: ReportFilters = { ...DEFAULT_REPORT_FILTERS, setup: "SWING" };
    expect(applyReportFilters(rows, f).map((r) => r.id)).toEqual(["3", "4"]);
  });

  it("exit-reason filter", () => {
    const f: ReportFilters = { ...DEFAULT_REPORT_FILTERS, exitReason: "STOPPED" };
    expect(applyReportFilters(rows, f).map((r) => r.id)).toEqual(["2", "4"]);
  });

  it("tag filter uses existing tags only, excludes rows without tags", () => {
    const f: ReportFilters = { ...DEFAULT_REPORT_FILTERS, tag: "mistake" };
    expect(applyReportFilters(rows, f).map((r) => r.id)).toEqual(["2", "4"]);
  });

  it("P&L sign filter (positive / negative / flat)", () => {
    expect(applyReportFilters(rows, { ...DEFAULT_REPORT_FILTERS, pnlSign: "POSITIVE" }).map((r) => r.id)).toEqual(["1"]);
    expect(applyReportFilters(rows, { ...DEFAULT_REPORT_FILTERS, pnlSign: "NEGATIVE" }).map((r) => r.id)).toEqual(["2", "4"]);
    expect(applyReportFilters(rows, { ...DEFAULT_REPORT_FILTERS, pnlSign: "FLAT" }).map((r) => r.id)).toEqual(["3"]);
  });

  it("journal present / missing filter", () => {
    expect(applyReportFilters(rows, { ...DEFAULT_REPORT_FILTERS, journal: "PRESENT" }).map((r) => r.id)).toEqual(["1"]);
    expect(applyReportFilters(rows, { ...DEFAULT_REPORT_FILTERS, journal: "MISSING" }).map((r) => r.id)).toEqual(["2", "3", "4"]);
  });

  it("index filter excludes rows missing the index field (no fabrication)", () => {
    const f: ReportFilters = { ...DEFAULT_REPORT_FILTERS, index: "NIFTY" };
    expect(applyReportFilters(rows, f).map((r) => r.id)).toEqual(["1"]);
  });

  it("combined filters and active count", () => {
    const f: ReportFilters = {
      ...DEFAULT_REPORT_FILTERS,
      segment: "FNO",
      pnlSign: "NEGATIVE",
      from: "2026-05-05",
      to: "2026-05-15",
    };
    expect(applyReportFilters(rows, f).map((r) => r.id)).toEqual(["2"]);
    expect(countActiveReportFilters(f)).toBe(3); // segment + pnlSign + date range (single unit)
  });

  it("does not mutate input rows array", () => {
    applyReportFilters(rows, { ...DEFAULT_REPORT_FILTERS, segment: "FNO" });
    expect(rows).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// 5. Sorting
// ---------------------------------------------------------------------------

describe("sortReportRows", () => {
  const rows = deepFreeze<NormalizedReportRow[]>([
    row({ id: "1", signalDate: "2026-05-10", realizedPnl: 100, rMultiple: 1.5, setupKey: "B", exitReason: "STOPPED", index: "NIFTY", durationSec: 600, mfe: 50, mae: -10 }),
    row({ id: "2", signalDate: "2026-05-20", realizedPnl: -50, rMultiple: -0.5, setupKey: "A", exitReason: "TARGET1_HIT", index: "BANKNIFTY", durationSec: 1200, mfe: 200, mae: -80 }),
    row({ id: "3", signalDate: "2026-05-01", realizedPnl: null, rMultiple: null, setupKey: null, exitReason: null, index: null, durationSec: null, mfe: null, mae: null }),
  ]);

  it("sorts by date", () => {
    expect(sortReportRows(rows, "date", "asc").map((r) => r.id)).toEqual(["3", "1", "2"]);
    expect(sortReportRows(rows, "date", "desc").map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("sorts by P&L with nulls last", () => {
    expect(sortReportRows(rows, "pnl", "desc").map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(sortReportRows(rows, "pnl", "asc").map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("sorts by R multiple", () => {
    expect(sortReportRows(rows, "rMultiple", "desc").map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("sorts by setup (string) with empty last", () => {
    expect(sortReportRows(rows, "setup", "asc").map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("sorts by exit reason", () => {
    expect(sortReportRows(rows, "exitReason", "asc").map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("sorts by MFE and MAE with nulls last", () => {
    expect(sortReportRows(rows, "mfe", "desc").map((r) => r.id)).toEqual(["2", "1", "3"]);
    expect(sortReportRows(rows, "mae", "asc").map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("nulls always sort last regardless of direction", () => {
    expect(sortReportRows(rows, "pnl", "asc")[2]!.id).toBe("3");
    expect(sortReportRows(rows, "pnl", "desc")[2]!.id).toBe("3");
  });

  it("does not mutate input", () => {
    const before = rows.map((r) => r.id);
    sortReportRows(rows, "pnl", "asc");
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 6. Grouping / aggregation
// ---------------------------------------------------------------------------

describe("groupReportRows / aggregateReportGroup", () => {
  const rows = deepFreeze<NormalizedReportRow[]>([
    row({ id: "1", segment: "FNO", setupKey: "A", index: "NIFTY", exitReason: "STOPPED", realizedPnl: 100, tags: ["x"], signalDate: "2026-04-10" }),
    row({ id: "2", segment: "FNO", setupKey: "A", index: "NIFTY", exitReason: "TARGET1_HIT", realizedPnl: -40, tags: ["x", "y"], signalDate: "2026-05-10" }),
    row({ id: "3", segment: "EQUITY", setupKey: "SWING", exitReason: "STOPPED", realizedPnl: 60, signalDate: "2026-05-12" }),
  ]);

  it("groups by setup preserving first-seen order", () => {
    const g = groupReportRows(rows, "setup");
    expect(g.map((x) => x.key)).toEqual(["A", "SWING"]);
    expect(g[0]!.rows.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("groups by exit reason", () => {
    const g = groupReportRows(rows, "exitReason");
    expect(g.map((x) => x.key).sort()).toEqual(["STOPPED", "TARGET1_HIT"]);
  });

  it("groups by tag (multi-membership) and skips untagged rows", () => {
    const g = groupReportRows(rows, "tag");
    const byKey = Object.fromEntries(g.map((x) => [x.key, x.rows.map((r) => r.id)]));
    expect(byKey["x"]).toEqual(["1", "2"]);
    expect(byKey["y"]).toEqual(["2"]);
  });

  it("groups by P&L sign", () => {
    const g = groupReportRows(rows, "pnlSign");
    const byKey = Object.fromEntries(g.map((x) => [x.key, x.rows.map((r) => r.id)]));
    expect(byKey["POSITIVE"]).toEqual(["1", "3"]);
    expect(byKey["NEGATIVE"]).toEqual(["2"]);
  });

  it("groups by month", () => {
    const g = groupReportRows(rows, "month");
    const byKey = Object.fromEntries(g.map((x) => [x.key, x.rows.map((r) => r.id)]));
    expect(byKey["2026-04"]).toEqual(["1"]);
    expect(byKey["2026-05"]).toEqual(["2", "3"]);
  });

  it("groups by segment", () => {
    const g = groupReportRows(rows, "segment");
    expect(g.map((x) => x.key)).toEqual(["FNO", "EQUITY"]);
  });

  it("does NOT fabricate index groups when index field is absent", () => {
    const eqOnly = deepFreeze<NormalizedReportRow[]>([
      row({ id: "a", segment: "EQUITY", realizedPnl: 1 }),
      row({ id: "b", segment: "EQUITY", realizedPnl: 2 }),
    ]);
    expect(groupReportRows(eqOnly, "index")).toEqual([]);
  });

  it("aggregateReportGroup computes win rate and avg P&L", () => {
    const agg = aggregateReportGroup(rows);
    expect(agg.tradeCount).toBe(3);
    expect(agg.realizedPnl).toBe(120);
    expect(agg.wins).toBe(2);
    expect(agg.losses).toBe(1);
    expect(agg.winRatePct).toBeCloseTo((2 / 3) * 100);
    expect(agg.avgPnl).toBe(40);
    expect(agg.bestTrade).toBe(100);
    expect(agg.worstTrade).toBe(-40);
  });

  it("aggregate MFE/MAE are null when rows lack those fields", () => {
    const agg = aggregateReportGroup(rows);
    expect(agg.avgMfe).toBeNull();
    expect(agg.avgMae).toBeNull();
  });

  it("aggregate win rate is null with no decided trades", () => {
    const flat = [row({ id: "z", realizedPnl: 0 })];
    expect(aggregateReportGroup(flat).winRatePct).toBeNull();
  });

  it("does not mutate input", () => {
    groupReportRows(rows, "setup");
    aggregateReportGroup(rows);
    expect(rows).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 7. MFE/MAE review
// ---------------------------------------------------------------------------

describe("deriveMfeMaeReview", () => {
  it("summarises from shadow-exits per-trade rows", () => {
    const report: ShadowExitReportLike = {
      enabled: true,
      mfeAvailableCount: 4,
      rawRowCount: 6,
      processedRowCount: 6,
      lowSampleWarning: true,
      lowSampleThreshold: 20,
      improvedTopN: [
        { id: "a", mfeAbs: 1000, mfeAvailable: true, actualPnl: 200 },
        { id: "b", mfeAbs: 3000, mfeAvailable: true, actualPnl: 1000 },
      ],
      reducedTopN: [
        { id: "c", mfeAbs: 500, mfeAvailable: false, actualPnl: -100 },
      ],
    };
    const r = deriveMfeMaeReview(report);
    expect(r.available).toBe(true);
    expect(r.eligibleSampleCount).toBe(4);
    expect(r.avgMfe).toBe(2000); // only mfeAvailable rows (1000, 3000)
    expect(r.avgMfeSampleCount).toBe(2);
    expect(r.avgMae).toBeNull();
    expect(r.lowSampleThreshold).toBe(20);
  });

  it("returns safe empty model when unavailable or disabled", () => {
    const empty = deriveMfeMaeReview(undefined);
    expect(empty.available).toBe(false);
    expect(empty.avgMfe).toBeNull();
    expect(empty.avgMae).toBeNull();
    expect(empty.giveBackCandidates).toEqual([]);

    const disabled = deriveMfeMaeReview({ enabled: false, improvedTopN: [{ id: "a", mfeAbs: 9, mfeAvailable: true }] });
    expect(disabled.available).toBe(false);
    expect(disabled.avgMfe).toBeNull();
  });

  it("give-back candidates only from per-trade rows with mfeAvailable and mfe>actual", () => {
    const report: ShadowExitReportLike = {
      enabled: true,
      improvedTopN: [
        { id: "a", mfeAbs: 1000, mfeAvailable: true, actualPnl: 200 }, // gave back
        { id: "b", mfeAbs: 100, mfeAvailable: true, actualPnl: 100 }, // captured fully
        { id: "c", mfeAbs: 5000, mfeAvailable: false, actualPnl: 0 }, // not eligible
      ],
      reducedTopN: [],
    };
    const r = deriveMfeMaeReview(report);
    expect(r.giveBackCandidates.map((t) => t.id)).toEqual(["a"]);
  });

  it("outputs summary only when per-trade rows are absent (no fabrication)", () => {
    const report: ShadowExitReportLike = {
      enabled: true,
      mfeAvailableCount: 7,
      rawRowCount: 12,
      processedRowCount: 12,
      lowSampleWarning: true,
      lowSampleThreshold: 20,
    };
    const r = deriveMfeMaeReview(report);
    expect(r.available).toBe(true);
    expect(r.eligibleSampleCount).toBe(7);
    expect(r.avgMfe).toBeNull();
    expect(r.avgMfeSampleCount).toBe(0);
    expect(r.giveBackCandidates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. Equity curve / drawdown
// ---------------------------------------------------------------------------

describe("shapeEquityCurve / deriveDrawdownSummary", () => {
  it("shapes a curve and sanitises malformed values", () => {
    const analytics: FoAnalyticsLike = {
      equityCurve: [
        { date: "2026-05-01", dailyPnl: 100, cumulativePnl: 100, drawdown: 0 },
        { date: "2026-05-02", dailyPnl: "x", cumulativePnl: 50, drawdown: -50 },
        { date: null, dailyPnl: 10, cumulativePnl: 10, drawdown: 0 }, // dropped
      ],
    };
    const shaped = shapeEquityCurve(analytics);
    expect(shaped).toHaveLength(2);
    expect(shaped[0]!.date).toBe("2026-05-01");
    expect(shaped[1]!.dailyPnl).toBeNull();
    expect(shaped[1]!.cumulativePnl).toBe(50);
  });

  it("drops points with malformed dates and normalises offset timestamps", () => {
    const analytics: FoAnalyticsLike = {
      equityCurve: [
        { date: "2026-05-01", dailyPnl: 1, cumulativePnl: 1, drawdown: 0 },
        { date: "2026-99-99", dailyPnl: 2, cumulativePnl: 3, drawdown: 0 }, // dropped
        { date: "2026-05-31T23:30:00-02:00", dailyPnl: 4, cumulativePnl: 7, drawdown: 0 },
      ],
    };
    const shaped = shapeEquityCurve(analytics);
    expect(shaped).toHaveLength(2);
    expect(shaped[0]!.date).toBe("2026-05-01");
    expect(shaped[1]!.date).toBe("2026-06-01");
  });

  it("returns empty array when curve missing", () => {
    expect(shapeEquityCurve(undefined)).toEqual([]);
    expect(shapeEquityCurve({})).toEqual([]);
  });

  it("derives drawdown summary with percent", () => {
    const d = deriveDrawdownSummary({ maxDrawdown: -1500, currentDrawdown: -200, peakEquity: 6000 });
    expect(d.maxDrawdown).toBe(-1500);
    expect(d.currentDrawdown).toBe(-200);
    expect(d.peakEquity).toBe(6000);
    expect(d.maxDrawdownPct).toBeCloseTo(25);
  });

  it("drawdown summary is safe when values missing/malformed", () => {
    const d = deriveDrawdownSummary({});
    expect(d.maxDrawdown).toBeNull();
    expect(d.peakEquity).toBeNull();
    expect(d.maxDrawdownPct).toBeNull();
    expect(deriveDrawdownSummary({ maxDrawdown: -100, peakEquity: 0 }).maxDrawdownPct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. CSV
// ---------------------------------------------------------------------------

describe("serializeReportRowsToCsv", () => {
  it("produces deterministic header + rows in column order", () => {
    const rows = [
      { id: "1", pnl: 100, setup: "A" },
      { id: "2", pnl: -50, setup: "B" },
    ];
    const csv = serializeReportRowsToCsv(rows, [
      { key: "id", header: "ID" },
      { key: "setup", header: "Setup" },
      { key: "pnl", header: "P&L" },
    ]);
    expect(csv).toBe("ID,Setup,P&L\r\n1,A,100\r\n2,B,-50");
  });

  it("accepts plain string columns and uses key as header", () => {
    const csv = serializeReportRowsToCsv([{ a: 1, b: 2 }], ["a", "b"]);
    expect(csv).toBe("a,b\r\n1,2");
  });

  it("escapes quotes, commas and newlines", () => {
    const rows = [
      { note: 'he said "hi"', tag: "a,b", multi: "line1\nline2" },
    ];
    const csv = serializeReportRowsToCsv(rows, ["note", "tag", "multi"]);
    expect(csv).toBe('note,tag,multi\r\n"he said ""hi""","a,b","line1\nline2"');
  });

  it("renders missing fields as empty cells and joins arrays", () => {
    const rows = [{ id: "1", tags: ["x", "y"] }];
    const csv = serializeReportRowsToCsv(rows, ["id", "missing", "tags"]);
    expect(csv).toBe("id,missing,tags\r\n1,,x; y");
  });

  it("does not mutate input rows", () => {
    const rows = deepFreeze([{ id: "1", pnl: 100 }]);
    expect(() => serializeReportRowsToCsv(rows, ["id", "pnl"])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 10. Empty state
// ---------------------------------------------------------------------------

describe("deriveReportsEmptyState", () => {
  it("loading wins over everything", () => {
    expect(deriveReportsEmptyState({ loading: true, error: new Error("x"), rows: [] }).kind).toBe("loading");
  });

  it("error when not loading", () => {
    expect(deriveReportsEmptyState({ error: new Error("boom"), rows: [] }).kind).toBe("error");
  });

  it("empty when no rows and no filters", () => {
    expect(deriveReportsEmptyState({ rows: [], filtersActive: 0 }).kind).toBe("empty");
    expect(deriveReportsEmptyState({ rows: null }).kind).toBe("empty");
  });

  it("no-match when no rows but filters are active", () => {
    expect(deriveReportsEmptyState({ rows: [], filtersActive: 2 }).kind).toBe("no-match");
    expect(deriveReportsEmptyState({ rows: [], filtersActive: true }).kind).toBe("no-match");
  });

  it("ready when rows present", () => {
    expect(deriveReportsEmptyState({ rows: [{ id: "1" }] }).kind).toBe("ready");
  });
});
