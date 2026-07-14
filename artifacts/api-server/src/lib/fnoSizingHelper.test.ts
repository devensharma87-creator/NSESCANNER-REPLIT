/**
 * Tests for the F&O dynamic lot-sizing helper. Pure-function — no DB,
 * no env, no time-of-day dependencies. Cases pin the OWNER-APPROVED
 * risk-base model: risk base = availableCash (not seed), PAPER_FIXED_LOTS
 * acts only as a ceiling, finalLots = min(byTradeRisk, byHeat, ceiling).
 */
import { describe, it, expect } from "vitest";
import { computeFnoLotSizing, type FnoSizingInput } from "./fnoSizingHelper";

const NIFTY_BASE: FnoSizingInput = {
  indexSymbol: "NIFTY",
  // perShareLoss = 33.88 → riskPerLot = 33.88 × 75 = 2541
  entryPremium: 120.0,
  stopPremium: 86.12,
  lotSize: 75,
  availableCash: 1_006_281,
  maxLossPctPerTrade: 0.02,
  currentHeat: 0,
  maxFnoHeatPct: 0.06,
  absoluteMaxLots: 10,
};

describe("computeFnoLotSizing — risk base = availableCash", () => {
  it("worked example: NIFTY ₹1,006,281 cash, ceiling 10 → 7 lots (bound by per-trade risk)", () => {
    const r = computeFnoLotSizing(NIFTY_BASE);
    expect(r.verdict).toBe("ACCEPT");
    expect(r.riskPerLot).toBeCloseTo(2541, 6);
    expect(r.perTradeRiskBudget).toBeCloseTo(20125.62, 2);
    expect(r.heatCap).toBeCloseTo(60376.86, 2);
    expect(r.maxLotsByTradeRisk).toBe(7);
    expect(r.maxLotsByPortfolioHeat).toBe(23);
    expect(r.lots).toBe(7);
    expect(r.detail).toMatch(/per-trade risk/);
  });

  it("riskBase tracks availableCash, NOT seed: more cash → more lots up to ceiling", () => {
    const rich = computeFnoLotSizing({ ...NIFTY_BASE, availableCash: 50_000_000 });
    // byRisk = floor(50m×0.02 / 2541) = floor(393.5) = 393; byHeat huge; ceiling 10 wins.
    expect(rich.verdict).toBe("ACCEPT");
    expect(rich.lots).toBe(10);
    expect(rich.detail).toMatch(/ceiling/);
  });

  it("ceiling is a hard cap — never exceeds PAPER_FIXED_LOTS even when risk+heat allow more", () => {
    const r = computeFnoLotSizing({ ...NIFTY_BASE, availableCash: 50_000_000, absoluteMaxLots: 10 });
    expect(r.lots).toBeLessThanOrEqual(10);
    expect(r.lots).toBe(10);
  });

  it("no ceiling (null): bounded only by risk and heat", () => {
    const r = computeFnoLotSizing({ ...NIFTY_BASE, availableCash: 50_000_000, absoluteMaxLots: null });
    // byRisk = 393, byHeat = floor(50m×0.06/2541)=1180 → min = 393.
    expect(r.verdict).toBe("ACCEPT");
    expect(r.lots).toBe(393);
    expect(r.detail).toMatch(/per-trade risk/);
  });

  it("heat binds when current heat eats most headroom", () => {
    // heatCap = 60,376.86; leave room for ~2 lots (2×2541=5082).
    const r = computeFnoLotSizing({ ...NIFTY_BASE, currentHeat: 60_376.86 - 5_082 });
    expect(r.verdict).toBe("ACCEPT");
    expect(r.maxLotsByPortfolioHeat).toBe(2);
    expect(r.lots).toBe(2);
    expect(r.detail).toMatch(/portfolio heat/);
  });
});

describe("computeFnoLotSizing — rejections", () => {
  it("RISK_TOO_WIDE_FOR_MIN_LOT when one lot's risk exceeds the per-trade budget (risk checked first)", () => {
    // budget = 100,000×0.02 = 2,000 < riskPerLot 2541 → byRisk 0.
    const r = computeFnoLotSizing({ ...NIFTY_BASE, availableCash: 100_000 });
    expect(r.verdict).toBe("REJECT");
    expect(r.reason).toBe("RISK_TOO_WIDE_FOR_MIN_LOT");
    expect(r.lots).toBe(0);
  });

  it("PORTFOLIO_HEAT_CAP when risk allows ≥1 lot but no heat headroom remains", () => {
    // Big cash so byRisk ≥ 1, but currentHeat ≈ heatCap so byHeat = 0.
    const r = computeFnoLotSizing({
      ...NIFTY_BASE,
      availableCash: 5_000_000,
      currentHeat: 5_000_000 * 0.06 - 1, // 1 rupee of headroom < riskPerLot
    });
    expect(r.maxLotsByTradeRisk).toBeGreaterThanOrEqual(1);
    expect(r.verdict).toBe("REJECT");
    expect(r.reason).toBe("PORTFOLIO_HEAT_CAP");
    expect(r.lots).toBe(0);
  });

  it("risk takes priority over heat when BOTH would block", () => {
    const r = computeFnoLotSizing({
      ...NIFTY_BASE,
      availableCash: 100_000,
      currentHeat: 100_000 * 0.06, // heat also exhausted
    });
    expect(r.reason).toBe("RISK_TOO_WIDE_FOR_MIN_LOT");
  });

  it("INVALID_PLAN when entry == stop (zero risk distance)", () => {
    const r = computeFnoLotSizing({ ...NIFTY_BASE, entryPremium: 100, stopPremium: 100 });
    expect(r.verdict).toBe("REJECT");
    expect(r.reason).toBe("INVALID_PLAN");
  });

  it("INVALID_PLAN on non-positive lot size", () => {
    const r = computeFnoLotSizing({ ...NIFTY_BASE, lotSize: 0 });
    expect(r.verdict).toBe("REJECT");
    expect(r.reason).toBe("INVALID_PLAN");
  });
});

describe("computeFnoLotSizing — heat accounting on ACCEPT", () => {
  it("newHeat = lots × riskPerLot and projectedHeat = current + newHeat", () => {
    const r = computeFnoLotSizing({ ...NIFTY_BASE, currentHeat: 5_000 });
    expect(r.newHeat).toBeCloseTo(r.lots * r.riskPerLot, 6);
    expect(r.projectedHeat).toBeCloseTo(5_000 + r.lots * r.riskPerLot, 6);
  });
});
