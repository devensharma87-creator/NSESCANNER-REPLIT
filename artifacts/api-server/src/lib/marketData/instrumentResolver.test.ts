import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveInstrument,
  searchMaster,
  normalizeSymbol,
  isResolverReady,
  resetResolverCache,
  getExchangeReadiness,
  _forTesting_overrideCacheDir,
} from "./instrumentResolver";

/**
 * Deterministic instrument fixtures.
 *
 * These replace reliance on the mutable live .cache files so the test suite
 * is stable regardless of workspace BSE/NSE cache state (e.g. after an empty
 * BSE cache is left behind by clearInstrumentsCooldown).
 *
 * The NSDL assertions are NOT weakened — they run against the BSE fixture row
 * below, which provides the canonical scrip-code 544467 / symbol "NSDL" data.
 */
const DISK_VERSION = 1;

const NSE_FIXTURE = [
  { instrument_token: 1001, exchange_token: 1001, tradingsymbol: "TRIDENT",  name: "TRIDENT LTD",                        instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 1002, exchange_token: 1002, tradingsymbol: "BDL",       name: "BHARAT DYNAMICS LTD",                 instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 1003, exchange_token: 1003, tradingsymbol: "CDSL",      name: "CENTRAL DEPOSITORY SERVICES LTD",     instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 1004, exchange_token: 1004, tradingsymbol: "INDHOTEL",  name: "INDIAN HOTELS COMPANY LTD",           instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 1005, exchange_token: 1005, tradingsymbol: "BLS",       name: "BLS INTERNATIONAL SERVICES LTD",      instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 1006, exchange_token: 1006, tradingsymbol: "TMPV",      name: "TATA MOTORS PREFERRED VOTING RIGHTS", instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 1007, exchange_token: 1007, tradingsymbol: "ARE&M",     name: "AMARA RAJA ENERGY AND MOBILITY LTD",  instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 1008, exchange_token: 1008, tradingsymbol: "CPSEETF",   name: "CPSE ETF",                            instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 1009, exchange_token: 1009, tradingsymbol: "HDFCBANK",  name: "HDFC BANK LTD",                       instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
];

/** BSE fixture — NSDL is the canonical BSE-only instrument used in tests. */
const BSE_FIXTURE = [
  {
    instrument_token: 9001,
    exchange_token: 544467,
    tradingsymbol: "NSDL",
    name: "NATIONAL SECURITIES DEPOSITORIES LTD",
    instrument_type: "EQ",
    segment: "BSE",
    exchange: "BSE",
  },
];

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kite-resolver-test-"));
  fs.writeFileSync(
    path.join(tmpDir, "kite_instruments_NSE.json"),
    JSON.stringify({ version: DISK_VERSION, ts: Date.now(), payload: NSE_FIXTURE }),
  );
  fs.writeFileSync(
    path.join(tmpDir, "kite_instruments_BSE.json"),
    JSON.stringify({ version: DISK_VERSION, ts: Date.now(), payload: BSE_FIXTURE }),
  );
  _forTesting_overrideCacheDir(tmpDir);
  resetResolverCache();
});

afterAll(() => {
  _forTesting_overrideCacheDir(null);
  resetResolverCache();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── Pure-function tests (no cache dependency) ────────────────────────────────

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

// ─── Master-dependent tests — use deterministic fixture, not live .cache ──────

describe("resolveInstrument against the deterministic fixture master", () => {
  beforeAll(() => {
    resetResolverCache();
    expect(isResolverReady()).toBe(true);
  });

  it("resolves the 8 user-reported NSE/BSE symbols", () => {
    const cases: Array<[string, string, string]> = [
      ["TRIDENT",  "TRIDENT",  "NSE"],
      ["BDL",      "BDL",      "NSE"],
      ["CDSL",     "CDSL",     "NSE"],
      ["INDHOTEL", "INDHOTEL", "NSE"],
      ["BLS",      "BLS",      "NSE"],
      ["TMPV",     "TMPV",     "NSE"],
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

  it("getExchangeReadiness reports both NSE and BSE as populated (fixture has both)", () => {
    const r = getExchangeReadiness();
    expect(r.NSE).toBe(true);
    expect(r.BSE).toBe(true);
  });
});
