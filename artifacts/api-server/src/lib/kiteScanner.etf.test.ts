import { describe, it, expect } from "vitest";
import { looksLikeEtf, isWhitelistedEtf, isRecognisedEtf } from "./kiteScanner";

describe("looksLikeEtf (data-driven ETF detection)", () => {
  it("recognises the Nippon BeES family by symbol suffix", () => {
    expect(looksLikeEtf("NIFTYBEES")).toBe(true);
    expect(looksLikeEtf("GOLDBEES")).toBe(true);
    expect(looksLikeEtf("SILVERBEES")).toBe(true);
    expect(looksLikeEtf("JUNIORBEES")).toBe(true);
    expect(looksLikeEtf("LIQUIDBEES")).toBe(true);
    expect(looksLikeEtf("ITBEES")).toBe(true);
  });

  it("recognises issuer ETF/IETF symbol naming", () => {
    expect(looksLikeEtf("CPSEETF")).toBe(true);
    expect(looksLikeEtf("SETFGOLD", "SBI-ETF GOLD")).toBe(true); // name-based
    expect(looksLikeEtf("NIFTYIETF")).toBe(true);
    expect(looksLikeEtf("SILVERIETF")).toBe(true);
  });

  it("recognises ETFs by descriptive name even with an opaque symbol", () => {
    expect(looksLikeEtf("MON100", "Motilal Oswal NASDAQ 100 ETF")).toBe(true);
    expect(looksLikeEtf("ICICIB22", "ICICI Prudential Nifty 100 ETF")).toBe(true);
    expect(looksLikeEtf("XYZ", "Some Exchange Traded Fund")).toBe(true);
  });

  it("EXCLUDES indicative-NAV feed instruments (*INAV)", () => {
    expect(looksLikeEtf("HDF100INAV", "HDFC NIFTY 100 ETF INAV")).toBe(false);
    expect(looksLikeEtf("ABCINAV")).toBe(false);
  });

  it("does not flag plain equities", () => {
    expect(looksLikeEtf("RELIANCE", "Reliance Industries Limited")).toBe(false);
    expect(looksLikeEtf("TCS", "Tata Consultancy Services")).toBe(false);
    expect(looksLikeEtf("INFY")).toBe(false);
    expect(looksLikeEtf("")).toBe(false);
  });

  it("is case-insensitive and trims", () => {
    expect(looksLikeEtf("  niftybees ")).toBe(true);
    expect(looksLikeEtf("goldbees")).toBe(true);
  });
});

describe("isWhitelistedEtf (curated offline seed)", () => {
  it("matches seed members case-insensitively", () => {
    expect(isWhitelistedEtf("niftybees")).toBe(true);
    expect(isWhitelistedEtf("GOLDBEES")).toBe(true);
  });
  it("rejects non-seed symbols", () => {
    expect(isWhitelistedEtf("RELIANCE")).toBe(false);
  });
});

describe("isRecognisedEtf — seed short-circuit", () => {
  it("recognises a curated-seed ETF without touching Kite", async () => {
    await expect(isRecognisedEtf("NIFTYBEES")).resolves.toBe(true);
    await expect(isRecognisedEtf("goldbees")).resolves.toBe(true);
  });
});
