import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  resolveInstrument,
  searchMaster,
  normalizeSymbol,
  isResolverReady,
  resetResolverCache,
} from "./instrumentResolver";

/**
 * These tests run against the real on-disk Kite master dump
 * (`.cache/kite_instruments_{NSE,BSE}.json`). If the dump is absent (fresh
 * clone / wiped cache), the master-dependent assertions auto-skip so CI stays
 * green; the pure-function tests always run.
 */
const CACHE_DIR = path.resolve(process.cwd(), ".cache");
const hasMaster =
  fs.existsSync(path.join(CACHE_DIR, "kite_instruments_NSE.json")) &&
  fs.existsSync(path.join(CACHE_DIR, "kite_instruments_BSE.json"));

beforeAll(() => resetResolverCache());

describe("normalizeSymbol (pure)", () => {
  it("strips suffixes/prefixes and preserves special chars", () => {
    expect(normalizeSymbol(" trident.ns ")).toBe("TRIDENT");
    expect(normalizeSymbol("NSE:BDL")).toBe("BDL");
    expect(normalizeSymbol("are&m")).toBe("ARE&M");
    expect(normalizeSymbol("INDHOTEL.BO")).toBe("INDHOTEL");
    expect(normalizeSymbol("CPSE ETF")).toBe("CPSEETF");
    expect(normalizeSymbol("CPSEETF")).toBe("CPSEETF");
    expect(normalizeSymbol("  CpSe eTf.Ns  ")).toBe("CPSEETF");
    expect(normalizeSymbol("are & m")).toBe("ARE&M");
  });
  it("returns empty for blank input", () => {
    expect(normalizeSymbol("   ")).toBe("");
    expect(normalizeSymbol("")).toBe("");
  });
});

describe("resolveInstrument never fabricates", () => {
  it("returns an explicit reason for a junk symbol", () => {
    const r = resolveInstrument("ZZZ_NOT_A_REAL_TICKER_999");
    expect(r.resolved).toBe(false);
    expect(r.instrument).toBeNull();
    expect(r.reason).toBeTruthy();
    expect(r.attempts.length).toBeGreaterThan(0);
  });
  it("returns a reason for empty input", () => {
    const r = resolveInstrument("");
    expect(r.resolved).toBe(false);
    expect(r.reason).toBe("Empty symbol");
  });
});

(hasMaster ? describe : describe.skip)("resolveInstrument against the real Kite master", () => {
  beforeAll(() => {
    resetResolverCache();
    expect(isResolverReady()).toBe(true);
  });

  it("resolves the 8 user-reported NSE/BSE symbols", () => {
    const cases: Array<[string, string, string]> = [
      ["TRIDENT", "TRIDENT", "NSE"],
      ["BDL", "BDL", "NSE"],
      ["CDSL", "CDSL", "NSE"],
      ["INDHOTEL", "INDHOTEL", "NSE"],
      ["BLS", "BLS", "NSE"],
      ["TMPV", "TMPV", "NSE"],
    ];
    for (const [input, sym, ex] of cases) {
      const r = resolveInstrument(input);
      expect(r.resolved, `${input} should resolve`).toBe(true);
      expect(r.instrument?.canonical_symbol).toBe(sym);
      expect(r.instrument?.exchange).toBe(ex);
      expect(r.instrument?.kite_key).toBe(`${ex}:${sym}`);
      expect(r.instrument?.instrument_token).toBeGreaterThan(0);
    }
  });

  it("resolves the special-character ticker ARE&M and its alnum/alias variants", () => {
    const direct = resolveInstrument("ARE&M");
    expect(direct.resolved).toBe(true);
    expect(direct.instrument?.canonical_symbol).toBe("ARE&M");

    const alnumVariant = resolveInstrument("AREM");
    expect(alnumVariant.resolved).toBe(true);
    expect(alnumVariant.instrument?.canonical_symbol).toBe("ARE&M");
    expect(alnumVariant.matched_via).toBe("alnum-normalized");

    const alias = resolveInstrument("AMARAJABAT");
    expect(alias.resolved).toBe(true);
    expect(alias.instrument?.canonical_symbol).toBe("ARE&M");
  });

  it("resolves a BSE numeric scrip code (544467 → NSDL)", () => {
    const r = resolveInstrument("544467");
    expect(r.resolved).toBe(true);
    expect(r.instrument?.canonical_symbol).toBe("NSDL");
    expect(r.instrument?.exchange).toBe("BSE");
    expect(r.instrument?.bse_code).toBe("544467");
    expect(r.matched_via).toBe("bse-code");
  });

  it("searchMaster supports numeric scrip codes", () => {
    const hits = searchMaster("544467");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].symbol).toBe("NSDL");
    expect(hits[0].exchange).toBe("BSE");

    const badHits = searchMaster("999999");
    expect(badHits.length).toBe(0);
  });

  it("resolves NSDL (BSE-only) by symbol", () => {
    const r = resolveInstrument("NSDL");
    expect(r.resolved).toBe(true);
    expect(r.instrument?.exchange).toBe("BSE");
    expect(r.instrument?.bse_code).toBe("544467");
  });

  it("classifies known ETFs as ETF type", () => {
    const r = resolveInstrument("CPSEETF");
    expect(r.resolved).toBe(true);
    expect(r.instrument?.instrument_type.endsWith("ETF")).toBe(true);
  });

  it("does NOT fabricate a match for a non-existent ETF symbol", () => {
    const r = resolveInstrument("MAM150ETF");
    expect(r.resolved).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("search returns matches for partial company/symbol queries", () => {
    expect(searchMaster("trident").some(h => h.symbol === "TRIDENT")).toBe(true);
    expect(searchMaster("bdl").some(h => h.symbol === "BDL")).toBe(true);
    expect(searchMaster("cdsl").some(h => h.symbol === "CDSL")).toBe(true);
    expect(searchMaster("amara").some(h => h.symbol === "ARE&M")).toBe(true);
    const hdfc = searchMaster("hdfc");
    expect(hdfc.some(h => h.symbol === "HDFCBANK")).toBe(true);
    const tata = searchMaster("tata");
    expect(tata.some(h => h.symbol.startsWith("TATA") || h.symbol === "TMPV")).toBe(true);
  });

  it("search returns [] for empty query", () => {
    expect(searchMaster("")).toEqual([]);
  });
});
