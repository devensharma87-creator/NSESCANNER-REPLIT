import { describe, it, expect } from "vitest";
import {
  compareToBenchmark,
  buildBenchmarkProvenance,
  benchmarkReturnFromCloses,
  buildBenchmarkSeries,
  buildPortfolioValueSeries,
  mergeBenchmarkAndPortfolio,
  compareSectorWeights,
  normalizeSectorKey,
  sectorIndexFor,
  sectorIndexesForSectors,
  sectorReferenceStaleness,
  SECTOR_INDEX_MAP,
  BENCHMARK_OPTIONS,
  NIFTY500_SECTOR_REFERENCE,
  NIFTY500_SECTOR_REFERENCE_AS_OF,
  NIFTY500_SECTOR_REFERENCE_MAX_AGE_DAYS,
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

  it("passes the provenance envelope through unchanged", () => {
    const prov = buildBenchmarkProvenance({ source: "kite", fresh: true, asOf: 1, closesCovered: 5 });
    const c = compareToBenchmark({
      portfolioReturnPct: 1,
      benchmarkReturnPct: 1,
      benchmarkName: "NIFTY 50",
      windowLabel: null,
      provenance: prov,
    });
    expect(c.provenance).toBe(prov);
  });

  it("defaults provenance to null when not supplied", () => {
    const c = compareToBenchmark({
      portfolioReturnPct: 1,
      benchmarkReturnPct: 1,
      benchmarkName: "NIFTY 50",
      windowLabel: null,
    });
    expect(c.provenance).toBeNull();
  });
});

describe("buildBenchmarkProvenance", () => {
  it("labels a Kite series as authoritative (tradeable-grade reference)", () => {
    const p = buildBenchmarkProvenance({ source: "kite", fresh: true, asOf: 100, closesCovered: 30 });
    expect(p.sourceProvider).toBe("kite");
    expect(p.sourcePriority).toBe(1);
    expect(p.trustTier).toBe("authoritative");
    expect(p.delayed).toBe(false);
    expect(p.notForSignals).toBe(false);
    expect(p.notForTradeDecisions).toBe(false);
    expect(p.isStale).toBe(false);
    expect(p.missingReason).toBeNull();
    expect(p.closesCovered).toBe(30);
    expect(p.warnings).toEqual([]);
  });

  it("labels a Yahoo series as a delayed secondary_analytics reference, never authoritative", () => {
    const p = buildBenchmarkProvenance({ source: "yahoo", fresh: true, asOf: 100, closesCovered: 30 });
    expect(p.sourceProvider).toBe("yahoo");
    expect(p.sourcePriority).toBe(3);
    expect(p.trustTier).toBe("secondary_analytics");
    expect(p.delayed).toBe(true);
    expect(p.notForSignals).toBe(true);
    expect(p.notForTradeDecisions).toBe(true);
    expect(p.warnings.some(w => /Yahoo/i.test(w))).toBe(true);
  });

  it("marks a stale Kite series as stale and warns, but stays authoritative-source", () => {
    const p = buildBenchmarkProvenance({ source: "kite", fresh: false, asOf: 100, closesCovered: 30 });
    expect(p.isStale).toBe(true);
    expect(p.warnings.some(w => /freshness/i.test(w))).toBe(true);
  });

  it("reports unavailable with a missingReason when fewer than two closes", () => {
    const p = buildBenchmarkProvenance({ source: "kite", fresh: true, asOf: null, closesCovered: 1 });
    expect(p.trustTier).toBe("unavailable");
    expect(p.sourceProvider).toBeNull();
    expect(p.sourcePriority).toBe(99);
    expect(p.notForSignals).toBe(true);
    expect(p.notForTradeDecisions).toBe(true);
    expect(p.missingReason).toMatch(/two covered index closes/i);
  });

  it("reports unavailable when source is none even if closes claimed", () => {
    const p = buildBenchmarkProvenance({ source: "none", fresh: false, asOf: null, closesCovered: 10 });
    expect(p.trustTier).toBe("unavailable");
    expect(p.missingReason).toMatch(/No benchmark index series/i);
  });

  it("never throws on undefined inputs (honest unavailable)", () => {
    const p = buildBenchmarkProvenance({ source: undefined, fresh: undefined, asOf: undefined, closesCovered: NaN });
    expect(p.trustTier).toBe("unavailable");
    expect(p.closesCovered).toBe(0);
  });
});

describe("NIFTY500_SECTOR_REFERENCE", () => {
  it("is a real, internally-consistent partition that sums to ~100%", () => {
    const total = Object.values(NIFTY500_SECTOR_REFERENCE).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });
});

describe("sectorReferenceStaleness", () => {
  it("reports fresh within the max-age window", () => {
    const asOfMs = Date.parse(`${NIFTY500_SECTOR_REFERENCE_AS_OF}T00:00:00Z`);
    const tenDaysLater = new Date(asOfMs + 10 * 86_400_000);
    const s = sectorReferenceStaleness(tenDaysLater);
    expect(s.asOf).toBe(NIFTY500_SECTOR_REFERENCE_AS_OF);
    expect(s.ageDays).toBe(10);
    expect(s.maxAgeDays).toBe(NIFTY500_SECTOR_REFERENCE_MAX_AGE_DAYS);
    expect(s.stale).toBe(false);
  });

  it("flags stale once past the max-age window", () => {
    const asOfMs = Date.parse(`${NIFTY500_SECTOR_REFERENCE_AS_OF}T00:00:00Z`);
    const wayLater = new Date(asOfMs + (NIFTY500_SECTOR_REFERENCE_MAX_AGE_DAYS + 1) * 86_400_000);
    const s = sectorReferenceStaleness(wayLater);
    expect(s.ageDays).toBe(NIFTY500_SECTOR_REFERENCE_MAX_AGE_DAYS + 1);
    expect(s.stale).toBe(true);
  });

  it("clamps a future capture date to zero age (never negative)", () => {
    const asOfMs = Date.parse(`${NIFTY500_SECTOR_REFERENCE_AS_OF}T00:00:00Z`);
    const before = new Date(asOfMs - 5 * 86_400_000);
    const s = sectorReferenceStaleness(before);
    expect(s.ageDays).toBe(0);
    expect(s.stale).toBe(false);
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

describe("buildPortfolioValueSeries", () => {
  // Two trading days, two holdings, both fully covered.
  const D1 = Date.parse("2024-01-01T00:00:00Z") / 1000;
  const D2 = Date.parse("2024-01-02T00:00:00Z") / 1000;
  const D3 = Date.parse("2024-01-03T00:00:00Z") / 1000;

  it("builds a rebased value path from Σ qty × close over fully-covered days", () => {
    const out = buildPortfolioValueSeries([
      { symbol: "A", qty: 10, candles: [{ t: D1, c: 100 }, { t: D2, c: 110 }] },
      { symbol: "B", qty: 5, candles: [{ t: D1, c: 200 }, { t: D2, c: 200 }] },
    ]);
    // Day1 value = 10*100 + 5*200 = 2000; Day2 = 10*110 + 5*200 = 2100 → +5%
    expect(out.unavailable).toBeNull();
    expect(out.points.map(p => p.date)).toEqual(["2024-01-01", "2024-01-02"]);
    expect(out.points[0].portfolioPct).toBe(0);
    expect(out.points[1].portfolioPct).toBeCloseTo(5, 9);
    expect(out.coveredHoldings).toBe(2);
    expect(out.totalHoldings).toBe(2);
    expect(out.partial).toBe(false);
    expect(out.missingSymbols).toEqual([]);
    expect(out.firstFullCoverageDate).toBe("2024-01-01");
  });

  it("only plots days where every covered holding has a close (constant basket)", () => {
    const out = buildPortfolioValueSeries([
      { symbol: "A", qty: 1, candles: [{ t: D1, c: 100 }, { t: D2, c: 100 }, { t: D3, c: 100 }] },
      // B has no D1 close → D1 is not full-coverage; path starts at D2.
      { symbol: "B", qty: 1, candles: [{ t: D2, c: 50 }, { t: D3, c: 60 }] },
    ]);
    expect(out.points.map(p => p.date)).toEqual(["2024-01-02", "2024-01-03"]);
    expect(out.points[0].portfolioPct).toBe(0);
    // Day2 = 150, Day3 = 160 → +6.667%
    expect(out.points[1].portfolioPct).toBeCloseTo((160 / 150 - 1) * 100, 9);
    expect(out.partial).toBe(true); // started later than earliest covered data
    expect(out.firstFullCoverageDate).toBe("2024-01-02");
  });

  it("flags missing symbols and excludes them, but still plots the covered basket", () => {
    const out = buildPortfolioValueSeries([
      { symbol: "A", qty: 2, candles: [{ t: D1, c: 100 }, { t: D2, c: 120 }] },
      { symbol: "NOHIST", qty: 9, candles: [] },
    ]);
    expect(out.missingSymbols).toEqual(["NOHIST"]);
    expect(out.coveredHoldings).toBe(1);
    expect(out.totalHoldings).toBe(2);
    expect(out.partial).toBe(true);
    expect(out.points.map(p => p.portfolioPct)).toEqual([0, 20]);
  });

  it("reports unavailable when no holding has any history", () => {
    const out = buildPortfolioValueSeries([
      { symbol: "A", qty: 1, candles: [] },
      { symbol: "B", qty: 1, candles: [] },
    ]);
    expect(out.points).toEqual([]);
    expect(out.unavailable).toMatch(/no holdings have daily price history/i);
    expect(out.missingSymbols).toEqual(["A", "B"]);
  });

  it("reports unavailable when there is no overlapping full-coverage day", () => {
    const out = buildPortfolioValueSeries([
      { symbol: "A", qty: 1, candles: [{ t: D1, c: 100 }] },
      { symbol: "B", qty: 1, candles: [{ t: D2, c: 100 }] },
    ]);
    expect(out.points).toEqual([]);
    expect(out.unavailable).toMatch(/no overlapping daily history/i);
  });

  it("never fabricates: non-finite closes/qty are ignored", () => {
    const out = buildPortfolioValueSeries([
      { symbol: "A", qty: Number.NaN, candles: [{ t: D1, c: 100 }, { t: D2, c: 110 }] },
      { symbol: "B", qty: 1, candles: [{ t: D1, c: 100 }, { t: D2, c: Number.NaN }] },
    ]);
    // A has NaN qty → no usable candles → missing. B has a NaN close on D2 → only D1 usable → <2 full days.
    expect(out.missingSymbols).toContain("A");
    expect(out.unavailable).not.toBeNull();
  });
});

describe("mergeBenchmarkAndPortfolio", () => {
  it("aligns index and portfolio points on a shared, sorted date axis with honest nulls", () => {
    const index = [
      { t: 100, date: "2024-01-01", indexPct: 0 },
      { t: 200, date: "2024-01-02", indexPct: 2 },
    ];
    const portfolio = [
      { t: 200, date: "2024-01-02", portfolioPct: 0 },
      { t: 300, date: "2024-01-03", portfolioPct: 5 },
    ];
    const merged = mergeBenchmarkAndPortfolio(index, portfolio);
    expect(merged.map(p => p.date)).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
    expect(merged[0]).toMatchObject({ indexPct: 0, portfolioPct: null });
    expect(merged[1]).toMatchObject({ indexPct: 2, portfolioPct: 0 });
    expect(merged[2]).toMatchObject({ indexPct: null, portfolioPct: 5 });
  });

  it("returns an empty axis when both inputs are empty", () => {
    expect(mergeBenchmarkAndPortfolio([], [])).toEqual([]);
  });
});
