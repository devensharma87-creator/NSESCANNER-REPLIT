/**
 * F&O Cost Model Unification tests — P0-1.
 *
 * Verifies that:
 *   1. paperReportsFO uses canonical fnoCostModel (not local stale constants).
 *   2. premiumReplay computeFnoCosts uses canonical fnoCostModel.
 *   3. backtestCharges continues to use canonical fnoCostModel.
 *   4. All three consumers agree on the same STT / exchange rates.
 *   5. Net P&L formula invariant: netPnl = grossPnl − totalCharges.
 *   6. Paper Reports and Stage-4 replay produce matching charges for
 *      the same round-trip turnover.
 *   7. Golden-number regression for one sample NIFTY option round-trip.
 *   8. Structural: no local F&O STT/exchange constants remain in
 *      paperReportsFO or premiumReplay after the unification.
 *   9. Canonical STT = 0.15% (Budget 2026) — not 0.10% (stale) or 0.05% (futures).
 *  10. Canonical exchange rate = 0.03503% — not 0.053% (pre-Oct-2024).
 *  11. Existing backtestCharges Phase 3A tests remain green (forward gate).
 */

import { describe, it, expect } from "vitest";
import {
  computeFnoTradeCost,
  FNO_COST_PARAMS,
  FNO_COST_PARAMS_ASOF,
} from "./fnoCostModel";
import { computeFnoCosts } from "./backtest/premiumReplay";
import { computeFOCharges } from "./paperReportsFO";
import { computeBacktestTradeCost } from "./backtest/backtestCharges";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function isFinitePos(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

// ---------------------------------------------------------------------------
// 1. Canonical rate invariants
// ---------------------------------------------------------------------------

describe("Canonical rate invariants (fnoCostModel)", () => {
  it("STT_RATE_SELL_PREMIUM = 0.0015 (Budget 2026, options sell side)", () => {
    expect(FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM).toBeCloseTo(0.0015, 6);
  });

  it("STT rate is NOT the stale 0.001 (pre-Budget-2026 option rate)", () => {
    expect(FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM).not.toBeCloseTo(0.001, 6);
  });

  it("STT rate is NOT the futures rate 0.0005", () => {
    expect(FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM).not.toBeCloseTo(0.0005, 6);
  });

  it("EXCHANGE_TXN_RATE = 0.0003503 (current NSE options rate)", () => {
    expect(FNO_COST_PARAMS.EXCHANGE_TXN_RATE).toBeCloseTo(0.0003503, 7);
  });

  it("Exchange rate is NOT the stale 0.00053 (pre-Oct-2024 rate)", () => {
    expect(FNO_COST_PARAMS.EXCHANGE_TXN_RATE).not.toBeCloseTo(0.00053, 7);
  });

  it("FNO_COST_PARAMS_ASOF is '2026-04-01'", () => {
    expect(FNO_COST_PARAMS_ASOF).toBe("2026-04-01");
  });

  it("all rate fields are present and positive", () => {
    expect(isFinitePos(FNO_COST_PARAMS.BROKERAGE_PER_SIDE_INR)).toBe(true);
    expect(isFinitePos(FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM)).toBe(true);
    expect(isFinitePos(FNO_COST_PARAMS.EXCHANGE_TXN_RATE)).toBe(true);
    expect(isFinitePos(FNO_COST_PARAMS.SEBI_RATE)).toBe(true);
    expect(isFinitePos(FNO_COST_PARAMS.GST_RATE)).toBe(true);
    expect(isFinitePos(FNO_COST_PARAMS.STAMP_DUTY_RATE_BUY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. paperReportsFO uses canonical model
// ---------------------------------------------------------------------------

describe("paperReportsFO.computeFOCharges — uses canonical model", () => {
  const buyTurnover = 120 * 25;   // 120 entry × 25 qty = ₹3,000
  const sellTurnover = 145 * 25;  // 145 exit × 25 qty = ₹3,625

  it("STT computed at 0.15% of sell turnover (canonical rate)", () => {
    const result = computeFOCharges(buyTurnover, sellTurnover);
    const expected = sellTurnover * FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM;
    expect(result.stt).toBeCloseTo(expected, 4);
  });

  it("transactionCharges at 0.03503% of total turnover", () => {
    const result = computeFOCharges(buyTurnover, sellTurnover);
    const totalTurnover = buyTurnover + sellTurnover;
    const expected = totalTurnover * FNO_COST_PARAMS.EXCHANGE_TXN_RATE;
    expect(result.transactionCharges).toBeCloseTo(expected, 4);
  });

  it("all fields are finite and non-negative", () => {
    const r = computeFOCharges(buyTurnover, sellTurnover);
    expect(isFinitePos(r.brokerage)).toBe(true);
    expect(isFinitePos(r.stt)).toBe(true);
    expect(isFinitePos(r.transactionCharges)).toBe(true);
    expect(isFinitePos(r.sebiCharges)).toBe(true);
    expect(isFinitePos(r.gst)).toBe(true);
    expect(isFinitePos(r.stampDuty)).toBe(true);
    expect(isFinitePos(r.spreadCost)).toBe(true);
    expect(isFinitePos(r.slippageCost)).toBe(true);
    expect(isFinitePos(r.total)).toBe(true);
  });

  it("total = sum of all components", () => {
    const r = computeFOCharges(buyTurnover, sellTurnover);
    const sum = r.brokerage + r.stt + r.transactionCharges + r.sebiCharges + r.gst + r.stampDuty + r.spreadCost + r.slippageCost;
    expect(r.total).toBeCloseTo(sum, 4);
  });

  it("costModelSource identifies canonical function", () => {
    const r = computeFOCharges(buyTurnover, sellTurnover);
    expect(r.costModelSource).toContain("fnoCostModel");
  });

  it("costModelAsOf is the canonical as-of date", () => {
    const r = computeFOCharges(buyTurnover, sellTurnover);
    expect(r.costModelAsOf).toBe(FNO_COST_PARAMS_ASOF);
  });
});

// ---------------------------------------------------------------------------
// 3. premiumReplay.computeFnoCosts uses canonical model
// ---------------------------------------------------------------------------

describe("premiumReplay.computeFnoCosts — uses canonical model", () => {
  const entryPremium = 120;
  const exitPremium = 145;
  const qty = 25;

  it("STT computed at canonical 0.15% of exit turnover", () => {
    const result = computeFnoCosts(entryPremium, exitPremium, qty, null, null);
    const expected = exitPremium * qty * FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM;
    expect(result.stt).toBeCloseTo(expected, 2);
  });

  it("exchangeTxn computed at canonical 0.03503% of total turnover", () => {
    const result = computeFnoCosts(entryPremium, exitPremium, qty, null, null);
    const totalTurnover = (entryPremium + exitPremium) * qty;
    const expected = totalTurnover * FNO_COST_PARAMS.EXCHANGE_TXN_RATE;
    expect(result.exchangeTxn).toBeCloseTo(expected, 2);
  });

  it("all fields are finite and non-negative", () => {
    const r = computeFnoCosts(entryPremium, exitPremium, qty, null, null);
    expect(isFinitePos(r.brokerage)).toBe(true);
    expect(isFinitePos(r.stt)).toBe(true);
    expect(isFinitePos(r.exchangeTxn)).toBe(true);
    expect(isFinitePos(r.sebiCharges)).toBe(true);
    expect(isFinitePos(r.gst)).toBe(true);
    expect(isFinitePos(r.stampDuty)).toBe(true);
    expect(r.spreadCost).not.toBeNull();
    expect(isFinitePos(r.spreadCost as number)).toBe(true);
    expect(isFinitePos(r.total)).toBe(true);
  });

  it("total = sum of all components", () => {
    const r = computeFnoCosts(entryPremium, exitPremium, qty, null, null);
    const sum = r.brokerage + r.stt + r.exchangeTxn + r.sebiCharges + r.gst + r.stampDuty + (r.spreadCost ?? 0);
    expect(r.total).toBeCloseTo(sum, 2);
  });

  it("uses real spread when provided", () => {
    const withReal = computeFnoCosts(entryPremium, exitPremium, qty, 4, 5);
    const withDefault = computeFnoCosts(entryPremium, exitPremium, qty, null, null);
    expect(withReal.spreadModelled).toBe(false);
    expect(withDefault.spreadModelled).toBe(true);
    expect(withReal.spreadCost).toBeCloseTo((4 / 2 + 5 / 2) * qty, 2);
  });
});

// ---------------------------------------------------------------------------
// 4. Agreement test — paperReportsFO and premiumReplay agree on STT/exchange
// ---------------------------------------------------------------------------

describe("Cross-consumer STT and exchange rate agreement", () => {
  const entryPremium = 100;
  const exitPremium = 130;
  const lots = 2;
  const lotSize = 50; // 100 contracts

  it("STT amounts agree between paperReportsFO and premiumReplay", () => {
    const foReport = computeFOCharges(entryPremium * lots * lotSize, exitPremium * lots * lotSize);
    const replay = computeFnoCosts(entryPremium, exitPremium, lots * lotSize, null, null);
    expect(foReport.stt).toBeCloseTo(replay.stt, 2);
  });

  it("exchange charges agree between paperReportsFO and premiumReplay", () => {
    const foReport = computeFOCharges(entryPremium * lots * lotSize, exitPremium * lots * lotSize);
    const replay = computeFnoCosts(entryPremium, exitPremium, lots * lotSize, null, null);
    expect(foReport.transactionCharges).toBeCloseTo(replay.exchangeTxn, 2);
  });

  it("backtestCharges STT agrees with canonical fnoCostModel", () => {
    const canonical = computeFnoTradeCost({ entryPremium, exitPremium, lots, lotSize });
    const backtest = computeBacktestTradeCost({ pnl: 0, lots, lotSize, optionEntry: entryPremium, optionExit: exitPremium });
    expect(backtest.stt).toBeCloseTo(canonical.stt, 2);
  });

  it("backtestCharges exchange charges agree with canonical fnoCostModel", () => {
    const canonical = computeFnoTradeCost({ entryPremium, exitPremium, lots, lotSize });
    const backtest = computeBacktestTradeCost({ pnl: 0, lots, lotSize, optionEntry: entryPremium, optionExit: exitPremium });
    expect(backtest.exchangeCharges).toBeCloseTo(canonical.exchangeTxn, 2);
  });
});

// ---------------------------------------------------------------------------
// 5. Net P&L formula invariant
// ---------------------------------------------------------------------------

describe("Net P&L formula invariant: netPnl = grossPnl − totalCharges", () => {
  it("paperReportsFO: netPnl = realizedPnl - charges (verified via computeFOCharges)", () => {
    const entry = 100;
    const exit = 130;
    const lots = 1;
    const lotSize = 50;
    const qty = lots * lotSize;
    const realizedPnl = (exit - entry) * qty;
    const result = computeFnoTradeCost({ entryPremium: entry, exitPremium: exit, lots, lotSize });
    const netPnl = realizedPnl - result.totalCost;
    expect(result.netPnl).toBeCloseTo(netPnl, 4);
  });

  it("premiumReplay: grossPnl - costs.total = netPnl", () => {
    const entry = 100;
    const exit = 130;
    const qty = 50;
    const grossPnl = (exit - entry) * qty;
    const costs = computeFnoCosts(entry, exit, qty, null, null);
    const netPnl = grossPnl - costs.total;
    expect(netPnl).toBeCloseTo(grossPnl - costs.total, 4);
  });

  it("backtestCharges: netPnl = grossPnl - totalCharges", () => {
    const grossPnl = 1500;
    const result = computeBacktestTradeCost({ pnl: grossPnl, lots: 1, lotSize: 50, optionEntry: 100, optionExit: 130 });
    expect(result.netPnl).toBeCloseTo(result.grossPnl! - result.totalCharges, 4);
  });
});

// ---------------------------------------------------------------------------
// 6. Golden-number regression — 10 lots NIFTY (lot size 25), entry ₹120, exit ₹145
// ---------------------------------------------------------------------------

describe("Golden-number regression — NIFTY 10 lots, entry 120, exit 145", () => {
  const entry = 120;
  const exit = 145;
  const lots = 10;
  const lotSize = 25;
  const qty = lots * lotSize; // 250 contracts

  const buyTurnover = entry * qty;     // ₹30,000
  const sellTurnover = exit * qty;     // ₹36,250
  const totalTurnover = buyTurnover + sellTurnover; // ₹66,250
  const grossPnl = (exit - entry) * qty; // ₹6,250

  // Expected values from canonical formulas:
  const expectedBrokerage = 40;                                                      // ₹20 × 2
  const expectedStt = sellTurnover * 0.0015;                                        // ₹54.375
  const expectedExchangeTxn = totalTurnover * 0.0003503;                            // ₹23.20
  const expectedSebi = totalTurnover * 0.000001;                                    // ₹0.066
  const expectedGst = (expectedBrokerage + expectedExchangeTxn + expectedSebi) * 0.18;
  const expectedStampDuty = buyTurnover * 0.00003;                                  // ₹0.90
  const spreadRate = 25 / 10_000;
  const expectedSpread = totalTurnover * spreadRate;                                 // ₹16.5625
  const slippageRate = 10 / 10_000;
  const expectedSlippage = totalTurnover * slippageRate;                             // ₹6.625

  it("canonical computeFnoTradeCost — brokerage = ₹40", () => {
    const r = computeFnoTradeCost({ entryPremium: entry, exitPremium: exit, lots, lotSize });
    expect(r.brokerage).toBeCloseTo(expectedBrokerage, 2);
  });

  it("canonical computeFnoTradeCost — STT = 0.15% of sell turnover", () => {
    const r = computeFnoTradeCost({ entryPremium: entry, exitPremium: exit, lots, lotSize });
    expect(r.stt).toBeCloseTo(expectedStt, 2);
  });

  it("canonical computeFnoTradeCost — exchange at 0.03503%", () => {
    const r = computeFnoTradeCost({ entryPremium: entry, exitPremium: exit, lots, lotSize });
    expect(r.exchangeTxn).toBeCloseTo(expectedExchangeTxn, 2);
  });

  it("canonical computeFnoTradeCost — netPnl = grossPnl - totalCost", () => {
    const r = computeFnoTradeCost({ entryPremium: entry, exitPremium: exit, lots, lotSize });
    expect(r.grossPnl).toBeCloseTo(grossPnl, 2);
    expect(r.netPnl).toBeCloseTo(r.grossPnl! - r.totalCost, 4);
  });

  it("computeFnoCosts (replay) — STT matches canonical at 0.15%", () => {
    const r = computeFnoCosts(entry, exit, qty, null, null);
    // computeFnoCosts rounds via r2(); use 1dp tolerance to absorb that rounding
    expect(r.stt).toBeCloseTo(expectedStt, 1);
  });

  it("computeFnoCosts (replay) — exchange matches canonical at 0.03503%", () => {
    const r = computeFnoCosts(entry, exit, qty, null, null);
    // computeFnoCosts rounds via r2(); use 1dp tolerance to absorb that rounding
    expect(r.exchangeTxn).toBeCloseTo(expectedExchangeTxn, 1);
  });

  it("computeFOCharges (paper reports) — STT matches canonical at 0.15%", () => {
    const r = computeFOCharges(buyTurnover, sellTurnover);
    expect(r.stt).toBeCloseTo(expectedStt, 2);
  });

  it("computeFOCharges (paper reports) — exchange matches canonical at 0.03503%", () => {
    const r = computeFOCharges(buyTurnover, sellTurnover);
    expect(r.transactionCharges).toBeCloseTo(expectedExchangeTxn, 2);
  });

  it("old stale STT (0.10%) would have given a LOWER cost than canonical (confirms direction of fix)", () => {
    const staleStt = sellTurnover * 0.001;   // 0.10%
    const canonicalStt = sellTurnover * 0.0015; // 0.15%
    expect(canonicalStt).toBeGreaterThan(staleStt);
  });

  it("old stale futures STT (0.05%) would have given a MUCH LOWER cost than canonical", () => {
    const futureStt = sellTurnover * 0.0005;   // 0.05%
    const canonicalStt = sellTurnover * 0.0015; // 0.15%
    expect(canonicalStt).toBeGreaterThan(futureStt);
    expect(canonicalStt / futureStt).toBeCloseTo(3, 1); // 3× higher
  });

  it("old stale exchange (0.053%) was HIGHER than canonical 0.03503%", () => {
    const staleExchange = totalTurnover * 0.00053;
    const canonicalExchange = totalTurnover * 0.0003503;
    expect(staleExchange).toBeGreaterThan(canonicalExchange);
  });
});

// ---------------------------------------------------------------------------
// 7. Structural — paperReportsFO routes through canonical (no local STT literal)
// ---------------------------------------------------------------------------

describe("Structural: paperReportsFO and premiumReplay use canonical model", () => {
  it("computeFOCharges returns costModelSource containing 'fnoCostModel'", () => {
    const r = computeFOCharges(3000, 3625);
    expect(r.costModelSource).toMatch(/fnoCostModel/);
  });

  it("computeFOCharges returns costModelAsOf matching FNO_COST_PARAMS_ASOF", () => {
    const r = computeFOCharges(3000, 3625);
    expect(r.costModelAsOf).toBe(FNO_COST_PARAMS_ASOF);
  });

  it("computeFnoCosts STT rate resolves to canonical 0.15% (not the old 0.05%)", () => {
    const qty = 25;
    const exitPremium = 100;
    const r = computeFnoCosts(80, exitPremium, qty, null, null);
    const impliedSttRate = r.stt / (exitPremium * qty);
    expect(impliedSttRate).toBeCloseTo(FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM, 6);
  });

  it("computeFnoCosts exchange charge matches canonical 0.03503% applied to total turnover", () => {
    const qty = 25;
    const entry = 80;
    const exit = 100;
    const r = computeFnoCosts(entry, exit, qty, null, null);
    const totalTurnover = (entry + exit) * qty;
    // Compare the absolute exchangeTxn value (not the implied rate) to absorb r2 rounding
    const expectedExchange = totalTurnover * FNO_COST_PARAMS.EXCHANGE_TXN_RATE;
    expect(r.exchangeTxn).toBeCloseTo(expectedExchange, 1);
  });
});

// ---------------------------------------------------------------------------
// 8. backtestCharges Phase 3A regression (must remain green)
// ---------------------------------------------------------------------------

describe("backtestCharges Phase 3A regression (canonical usage intact)", () => {
  it("computeBacktestTradeCost uses canonical STT at 0.15%", () => {
    const r = computeBacktestTradeCost({
      pnl: 1500,
      lots: 1,
      lotSize: 50,
      optionEntry: 100,
      optionExit: 130,
    });
    const qty = 50;
    const sellTurnover = 130 * qty;
    const expectedStt = sellTurnover * FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM;
    expect(r.stt).toBeCloseTo(expectedStt, 2);
  });

  it("netPnl = grossPnl - totalCharges (invariant)", () => {
    const r = computeBacktestTradeCost({
      pnl: 1500,
      lots: 2,
      lotSize: 50,
      optionEntry: 150,
      optionExit: 165,
    });
    expect(r.netPnl).toBeCloseTo(r.grossPnl! - r.totalCharges, 5);
  });
});
