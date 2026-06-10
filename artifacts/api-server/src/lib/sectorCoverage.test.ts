import { describe, it, expect } from "vitest";
import { computeSectorCoverage } from "./sectorCoverage";

const KNOWN = ["IT", "Banks", "Pharma"];

describe("computeSectorCoverage", () => {
  it("reports 100% coverage with no exclusions when all sectors are known", () => {
    const rows = [{ sector: "IT" }, { sector: "Banks" }, { sector: "Pharma" }, { sector: "IT" }];
    const cov = computeSectorCoverage(rows, KNOWN);
    expect(cov.totalRows).toBe(4);
    expect(cov.mappedRows).toBe(4);
    expect(cov.excludedUnmapped).toBe(0);
    expect(cov.coveragePct).toBe(100);
    expect(cov.unmappedSectors).toEqual([]);
    expect(cov.reason).toBeNull();
  });

  it("never silently drops — counts null/empty and unknown sectors with a reason", () => {
    const rows = [
      { sector: "IT" },
      { sector: null },
      { sector: "" },
      { sector: "  " },
      { sector: "Realty" }, // unknown
      { sector: "Realty" }, // unknown
    ];
    const cov = computeSectorCoverage(rows, KNOWN);
    expect(cov.totalRows).toBe(6);
    expect(cov.mappedRows).toBe(1);
    expect(cov.excludedUnmapped).toBe(5);
    expect(cov.coveragePct).toBeCloseTo(16.67, 1);
    // Sorted by count desc, then label asc: Realty(2), (none)(3) — (none) has higher count.
    expect(cov.unmappedSectors).toEqual([
      { label: "(none)", count: 3 },
      { label: "Realty", count: 2 },
    ]);
    expect(cov.reason).toMatch(/3 with no sector/);
    expect(cov.reason).toMatch(/2 with an unmapped sector/);
  });

  it("trims whitespace and accepts a Set for knownSectors", () => {
    const rows = [{ sector: " IT " }, { sector: "Banks" }];
    const cov = computeSectorCoverage(rows, new Set(KNOWN));
    expect(cov.mappedRows).toBe(2);
    expect(cov.excludedUnmapped).toBe(0);
  });

  it("treats an empty row set as fully covered (100%, no exclusions)", () => {
    const cov = computeSectorCoverage([], KNOWN);
    expect(cov.totalRows).toBe(0);
    expect(cov.coveragePct).toBe(100);
    expect(cov.excludedUnmapped).toBe(0);
    expect(cov.reason).toBeNull();
  });
});
