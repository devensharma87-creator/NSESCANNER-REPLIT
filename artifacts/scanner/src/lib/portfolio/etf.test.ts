import { describe, it, expect } from "vitest";
import {
  ETF_REFERENCE,
  ETF_REFERENCE_AS_OF,
  lookupEtfReference,
  etfCategory,
  describeEtfTrend,
  computeNavPremiumDiscount,
  NAV_FAIR_TOLERANCE_PCT,
} from "./etf";

describe("computeNavPremiumDiscount", () => {
  it("reports a premium when CMP is above NAV", () => {
    const r = computeNavPremiumDiscount(102, 100);
    expect(r).not.toBeNull();
    expect(r!.stance).toBe("premium");
    expect(r!.premiumPct).toBeCloseTo(2, 6);
  });

  it("reports a discount when CMP is below NAV", () => {
    const r = computeNavPremiumDiscount(98, 100);
    expect(r!.stance).toBe("discount");
    expect(r!.premiumPct).toBeCloseTo(-2, 6);
  });

  it("treats tiny deviations within tolerance as fair value", () => {
    const r = computeNavPremiumDiscount(100 + NAV_FAIR_TOLERANCE_PCT / 100 * 100 * 0.5, 100);
    expect(r!.stance).toBe("fair");
  });

  it("returns null for missing or non-positive inputs", () => {
    expect(computeNavPremiumDiscount(null, 100)).toBeNull();
    expect(computeNavPremiumDiscount(100, null)).toBeNull();
    expect(computeNavPremiumDiscount(100, 0)).toBeNull();
    expect(computeNavPremiumDiscount(NaN, 100)).toBeNull();
    expect(computeNavPremiumDiscount(100, -5)).toBeNull();
  });
});

describe("ETF_REFERENCE table", () => {
  it("has a verified-as-of date", () => {
    expect(ETF_REFERENCE_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses unique, already-normalised symbols", () => {
    const symbols = ETF_REFERENCE.map(r => r.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    for (const s of symbols) {
      expect(s).toBe(s.toUpperCase());
      expect(s).not.toMatch(/\s/);
    }
  });

  it("every row carries a tracked index and category", () => {
    for (const r of ETF_REFERENCE) {
      expect(r.trackedIndex.length).toBeGreaterThan(0);
      expect(r.category.length).toBeGreaterThan(0);
    }
  });
});

describe("lookupEtfReference", () => {
  it("resolves known ETFs", () => {
    expect(lookupEtfReference("NIFTYBEES")?.trackedIndex).toBe("NIFTY 50");
    expect(lookupEtfReference("GOLDBEES")?.assetClass).toBe("Gold");
    expect(lookupEtfReference("MON100")?.assetClass).toBe("International Equity");
  });

  it("normalises the input symbol", () => {
    expect(lookupEtfReference("niftybees")?.trackedIndex).toBe("NIFTY 50");
    expect(lookupEtfReference(" GOLDBEES.NS ")?.assetClass).toBe("Gold");
  });

  it("returns null for unknown / non-ETF symbols", () => {
    expect(lookupEtfReference("RELIANCE")).toBeNull();
    expect(lookupEtfReference("")).toBeNull();
  });
});

describe("etfCategory", () => {
  it("prefers the curated category", () => {
    expect(etfCategory("NIFTYBEES", "Index ETF")).toBe("Large-cap index");
  });

  it("falls back to the heuristic class label when not curated", () => {
    expect(etfCategory("SOMEGOLDETF", "Gold ETF")).toBe("Gold ETF");
  });

  it("gives a readable label for a bare ETF class", () => {
    expect(etfCategory("UNKNOWNETF", "ETF")).toBe("Exchange-traded fund");
  });
});

describe("describeEtfTrend", () => {
  it("returns null when no average is available", () => {
    expect(describeEtfTrend(100, null, null)).toBeNull();
  });

  it("returns null when CMP is missing", () => {
    expect(describeEtfTrend(null, 90, 80)).toBeNull();
  });

  it("reads above both averages", () => {
    expect(describeEtfTrend(100, 90, 80)).toEqual({
      text: "Above both 50 & 200-DMA",
      tone: "pos",
    });
  });

  it("reads below both averages", () => {
    expect(describeEtfTrend(70, 90, 80)).toEqual({
      text: "Below both 50 & 200-DMA",
      tone: "neg",
    });
  });

  it("reads a position between the averages", () => {
    expect(describeEtfTrend(85, 90, 80)).toEqual({
      text: "Between 50 & 200-DMA",
      tone: "neutral",
    });
  });

  it("handles only one average being available", () => {
    expect(describeEtfTrend(100, 90, null)).toEqual({ text: "Above 50-DMA", tone: "pos" });
    expect(describeEtfTrend(70, null, 80)).toEqual({ text: "Below 200-DMA", tone: "neg" });
  });
});
