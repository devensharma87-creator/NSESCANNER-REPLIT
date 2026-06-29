/**
 * Part N — Swing Cash Cost / Slippage Model (pure).
 *
 * Estimates the round-trip cost of a CASH DELIVERY swing trade (buy + sell)
 * using Indian charge components, then derives the net target profit and the
 * after-cost R multiple so the composer can reject trades whose edge is eaten
 * by costs. Defaults are conservative and configurable; this is a reporting/
 * gating estimate, not a billing system.
 *
 * Pure function: no DB, no network, no side effects.
 */

import type {
  SwingCashCostInput,
  SwingCashCostConfig,
  SwingCashCostResult,
} from "./swingCashTypes";

export function computeSwingCashCost(
  input: SwingCashCostInput,
  config: SwingCashCostConfig,
): SwingCashCostResult {
  const { entry, target, stop, qty, minRR } = input;

  const buyTurnover = entry * qty;
  const sellTurnover = target * qty;
  const turnover = buyTurnover + sellTurnover;

  const brokerage =
    config.brokeragePerOrder * 2 + (config.brokeragePct / 100) * turnover;
  const stt = (config.sttPct / 100) * turnover;
  const exchangeTxn = (config.exchangeTxnPct / 100) * turnover;
  const sebi = (config.sebiPct / 100) * turnover;
  const stampDuty = (config.stampDutyPctBuy / 100) * buyTurnover;
  const gst = (config.gstPct / 100) * (brokerage + exchangeTxn + sebi);
  const dpCharge = config.dpChargePerSell;

  const estimatedCharges =
    brokerage + stt + exchangeTxn + sebi + stampDuty + gst + dpCharge;
  const estimatedSlippage = (config.slippagePct / 100) * turnover;

  const grossTargetProfit = (target - entry) * qty;
  const netTargetProfit = grossTargetProfit - estimatedCharges - estimatedSlippage;

  const grossRisk = (entry - stop) * qty;
  const expectedRGross = grossRisk > 0 ? grossTargetProfit / grossRisk : 0;
  const expectedRAfterCost = grossRisk > 0 ? netTargetProfit / grossRisk : 0;
  const passesMinRR = expectedRAfterCost >= minRR;

  return {
    grossTargetProfit,
    estimatedCharges,
    estimatedSlippage,
    netTargetProfit,
    grossRisk,
    expectedRGross,
    expectedRAfterCost,
    passesMinRR,
    breakdown: { brokerage, stt, exchangeTxn, sebi, stampDuty, gst, dpCharge },
  };
}
