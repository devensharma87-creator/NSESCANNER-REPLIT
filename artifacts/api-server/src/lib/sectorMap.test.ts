import { describe, it, expect } from "vitest";
import {
  lookupSector,
  computeSectorCoverage,
  UNMAPPED_SECTOR,
  UNMAPPED_INDUSTRY,
  _internalSectorMapSizes,
} from "./sectorMap";

describe("sectorMap.lookupSector", () => {
  it("resolves a symbol present in the curated UNIVERSE", () => {
    const m = lookupSector("HDFCBANK");
    expect(m.source).toBe("universe");
    expect(m.sector).toBe("Banking");
    expect(m.industry).toBeTruthy();
  });

  it("resolves a symbol present in the EXTENSION table", () => {
    const m = lookupSector("CRISIL");
    expect(m.source).toBe("extension");
    expect(m.sector).toBe("Financials");
    expect(m.industry).toBe("Ratings");
  });

  it("resolves another extension symbol with sector + industry", () => {
    const m = lookupSector("ABBOTINDIA");
    expect(m.source).toBe("extension");
    expect(m.sector).toBe("Pharma");
    expect(m.industry).toBe("MNC Pharma");
  });

  it("falls back to Unmapped for unknown symbols", () => {
    const m = lookupSector("THIS_SYMBOL_DOES_NOT_EXIST_XYZ");
    expect(m.source).toBe("unknown");
    expect(m.sector).toBe(UNMAPPED_SECTOR);
    expect(m.industry).toBe(UNMAPPED_INDUSTRY);
  });

  it("treats blank / whitespace symbols as unmapped without throwing", () => {
    expect(lookupSector("").source).toBe("unknown");
    expect(lookupSector("   ").source).toBe("unknown");
  });

  it("normalises symbol case and surrounding whitespace", () => {
    expect(lookupSector("  hdfcbank  ").source).toBe("universe");
    expect(lookupSector("crisil").sector).toBe("Financials");
  });

  it("handles hyphenated tickers like NAM-INDIA", () => {
    const m = lookupSector("NAM-INDIA");
    expect(m.source).toBe("extension");
    expect(m.sector).toBe("Financials");
  });
});

describe("sectorMap.computeSectorCoverage", () => {
  it("aggregates a mixed list correctly", () => {
    const stats = computeSectorCoverage([
      "HDFCBANK",
      "CRISIL",
      "ABBOTINDIA",
      "TOTALLY_FAKE_SYMBOL",
      "HDFCBANK", // duplicate — should be deduped
    ]);
    expect(stats.total).toBe(4);
    expect(stats.bySource.universe).toBeGreaterThanOrEqual(1);
    expect(stats.bySource.extension).toBe(2);
    expect(stats.bySource.unknown).toBe(1);
    expect(stats.unmapped).toEqual(["TOTALLY_FAKE_SYMBOL"]);
    expect(stats.sectorCoveragePct).toBeCloseTo(75.0, 1);
    expect(stats.industryCoveragePct).toBe(stats.sectorCoveragePct);
  });

  it("returns zeros for empty input", () => {
    const stats = computeSectorCoverage([]);
    expect(stats.total).toBe(0);
    expect(stats.bySource.universe).toBe(0);
    expect(stats.bySource.extension).toBe(0);
    expect(stats.bySource.unknown).toBe(0);
    expect(stats.sectorCoveragePct).toBe(0);
  });
});

describe("sectorMap structural integrity", () => {
  it("exposes non-empty universe + extension tables", () => {
    const sizes = _internalSectorMapSizes();
    expect(sizes.universe).toBeGreaterThan(100);
    expect(sizes.extension).toBeGreaterThan(200);
  });
});
