/**
 * Unit tests for swingCashLiquidity.ts (Part F) — pure module.
 */

import { describe, it, expect } from "vitest";
import { evaluateSwingCashLiquidity } from "./swingCashLiquidity";
import { DEFAULT_SWING_CASH_CONFIG } from "./swingCashRiskGuards";
import type { SwingCashLiquidityInput } from "./swingCashTypes";

const CFG = DEFAULT_SWING_CASH_CONFIG.liquidity;

function make(overrides: Partial<SwingCashLiquidityInput> = {}): SwingCashLiquidityInput {
  return {
    avgTradedValue: 100_000_000,
    volume: 500_000,
    spreadPct: 0.2,
    deliveryPct: 60,
    asmGsmStatus: "NONE",
    circuitRisk: false,
    ...overrides,
  };
}

describe("evaluateSwingCashLiquidity", () => {
  it("passes a liquid, clean name", () => {
    const r = evaluateSwingCashLiquidity(make(), CFG);
    expect(r.classification).toBe("LIQUIDITY_OK");
    expect(r.tradeable).toBe(true);
  });

  it("blocks low traded value", () => {
    const r = evaluateSwingCashLiquidity(make({ avgTradedValue: 1_000_000 }), CFG);
    expect(r.classification).toBe("LOW_TRADED_VALUE");
    expect(r.tradeable).toBe(false);
  });

  it("blocks wide spread", () => {
    const r = evaluateSwingCashLiquidity(make({ spreadPct: 1.0 }), CFG);
    expect(r.classification).toBe("HIGH_SPREAD");
  });

  it("blocks ASM/GSM surveillance", () => {
    const r = evaluateSwingCashLiquidity(make({ asmGsmStatus: "ASM" }), CFG);
    expect(r.classification).toBe("ASM_GSM_RISK");
    expect(r.tradeable).toBe(false);
  });

  it("blocks circuit risk", () => {
    const r = evaluateSwingCashLiquidity(make({ circuitRisk: true }), CFG);
    expect(r.classification).toBe("CIRCUIT_RISK");
  });

  it("requires review when surveillance status is unavailable", () => {
    const r = evaluateSwingCashLiquidity(make({ asmGsmStatus: null }), CFG);
    expect(r.classification).toBe("ASM_GSM_UNAVAILABLE_REVIEW_REQUIRED");
    expect(r.reviewRequired).toBe(true);
  });

  it("reports unavailable when no liquidity data present", () => {
    const r = evaluateSwingCashLiquidity(make({ avgTradedValue: null, volume: null }), CFG);
    expect(r.classification).toBe("LIQUIDITY_DATA_UNAVAILABLE");
    expect(r.reviewRequired).toBe(true);
  });

  it("requires review when spread is unavailable (never assumes liquid)", () => {
    const r = evaluateSwingCashLiquidity(make({ spreadPct: null }), CFG);
    expect(r.classification).toBe("LIQUIDITY_DATA_UNAVAILABLE");
    expect(r.tradeable).toBe(false);
    expect(r.reviewRequired).toBe(true);
  });

  it("requires review when circuit status is unavailable", () => {
    const r = evaluateSwingCashLiquidity(make({ circuitRisk: null }), CFG);
    expect(r.classification).toBe("LIQUIDITY_DATA_UNAVAILABLE");
    expect(r.reviewRequired).toBe(true);
  });

  it("warns (not blocks) on low delivery %", () => {
    const r = evaluateSwingCashLiquidity(make({ deliveryPct: 20 }), CFG);
    expect(r.classification).toBe("LIQUIDITY_OK");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("treats a non-finite (NaN) traded value as unavailable, never liquid", () => {
    const r = evaluateSwingCashLiquidity(make({ avgTradedValue: NaN }), CFG);
    expect(r.classification).toBe("LIQUIDITY_DATA_UNAVAILABLE");
    expect(r.tradeable).toBe(false);
    expect(r.reviewRequired).toBe(true);
  });

  it("treats a non-finite (NaN) spread as unavailable, never liquid", () => {
    const r = evaluateSwingCashLiquidity(make({ spreadPct: NaN }), CFG);
    expect(r.classification).toBe("LIQUIDITY_DATA_UNAVAILABLE");
    expect(r.tradeable).toBe(false);
    expect(r.reviewRequired).toBe(true);
  });
});
