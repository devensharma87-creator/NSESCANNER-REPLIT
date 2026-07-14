import { describe, it, expect } from "vitest";
import { computeAnalytics, detectRiskFlags } from "./score";
import type { HoldingMetrics, LiveMetrics, RawHolding } from "./types";

function live(p: Partial<LiveMetrics>): LiveMetrics {
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
    ...p,
  };
}

function metrics(p: Partial<HoldingMetrics>): HoldingMetrics {
  return {
    invested: 1000,
    currentValue: 1000,
    dayChange: 0,
    dayChangePct: 0,
    totalReturn: 0,
    totalReturnPct: 0,
    weightPct: 10,
    ...p,
  };
}

const raw: RawHolding = { symbol: "X", name: "X", qty: 1, rate: 1 };

describe("computeAnalytics", () => {
  it("returns null score + null label when there is no live data", () => {
    const r = computeAnalytics({ raw, live: live({ cmp: null }), metrics: metrics({}), sectorWeightPct: 10 });
    expect(r.score).toBeNull();
    expect(r.label).toBeNull();
    expect(r.componentsUsed).toHaveLength(0);
    expect(r.reasons[0]).toMatch(/unavailable/i);
  });

  it("scores a healthy holding as Strong Structure", () => {
    const r = computeAnalytics({
      raw,
      live: live({ cmp: 120, dma50: 110, dma200: 100, rsi14: 55, trendStrength: 80 }),
      metrics: metrics({ totalReturnPct: 25, weightPct: 8 }),
      sectorWeightPct: 20,
    });
    expect(r.score).not.toBeNull();
    expect(r.score! >= 70).toBe(true);
    expect(r.label).toBe("Strong Structure");
  });

  it("labels deep weakness as Exit Review", () => {
    const r = computeAnalytics({
      raw,
      live: live({ cmp: 80, dma50: 100, dma200: 110, rsi14: 35 }),
      metrics: metrics({ totalReturnPct: -25, weightPct: 5 }),
      sectorWeightPct: 10,
    });
    expect(r.label).toBe("Exit Review");
  });

  it("labels overbought-but-strong as Avoid Fresh Buy", () => {
    const r = computeAnalytics({
      raw,
      live: live({ cmp: 130, dma50: 110, dma200: 100, rsi14: 78, trendStrength: 85 }),
      metrics: metrics({ totalReturnPct: 22, weightPct: 8 }),
      sectorWeightPct: 15,
    });
    expect(r.label).toBe("Avoid Fresh Buy");
  });

  it("always lists the sector valuation benchmark as unavailable (display-only fundamentals)", () => {
    const r = computeAnalytics({
      raw,
      live: live({ cmp: 100, dma50: 95, dma200: 90, rsi14: 50, peRatio: 25 }),
      metrics: metrics({ totalReturnPct: 5 }),
      sectorWeightPct: 10,
    });
    expect(r.unavailable).toContain("Sector valuation benchmark");
    expect(r.componentsUsed).not.toContain("Valuation");
  });
});

describe("detectRiskFlags", () => {
  it("flags single-stock and sector concentration", () => {
    const flags = detectRiskFlags({
      raw,
      live: live({ cmp: 100 }),
      metrics: metrics({ weightPct: 25 }),
      sectorWeightPct: 40,
    });
    expect(flags.some(f => f.code === "WEIGHT_CONCENTRATION")).toBe(true);
    expect(flags.some(f => f.code === "SECTOR_CONCENTRATION")).toBe(true);
  });

  it("flags below-DMA, drawdown, and RSI extremes", () => {
    const flags = detectRiskFlags({
      raw,
      live: live({ cmp: 80, dma50: 100, dma200: 110, rsi14: 22 }),
      metrics: metrics({ totalReturnPct: -15 }),
      sectorWeightPct: 10,
    });
    expect(flags.some(f => f.code === "BELOW_50DMA")).toBe(true);
    expect(flags.some(f => f.code === "BELOW_200DMA")).toBe(true);
    expect(flags.some(f => f.code === "DRAWDOWN")).toBe(true);
    expect(flags.some(f => f.code === "RSI_OVERSOLD")).toBe(true);
  });

  it("flags missing data", () => {
    const flags = detectRiskFlags({
      raw,
      live: live({ available: false, cmp: null }),
      metrics: metrics({ currentValue: null }),
      sectorWeightPct: null,
    });
    expect(flags.some(f => f.code === "DATA_UNAVAILABLE")).toBe(true);
  });
});
