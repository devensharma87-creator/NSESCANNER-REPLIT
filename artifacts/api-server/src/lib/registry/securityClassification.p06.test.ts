/**
 * PHASE 0.6 — securityClassification behaviour tests.
 *
 * These tests exercise the real classification/eligibility functions against
 * inline fixtures. No network, no database, no source modification.
 */
import { describe, expect, it } from "vitest";
import {
  assignEligibilityTier,
  classifyBseOfficialRow,
  classifyNseOfficialSeries,
  normalizeIsin,
  violatesLiveTierInvariant,
  type BseOfficialRow,
  type RegistryListingStatus,
  type RegistrySecurityClass,
} from "./securityClassification";

// A valid 12-char ordinary company ISIN (INE issuer prefix).
const ORDINARY_ISIN = "INE001A01036";

function bseRow(over: Partial<BseOfficialRow>): BseOfficialRow {
  return {
    scripCode: "500001",
    scripId: "SOMECO",
    scripName: "Some Company Ltd",
    group: "A",
    segment: "Equity",
    isin: ORDINARY_ISIN,
    status: "Active",
    ...over,
  };
}

describe("classifyNseOfficialSeries", () => {
  it("maps EQ/BE/BZ/SM/ST/SZ to distinct classes", () => {
    const mapped: Array<[string, RegistrySecurityClass]> = [
      ["EQ", "NSE_ORDINARY_EQUITY_EQ"],
      ["BE", "NSE_TRADE_TO_TRADE_BE"],
      ["BZ", "NSE_SURVEILLANCE_BZ"],
      ["SM", "NSE_SME_SM"],
      ["ST", "NSE_SME_ST"],
      ["SZ", "NSE_SME_SZ"],
    ];
    for (const [series, expected] of mapped) {
      expect(classifyNseOfficialSeries(series)).toBe(expected);
    }
    // The six results must be pairwise distinct — no collapsing to one class.
    const results = mapped.map(([series]) => classifyNseOfficialSeries(series));
    expect(new Set(results).size).toBe(mapped.length);
  });

  it("is case- and whitespace-insensitive on known series", () => {
    expect(classifyNseOfficialSeries("  eq ")).toBe("NSE_ORDINARY_EQUITY_EQ");
  });

  it("yields UNRESOLVED for an unknown series (never a silent equity default)", () => {
    expect(classifyNseOfficialSeries("N1")).toBe("UNRESOLVED");
    expect(classifyNseOfficialSeries("")).toBe("UNRESOLVED");
    expect(classifyNseOfficialSeries("ZZZ")).not.toBe("NSE_ORDINARY_EQUITY_EQ");
    expect(classifyNseOfficialSeries("ZZZ")).toBe("UNRESOLVED");
  });
});

describe("classifyBseOfficialRow", () => {
  it("group R with blank Segment -> RIGHTS_ENTITLEMENT", () => {
    const c = classifyBseOfficialRow(bseRow({ group: "R", segment: "", isin: null }));
    expect(c.securityClass).toBe("RIGHTS_ENTITLEMENT");
  });

  it("group R with a non-blank Segment is NOT rights (both signals required)", () => {
    const c = classifyBseOfficialRow(bseRow({ group: "R", segment: "Equity" }));
    expect(c.securityClass).not.toBe("RIGHTS_ENTITLEMENT");
  });

  it("Segment=PreferenceShares -> PREFERENCE_SHARE regardless of group letter (P and Y)", () => {
    const groupP = classifyBseOfficialRow(bseRow({ group: "P", segment: "PreferenceShares" }));
    const groupY = classifyBseOfficialRow(bseRow({ group: "Y", segment: "PreferenceShares" }));
    expect(groupP.securityClass).toBe("PREFERENCE_SHARE");
    expect(groupY.securityClass).toBe("PREFERENCE_SHARE");
  });

  it("group IP with Segment=Equity -> ordinary equity, not a REIT/InvIT", () => {
    const c = classifyBseOfficialRow(bseRow({ group: "IP", segment: "Equity" }));
    expect(c.securityClass).toBe("BSE_ORDINARY_EQUITY");
    expect(c.securityClass).not.toBe("REIT");
    expect(c.securityClass).not.toBe("INVIT");
  });

  it("group P + Equity vs group P + PreferenceShares: the letter P alone proves nothing", () => {
    const equityP = classifyBseOfficialRow(bseRow({ group: "P", segment: "Equity" }));
    const prefP = classifyBseOfficialRow(bseRow({ group: "P", segment: "PreferenceShares" }));
    // Same group letter, opposite outcomes — decided entirely by Segment.
    expect(equityP.securityClass).toBe("BSE_EQUITY_SERIES_P");
    expect(equityP.securityClass).not.toBe("PREFERENCE_SHARE");
    expect(prefP.securityClass).toBe("PREFERENCE_SHARE");
    expect(equityP.securityClass).not.toBe(prefP.securityClass);
  });

  it("ISIN starting INF -> ETF_OR_FUND (overrides group)", () => {
    const c = classifyBseOfficialRow(bseRow({ group: "A", segment: "Equity", isin: "INF001A01036" }));
    expect(c.securityClass).toBe("ETF_OR_FUND");
  });

  it("T/XT/TS/ZP with Segment=Equity -> trade-to-trade", () => {
    for (const g of ["T", "XT", "TS", "ZP"]) {
      const c = classifyBseOfficialRow(bseRow({ group: g, segment: "Equity" }));
      expect(c.securityClass).toBe("BSE_TRADE_TO_TRADE");
    }
  });

  it("M/MT/MS with Segment=Equity -> SME", () => {
    for (const g of ["M", "MT", "MS"]) {
      const c = classifyBseOfficialRow(bseRow({ group: g, segment: "Equity" }));
      expect(c.securityClass).toBe("BSE_SME");
    }
  });

  it("a Segment that is neither Equity nor PreferenceShares -> UNRESOLVED", () => {
    const c = classifyBseOfficialRow(bseRow({ group: "A", segment: "Debt" }));
    expect(c.securityClass).toBe("UNRESOLVED");
  });

  it("every returned evidence string is non-empty across representative rows", () => {
    const rows: BseOfficialRow[] = [
      bseRow({ group: "R", segment: "", isin: null }),
      bseRow({ group: "P", segment: "PreferenceShares" }),
      bseRow({ group: "Y", segment: "PreferenceShares" }),
      bseRow({ group: "IP", segment: "Equity" }),
      bseRow({ group: "P", segment: "Equity" }),
      bseRow({ group: "A", segment: "Equity", isin: "INF001A01036" }),
      bseRow({ group: "T", segment: "Equity" }),
      bseRow({ group: "M", segment: "Equity" }),
      bseRow({ group: "A", segment: "Debt" }),
      bseRow({ group: "QQ", segment: "Equity" }),
    ];
    for (const r of rows) {
      const c = classifyBseOfficialRow(r);
      expect(c.evidence.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeIsin", () => {
  it("'' and 'NA' both become null", () => {
    expect(normalizeIsin("")).toBeNull();
    expect(normalizeIsin("NA")).toBeNull();
    expect(normalizeIsin("  na  ")).toBeNull();
  });

  it("a valid ISIN is preserved and upper-cased", () => {
    expect(normalizeIsin("ine001a01036")).toBe("INE001A01036");
    expect(normalizeIsin(ORDINARY_ISIN)).toBe(ORDINARY_ISIN);
  });

  it("a malformed ISIN is NOT repaired or reconstructed (returns null)", () => {
    // Wrong length — never padded, truncated, or rebuilt.
    expect(normalizeIsin("INE001A0103")).toBeNull(); // 11 chars
    expect(normalizeIsin("INE001A010369")).toBeNull(); // 13 chars
    expect(normalizeIsin("GARBAGE")).toBeNull();
  });
});

describe("assignEligibilityTier", () => {
  it("SUSPENDED outranks class — a suspended ordinary equity is UNAVAILABLE", () => {
    const d = assignEligibilityTier({
      securityClass: "NSE_ORDINARY_EQUITY_EQ",
      listingStatus: "SUSPENDED",
    });
    expect(d.tier).toBe("UNAVAILABLE");
  });

  it("ETF_OR_FUND is SNAPSHOT_ONLY", () => {
    const d = assignEligibilityTier({ securityClass: "ETF_OR_FUND", listingStatus: "ACTIVE" });
    expect(d.tier).toBe("SNAPSHOT_ONLY");
  });

  it("RIGHTS_ENTITLEMENT is never LIVE_REQUIRED", () => {
    for (const status of ["ACTIVE", "UNKNOWN"] as RegistryListingStatus[]) {
      const d = assignEligibilityTier({ securityClass: "RIGHTS_ENTITLEMENT", listingStatus: status });
      expect(d.tier).not.toBe("LIVE_REQUIRED");
    }
  });

  it("UNRESOLVED class never becomes LIVE_REQUIRED", () => {
    const d = assignEligibilityTier({ securityClass: "UNRESOLVED", listingStatus: "ACTIVE" });
    expect(d.tier).not.toBe("LIVE_REQUIRED");
    expect(d.tier).toBe("UNRESOLVED");
  });

  it("an owner-approved active class is LIVE_REQUIRED", () => {
    const d = assignEligibilityTier({
      securityClass: "NSE_ORDINARY_EQUITY_EQ",
      listingStatus: "ACTIVE",
    });
    expect(d.tier).toBe("LIVE_REQUIRED");
  });
});

describe("violatesLiveTierInvariant", () => {
  it("catches an UNRESOLVED class marked LIVE_REQUIRED", () => {
    expect(violatesLiveTierInvariant("LIVE_REQUIRED", "UNRESOLVED", "ACTIVE")).toBe(true);
  });

  it("catches a suspended/delisted record marked LIVE_REQUIRED", () => {
    expect(violatesLiveTierInvariant("LIVE_REQUIRED", "NSE_ORDINARY_EQUITY_EQ", "SUSPENDED")).toBe(true);
    expect(violatesLiveTierInvariant("LIVE_REQUIRED", "NSE_ORDINARY_EQUITY_EQ", "DELISTED")).toBe(true);
  });

  it("catches a non-live class (e.g. ETF/fund) marked LIVE_REQUIRED", () => {
    expect(violatesLiveTierInvariant("LIVE_REQUIRED", "ETF_OR_FUND", "ACTIVE")).toBe(true);
    expect(violatesLiveTierInvariant("LIVE_REQUIRED", "RIGHTS_ENTITLEMENT", "ACTIVE")).toBe(true);
  });

  it("does not flag a genuinely eligible LIVE_REQUIRED record", () => {
    expect(violatesLiveTierInvariant("LIVE_REQUIRED", "NSE_ORDINARY_EQUITY_EQ", "ACTIVE")).toBe(false);
  });

  it("never flags a tier other than LIVE_REQUIRED", () => {
    expect(violatesLiveTierInvariant("SNAPSHOT_ONLY", "UNRESOLVED", "SUSPENDED")).toBe(false);
    expect(violatesLiveTierInvariant("UNAVAILABLE", "ETF_OR_FUND", "DELISTED")).toBe(false);
  });
});
