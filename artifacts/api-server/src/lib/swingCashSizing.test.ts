/**
 * Unit tests for swingCashSizing.ts (Part E) — pure module.
 */

import { describe, it, expect } from "vitest";
import { computeSwingCashSizing } from "./swingCashSizing";
import { DEFAULT_SWING_CASH_CONFIG } from "./swingCashRiskGuards";
import type { SwingCashSizingInput } from "./swingCashTypes";

const CFG = DEFAULT_SWING_CASH_CONFIG.sizing;
const CAP = 100_000; // live-capital base (10% of ₹10L)

function make(overrides: Partial<SwingCashSizingInput> = {}): SwingCashSizingInput {
  return {
    entry: 100,
    stop: 95,
    totalSwingCapital: CAP,
    availableCash: 1_000_000,
    ...overrides,
  };
}

describe("computeSwingCashSizing", () => {
  it("sizes by the most conservative constraint and respects gap buffer", () => {
    const r = computeSwingCashSizing(make(), CFG);
    expect(r.allowed).toBe(true);
    expect(r.qty).toBe(50); // bound by max-position-value (5% of 100k / ₹100)
    expect(r.maxLoss).toBe(250);
    expect(r.maxLossWithGap).toBeCloseTo(350, 6); // +2% gap buffer on value
    expect(r.maxLoss).toBeLessThanOrEqual(CFG.maxRiskPerTrade);
  });

  it("respects the cash reserve in deployable cash", () => {
    const r = computeSwingCashSizing(make({ availableCash: 1_000 }), CFG);
    expect(r.workings.deployableCash).toBeCloseTo(800, 6); // 20% reserve
  });

  it("rejects when deployable cash cannot buy one share", () => {
    const r = computeSwingCashSizing(make({ availableCash: 50 }), CFG);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("INSUFFICIENT_CASH");
  });

  it("rejects a position below the minimum viable value", () => {
    const r = computeSwingCashSizing(make({ entry: 500, stop: 100 }), CFG);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("POSITION_TOO_SMALL");
  });

  it("rejects an invalid risk-per-share", () => {
    const r = computeSwingCashSizing(make({ stop: 105 }), CFG);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("RISK_PER_SHARE_INVALID");
  });

  it("never lets max loss exceed the absolute per-trade cap", () => {
    const r = computeSwingCashSizing(make({ entry: 100, stop: 90 }), CFG);
    expect(r.allowed).toBe(true);
    expect(r.maxLoss).toBeLessThanOrEqual(CFG.maxRiskPerTrade);
  });

  it("rejects a non-finite (NaN) total capital instead of sizing a NaN qty", () => {
    const r = computeSwingCashSizing(make({ totalSwingCapital: NaN }), CFG);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("SIZING_INPUT_INVALID");
    expect(r.qty).toBe(0);
  });

  it("rejects a non-finite (NaN) available cash", () => {
    const r = computeSwingCashSizing(make({ availableCash: NaN }), CFG);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("SIZING_INPUT_INVALID");
  });

  it("rejects negative capital (fail-closed)", () => {
    const r = computeSwingCashSizing(make({ totalSwingCapital: -1 }), CFG);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("SIZING_INPUT_INVALID");
  });
});
