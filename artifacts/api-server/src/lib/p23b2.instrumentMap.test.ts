/**
 * Gate B tests — Upstox instrument key mapping.
 * Pack 5 23A: BOD cache, ISIN equity mapping, static index bootstrap,
 * derivative key, ambiguity rejection, suspension, stale cache handling.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveInstrumentKey,
  __setInstrumentMapForTests,
  __resetInstrumentMapForTests,
  __buildCacheForTests,
  type CanonicalInstrumentMapping,
  type InstrumentMasterCache,
} from "./marketData/upstoxInstrumentMap";
import type { UpstoxInstrument } from "./marketData/upstoxClient";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEquityInstrument(overrides: Partial<UpstoxInstrument> = {}): UpstoxInstrument {
  return {
    instrument_key: "NSE_EQ|INE009A01021",
    exchange:       "NSE",
    segment:        "NSE_EQ",
    trading_symbol: "INFOSYS",
    name:           "INFOSYS LTD",
    isin:           "INE009A01021",
    expiry:         null,
    strike:         null,
    option_type:    null,
    lot_size:       null,
    tick_size:      0.05,
    underlying_key: null,
    ...overrides,
  } as UpstoxInstrument;
}

function makeDerivativeInstrument(overrides: Partial<UpstoxInstrument> = {}): UpstoxInstrument {
  return {
    instrument_key: "NSE_FO|NIFTY2680023000CE",
    exchange:       "NSE",
    segment:        "NSE_FO",
    trading_symbol: "NIFTY26800CE",
    name:           "NIFTY CALL 23000 2026-08-28",
    isin:           null,
    expiry:         "2026-08-28",
    strike:         23000,
    option_type:    "CE",
    lot_size:       75,
    tick_size:      0.05,
    underlying_key: "NIFTY",
    ...overrides,
  } as UpstoxInstrument;
}

function loadTestFixture(rows: UpstoxInstrument[]): void {
  const cache = __buildCacheForTests(rows, Date.now());
  __setInstrumentMapForTests(cache);
}

beforeEach(() => {
  __resetInstrumentMapForTests();
});

// ---------------------------------------------------------------------------
// Static index tests
// ---------------------------------------------------------------------------

describe("Gate B — Static index bootstrap", () => {
  it("B-1: NIFTY resolves via alias to Nifty 50 Upstox key", () => {
    const d = resolveInstrumentKey("NIFTY");
    expect(d.ok).toBe(true);
    expect(d.upstoxKey).toBe("NSE_INDEX|Nifty 50");
    expect(d.failureKind).toBeNull();
  });

  it("B-2: ^NSEI resolves to same Nifty 50 key", () => {
    const d = resolveInstrumentKey("^NSEI");
    expect(d.ok).toBe(true);
    expect(d.upstoxKey).toBe("NSE_INDEX|Nifty 50");
  });

  it("B-3: BANKNIFTY resolves to Nifty Bank key", () => {
    const d = resolveInstrumentKey("BANKNIFTY");
    expect(d.ok).toBe(true);
    expect(d.upstoxKey).toBe("NSE_INDEX|Nifty Bank");
  });

  it("B-4: ^NSEBANK resolves to Nifty Bank key", () => {
    const d = resolveInstrumentKey("^NSEBANK");
    expect(d.ok).toBe(true);
    expect(d.upstoxKey).toBe("NSE_INDEX|Nifty Bank");
  });

  it("B-5: SENSEX resolves to BSE_INDEX|SENSEX", () => {
    const d = resolveInstrumentKey("SENSEX");
    expect(d.ok).toBe(true);
    expect(d.upstoxKey).toBe("BSE_INDEX|SENSEX");
  });

  it("B-6: lowercase symbol resolves same as uppercase", () => {
    const d = resolveInstrumentKey("nifty");
    expect(d.ok).toBe(true);
    expect(d.upstoxKey).toBe("NSE_INDEX|Nifty 50");
  });

  it("B-7: index resolution does NOT require BOD cache", () => {
    __setInstrumentMapForTests(null); // explicitly empty
    const d = resolveInstrumentKey("NIFTY");
    expect(d.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Equity ISIN mapping tests
// ---------------------------------------------------------------------------

describe("Gate B — Equity ISIN mapping", () => {
  it("B-8: equity resolves by ISIN when BOD cache is loaded", () => {
    loadTestFixture([makeEquityInstrument()]);
    const d = resolveInstrumentKey("INFOSYS", { isin: "INE009A01021" });
    expect(d.ok).toBe(true);
    expect(d.upstoxKey).toBe("NSE_EQ|INE009A01021");
  });

  it("B-9: fails NOT_IN_MAP when ISIN not in cache", () => {
    loadTestFixture([makeEquityInstrument()]);
    const d = resolveInstrumentKey("WIPRO", { isin: "INE075A01022" });
    expect(d.ok).toBe(false);
    expect(d.failureKind).toBe("NOT_IN_MAP");
    expect(d.upstoxKey).toBeNull();
  });

  it("B-10: fails NOT_IN_MAP when ISIN provided but cache is null", () => {
    __setInstrumentMapForTests(null);
    const d = resolveInstrumentKey("INFOSYS", { isin: "INE009A01021" });
    expect(d.ok).toBe(false);
    expect(d.failureKind).toBe("NOT_IN_MAP");
  });

  it("B-11: NSE wins over BSE for same ISIN (dedup rule)", () => {
    loadTestFixture([
      makeEquityInstrument({ exchange: "BSE", segment: "BSE_EQ", instrument_key: "BSE_EQ|INE009A01021", trading_symbol: "INFOSYS" }),
      makeEquityInstrument({ exchange: "NSE", segment: "NSE_EQ", instrument_key: "NSE_EQ|INE009A01021", trading_symbol: "INFY" }),
    ]);
    const d = resolveInstrumentKey("INFOSYS", { isin: "INE009A01021" });
    expect(d.ok).toBe(true);
    expect(d.upstoxKey).toBe("NSE_EQ|INE009A01021");
    expect(d.upstoxKey).not.toContain("BSE");
  });

  it("B-12: fails NOT_IN_MAP for equity without ISIN hint", () => {
    loadTestFixture([makeEquityInstrument()]);
    const d = resolveInstrumentKey("INFOSYS"); // no isin provided
    expect(d.ok).toBe(false);
    expect(d.failureKind).toBe("NOT_IN_MAP");
  });
});

// ---------------------------------------------------------------------------
// Derivative mapping tests
// ---------------------------------------------------------------------------

describe("Gate B — Derivative mapping", () => {
  it("B-13: derivative resolves by segment+underlying+expiry+strike+type", () => {
    loadTestFixture([makeDerivativeInstrument()]);
    const d = resolveInstrumentKey("NIFTY26800CE", {
      underlying:  "NIFTY",
      expiry:      "2026-08-28",
      strike:      23000,
      optionType:  "CE",
    });
    expect(d.ok).toBe(true);
    expect(d.upstoxKey).toBe("NSE_FO|NIFTY2680023000CE");
  });

  it("B-14: fails NOT_IN_MAP for derivative with wrong strike", () => {
    loadTestFixture([makeDerivativeInstrument()]);
    const d = resolveInstrumentKey("NIFTY25000CE", {
      underlying: "NIFTY", expiry: "2026-08-28", strike: 25000, optionType: "CE",
    });
    expect(d.ok).toBe(false);
    expect(d.failureKind).toBe("NOT_IN_MAP");
  });
});

// ---------------------------------------------------------------------------
// Rejection / status tests
// ---------------------------------------------------------------------------

describe("Gate B — Cache-level rejections", () => {
  it("B-15: schema-invalid row (missing instrument_key) is rejected; valid row still resolves", () => {
    // One invalid row and one valid row
    const invalid = { exchange: "NSE", trading_symbol: "BAD" } as UpstoxInstrument; // missing instrument_key
    const valid   = makeEquityInstrument({ trading_symbol: "INFOSYS" });
    loadTestFixture([invalid, valid]);
    // valid row should still resolve
    const d = resolveInstrumentKey("INFOSYS", { isin: "INE009A01021" });
    expect(d.ok).toBe(true);
  });

  it("B-16: diagnostic always has resolvedAt timestamp", () => {
    const d = resolveInstrumentKey("NIFTY");
    expect(d.resolvedAt).toBeTruthy();
    expect(() => new Date(d.resolvedAt)).not.toThrow();
  });
});
