/**
 * P17b — Shadow F&O cost model tests.
 *
 * The cost model is pure / deterministic / never throws. These tests
 * lock in the formula, exercise CE+PE/zero-qty/invalid-premium paths,
 * confirm spread+slippage scaling, confirm gross-vs-net derivation,
 * and confirm the feature flag toggles correctly.
 *
 * The reporting layer (`fnoShadowCosts.ts`) is NOT covered here
 * because it requires a live DB; the daily-summary tests already
 * exercise the same DB-fetch pattern.
 *
 * IMPORTANT: these are SHADOW / REPORTING-ONLY assertions. None of the
 * trading-decision paths consume this module.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FNO_COST_PARAMS,
  computeFnoTradeCost,
  isShadowCostsEnabled,
} from "./fnoCostModel";

describe("FNO_COST_PARAMS — constants block (locked formula inputs)", () => {
  it("exposes every published parameter as a finite positive number", () => {
    for (const [k, v] of Object.entries(FNO_COST_PARAMS)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(k).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("computeFnoTradeCost — happy path (CE round trip)", () => {
  const input = {
    entryPremium: 100,
    exitPremium: 120,
    lots: 10,
    lotSize: 25,
  };
  const r = computeFnoTradeCost(input);

  it("flags the result as computable", () => {
    expect(r.computable).toBe(true);
    expect(r.quantity).toBe(250);
  });

  it("turnover legs equal premium × qty per side", () => {
    expect(r.buyTurnover).toBe(100 * 250);
    expect(r.sellTurnover).toBe(120 * 250);
    expect(r.totalTurnover).toBe(r.buyTurnover + r.sellTurnover);
  });

  it("brokerage is 2 sides × flat ₹20 when exit is known", () => {
    expect(r.brokerage).toBe(40);
  });

  it("STT is the published rate × sell turnover only", () => {
    expect(r.stt).toBeCloseTo(120 * 250 * FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM, 6);
  });

  it("exchange + SEBI are charged on total turnover", () => {
    expect(r.exchangeTxn).toBeCloseTo(r.totalTurnover * FNO_COST_PARAMS.EXCHANGE_TXN_RATE, 6);
    expect(r.sebi).toBeCloseTo(r.totalTurnover * FNO_COST_PARAMS.SEBI_RATE, 6);
  });

  it("GST is 18% of (brokerage + exchange + SEBI)", () => {
    expect(r.gst).toBeCloseTo((r.brokerage + r.exchangeTxn + r.sebi) * 0.18, 6);
  });

  it("stamp duty is charged on buy side only", () => {
    expect(r.stampDuty).toBeCloseTo(r.buyTurnover * FNO_COST_PARAMS.STAMP_DUTY_RATE_BUY, 6);
  });

  it("spread + slippage scale by per-side bps on total turnover", () => {
    expect(r.spreadCost).toBeCloseTo(
      r.totalTurnover * (FNO_COST_PARAMS.SPREAD_BPS_PER_SIDE / 10_000),
      6,
    );
    expect(r.slippageCost).toBeCloseTo(
      r.totalTurnover * (FNO_COST_PARAMS.SLIPPAGE_BPS_PER_SIDE / 10_000),
      6,
    );
  });

  it("totalCost equals the sum of all components (no double-count, no missing)", () => {
    const sum =
      r.brokerage + r.stt + r.exchangeTxn + r.sebi + r.gst + r.stampDuty +
      r.spreadCost + r.slippageCost;
    expect(r.totalCost).toBeCloseTo(sum, 6);
  });

  it("gross P&L = (exit - entry) × qty; net = gross - totalCost", () => {
    expect(r.grossPnl).toBe((120 - 100) * 250);
    expect(r.netPnl).toBeCloseTo(r.grossPnl! - r.totalCost, 6);
  });

  it("costPctOfPremium = totalCost / buyTurnover", () => {
    expect(r.costPctOfPremium).toBeCloseTo(r.totalCost / r.buyTurnover, 6);
  });

  it("yields a strictly smaller netPnl than grossPnl (costs are always > 0)", () => {
    expect(r.netPnl!).toBeLessThan(r.grossPnl!);
    expect(r.totalCost).toBeGreaterThan(0);
  });
});

describe("computeFnoTradeCost — PE / bearish round trip behaves identically (long premium model)", () => {
  it("matches the CE result for the same numeric inputs", () => {
    const ce = computeFnoTradeCost({ entryPremium: 80, exitPremium: 60, lots: 5, lotSize: 50 });
    const pe = computeFnoTradeCost({ entryPremium: 80, exitPremium: 60, lots: 5, lotSize: 50 });
    expect(pe).toStrictEqual(ce);
    expect(ce.grossPnl).toBe((60 - 80) * 250);
    expect(ce.netPnl!).toBeLessThan(ce.grossPnl!);
  });
});

describe("computeFnoTradeCost — open / unknown exit", () => {
  it("returns gross/net = null and a 1-side brokerage when exit is null", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: null, lots: 10, lotSize: 25 });
    expect(r.computable).toBe(true);
    expect(r.sellTurnover).toBe(0);
    expect(r.grossPnl).toBeNull();
    expect(r.netPnl).toBeNull();
    expect(r.brokerage).toBe(FNO_COST_PARAMS.BROKERAGE_PER_SIDE_INR);
    expect(r.stt).toBe(0);
  });
});

describe("computeFnoTradeCost — expired ITM that decays to zero", () => {
  it("treats exit=0 as a known closing price (sell-side STT still computed off 0)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 0, lots: 10, lotSize: 25 });
    // exit=0 means the option expired worthless — sell-side turnover = 0,
    // sell-side STT = 0, but brokerage covers BOTH sides because the
    // position was squared up (exit known).
    expect(r.brokerage).toBe(FNO_COST_PARAMS.BROKERAGE_PER_SIDE_INR * 2);
    expect(r.stt).toBe(0);
    expect(r.grossPnl).toBe((0 - 100) * 250);
    expect(r.netPnl!).toBeLessThan(r.grossPnl!);
  });
});

describe("computeFnoTradeCost — degenerate inputs (defensive)", () => {
  it("returns a non-computable zero result when entry premium is invalid", () => {
    for (const bad of [0, -1, NaN, Infinity, null as unknown as number, undefined as unknown as number]) {
      const r = computeFnoTradeCost({ entryPremium: bad, exitPremium: 50, lots: 10, lotSize: 25 });
      expect(r.computable).toBe(false);
      expect(r.totalCost).toBe(0);
      expect(r.grossPnl).toBeNull();
      expect(r.netPnl).toBeNull();
    }
  });

  it("returns a non-computable result when lots × lotSize is zero or negative", () => {
    for (const cfg of [
      { lots: 0, lotSize: 25 },
      { lots: 10, lotSize: 0 },
      { lots: -5, lotSize: 25 },
      { lots: 10, lotSize: -25 },
    ]) {
      const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 120, ...cfg });
      expect(r.computable).toBe(false);
      expect(r.totalCost).toBe(0);
    }
  });

  it("never throws on completely garbage inputs", () => {
    expect(() =>
      computeFnoTradeCost({
        entryPremium: NaN,
        exitPremium: NaN,
        lots: NaN,
        lotSize: NaN,
      }),
    ).not.toThrow();
  });
});

describe("isShadowCostsEnabled — feature flag", () => {
  const originalEnv = process.env.PAPER_FO_COSTS_SHADOW_ENABLED;
  beforeEach(() => { delete process.env.PAPER_FO_COSTS_SHADOW_ENABLED; });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PAPER_FO_COSTS_SHADOW_ENABLED;
    else process.env.PAPER_FO_COSTS_SHADOW_ENABLED = originalEnv;
  });

  it("defaults ON when the env var is unset (reporting-only, safe default)", () => {
    expect(isShadowCostsEnabled()).toBe(true);
  });

  it("turns OFF for explicit falsy values (0, false, no, off — case-insensitive)", () => {
    for (const v of ["0", "false", "FALSE", "no", "No", "off", "OFF"]) {
      process.env.PAPER_FO_COSTS_SHADOW_ENABLED = v;
      expect(isShadowCostsEnabled()).toBe(false);
    }
  });

  it("treats any other string as ON (fail-OPEN for reporting)", () => {
    for (const v of ["1", "true", "yes", "on", "anything"]) {
      process.env.PAPER_FO_COSTS_SHADOW_ENABLED = v;
      expect(isShadowCostsEnabled()).toBe(true);
    }
  });
});

describe("Sanity bound — average cost % of premium for a realistic NIFTY trade", () => {
  it("is in the 0.5%–5% band for a typical 100→120 premium round trip", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 120, lots: 10, lotSize: 25 });
    expect(r.costPctOfPremium!).toBeGreaterThan(0.005);
    expect(r.costPctOfPremium!).toBeLessThan(0.05);
  });
});
