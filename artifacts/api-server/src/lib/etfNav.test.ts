import { describe, it, expect } from "vitest";
import {
  parseAmfiNav,
  resolveEtfIsin,
  isValidIsin,
  ETF_ISIN_MAP,
  ETF_ISIN_MAP_AS_OF,
} from "./etfNav";

const SAMPLE = [
  "Open Ended Schemes(Equity Scheme - Other ETFs)",
  "",
  "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date",
  "140084;INF204KB14I2;-;Nippon India ETF Nifty 50 BeES;265.3022;03-Jun-2026",
  "140088;INF204KB17I5;-;Nippon India ETF Gold BeES;127.3325;03-Jun-2026",
  // A scheme with two ISINs (growth + reinvestment) — both index to one NAV.
  "999999;INF000AAAAA1;INF000BBBBB2;Some Dual-ISIN Scheme;55.5;03-Jun-2026",
  // Non-numeric NAV (suspended) must be dropped, never coerced.
  "888888;INF000CCCCC3;-;Suspended Scheme;N.A.;03-Jun-2026",
  // Zero NAV must be dropped.
  "777777;INF000DDDDD4;-;Zero NAV Scheme;0;03-Jun-2026",
].join("\n");

describe("parseAmfiNav", () => {
  const map = parseAmfiNav(SAMPLE);

  it("parses real ETF NAV rows keyed by ISIN", () => {
    expect(map.get("INF204KB14I2")).toEqual({
      isin: "INF204KB14I2",
      nav: 265.3022,
      navDate: "03-Jun-2026",
      schemeName: "Nippon India ETF Nifty 50 BeES",
    });
    expect(map.get("INF204KB17I5")?.nav).toBeCloseTo(127.3325, 4);
  });

  it("indexes both ISINs of a dual-ISIN scheme to the same NAV", () => {
    expect(map.get("INF000AAAAA1")?.nav).toBe(55.5);
    expect(map.get("INF000BBBBB2")?.nav).toBe(55.5);
  });

  it("drops non-numeric and non-positive NAVs (never fabricated)", () => {
    expect(map.has("INF000CCCCC3")).toBe(false);
    expect(map.has("INF000DDDDD4")).toBe(false);
  });

  it("ignores header/banner/blank lines", () => {
    // Only the 3 valid data ISINs (2 single + 2 from the dual row) remain.
    expect(map.size).toBe(4);
  });
});

describe("isValidIsin", () => {
  it("accepts well-formed ISINs and rejects junk", () => {
    expect(isValidIsin("INF204KB14I2")).toBe(true);
    expect(isValidIsin("inf204kb14i2")).toBe(true);
    expect(isValidIsin("NOPE")).toBe(false);
    expect(isValidIsin("")).toBe(false);
  });
});

describe("resolveEtfIsin", () => {
  it("resolves curated symbols", () => {
    expect(resolveEtfIsin("NIFTYBEES")).toBe("INF204KB14I2");
    expect(resolveEtfIsin("goldbees")).toBe("INF204KB17I5");
  });

  it("prefers a valid override over the curated map", () => {
    expect(resolveEtfIsin("NIFTYBEES", "INF000AAAAA1")).toBe("INF000AAAAA1");
  });

  it("ignores an invalid override and falls back to the map", () => {
    expect(resolveEtfIsin("NIFTYBEES", "junk")).toBe("INF204KB14I2");
  });

  it("returns null for unknown symbols with no override", () => {
    expect(resolveEtfIsin("UNKNOWNETF")).toBeNull();
  });
});

describe("ETF_ISIN_MAP", () => {
  it("has a verified-as-of date", () => {
    expect(ETF_ISIN_MAP_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("contains only valid ISINs", () => {
    for (const isin of ETF_ISIN_MAP.values()) {
      expect(isValidIsin(isin)).toBe(true);
    }
  });
});
