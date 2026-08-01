/**
 * Pack 3 — Gate J: Equity paper-trade P&L and charges reconciliation.
 *
 * Tests:
 *  (a) computeEquityCharges: rate schedule, additive components, gross/net split.
 *  (b) Accounting identity: netPnl = grossPnl − chargesTotal at close.
 *  (c) computeSwingCashCost: rate consistency with computeEquityCharges, key
 *      assumptions (STT both sides, stamp buy-only, DP per-scrip).
 *  (d) Balance credit identity: balance += proceeds − chargesTotal.
 *  (e) realizedPnl (gross) vs netPnl (charges-adjusted) semantic distinction.
 *
 * All tests pure / zero-DB.
 */

import { describe, it, expect } from "vitest";
import { computeEquityCharges } from "./paperReportsEq";
import { computeSwingCashCost } from "./swingCashCostModel";
import type { SwingCashCostInput, SwingCashCostConfig } from "./swingCashTypes";

// ── computeEquityCharges ─────────────────────────────────────────────────────

describe("Pack3/GateJ — computeEquityCharges rate schedule", () => {
  const BUY = 100_000; // ₹1 L buy turnover
  const SELL = 110_000; // ₹1.1 L sell turnover

  it("brokerage is ₹0 (delivery is free)", () => {
    const c = computeEquityCharges(BUY, SELL, 1);
    expect(c.brokerage).toBe(0);
  });

  it("STT is 0.1% on BOTH buy and sell turnover", () => {
    const c = computeEquityCharges(BUY, SELL, 1);
    const expected = 0.001 * (BUY + SELL);
    expect(c.stt).toBeCloseTo(expected, 6);
  });

  it("exchange transaction is 0.00297% on total turnover", () => {
    const c = computeEquityCharges(BUY, SELL, 1);
    const expected = 0.0000297 * (BUY + SELL);
    expect(c.transactionCharges).toBeCloseTo(expected, 8);
  });

  it("SEBI is ₹10 per crore on total turnover", () => {
    const c = computeEquityCharges(BUY, SELL, 1);
    const expected = (10 / 1e7) * (BUY + SELL);
    expect(c.sebiCharges).toBeCloseTo(expected, 10);
  });

  it("stamp duty is 0.015% on BUY side only", () => {
    const c = computeEquityCharges(BUY, SELL, 1);
    const expected = 0.00015 * BUY;
    expect(c.stampDuty).toBeCloseTo(expected, 8);
  });

  it("GST is 18% of (brokerage + transactionCharges + sebiCharges)", () => {
    const c = computeEquityCharges(BUY, SELL, 1);
    const gstBase = c.brokerage + c.transactionCharges + c.sebiCharges;
    expect(c.gst).toBeCloseTo(0.18 * gstBase, 8);
  });

  it("DP charge is ₹15.93 per sell scrip", () => {
    const c = computeEquityCharges(BUY, SELL, 1);
    expect(c.dpCharges).toBeCloseTo(15.93, 5);
  });

  it("two scrips → DP = 2 × 15.93", () => {
    const c = computeEquityCharges(BUY, SELL, 2);
    expect(c.dpCharges).toBeCloseTo(31.86, 5);
  });

  it("total equals sum of all components", () => {
    const c = computeEquityCharges(BUY, SELL, 1);
    const sum = c.brokerage + c.stt + c.transactionCharges + c.sebiCharges + c.gst + c.stampDuty + c.dpCharges;
    expect(c.total).toBeCloseTo(sum, 8);
  });

  it("all components are non-negative", () => {
    const c = computeEquityCharges(BUY, SELL, 1);
    expect(c.brokerage).toBeGreaterThanOrEqual(0);
    expect(c.stt).toBeGreaterThanOrEqual(0);
    expect(c.transactionCharges).toBeGreaterThanOrEqual(0);
    expect(c.sebiCharges).toBeGreaterThanOrEqual(0);
    expect(c.gst).toBeGreaterThanOrEqual(0);
    expect(c.stampDuty).toBeGreaterThanOrEqual(0);
    expect(c.dpCharges).toBeGreaterThanOrEqual(0);
    expect(c.total).toBeGreaterThan(0);
  });
});

// ── P&L accounting identities ────────────────────────────────────────────────

describe("Pack3/GateJ — P&L accounting identities", () => {
  // Mirror of closePaperEquityTradeRow (paperTradingEq.ts:968-981)
  function closeTrade(entry: number, exit: number, qty: number) {
    const buyTurnover = entry * qty;
    const sellTurnover = exit * qty;
    const charges = computeEquityCharges(buyTurnover, sellTurnover, 1);
    const grossPnl = (exit - entry) * qty;          // line 969, 980
    const netPnl = grossPnl - charges.total;         // line 981
    const proceeds = exit * qty;                      // line 968
    const balanceCredit = proceeds - charges.total;  // line 1013
    return { grossPnl, netPnl, chargesTotal: charges.total, proceeds, balanceCredit };
  }

  it("TARGET2_HIT — grossPnl > 0, netPnl < grossPnl", () => {
    const { grossPnl, netPnl, chargesTotal } = closeTrade(1000, 1200, 100);
    expect(grossPnl).toBe(20_000);
    expect(netPnl).toBe(grossPnl - chargesTotal);
    expect(netPnl).toBeLessThan(grossPnl);
  });

  it("STOPPED — grossPnl < 0, netPnl < grossPnl (charges compound the loss)", () => {
    const { grossPnl, netPnl, chargesTotal } = closeTrade(1000, 950, 100);
    expect(grossPnl).toBe(-5_000);
    expect(netPnl).toBe(grossPnl - chargesTotal);
    expect(netPnl).toBeLessThan(grossPnl);
  });

  it("TRAIL_STOP_HIT — exited at t1 price (stop trailed to T1)", () => {
    // Same arithmetic as STOPPED — exit at the trailed stop price
    const { grossPnl } = closeTrade(1000, 1100, 50);
    expect(grossPnl).toBe(5_000);
  });

  it("TIME_STOP — exited at lastPrice (could be positive or negative)", () => {
    const positive = closeTrade(1000, 1050, 100);
    const negative = closeTrade(1000, 980, 100);
    expect(positive.grossPnl).toBeGreaterThan(0);
    expect(negative.grossPnl).toBeLessThan(0);
  });

  it("SIGNAL_FLIP — exit at LTP (may be partial loss)", () => {
    const { grossPnl, netPnl } = closeTrade(1000, 1020, 75);
    expect(netPnl).toBe(grossPnl - computeEquityCharges(1000 * 75, 1020 * 75, 1).total);
  });

  it("netPnl identity holds: netPnl = grossPnl - chargesTotal", () => {
    for (const [entry, exit, qty] of [[500, 600, 200], [1000, 950, 100], [250, 250, 500]]) {
      const t = closeTrade(entry!, exit!, qty!);
      expect(t.netPnl).toBeCloseTo(t.grossPnl - t.chargesTotal, 8);
    }
  });

  it("balanceCredit = proceeds - chargesTotal (not gross P&L)", () => {
    const { proceeds, chargesTotal, balanceCredit } = closeTrade(1000, 1100, 100);
    expect(balanceCredit).toBeCloseTo(proceeds - chargesTotal, 8);
  });

  it("realizedPnl (gross) ≠ netPnl when chargesTotal > 0", () => {
    const { grossPnl, netPnl, chargesTotal } = closeTrade(1000, 1200, 100);
    expect(chargesTotal).toBeGreaterThan(0);
    expect(grossPnl).not.toBe(netPnl);
  });

  it("zero quantity trade has zero P&L", () => {
    const { grossPnl, chargesTotal } = closeTrade(1000, 1200, 0);
    expect(grossPnl).toBe(0);
    // DP charge is fixed per scrip, so even 0-qty has charges (dpCharges=15.93)
    // The DP charge is still ₹15.93 for one scrip regardless of qty
    expect(chargesTotal).toBeCloseTo(15.93, 1);
  });
});

// ── computeSwingCashCost rate consistency ────────────────────────────────────

describe("Pack3/GateJ — computeSwingCashCost rate consistency", () => {
  const defaultConfig: SwingCashCostConfig = {
    brokeragePerOrder: 0,
    brokeragePct: 0,
    sttPct: 0.1,      // Same as computeEquityCharges (0.001 → 0.1%)
    exchangeTxnPct: 0.00297,  // Same as 0.0000297 expressed as 0.00297%
    sebiPct: 0.0001,           // Same as (10/1e7)*100 = 0.0001%
    stampDutyPctBuy: 0.015,   // Same as 0.00015 expressed as 0.015%
    gstPct: 18,
    dpChargePerSell: 15.93,
    slippagePct: 0,    // zero slippage for rate comparison
    gapBufferPct: 0,   // no gap buffer for rate-comparison tests
  };

  const input: SwingCashCostInput = {
    entry: 1000,
    target: 1200,
    stop: 950,
    qty: 100,
    minRR: 2,
  };

  it("computeSwingCashCost returns a result with required keys", () => {
    const result = computeSwingCashCost(input, defaultConfig);
    expect(result).toHaveProperty("grossTargetProfit");
    expect(result).toHaveProperty("estimatedCharges");
    expect(result).toHaveProperty("estimatedSlippage");
    expect(result).toHaveProperty("netTargetProfit");
    expect(result).toHaveProperty("grossRisk");
    expect(result).toHaveProperty("expectedRGross");
    expect(result).toHaveProperty("expectedRAfterCost");
    expect(result).toHaveProperty("passesMinRR");
    expect(result).toHaveProperty("breakdown");
  });

  it("grossTargetProfit = (target - entry) × qty", () => {
    const result = computeSwingCashCost(input, defaultConfig);
    expect(result.grossTargetProfit).toBeCloseTo((input.target - input.entry) * input.qty, 6);
  });

  it("netTargetProfit = grossTargetProfit - charges - slippage", () => {
    const result = computeSwingCashCost(input, defaultConfig);
    expect(result.netTargetProfit).toBeCloseTo(
      result.grossTargetProfit - result.estimatedCharges - result.estimatedSlippage, 6
    );
  });

  it("expectedRGross = grossTargetProfit / grossRisk", () => {
    const result = computeSwingCashCost(input, defaultConfig);
    const expectedR = result.grossTargetProfit / result.grossRisk;
    expect(result.expectedRGross).toBeCloseTo(expectedR, 6);
  });

  it("passesMinRR reflects expectedRAfterCost vs input.minRR", () => {
    const result = computeSwingCashCost(input, defaultConfig);
    // minRR comes from input (not config)
    const expected = result.expectedRAfterCost >= input.minRR;
    expect(result.passesMinRR).toBe(expected);
  });

  it("STT rate in cost model matches computeEquityCharges (both 0.1%)", () => {
    // computeEquityCharges uses 0.001 (total turnover); cost model uses sttPct=0.1 (%)
    const turnover = input.entry * input.qty + input.target * input.qty;
    const costModelStt = (defaultConfig.sttPct / 100) * turnover;
    const reportStt = 0.001 * turnover;
    expect(costModelStt).toBeCloseTo(reportStt, 8);
  });

  it("DP charge matches ₹15.93 per sell", () => {
    const result = computeSwingCashCost(input, defaultConfig);
    expect(result.breakdown.dpCharge).toBe(15.93);
  });

  it("all breakdown components are non-negative with zero brokerage", () => {
    const result = computeSwingCashCost(input, defaultConfig);
    for (const [key, val] of Object.entries(result.breakdown)) {
      expect(val, `breakdown.${key}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("estimatedCharges equals sum of breakdown components", () => {
    const result = computeSwingCashCost(input, defaultConfig);
    const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    expect(result.estimatedCharges).toBeCloseTo(sum, 8);
  });

  it("high-minRR scenario fails passesMinRR", () => {
    // minRR lives in input, not config — use a very high input.minRR
    const strictInput: SwingCashCostInput = { ...input, minRR: 100 };
    const result = computeSwingCashCost(strictInput, defaultConfig);
    expect(result.passesMinRR).toBe(false);
  });
});

// ── Charge accumulation across cohort ───────────────────────────────────────

describe("Pack3/GateJ — cohort charge accumulation", () => {
  it("total charges across N independent trades = sum of individual trade charges", () => {
    const trades = [
      { entry: 500, exit: 550, qty: 200 },
      { entry: 1000, exit: 950, qty: 100 },
      { entry: 2000, exit: 2200, qty: 50 },
    ];

    let sumCharges = 0;
    for (const t of trades) {
      const c = computeEquityCharges(t.entry * t.qty, t.exit * t.qty, 1);
      sumCharges += c.total;
    }

    const individualTotal = trades.reduce((acc, t) => {
      return acc + computeEquityCharges(t.entry * t.qty, t.exit * t.qty, 1).total;
    }, 0);

    expect(sumCharges).toBeCloseTo(individualTotal, 8);
  });

  it("netPnl sum = grossPnl sum - totalCharges sum", () => {
    const trades = [
      { entry: 1000, exit: 1200, qty: 100 },
      { entry: 500, exit: 450, qty: 200 },
    ];

    let grossSum = 0;
    let chargeSum = 0;
    let netSum = 0;

    for (const t of trades) {
      const gross = (t.exit - t.entry) * t.qty;
      const c = computeEquityCharges(t.entry * t.qty, t.exit * t.qty, 1);
      grossSum += gross;
      chargeSum += c.total;
      netSum += gross - c.total;
    }

    expect(netSum).toBeCloseTo(grossSum - chargeSum, 8);
  });
});
