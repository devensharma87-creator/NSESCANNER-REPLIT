/**
 * F&O Replay Diagnostics — unit tests.
 *
 * Uses fixtures only. No DB. No live API calls.
 * Covers all Part K requirements: 10 test categories.
 */

import { describe, it, expect } from "vitest";
import {
  computeStats,
  computeDiagnostics,
  detectReentryClusters,
  timeOfDayBucket,
  expiryDistanceBucket,
  premiumBucket,
  costBucket,
  daysToExpiry,
  type DiagTrade,
  type DiagnosticsRunMeta,
} from "./diagnostics";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeTrade(overrides: Partial<DiagTrade> & { id: string }): DiagTrade {
  return {
    id: overrides.id,
    indexSymbol: overrides.indexSymbol ?? "NIFTY",
    setupKey: overrides.setupKey ?? "BREAKOUT_PULLBACK",
    setupName: overrides.setupName ?? "Breakout Pullback",
    direction: overrides.direction ?? "BULL",
    optionType: overrides.optionType ?? "CALL",
    strike: overrides.strike ?? 24000,
    entryAt: overrides.entryAt ?? "2026-06-01T04:00:00.000Z", // 09:30 IST
    exitAt: overrides.exitAt ?? "2026-06-01T06:00:00.000Z",   // 11:30 IST
    optionEntry: overrides.optionEntry ?? 150,
    optionExit: overrides.optionExit ?? 200,
    grossPnl: overrides.grossPnl ?? 1000,
    spreadCost: overrides.spreadCost ?? 100,
    explicitCosts: overrides.explicitCosts ?? 200,
    totalCosts: overrides.totalCosts ?? 300,
    netPnl: overrides.netPnl ?? 700,
    pricingMode: overrides.pricingMode ?? "REAL_CAPTURED_PREMIUM",
    exitReason: overrides.exitReason ?? "TARGET",
    tier: overrides.tier ?? "HC",
    entryPremiumSource: overrides.entryPremiumSource ?? "2026-06-01T04:00:00.000Z",
    exitPremiumSource: overrides.exitPremiumSource ?? "2026-06-01T06:00:00.000Z",
    expiryDate: overrides.expiryDate ?? "2026-06-05",
  };
}

const PRICED_WIN = makeTrade({ id: "t1", netPnl: 5000, grossPnl: 5500, totalCosts: 500 });
const PRICED_LOSS = makeTrade({ id: "t2", netPnl: -3000, grossPnl: -2600, totalCosts: 400 });
const UNAVAILABLE = makeTrade({
  id: "t3",
  pricingMode: "UNAVAILABLE",
  netPnl: null,
  grossPnl: null,
  totalCosts: null,
  spreadCost: null,
  entryPremiumSource: "unavailable",
  exitPremiumSource: "unavailable",
});

const META: DiagnosticsRunMeta = {
  runId: "test-run-id",
  backtestMode: "SNAPSHOT_PREMIUM_REPLAY",
  fromDate: "2026-05-18",
  toDate: "2026-06-29",
  instrument: "ALL",
};

// ---------------------------------------------------------------------------
// 1. Cost bucket classification
// ---------------------------------------------------------------------------
describe("costBucket", () => {
  it("classifies < ₹200", () => expect(costBucket(150)).toBe("<₹200"));
  it("classifies ₹200–₹500", () => expect(costBucket(350)).toBe("₹200–₹500"));
  it("classifies ₹500–₹1000", () => expect(costBucket(750)).toBe("₹500–₹1000"));
  it("classifies ₹1000–₹2000", () => expect(costBucket(1500)).toBe("₹1000–₹2000"));
  it("classifies > ₹2000", () => expect(costBucket(3000)).toBe(">₹2000"));
  it("returns Unknown for null", () => expect(costBucket(null)).toBe("Unknown"));
  it("returns Unknown for negative", () => expect(costBucket(-1)).toBe("Unknown"));
});

// ---------------------------------------------------------------------------
// 2. Expiry-distance classification
// ---------------------------------------------------------------------------
describe("expiryDistanceBucket", () => {
  it("classifies 0DTE", () => expect(expiryDistanceBucket(0)).toBe("0DTE"));
  it("classifies 1DTE", () => expect(expiryDistanceBucket(1)).toBe("1DTE"));
  it("classifies 2DTE", () => expect(expiryDistanceBucket(2)).toBe("2DTE"));
  it("classifies 3–5DTE", () => expect(expiryDistanceBucket(4)).toBe("3–5DTE"));
  it("classifies >5DTE", () => expect(expiryDistanceBucket(10)).toBe(">5DTE"));
  it("classifies null as Unknown", () => expect(expiryDistanceBucket(null)).toBe("Unknown"));
  it("classifies negative as Unknown", () => expect(expiryDistanceBucket(-1)).toBe("Unknown"));
});

describe("daysToExpiry", () => {
  it("computes 0DTE when entry date equals expiry", () => {
    expect(daysToExpiry("2026-06-05", "2026-06-05T04:30:00.000Z")).toBe(0);
  });
  it("computes 1DTE", () => {
    expect(daysToExpiry("2026-06-05", "2026-06-04T04:30:00.000Z")).toBe(1);
  });
  it("computes 7DTE", () => {
    expect(daysToExpiry("2026-06-12", "2026-06-05T04:30:00.000Z")).toBe(7);
  });
  it("returns null when expiryDate is null", () => {
    expect(daysToExpiry(null, "2026-06-01T04:00:00.000Z")).toBeNull();
  });
  it("returns null when entryAt is null", () => {
    expect(daysToExpiry("2026-06-05", null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Time-of-day bucket classification
// ---------------------------------------------------------------------------
describe("timeOfDayBucket", () => {
  // IST = UTC + 5:30. 09:15 IST = 03:45 UTC.
  it("classifies 09:15–09:30 IST", () => {
    expect(timeOfDayBucket("2026-06-01T03:50:00.000Z")).toBe("09:15–09:30"); // 09:20 IST
  });
  it("classifies 09:30–10:00 IST", () => {
    expect(timeOfDayBucket("2026-06-01T04:10:00.000Z")).toBe("09:30–10:00"); // 09:40 IST
  });
  it("classifies 10:00–11:00 IST", () => {
    expect(timeOfDayBucket("2026-06-01T05:00:00.000Z")).toBe("10:00–11:00"); // 10:30 IST
  });
  it("classifies 11:00–12:30 IST", () => {
    expect(timeOfDayBucket("2026-06-01T06:30:00.000Z")).toBe("11:00–12:30"); // 12:00 IST
  });
  it("classifies 12:30–14:00 IST", () => {
    expect(timeOfDayBucket("2026-06-01T08:00:00.000Z")).toBe("12:30–14:00"); // 13:30 IST
  });
  it("classifies 14:00–15:00 IST", () => {
    expect(timeOfDayBucket("2026-06-01T09:00:00.000Z")).toBe("14:00–15:00"); // 14:30 IST
  });
  it("classifies 15:00–15:20 IST", () => {
    expect(timeOfDayBucket("2026-06-01T09:40:00.000Z")).toBe("15:00–15:20"); // 15:10 IST
  });
  it("returns Unknown for null", () => {
    expect(timeOfDayBucket(null)).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// 4. Premium bucket classification
// ---------------------------------------------------------------------------
describe("premiumBucket", () => {
  it("classifies < ₹75", () => expect(premiumBucket(50)).toBe("<₹75"));
  it("classifies ₹75–₹125", () => expect(premiumBucket(100)).toBe("₹75–₹125"));
  it("classifies ₹125–₹200", () => expect(premiumBucket(150)).toBe("₹125–₹200"));
  it("classifies ₹200–₹400", () => expect(premiumBucket(300)).toBe("₹200–₹400"));
  it("classifies ₹400–₹800", () => expect(premiumBucket(500)).toBe("₹400–₹800"));
  it("classifies > ₹800", () => expect(premiumBucket(1000)).toBe(">₹800"));
  it("returns Unknown for null", () => expect(premiumBucket(null)).toBe("Unknown"));
  it("returns Unknown for zero", () => expect(premiumBucket(0)).toBe("Unknown"));
});

// ---------------------------------------------------------------------------
// 5. Setup-level aggregation (underlying + setup grouping)
// ---------------------------------------------------------------------------
describe("computeStats — setup-level aggregation", () => {
  it("aggregates priced trades correctly", () => {
    const trades = [PRICED_WIN, PRICED_LOSS];
    const stats = computeStats(trades);
    expect(stats.pricedTrades).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.grossPnl).toBeCloseTo(PRICED_WIN.grossPnl! + PRICED_LOSS.grossPnl!);
    expect(stats.netPnl).toBeCloseTo(5000 - 3000);
    expect(stats.winRate).toBeCloseTo(0.5);
    expect(stats.avgWin).toBeCloseTo(5000);
    expect(stats.avgLoss).toBeCloseTo(3000);
  });

  it("excludes UNAVAILABLE trades from P&L", () => {
    const stats = computeStats([PRICED_WIN, UNAVAILABLE]);
    expect(stats.pricedTrades).toBe(1);
    expect(stats.unavailableTrades).toBe(1);
    expect(stats.netPnl).toBeCloseTo(5000);
  });

  it("reports all UNAVAILABLE correctly when no priced trades", () => {
    const stats = computeStats([UNAVAILABLE]);
    expect(stats.pricedTrades).toBe(0);
    expect(stats.unavailableTrades).toBe(1);
    expect(stats.winRate).toBeNull();
    expect(stats.profitFactor).toBeNull();
    expect(stats.netPnl).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Underlying-level aggregation
// ---------------------------------------------------------------------------
describe("computeDiagnostics — byUnderlying", () => {
  const niftyTrade = makeTrade({ id: "n1", indexSymbol: "NIFTY", netPnl: -500, grossPnl: -100, totalCosts: 400 });
  const bnTrade = makeTrade({ id: "b1", indexSymbol: "BANKNIFTY", netPnl: 8000, grossPnl: 9000, totalCosts: 1000 });
  const sxTrade = makeTrade({ id: "s1", indexSymbol: "SENSEX", netPnl: -2000, grossPnl: -1500, totalCosts: 500 });

  it("produces one group per underlying", () => {
    const result = computeDiagnostics(META, [niftyTrade, bnTrade, sxTrade]);
    const keys = result.byUnderlying.map((g) => g.key).sort();
    expect(keys).toEqual(["BANKNIFTY", "NIFTY", "SENSEX"]);
  });

  it("computes correct net P&L per underlying", () => {
    const result = computeDiagnostics(META, [niftyTrade, bnTrade, sxTrade]);
    const bn = result.byUnderlying.find((g) => g.key === "BANKNIFTY")!;
    expect(bn.netPnl).toBeCloseTo(8000);
  });
});

// ---------------------------------------------------------------------------
// 7. Re-entry cluster detection
// ---------------------------------------------------------------------------
describe("detectReentryClusters", () => {
  // Same underlying, same direction, same strike, same day → cluster
  const entry1 = makeTrade({
    id: "r1",
    indexSymbol: "NIFTY",
    strike: 24050,
    direction: "BULL",
    entryAt: "2026-06-17T04:30:00.000Z", // 10:00 IST
    exitReason: "STOP",
    netPnl: -1500,
    grossPnl: -1100,
    totalCosts: 400,
  });
  const entry2 = makeTrade({
    id: "r2",
    indexSymbol: "NIFTY",
    strike: 24050,
    direction: "BULL",
    entryAt: "2026-06-17T06:30:00.000Z", // 12:00 IST
    exitReason: "STOP",
    netPnl: -1200,
    grossPnl: -900,
    totalCosts: 300,
  });
  const unrelated = makeTrade({
    id: "r3",
    indexSymbol: "BANKNIFTY",
    strike: 55000,
    direction: "BULL",
    entryAt: "2026-06-17T04:30:00.000Z",
  });

  it("detects a re-entry cluster", () => {
    const clusters = detectReentryClusters([entry1, entry2, unrelated]);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.underlying).toBe("NIFTY");
    expect(clusters[0]!.numEntries).toBe(2);
  });

  it("computes correct time gap", () => {
    const clusters = detectReentryClusters([entry1, entry2]);
    expect(clusters[0]!.timeGapMinutes).toBe(120); // 2 hours
  });

  it("simulation keeps only the first trade", () => {
    const clusters = detectReentryClusters([entry1, entry2]);
    const sim = clusters[0]!.simulationNoReentry;
    expect(sim.simulationType).toBe("SIMULATION_ONLY");
    expect(sim.trades).toBe(1);
    expect(sim.netPnl).toBeCloseTo(-1500); // first trade only
  });

  it("ignores single trades (no re-entry)", () => {
    const clusters = detectReentryClusters([entry1, unrelated]);
    expect(clusters.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Excluding date-range simulation (SENSEX audit)
// ---------------------------------------------------------------------------
describe("sensexAudit — excluding date range", () => {
  const before = makeTrade({
    id: "sx1",
    indexSymbol: "SENSEX",
    entryAt: "2026-06-10T04:30:00.000Z", // Jun 10 IST
    netPnl: 3000,
    grossPnl: 3500,
    totalCosts: 500,
  });
  const during = makeTrade({
    id: "sx2",
    indexSymbol: "SENSEX",
    entryAt: "2026-06-13T04:30:00.000Z", // Jun 13 IST
    netPnl: -5000,
    grossPnl: -4500,
    totalCosts: 500,
  });
  const after = makeTrade({
    id: "sx3",
    indexSymbol: "SENSEX",
    entryAt: "2026-06-20T04:30:00.000Z", // Jun 20 IST
    netPnl: 1000,
    grossPnl: 1400,
    totalCosts: 400,
  });

  it("excludeJun11to17 removes the cluster trade", () => {
    const result = computeDiagnostics(META, [before, during, after]);
    const excl = result.sensexAudit.excludingJun11to17;
    expect(excl.simulationType).toBe("SIMULATION_ONLY");
    expect(excl.trades).toBe(2); // before + after
    expect(excl.netPnl).toBeCloseTo(4000);
  });

  it("sensexAudit.all includes all SENSEX trades", () => {
    const result = computeDiagnostics(META, [before, during, after]);
    expect(result.sensexAudit.all.pricedTrades).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 9. Excluding best/worst trade simulation (BANKNIFTY audit)
// ---------------------------------------------------------------------------
describe("bankniftyAudit — robustness", () => {
  const best = makeTrade({ id: "bn1", indexSymbol: "BANKNIFTY", netPnl: 16000, grossPnl: 17000, totalCosts: 1000 });
  const mid = makeTrade({ id: "bn2", indexSymbol: "BANKNIFTY", netPnl: 4000, grossPnl: 4500, totalCosts: 500 });
  const worst = makeTrade({ id: "bn3", indexSymbol: "BANKNIFTY", netPnl: -8000, grossPnl: -7500, totalCosts: 500 });

  it("all BANKNIFTY stats are correct", () => {
    const result = computeDiagnostics(META, [best, mid, worst]);
    expect(result.bankniftyAudit.all.netPnl).toBeCloseTo(12000);
    expect(result.bankniftyAudit.all.pricedTrades).toBe(3);
  });

  it("excludingBestTrade is labelled SIMULATION_ONLY", () => {
    const result = computeDiagnostics(META, [best, mid, worst]);
    expect(result.bankniftyAudit.excludingBestTrade.simulationType).toBe("SIMULATION_ONLY");
  });

  it("excludingBestTrade removes the highest P&L trade", () => {
    const result = computeDiagnostics(META, [best, mid, worst]);
    // mid + worst = 4000 - 8000 = -4000
    expect(result.bankniftyAudit.excludingBestTrade.netPnl).toBeCloseTo(-4000);
  });

  it("verdicts DEPENDS_ON_OUTLIER when excluding best goes negative", () => {
    const result = computeDiagnostics(META, [best, mid, worst]);
    expect(result.bankniftyAudit.robustnessVerdict).toBe("BANKNIFTY_EDGE_DEPENDS_ON_OUTLIER_TRADE");
  });

  it("verdicts APPEARS_ROBUST when excluding best stays positive", () => {
    const best2 = makeTrade({ id: "bn4", indexSymbol: "BANKNIFTY", netPnl: 3000, grossPnl: 3400, totalCosts: 400 });
    const mid2 = makeTrade({ id: "bn5", indexSymbol: "BANKNIFTY", netPnl: 5000, grossPnl: 5500, totalCosts: 500 });
    const mid3 = makeTrade({ id: "bn6", indexSymbol: "BANKNIFTY", netPnl: 4000, grossPnl: 4400, totalCosts: 400 });
    const result = computeDiagnostics(META, [best2, mid2, mid3]);
    expect(result.bankniftyAudit.robustnessVerdict).toBe("BANKNIFTY_EDGE_APPEARS_ROBUST_EARLY_SAMPLE");
  });
});

// ---------------------------------------------------------------------------
// 10. No division-by-zero for empty groups
// ---------------------------------------------------------------------------
describe("computeStats — edge cases (no division by zero)", () => {
  it("handles empty trade list", () => {
    const stats = computeStats([]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBeNull();
    expect(stats.profitFactor).toBeNull();
    expect(stats.expectancyPerTrade).toBeNull();
    expect(stats.avgWin).toBeNull();
    expect(stats.avgLoss).toBeNull();
    expect(stats.bestTrade).toBeNull();
    expect(stats.worstTrade).toBeNull();
    expect(stats.maxDrawdown).toBe(0);
    expect(stats.netPnl).toBe(0);
  });

  it("handles all UNAVAILABLE trades", () => {
    const u2 = { ...UNAVAILABLE, id: "u2" };
    const stats = computeStats([UNAVAILABLE, u2]);
    expect(stats.pricedTrades).toBe(0);
    expect(stats.winRate).toBeNull();
    expect(stats.profitFactor).toBeNull();
  });

  it("handles all-win trades (no gross loss → profitFactor caps at 9999)", () => {
    const w1 = makeTrade({ id: "w1", netPnl: 1000 });
    const w2 = makeTrade({ id: "w2", netPnl: 2000 });
    const stats = computeStats([w1, w2]);
    expect(stats.profitFactor).toBe(9999);
    expect(stats.winRate).toBe(1);
    expect(stats.avgLoss).toBeNull();
  });

  it("handles single-trade list", () => {
    const stats = computeStats([PRICED_WIN]);
    expect(stats.pricedTrades).toBe(1);
    expect(stats.winRate).toBe(1);
    expect(stats.profitFactor).toBe(9999);
    expect(stats.maxDrawdown).toBe(0);
    expect(stats.expectancyPerTrade).toBeCloseTo(PRICED_WIN.netPnl!);
  });

  it("computeDiagnostics returns simulationOnlyRecommendations tagged correctly", () => {
    const result = computeDiagnostics(META, [PRICED_WIN, PRICED_LOSS, UNAVAILABLE]);
    for (const rec of result.simulationOnlyRecommendations) {
      expect(rec.tag).toBe("SIMULATION_ONLY");
    }
    for (const rec of result.simulationOnlyRecommendations) {
      for (const sim of rec.results) {
        expect(sim.simulationType).toBe("SIMULATION_ONLY");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Unavailable reason grouping
// ---------------------------------------------------------------------------
describe("unavailableReasons grouping", () => {
  const noEntry = makeTrade({
    id: "u1",
    pricingMode: "UNAVAILABLE",
    netPnl: null,
    grossPnl: null,
    totalCosts: null,
    spreadCost: null,
    entryPremiumSource: "unavailable",
    exitPremiumSource: "unavailable",
  });
  const hasEntry = makeTrade({
    id: "u2",
    pricingMode: "UNAVAILABLE",
    netPnl: null,
    grossPnl: null,
    totalCosts: null,
    spreadCost: null,
    entryPremiumSource: "2026-06-01T04:00:00.000Z",
    exitPremiumSource: "unavailable",
  });

  it("groups unavailable trades by reason", () => {
    const result = computeDiagnostics(META, [noEntry, hasEntry]);
    expect(result.unavailableReasons.length).toBeGreaterThan(0);
    const totalCounted = result.unavailableReasons.reduce((s, r) => s + r.count, 0);
    expect(totalCounted).toBe(2);
  });

  it("includes underlying in reason groups", () => {
    const result = computeDiagnostics(META, [noEntry, hasEntry]);
    const allUnderlyings = result.unavailableReasons.flatMap((r) => r.underlyings);
    expect(allUnderlyings).toContain("NIFTY");
  });
});

// ---------------------------------------------------------------------------
// 12. bySnapshotAvailability grouping
// ---------------------------------------------------------------------------
describe("bySnapshotAvailability", () => {
  it("groups by pricingMode", () => {
    const result = computeDiagnostics(META, [PRICED_WIN, UNAVAILABLE]);
    const modes = result.bySnapshotAvailability.map((g) => g.key);
    expect(modes).toContain("REAL_CAPTURED_PREMIUM");
    expect(modes).toContain("UNAVAILABLE");
  });
});
