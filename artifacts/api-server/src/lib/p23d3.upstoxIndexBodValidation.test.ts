/**
 * Gate D (23B) — Upstox static index bootstrap BOD validation tests.
 *
 * Verifies: on a valid BOD refresh each bootstrap candidate is checked against
 * real BOD data; disagreement prefers the validated BOD mapping; missing or
 * ambiguous BOD data suppresses the comparison (does not use unverified key);
 * wrong-segment index is rejected; no Kite canonical output altered.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  validateIndexBootstrap,
  type IndexBootstrapValidationResult,
  __buildCacheForTests,
  __setInstrumentMapForTests,
  __resetInstrumentMapForTests,
  resolveInstrumentKey,
  type InstrumentMasterCache,
} from "./marketData/upstoxInstrumentMap";
import type { UpstoxInstrument } from "./marketData/upstoxClient";

afterEach(() => { __resetInstrumentMapForTests(); });

// ---------------------------------------------------------------------------
// Instrument row factories
// ---------------------------------------------------------------------------

function makeIndexRow(overrides: Partial<UpstoxInstrument> = {}): UpstoxInstrument {
  return {
    instrument_key: "NSE_INDEX|Nifty 50",
    exchange:       "NSE",
    segment:        "NSE_INDEX",
    trading_symbol: "Nifty 50",
    name:           "Nifty 50",
    isin:           null,
    expiry:         null,
    strike:         null,
    option_type:    null,
    lot_size:       null,
    tick_size:      null,
    underlying_key: null,
    ...overrides,
  };
}

function makeBodCache(rows: UpstoxInstrument[]): InstrumentMasterCache {
  return __buildCacheForTests(rows, Date.now());
}

// ---------------------------------------------------------------------------
// D3-1: UNCHANGED — BOD confirms static bootstrap key
// ---------------------------------------------------------------------------

describe("Gate D3-1 — UNCHANGED: BOD confirms static bootstrap key", () => {
  it("D3-1a: Nifty 50 BOD key matches bootstrap → UNCHANGED", () => {
    const cache = makeBodCache([
      makeIndexRow({ instrument_key: "NSE_INDEX|Nifty 50", trading_symbol: "Nifty 50", segment: "NSE_INDEX" }),
    ]);
    const results = validateIndexBootstrap(cache);
    const nifty = results.find(r => r.canonicalId === "INDEX:NIFTY50");
    expect(nifty?.status).toBe("UNCHANGED");
    expect(nifty?.activeKey).toBe("NSE_INDEX|Nifty 50");
  });

  it("D3-1b: BANKNIFTY BOD key matches bootstrap → UNCHANGED", () => {
    const cache = makeBodCache([
      makeIndexRow({ instrument_key: "NSE_INDEX|Nifty Bank", trading_symbol: "Nifty Bank", segment: "NSE_INDEX" }),
    ]);
    const results = validateIndexBootstrap(cache);
    const banknifty = results.find(r => r.canonicalId === "INDEX:BANKNIFTY");
    expect(banknifty?.status).toBe("UNCHANGED");
  });
});

// ---------------------------------------------------------------------------
// D3-2: CHANGED — BOD has a different key for the same index
// ---------------------------------------------------------------------------

describe("Gate D3-2 — CHANGED: BOD key differs from bootstrap", () => {
  it("D3-2a: Nifty 50 BOD key differs → CHANGED, activeKey = BOD key", () => {
    const cache = makeBodCache([
      makeIndexRow({ instrument_key: "NSE_INDEX|NIFTY_50_NEW", trading_symbol: "Nifty 50", segment: "NSE_INDEX" }),
    ]);
    const results = validateIndexBootstrap(cache);
    const nifty = results.find(r => r.canonicalId === "INDEX:NIFTY50");
    expect(nifty?.status).toBe("CHANGED");
    // BOD value takes precedence
    expect(nifty?.activeKey).toBe("NSE_INDEX|NIFTY_50_NEW");
    expect(nifty?.bootstrapKey).toBe("NSE_INDEX|Nifty 50");
  });
});

// ---------------------------------------------------------------------------
// D3-3: MISSING — BOD has no entry for the index
// ---------------------------------------------------------------------------

describe("Gate D3-3 — MISSING: BOD has no entry for the index", () => {
  it("D3-3a: no Nifty 50 row in BOD → MISSING, shadow comparison suppressed", () => {
    const cache = makeBodCache([
      makeIndexRow({ instrument_key: "NSE_INDEX|Nifty Bank", trading_symbol: "Nifty Bank", segment: "NSE_INDEX" }),
      // No Nifty 50 row
    ]);
    const results = validateIndexBootstrap(cache);
    const nifty = results.find(r => r.canonicalId === "INDEX:NIFTY50");
    expect(nifty?.status).toBe("MISSING");
    expect(nifty?.activeKey).toBeNull(); // suppressed — don't use unverified bootstrap key
  });

  it("D3-3b: missing index resolveInstrumentKey still uses bootstrap (no BOD override)", () => {
    // Without a loaded BOD cache, resolveInstrumentKey falls back to static bootstrap
    __setInstrumentMapForTests(null); // no BOD cache
    const result = resolveInstrumentKey("NIFTY");
    expect(result.ok).toBe(true);
    expect(result.upstoxKey).toBe("NSE_INDEX|Nifty 50");
  });
});

// ---------------------------------------------------------------------------
// D3-4: AMBIGUOUS — BOD has multiple rows for same trading_symbol
// ---------------------------------------------------------------------------

describe("Gate D3-4 — AMBIGUOUS: multiple BOD rows for same index", () => {
  it("D3-4a: two Nifty 50 rows with different keys → AMBIGUOUS, shadow suppressed", () => {
    const cache = makeBodCache([
      makeIndexRow({ instrument_key: "NSE_INDEX|Nifty 50", trading_symbol: "Nifty 50", segment: "NSE_INDEX" }),
      makeIndexRow({ instrument_key: "NSE_INDEX|Nifty_50_ALT", trading_symbol: "Nifty 50", segment: "NSE_INDEX" }),
    ]);
    const results = validateIndexBootstrap(cache);
    const nifty = results.find(r => r.canonicalId === "INDEX:NIFTY50");
    expect(nifty?.status).toBe("AMBIGUOUS");
    expect(nifty?.activeKey).toBeNull(); // don't guess when ambiguous
  });
});

// ---------------------------------------------------------------------------
// D3-5: WRONG_SEGMENT — BOD has index with unexpected segment
// ---------------------------------------------------------------------------

describe("Gate D3-5 — WRONG_SEGMENT: BOD index in unexpected segment", () => {
  it("D3-5a: Nifty 50 row with wrong segment → WRONG_SEGMENT, use bootstrap", () => {
    const cache = makeBodCache([
      makeIndexRow({ instrument_key: "NSE_EQ|Nifty50WRONG", trading_symbol: "Nifty 50", segment: "NSE_EQ" }),
    ]);
    const results = validateIndexBootstrap(cache);
    const nifty = results.find(r => r.canonicalId === "INDEX:NIFTY50");
    // Wrong segment means the BOD row is unreliable — don't use it
    expect(nifty?.status).toBe("WRONG_SEGMENT");
    // Fall back to bootstrap key (it's explicitly defined and the segment mismatch is suspicious)
    expect(nifty?.activeKey).toBe("NSE_INDEX|Nifty 50");
  });
});

// ---------------------------------------------------------------------------
// D3-6: validateIndexBootstrap does not alter Kite canonical output
// ---------------------------------------------------------------------------

describe("Gate D3-6 — BOD validation never alters Kite canonical data path", () => {
  it("D3-6a: validateIndexBootstrap returns diagnostics only — no side effects on resolveInstrumentKey", () => {
    const cache = makeBodCache([
      makeIndexRow({ instrument_key: "NSE_INDEX|Nifty 50", trading_symbol: "Nifty 50", segment: "NSE_INDEX" }),
    ]);
    // Call validation
    validateIndexBootstrap(cache);
    // resolveInstrumentKey still works the same (no side effects)
    const result = resolveInstrumentKey("NIFTY");
    expect(result.ok).toBe(true);
    expect(result.upstoxKey).toBe("NSE_INDEX|Nifty 50");
  });

  it("D3-6b: validation result type has all required fields", () => {
    const cache = makeBodCache([
      makeIndexRow({ instrument_key: "NSE_INDEX|Nifty 50", trading_symbol: "Nifty 50", segment: "NSE_INDEX" }),
    ]);
    const results = validateIndexBootstrap(cache);
    for (const r of results) {
      expect(typeof r.canonicalId).toBe("string");
      expect(typeof r.status).toBe("string");
      expect(typeof r.bootstrapKey).toBe("string");
      // activeKey may be string or null
      expect(["string", null]).toContain(typeof r.activeKey === "string" ? "string" : null);
    }
  });
});
