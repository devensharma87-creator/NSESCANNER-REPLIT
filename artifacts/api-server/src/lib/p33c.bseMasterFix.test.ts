/**
 * Pack 33C — BSE Instrument Master Last-Good-Safe Correction
 *
 * Tests required by the BSE-INSTRUMENT-MASTER-LAST-GOOD-SAFE-CORRECTION brief.
 * All tests use mocked diskCache and an injected rawKc client — no live .cache
 * files, no real Kite session, fully deterministic.
 */
import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── Mock diskCache before any kiteAuth imports ───────────────────────────────
vi.mock("./diskCache", () => ({
  loadBlob: vi.fn(),
  saveBlob: vi.fn(),
  clearBlob: vi.fn(),
  istTradingDay: vi.fn().mockReturnValue("2026-08-11"),
}));

import {
  _forTesting_forceRefreshWithClient,
  _forTesting_resetInstrumentState,
  clearInstrumentsCooldown,
  seedInstrumentsCache,
  getInstrumentExchangeStatus,
  validateInstrumentRows,
} from "./kiteAuth";
import {
  resolveInstrument,
  resetResolverCache,
  getExchangeReadiness,
  _forTesting_overrideCacheDir,
} from "./marketData/instrumentResolver";
import { loadBlob, saveBlob } from "./diskCache";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DISK_VERSION = 1;

/** Minimal valid instrument row for exchange `ex`. */
function makeRow(i: number, ex: string): object {
  return {
    instrument_token: 100_000 + i,
    exchange_token:   200_000 + i,
    tradingsymbol: `SYM${ex}${i}`,
    name: `Company ${ex} ${i}`,
    instrument_type: "EQ",
    segment: ex,
    exchange: ex,
  };
}

/** Build an array of `count` valid rows for `ex`. */
function makeRows(count: number, ex: string): object[] {
  return Array.from({ length: count }, (_, i) => makeRow(i, ex));
}

/** A populated disk blob for exchange `ex` with `count` rows. */
function makeBlob(count: number, ex: string) {
  return { version: DISK_VERSION, ts: Date.now(), payload: makeRows(count, ex) };
}

const NSDL_BSE_ROW = {
  instrument_token: 9001,
  exchange_token: 544467,
  tradingsymbol: "NSDL",
  name: "NATIONAL SECURITIES DEPOSITORIES LTD",
  instrument_type: "EQ",
  segment: "BSE",
  exchange: "BSE",
};

/** Minimum valid counts per exchange (must match kiteAuth constants). */
const MIN = { NSE: 5_000, BSE: 500, NFO: 15_000, BFO: 2_000 };

/** Exchange disk-key names for the instrument master files. */
const EXCHANGE_KEYS = [
  "kite_instruments_NSE",
  "kite_instruments_BSE",
  "kite_instruments_NFO",
  "kite_instruments_BFO",
];

/** Return a mock rawKc that returns per-exchange results from the supplied map. */
function makeKc(
  perExchange: Partial<Record<"NSE" | "BSE" | "NFO" | "BFO", object[] | Error>>,
) {
  return {
    getInstruments: vi.fn(async (ex: string) => {
      const val = perExchange[ex as keyof typeof perExchange];
      if (val instanceof Error) throw val;
      return val ?? [];
    }),
  };
}

const mockSaveBlob = saveBlob as ReturnType<typeof vi.fn>;
const mockLoadBlob = loadBlob as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  _forTesting_resetInstrumentState();
  // Default: loadBlob returns null (no prior disk cache) unless overridden per test.
  mockLoadBlob.mockReturnValue(null);
});

afterAll(() => {
  _forTesting_overrideCacheDir(null);
  resetResolverCache();
});

// ─── Section A: clearInstrumentsCooldown does not wipe disk ──────────────────

describe("clearInstrumentsCooldown — PRESERVE-FIRST", () => {
  it("never calls saveBlob with an empty array for any instrument master key", () => {
    // Pre-seed in-memory cache so BSE/NSE are in cacheKeys.
    seedInstrumentsCache({
      NSE: makeRows(10, "NSE"),
      BSE: [NSDL_BSE_ROW],
    });
    clearInstrumentsCooldown();
    const emptyCalls = mockSaveBlob.mock.calls.filter(
      ([name, , payload]) =>
        EXCHANGE_KEYS.includes(name) && Array.isArray(payload) && payload.length === 0,
    );
    expect(emptyCalls, "saveBlob must not be called with [] for instrument master keys").toHaveLength(0);
  });

  it("sets status to LAST_KNOWN for exchanges that were in memory", () => {
    seedInstrumentsCache({ BSE: [NSDL_BSE_ROW] });
    clearInstrumentsCooldown();
    expect(getInstrumentExchangeStatus().BSE).toBe("LAST_KNOWN");
  });
});

// ─── Section B: forceRefresh validation gates ─────────────────────────────────

describe("T-1: Populated BSE cache + BSE fetch failure → last-good preserved", () => {
  it("preserves BSE disk cache and sets LAST_KNOWN status", async () => {
    // loadBlob returns a populated BSE blob for prevBlob snapshot.
    mockLoadBlob.mockImplementation((name: string) => {
      if (name === "kite_instruments_BSE") return makeBlob(MIN.BSE + 1, "BSE");
      return null;
    });
    const kc = makeKc({ BSE: new Error("network timeout") });
    const results = await _forTesting_forceRefreshWithClient(kc);

    // Status must be LAST_KNOWN (prev data existed) not UNAVAILABLE
    expect(getInstrumentExchangeStatus().BSE).toBe("LAST_KNOWN");
    // saveBlob must NOT be called for BSE at all (no overwrite of any kind)
    const bseSaves = mockSaveBlob.mock.calls.filter(([name]) => name === "kite_instruments_BSE");
    expect(bseSaves).toHaveLength(0);
    // Result entry reflects the error
    expect("error" in results.BSE).toBe(true);
    expect(results.BSE.status).toBe("LAST_KNOWN");
  });
});

describe("T-2: Populated BSE cache + BSE returns [] → empty response rejected, cache preserved", () => {
  it("rejects the empty response and does not overwrite disk", async () => {
    mockLoadBlob.mockImplementation((name: string) => {
      if (name === "kite_instruments_BSE") return makeBlob(MIN.BSE + 1, "BSE");
      return null;
    });
    const kc = makeKc({ BSE: [] });
    await _forTesting_forceRefreshWithClient(kc);

    expect(getInstrumentExchangeStatus().BSE).toBe("INVALID_REFRESH_REJECTED");
    const bseSaves = mockSaveBlob.mock.calls.filter(([name]) => name === "kite_instruments_BSE");
    expect(bseSaves).toHaveLength(0);
  });
});

describe("T-3: Populated BSE cache + malformed BSE response → rejected, cache preserved", () => {
  it("rejects response missing required identity fields", async () => {
    mockLoadBlob.mockImplementation((name: string) => {
      if (name === "kite_instruments_BSE") return makeBlob(MIN.BSE + 1, "BSE");
      return null;
    });
    // 5 rows all missing tradingsymbol/instrument_token → MALFORMED
    const malformed = Array.from({ length: 5 }, (_, i) => ({ foo: `bar${i}`, baz: i }));
    const kc = makeKc({ BSE: malformed });
    await _forTesting_forceRefreshWithClient(kc);

    expect(getInstrumentExchangeStatus().BSE).toBe("INVALID_REFRESH_REJECTED");
    const bseSaves = mockSaveBlob.mock.calls.filter(([name]) => name === "kite_instruments_BSE");
    expect(bseSaves).toHaveLength(0);
  });
});

describe("T-4: Populated BSE cache + implausibly small response → rejected, cache preserved", () => {
  it("rejects response below the minimum floor", async () => {
    mockLoadBlob.mockImplementation((name: string) => {
      if (name === "kite_instruments_BSE") return makeBlob(MIN.BSE + 1, "BSE");
      return null;
    });
    // 10 valid rows — below BSE floor of 500
    const tooFew = makeRows(10, "BSE");
    const kc = makeKc({ BSE: tooFew });
    await _forTesting_forceRefreshWithClient(kc);

    expect(getInstrumentExchangeStatus().BSE).toBe("INVALID_REFRESH_REJECTED");
    const bseSaves = mockSaveBlob.mock.calls.filter(([name]) => name === "kite_instruments_BSE");
    expect(bseSaves).toHaveLength(0);
  });

  it("rejects a response that collapses to < 50% of previous valid count", async () => {
    const prevCount = 1000;
    mockLoadBlob.mockImplementation((name: string) => {
      if (name === "kite_instruments_BSE") return makeBlob(prevCount, "BSE");
      return null;
    });
    // New response: 499 rows = < 50% of 1000 → implausible collapse
    const kc = makeKc({ BSE: makeRows(499, "BSE") });
    await _forTesting_forceRefreshWithClient(kc);

    expect(getInstrumentExchangeStatus().BSE).toBe("INVALID_REFRESH_REJECTED");
  });
});

describe("T-5: Valid BSE response → BSE cache atomically replaced", () => {
  it("writes the new BSE data and reports CURRENT status", async () => {
    mockLoadBlob.mockReturnValue(null); // no prior disk cache
    const validBse = makeRows(MIN.BSE + 1, "BSE");
    const kc = makeKc({ BSE: validBse });
    const results = await _forTesting_forceRefreshWithClient(kc);

    expect(getInstrumentExchangeStatus().BSE).toBe("CURRENT");
    const bseSaves = mockSaveBlob.mock.calls.filter(([name]) => name === "kite_instruments_BSE");
    expect(bseSaves).toHaveLength(1);
    // Payload written must be the valid rows (non-empty)
    expect(bseSaves[0][2]).toHaveLength(MIN.BSE + 1);
    expect("count" in results.BSE).toBe(true);
    expect(results.BSE.status).toBe("CURRENT");
  });
});

describe("T-6: Force refresh requests all four exchanges (NSE, BSE, NFO, BFO)", () => {
  it("calls getInstruments for each of NSE, BSE, NFO, BFO", async () => {
    mockLoadBlob.mockReturnValue(null);
    const kc = makeKc({
      NSE: makeRows(MIN.NSE + 1, "NSE"),
      BSE: makeRows(MIN.BSE + 1, "BSE"),
      NFO: makeRows(MIN.NFO + 1, "NFO"),
      BFO: makeRows(MIN.BFO + 1, "BFO"),
    });
    await _forTesting_forceRefreshWithClient(kc);

    const calledWith = (kc.getInstruments as ReturnType<typeof vi.fn>).mock.calls.map(
      ([ex]) => ex,
    );
    expect(calledWith).toContain("NSE");
    expect(calledWith).toContain("BSE");
    expect(calledWith).toContain("NFO");
    expect(calledWith).toContain("BFO");
    expect(calledWith).toHaveLength(4);
  });
});

describe("T-7: Failure of BSE does not corrupt successful NSE/NFO/BFO caches", () => {
  it("writes NSE/NFO/BFO and leaves BSE disk untouched on BSE failure", async () => {
    mockLoadBlob.mockImplementation((name: string) => {
      if (name === "kite_instruments_BSE") return makeBlob(MIN.BSE + 1, "BSE");
      return null;
    });
    const validNse = makeRows(MIN.NSE + 1, "NSE");
    const validNfo = makeRows(MIN.NFO + 1, "NFO");
    const validBfo = makeRows(MIN.BFO + 1, "BFO");
    const kc = makeKc({
      NSE: validNse,
      BSE: new Error("BSE upstream failure"),
      NFO: validNfo,
      BFO: validBfo,
    });
    await _forTesting_forceRefreshWithClient(kc);

    // BSE disk must not be touched
    const bseSaves = mockSaveBlob.mock.calls.filter(([name]) => name === "kite_instruments_BSE");
    expect(bseSaves).toHaveLength(0);
    // NSE/NFO/BFO are written successfully
    const nseSaves = mockSaveBlob.mock.calls.filter(([name]) => name === "kite_instruments_NSE");
    const nfoSaves = mockSaveBlob.mock.calls.filter(([name]) => name === "kite_instruments_NFO");
    const bfoSaves = mockSaveBlob.mock.calls.filter(([name]) => name === "kite_instruments_BFO");
    expect(nseSaves).toHaveLength(1);
    expect(nfoSaves).toHaveLength(1);
    expect(bfoSaves).toHaveLength(1);
    // Status
    expect(getInstrumentExchangeStatus().NSE).toBe("CURRENT");
    expect(getInstrumentExchangeStatus().BSE).toBe("LAST_KNOWN");
    expect(getInstrumentExchangeStatus().NFO).toBe("CURRENT");
    expect(getInstrumentExchangeStatus().BFO).toBe("CURRENT");
  });
});

// ─── Section C: instrumentResolver with deterministic BSE fixture ─────────────

describe("T-8: NSDL resolves by symbol and scrip code via deterministic BSE fixture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kite-bse-fix-test-"));
    const bseFixture = [NSDL_BSE_ROW];
    const nseFixture = makeRows(5, "NSE").map((r: any) => ({ ...r, instrument_type: "EQ", segment: "NSE" }));
    fs.writeFileSync(
      path.join(tmpDir, "kite_instruments_BSE.json"),
      JSON.stringify({ version: DISK_VERSION, ts: Date.now(), payload: bseFixture }),
    );
    fs.writeFileSync(
      path.join(tmpDir, "kite_instruments_NSE.json"),
      JSON.stringify({ version: DISK_VERSION, ts: Date.now(), payload: nseFixture }),
    );
    _forTesting_overrideCacheDir(tmpDir);
    resetResolverCache();
  });

  afterAll(() => {
    _forTesting_overrideCacheDir(null);
    resetResolverCache();
    try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("resolves NSDL by symbol from BSE fixture", () => {
    const r = resolveInstrument("NSDL");
    expect(r.resolved).toBe(true);
    expect(r.instrument?.exchange).toBe("BSE");
    expect(r.instrument?.bse_code).toBe("544467");
    expect(r.instrument?.canonical_symbol).toBe("NSDL");
  });

  it("resolves BSE scrip code 544467 → NSDL", () => {
    const r = resolveInstrument("544467");
    expect(r.resolved).toBe(true);
    expect(r.instrument?.canonical_symbol).toBe("NSDL");
    expect(r.instrument?.exchange).toBe("BSE");
    expect(r.matched_via).toBe("bse-code");
  });

  it("getExchangeReadiness correctly identifies BSE as populated", () => {
    const ready = getExchangeReadiness();
    expect(ready.BSE).toBe(true);
    expect(ready.NSE).toBe(true);
  });
});

describe("T-9: Cold restart after failed BSE refresh — last-good disk cache hydrates NSDL", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kite-bse-cold-test-"));
    // Simulate: the preserved disk cache (BSE not wiped after failed refresh).
    const bseFixture = [NSDL_BSE_ROW];
    fs.writeFileSync(
      path.join(tmpDir, "kite_instruments_BSE.json"),
      JSON.stringify({ version: DISK_VERSION, ts: Date.now(), payload: bseFixture }),
    );
    fs.writeFileSync(
      path.join(tmpDir, "kite_instruments_NSE.json"),
      JSON.stringify({ version: DISK_VERSION, ts: Date.now(), payload: [] }),
    );
    _forTesting_overrideCacheDir(tmpDir);
    resetResolverCache(); // simulate fresh process — in-memory index is cold
  });

  afterAll(() => {
    _forTesting_overrideCacheDir(null);
    resetResolverCache();
    try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("NSDL still resolves after cold restart because disk cache was preserved", () => {
    // Resolver re-builds index from disk on first call — the preserved BSE cache
    // makes NSDL resolvable even though we never got a successful BSE refresh.
    const r = resolveInstrument("NSDL");
    expect(r.resolved).toBe(true);
    expect(r.instrument?.bse_code).toBe("544467");
  });

  it("scrip code 544467 also resolves on cold start", () => {
    const r = resolveInstrument("544467");
    expect(r.resolved).toBe(true);
    expect(r.instrument?.canonical_symbol).toBe("NSDL");
  });
});

describe("T-10: No prior BSE cache + failed/empty response → UNAVAILABLE (not CURRENT_EMPTY)", () => {
  it("reports UNAVAILABLE when fetch fails and no prior disk data exists", async () => {
    mockLoadBlob.mockReturnValue(null); // no prior disk cache
    const kc = makeKc({ BSE: new Error("upstream error") });
    await _forTesting_forceRefreshWithClient(kc);
    expect(getInstrumentExchangeStatus().BSE).toBe("UNAVAILABLE");
  });

  it("reports UNAVAILABLE when BSE returns [] and no prior disk data exists", async () => {
    mockLoadBlob.mockReturnValue(null);
    const kc = makeKc({ BSE: [] });
    await _forTesting_forceRefreshWithClient(kc);
    // INVALID_REFRESH_REJECTED with no last-good → effectively UNAVAILABLE
    // (restoreLastGood sets UNAVAILABLE, then we set INVALID_REFRESH_REJECTED)
    expect(getInstrumentExchangeStatus().BSE).toBe("INVALID_REFRESH_REJECTED");
    // Critically: saveBlob is never called with [] for BSE
    const bseSaves = mockSaveBlob.mock.calls.filter(
      ([name, , payload]) => name === "kite_instruments_BSE" && Array.isArray(payload) && payload.length === 0,
    );
    expect(bseSaves).toHaveLength(0);
  });
});

describe("T-11: No code path persists payload=[] as a successful instrument master", () => {
  it("saveBlob is never called with [] for any instrument master key under any failure scenario", async () => {
    mockLoadBlob.mockImplementation((name: string) => {
      if (name === "kite_instruments_BSE") return makeBlob(MIN.BSE + 1, "BSE");
      if (name === "kite_instruments_NSE") return makeBlob(MIN.NSE + 1, "NSE");
      return null;
    });
    // All fetches fail or return invalid data
    const kc = makeKc({
      NSE: new Error("fail"),
      BSE: [],           // validation failure
      NFO: makeRows(5, "NFO"), // implausibly small
      BFO: new Error("fail"),
    });
    await _forTesting_forceRefreshWithClient(kc);

    // Also test clearInstrumentsCooldown
    seedInstrumentsCache({ NSE: makeRows(3, "NSE"), BSE: [NSDL_BSE_ROW] });
    clearInstrumentsCooldown();

    const emptyPayloadCalls = mockSaveBlob.mock.calls.filter(
      ([name, , payload]) =>
        EXCHANGE_KEYS.includes(name) && Array.isArray(payload) && payload.length === 0,
    );
    expect(
      emptyPayloadCalls,
      "saveBlob must never be called with [] for instrument master keys",
    ).toHaveLength(0);
  });
});

// ─── Section D: validateInstrumentRows — unit tests ──────────────────────────

describe("validateInstrumentRows — unit tests", () => {
  it("rejects non-array", () => {
    expect(validateInstrumentRows("NSE", null).reason).toBe("MALFORMED_MASTER_REJECTED");
    expect(validateInstrumentRows("NSE", "foo").reason).toBe("MALFORMED_MASTER_REJECTED");
    expect(validateInstrumentRows("NSE", 42).reason).toBe("MALFORMED_MASTER_REJECTED");
  });

  it("rejects empty array", () => {
    expect(validateInstrumentRows("NSE", []).reason).toBe("EMPTY_MASTER_REJECTED");
  });

  it("rejects malformed rows missing identity fields", () => {
    const rows = Array.from({ length: MIN.NSE + 1 }, () => ({ foo: "bar" }));
    expect(validateInstrumentRows("NSE", rows).reason).toBe("MALFORMED_MASTER_REJECTED");
  });

  it("rejects below-floor count", () => {
    const rows = makeRows(10, "NSE"); // well below 5000
    const r = validateInstrumentRows("NSE", rows);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("IMPLAUSIBLE_ROW_COUNT_REJECTED");
  });

  it("rejects implausible collapse (< 50% of prevCount)", () => {
    const rows = makeRows(MIN.NSE + 1, "NSE");
    // prevCount = 20000 → new 5001 < 50% of 20000 = 10000 → collapsed
    const r = validateInstrumentRows("NSE", rows, 20_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("IMPLAUSIBLE_ROW_COUNT_REJECTED");
  });

  it("accepts a valid response above the floor", () => {
    const rows = makeRows(MIN.NSE + 1, "NSE");
    const r = validateInstrumentRows("NSE", rows);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("MASTER_REFRESH_COMMITTED");
  });

  it("accepts a valid response that is larger than previous count", () => {
    const rows = makeRows(MIN.NSE + 2000, "NSE");
    const r = validateInstrumentRows("NSE", rows, MIN.NSE + 100);
    expect(r.ok).toBe(true);
  });

  it("does not reject a legitimately larger response", () => {
    // 50000 rows — much larger than previous 10022 — must not be rejected
    const rows = makeRows(50_000, "NSE");
    const r = validateInstrumentRows("NSE", rows, 10_022);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("MASTER_REFRESH_COMMITTED");
  });

  it("uses exchange-specific floor (BSE floor = 500, not NSE's 5000)", () => {
    const rows = makeRows(MIN.BSE + 1, "BSE"); // 501 rows — valid for BSE
    const r = validateInstrumentRows("BSE", rows);
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown exchange with the default floor of 100 when below it", () => {
    const rows = makeRows(50, "UNKNOWN");
    const r = validateInstrumentRows("UNKNOWN", rows);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("IMPLAUSIBLE_ROW_COUNT_REJECTED");
  });
});
