/**
 * Canonical instrument eligibility resolver tests.
 *
 * Proves that classifyInstrument() correctly assigns each of the 10 policy
 * categories using ALL available metadata (symbol, name, instrumentType,
 * segment, exchange). Tests cover every category that appeared in the
 * Aug 7 canary batch, plus regression cases.
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

// ─── SDL bonds / Debt Government Securities ───────────────────────────────────

describe("DEBT_GOVERNMENT_SECURITY", () => {
  it("classifies -SG suffix as DEBT_GOVERNMENT_SECURITY (primary: series code)", () => {
    const r = classifyInstrument({ ...BASE, symbol: "656KA30-SG", name: "SDL KA 6.56% 2030" });
    expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
    expect(r.warehouseEligible).toBe(false);
    expect(r.reason).toContain("-SG");
  });

  it("classifies 66GA30A-SG as DEBT_GOVERNMENT_SECURITY", () => {
    const r = classifyInstrument({ ...BASE, symbol: "66GA30A-SG", name: "SDL GA 6.6% 2030" });
    expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
    expect(r.warehouseEligible).toBe(false);
  });

  it("classifies all canary SDL bonds as DEBT_GOVERNMENT_SECURITY", () => {
    const sdlBonds = [
      "66RJ30-SG", "664UP30-SG", "67JK30-SG", "67HR30-SG",
      "667MH31-SG", "679MP33-SG", "677KA34-SG", "685AP36-SG",
      "687AP38-SG", "677WB40-SG", "663GJ29-SG", "684TS40-SG",
      "665KA30-SG", "675KA33-SG", "667UK30-SG", "67ML30-SG",
      "67NL30-SG", "667RJ30-SG", "67TR30-SG", "668UP30-SG",
      "676MP33-SG", "67MH28-SG", "674UP30-SG", "68AS30-SG",
      "674GA30-SG", "67GJ30-SG", "67KA30-SG", "672RJ30-SG",
      "673SK30-SG", "669TN30-SG", "678KA32-SG",
    ];
    for (const sym of sdlBonds) {
      const r = classifyInstrument({ ...BASE, symbol: sym, name: `SDL 6.X% 203X` });
      expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
      expect(r.warehouseEligible).toBe(false);
    }
  });

  it("name-based SDL detection works even without -SG suffix (secondary evidence)", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SDLTEST", name: "SDL GJ 6.7% 2035" });
    expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
  });
});

// ─── Sovereign Gold Bonds ─────────────────────────────────────────────────────

describe("SOVEREIGN_GOLD_BOND", () => {
  it("classifies SGBSEP28VI-GB as SOVEREIGN_GOLD_BOND (-GB suffix + SGB prefix)", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SGBSEP28VI-GB", name: "2.50%GOLDBONDS2028SR-VI" });
    expect(r.eligibilityClass).toBe("SOVEREIGN_GOLD_BOND");
    expect(r.warehouseEligible).toBe(false);
    expect(r.reason).toContain("-GB");
  });

  it("classifies by SGB prefix even without -GB suffix", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SGBAUG32", name: "RBI 2.5% GOLD BOND" });
    expect(r.eligibilityClass).toBe("SOVEREIGN_GOLD_BOND");
  });

  it("classifies by GOLD BOND in name as secondary evidence", () => {
    const r = classifyInstrument({ ...BASE, symbol: "GOLDBOND1", name: "SOVEREIGN GOLD BOND 2030" });
    expect(r.eligibilityClass).toBe("SOVEREIGN_GOLD_BOND");
  });
});

// ─── SME equity ──────────────────────────────────────────────────────────────

describe("SME_EQUITY_POLICY_EXCLUDED", () => {
  it("classifies OMFURN-ST as SME_EQUITY_POLICY_EXCLUDED (ST series)", () => {
    const r = classifyInstrument({ ...BASE, symbol: "OMFURN-ST", name: "OMFURN INDIA" });
    expect(r.eligibilityClass).toBe("SME_EQUITY_POLICY_EXCLUDED");
    expect(r.warehouseEligible).toBe(false);
    expect(r.reason).toContain("ST");
  });

  it("classifies -SM suffix as SME_EQUITY_POLICY_EXCLUDED", () => {
    const r = classifyInstrument({ ...BASE, symbol: "TESTCO-SM", name: "TEST COMPANY" });
    expect(r.eligibilityClass).toBe("SME_EQUITY_POLICY_EXCLUDED");
    expect(r.warehouseEligible).toBe(false);
  });

  it("policyExclusionReason explains SME trading restrictions", () => {
    const r = classifyInstrument({ ...BASE, symbol: "TESTCO-ST", name: "TEST CO" });
    expect(r.policyExclusionReason).toContain("SME");
    expect(r.policyExclusionReason).toContain("liquidity");
  });
});

// ─── BZ series ───────────────────────────────────────────────────────────────

describe("UNRESOLVED_SECURITY_TYPE — BZ series", () => {
  it("classifies SANWARIA-BZ as UNRESOLVED_SECURITY_TYPE (BZ series, NOT blanket non-equity)", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SANWARIA-BZ", name: "SANWARIA CONSUMER" });
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(r.warehouseEligible).toBe(false);
    // Must explain BZ as cross-listed BSZ settlement, not blanket "non-equity"
    expect(r.reason).toContain("BZ");
    expect(r.reason).toContain("NSE");
    expect(r.policyExclusionReason).toContain("OHLCV");
  });

  it("BZ classification does not call symbol 'non-equity'", () => {
    const r = classifyInstrument({ ...BASE, symbol: "ANYSYM-BZ", name: "ANY COMPANY" });
    expect(r.reason.toLowerCase()).not.toContain("non-equity");
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
  });

  it("policyExclusionReason for BZ cites Kite OHLCV coverage gap", () => {
    const r = classifyInstrument({ ...BASE, symbol: "SANWARIA-BZ", name: "SANWARIA" });
    expect(r.policyExclusionReason).toContain("Kite");
    expect(r.policyExclusionReason).toContain("OHLCV");
  });
});

// ─── ETF / Fund ──────────────────────────────────────────────────────────────

describe("ETF_OR_FUND", () => {
  it("classifies LIQUIDBEES as ETF_OR_FUND", () => {
    const r = classifyInstrument({ ...BASE, symbol: "LIQUIDBEES", name: "NIPPON LIQUID BEES ETF" });
    expect(r.eligibilityClass).toBe("ETF_OR_FUND");
    expect(r.warehouseEligible).toBe(false);
  });

  it("classifies NIFTYBEES as ETF_OR_FUND", () => {
    const r = classifyInstrument({ ...BASE, symbol: "NIFTYBEES", name: "NIPPON NIFTY BEES" });
    expect(r.eligibilityClass).toBe("ETF_OR_FUND");
  });

  it("classifies symbol with ETF in name as ETF_OR_FUND", () => {
    const r = classifyInstrument({ ...BASE, symbol: "ICICIETF", name: "ICICI PRUDENTIAL ETF" });
    expect(r.eligibilityClass).toBe("ETF_OR_FUND");
  });
});

// ─── Index ────────────────────────────────────────────────────────────────────

describe("INDEX", () => {
  it("classifies instrument_type=INDEX as INDEX", () => {
    const r = classifyInstrument({ symbol: "NIFTY 50", name: "NIFTY 50", instrumentType: "INDEX", segment: "INDICES", exchange: "NSE" });
    expect(r.eligibilityClass).toBe("INDEX");
    expect(r.warehouseEligible).toBe(false);
  });
});

// ─── Ordinary equity ─────────────────────────────────────────────────────────

describe("ORDINARY_EQUITY_ELIGIBLE", () => {
  it("classifies 21STCENMGM as ORDINARY_EQUITY_ELIGIBLE", () => {
    const r = classifyInstrument({ ...BASE, symbol: "21STCENMGM", name: "21ST CENTURY MGMT SERVICE" });
    expect(r.eligibilityClass).toBe("ORDINARY_EQUITY_ELIGIBLE");
    expect(r.warehouseEligible).toBe(true);
    expect(r.policyExclusionReason).toBeNull();
  });

  it.each([
    ["STYRENIX", "STYRENIX PERFORMANCE"],
    ["ADOR", "ADOR WELDING"],
    ["AEGISLOG", "AEGIS LOGISTICS"],
    ["HAPPSTMNDS", "HAPPIEST MINDS TECHNO"],
    ["ALEMBICLTD", "ALEMBIC"],
    ["ARE&M", "AMARA RAJA ENERGY MOB"],
    ["SHAREINDIA", "SHARE IND. SECURITIES"],
    ["ROUTE", "ROUTE MOBILE"],
    ["ANDHRSUGAR", "ANDHRA SUGARS"],
    ["GODREJAGRO", "GODREJ AGROVET"],
    ["APCOTEXIND", "APCOTEX INDUSTRIES"],
    ["ANDHRAPAP", "ANDHRA PAPER"],
    ["ARENTERP", "RAJDARSHAN INDUSTRIES"],
  ])("classifies %s as ORDINARY_EQUITY_ELIGIBLE", (sym, name) => {
    const r = classifyInstrument({ ...BASE, symbol: sym, name });
    expect(r.eligibilityClass).toBe("ORDINARY_EQUITY_ELIGIBLE");
    expect(r.warehouseEligible).toBe(true);
  });
});

// ─── WAREHOUSE_EXCLUDED_CLASSES ───────────────────────────────────────────────

describe("WAREHOUSE_EXCLUDED_CLASSES contract", () => {
  it("contains all non-equity and policy-excluded classes", () => {
    const expected: InstrumentEligibilityClass[] = [
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
    for (const cls of expected) {
      expect(WAREHOUSE_EXCLUDED_CLASSES.has(cls)).toBe(true);
    }
  });

  it("does NOT exclude ORDINARY_EQUITY_ELIGIBLE", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("ORDINARY_EQUITY_ELIGIBLE")).toBe(false);
  });
});

// ─── Batch API ────────────────────────────────────────────────────────────────

describe("classifyInstrumentBatch", () => {
  it("returns a Map from symbol to result", () => {
    const instruments = [
      { symbol: "RELIANCE", name: "RELIANCE INDUSTRIES", ...BASE },
      { symbol: "656KA30-SG", name: "SDL KA 6.56% 2030", ...BASE },
      { symbol: "OMFURN-ST", name: "OMFURN INDIA", ...BASE },
    ];
    const batch = classifyInstrumentBatch(instruments);
    expect(batch.get("RELIANCE")?.eligibilityClass).toBe("ORDINARY_EQUITY_ELIGIBLE");
    expect(batch.get("656KA30-SG")?.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
    expect(batch.get("OMFURN-ST")?.eligibilityClass).toBe("SME_EQUITY_POLICY_EXCLUDED");
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

describe("summarizeEligibility", () => {
  it("counts eligible and excluded correctly", () => {
    const results = [
      classifyInstrument({ ...BASE, symbol: "RELIANCE", name: "RELIANCE" }),
      classifyInstrument({ ...BASE, symbol: "656KA30-SG", name: "SDL 6% 2030" }),
      classifyInstrument({ ...BASE, symbol: "OMFURN-ST", name: "OMFURN" }),
    ];
    const summary = summarizeEligibility(results);
    expect(summary.eligible).toBe(1);
    expect(summary.excluded).toBe(2);
    expect(summary.byClass["ORDINARY_EQUITY_ELIGIBLE"]).toBe(1);
    expect(summary.byClass["DEBT_GOVERNMENT_SECURITY"]).toBe(1);
    expect(summary.byClass["SME_EQUITY_POLICY_EXCLUDED"]).toBe(1);
  });
});

// ─── Canary 50 overall breakdown ─────────────────────────────────────────────

describe("canary 50 complete classification", () => {
  const canary50 = [
    { symbol: "21STCENMGM", name: "21ST CENTURY MGMT SERVICE" },
    { symbol: "656KA30-SG", name: "SDL KA 6.56% 2030" },
    { symbol: "66RJ30-SG", name: "SDL RJ 6.6% 2030" },
    { symbol: "STYRENIX", name: "STYRENIX PERFORMANCE" },
    { symbol: "66GA30A-SG", name: "SDL GA 6.6% 2030" },
    { symbol: "664UP30-SG", name: "SDL UP 6.64% 2030" },
    { symbol: "67JK30-SG", name: "SDL JK 6.7% 2030" },
    { symbol: "67HR30-SG", name: "SDL HR 6.7% 2030" },
    { symbol: "667MH31-SG", name: "SDL MH 6.67% 2031" },
    { symbol: "679MP33-SG", name: "SDL MP 6.79% 2033" },
    { symbol: "ADOR", name: "ADOR WELDING" },
    { symbol: "677KA34-SG", name: "SDL KA 6.77% 2034" },
    { symbol: "685AP36-SG", name: "SDL AP 6.85% 2036" },
    { symbol: "AEGISLOG", name: "AEGIS LOGISTICS" },
    { symbol: "687AP38-SG", name: "SDL AP 6.87% 2038" },
    { symbol: "677WB40-SG", name: "SDL WB 6.77% 2040" },
    { symbol: "SANWARIA-BZ", name: "SANWARIA CONSUMER" },
    { symbol: "HAPPSTMNDS", name: "HAPPIEST MINDS TECHNO" },
    { symbol: "663GJ29-SG", name: "SDL GJ 6.63% 2029" },
    { symbol: "684TS40-SG", name: "SDL TS 6.84% 2040" },
    { symbol: "665KA30-SG", name: "SDL KA 6.65% 2030" },
    { symbol: "675KA33-SG", name: "SDL KA 6.75% 2033" },
    { symbol: "667UK30-SG", name: "SDL UK 6.67% 2030" },
    { symbol: "ALEMBICLTD", name: "ALEMBIC" },
    { symbol: "67ML30-SG", name: "SDL ML 6.7% 2030" },
    { symbol: "67NL30-SG", name: "SDL NL 6.7% 2030" },
    { symbol: "667RJ30-SG", name: "SDL RJ 6.67% 2030" },
    { symbol: "67TR30-SG", name: "SDL TR 6.7% 2030" },
    { symbol: "668UP30-SG", name: "SDL UP 6.68% 2030" },
    { symbol: "676MP33-SG", name: "SDL MP 6.76% 2033" },
    { symbol: "ARE&M", name: "AMARA RAJA ENERGY MOB" },
    { symbol: "SHAREINDIA", name: "SHARE IND. SECURITIES" },
    { symbol: "OMFURN-ST", name: "OMFURN INDIA" },
    { symbol: "ROUTE", name: "ROUTE MOBILE" },
    { symbol: "ANDHRSUGAR", name: "ANDHRA SUGARS" },
    { symbol: "GODREJAGRO", name: "GODREJ AGROVET" },
    { symbol: "SGBSEP28VI-GB", name: "2.50%GOLDBONDS2028SR-VI" },
    { symbol: "APCOTEXIND", name: "APCOTEX INDUSTRIES" },
    { symbol: "67MH28-SG", name: "SDL MH 6.7% 2028" },
    { symbol: "674UP30-SG", name: "SDL UP 6.74% 2030" },
    { symbol: "68AS30-SG", name: "SDL AS 6.8% 2030" },
    { symbol: "674GA30-SG", name: "SDL GA 6.74% 2030" },
    { symbol: "ANDHRAPAP", name: "ANDHRA PAPER" },
    { symbol: "67GJ30-SG", name: "SDL GJ 6.7% 2030" },
    { symbol: "67KA30-SG", name: "SDL KA 6.7% 2030" },
    { symbol: "672RJ30-SG", name: "SDL RJ 6.72% 2030" },
    { symbol: "673SK30-SG", name: "SDL SK 6.73% 2030" },
    { symbol: "669TN30-SG", name: "SDL TN 6.69% 2030" },
    { symbol: "ARENTERP", name: "RAJDARSHAN INDUSTRIES" },
    { symbol: "678KA32-SG", name: "SDL KA 6.78% 2032" },
  ];

  it("classifies exactly 50 instruments", () => {
    expect(canary50.length).toBe(50);
    const results = canary50.map(i => classifyInstrument({ ...BASE, ...i }));
    expect(results.length).toBe(50);
  });

  it("ORDINARY_EQUITY_ELIGIBLE = 14 genuine equities from canary batch", () => {
    const results = canary50.map(i => classifyInstrument({ ...BASE, ...i }));
    const equities = results.filter(r => r.eligibilityClass === "ORDINARY_EQUITY_ELIGIBLE");
    // 21STCENMGM, STYRENIX, ADOR, AEGISLOG, HAPPSTMNDS, ALEMBICLTD, ARE&M,
    // SHAREINDIA, ROUTE, ANDHRSUGAR, GODREJAGRO, APCOTEXIND, ANDHRAPAP, ARENTERP
    expect(equities.length).toBe(14);
  });

  it("DEBT_GOVERNMENT_SECURITY = 33 SDL bonds from canary batch", () => {
    const results = canary50.map(i => classifyInstrument({ ...BASE, ...i }));
    const bonds = results.filter(r => r.eligibilityClass === "DEBT_GOVERNMENT_SECURITY");
    expect(bonds.length).toBe(33);
  });

  it("SOVEREIGN_GOLD_BOND = 1 (SGBSEP28VI-GB)", () => {
    const results = canary50.map(i => classifyInstrument({ ...BASE, ...i }));
    const gold = results.filter(r => r.eligibilityClass === "SOVEREIGN_GOLD_BOND");
    expect(gold.length).toBe(1);
    expect(gold[0]?.symbol).toBe("SGBSEP28VI-GB");
  });

  it("SME_EQUITY_POLICY_EXCLUDED = 1 (OMFURN-ST)", () => {
    const results = canary50.map(i => classifyInstrument({ ...BASE, ...i }));
    const sme = results.filter(r => r.eligibilityClass === "SME_EQUITY_POLICY_EXCLUDED");
    expect(sme.length).toBe(1);
    expect(sme[0]?.symbol).toBe("OMFURN-ST");
  });

  it("UNRESOLVED_SECURITY_TYPE = 1 (SANWARIA-BZ)", () => {
    const results = canary50.map(i => classifyInstrument({ ...BASE, ...i }));
    const bz = results.filter(r => r.eligibilityClass === "UNRESOLVED_SECURITY_TYPE");
    expect(bz.length).toBe(1);
    expect(bz[0]?.symbol).toBe("SANWARIA-BZ");
  });

  it("total excluded = 36, eligible = 14", () => {
    const results = canary50.map(i => classifyInstrument({ ...BASE, ...i }));
    const summary = summarizeEligibility(results);
    expect(summary.eligible).toBe(14);
    expect(summary.excluded).toBe(36);
    expect(summary.eligible + summary.excluded).toBe(50);
  });
});
