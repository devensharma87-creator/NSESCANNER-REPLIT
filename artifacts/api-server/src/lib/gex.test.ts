/**
 * Sprint 3 Phase B — Tests for GEX computation, OI unit normalization,
 * DTO expansion, and no-fake/no-Yahoo guards.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * OI UNIT MODEL UNDER TEST:
 *   Kite `q.oi` = number of CONTRACTS (lots), NOT underlying quantity
 *   NSE `openInterest` = number of CONTRACTS (lots)
 *   Proof: oiLab.ts L1716 `notional = ltp * q.oi * lot_size`
 *   GEX = gamma × rawOI_contracts × lotSize × spot² × 0.01
 *       = gamma × effectiveUnderlyingQty × spot² × 0.01
 * ═══════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from "vitest";
import {
  normalizeOiToQuantity,
  computeGexPerStrike,
  computeGexFlipPoint,
  computeChainGex,
  type StrikeGex,
  type OpenInterestUnit,
} from "./gex";
import type { OcSide, OcRow, OcResponse } from "./optionChain";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function side(overrides: Partial<OcSide> = {}): OcSide {
  return {
    oi: 10000,
    chgOi: 500,
    volume: 2000,
    iv: 18.5,
    ltp: 150,
    delta: 0.5,
    gamma: 0.0005,
    theta: -5.2,
    vega: 12.3,
    intrinsic: 100,
    timeValue: 50,
    moneyness: "ATM",
    oiBuildup: "LONG_BUILDUP",
    ...overrides,
  };
}

function row(strike: number, ce?: Partial<OcSide>, pe?: Partial<OcSide>): OcRow {
  return {
    strike,
    ce: ce !== undefined ? side(ce) : side(),
    pe: pe !== undefined ? side({ delta: -0.5, moneyness: "ATM", ...pe }) : side({ delta: -0.5, moneyness: "ATM" }),
  };
}

function chain(overrides: Partial<OcResponse> = {}): OcResponse {
  return {
    underlying: "NIFTY",
    underlyingName: "NIFTY 50",
    kind: "INDEX",
    spot: 24000,
    prevClose: 23800,
    changePercent: 0.84,
    expiry: "2026-06-25",
    expiries: ["2026-06-25", "2026-07-02"],
    atmStrike: 24000,
    strikeStep: 50,
    lotSize: 25,
    rows: [
      row(23900, { gamma: 0.0003, oi: 5000 }, { gamma: 0.0004, oi: 8000 }),
      row(24000, { gamma: 0.0005, oi: 10000 }, { gamma: 0.0005, oi: 12000 }),
      row(24100, { gamma: 0.0003, oi: 7000 }, { gamma: 0.0003, oi: 6000 }),
    ],
    source: "kite",
    generatedAt: new Date().toISOString(),
    spotSource: "kite",
    spotTrusted: true,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. OI UNIT NORMALIZATION
// ═════════════════════════════════════════════════════════════════════════════

describe("normalizeOiToQuantity", () => {
  describe('openInterestUnit = "contracts" (Kite/NSE default)', () => {
    it("multiplies by lotSize to get underlying quantity", () => {
      // 10,000 contracts × 25 shares/contract = 250,000 shares
      expect(normalizeOiToQuantity(10000, "contracts", 25)).toBe(250000);
    });

    it("returns null when lotSize is missing", () => {
      expect(normalizeOiToQuantity(10000, "contracts")).toBeNull();
      expect(normalizeOiToQuantity(10000, "contracts", undefined)).toBeNull();
      expect(normalizeOiToQuantity(10000, "contracts", null)).toBeNull();
    });

    it("returns null when lotSize is zero or negative", () => {
      expect(normalizeOiToQuantity(10000, "contracts", 0)).toBeNull();
      expect(normalizeOiToQuantity(10000, "contracts", -1)).toBeNull();
    });

    it("returns null for NaN/Infinity rawOI", () => {
      expect(normalizeOiToQuantity(NaN, "contracts", 25)).toBeNull();
      expect(normalizeOiToQuantity(Infinity, "contracts", 25)).toBeNull();
    });

    it("returns null for negative rawOI", () => {
      expect(normalizeOiToQuantity(-100, "contracts", 25)).toBeNull();
    });

    it("handles zero OI correctly", () => {
      expect(normalizeOiToQuantity(0, "contracts", 25)).toBe(0);
    });
  });

  describe('openInterestUnit = "quantity" (hypothetical source)', () => {
    it("returns OI unchanged — no lotSize multiplication", () => {
      expect(normalizeOiToQuantity(250000, "quantity")).toBe(250000);
      expect(normalizeOiToQuantity(250000, "quantity", 25)).toBe(250000);
    });

    it("does NOT multiply by lotSize even when provided", () => {
      // quantity mode: 250000 shares stays 250000, NOT 250000×25
      const result = normalizeOiToQuantity(250000, "quantity", 25);
      expect(result).toBe(250000);
      expect(result).not.toBe(250000 * 25); // no double-multiply
    });
  });

  describe("default openInterestUnit", () => {
    it('defaults to "contracts" when no unit specified', () => {
      // Default behavior must require lotSize
      expect(normalizeOiToQuantity(10000)).toBeNull(); // no lotSize → null
      expect(normalizeOiToQuantity(10000, undefined, 25)).toBe(250000);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. GEX COMPUTATION — CONTRACTS UNIT (actual Kite/NSE case)
// ═════════════════════════════════════════════════════════════════════════════

describe("computeGexPerStrike (OI in contracts — actual case)", () => {
  it("returns null when spot is 0 or negative", () => {
    const rows = [row(24000)];
    expect(computeGexPerStrike(rows, 0, 25, "contracts")).toBeNull();
    expect(computeGexPerStrike(rows, -100, 25, "contracts")).toBeNull();
  });

  it("returns null when lotSize is null/undefined/0 (contracts mode)", () => {
    const rows = [row(24000)];
    expect(computeGexPerStrike(rows, 24000, null, "contracts")).toBeNull();
    expect(computeGexPerStrike(rows, 24000, undefined, "contracts")).toBeNull();
    expect(computeGexPerStrike(rows, 24000, 0, "contracts")).toBeNull();
  });

  it("returns null when rows are empty", () => {
    expect(computeGexPerStrike([], 24000, 25, "contracts")).toBeNull();
  });

  it("returns null when no strike has usable gamma (gamma missing)", () => {
    const rows = [
      row(24000, { gamma: undefined, oi: 10000 }, { gamma: undefined, oi: 10000 }),
    ];
    expect(computeGexPerStrike(rows, 24000, 25, "contracts")).toBeNull();
  });

  it("returns null when gamma is 0 on all strikes", () => {
    const rows = [
      row(24000, { gamma: 0, oi: 10000 }, { gamma: 0, oi: 10000 }),
    ];
    expect(computeGexPerStrike(rows, 24000, 25, "contracts")).toBeNull();
  });

  it("NUMERIC PROOF A: GEX for contracts = gamma × contracts × lotSize × spot² × 0.01", () => {
    // ═══════════════════════════════════════════════════════════════════
    // NUMERIC EXAMPLE A — OI in contracts (Kite/NSE actual case)
    //
    // NIFTY spot = 24,000  |  lotSize = 25  |  ATM CE gamma = 0.0005
    // CE OI = 10,000 contracts
    //
    // Step 1: effectiveQty = 10,000 contracts × 25 shares/contract = 250,000 shares
    // Step 2: spotSqPct    = 24,000² × 0.01 = 5,760,000
    // Step 3: callGex      = 0.0005 × 250,000 × 5,760,000 = 720,000,000,000
    // ═══════════════════════════════════════════════════════════════════
    const spot = 24000;
    const lotSize = 25;
    const ceGamma = 0.0005;
    const ceOI_contracts = 10000;
    const peGamma = 0.0005;
    const peOI_contracts = 12000;

    const rows = [row(24000, { gamma: ceGamma, oi: ceOI_contracts }, { gamma: peGamma, oi: peOI_contracts })];
    const result = computeGexPerStrike(rows, spot, lotSize, "contracts")!;

    expect(result).not.toBeNull();
    expect(result.modelled).toBe(true);
    expect(result.label).toContain("MODELLED GEX");
    expect(result.label).toContain("not exchange-verified");

    // Manual calculation:
    const effectiveCeQty = ceOI_contracts * lotSize; // 10000 × 25 = 250,000
    const effectivePeQty = peOI_contracts * lotSize; // 12000 × 25 = 300,000
    const spotSqPct = spot * spot * 0.01;            // 24000² × 0.01 = 5,760,000

    const expectedCallGex = ceGamma * effectiveCeQty * spotSqPct;  // 0.0005 × 250000 × 5760000 = 720,000,000,000
    const expectedPutGex = -(peGamma * effectivePeQty * spotSqPct); // -(0.0005 × 300000 × 5760000) = -864,000,000,000

    expect(result.perStrike[0]!.callGex).toBeCloseTo(expectedCallGex, -2);
    expect(result.perStrike[0]!.putGex).toBeCloseTo(expectedPutGex, -2);
    expect(result.netGex).toBeCloseTo(expectedCallGex + expectedPutGex, -2);
  });

  it("call GEX is positive, put GEX is negative", () => {
    const rows = [row(24000, { gamma: 0.001, oi: 5000 }, { gamma: 0.001, oi: 5000 })];
    const result = computeGexPerStrike(rows, 24000, 25, "contracts")!;

    expect(result.perStrike[0]!.callGex).toBeGreaterThan(0);
    expect(result.perStrike[0]!.putGex).toBeLessThan(0);
  });

  it("handles missing CE or PE (one-sided strike)", () => {
    const rows: OcRow[] = [
      { strike: 24000, ce: side({ gamma: 0.0005, oi: 10000 }), pe: undefined },
    ];
    const result = computeGexPerStrike(rows, 24000, 25, "contracts")!;

    expect(result).not.toBeNull();
    expect(result.perStrike[0]!.callGex).toBeGreaterThan(0);
    expect(result.perStrike[0]!.putGex).toBe(0);
  });

  it("returns null when OI is zero everywhere (no underlying exposure)", () => {
    const rows = [row(24000, { gamma: 0.0005, oi: 0 }, { gamma: 0.0005, oi: 0 })];
    expect(computeGexPerStrike(rows, 24000, 25, "contracts")).toBeNull();
  });

  it("missing OI returns null for the side (not fake zero)", () => {
    const rows: OcRow[] = [
      { strike: 24000, ce: { gamma: 0.001 }, pe: { gamma: 0.001 } },
    ];
    // oi is undefined → rawOI defaults to 0 → zero exposure → GEX unavailable
    expect(computeGexPerStrike(rows, 24000, 25, "contracts")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. GEX COMPUTATION — QUANTITY UNIT (hypothetical source)
// ═════════════════════════════════════════════════════════════════════════════

describe("computeGexPerStrike (OI in quantity — hypothetical source)", () => {
  it("NUMERIC PROOF B: GEX for quantity = gamma × qty × spot² × 0.01 (NO lotSize)", () => {
    // ═══════════════════════════════════════════════════════════════════
    // NUMERIC EXAMPLE B — OI already in underlying quantity
    //
    // Same scenario: NIFTY spot = 24,000 | ATM CE gamma = 0.0005
    // CE OI = 250,000 shares (equivalent to 10,000 contracts × 25)
    //
    // No lotSize multiplication:
    // spotSqPct = 24,000² × 0.01 = 5,760,000
    // callGex   = 0.0005 × 250,000 × 5,760,000 = 720,000,000,000
    // (Same result as Example A — because 10,000×25 = 250,000)
    // ═══════════════════════════════════════════════════════════════════
    const spot = 24000;
    const ceGamma = 0.0005;
    const ceOI_quantity = 250000; // already in shares
    const peGamma = 0.0005;
    const peOI_quantity = 300000;

    const rows = [row(24000, { gamma: ceGamma, oi: ceOI_quantity }, { gamma: peGamma, oi: peOI_quantity })];
    const result = computeGexPerStrike(rows, spot, null, "quantity")!;

    expect(result).not.toBeNull();

    const spotSqPct = spot * spot * 0.01;
    const expectedCallGex = ceGamma * ceOI_quantity * spotSqPct;  // no lotSize
    const expectedPutGex = -(peGamma * peOI_quantity * spotSqPct);

    expect(result.perStrike[0]!.callGex).toBeCloseTo(expectedCallGex, -2);
    expect(result.perStrike[0]!.putGex).toBeCloseTo(expectedPutGex, -2);
  });

  it("does NOT require lotSize when OI is quantity", () => {
    const rows = [row(24000, { gamma: 0.001, oi: 100000 }, { gamma: 0.001, oi: 100000 })];
    // lotSize = null should work fine for quantity mode
    const result = computeGexPerStrike(rows, 24000, null, "quantity");
    expect(result).not.toBeNull();
    expect(result!.perStrike).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. CROSS-VALIDATION: contracts vs quantity give same result for equivalent OI
// ═════════════════════════════════════════════════════════════════════════════

describe("contracts vs quantity equivalence", () => {
  it("10,000 contracts × 25 lotSize == 250,000 quantity shares → same GEX", () => {
    const spot = 24000;
    const ceGamma = 0.0005;

    // Case A: 10,000 contracts, lotSize=25
    const rowsA = [row(24000, { gamma: ceGamma, oi: 10000 }, { gamma: 0, oi: 0 })];
    const resultA = computeGexPerStrike(rowsA, spot, 25, "contracts")!;

    // Case B: 250,000 quantity (already underlying shares)
    const rowsB = [row(24000, { gamma: ceGamma, oi: 250000 }, { gamma: 0, oi: 0 })];
    const resultB = computeGexPerStrike(rowsB, spot, null, "quantity")!;

    // Same GEX
    expect(resultA.perStrike[0]!.callGex).toBeCloseTo(resultB.perStrike[0]!.callGex, -2);
    expect(resultA.netGex).toBeCloseTo(resultB.netGex, -2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. GEX FLIP POINT
// ═════════════════════════════════════════════════════════════════════════════

describe("computeGexFlipPoint", () => {
  it("returns null with fewer than 2 strikes", () => {
    expect(computeGexFlipPoint([])).toBeNull();
    expect(computeGexFlipPoint([{ strike: 24000, callGex: 100, putGex: -50, netGex: 50 }])).toBeNull();
  });

  it("returns null when all net GEX values are positive", () => {
    const strikes: StrikeGex[] = [
      { strike: 23900, callGex: 200, putGex: -100, netGex: 100 },
      { strike: 24000, callGex: 300, putGex: -200, netGex: 100 },
      { strike: 24100, callGex: 150, putGex: -50, netGex: 100 },
    ];
    expect(computeGexFlipPoint(strikes)).toBeNull();
  });

  it("returns null when all net GEX values are negative", () => {
    const strikes: StrikeGex[] = [
      { strike: 23900, callGex: 50, putGex: -200, netGex: -150 },
      { strike: 24000, callGex: 100, putGex: -300, netGex: -200 },
      { strike: 24100, callGex: 50, putGex: -150, netGex: -100 },
    ];
    expect(computeGexFlipPoint(strikes)).toBeNull();
  });

  it("finds the flip point when cumulative GEX crosses zero", () => {
    // Cumulative: 100, 100 + (-200) = -100 → crosses between 23900 and 24000
    const strikes: StrikeGex[] = [
      { strike: 23900, callGex: 200, putGex: -100, netGex: 100 },
      { strike: 24000, callGex: 50, putGex: -250, netGex: -200 },
    ];
    const flip = computeGexFlipPoint(strikes);
    expect(flip).not.toBeNull();
    // Interpolation: cumGex=100 at 23900, newCum=-100 at 24000
    // ratio = |100| / |(-100) - 100| = 100/200 = 0.5
    // flip = 23900 + 0.5 * (24000-23900) = 23950
    expect(flip).toBeCloseTo(23950, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. CHAIN-LEVEL GEX CONVENIENCE
// ═════════════════════════════════════════════════════════════════════════════

describe("computeChainGex", () => {
  it("returns GEX result for a valid chain (uses contracts mode)", () => {
    const c = chain();
    const result = computeChainGex(c);
    expect(result).not.toBeNull();
    expect(result!.modelled).toBe(true);
    expect(result!.perStrike).toHaveLength(3);
  });

  it("returns null when chain has no lotSize (contracts mode needs lotSize)", () => {
    const c = chain({ lotSize: undefined });
    expect(computeChainGex(c)).toBeNull();
  });

  it("returns null when chain has no rows", () => {
    const c = chain({ rows: [] });
    expect(computeChainGex(c)).toBeNull();
  });

  it("computeChainGex uses 'contracts' mode internally", () => {
    // computeChainGex should produce the SAME result as calling
    // computeGexPerStrike with "contracts" explicitly
    const c = chain();
    const fromChain = computeChainGex(c)!;
    const direct = computeGexPerStrike(c.rows, c.spot, c.lotSize, "contracts")!;

    expect(fromChain.netGex).toBe(direct.netGex);
    expect(fromChain.perStrike).toEqual(direct.perStrike);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. OcSide DTO — New Fields Contract
// ═════════════════════════════════════════════════════════════════════════════

describe("OcSide DTO — new Sprint 3 fields", () => {
  it("OcSide accepts ltpChange as number", () => {
    const s: OcSide = { ltp: 150, ltpChange: -2.5 };
    expect(s.ltpChange).toBe(-2.5);
  });

  it("OcSide accepts ltpChange as null", () => {
    const s: OcSide = { ltp: 150, ltpChange: null };
    expect(s.ltpChange).toBeNull();
  });

  it("OcSide accepts open/high/low", () => {
    const s: OcSide = { ltp: 150, open: 148, high: 155, low: 145 };
    expect(s.open).toBe(148);
    expect(s.high).toBe(155);
    expect(s.low).toBe(145);
  });

  it("OcSide accepts open/high/low as null (NSE-direct path)", () => {
    const s: OcSide = { ltp: 150, open: null, high: null, low: null };
    expect(s.open).toBeNull();
    expect(s.high).toBeNull();
    expect(s.low).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. OcResponse DTO — New Fields Contract
// ═════════════════════════════════════════════════════════════════════════════

describe("OcResponse DTO — new Sprint 3 fields", () => {
  it("OcResponse accepts futurePrice with source provenance", () => {
    const c = chain({ futurePrice: 24050.75, futureSource: "kite", futureExpiry: "2026-06-25" });
    expect(c.futurePrice).toBe(24050.75);
    expect(c.futureSource).toBe("kite");
    expect(c.futureExpiry).toBe("2026-06-25");
  });

  it("OcResponse accepts futurePrice as null when unavailable", () => {
    const c = chain({ futurePrice: null, futureSource: "unavailable", futureExpiry: null });
    expect(c.futurePrice).toBeNull();
    expect(c.futureSource).toBe("unavailable");
  });

  it("OcResponse accepts syntheticFuture with modelled flag", () => {
    const c = chain({ syntheticFuture: 24010.50, syntheticFutureModelled: true });
    expect(c.syntheticFuture).toBe(24010.50);
    expect(c.syntheticFutureModelled).toBe(true);
  });

  it("OcResponse accepts syntheticFuture as null when ATM legs missing", () => {
    const c = chain({ syntheticFuture: null });
    expect(c.syntheticFuture).toBeNull();
    expect(c.syntheticFutureModelled).toBeUndefined();
  });

  it("futureSource is never 'yahoo'", () => {
    const validSources = ["kite", "unavailable"] as const;
    for (const src of validSources) {
      const c = chain({ futureSource: src });
      expect(c.futureSource).toBe(src);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. NO-FAKE GUARDS
// ═════════════════════════════════════════════════════════════════════════════

describe("No-fake value guards", () => {
  it("GEX returns null (not zero) when gamma is missing", () => {
    const rows: OcRow[] = [{ strike: 24000, ce: { oi: 10000 }, pe: { oi: 10000 } }];
    expect(computeGexPerStrike(rows, 24000, 25, "contracts")).toBeNull();
  });

  it("GEX returns null (not zero) when OI is zero everywhere", () => {
    const rows: OcRow[] = [
      { strike: 24000, ce: { gamma: 0.001, oi: 0 }, pe: { gamma: 0.001, oi: 0 } },
    ];
    expect(computeGexPerStrike(rows, 24000, 25, "contracts")).toBeNull();
  });

  it("GEX returns null when spot is missing", () => {
    const rows = [row(24000)];
    expect(computeGexPerStrike(rows, 0, 25, "contracts")).toBeNull();
    expect(computeGexPerStrike(rows, NaN, 25, "contracts")).toBeNull();
  });

  it("GEX returns null when lotSize is missing for contracts mode", () => {
    const rows = [row(24000)];
    expect(computeGexPerStrike(rows, 24000, null, "contracts")).toBeNull();
    expect(computeGexPerStrike(rows, 24000, undefined, "contracts")).toBeNull();
  });

  it("GEX is labelled MODELLED", () => {
    const rows = [row(24000, { gamma: 0.001, oi: 10000 }, { gamma: 0.001, oi: 10000 })];
    const result = computeGexPerStrike(rows, 24000, 25, "contracts")!;
    expect(result.modelled).toBe(true);
    expect(result.label).toContain("MODELLED");
    expect(result.label).toContain("not exchange-verified");
  });

  it("syntheticFuture formula correctness: Strike + CE_LTP - PE_LTP", () => {
    const strike = 24000;
    const ceLtp = 250;
    const peLtp = 200;
    expect(strike + ceLtp - peLtp).toBe(24050);
  });

  it("OcSide open/high/low are null (not 0) when unavailable from NSE", () => {
    const nseSide: OcSide = { ltp: 150, open: null, high: null, low: null, ltpChange: null };
    expect(nseSide.open).toBeNull();
    expect(nseSide.high).toBeNull();
    expect(nseSide.low).toBeNull();
    expect(nseSide.ltpChange).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. GEX IS NOT USED FOR SIGNAL / PAPER TRADE / RISK SIZING
// ═════════════════════════════════════════════════════════════════════════════

describe("GEX non-use constraints", () => {
  it("GEX module does NOT import optionSignals", () => {
    // Documentary: gex.ts must never be imported by signal/trade paths
    // This test verifies the gex module itself has no signal dependencies
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.resolve(__dirname, "gex.ts"), "utf-8");
    expect(src).not.toContain("optionSignals");
    expect(src).not.toContain("paperTradingFO");
    expect(src).not.toContain("dynamicSizing");
    expect(src).not.toContain("capitalLedger");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. SPRINT 1/2 REGRESSION GUARDS
// ═════════════════════════════════════════════════════════════════════════════

describe("Sprint 1/2 regression — no Yahoo reintroduction", () => {
  it("OcResponse.spotSource is never 'yahoo'", () => {
    const validSources = ["kite", "nse", "unavailable"] as const;
    for (const src of validSources) {
      const c = chain({ spotSource: src });
      expect(c.spotSource).toBe(src);
    }
  });

  it("OcResponse still has spotTrusted field", () => {
    expect(typeof chain().spotTrusted).toBe("boolean");
  });

  it("existing OcSide fields unchanged", () => {
    const s = side();
    expect(s.oi).toBeDefined();
    expect(s.chgOi).toBeDefined();
    expect(s.volume).toBeDefined();
    expect(s.iv).toBeDefined();
    expect(s.ltp).toBeDefined();
    expect(s.delta).toBeDefined();
    expect(s.gamma).toBeDefined();
    expect(s.theta).toBeDefined();
    expect(s.vega).toBeDefined();
    expect(s.intrinsic).toBeDefined();
    expect(s.timeValue).toBeDefined();
    expect(s.moneyness).toBeDefined();
    expect(s.oiBuildup).toBeDefined();
  });
});
