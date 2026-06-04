import { describe, it, expect } from "vitest";
import {
  looksLikeEtf,
  isWhitelistedEtf,
  isRecognisedEtf,
  checkEtfRecognition,
  getEtfRecognitionDiagnostics,
  ETF_WHITELIST,
} from "./kiteScanner";

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

describe("checkEtfRecognition (diagnostic outcome)", () => {
  it("reports curated-seed recognition via the seed short-circuit", async () => {
    const r = await checkEtfRecognition("niftybees");
    expect(r.recognised).toBe(true);
    expect(r.source).toBe("seed");
    expect(r.symbol).toBe("NIFTYBEES");
  });

  it("resolves a non-seed symbol consistently with Kite availability", async () => {
    // Env-agnostic: when the master can't load → kite_offline + pure-heuristic
    // result; when it loads → master/not_etf. A *BEES symbol is heuristically
    // an ETF either way (offline) or genuinely present in the master.
    const etf = await checkEtfRecognition("SOMEBEES");
    if (!etf.kiteInstrumentsLoaded) {
      expect(etf.source).toBe("kite_offline");
      expect(etf.recognised).toBe(true); // looksLikeEtf matches *BEES
    } else {
      expect(["master", "not_etf"]).toContain(etf.source);
    }

    const plain = await checkEtfRecognition("RELIANCE");
    if (!plain.kiteInstrumentsLoaded) {
      expect(plain.source).toBe("kite_offline");
    } else {
      expect(plain.source).toBe("not_etf");
    }
    expect(plain.recognised).toBe(false); // never an ETF either way
  });

  it("trims and upper-cases the symbol", async () => {
    const r = await checkEtfRecognition("  goldbees ");
    expect(r.symbol).toBe("GOLDBEES");
    expect(r.recognised).toBe(true);
  });
});

describe("getEtfRecognitionDiagnostics", () => {
  it("always reports the curated seed size and never fakes the detected-count", async () => {
    const d = await getEtfRecognitionDiagnostics();
    expect(d.seedCount).toBe(ETF_WHITELIST.size);
    if (d.kiteInstrumentsLoaded) {
      expect(d.detectedCount).not.toBeNull();
      expect(d.detectedCount as number).toBeGreaterThanOrEqual(0);
      expect(d.instrumentsFetchedAt).not.toBeNull();
    } else {
      expect(d.detectedCount).toBeNull();
      expect(d.instrumentsFetchedAt).toBeNull();
    }
  });
});
