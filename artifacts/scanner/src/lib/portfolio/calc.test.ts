import { describe, it, expect } from "vitest";
import {
  investedValue,
  currentValue,
  dayChange,
  dayChangePct,
  totalReturn,
  totalReturnPct,
  weightPct,
  computeHoldingMetrics,
  computeSummary,
  computeSectorAllocation,
  totalCurrentValue,
  xirr,
} from "./calc";
import type { LiveMetrics, RawHolding } from "./types";

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

function holding(partial: Partial<RawHolding>): RawHolding {
  return { symbol: "X", name: "X", qty: 1, rate: 1, ...partial };
}

describe("primitive formulas", () => {
  it("invested = qty * rate", () => {
    expect(investedValue(50, 2450.5)).toBe(122525);
  });
  it("current = qty * cmp, null when cmp missing", () => {
    expect(currentValue(50, 2600)).toBe(130000);
    expect(currentValue(50, null)).toBeNull();
  });
  it("day change uses (cmp - prevClose)", () => {
    expect(dayChange(10, 105, 100)).toBe(50);
    expect(dayChange(10, null, 100)).toBeNull();
  });
  it("day change % is relative to prev close", () => {
    expect(dayChangePct(105, 100)).toBeCloseTo(5);
    expect(dayChangePct(105, 0)).toBeNull();
  });
  it("total return = current - invested (NOT reversed)", () => {
    expect(totalReturn(130000, 122525)).toBe(7475);
    expect(totalReturn(100000, 122525)).toBe(-22525);
  });
  it("total return % = return / invested * 100", () => {
    expect(totalReturnPct(7475, 122525)).toBeCloseTo(6.1, 1);
    expect(totalReturnPct(7475, 0)).toBeNull();
  });
  it("weight % = current / total * 100", () => {
    expect(weightPct(25000, 100000)).toBe(25);
    expect(weightPct(25000, 0)).toBeNull();
  });
});

describe("computeHoldingMetrics", () => {
  it("computes full metrics with live data", () => {
    const m = computeHoldingMetrics(
      holding({ qty: 50, rate: 2450.5 }),
      live({ cmp: 2600, previousClose: 2550 }),
      130000,
    );
    expect(m.invested).toBe(122525);
    expect(m.currentValue).toBe(130000);
    expect(m.totalReturn).toBe(7475);
    expect(m.dayChange).toBe(2500);
    expect(m.weightPct).toBe(100);
  });
  it("returns nulls when CMP unavailable", () => {
    const m = computeHoldingMetrics(holding({ qty: 10, rate: 100 }), live({ cmp: null }), null);
    expect(m.invested).toBe(1000);
    expect(m.currentValue).toBeNull();
    expect(m.totalReturn).toBeNull();
    expect(m.weightPct).toBeNull();
  });
});

describe("totalCurrentValue", () => {
  it("sums available current values; null when none available", () => {
    expect(
      totalCurrentValue([
        { raw: holding({ qty: 10, rate: 1 }), live: live({ cmp: 100 }) },
        { raw: holding({ qty: 5, rate: 1 }), live: live({ cmp: 200 }) },
      ]),
    ).toBe(2000);
    expect(
      totalCurrentValue([{ raw: holding({ qty: 10, rate: 1 }), live: live({ cmp: null }) }]),
    ).toBeNull();
  });
});

describe("computeSummary", () => {
  it("aggregates invested/current/return and counts winners/losers", () => {
    const s = computeSummary([
      { raw: holding({ symbol: "A", qty: 10, rate: 100 }), live: live({ cmp: 120, previousClose: 118 }) },
      { raw: holding({ symbol: "B", qty: 10, rate: 100 }), live: live({ cmp: 90, previousClose: 92 }) },
    ]);
    expect(s.totalInvested).toBe(2000);
    expect(s.totalCurrent).toBe(2100);
    expect(s.totalReturn).toBe(100);
    expect(s.winners).toBe(1);
    expect(s.losers).toBe(1);
    expect(s.holdingsCount).toBe(2);
  });
  it("excludes dateless holdings from XIRR and reports the count", () => {
    const s = computeSummary([
      { raw: holding({ symbol: "A", qty: 10, rate: 100 }), live: live({ cmp: 120 }) },
    ]);
    expect(s.approxXirr).toBeNull();
    expect(s.xirrExcluded).toBe(1);
  });
});

describe("xirr", () => {
  it("solves a clean one-year 18% case", () => {
    const r = xirr([
      { date: new Date("2023-01-01"), amount: -100000 },
      { date: new Date("2024-01-01"), amount: 118000 },
    ]);
    expect(r).not.toBeNull();
    expect(r as number).toBeCloseTo(0.18, 2);
  });
  it("returns null without a sign change", () => {
    expect(
      xirr([
        { date: new Date("2023-01-01"), amount: -1 },
        { date: new Date("2024-01-01"), amount: -1 },
      ]),
    ).toBeNull();
  });
  it("returns null with fewer than two flows", () => {
    expect(xirr([{ date: new Date(), amount: -1 }])).toBeNull();
  });
});

describe("computeSectorAllocation", () => {
  it("groups by sector and computes weights", () => {
    const a = computeSectorAllocation([
      { raw: holding({ symbol: "A", qty: 10, rate: 100, sector: "IT" }), live: live({ cmp: 150 }) },
      { raw: holding({ symbol: "B", qty: 10, rate: 100, sector: "IT" }), live: live({ cmp: 150 }) },
      { raw: holding({ symbol: "C", qty: 10, rate: 100, sector: "Energy" }), live: live({ cmp: 150 }) },
    ]);
    const it = a.find(x => x.sector === "IT")!;
    const energy = a.find(x => x.sector === "Energy")!;
    expect(it.currentValue).toBe(3000);
    expect(it.weightPct).toBeCloseTo(66.67, 1);
    expect(energy.weightPct).toBeCloseTo(33.33, 1);
  });
  it("prefers live sector over CSV sector and falls back to Unknown", () => {
    const a = computeSectorAllocation([
      { raw: holding({ symbol: "A", qty: 1, rate: 1 }), live: live({ cmp: 1, sector: "Banks" }) },
      { raw: holding({ symbol: "B", qty: 1, rate: 1 }), live: live({ cmp: 1 }) },
    ]);
    expect(a.some(x => x.sector === "Banks")).toBe(true);
    expect(a.some(x => x.sector === "Unknown")).toBe(true);
  });
});
