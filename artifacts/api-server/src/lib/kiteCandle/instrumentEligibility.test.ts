/**
 * Canonical instrument eligibility resolver tests — Pack 33 Corrective R2.
 *
 * Key design contracts proven here:
 *   1. Instruments absent from the Kite master → UNRESOLVED_SECURITY_TYPE regardless of suffix
 *   2. ORDINARY_EQUITY_ELIGIBLE requires affirmative evidence (inCurrentMaster=true + EQ + NSE)
 *   3. Suffix-based signals are supporting evidence for instruments IN the master, not authority
 *   4. Missing/conflicting metadata fails closed as UNRESOLVED_SECURITY_TYPE
 *   5. OMFURN-ST (absent from Kite master) → UNRESOLVED, not SME_EQUITY_POLICY_EXCLUDED
 *   6. SDL bond (in master, suffix=SG) → DEBT_GOVERNMENT_SECURITY
 *   7. SGB (in master, suffix=GB) → SOVEREIGN_GOLD_BOND
 *   8. SME-ST (in master, suffix=ST) → SME_EQUITY_POLICY_EXCLUDED
 *   9. BZ (in master, suffix=BZ) → UNRESOLVED_SECURITY_TYPE
 */

import { describe, it, expect } from "vitest";
import {
  classifyInstrument,
  classifyInstrumentBatch,
  summarizeEligibility,
  WAREHOUSE_EXCLUDED_CLASSES,
  type InstrumentEligibilityClass,
} from "./instrumentEligibility";

/** Base attributes for a standard NSE EQ instrument present in the Kite master. */
const MASTER_EQ = { instrumentType: "EQ", segment: "NSE", exchange: "NSE", inCurrentMaster: true };
/** Base attributes for an instrument NOT in the Kite master. */
const NOT_IN_MASTER = { instrumentType: "EQ", segment: "NSE", exchange: "NSE", inCurrentMaster: false };

// ─── 1. Authoritative source requirement ─────────────────────────────────────

describe("Authoritative source requirement — inCurrentMaster=false fails closed", () => {
  it("OMFURN-ST absent from master → UNRESOLVED_SECURITY_TYPE (NOT SME_EQUITY_POLICY_EXCLUDED)", () => {
    // OMFURN-ST has NOT_FOUND token in Kite cache → inCurrentMaster=false
    const r = classifyInstrument({ ...NOT_IN_MASTER, symbol: "OMFURN-ST", name: "OM FURNITURE" });
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(r.warehouseEligible).toBe(false);
    expect(r.inCurrentMaster).toBe(false);
    // Must NOT be SME — the suffix cannot independently authorize that classification
    expect(r.eligibilityClass).not.toBe("SME_EQUITY_POLICY_EXCLUDED");
    expect(r.reason).toContain("inCurrentMaster=false");
    expect(r.reason).toContain("cannot independently");
  });

  it("any -SG suffix absent from master → UNRESOLVED (not DEBT_GOVERNMENT_SECURITY)", () => {
    const r = classifyInstrument({ ...NOT_IN_MASTER, symbol: "FAKETEST-SG", name: "SDL FAKE 2030" });
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(r.eligibilityClass).not.toBe("DEBT_GOVERNMENT_SECURITY");
  });

  it("any -GB suffix absent from master → UNRESOLVED (not SOVEREIGN_GOLD_BOND)", () => {
    const r = classifyInstrument({ ...NOT_IN_MASTER, symbol: "FAKEGB-GB", name: "GOLD BOND 2030" });
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(r.eligibilityClass).not.toBe("SOVEREIGN_GOLD_BOND");
  });

  it("any -BZ suffix absent from master → UNRESOLVED (decision is ABSENT_FROM_MASTER, not BZ_SERIES)", () => {
    const r = classifyInstrument({ ...NOT_IN_MASTER, symbol: "FAKEBZ-BZ", name: "SOME COMPANY" });
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(r.precedenceVector).toContain("decision=UNRESOLVED_BY_ABSENT_FROM_MASTER");
  });

  it("plain EQ symbol absent from master → UNRESOLVED (not ORDINARY_EQUITY_ELIGIBLE)", () => {
    const r = classifyInstrument({ ...NOT_IN_MASTER, symbol: "GHOSTCO", name: "GHOST COMPANY" });
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(r.warehouseEligible).toBe(false);
    expect(r.policyExclusionReason).toContain("instrument_token");
  });

  it("inCurrentMaster field is preserved in result", () => {
    const r = classifyInstrument({ ...NOT_IN_MASTER, symbol: "GHOSTCO", name: "GHOST COMPANY" });
    expect(r.inCurrentMaster).toBe(false);
    const r2 = classifyInstrument({ ...MASTER_EQ, symbol: "RELIANCE", name: "RELIANCE" });
    expect(r2.inCurrentMaster).toBe(true);
  });

  it("precedenceVector starts with inCurrentMaster=false", () => {
    const r = classifyInstrument({ ...NOT_IN_MASTER, symbol: "GHOSTCO", name: "GHOST" });
    expect(r.precedenceVector[0]).toBe("inCurrentMaster=false");
  });
});

// ─── 2. ORDINARY_EQUITY_ELIGIBLE requires affirmative evidence ────────────────

describe("ORDINARY_EQUITY_ELIGIBLE — affirmative evidence requirement", () => {
  it("in master + exchange=NSE + segment=NSE + instrument_type=EQ → ORDINARY_EQUITY_ELIGIBLE", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "RELIANCE", name: "RELIANCE INDUSTRIES" });
    expect(r.eligibilityClass).toBe("ORDINARY_EQUITY_ELIGIBLE");
    expect(r.warehouseEligible).toBe(true);
    expect(r.policyExclusionReason).toBeNull();
    expect(r.seriesCode).toBeNull();
  });

  it("in master but instrument_type=FUT → OTHER_UNSUPPORTED (not EQ)", () => {
    const r = classifyInstrument({
      symbol: "RELIANCE", name: "RELIANCE INDUSTRIES",
      instrumentType: "FUT", segment: "NSE", exchange: "NSE", inCurrentMaster: true,
    });
    expect(r.eligibilityClass).toBe("OTHER_UNSUPPORTED");
    expect(r.warehouseEligible).toBe(false);
  });

  it("in master but segment=NSE-SME → OTHER_UNSUPPORTED (not NSE main-board)", () => {
    const r = classifyInstrument({
      symbol: "SOMESME", name: "SOME SME CO",
      instrumentType: "EQ", segment: "NSE-SME", exchange: "NSE", inCurrentMaster: true,
    });
    expect(r.eligibilityClass).toBe("OTHER_UNSUPPORTED");
    expect(r.warehouseEligible).toBe(false);
  });

  it("in master but exchange=BSE → OTHER_UNSUPPORTED", () => {
    const r = classifyInstrument({
      symbol: "BSECO", name: "BSE ONLY CO",
      instrumentType: "EQ", segment: "BSE", exchange: "BSE", inCurrentMaster: true,
    });
    expect(r.eligibilityClass).toBe("OTHER_UNSUPPORTED");
    expect(r.warehouseEligible).toBe(false);
  });
});

// ─── 3. Suffix signals are supporting evidence for in-master instruments ─────

describe("Suffix signals — supporting evidence only, not independent authority", () => {
  it("suffix=SG on in-master instrument → DEBT_GOVERNMENT_SECURITY (supported by SDL name)", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "656KA30-SG", name: "SDL KA 6.56% 2030" });
    expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
    expect(r.seriesCode).toBe("SG");
    expect(r.reason).toContain("suffix=SG");
    expect(r.reason).toContain("Kite master tradingsymbol");
  });

  it("suffix=GB on in-master instrument → SOVEREIGN_GOLD_BOND", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "SGBSEP28VI-GB", name: "2.50%GOLDBONDS2028SR-VI" });
    expect(r.eligibilityClass).toBe("SOVEREIGN_GOLD_BOND");
    expect(r.seriesCode).toBe("GB");
    expect(r.reason).toContain("suffix=GB");
    expect(r.reason).toContain("Kite master tradingsymbol");
  });

  it("suffix=ST on in-master instrument → SME_EQUITY_POLICY_EXCLUDED", () => {
    // This is DIFFERENT from OMFURN-ST (absent from master)
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "SOMESME-ST", name: "SME TRADING CO" });
    expect(r.eligibilityClass).toBe("SME_EQUITY_POLICY_EXCLUDED");
    expect(r.seriesCode).toBe("ST");
    expect(r.reason).toContain("suffix=ST");
    expect(r.reason).toContain("Kite master tradingsymbol");
  });

  it("suffix=SM on in-master instrument → SME_EQUITY_POLICY_EXCLUDED", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "ANYSME-SM", name: "SME COMPANY" });
    expect(r.eligibilityClass).toBe("SME_EQUITY_POLICY_EXCLUDED");
    expect(r.seriesCode).toBe("SM");
  });

  it("suffix=BZ on in-master instrument → UNRESOLVED_SECURITY_TYPE (BZ reason, not absent-from-master reason)", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "SANWARIA-BZ", name: "SANWARIA CONSUMER" });
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(r.seriesCode).toBe("BZ");
    expect(r.precedenceVector).toContain("decision=UNRESOLVED_SECURITY_TYPE_BY_BZ_SERIES");
    // NOT the absent-from-master reason
    expect(r.precedenceVector).not.toContain("decision=UNRESOLVED_BY_ABSENT_FROM_MASTER");
  });

  it("seriesCode=null for standard EQ (no suffix)", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "RELIANCE", name: "RELIANCE INDUSTRIES" });
    expect(r.seriesCode).toBeNull();
    expect(r.precedenceVector).toContain("suffix=(none)");
  });
});

// ─── 4. DEBT_GOVERNMENT_SECURITY — SDL bonds (in master) ─────────────────────

describe("DEBT_GOVERNMENT_SECURITY — SDL bonds confirmed by master record", () => {
  it("classifies all 33 canary SDL bonds as DEBT_GOVERNMENT_SECURITY (in master)", () => {
    const sdlBonds = [
      "656KA30-SG", "66RJ30-SG", "66GA30A-SG", "664UP30-SG", "67JK30-SG",
      "67HR30-SG", "667MH31-SG", "679MP33-SG", "677KA34-SG", "685AP36-SG",
      "687AP38-SG", "677WB40-SG", "663GJ29-SG", "684TS40-SG", "665KA30-SG",
      "675KA33-SG", "667UK30-SG", "67ML30-SG", "67NL30-SG", "667RJ30-SG",
      "67TR30-SG", "668UP30-SG", "676MP33-SG", "67MH28-SG", "674UP30-SG",
      "68AS30-SG", "674GA30-SG", "67GJ30-SG", "67KA30-SG", "672RJ30-SG",
      "673SK30-SG", "669TN30-SG", "678KA32-SG",
    ];
    expect(sdlBonds.length).toBe(33);
    for (const sym of sdlBonds) {
      const r = classifyInstrument({ ...MASTER_EQ, symbol: sym, name: "SDL 6.X% 203X" });
      expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
      expect(r.warehouseEligible).toBe(false);
      expect(r.seriesCode).toBe("SG");
      expect(r.inCurrentMaster).toBe(true);
    }
  });

  it("SDL name pattern (no -SG suffix, in master) → DEBT_GOVERNMENT_SECURITY", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "SDLTEST", name: "SDL GJ 6.7% 2035" });
    expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
  });

  it("policyExclusionReason mentions Kite equity endpoint producing empty OHLCV", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "656KA30-SG", name: "SDL KA 6.56% 2030" });
    expect(r.policyExclusionReason).toBeTruthy();
    expect(r.policyExclusionReason).toContain("Kite");
    expect(r.policyExclusionReason).toContain("OHLCV");
  });
});

// ─── 5. SOVEREIGN_GOLD_BOND (in master) ──────────────────────────────────────

describe("SOVEREIGN_GOLD_BOND — confirmed by master record", () => {
  it("SGBSEP28VI-GB in master → SOVEREIGN_GOLD_BOND", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "SGBSEP28VI-GB", name: "2.50%GOLDBONDS2028SR-VI" });
    expect(r.eligibilityClass).toBe("SOVEREIGN_GOLD_BOND");
    expect(r.seriesCode).toBe("GB");
    expect(r.warehouseEligible).toBe(false);
    expect(r.inCurrentMaster).toBe(true);
  });

  it("SGB prefix + gold bond name (no -GB suffix, in master) → SOVEREIGN_GOLD_BOND", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "SGBAUG32", name: "RBI 2.5% GOLD BOND" });
    expect(r.eligibilityClass).toBe("SOVEREIGN_GOLD_BOND");
  });
});

// ─── 6. INDEX classification ──────────────────────────────────────────────────

describe("INDEX", () => {
  it("instrument_type=INDEX + in master → INDEX", () => {
    const r = classifyInstrument({ symbol: "NIFTY 50", name: "NIFTY 50", instrumentType: "INDEX", segment: "NSE", exchange: "NSE", inCurrentMaster: true });
    expect(r.eligibilityClass).toBe("INDEX");
    expect(r.warehouseEligible).toBe(false);
  });

  it("segment=INDICES + in master → INDEX", () => {
    const r = classifyInstrument({ symbol: "NIFTY 50", name: "NIFTY 50", instrumentType: "EQ", segment: "INDICES", exchange: "NSE", inCurrentMaster: true });
    expect(r.eligibilityClass).toBe("INDEX");
  });
});

// ─── 7. ETF_OR_FUND (in master) ───────────────────────────────────────────────

describe("ETF_OR_FUND — in master", () => {
  it("NIFTYBEES in master → ETF_OR_FUND", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "NIFTYBEES", name: "NIFTY BEES ETF" });
    expect(r.eligibilityClass).toBe("ETF_OR_FUND");
    expect(r.warehouseEligible).toBe(false);
  });

  it("ETF_OR_FUND is excluded", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("ETF_OR_FUND")).toBe(true);
  });
});

// ─── 8. UNRESOLVED — BZ is in excluded set with correct decision code ─────────

describe("UNRESOLVED_SECURITY_TYPE — BZ in master", () => {
  it("BZ reason does not use 'non-equity' language", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "SANWARIA-BZ", name: "SANWARIA CONSUMER" });
    expect(r.reason.toLowerCase()).not.toContain("non-equity");
  });

  it("BZ policyExclusionReason references Kite endpoint and OHLCV", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "SANWARIA-BZ", name: "SANWARIA CONSUMER" });
    expect(r.policyExclusionReason).toContain("Kite");
    expect(r.policyExclusionReason).toContain("OHLCV");
  });

  it("UNRESOLVED_SECURITY_TYPE is in WAREHOUSE_EXCLUDED_CLASSES", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("UNRESOLVED_SECURITY_TYPE")).toBe(true);
  });
});

// ─── 9. Canary 50 exact breakdown ─────────────────────────────────────────────

describe("Canary 50 exact eligibility breakdown — inCurrentMaster based on Kite cache 2026-08-08", () => {
  // 14 standard EQ symbols present in Kite master
  const IN_MASTER_EQUITIES = [
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

  // 33 SDL bonds present in Kite master (suffix=SG)
  const IN_MASTER_SDL = [
    "656KA30-SG", "66RJ30-SG", "66GA30A-SG", "664UP30-SG", "67JK30-SG",
    "67HR30-SG", "667MH31-SG", "679MP33-SG", "677KA34-SG", "685AP36-SG",
    "687AP38-SG", "677WB40-SG", "663GJ29-SG", "684TS40-SG", "665KA30-SG",
    "675KA33-SG", "667UK30-SG", "67ML30-SG", "67NL30-SG", "667RJ30-SG",
    "67TR30-SG", "668UP30-SG", "676MP33-SG", "67MH28-SG", "674UP30-SG",
    "68AS30-SG", "674GA30-SG", "67GJ30-SG", "67KA30-SG", "672RJ30-SG",
    "673SK30-SG", "669TN30-SG", "678KA32-SG",
  ];

  it("14 in-master EQ symbols → ORDINARY_EQUITY_ELIGIBLE", () => {
    expect(IN_MASTER_EQUITIES.length).toBe(14);
    for (const { symbol, name } of IN_MASTER_EQUITIES) {
      const r = classifyInstrument({ ...MASTER_EQ, symbol, name });
      expect(r.eligibilityClass).toBe("ORDINARY_EQUITY_ELIGIBLE");
      expect(r.warehouseEligible).toBe(true);
      expect(r.inCurrentMaster).toBe(true);
      expect(r.policyExclusionReason).toBeNull();
    }
  });

  it("33 in-master SDL bonds → DEBT_GOVERNMENT_SECURITY", () => {
    expect(IN_MASTER_SDL.length).toBe(33);
    for (const symbol of IN_MASTER_SDL) {
      const r = classifyInstrument({ ...MASTER_EQ, symbol, name: "SDL 6.X% 203X" });
      expect(r.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
      expect(r.inCurrentMaster).toBe(true);
    }
  });

  it("SGBSEP28VI-GB (in master) → SOVEREIGN_GOLD_BOND", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "SGBSEP28VI-GB", name: "2.50%GOLDBONDS2028SR-VI" });
    expect(r.eligibilityClass).toBe("SOVEREIGN_GOLD_BOND");
    expect(r.inCurrentMaster).toBe(true);
  });

  it("OMFURN-ST (NOT in master, token=NOT_FOUND) → UNRESOLVED_SECURITY_TYPE", () => {
    const r = classifyInstrument({ ...NOT_IN_MASTER, symbol: "OMFURN-ST", name: "OM FURNITURE" });
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(r.inCurrentMaster).toBe(false);
    // Critical: must not be SME_EQUITY_POLICY_EXCLUDED
    expect(r.eligibilityClass).not.toBe("SME_EQUITY_POLICY_EXCLUDED");
  });

  it("SANWARIA-BZ (in master, token=11777) → UNRESOLVED_SECURITY_TYPE (BZ series)", () => {
    const r = classifyInstrument({ ...MASTER_EQ, symbol: "SANWARIA-BZ", name: "SANWARIA CONSUMER" });
    expect(r.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(r.inCurrentMaster).toBe(true);
    expect(r.seriesCode).toBe("BZ");
  });

  it("summarizeEligibility on canary 50 (with correct inCurrentMaster flags)", () => {
    const allResults = [
      // 14 eligible EQ
      ...IN_MASTER_EQUITIES.map(i => classifyInstrument({ ...MASTER_EQ, ...i })),
      // 33 SDL in master
      ...IN_MASTER_SDL.map(s => classifyInstrument({ ...MASTER_EQ, symbol: s, name: "SDL" })),
      // 1 SGB in master
      classifyInstrument({ ...MASTER_EQ, symbol: "SGBSEP28VI-GB", name: "2.50%GOLDBONDS2028SR-VI" }),
      // 1 SME-ST absent from master → UNRESOLVED
      classifyInstrument({ ...NOT_IN_MASTER, symbol: "OMFURN-ST", name: "OM FURNITURE" }),
      // 1 BZ in master
      classifyInstrument({ ...MASTER_EQ, symbol: "SANWARIA-BZ", name: "SANWARIA CONSUMER" }),
    ];
    expect(allResults.length).toBe(50);
    const summary = summarizeEligibility(allResults);
    expect(summary.eligible).toBe(14);
    expect(summary.excluded).toBe(36);
    expect(summary.byClass.DEBT_GOVERNMENT_SECURITY).toBe(33);
    expect(summary.byClass.SOVEREIGN_GOLD_BOND).toBe(1);
    // OMFURN-ST is UNRESOLVED (not SME) — both UNRESOLVED sources sum to 2
    expect(summary.byClass.UNRESOLVED_SECURITY_TYPE).toBe(2); // BZ + OMFURN-ST
    expect(summary.byClass.SME_EQUITY_POLICY_EXCLUDED).toBeUndefined(); // zero
  });
});

// ─── 10. classifyInstrumentBatch ──────────────────────────────────────────────

describe("classifyInstrumentBatch", () => {
  it("passes inCurrentMaster through correctly", () => {
    const batch = classifyInstrumentBatch([
      { ...MASTER_EQ, symbol: "RELIANCE", name: "RELIANCE INDUSTRIES" },
      { ...NOT_IN_MASTER, symbol: "OMFURN-ST", name: "OM FURNITURE" },
      { ...MASTER_EQ, symbol: "656KA30-SG", name: "SDL KA 6.56% 2030" },
    ]);
    expect(batch.get("RELIANCE")?.eligibilityClass).toBe("ORDINARY_EQUITY_ELIGIBLE");
    expect(batch.get("OMFURN-ST")?.eligibilityClass).toBe("UNRESOLVED_SECURITY_TYPE");
    expect(batch.get("656KA30-SG")?.eligibilityClass).toBe("DEBT_GOVERNMENT_SECURITY");
  });
});

// ─── 11. WAREHOUSE_EXCLUDED_CLASSES completeness ─────────────────────────────

describe("WAREHOUSE_EXCLUDED_CLASSES completeness", () => {
  const EXCLUDED: InstrumentEligibilityClass[] = [
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
  for (const cls of EXCLUDED) {
    it(`${cls} is in WAREHOUSE_EXCLUDED_CLASSES`, () => {
      expect(WAREHOUSE_EXCLUDED_CLASSES.has(cls)).toBe(true);
    });
  }
  it("ORDINARY_EQUITY_ELIGIBLE is NOT in WAREHOUSE_EXCLUDED_CLASSES", () => {
    expect(WAREHOUSE_EXCLUDED_CLASSES.has("ORDINARY_EQUITY_ELIGIBLE")).toBe(false);
  });
});
