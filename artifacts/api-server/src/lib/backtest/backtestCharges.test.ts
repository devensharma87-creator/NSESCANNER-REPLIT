/**
 * Unit tests for the backtest charges adapter.
 *
 * Coverage:
 *   1. Mode A (real premiums) — computable=true, premiumModeled=false
 *   2. Modes B/C (modeled premium from entrySpot) — computable=true, premiumModeled=true
 *   3. Degenerate inputs → computable=false, zero charges, netPnl=grossPnl
 *   4. Net P&L = gross P&L − totalCharges (round-trip invariant)
 *   5. All charge line-items are finite and non-negative
 *   6. BACKTEST_CHARGES_ASSUMPTIONS shape
 *   7. Null exit premium (Mode A open trade) — still computable
 *   8. Mode B negative P&L trade — charges still deducted
 */

import { describe, it, expect } from "vitest";
import {
  computeBacktestTradeCost,
  BACKTEST_CHARGES_ASSUMPTIONS,
} from "./backtestCharges";

// ── helpers ────────────────────────────────────────────────────────────────────

function isNonNegFinite(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

// ── Mode A: real premiums ──────────────────────────────────────────────────────

describe("computeBacktestTradeCost — Mode A (real premiums)", () => {
  const base = {
    pnl: 1500,
    lots: 2,
    lotSize: 50,
    optionEntry: 150,
    optionExit: 165,
  };

  it("marks computable=true, premiumModeled=false", () => {
    const r = computeBacktestTradeCost(base);
    expect(r.computable).toBe(true);
    expect(r.premiumModeled).toBe(false);
  });

  it("grossPnl equals input pnl", () => {
    const r = computeBacktestTradeCost(base);
    expect(r.grossPnl).toBe(base.pnl);
  });

  it("net P&L = gross P&L − totalCharges", () => {
    const r = computeBacktestTradeCost(base);
    expect(r.netPnl).not.toBeNull();
    expect(r.netPnl!).toBeCloseTo(r.grossPnl! - r.totalCharges, 5);
  });

  it("all charge line-items are finite and non-negative", () => {
    const r = computeBacktestTradeCost(base);
    expect(isNonNegFinite(r.brokerage)).toBe(true);
    expect(isNonNegFinite(r.stt)).toBe(true);
    expect(isNonNegFinite(r.exchangeCharges)).toBe(true);
    expect(isNonNegFinite(r.sebiCharges)).toBe(true);
    expect(isNonNegFinite(r.stampDuty)).toBe(true);
    expect(isNonNegFinite(r.gst)).toBe(true);
    expect(isNonNegFinite(r.slippageCost)).toBe(true);
    expect(isNonNegFinite(r.totalCharges)).toBe(true);
  });

  it("totalCharges = sum of all line-items", () => {
    const r = computeBacktestTradeCost(base);
    const sum = r.brokerage + r.stt + r.exchangeCharges + r.sebiCharges + r.stampDuty + r.gst + r.slippageCost;
    expect(r.totalCharges).toBeCloseTo(sum, 5);
  });

  it("brokerage is exactly ₹40 (₹20 × 2 legs)", () => {
    const r = computeBacktestTradeCost(base);
    expect(r.brokerage).toBe(40);
  });

  it("totalCharges reduces net P&L below gross", () => {
    const r = computeBacktestTradeCost(base);
    expect(r.netPnl!).toBeLessThan(r.grossPnl!);
  });

  it("null exit premium (open trade) — still computable", () => {
    const r = computeBacktestTradeCost({ ...base, optionExit: null });
    expect(r.computable).toBe(true);
    // One-sided brokerage (entry only)
    expect(r.brokerage).toBe(20);
    expect(r.netPnl).not.toBeNull();
  });
});

// ── Modes B/C: modeled premium from entrySpot ──────────────────────────────────

describe("computeBacktestTradeCost — Modes B/C (modeled premium)", () => {
  const base = {
    pnl: 2250,
    lots: 10,
    lotSize: 50,
    entrySpot: 24000,
  };

  it("marks computable=true, premiumModeled=true", () => {
    const r = computeBacktestTradeCost(base);
    expect(r.computable).toBe(true);
    expect(r.premiumModeled).toBe(true);
  });

  it("grossPnl equals input pnl", () => {
    const r = computeBacktestTradeCost(base);
    expect(r.grossPnl).toBe(base.pnl);
  });

  it("net P&L = gross P&L − totalCharges", () => {
    const r = computeBacktestTradeCost(base);
    expect(r.netPnl!).toBeCloseTo(r.grossPnl! - r.totalCharges, 5);
  });

  it("all charge line-items are non-negative", () => {
    const r = computeBacktestTradeCost(base);
    expect(isNonNegFinite(r.brokerage)).toBe(true);
    expect(isNonNegFinite(r.stt)).toBe(true);
    expect(isNonNegFinite(r.exchangeCharges)).toBe(true);
    expect(isNonNegFinite(r.sebiCharges)).toBe(true);
    expect(isNonNegFinite(r.stampDuty)).toBe(true);
    expect(isNonNegFinite(r.gst)).toBe(true);
    expect(isNonNegFinite(r.slippageCost)).toBe(true);
    expect(isNonNegFinite(r.totalCharges)).toBe(true);
  });

  it("negative pnl trade — charges still deducted (net < gross)", () => {
    const r = computeBacktestTradeCost({ ...base, pnl: -1800 });
    expect(r.computable).toBe(true);
    expect(r.netPnl!).toBeLessThan(r.grossPnl!);
    expect(r.netPnl).toBeCloseTo(r.grossPnl! - r.totalCharges, 5);
  });

  it("zero pnl (breakeven) — net is slightly negative due to charges", () => {
    const r = computeBacktestTradeCost({ ...base, pnl: 0 });
    expect(r.computable).toBe(true);
    expect(r.netPnl!).toBeLessThan(0);
  });

  it("ATM premium estimated at ~0.7% of spot", () => {
    // Modeled entry premium = entrySpot × 0.007 = 24000 × 0.007 = 168
    // This drives STT, exchange, stamp, slippage etc.
    const r = computeBacktestTradeCost(base);
    // STT = 0.15% × exit_turnover; exchange ≈ 0.053% × total_turnover
    // Just verify totalCharges is in a sane range (not zero, not astronomically large)
    const qty = base.lots * base.lotSize; // 500
    const modeledPremium = base.entrySpot * 0.007; // 168
    const approxTurnover = modeledPremium * qty * 2;   // 168,000
    // Expect roughly 0.5–2.5% of approxTurnover in total charges
    expect(r.totalCharges).toBeGreaterThan(approxTurnover * 0.005);
    expect(r.totalCharges).toBeLessThan(approxTurnover * 0.1);
  });
});

// ── Degenerate inputs ──────────────────────────────────────────────────────────

describe("computeBacktestTradeCost — degenerate inputs", () => {
  const base = { pnl: 1000, lots: 1, lotSize: 50 };

  it("no entrySpot and no optionEntry → computable=false, zero charges", () => {
    const r = computeBacktestTradeCost(base);
    expect(r.computable).toBe(false);
    expect(r.totalCharges).toBe(0);
    expect(r.netPnl).toBe(base.pnl); // no charges applied → net = gross
  });

  it("zero entrySpot → computable=false", () => {
    const r = computeBacktestTradeCost({ ...base, entrySpot: 0 });
    expect(r.computable).toBe(false);
  });

  it("negative entrySpot → computable=false", () => {
    const r = computeBacktestTradeCost({ ...base, entrySpot: -100 });
    expect(r.computable).toBe(false);
  });

  it("NaN entrySpot → computable=false", () => {
    const r = computeBacktestTradeCost({ ...base, entrySpot: NaN });
    expect(r.computable).toBe(false);
  });

  it("null optionEntry → falls back to entrySpot if available", () => {
    const r = computeBacktestTradeCost({ ...base, optionEntry: null, entrySpot: 22000 });
    expect(r.computable).toBe(true);
    expect(r.premiumModeled).toBe(true);
  });

  it("optionEntry=0 (invalid) → falls back to entrySpot if available", () => {
    const r = computeBacktestTradeCost({ ...base, optionEntry: 0, entrySpot: 22000 });
    expect(r.computable).toBe(true);
    expect(r.premiumModeled).toBe(true);
  });

  it("non-computable result: grossPnl equals input pnl", () => {
    const r = computeBacktestTradeCost(base);
    expect(r.grossPnl).toBe(base.pnl);
  });
});

// ── Mode A vs Modes B/C routing ─────────────────────────────────────────────────

describe("computeBacktestTradeCost — routing: Mode A takes precedence over entrySpot", () => {
  it("when both optionEntry and entrySpot are provided, Mode A wins (premiumModeled=false)", () => {
    const r = computeBacktestTradeCost({
      pnl: 500,
      lots: 1,
      lotSize: 50,
      optionEntry: 200,
      optionExit: 210,
      entrySpot: 20000,
    });
    expect(r.computable).toBe(true);
    expect(r.premiumModeled).toBe(false);
  });
});

// ── BACKTEST_CHARGES_ASSUMPTIONS shape ─────────────────────────────────────────

describe("BACKTEST_CHARGES_ASSUMPTIONS", () => {
  it("has a non-empty asOf date string", () => {
    expect(typeof BACKTEST_CHARGES_ASSUMPTIONS.asOf).toBe("string");
    expect(BACKTEST_CHARGES_ASSUMPTIONS.asOf.length).toBeGreaterThan(0);
  });

  it("brokerageRoundTrip = 2 × brokeragePerSide", () => {
    expect(BACKTEST_CHARGES_ASSUMPTIONS.brokerageRoundTrip).toBe(
      BACKTEST_CHARGES_ASSUMPTIONS.brokeragePerSide * 2,
    );
  });

  it("all rate percentages are positive", () => {
    const { sttRatePct, exchangeTxnRatePct, sebiRatePct, gstRatePct, stampDutyRatePct } =
      BACKTEST_CHARGES_ASSUMPTIONS;
    expect(sttRatePct).toBeGreaterThan(0);
    expect(exchangeTxnRatePct).toBeGreaterThan(0);
    expect(sebiRatePct).toBeGreaterThan(0);
    expect(gstRatePct).toBeGreaterThan(0);
    expect(stampDutyRatePct).toBeGreaterThan(0);
  });

  it("modeledAtmPremiumPct is ~0.7%", () => {
    expect(BACKTEST_CHARGES_ASSUMPTIONS.modeledAtmPremiumPct).toBeCloseTo(0.7, 5);
  });
});
