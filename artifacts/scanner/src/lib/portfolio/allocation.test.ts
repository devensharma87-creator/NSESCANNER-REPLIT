import { describe, it, expect } from "vitest";
import { computeAllocation, type AllocRow } from "./allocation";
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
  opts: { sector?: string; current: number | null; ret?: number | null; mcap?: number | null },
): AllocRow {
  const raw: RawHolding = { symbol, name: symbol, sector: opts.sector, qty: 1, rate: 100 };
  const metrics: HoldingMetrics = {
    invested: 100,
    currentValue: opts.current,
    dayChange: null,
    dayChangePct: null,
    totalReturn: opts.ret ?? null,
    totalReturnPct: null,
    weightPct: null,
  };
  return {
    raw,
    live: live({ cmp: opts.current, sector: opts.sector ?? null, marketCapCr: opts.mcap ?? null }),
    metrics,
  };
}

describe("computeAllocation", () => {
  it("aggregates by sector", () => {
    const v = computeAllocation(
      [
        row("A", { sector: "IT", current: 60 }),
        row("B", { sector: "IT", current: 40 }),
        row("C", { sector: "Banking", current: 100 }),
      ],
      "sector",
    );
    expect(v.unavailable).toBeNull();
    const it = v.slices.find(s => s.label === "IT")!;
    expect(it.value).toBe(100);
    expect(it.weightPct).toBeCloseTo(50);
  });

  it("aggregates by stock weight", () => {
    const v = computeAllocation([row("A", { current: 75 }), row("B", { current: 25 })], "stock");
    expect(v.slices[0].label).toBe("A");
    expect(v.slices[0].weightPct).toBeCloseTo(75);
  });

  it("reports market-cap unavailable when no mcap data", () => {
    const v = computeAllocation([row("A", { current: 100 })], "marketcap");
    expect(v.unavailable).toContain("Market-cap allocation unavailable");
    expect(v.slices).toHaveLength(0);
  });

  it("buckets market caps when available", () => {
    const v = computeAllocation(
      [
        row("A", { current: 100, mcap: 50000 }),
        row("B", { current: 100, mcap: 8000 }),
        row("C", { current: 100, mcap: 1000 }),
      ],
      "marketcap",
    );
    expect(v.slices.map(s => s.label).sort()).toEqual(["Large-cap", "Mid-cap", "Small-cap"]);
  });

  it("splits winners and losers", () => {
    const v = computeAllocation(
      [row("A", { current: 120, ret: 20 }), row("B", { current: 80, ret: -20 })],
      "winloss",
    );
    const win = v.slices.find(s => s.label === "Winners")!;
    const lose = v.slices.find(s => s.label === "Losers")!;
    expect(win.value).toBe(120);
    expect(lose.value).toBe(80);
  });

  it("computes P&L contribution shares on absolute pnl", () => {
    const v = computeAllocation(
      [row("A", { current: 150, ret: 50 }), row("B", { current: 50, ret: -50 })],
      "pnl",
    );
    expect(v.slices.find(s => s.label === "A")!.weightPct).toBeCloseTo(50);
    expect(v.slices.find(s => s.label === "A")!.sign).toBe("pos");
    expect(v.slices.find(s => s.label === "B")!.sign).toBe("neg");
  });
});
