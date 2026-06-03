import { describe, it, expect } from "vitest";
import { computeRiskAnalytics, RISK_THRESHOLDS, type RiskRow } from "./risk";
import type { LiveMetrics, HoldingMetrics, RawHolding } from "./types";

function live(partial: Partial<LiveMetrics>): LiveMetrics {
  return {
    available: true,
    sector: null,
    cmp: null,
    previousClose: null,
    rsi14: null,
    dma50: null,
    dma200: null,
    supportZone: null,
    resistanceZone: null,
    trendStrength: null,
    peRatio: null,
    pbRatio: null,
    roe: null,
    marketCapCr: null,
    beta: null,
    ...partial,
  };
}

function row(
  symbol: string,
  currentValue: number | null,
  totalReturn: number | null,
  extra: Partial<LiveMetrics> = {},
): RiskRow {
  const raw: RawHolding = { symbol, name: symbol, qty: 1, rate: 100 };
  const metrics: HoldingMetrics = {
    invested: 100,
    currentValue,
    dayChange: null,
    dayChangePct: null,
    totalReturn,
    totalReturnPct: null,
    weightPct: null,
  };
  return { raw, live: live({ cmp: currentValue, ...extra }), metrics };
}

describe("computeRiskAnalytics", () => {
  it("returns empty analytics for no rows", () => {
    const r = computeRiskAnalytics([]);
    expect(r.hhi).toBeNull();
    expect(r.hhiLabel).toBe("Unavailable");
    expect(r.dataAvailabilityPct).toBe(0);
  });

  it("computes HHI and top-holding weight on current value", () => {
    const r = computeRiskAnalytics([row("A", 80, 5), row("B", 20, -2)]);
    // weights 0.8, 0.2 → HHI = (0.64+0.04)*10000 = 6800
    expect(r.hhi).toBe(6800);
    expect(r.hhiLabel).toBe("Highly concentrated");
    expect(r.topHoldingSymbol).toBe("A");
    expect(r.topHoldingWeightPct).toBeCloseTo(80);
    expect(r.flags.some(f => f.code === "SINGLE_STOCK_CONCENTRATION")).toBe(true);
  });

  it("labels a diversified book", () => {
    const r = computeRiskAnalytics([
      row("A", 25, 1),
      row("B", 25, 1),
      row("C", 25, 1),
      row("D", 25, 1),
    ]);
    expect(r.hhi).toBe(2500);
    // 2500 hits HHI_HIGH boundary
    expect(r.hhiLabel).toBe("Highly concentrated");
  });

  it("computes value-weighted beta over covered holdings only", () => {
    const r = computeRiskAnalytics([
      row("A", 100, 0, { beta: 1.2 }),
      row("B", 100, 0), // no beta
    ]);
    expect(r.weightedBeta).toBeCloseTo(1.2);
    expect(r.betaCoveragePct).toBeCloseTo(50);
  });

  it("identifies top contributor and worst drag", () => {
    const r = computeRiskAnalytics([row("A", 100, 50), row("B", 100, -30)]);
    expect(r.topContributor).toEqual({ symbol: "A", pnl: 50 });
    expect(r.worstDrag).toEqual({ symbol: "B", pnl: -30 });
    expect(r.winners).toBe(1);
    expect(r.losers).toBe(1);
    expect(r.unrealisedGain).toBe(50);
    expect(r.unrealisedLoss).toBe(-30);
  });

  it("flags low data availability", () => {
    const r = computeRiskAnalytics([row("A", 100, 1), row("B", null, null)]);
    expect(r.dataAvailabilityPct).toBeCloseTo(50);
    expect(r.dataAvailabilityPct).toBeLessThan(RISK_THRESHOLDS.DATA_AVAILABILITY_PCT);
    expect(r.flags.some(f => f.code === "LOW_DATA_AVAILABILITY")).toBe(true);
  });
});
