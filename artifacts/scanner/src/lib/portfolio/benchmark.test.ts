import { describe, it, expect } from "vitest";
import {
  compareToBenchmark,
  benchmarkReturnFromCloses,
  compareSectorWeights,
  normalizeSectorKey,
  BENCHMARK_OPTIONS,
  NIFTY500_SECTOR_REFERENCE,
} from "./benchmark";

describe("BENCHMARK_OPTIONS", () => {
  it("exposes the selectable indices with stable keys/symbols incl. NIFTY 500", () => {
    expect(BENCHMARK_OPTIONS.map(o => o.key)).toEqual(["NIFTY", "NIFTY500", "BANKNIFTY", "SENSEX"]);
    expect(BENCHMARK_OPTIONS.map(o => o.symbol)).toEqual(["NIFTY", "NIFTY500", "BANKNIFTY", "SENSEX"]);
    expect(BENCHMARK_OPTIONS.map(o => o.name)).toEqual([
      "NIFTY 50",
      "NIFTY 500",
      "Bank Nifty",
      "Sensex",
    ]);
  });

  it("flows the selected benchmark name through the comparison verbatim", () => {
    for (const o of BENCHMARK_OPTIONS) {
      const c = compareToBenchmark({
        portfolioReturnPct: 5,
        benchmarkReturnPct: null,
        benchmarkName: o.name,
        windowLabel: null,
      });
      expect(c.benchmarkName).toBe(o.name);
      expect(c.returnUnavailable).toContain(o.name);
    }
  });
});

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
      benchmarkName: "NIFTY 500",
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
      benchmarkName: "NIFTY 500",
      windowLabel: null,
    });
    expect(c.relativePct).toBeNull();
    expect(c.verdict).toBeNull();
    expect(c.returnUnavailable).toContain("NIFTY 500");
  });
});

describe("NIFTY500_SECTOR_REFERENCE", () => {
  it("is a real, internally-consistent partition that sums to ~100%", () => {
    const total = Object.values(NIFTY500_SECTOR_REFERENCE).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });
});

describe("normalizeSectorKey", () => {
  it("maps exact bucket names and known synonyms", () => {
    expect(normalizeSectorKey("Banking")).toBe("Banking");
    expect(normalizeSectorKey("Banks")).toBe("Banking");
    expect(normalizeSectorKey("Pharma")).toBe("Healthcare");
    expect(normalizeSectorKey("Oil & Gas")).toBe("Energy");
    expect(normalizeSectorKey("Information Technology")).toBe("IT");
    expect(normalizeSectorKey("Realty")).toBe("Real Estate");
  });

  it("returns null for non-comparable / unknown sectors (no fuzzy guessing)", () => {
    expect(normalizeSectorKey("Unknown")).toBeNull();
    expect(normalizeSectorKey("Unmapped")).toBeNull();
    expect(normalizeSectorKey("Other")).toBeNull();
    expect(normalizeSectorKey("Consumer Internet")).toBeNull();
    expect(normalizeSectorKey("")).toBeNull();
  });
});

describe("compareSectorWeights", () => {
  it("reports unavailable when no live sector weights exist", () => {
    const c = compareSectorWeights([{ sector: "IT", weightPct: null }]);
    expect(c.unavailable).toContain("unavailable");
    expect(c.rows).toEqual([]);
  });

  it("computes over/under-weight against the real reference", () => {
    const c = compareSectorWeights([
      { sector: "IT", weightPct: 30 }, // ref 6.51 → heavily overweight
      { sector: "Banking", weightPct: 5 }, // ref 12.5 → underweight
    ]);
    expect(c.unavailable).toBeNull();
    const it = c.rows.find(r => r.sector === "IT")!;
    expect(it.benchmarkPct).toBeCloseTo(6.51);
    expect(it.diffPct).toBeCloseTo(30 - 6.51);
    expect(it.stance).toBe("overweight");
    const banking = c.rows.find(r => r.sector === "Banking")!;
    expect(banking.diffPct).toBeCloseTo(5 - 12.5);
    expect(banking.stance).toBe("underweight");
  });

  it("aggregates synonym sectors into a single bucket (Pharma + Healthcare → Healthcare)", () => {
    const c = compareSectorWeights([
      { sector: "Pharma", weightPct: 4 },
      { sector: "Healthcare", weightPct: 3 },
    ]);
    const hc = c.rows.find(r => r.sector === "Healthcare")!;
    expect(hc.portfolioPct).toBeCloseTo(7);
  });

  it("surfaces unmapped sectors honestly and reports coverage", () => {
    const c = compareSectorWeights([
      { sector: "IT", weightPct: 60 },
      { sector: "Consumer Internet", weightPct: 40 },
    ]);
    expect(c.unmapped.map(u => u.sector)).toContain("Consumer Internet");
    expect(c.coveragePct).toBeCloseTo(60);
  });

  it("sorts rows by absolute over/under-weight magnitude", () => {
    const c = compareSectorWeights([
      { sector: "IT", weightPct: 50 },
      { sector: "FMCG", weightPct: 9 },
    ]);
    expect(Math.abs(c.rows[0].diffPct)).toBeGreaterThanOrEqual(Math.abs(c.rows[1].diffPct));
  });
});
