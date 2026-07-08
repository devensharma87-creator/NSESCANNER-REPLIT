/**
 * Unit tests for fnoMarketShadowCapture.
 *
 * All tests are pure — no DB, no network. The schema-migration and DB-write
 * paths (`applyFoMarketShadowColumns`, `applyMarketShadowToDb`) are NOT
 * tested here because they require a live Postgres connection; integration
 * coverage belongs in the api-server DB test suite.
 *
 * Coverage:
 *   extractStrikeLtpFromChain — strike lookup + LTP validation
 *   computeMarketShadow       — gap / gapPct / shadowGrossPnl formulas
 *   captureExitMarketPremium  — all unavailability branches + happy path
 *   __resetFoMarketShadowColumnsGuardForTests — guard reset side-effect only
 */

import { describe, it, expect } from "vitest";
import {
  extractStrikeLtpFromChain,
  computeMarketShadow,
  captureExitMarketPremium,
  __resetFoMarketShadowColumnsGuardForTests,
} from "./fnoMarketShadowCapture";
import type { OcResponse } from "./optionChain";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeChain(
  overrides: Partial<OcResponse> = {},
  rows: OcResponse["rows"] = [],
): OcResponse {
  return {
    underlying: "NIFTY",
    underlyingName: "Nifty 50",
    kind: "INDEX",
    spot: 22500,
    prevClose: 22000,
    changePercent: 2.27,
    expiry: "2026-07-17",
    expiries: ["2026-07-17"],
    atmStrike: 22500,
    strikeStep: 50,
    rows,
    source: "Kite",
    generatedAt: new Date().toISOString(),
    spotSource: "kite",
    spotTrusted: true,
    ...overrides,
  };
}

function makeRow(
  strike: number,
  ceLtp?: number,
  peLtp?: number,
): OcResponse["rows"][number] {
  return {
    strike,
    ce: ceLtp !== undefined ? { ltp: ceLtp } : undefined,
    pe: peLtp !== undefined ? { ltp: peLtp } : undefined,
  };
}

function makeTradeRow(
  overrides: Partial<{
    id: string;
    strike: number;
    optionType: string;
    entryPremium: number;
    exitPremium: number;
    lots: number;
    lotSize: number;
  }> = {},
) {
  return {
    id: "trade-1",
    strike: 22500,
    optionType: "CE",
    entryPremium: 100,
    exitPremium: 60,
    lots: 10,
    lotSize: 50,
    ...overrides,
  };
}

// ─── extractStrikeLtpFromChain ────────────────────────────────────────────────

describe("extractStrikeLtpFromChain", () => {
  it("returns CE ltp when strike and type match exactly", () => {
    const chain = makeChain({}, [makeRow(22500, 120, 80)]);
    expect(extractStrikeLtpFromChain(chain, 22500, "CE")).toBe(120);
  });

  it("returns PE ltp when optionType is PE", () => {
    const chain = makeChain({}, [makeRow(22500, 120, 80)]);
    expect(extractStrikeLtpFromChain(chain, 22500, "PE")).toBe(80);
  });

  it("matches strike with floating-point jitter (within 0.05)", () => {
    const chain = makeChain({}, [makeRow(22500.0, 90, undefined)]);
    expect(extractStrikeLtpFromChain(chain, 22500.0001, "CE")).toBe(90);
  });

  it("returns null when strike not in chain rows", () => {
    const chain = makeChain({}, [makeRow(22500, 120, 80)]);
    expect(extractStrikeLtpFromChain(chain, 22600, "CE")).toBeNull();
  });

  it("returns null when CE side is missing", () => {
    const chain = makeChain({}, [makeRow(22500, undefined, 80)]);
    expect(extractStrikeLtpFromChain(chain, 22500, "CE")).toBeNull();
  });

  it("returns null when ltp is 0", () => {
    const chain = makeChain({}, [{ strike: 22500, ce: { ltp: 0 } }]);
    expect(extractStrikeLtpFromChain(chain, 22500, "CE")).toBeNull();
  });

  it("returns null when ltp is negative", () => {
    const chain = makeChain({}, [{ strike: 22500, ce: { ltp: -5 } }]);
    expect(extractStrikeLtpFromChain(chain, 22500, "CE")).toBeNull();
  });

  it("returns null when ltp is NaN", () => {
    const chain = makeChain({}, [{ strike: 22500, ce: { ltp: NaN } }]);
    expect(extractStrikeLtpFromChain(chain, 22500, "CE")).toBeNull();
  });

  it("returns null when ltp is Infinity", () => {
    const chain = makeChain({}, [{ strike: 22500, ce: { ltp: Infinity } }]);
    expect(extractStrikeLtpFromChain(chain, 22500, "CE")).toBeNull();
  });

  it("returns null when chain has empty rows array", () => {
    const chain = makeChain({}, []);
    expect(extractStrikeLtpFromChain(chain, 22500, "CE")).toBeNull();
  });
});

// ─── computeMarketShadow ─────────────────────────────────────────────────────

describe("computeMarketShadow", () => {
  it("computes positive gap when market > frozen", () => {
    const { gap, gapPct, shadowGrossPnl } = computeMarketShadow(
      120,  // marketLtp
      100,  // entryPremium
      100,  // frozenExitPremium
      10,   // lots
      50,   // lotSize
    );
    expect(gap).toBe(20);
    expect(gapPct).toBe(20);                   // 20/100*100 = 20%
    expect(shadowGrossPnl).toBe(10000);        // (120-100)*10*50
  });

  it("computes negative gap when market < frozen", () => {
    const { gap, gapPct } = computeMarketShadow(
      80,   // marketLtp
      100,  // entryPremium
      100,  // frozenExitPremium
      10, 50,
    );
    expect(gap).toBe(-20);
    expect(gapPct).toBe(-20);
  });

  it("computes zero gap when market === frozen", () => {
    const { gap, gapPct } = computeMarketShadow(100, 100, 100, 10, 50);
    expect(gap).toBe(0);
    expect(gapPct).toBe(0);
  });

  it("handles frozenExitPremium = 0 without division-by-zero (gapPct = 0)", () => {
    const { gapPct } = computeMarketShadow(50, 100, 0, 10, 50);
    expect(gapPct).toBe(0);
  });

  it("shadow gross P&L is negative when market < entry", () => {
    const { shadowGrossPnl } = computeMarketShadow(
      60,   // marketLtp
      100,  // entryPremium
      60,   // frozenExitPremium
      10, 50,
    );
    expect(shadowGrossPnl).toBe(-20000); // (60-100)*10*50
  });

  it("rounds gap to 4dp", () => {
    const { gap } = computeMarketShadow(
      100.12345,
      100,
      100,
      1, 1,
    );
    expect(String(gap)).toMatch(/^\d+\.\d{1,4}$/);
    expect(gap).toBe(0.1235); // rounded to 4dp
  });
});

// ─── captureExitMarketPremium ─────────────────────────────────────────────────

describe("captureExitMarketPremium", () => {
  it("returns CHAIN_MISSING when chain is null", () => {
    const result = captureExitMarketPremium(makeTradeRow(), null);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.unavailableReason).toBe("CHAIN_MISSING");
  });

  it("returns SOURCE_NOT_KITE when chain.spotSource is 'nse'", () => {
    const chain = makeChain({ spotSource: "nse" }, [makeRow(22500, 120)]);
    const result = captureExitMarketPremium(makeTradeRow(), chain);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.unavailableReason).toBe("SOURCE_NOT_KITE");
  });

  it("returns SOURCE_NOT_KITE when chain.spotSource is 'unavailable'", () => {
    const chain = makeChain({ spotSource: "unavailable" }, [makeRow(22500, 120)]);
    const result = captureExitMarketPremium(makeTradeRow(), chain);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.unavailableReason).toBe("SOURCE_NOT_KITE");
  });

  it("returns STRIKE_NOT_IN_CHAIN when strike absent from chain", () => {
    const chain = makeChain({}, [makeRow(22600, 90)]);
    const result = captureExitMarketPremium(makeTradeRow({ strike: 22500 }), chain);
    expect(result.available).toBe(false);
    if (!result.available)
      expect(result.unavailableReason).toBe("STRIKE_NOT_IN_CHAIN");
  });

  it("returns LTP_MISSING when strike present but CE side missing", () => {
    const chain = makeChain({}, [makeRow(22500, undefined, 80)]);
    const result = captureExitMarketPremium(
      makeTradeRow({ optionType: "CE" }),
      chain,
    );
    expect(result.available).toBe(false);
    if (!result.available) expect(result.unavailableReason).toBe("LTP_MISSING");
  });

  it("returns LTP_INVALID when ltp is 0", () => {
    const chain = makeChain({}, [{ strike: 22500, ce: { ltp: 0 } }]);
    const result = captureExitMarketPremium(makeTradeRow(), chain);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.unavailableReason).toBe("LTP_INVALID");
  });

  it("returns LTP_INVALID when ltp is negative", () => {
    const chain = makeChain({}, [{ strike: 22500, ce: { ltp: -10 } }]);
    const result = captureExitMarketPremium(makeTradeRow(), chain);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.unavailableReason).toBe("LTP_INVALID");
  });

  it("returns available=true with correct fields on happy path (CE)", () => {
    const chain = makeChain({}, [makeRow(22500, 120, 80)]);
    const row = makeTradeRow({
      strike: 22500,
      optionType: "CE",
      entryPremium: 100,
      exitPremium: 60,
      lots: 10,
      lotSize: 50,
    });
    const result = captureExitMarketPremium(row, chain);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.marketLtp).toBe(120);
      expect(result.source).toBe("KITE_CHAIN");
      expect(result.gap).toBe(60);       // 120 - 60 (frozen)
      expect(result.gapPct).toBeCloseTo(100, 1); // 60/60*100 = 100%
      expect(result.shadowGrossPnl).toBe(10000); // (120-100)*10*50
      expect(result.ageSec).toBeGreaterThanOrEqual(0);
      expect(result.asOf).toBeInstanceOf(Date);
    }
  });

  it("returns available=true for PE side", () => {
    const chain = makeChain({}, [makeRow(22500, 120, 80)]);
    const row = makeTradeRow({ optionType: "PE", entryPremium: 50, exitPremium: 40 });
    const result = captureExitMarketPremium(row, chain);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.marketLtp).toBe(80);
      expect(result.gap).toBe(40); // 80 - 40
    }
  });

  it("accepts strike as a numeric string (from DB NUMERIC type)", () => {
    const chain = makeChain({}, [makeRow(22500, 120)]);
    const row = { ...makeTradeRow(), strike: "22500.0000" as unknown as number };
    const result = captureExitMarketPremium(row, chain);
    expect(result.available).toBe(true);
  });

  it("accepts entryPremium and exitPremium as numeric strings", () => {
    const chain = makeChain({}, [makeRow(22500, 90)]);
    const row = {
      ...makeTradeRow(),
      entryPremium: "100.0000" as unknown as number,
      exitPremium: "60.0000" as unknown as number,
    };
    const result = captureExitMarketPremium(row, chain);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.gap).toBe(30); // 90 - 60
    }
  });

  it("shadow gross P&L is negative for a losing trade", () => {
    const chain = makeChain({}, [makeRow(22500, 50)]);
    const row = makeTradeRow({ entryPremium: 100, exitPremium: 60, lots: 10, lotSize: 50 });
    const result = captureExitMarketPremium(row, chain);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.shadowGrossPnl).toBe(-25000); // (50-100)*10*50
    }
  });
});

// ─── guard reset ─────────────────────────────────────────────────────────────

describe("__resetFoMarketShadowColumnsGuardForTests", () => {
  it("does not throw", () => {
    expect(() => __resetFoMarketShadowColumnsGuardForTests()).not.toThrow();
  });
});
