/**
 * Unit tests for swingCashCostModel.ts (Part N) — pure module.
 */

import { describe, it, expect } from "vitest";
import { computeSwingCashCost } from "./swingCashCostModel";
import { DEFAULT_SWING_CASH_CONFIG } from "./swingCashRiskGuards";
import type { SwingCashCostInput } from "./swingCashTypes";

const CFG = DEFAULT_SWING_CASH_CONFIG.cost;

function make(overrides: Partial<SwingCashCostInput> = {}): SwingCashCostInput {
  return { entry: 100, target: 115, stop: 95, qty: 50, minRR: 1.8, ...overrides };
}

describe("computeSwingCashCost", () => {
  it("computes net target profit after charges and slippage", () => {
    const r = computeSwingCashCost(make(), CFG);
    expect(r.grossTargetProfit).toBe(750);
    expect(r.estimatedCharges).toBeGreaterThan(0);
    expect(r.netTargetProfit).toBeLessThan(r.grossTargetProfit);
    expect(r.netTargetProfit).toBeCloseTo(716.8, 0);
  });

  it("passes min R when after-cost edge is healthy", () => {
    const r = computeSwingCashCost(make(), CFG);
    expect(r.expectedRGross).toBeCloseTo(3.0, 6);
    expect(r.expectedRAfterCost).toBeGreaterThan(1.8);
    expect(r.passesMinRR).toBe(true);
  });

  it("fails min R when the target is too close to entry", () => {
    const r = computeSwingCashCost(make({ target: 103 }), CFG);
    expect(r.expectedRAfterCost).toBeLessThan(1.8);
    expect(r.passesMinRR).toBe(false);
  });

  it("includes STT and DP charge in the breakdown", () => {
    const r = computeSwingCashCost(make(), CFG);
    expect(r.breakdown.stt).toBeGreaterThan(0);
    expect(r.breakdown.dpCharge).toBeCloseTo(CFG.dpChargePerSell, 6);
  });
});
