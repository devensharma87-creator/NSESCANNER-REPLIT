import { describe, it, expect } from "vitest";
import {
  actionDisplayLabel,
  isActionable,
  summarize,
  deriveRowBadges,
  isStaleRow,
  isIntradayQuoteMissing,
  applyFilters,
  sortRows,
  groupRows,
  uniqueSectors,
  scoreBucket,
  rsStrengthBucket,
  DEFAULT_FILTERS,
  type SwingRow,
  type AnalysisPayload,
  type SwingFilters,
} from "./stocksToWatchView";

// ── fixtures ──────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-05-31T10:00:00.000Z");

function row(over: Partial<SwingRow> = {}): SwingRow {
  return {
    symbol: "TEST",
    scanDate: "2026-05-31",
    action: "WATCH",
    setup: "setup",
    qualityGrade: "B",
    potential: "",
    score: "60",
    technicalScore: "60",
    smcScore: "50",
    volumeScore: "50",
    momentumScore: "50",
    fundamentalScore: "50",
    riskScore: "50",
    contextScore: "50",
    rsScore: "60",
    closePrice: "100",
    entry: "101",
    stopLoss: "95",
    target1: "110",
    target2: "120",
    rrToT1: "1.5",
    buyZoneLower: "99",
    buyZoneUpper: "102",
    buyZoneBasis: "basis",
    triggerText: "trigger",
    triggerPrice: "102",
    stopBasis: "atr",
    targetBasis: "rr",
    rsi14: "55",
    adx14: "20",
    atr14: "2",
    atrPct: "2",
    volRatio: "1",
    avgValueLakhs: "500",
    pctFrom52wLow: "10",
    pctFrom52wHigh: "-5",
    weeklyTrend: "UP",
    candleSignal: "none",
    marketStructure: "HH-HL",
    rs20: "60",
    rs50: "55",
    rs120: "50",
    sector: "IT",
    industry: "Software",
    fundamentalStatus: "OK",
    reasons: [],
    warnings: [],
    intradayLast: "101.5",
    intradayChangePct: "0.5",
    triggerHit: false,
    intradayUpdatedAt: "2026-05-31T09:59:00.000Z", // 1 min ago → fresh
    ...over,
  };
}

function payload(rows: SwingRow[], over: Partial<AnalysisPayload> = {}): AnalysisPayload {
  return {
    asOf: "2026-05-31T10:00:00.000Z",
    scanDate: "2026-05-31",
    runMeta: {
      scannedCount: 500,
      errorCount: 3,
      durationMs: 60000,
      startedAt: "2026-05-31T09:00:00.000Z",
      finishedAt: "2026-05-31T09:01:00.000Z",
    },
    scheduler: { lastDeepScanDate: "2026-05-31", lastDeepScanError: null, deepScanInflight: false },
    rows,
    ...over,
  };
}

// ── 6 + 7. action display mapping + unknown fallback ────────────────────────

describe("actionDisplayLabel", () => {
  it("maps known backend actions to clean display labels", () => {
    expect(actionDisplayLabel("BUY ZONE")).toBe("BUY ZONE");
    expect(actionDisplayLabel("BREAKOUT")).toBe("BUY BREAKOUT");
    expect(actionDisplayLabel("PULLBACK")).toBe("RETEST ONLY");
    expect(actionDisplayLabel("RECLAIM")).toBe("RETEST ONLY");
    expect(actionDisplayLabel("CONFIRMATION")).toBe("WAIT");
    expect(actionDisplayLabel("WATCH")).toBe("WATCHLIST");
    expect(actionDisplayLabel("AVOID")).toBe("AVOID");
  });
  it("never invents NO TRADE", () => {
    const labels = ["BUY ZONE", "BREAKOUT", "PULLBACK", "CONFIRMATION", "WATCH", "AVOID"].map(
      actionDisplayLabel,
    );
    expect(labels).not.toContain("NO TRADE");
  });
  it("falls back to raw string for unknown, and dash for empty", () => {
    expect(actionDisplayLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(actionDisplayLabel("")).toBe("—");
    expect(actionDisplayLabel(null)).toBe("—");
  });
});

describe("isActionable", () => {
  it("treats buy-side setups as actionable", () => {
    expect(isActionable("BUY ZONE")).toBe(true);
    expect(isActionable("BREAKOUT")).toBe(true);
    expect(isActionable("PULLBACK")).toBe(true);
    expect(isActionable("RECLAIM")).toBe(true);
    expect(isActionable("WATCH")).toBe(false);
    expect(isActionable("AVOID")).toBe(false);
    expect(isActionable("CONFIRMATION")).toBe(false);
  });
});

// ── 1–5. summary aggregation ────────────────────────────────────────────────

describe("summarize", () => {
  it("aggregates scanned / actionable / trigger / top-sector / avg-RS", () => {
    const rows = [
      row({ symbol: "A", action: "BUY ZONE", sector: "IT", rsScore: "80", triggerHit: true }),
      row({ symbol: "B", action: "BREAKOUT", sector: "IT", rsScore: "60", triggerHit: false }),
      row({ symbol: "C", action: "WATCH", sector: "BANK", rsScore: "40", triggerHit: true }),
    ];
    const s = summarize(payload(rows), NOW);
    expect(s.totalScanned).toBe(500);
    expect(s.errorCount).toBe(3);
    expect(s.rowCount).toBe(3);
    expect(s.actionableCount).toBe(2); // A + B
    expect(s.triggerHits).toBe(2); // A + C
    expect(s.topSector).toEqual({ sector: "IT", count: 2 });
    expect(s.avgRs).toBeCloseTo((80 + 60 + 40) / 3, 5);
  });

  it("breaks top-sector ties by higher average score", () => {
    const rows = [
      row({ symbol: "A", sector: "IT", score: "55" }),
      row({ symbol: "B", sector: "BANK", score: "90" }),
    ];
    const s = summarize(payload(rows), NOW);
    expect(s.topSector).toEqual({ sector: "BANK", count: 1 });
  });

  it("handles empty payload and null runMeta safely", () => {
    const s = summarize(payload([], { runMeta: null }), NOW);
    expect(s.totalScanned).toBeNull();
    expect(s.rowCount).toBe(0);
    expect(s.actionableCount).toBe(0);
    expect(s.triggerHits).toBe(0);
    expect(s.topSector).toBeNull();
    expect(s.avgRs).toBeNull();
    expect(s.freshness.label).toBeTruthy();
  });

  it("computes a public-safe freshness object", () => {
    const s = summarize(payload([row()]), NOW);
    expect(s.freshness.severity).toBe("ok");
    expect(s.freshness.scanDate).toBe("2026-05-31");
  });
});

// ── 8–10. risk badges ───────────────────────────────────────────────────────

describe("deriveRowBadges", () => {
  it("renders backend warnings first", () => {
    const b = deriveRowBadges(row({ warnings: ["near resistance", "weak RS"] }), NOW);
    expect(b.slice(0, 2).map(x => x.label)).toEqual(["near resistance", "weak RS"]);
    expect(b[0]!.kind).toBe("warning");
  });
  it("adds 'trigger hit' / 'trigger pending' derived badge", () => {
    expect(deriveRowBadges(row({ triggerHit: true }), NOW).some(b => b.label === "trigger hit")).toBe(true);
    expect(deriveRowBadges(row({ triggerHit: false }), NOW).some(b => b.label === "trigger pending")).toBe(true);
    expect(deriveRowBadges(row({ triggerHit: null }), NOW).some(b => b.label.startsWith("trigger"))).toBe(false);
  });
  it("adds 'stale data' when intraday quote is old", () => {
    const stale = row({ intradayUpdatedAt: "2026-05-31T08:00:00.000Z" }); // 2h ago
    expect(isStaleRow(stale, NOW)).toBe(true);
    expect(deriveRowBadges(stale, NOW).some(b => b.label === "stale data")).toBe(true);
  });
  it("adds 'no intraday quote' when last price is missing, and not 'stale data'", () => {
    const noq = row({ intradayLast: null, intradayUpdatedAt: null });
    expect(isIntradayQuoteMissing(noq)).toBe(true);
    const b = deriveRowBadges(noq, NOW);
    expect(b.some(x => x.label === "no intraday quote")).toBe(true);
    expect(b.some(x => x.label === "stale data")).toBe(false);
  });
});

// ── 11–12. filter predicates + combined filters ─────────────────────────────

describe("applyFilters", () => {
  const rows = [
    row({ symbol: "A", action: "BUY ZONE", sector: "IT", score: "80", rsScore: "85", triggerHit: true }),
    row({ symbol: "B", action: "WATCH", sector: "BANK", score: "55", rsScore: "50", triggerHit: false }),
    row({ symbol: "C", action: "BREAKOUT", sector: "IT", score: "70", rsScore: "65", triggerHit: false }),
  ];

  it("filters by action key", () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, action: "BUY_ZONE" }, NOW);
    expect(out.map(r => r.symbol)).toEqual(["A"]);
  });
  it("filters by sector", () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, sector: "IT" }, NOW);
    expect(out.map(r => r.symbol)).toEqual(["A", "C"]);
  });
  it("filters by score range", () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, scoreMin: 60, scoreMax: 75 }, NOW);
    expect(out.map(r => r.symbol)).toEqual(["C"]);
  });
  it("filters by RS range", () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, rsMin: 60 }, NOW);
    expect(out.map(r => r.symbol)).toEqual(["A", "C"]);
  });
  it("filters by trigger hit and actionable only", () => {
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, triggerHitOnly: true }, NOW).map(r => r.symbol)).toEqual(["A"]);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, actionableOnly: true }, NOW).map(r => r.symbol)).toEqual(["A", "C"]);
  });
  it("filters by intraday freshness", () => {
    const mixed = [
      row({ symbol: "FRESH", intradayUpdatedAt: "2026-05-31T09:59:00.000Z" }),
      row({ symbol: "OLD", intradayUpdatedAt: "2026-05-31T07:00:00.000Z" }),
      row({ symbol: "NOQ", intradayLast: null, intradayUpdatedAt: null }),
    ];
    const out = applyFilters(mixed, { ...DEFAULT_FILTERS, freshOnly: true }, NOW);
    expect(out.map(r => r.symbol)).toEqual(["FRESH"]);
  });
  it("applies combined filters together", () => {
    const f: SwingFilters = {
      ...DEFAULT_FILTERS,
      sector: "IT",
      actionableOnly: true,
      scoreMin: 75,
    };
    expect(applyFilters(rows, f, NOW).map(r => r.symbol)).toEqual(["A"]);
  });
});

// ── 13. sorting comparators ─────────────────────────────────────────────────

describe("sortRows", () => {
  const rows = [
    row({ symbol: "B", score: "70", rsScore: "60" }),
    row({ symbol: "A", score: "90", rsScore: null }),
    row({ symbol: "C", score: "50", rsScore: "80" }),
  ];
  it("sorts numeric desc with NaN last", () => {
    expect(sortRows(rows, "score", "desc").map(r => r.symbol)).toEqual(["A", "B", "C"]);
  });
  it("sorts numeric asc", () => {
    expect(sortRows(rows, "score", "asc").map(r => r.symbol)).toEqual(["C", "B", "A"]);
  });
  it("treats null/NaN as lowest", () => {
    expect(sortRows(rows, "rsScore", "desc").map(r => r.symbol)).toEqual(["C", "B", "A"]);
  });
  it("sorts symbol alphabetically", () => {
    expect(sortRows(rows, "symbol", "asc").map(r => r.symbol)).toEqual(["A", "B", "C"]);
  });
  it("does not mutate the input array", () => {
    const before = rows.map(r => r.symbol);
    sortRows(rows, "score", "asc");
    expect(rows.map(r => r.symbol)).toEqual(before);
  });
});

// ── 14. grouping helpers ────────────────────────────────────────────────────

describe("grouping", () => {
  it("scoreBucket / rsStrengthBucket classify correctly", () => {
    expect(scoreBucket(80)).toBe("75+");
    expect(scoreBucket(65)).toBe("60–74");
    expect(scoreBucket(55)).toBe("50–59");
    expect(scoreBucket(40)).toBe("<50");
    expect(scoreBucket(NaN)).toBe("No score");
    expect(rsStrengthBucket(85)).toBe("Strong (80+)");
    expect(rsStrengthBucket(70)).toBe("Firm (60–79)");
    expect(rsStrengthBucket(40)).toBe("Weak (<60)");
    expect(rsStrengthBucket(NaN)).toBe("No RS");
  });
  it("groups by sector and partitions every row exactly once", () => {
    const rows = [
      row({ symbol: "A", sector: "IT" }),
      row({ symbol: "B", sector: "IT" }),
      row({ symbol: "C", sector: "BANK" }),
    ];
    const g = groupRows(rows, "sector");
    expect(g[0]!.key).toBe("IT"); // larger group first
    expect(g.reduce((n, x) => n + x.rows.length, 0)).toBe(3);
  });
  it("returns a single All group when grouping is none", () => {
    const g = groupRows([row()], "none");
    expect(g).toHaveLength(1);
    expect(g[0]!.key).toBe("All");
  });
  it("groups by trigger status", () => {
    const rows = [
      row({ symbol: "A", triggerHit: true }),
      row({ symbol: "B", triggerHit: false }),
      row({ symbol: "C", triggerHit: null }),
    ];
    const keys = groupRows(rows, "trigger").map(x => x.key).sort();
    expect(keys).toEqual(["No trigger data", "Trigger hit", "Trigger pending"]);
  });
});

describe("uniqueSectors", () => {
  it("returns sorted unique non-empty sectors", () => {
    const rows = [row({ sector: "IT" }), row({ sector: "BANK" }), row({ sector: "IT" }), row({ sector: null })];
    expect(uniqueSectors(rows)).toEqual(["BANK", "IT"]);
  });
});

// ── 15. public helper output excludes owner-only fields ─────────────────────

describe("public-safety boundary", () => {
  it("summary.freshness exposes only the four leak-safe fields", () => {
    const s = summarize(payload([row()]), NOW);
    expect(Object.keys(s.freshness).sort()).toEqual(
      ["label", "lastIntradayRefreshAt", "scanDate", "severity"].sort(),
    );
  });
  it("summary contains no owner-only diagnostic keys", () => {
    const s = summarize(payload([row()]), NOW);
    const keys = Object.keys(s);
    for (const banned of ["shadow", "b1", "b3", "p25", "evidence", "ownerGate", "h10", "h11", "fno"]) {
      expect(keys.some(k => k.toLowerCase().includes(banned))).toBe(false);
    }
  });
});
