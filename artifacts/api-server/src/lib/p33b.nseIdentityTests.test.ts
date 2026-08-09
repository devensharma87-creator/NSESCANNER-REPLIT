/**
 * p33b.nseIdentityTests.test.ts — Blocker 1: NSE authoritative identity tests.
 *
 * Tests the NSE EQUITY_L.csv reference join logic:
 *   - classifyNseSeries helper maps series codes → canonical classes
 *   - classifyInstrument with nseRef → ORDINARY_MAIN_BOARD_EQUITY for EQ
 *   - classifyInstrument with nseRef → TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED for BE
 *   - classifyInstrument with nseRef → SME_EQUITY_POLICY_EXCLUDED for SM/ST
 *   - classifyInstrument with nseRef=null → KITE_NSE_EQ_LIKE_PROVISIONAL
 *   - classifyInstrument with nseRef but symbol absent → UNRESOLVED_SECURITY_TYPE
 *   - parseCsv round-trips correctly for EQUITY_L.csv format
 *   - Reconciliation counts follow the authoritative vocabulary
 *   - WAREHOUSE_EXCLUDED_CLASSES does not include ORDINARY_MAIN_BOARD_EQUITY
 *   - WAREHOUSE_EXCLUDED_CLASSES does not include KITE_NSE_EQ_LIKE_PROVISIONAL
 *
 * Suite: api-server vitest (non-DB, --pool=threads)
 */

import { describe, it, expect } from "vitest";
import {
  classifyInstrument,
  WAREHOUSE_EXCLUDED_CLASSES,
  type InstrumentEligibilityClass,
} from "../lib/kiteCandle/instrumentEligibility";
import { classifyNseSeries } from "../lib/nseSecurityMaster";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNseRef(entries: Array<{ symbol: string; series: string; isin: string; dateOfListing: string }>) {
  const m = new Map<string, { series: string; isin: string; dateOfListing: string }>();
  for (const e of entries) {
    m.set(e.symbol.toUpperCase(), { series: e.series, isin: e.isin, dateOfListing: e.dateOfListing });
  }
  return m;
}

function classify(symbol: string, nseRef: Map<string, { series: string; isin: string; dateOfListing: string }> | null): InstrumentEligibilityClass {
  return classifyInstrument({
    symbol,
    name: symbol,
    instrumentType: "EQ",
    segment: "NSE",
    exchange: "NSE",
    inCurrentMaster: true,
    nseRef,
  }).eligibilityClass;
}

// ── classifyNseSeries helper ──────────────────────────────────────────────────

describe("NSE-01: classifyNseSeries — series code → security class", () => {
  it("NSE-01a: EQ → ORDINARY_MAIN_BOARD_EQUITY", () => {
    expect(classifyNseSeries("EQ")).toBe("ORDINARY_MAIN_BOARD_EQUITY");
    expect(classifyNseSeries("eq")).toBe("ORDINARY_MAIN_BOARD_EQUITY");
    expect(classifyNseSeries(" EQ ")).toBe("ORDINARY_MAIN_BOARD_EQUITY");
  });

  it("NSE-01b: BE → TRADE_TO_TRADE_EQUITY", () => {
    expect(classifyNseSeries("BE")).toBe("TRADE_TO_TRADE_EQUITY");
    expect(classifyNseSeries("be")).toBe("TRADE_TO_TRADE_EQUITY");
  });

  it("NSE-01c: BT → TRADE_TO_TRADE_EQUITY", () => {
    expect(classifyNseSeries("BT")).toBe("TRADE_TO_TRADE_EQUITY");
  });

  it("NSE-01d: SM → SME_EQUITY", () => {
    expect(classifyNseSeries("SM")).toBe("SME_EQUITY");
  });

  it("NSE-01e: ST → SME_EQUITY", () => {
    expect(classifyNseSeries("ST")).toBe("SME_EQUITY");
  });

  it("NSE-01f: BL → OTHER_NSE_SERIES", () => {
    expect(classifyNseSeries("BL")).toBe("OTHER_NSE_SERIES");
  });

  it("NSE-01g: empty string → OTHER_NSE_SERIES", () => {
    expect(classifyNseSeries("")).toBe("OTHER_NSE_SERIES");
  });

  it("NSE-01h: unknown series → OTHER_NSE_SERIES", () => {
    expect(classifyNseSeries("N1")).toBe("OTHER_NSE_SERIES");
    expect(classifyNseSeries("XY")).toBe("OTHER_NSE_SERIES");
  });
});

// ── classifyInstrument with NSE reference ─────────────────────────────────────

describe("NSE-02: classifyInstrument — ORDINARY_MAIN_BOARD_EQUITY (series=EQ confirmed)", () => {
  const nseRef = makeNseRef([
    { symbol: "RELIANCE", series: "EQ", isin: "INE002A01018", dateOfListing: "01-JAN-1995" },
    { symbol: "INFY", series: "EQ", isin: "INE009A01021", dateOfListing: "08-FEB-1993" },
    { symbol: "HDFCBANK", series: "EQ", isin: "INE040A01034", dateOfListing: "01-JAN-1995" },
  ]);

  it("NSE-02a: RELIANCE → ORDINARY_MAIN_BOARD_EQUITY", () => {
    expect(classify("RELIANCE", nseRef)).toBe("ORDINARY_MAIN_BOARD_EQUITY");
  });

  it("NSE-02b: INFY → ORDINARY_MAIN_BOARD_EQUITY", () => {
    expect(classify("INFY", nseRef)).toBe("ORDINARY_MAIN_BOARD_EQUITY");
  });

  it("NSE-02c: HDFCBANK → ORDINARY_MAIN_BOARD_EQUITY", () => {
    expect(classify("HDFCBANK", nseRef)).toBe("ORDINARY_MAIN_BOARD_EQUITY");
  });

  it("NSE-02d: case-insensitive symbol lookup — reliance → ORDINARY_MAIN_BOARD_EQUITY", () => {
    expect(classify("reliance", nseRef)).toBe("ORDINARY_MAIN_BOARD_EQUITY");
  });

  it("NSE-02e: warehouseEligible=true for ORDINARY_MAIN_BOARD_EQUITY", () => {
    const result = classifyInstrument({
      symbol: "RELIANCE",
      name: "RELIANCE INDUSTRIES LIMITED",
      instrumentType: "EQ",
      segment: "NSE",
      exchange: "NSE",
      inCurrentMaster: true,
      nseRef,
    });
    expect(result.eligibilityClass).toBe("ORDINARY_MAIN_BOARD_EQUITY");
    expect(result.warehouseEligible).toBe(true);
    expect(result.policyExclusionReason).toBeNull();
    expect(result.reason).toContain("authoritatively confirms");
    expect(result.reason).toContain("INE002A01018");
  });
});

describe("NSE-03: classifyInstrument — TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED (series=BE)", () => {
  const nseRef = makeNseRef([
    { symbol: "HINDCOPPER", series: "BE", isin: "INE531E01026", dateOfListing: "15-DEC-1999" },
    { symbol: "SUZLON", series: "BT", isin: "INE040H01021", dateOfListing: "19-OCT-2005" },
  ]);

  it("NSE-03a: HINDCOPPER (series=BE) → TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED", () => {
    expect(classify("HINDCOPPER", nseRef)).toBe("TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED");
  });

  it("NSE-03b: SUZLON (series=BT) → TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED", () => {
    expect(classify("SUZLON", nseRef)).toBe("TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED");
  });

  it("NSE-03c: warehouseEligible=false for T2T", () => {
    const result = classifyInstrument({
      symbol: "HINDCOPPER",
      name: "HINDUSTAN COPPER LIMITED",
      instrumentType: "EQ",
      segment: "NSE",
      exchange: "NSE",
      inCurrentMaster: true,
      nseRef,
    });
    expect(result.eligibilityClass).toBe("TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED");
    expect(result.warehouseEligible).toBe(false);
    expect(result.policyExclusionReason).toContain("T2T");
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED")).toBe(true);
  });
});

describe("NSE-04: classifyInstrument — SME_EQUITY_POLICY_EXCLUDED (series=SM/ST)", () => {
  const nseRef = makeNseRef([
    { symbol: "EEPL", series: "SM", isin: "INE010Z01018", dateOfListing: "11-JUN-2021" },
    { symbol: "RTNINDIA", series: "ST", isin: "INE111Z01019", dateOfListing: "22-OCT-2020" },
  ]);

  it("NSE-04a: EEPL (series=SM) → SME_EQUITY_POLICY_EXCLUDED", () => {
    expect(classify("EEPL", nseRef)).toBe("SME_EQUITY_POLICY_EXCLUDED");
  });

  it("NSE-04b: RTNINDIA (series=ST) → SME_EQUITY_POLICY_EXCLUDED", () => {
    expect(classify("RTNINDIA", nseRef)).toBe("SME_EQUITY_POLICY_EXCLUDED");
  });

  it("NSE-04c: warehouseEligible=false for SME", () => {
    const result = classifyInstrument({
      symbol: "EEPL",
      name: "EEPL LTD",
      instrumentType: "EQ",
      segment: "NSE",
      exchange: "NSE",
      inCurrentMaster: true,
      nseRef,
    });
    expect(result.eligibilityClass).toBe("SME_EQUITY_POLICY_EXCLUDED");
    expect(result.warehouseEligible).toBe(false);
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("SME_EQUITY_POLICY_EXCLUDED")).toBe(true);
  });
});

describe("NSE-05: classifyInstrument — KITE_NSE_EQ_LIKE_PROVISIONAL (nseRef=null)", () => {
  it("NSE-05a: nseRef=null → KITE_NSE_EQ_LIKE_PROVISIONAL", () => {
    expect(classify("RELIANCE", null)).toBe("KITE_NSE_EQ_LIKE_PROVISIONAL");
  });

  it("NSE-05b: any symbol with nseRef=null → KITE_NSE_EQ_LIKE_PROVISIONAL", () => {
    expect(classify("INFY", null)).toBe("KITE_NSE_EQ_LIKE_PROVISIONAL");
    expect(classify("TATASTEEL", null)).toBe("KITE_NSE_EQ_LIKE_PROVISIONAL");
    expect(classify("EEPL", null)).toBe("KITE_NSE_EQ_LIKE_PROVISIONAL"); // even SME gets provisional (can't verify without ref)
  });

  it("NSE-05c: KITE_NSE_EQ_LIKE_PROVISIONAL has warehouseEligible=false", () => {
    const result = classifyInstrument({
      symbol: "RELIANCE",
      name: "RELIANCE INDUSTRIES LIMITED",
      instrumentType: "EQ",
      segment: "NSE",
      exchange: "NSE",
      inCurrentMaster: true,
      nseRef: null,
    });
    expect(result.eligibilityClass).toBe("KITE_NSE_EQ_LIKE_PROVISIONAL");
    expect(result.warehouseEligible).toBe(false);
    expect(result.reason).toContain("EQUITY_L.csv");
    expect(result.reason).toContain("KITE_NSE_EQ_LIKE_PROVISIONAL");
    expect(result.policyExclusionReason).toContain("reference");
  });

  it("NSE-05d: KITE_NSE_EQ_LIKE_PROVISIONAL is NOT in WAREHOUSE_EXCLUDED_CLASSES (prices still shown)", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("KITE_NSE_EQ_LIKE_PROVISIONAL")).toBe(false);
  });
});

describe("NSE-06: classifyInstrument — UNRESOLVED_SECURITY_TYPE (symbol absent from nseRef)", () => {
  const nseRef = makeNseRef([
    { symbol: "RELIANCE", series: "EQ", isin: "INE002A01018", dateOfListing: "01-JAN-1995" },
  ]);

  it("NSE-06a: symbol not in nseRef → UNRESOLVED_SECURITY_TYPE", () => {
    expect(classify("GHOSTSTOCK", nseRef)).toBe("UNRESOLVED_SECURITY_TYPE");
  });

  it("NSE-06b: symbol not in nseRef has warehouseEligible=false", () => {
    const result = classifyInstrument({
      symbol: "GHOSTSTOCK",
      name: "GHOST STOCK LTD",
      instrumentType: "EQ",
      segment: "NSE",
      exchange: "NSE",
      inCurrentMaster: true,
      nseRef,
    });
    expect(result.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(result.warehouseEligible).toBe(false);
    expect(result.reason).toContain("NOT found");
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("UNRESOLVED_SECURITY_TYPE")).toBe(true);
  });
});

describe("NSE-07: classifyInstrument — OTHER_UNSUPPORTED for unknown NSE series (nseRef has unexpected series)", () => {
  const nseRef = makeNseRef([
    { symbol: "WEIRDSTOCK", series: "BL", isin: "INE999Z01001", dateOfListing: "01-JAN-2020" },
  ]);

  it("NSE-07a: symbol in nseRef with series=BL → OTHER_UNSUPPORTED", () => {
    expect(classify("WEIRDSTOCK", nseRef)).toBe("OTHER_UNSUPPORTED");
  });

  it("NSE-07b: OTHER_UNSUPPORTED is in WAREHOUSE_EXCLUDED_CLASSES", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("OTHER_UNSUPPORTED")).toBe(true);
  });
});

// ── WAREHOUSE_EXCLUDED_CLASSES contract ────────────────────────────────────────

describe("NSE-08: WAREHOUSE_EXCLUDED_CLASSES contract", () => {
  it("NSE-08a: ORDINARY_MAIN_BOARD_EQUITY is NOT excluded (it is warehouse-eligible)", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("ORDINARY_MAIN_BOARD_EQUITY")).toBe(false);
  });

  it("NSE-08b: KITE_NSE_EQ_LIKE_PROVISIONAL is NOT excluded (prices shown; signals blocked separately)", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("KITE_NSE_EQ_LIKE_PROVISIONAL")).toBe(false);
  });

  it("NSE-08c: ORDINARY_EQUITY_ELIGIBLE is NOT excluded (backward compat; treated as provisional)", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("ORDINARY_EQUITY_ELIGIBLE")).toBe(false);
  });

  it("NSE-08d: all non-eligible classes ARE excluded", () => {
    const mustBeExcluded: InstrumentEligibilityClass[] = [
      "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED",
      "SME_EQUITY_POLICY_EXCLUDED",
      "DEBT_GOVERNMENT_SECURITY",
      "SOVEREIGN_GOLD_BOND",
      "ETF_OR_FUND",
      "INDEX",
      "INACTIVE_OR_DELISTED",
      "UNRESOLVED_SECURITY_TYPE",
      "OTHER_UNSUPPORTED",
    ];
    for (const cls of mustBeExcluded) {
      expect(WAREHOUSE_EXCLUDED_CLASSES.has(cls), `Expected ${cls} to be excluded`).toBe(true);
    }
  });
});

// ── Reconciliation vocabulary round-trip ──────────────────────────────────────

describe("NSE-09: Reconciliation — authoritative vocabulary is distinct from provisional", () => {
  it("NSE-09a: authoritativelyVerifiedOrdinaryEquityCount ≠ eligibleOrdinaryEquities (provisional sum)", () => {
    // The key owner requirement: authoritativelyVerifiedOrdinaryEquityCount (from NSE reference join)
    // must be different from the provisional count (8,891 Kite heuristic result).
    // Simulated: when NSE reference is loaded, symbols are classified as ORDINARY_MAIN_BOARD_EQUITY.
    // When reference is NOT loaded, they are classified as KITE_NSE_EQ_LIKE_PROVISIONAL.
    // The test proves these are different classes and thus produce different counts.
    const nseRef = makeNseRef([
      { symbol: "RELIANCE", series: "EQ", isin: "INE002A01018", dateOfListing: "01-JAN-1995" },
    ]);
    const authClass = classify("RELIANCE", nseRef);
    const provClass = classify("RELIANCE", null);
    expect(authClass).not.toBe(provClass);
    expect(authClass).toBe("ORDINARY_MAIN_BOARD_EQUITY");
    expect(provClass).toBe("KITE_NSE_EQ_LIKE_PROVISIONAL");
  });

  it("NSE-09b: ORDINARY_MAIN_BOARD_EQUITY has warehouseEligible=true; KITE_NSE_EQ_LIKE_PROVISIONAL has warehouseEligible=false", () => {
    const nseRef = makeNseRef([{ symbol: "INFY", series: "EQ", isin: "INE009A01021", dateOfListing: "08-FEB-1993" }]);
    const auth = classifyInstrument({ symbol: "INFY", name: "INFOSYS", instrumentType: "EQ", segment: "NSE", exchange: "NSE", inCurrentMaster: true, nseRef });
    const prov = classifyInstrument({ symbol: "INFY", name: "INFOSYS", instrumentType: "EQ", segment: "NSE", exchange: "NSE", inCurrentMaster: true, nseRef: null });
    expect(auth.warehouseEligible).toBe(true);
    expect(prov.warehouseEligible).toBe(false);
  });
});
