/**
 * Unit tests for swingCashExposure.ts (Part G) — pure module.
 */

import { describe, it, expect } from "vitest";
import { evaluateSwingCashExposure } from "./swingCashExposure";
import { DEFAULT_SWING_CASH_CONFIG } from "./swingCashRiskGuards";
import type { SwingCashExposureInput } from "./swingCashTypes";

const CFG = DEFAULT_SWING_CASH_CONFIG.exposure;
const CAP = 100_000; // live-capital base

function make(overrides: Partial<SwingCashExposureInput> = {}): SwingCashExposureInput {
  return {
    symbol: "ACME",
    sector: "IT",
    proposedPositionValue: 5_000,
    totalSwingCapital: CAP,
    currentSectorExposureValue: 0,
    currentSingleStockExposureValue: 0,
    openPositionSymbols: [],
    sectorOpenCount: 0,
    lastEntryDateForSymbolIst: null,
    todayIst: "2026-06-29",
    ...overrides,
  };
}

describe("evaluateSwingCashExposure", () => {
  it("allows a position within caps", () => {
    const r = evaluateSwingCashExposure(make(), CFG);
    expect(r.allowed).toBe(true);
  });

  it("blocks single-stock exposure over cap", () => {
    const r = evaluateSwingCashExposure(
      make({ currentSingleStockExposureValue: 4_000 }),
      CFG,
    );
    expect(r.allowed).toBe(false);
    expect(r.metrics.singleStockExposureAfterPct).toBeCloseTo(9, 3);
  });

  it("blocks sector exposure over cap", () => {
    const r = evaluateSwingCashExposure(
      make({ proposedPositionValue: 20_000, currentSectorExposureValue: 8_000 }),
      CFG,
    );
    expect(r.allowed).toBe(false);
    expect(r.metrics.sectorExposureAfterPct).toBeCloseTo(28, 3);
  });

  it("blocks a duplicate position", () => {
    const r = evaluateSwingCashExposure(
      make({ openPositionSymbols: ["ACME"] }),
      CFG,
    );
    expect(r.allowed).toBe(false);
    expect(r.metrics.duplicate).toBe(true);
  });

  it("blocks same-stock entry on consecutive day (today)", () => {
    const r = evaluateSwingCashExposure(
      make({ lastEntryDateForSymbolIst: "2026-06-29" }),
      CFG,
    );
    expect(r.allowed).toBe(false);
    expect(r.metrics.consecutiveDay).toBe(true);
  });

  it("blocks same-stock entry on consecutive day (yesterday)", () => {
    const r = evaluateSwingCashExposure(
      make({ lastEntryDateForSymbolIst: "2026-06-28" }),
      CFG,
    );
    expect(r.metrics.consecutiveDay).toBe(true);
  });

  it("warns when a sector becomes crowded", () => {
    const r = evaluateSwingCashExposure(make({ sectorOpenCount: 2 }), CFG);
    expect(r.warnings.some((w) => w.includes("crowded"))).toBe(true);
  });

  it("hard-blocks a NaN exposure snapshot instead of treating NaN% as within cap", () => {
    const r = evaluateSwingCashExposure(
      make({ currentSectorExposureValue: NaN }),
      CFG,
    );
    expect(r.allowed).toBe(false);
    expect(r.inputInvalid).toBe(true);
    expect(r.reasons[0]).toMatch(/invalid/i);
  });

  it("hard-blocks an Infinity proposed position value", () => {
    const r = evaluateSwingCashExposure(
      make({ proposedPositionValue: Infinity }),
      CFG,
    );
    expect(r.allowed).toBe(false);
    expect(r.inputInvalid).toBe(true);
  });

  it("hard-blocks a negative exposure value (fail-closed)", () => {
    const r = evaluateSwingCashExposure(
      make({ currentSingleStockExposureValue: -1 }),
      CFG,
    );
    expect(r.allowed).toBe(false);
    expect(r.inputInvalid).toBe(true);
  });

  it("hard-blocks a non-finite config cap", () => {
    const r = evaluateSwingCashExposure(make(), {
      ...CFG,
      maxSectorExposurePct: NaN,
    });
    expect(r.allowed).toBe(false);
    expect(r.inputInvalid).toBe(true);
  });

  it("reports inputInvalid=false on a clean evaluation", () => {
    const r = evaluateSwingCashExposure(make(), CFG);
    expect(r.inputInvalid).toBe(false);
  });
});
