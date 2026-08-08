/**
 * Canonical instrument eligibility resolver tests — Pack 33 Corrective.
 *
 * Proves that classifyInstrument() uses authoritative instrument attributes
 * in explicit precedence order:
 *   1. exchange  2. segment  3. instrument_type  4. series (from tradingsymbol)
 *   5. tradingsymbol  6. ISIN  7. active/delisted status
 *
 * Suffixes are the SERIES CODE in Kite's convention — not a heuristic.
 * Tests cover every category that appeared in the Aug 7 canary batch.
 */

import { describe, it, expect } from "vitest";
import {
  classifyInstrument,
  classifyInstrumentBatch,
  summarizeEligibility,
  WAREHOUSE_EXCLUDED_CLASSES,
  type InstrumentEligibilityClass,
} from "./instrumentEligibility";

const BASE = { instrumentType: "EQ", segment: "NSE", exchange: "NSE" };

// ─── Series-code extraction proof ────────────────────────────────────────────

describe("Series code extraction from tradingsymbol", () => {
  it("extracts series=SG from -SG suffix", () => {
    const r = classifyInstrument({ ...BASE, symbol: "656KA30-SG", name: "SDL KA 6.56% 2030" });
    expect(r.seriesCode).toBe("SG");
    expect(r.precedenceVector).toContain("series=SG");
  });

  it("extracts series=GB from -GB suffix", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SGBSEP28VI-GB", name: "2.50%GOLDBONDS2028SR-VI" });
    expect(r.seriesCode).toBe("GB");
    expect(r.precedenceVector).toContain("series=GB");
  });

  it("extracts series=ST from -ST suffix", () => {
    const r = classifyInstrument({ ...BASE, symbol: "OMFURN-ST", name: "OM FURNITURE" });
    expect(r.seriesCode).toBe("ST");
    expect(r.precedenceVector).toContain("series=ST");
  });

  it("extracts series=BZ from -BZ suffix", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SANWARIA-BZ", name: "SANWARIA CONSUMER" });
    expect(r.seriesCode).toBe("BZ");
    expect(r.precedenceVector).toContain("series=BZ");
  });

  it("returns seriesCode=null for standard equity (no suffix)", () => {
    const r = classifyInstrument({ ...BASE, symbol: "RELIANCE", name: "RELIANCE INDUSTRIES" });
    expect(r.seriesCode).toBeNull();
    expect(r.precedenceVector).toContain("series=EQ");
  });

  it("includes exchange, segment, instrument_type in precedenceVector", () => {
    const r = classifyInstrument({ ...BASE, symbol: "RELIANCE", name: "RELIANCE INDUSTRIES" });
    expect(r.precedenceVector).toContain("exchange=NSE");
    expect(r.precedenceVector).toContain("segment=NSE");
    expect(r.precedenceVector).toContain("instrument_type=EQ");
  });

  it("includes ISIN in precedenceVector when provided", () => {
    const r = classifyInstrument({ ...BASE, symbol: "RELIANCE", name: "RELIANCE", isin: "INE002A01018" });
    expect(r.precedenceVector).toContain("isin=INE002A01018");
  });
});

// ─── INDEX classification ─────────────────────────────────────────────────────

describe("INDEX", () => {
  it("classifies instrumentType=INDEX as INDEX", () => {
    const r = classifyInstrument({ symbol: "NIFTY 50", name: "NIFTY 50", instrumentType: "INDEX", segment: "NSE", exchange: "NSE" });
    expect(r.eligibilityClass).toBe("INDEX");
    expect(r.warehouseEligible).toBe(false);
    expect(r.precedenceVector.some(v => v.includes("INDEX"))).toBe(true);
  });

  it("classifies segment=INDICES as INDEX", () => {
    const r = classifyInstrument({ symbol: "NIFTY 50", name: "NIFTY 50", instrumentType: "EQ", segment: "INDICES", exchange: "NSE" });
    expect(r.eligibilityClass).toBe("INDEX");
    expect(r.warehouseEligible).toBe(false);
  });
});

// ─── DEBT_GOVERNMENT_SECURITY — SDL bonds ─────────────────────────────────────

describe("DEBT_GOVERNMENT_SECURITY", () => {
  it("classifies series=SG as DEBT_GOVERNMENT_SECURITY (primary: series code)", () => {
    const r = classifyInstrument({ ...BASE, symbol: "656KA30-SG", name: "SDL KA 6.56% 2030" });
    expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
    expect(r.warehouseEligible).toBe(false);
    expect(r.seriesCode).toBe("SG");
    expect(r.reason).toContain("series=SG");
    // Name corroboration appears in reason
    expect(r.reason).toContain("SDL");
  });

  it("classifies 66GA30A-SG as DEBT_GOVERNMENT_SECURITY", () => {
    const r = classifyInstrument({ ...BASE, symbol: "66GA30A-SG", name: "SDL GA 6.6% 2030" });
    expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
    expect(r.warehouseEligible).toBe(false);
    expect(r.seriesCode).toBe("SG");
  });

  it("classifies all 33 canary SDL bonds as DEBT_GOVERNMENT_SECURITY", () => {
    const sdlBonds = [
      "656KA30-SG", "66RJ30-SG", "66GA30A-SG", "664UP30-SG", "67JK30-SG",
      "67HR30-SG", "667MH31-SG", "679MP33-SG", "677KA34-SG", "685AP36-SG",
      "687AP38-SG", "677WB40-SG", "663GJ29-SG", "684TS40-SG", "665KA30-SG",
      "675KA33-SG", "667UK30-SG", "67ML30-SG", "67NL30-SG", "667RJ30-SG",
      "67TR30-SG", "668UP30-SG", "676MP33-SG", "67MH28-SG", "674UP30-SG",
      "68AS30-SG", "674GA30-SG", "67GJ30-SG", "67KA30-SG", "672RJ30-SG",
      "673SK30-SG", "669TN30-SG", "678KA32-SG",
    ];
    expect(sdlBonds.length).toBe(33); // exact canary count
    for (const sym of sdlBonds) {
      const r = classifyInstrument({ ...BASE, symbol: sym, name: "SDL 6.X% 203X" });
      expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
      expect(r.warehouseEligible).toBe(false);
      expect(r.seriesCode).toBe("SG");
    }
  });

  it("name-based SDL detection works even without -SG suffix (secondary evidence)", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SDLTEST", name: "SDL GJ 6.7% 2035" });
    expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
  });

  it("policyExclusionReason mentions equity endpoint for Kite master-data artifact", () => {
    const r = classifyInstrument({ ...BASE, symbol: "656KA30-SG", name: "SDL KA 6.56% 2030" });
    expect(r.policyExclusionReason).toBeTruthy();
    expect(r.policyExclusionReason).toContain("Kite");
  });
});

// ─── SOVEREIGN_GOLD_BOND ──────────────────────────────────────────────────────

describe("SOVEREIGN_GOLD_BOND", () => {
  it("classifies series=GB as SOVEREIGN_GOLD_BOND (primary: series code)", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SGBSEP28VI-GB", name: "2.50%GOLDBONDS2028SR-VI" });
    expect(r.eligibilityClass).toBe("SOVEREIGN_GOLD_BOND");
    expect(r.warehouseEligible).toBe(false);
    expect(r.seriesCode).toBe("GB");
    expect(r.reason).toContain("series=GB");
  });

  it("classifies by SGB prefix + gold bond name even without -GB suffix", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SGBAUG32", name: "RBI 2.5% GOLD BOND" });
    expect(r.eligibilityClass).toBe("SOVEREIGN_GOLD_BOND");
  });
});

// ─── SME_EQUITY_POLICY_EXCLUDED ───────────────────────────────────────────────

describe("SME_EQUITY_POLICY_EXCLUDED", () => {
  it("classifies OMFURN-ST as SME_EQUITY_POLICY_EXCLUDED (series=ST)", () => {
    const r = classifyInstrument({ ...BASE, symbol: "OMFURN-ST", name: "OM FURNITURE" });
    expect(r.eligibilityClass).toBe("SME_EQUITY_POLICY_EXCLUDED");
    expect(r.warehouseEligible).toBe(false);
    expect(r.seriesCode).toBe("ST");
    expect(r.reason).toContain("series=ST");
  });

  it("classifies series=SM as SME_EQUITY_POLICY_EXCLUDED", () => {
    const r = classifyInstrument({ ...BASE, symbol: "ANYSME-SM", name: "SME COMPANY" });
    expect(r.eligibilityClass).toBe("SME_EQUITY_POLICY_EXCLUDED");
    expect(r.seriesCode).toBe("SM");
    expect(r.reason).toContain("series=SM");
  });

  it("excludes SME from WAREHOUSE_EXCLUDED_CLASSES", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("SME_EQUITY_POLICY_EXCLUDED")).toBe(true);
  });
});

// ─── UNRESOLVED_SECURITY_TYPE — BZ series ────────────────────────────────────

describe("UNRESOLVED_SECURITY_TYPE — BZ series", () => {
  it("classifies SANWARIA-BZ as UNRESOLVED_SECURITY_TYPE (series=BZ)", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SANWARIA-BZ", name: "SANWARIA CONSUMER" });
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(r.warehouseEligible).toBe(false);
    expect(r.seriesCode).toBe("BZ");
    expect(r.reason).toContain("series=BZ");
  });

  it("BZ classification does not call the security 'non-equity'", () => {
    const r = classifyInstrument({ ...BASE, symbol: "ANYSYM-BZ", name: "ANY COMPANY" });
    expect(r.reason.toLowerCase()).not.toContain("non-equity");
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
  });

  it("BZ is in WAREHOUSE_EXCLUDED_CLASSES", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("UNRESOLVED_SECURITY_TYPE")).toBe(true);
  });

  it("BZ reason mentions unreliable OHLCV coverage", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SANWARIA-BZ", name: "SANWARIA CONSUMER" });
    expect(r.reason.toLowerCase()).toContain("unreliable");
  });

  it("BZ policyExclusionReason references Kite endpoint", () => {
    const r = classifyInstrument({ ...BASE, symbol: "ANYSYM-BZ", name: "ANY COMPANY" });
    expect(r.policyExclusionReason).toBeTruthy();
    expect(r.policyExclusionReason).toContain("Kite");
  });
});

// ─── ORDINARY_EQUITY_ELIGIBLE ─────────────────────────────────────────────────

describe("ORDINARY_EQUITY_ELIGIBLE", () => {
  const CANARY_EQUITIES = [
    { symbol: "21STCENMGM", name: "21ST CENTURY MGMT SERVICE" },
    { symbol: "STYRENIX",   name: "STYRENIX PERFORMANCE" },
    { symbol: "ADOR",       name: "ADOR WELDING" },
    { symbol: "AEGISLOG",   name: "AEGIS LOGISTICS" },
    { symbol: "HAPPSTMNDS", name: "HAPPIEST MINDS" },
    { symbol: "ALEMBICLTD", name: "ALEMBIC" },
    { symbol: "ARE&M",      name: "AMARA RAJA ENERGY MOB" },
    { symbol: "SHAREINDIA", name: "SHARE IND. SECURITIES" },
    { symbol: "ROUTE",      name: "ROUTE MOBILE" },
    { symbol: "ANDHRSUGAR", name: "ANDHRA SUGARS" },
    { symbol: "GODREJAGRO", name: "GODREJ AGROVET" },
    { symbol: "APCOTEXIND", name: "APCOTEX INDUSTRIES" },
    { symbol: "ANDHRAPAP",  name: "ANDHRA PAPER" },
    { symbol: "ARENTERP",   name: "RAJDARSHAN INDUSTRIES" },
  ];

  it("classifies all 14 canary plain-EQ symbols as ORDINARY_EQUITY_ELIGIBLE", () => {
    expect(CANARY_EQUITIES.length).toBe(14);
    for (const { symbol, name } of CANARY_EQUITIES) {
      const r = classifyInstrument({ ...BASE, symbol, name });
      expect(r.eligibilityClass).toBe("ORDINARY_EQUITY_ELIGIBLE");
      expect(r.warehouseEligible).toBe(true);
      expect(r.seriesCode).toBeNull(); // no suffix
      expect(r.policyExclusionReason).toBeNull();
    }
  });

  it("RELIANCE is ORDINARY_EQUITY_ELIGIBLE", () => {
    const r = classifyInstrument({ ...BASE, symbol: "RELIANCE", name: "RELIANCE INDUSTRIES" });
    expect(r.eligibilityClass).toBe("ORDINARY_EQUITY_ELIGIBLE");
    expect(r.warehouseEligible).toBe(true);
  });
});

// ─── INACTIVE_OR_DELISTED ─────────────────────────────────────────────────────

describe("INACTIVE_OR_DELISTED", () => {
  it("is in WAREHOUSE_EXCLUDED_CLASSES", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("INACTIVE_OR_DELISTED")).toBe(true);
  });
});

// ─── ETF_OR_FUND ─────────────────────────────────────────────────────────────

describe("ETF_OR_FUND", () => {
  it("classifies NIFTYBEES as ETF_OR_FUND", () => {
    const r = classifyInstrument({ ...BASE, symbol: "NIFTYBEES", name: "NIFTY BEES ETF" });
    expect(r.eligibilityClass).toBe("ETF_OR_FUND");
    expect(r.warehouseEligible).toBe(false);
  });

  it("ETF_OR_FUND is in WAREHOUSE_EXCLUDED_CLASSES", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("ETF_OR_FUND")).toBe(true);
  });
});

// ─── Complete canary 50 eligibility breakdown ─────────────────────────────────

describe("Canary 50 eligibility summary", () => {
  const ALL_50 = [
    // 14 ordinary equities
    { symbol: "21STCENMGM", name: "21ST CENTURY MGMT SERVICE" },
    { symbol: "STYRENIX",   name: "STYRENIX PERFORMANCE" },
    { symbol: "ADOR",       name: "ADOR WELDING" },
    { symbol: "AEGISLOG",   name: "AEGIS LOGISTICS" },
    { symbol: "HAPPSTMNDS", name: "HAPPIEST MINDS" },
    { symbol: "ALEMBICLTD", name: "ALEMBIC" },
    { symbol: "ARE&M",      name: "AMARA RAJA ENERGY MOB" },
    { symbol: "SHAREINDIA", name: "SHARE IND. SECURITIES" },
    { symbol: "ROUTE",      name: "ROUTE MOBILE" },
    { symbol: "ANDHRSUGAR", name: "ANDHRA SUGARS" },
    { symbol: "GODREJAGRO", name: "GODREJ AGROVET" },
    { symbol: "APCOTEXIND", name: "APCOTEX INDUSTRIES" },
    { symbol: "ANDHRAPAP",  name: "ANDHRA PAPER" },
    { symbol: "ARENTERP",   name: "RAJDARSHAN INDUSTRIES" },
    // 33 SDL bonds
    { symbol: "656KA30-SG",  name: "SDL KA 6.56% 2030" },
    { symbol: "66RJ30-SG",   name: "SDL RJ 6.6% 2030" },
    { symbol: "66GA30A-SG",  name: "SDL GA 6.6% 2030" },
    { symbol: "664UP30-SG",  name: "SDL UP 6.64% 2030" },
    { symbol: "67JK30-SG",   name: "SDL JK 6.7% 2030" },
    { symbol: "67HR30-SG",   name: "SDL HR 6.7% 2030" },
    { symbol: "667MH31-SG",  name: "SDL MH 6.67% 2031" },
    { symbol: "679MP33-SG",  name: "SDL MP 6.79% 2033" },
    { symbol: "677KA34-SG",  name: "SDL KA 6.77% 2034" },
    { symbol: "685AP36-SG",  name: "SDL AP 6.85% 2036" },
    { symbol: "687AP38-SG",  name: "SDL AP 6.87% 2038" },
    { symbol: "677WB40-SG",  name: "SDL WB 6.77% 2040" },
    { symbol: "663GJ29-SG",  name: "SDL GJ 6.63% 2029" },
    { symbol: "684TS40-SG",  name: "SDL TS 6.84% 2040" },
    { symbol: "665KA30-SG",  name: "SDL KA 6.65% 2030" },
    { symbol: "675KA33-SG",  name: "SDL KA 6.75% 2033" },
    { symbol: "667UK30-SG",  name: "SDL UK 6.67% 2030" },
    { symbol: "67ML30-SG",   name: "SDL ML 6.7% 2030" },
    { symbol: "67NL30-SG",   name: "SDL NL 6.7% 2030" },
    { symbol: "667RJ30-SG",  name: "SDL RJ 6.67% 2030" },
    { symbol: "67TR30-SG",   name: "SDL TR 6.7% 2030" },
    { symbol: "668UP30-SG",  name: "SDL UP 6.68% 2030" },
    { symbol: "676MP33-SG",  name: "SDL MP 6.76% 2033" },
    { symbol: "67MH28-SG",   name: "SDL MH 6.7% 2028" },
    { symbol: "674UP30-SG",  name: "SDL UP 6.74% 2030" },
    { symbol: "68AS30-SG",   name: "SDL AS 6.8% 2030" },
    { symbol: "674GA30-SG",  name: "SDL GA 6.74% 2030" },
    { symbol: "67GJ30-SG",   name: "SDL GJ 6.7% 2030" },
    { symbol: "67KA30-SG",   name: "SDL KA 6.7% 2030" },
    { symbol: "672RJ30-SG",  name: "SDL RJ 6.72% 2030" },
    { symbol: "673SK30-SG",  name: "SDL SK 6.73% 2030" },
    { symbol: "669TN30-SG",  name: "SDL TN 6.69% 2030" },
    { symbol: "678KA32-SG",  name: "SDL KA 6.78% 2032" },
    // 1 SGB
    { symbol: "SGBSEP28VI-GB", name: "2.50%GOLDBONDS2028SR-VI" },
    // 1 SME-ST
    { symbol: "OMFURN-ST",     name: "OM FURNITURE" },
    // 1 BZ (UNRESOLVED)
    { symbol: "SANWARIA-BZ",   name: "SANWARIA CONSUMER" },
  ];

  it("50-symbol canary has exactly 14 ORDINARY_EQUITY_ELIGIBLE", () => {
    const results = ALL_50.map(inst => classifyInstrument({ ...BASE, ...inst }));
    const eligible = results.filter(r => r.eligibilityClass === "ORDINARY_EQUITY_ELIGIBLE");
    expect(eligible.length).toBe(14);
  });

  it("50-symbol canary has exactly 33 DEBT_GOVERNMENT_SECURITY", () => {
    const results = ALL_50.map(inst => classifyInstrument({ ...BASE, ...inst }));
    const debt = results.filter(r => r.eligibilityClass === "DEBT_GOVERNMENT_SECURITY");
    expect(debt.length).toBe(33);
  });

  it("50-symbol canary has exactly 1 SOVEREIGN_GOLD_BOND", () => {
    const results = ALL_50.map(inst => classifyInstrument({ ...BASE, ...inst }));
    const sgb = results.filter(r => r.eligibilityClass === "SOVEREIGN_GOLD_BOND");
    expect(sgb.length).toBe(1);
    expect(sgb[0]!.symbol).toBe("SGBSEP28VI-GB");
  });

  it("50-symbol canary has exactly 1 SME_EQUITY_POLICY_EXCLUDED", () => {
    const results = ALL_50.map(inst => classifyInstrument({ ...BASE, ...inst }));
    const sme = results.filter(r => r.eligibilityClass === "SME_EQUITY_POLICY_EXCLUDED");
    expect(sme.length).toBe(1);
    expect(sme[0]!.symbol).toBe("OMFURN-ST");
  });

  it("50-symbol canary has exactly 1 UNRESOLVED_SECURITY_TYPE", () => {
    const results = ALL_50.map(inst => classifyInstrument({ ...BASE, ...inst }));
    const bz = results.filter(r => r.eligibilityClass === "UNRESOLVED_SECURITY_TYPE");
    expect(bz.length).toBe(1);
    expect(bz[0]!.symbol).toBe("SANWARIA-BZ");
  });

  it("warehouseEligible=true only for 14 ORDINARY_EQUITY_ELIGIBLE", () => {
    const results = ALL_50.map(inst => classifyInstrument({ ...BASE, ...inst }));
    const eligible = results.filter(r => r.warehouseEligible);
    expect(eligible.length).toBe(14);
    for (const r of eligible) {
      expect(r.eligibilityClass).toBe("ORDINARY_EQUITY_ELIGIBLE");
    }
  });

  it("summarizeEligibility returns correct totals for canary 50", () => {
    const results = ALL_50.map(inst => classifyInstrument({ ...BASE, ...inst }));
    const summary = summarizeEligibility(results);
    expect(summary.eligible).toBe(14);
    expect(summary.excluded).toBe(36);
    expect(summary.byClass.DEBT_GOVERNMENT_SECURITY).toBe(33);
    expect(summary.byClass.SOVEREIGN_GOLD_BOND).toBe(1);
    expect(summary.byClass.SME_EQUITY_POLICY_EXCLUDED).toBe(1);
    expect(summary.byClass.UNRESOLVED_SECURITY_TYPE).toBe(1);
  });
});

// ─── classifyInstrumentBatch ──────────────────────────────────────────────────

describe("classifyInstrumentBatch", () => {
  it("returns a Map keyed by symbol", () => {
    const batch = classifyInstrumentBatch([
      { ...BASE, symbol: "RELIANCE", name: "RELIANCE INDUSTRIES" },
      { ...BASE, symbol: "656KA30-SG", name: "SDL KA 6.56% 2030" },
    ]);
    expect(batch.size).toBe(2);
    expect(batch.get("RELIANCE")?.eligibilityClass).toBe("ORDINARY_EQUITY_ELIGIBLE");
    expect(batch.get("656KA30-SG")?.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
  });
});

// ─── WAREHOUSE_EXCLUDED_CLASSES completeness ──────────────────────────────────

describe("WAREHOUSE_EXCLUDED_CLASSES", () => {
  const SHOULD_BE_EXCLUDED: InstrumentEligibilityClass[] = [
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

  it("contains all non-eligible classes", () => {
    for (const cls of SHOULD_BE_EXCLUDED) {
      expect(WAREHOUSE_EXCLUDED_CLASSES.has(cls)).toBe(true);
    }
  });

  it("does not contain ORDINARY_EQUITY_ELIGIBLE", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("ORDINARY_EQUITY_ELIGIBLE")).toBe(false);
  });
});
