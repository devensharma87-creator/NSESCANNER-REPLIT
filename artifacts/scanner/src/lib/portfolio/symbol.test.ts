import { describe, it, expect } from "vitest";
import {
  normalizeSymbol,
  classifyInstrument,
  fundamentalsApplicable,
  isEtfClass,
  lookupAlias,
  SYMBOL_ALIASES,
} from "./symbol";

const isEtf = (s: string, n?: string) => isEtfClass(classifyInstrument(s, n));

describe("normalizeSymbol", () => {
  it("trims and uppercases", () => {
    expect(normalizeSymbol("  reliance ")).toBe("RELIANCE");
  });

  it("strips Yahoo-style exchange suffixes (.NS/.BO/.NSE/.BSE)", () => {
    expect(normalizeSymbol("TCS.NS")).toBe("TCS");
    expect(normalizeSymbol("tcs.bo")).toBe("TCS");
    expect(normalizeSymbol("INFY.NSE")).toBe("INFY");
    expect(normalizeSymbol("INFY.BSE")).toBe("INFY");
  });

  it("preserves meaningful symbol characters (& and -)", () => {
    expect(normalizeSymbol("M&M")).toBe("M&M");
    expect(normalizeSymbol("are & m")).toBe("ARE&M");
    expect(normalizeSymbol("nifty-bees")).toBe("NIFTY-BEES");
  });

  it("does not strip a suffix that is not an exchange code", () => {
    expect(normalizeSymbol("ABC.XY")).toBe("ABC.XY");
  });

  it("handles empty / nullish input safely", () => {
    expect(normalizeSymbol("")).toBe("");
    // @ts-expect-error exercising defensive nullish path
    expect(normalizeSymbol(undefined)).toBe("");
  });
});

describe("classifyInstrument", () => {
  it("classifies a plain equity", () => {
    expect(classifyInstrument("RELIANCE", "Reliance Industries")).toBe("Equity");
  });

  it("classifies BEES family as an ETF subtype (always non-equity)", () => {
    expect(classifyInstrument("NIFTYBEES")).toBe("Index ETF");
    expect(classifyInstrument("GOLDBEES")).toBe("Gold ETF");
    // BANKBEES has no word-boundary for the sector/index regex, so it is the
    // generic "ETF" subtype — what matters is it is recognised as an ETF.
    expect(isEtf("BANKBEES")).toBe(true);
  });

  it("classifies gold/silver ETFs", () => {
    expect(classifyInstrument("GOLDETF", "Gold ETF")).toBe("Gold ETF");
  });

  it("classifies international ETFs", () => {
    expect(classifyInstrument("MON100", "Motilal Oswal NASDAQ 100 ETF")).toBe("International ETF");
  });

  it("classifies generic ETFs by name", () => {
    expect(classifyInstrument("XYZ", "Some Fund")).toBe("ETF");
  });
});

describe("fundamentalsApplicable / isEtfClass", () => {
  it("fundamentals apply to equity and unknown only", () => {
    expect(fundamentalsApplicable("Equity")).toBe(true);
    expect(fundamentalsApplicable("Unknown")).toBe(true);
    expect(fundamentalsApplicable("Index ETF")).toBe(false);
    expect(fundamentalsApplicable("Gold ETF")).toBe(false);
  });

  it("isEtfClass recognises ETF subtypes", () => {
    expect(isEtfClass("Gold ETF")).toBe(true);
    expect(isEtfClass("Equity")).toBe(false);
  });
});

describe("alias layer", () => {
  it("is empty by default (verified-only)", () => {
    expect(SYMBOL_ALIASES).toHaveLength(0);
    expect(lookupAlias("ANYTHING")).toBeNull();
  });
});
