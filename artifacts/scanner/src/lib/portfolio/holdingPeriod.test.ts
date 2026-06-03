import { describe, it, expect } from "vitest";
import {
  computeHoldingPeriods,
  computeDividends,
  daysBetween,
  LONG_TERM_THRESHOLD_DAYS,
  type CostBasisRow,
} from "./holdingPeriod";
import type { LiveMetrics, HoldingMetrics, RawHolding } from "./types";

const EMPTY_LIVE: LiveMetrics = {
  available: false,
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
};

function row(
  symbol: string,
  opts: { date?: string; div?: number; ret?: number | null; qty?: number; rate?: number },
): CostBasisRow {
  const qty = opts.qty ?? 1;
  const rate = opts.rate ?? 100;
  const raw: RawHolding = {
    symbol,
    name: symbol,
    qty,
    rate,
    purchaseDate: opts.date,
    dividendReceived: opts.div,
  };
  const metrics: HoldingMetrics = {
    invested: qty * rate,
    currentValue: opts.ret != null ? qty * rate + opts.ret : null,
    dayChange: null,
    dayChangePct: null,
    totalReturn: opts.ret ?? null,
    totalReturnPct: null,
    weightPct: null,
  };
  return { raw, live: EMPTY_LIVE, metrics };
}

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween(new Date("2024-01-01"), new Date("2024-01-11"))).toBe(10);
  });
});

describe("computeHoldingPeriods", () => {
  const now = new Date("2025-06-01");

  it("classifies long-term, short-term and unknown", () => {
    const v = computeHoldingPeriods(
      [
        row("LT", { date: "2023-01-01", rate: 100 }), // > 365d
        row("ST", { date: "2025-04-01", rate: 100 }), // < 365d
        row("UNK", { rate: 100 }), // no date
      ],
      LONG_TERM_THRESHOLD_DAYS,
      now,
    );
    expect(v.longTermCount).toBe(1);
    expect(v.shortTermCount).toBe(1);
    expect(v.unknownCount).toBe(1);
    expect(v.longTermInvested).toBe(100);
    expect(v.unknownInvested).toBe(100);
  });

  it("respects a configurable threshold", () => {
    const v = computeHoldingPeriods([row("X", { date: "2025-01-01" })], 30, now);
    expect(v.buckets[0].classification).toBe("Long-term");
  });
});

describe("computeDividends", () => {
  it("computes totals, yield-on-cost and total return incl dividends", () => {
    const v = computeDividends([
      row("A", { div: 500, ret: 1000, qty: 10, rate: 100 }), // invested 1000
      row("B", { div: 0, ret: -200, qty: 5, rate: 100 }), // invested 500
    ]);
    expect(v.hasData).toBe(true);
    expect(v.totalDividends).toBe(500);
    expect(v.totalInvested).toBe(1500);
    expect(v.capitalReturn).toBe(800);
    expect(v.totalReturnInclDiv).toBe(1300);
    expect(v.yieldOnCostPct).toBeCloseTo((500 / 1500) * 100);
  });

  it("reports no dividend data when none entered", () => {
    const v = computeDividends([row("A", { ret: 100 })]);
    expect(v.hasData).toBe(false);
    expect(v.totalDividends).toBe(0);
  });
});
