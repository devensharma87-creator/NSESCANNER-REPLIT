import { describe, it, expect } from "vitest";
import {
  compareToBenchmark,
  benchmarkReturnFromCloses,
  buildBenchmarkSeries,
  compareSectorWeights,
  normalizeSectorKey,
  sectorIndexFor,
  sectorIndexesForSectors,
  SECTOR_INDEX_MAP,
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

describe("buildBenchmarkSeries", () => {
  it("rebases closes to % change from the first covered point", () => {
    const pts = buildBenchmarkSeries([
      { t: 1_700_000_000, c: 100 },
      { t: 1_700_086_400, c: 110 },
      { t: 1_700_172_800, c: 95 },
    ]);
    expect(pts.map(p => p.indexPct)).toEqual([0, 10, -5]);
    expect(pts[0].date).toBe(new Date(1_700_000_000 * 1000).toISOString().slice(0, 10));
  });

  it("agrees with benchmarkReturnFromCloses on the final point", () => {
    const candles = [
      { t: 1, c: 200 },
      { t: 2, c: 230 },
      { t: 3, c: 250 },
    ];
    const pts = buildBenchmarkSeries(candles);
    expect(pts[pts.length - 1].indexPct).toBeCloseTo(
      benchmarkReturnFromCloses(candles.map(c => c.c))!,
    );
  });

  it("drops non-finite points before rebasing", () => {
    const pts = buildBenchmarkSeries([
      { t: 1, c: 100 },
      { t: 2, c: Number.NaN },
      { t: 3, c: 120 },
    ]);
    expect(pts).toHaveLength(2);
    expect(pts.map(p => p.indexPct)).toEqual([0, 20]);
  });

  it("returns empty (honest) on insufficient or zero-base data", () => {
    expect(buildBenchmarkSeries([])).toEqual([]);
    expect(buildBenchmarkSeries([{ t: 1, c: 100 }])).toEqual([]);
    expect(buildBenchmarkSeries([{ t: 1, c: 0 }, { t: 2, c: 50 }])).toEqual([]);
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

describe("SECTOR_INDEX_MAP / sectorIndexFor", () => {
  it("each entry's `sector` field matches its map key and references a real bucket", () => {
    for (const [key, ref] of Object.entries(SECTOR_INDEX_MAP)) {
      expect(ref.sector).toBe(key);
      expect(ref.symbol).toBeTruthy();
      expect(ref.name).toBeTruthy();
      // The bucket the index represents must be a known reference bucket.
      expect(Object.keys(NIFTY500_SECTOR_REFERENCE)).toContain(key);
    }
  });

  it("resolves direct buckets and aliases to the correct sector index", () => {
    expect(sectorIndexFor("IT")?.symbol).toBe("NIFTYIT");
    expect(sectorIndexFor("Banking")?.symbol).toBe("BANKNIFTY");
    // Alias: Pharma normalises to Healthcare → NIFTY PHARMA.
    expect(sectorIndexFor("Pharma")?.symbol).toBe("NIFTYPHARMA");
    expect(sectorIndexFor("Pharma")?.name).toBe("NIFTY PHARMA");
    // Alias: Oil & Gas normalises to Energy → NIFTY ENERGY.
    expect(sectorIndexFor("Oil & Gas")?.symbol).toBe("NIFTYENERGY");
  });

  it("returns null for sectors with no published NSE sector index (never invents one)", () => {
    expect(sectorIndexFor("Insurance")).toBeNull(); // mapped bucket but no index
    expect(sectorIndexFor("Telecom")).toBeNull();
    expect(sectorIndexFor("Consumer Internet")).toBeNull(); // unmapped entirely
    expect(sectorIndexFor("")).toBeNull();
  });
});

describe("sectorIndexesForSectors", () => {
  it("returns one ref per held, mapped sector and de-duplicates", () => {
    const refs = sectorIndexesForSectors([
      { sector: "IT", weightPct: 30 },
      { sector: "Banking", weightPct: 20 },
      { sector: "Pharma", weightPct: 10 }, // alias → Healthcare bucket
      { sector: "Healthcare", weightPct: 5 }, // same bucket → de-duplicated
      { sector: "Insurance", weightPct: 15 }, // no index → omitted
      { sector: "Cash", weightPct: 5 }, // unmapped → omitted
    ]);
    const symbols = refs.map(r => r.symbol).sort();
    expect(symbols).toEqual(["BANKNIFTY", "NIFTYIT", "NIFTYPHARMA"]);
  });

  it("ignores zero-weight, null, and non-finite sectors", () => {
    const refs = sectorIndexesForSectors([
      { sector: "IT", weightPct: 0 },
      { sector: "Auto", weightPct: null },
      { sector: "Metals", weightPct: Number.NaN },
      { sector: "Energy", weightPct: 12 },
    ]);
    expect(refs.map(r => r.symbol)).toEqual(["NIFTYENERGY"]);
  });
});
