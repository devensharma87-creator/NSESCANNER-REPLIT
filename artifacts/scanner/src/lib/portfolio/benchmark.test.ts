import { describe, it, expect } from "vitest";
import { compareToBenchmark, benchmarkReturnFromCloses } from "./benchmark";

describe("benchmarkReturnFromCloses", () => {
  it("computes buy-and-hold percentage return", () => {
    expect(benchmarkReturnFromCloses([100, 110])).toBeCloseTo(10);
    expect(benchmarkReturnFromCloses([200, 150])).toBeCloseTo(-25);
  });

  it("returns null with insufficient or invalid data", () => {
    expect(benchmarkReturnFromCloses([100])).toBeNull();
    expect(benchmarkReturnFromCloses([])).toBeNull();
    expect(benchmarkReturnFromCloses([0, 50])).toBeNull();
  });
});

describe("compareToBenchmark", () => {
  it("computes relative outperformance", () => {
    const c = compareToBenchmark({
      portfolioReturnPct: 15,
      benchmarkReturnPct: 10,
      benchmarkName: "NIFTY 50",
      windowLabel: "since 2024-01-01",
    });
    expect(c.relativePct).toBeCloseTo(5);
    expect(c.verdict).toBe("outperforming");
    expect(c.returnUnavailable).toBeNull();
  });

  it("flags benchmark series missing honestly", () => {
    const c = compareToBenchmark({
      portfolioReturnPct: 8,
      benchmarkReturnPct: null,
      benchmarkName: "NIFTY 50",
      windowLabel: null,
    });
    expect(c.relativePct).toBeNull();
    expect(c.verdict).toBeNull();
    expect(c.returnUnavailable).toContain("NIFTY 50");
  });

  it("always reports sector-weight benchmark as unavailable (never fabricated)", () => {
    const c = compareToBenchmark({
      portfolioReturnPct: 8,
      benchmarkReturnPct: 5,
      benchmarkName: "NIFTY 50",
      windowLabel: null,
    });
    expect(c.sectorWeightUnavailable).toContain("not fabricated");
  });
});
