/**
 * Part E — Swing Cash Risk-based Position Sizing (pure).
 *
 * Computes quantity from the most-conservative of three constraints:
 *   - by risk:  riskAmount / riskPerShare
 *   - by value: maxPositionValue / entry
 *   - by cash:  (availableCash − reserve) / (entry × slippage buffer)
 * Adds a gap-risk buffer to the reported max loss, enforces a minimum viable
 * position value, and respects a cash reserve. Does NOT mutate any account.
 *
 * Pure function: no DB, no network, no side effects.
 */

import type {
  SwingCashSizingInput,
  SwingCashSizingConfig,
  SwingCashSizingResult,
  SwingCashSizingReason,
} from "./swingCashTypes";

export function computeSwingCashSizing(
  input: SwingCashSizingInput,
  config: SwingCashSizingConfig,
): SwingCashSizingResult {
  // Fail-closed input/config validation. A non-finite (NaN/Infinity) or negative
  // capital/cash/config value would make `qty` NaN, and `NaN < 1` /
  // `NaN < minPositionValue` are both false — so a corrupt input could otherwise
  // slip through every guard below and return allowed=true with qty=NaN.
  const isNum = (n: number) => Number.isFinite(n);
  if (
    !isNum(input.entry) ||
    !isNum(input.stop) ||
    !isNum(input.totalSwingCapital) ||
    !isNum(input.availableCash) ||
    input.totalSwingCapital < 0 ||
    input.availableCash < 0 ||
    !isNum(config.riskPerTradePct) ||
    !isNum(config.maxRiskPerTrade) ||
    !isNum(config.maxPositionValuePct) ||
    !isNum(config.reserveCashPct) ||
    !isNum(config.slippageBufferPct) ||
    !isNum(config.gapBufferPct) ||
    !isNum(config.minPositionValue) ||
    !isNum(config.lotSize)
  ) {
    return {
      allowed: false,
      reason: "SIZING_INPUT_INVALID",
      qty: 0,
      capitalRequired: 0,
      riskPerShare: 0,
      maxLoss: 0,
      maxLossWithGap: 0,
      riskPct: 0,
      positionValuePct: 0,
      detail: `Invalid sizing inputs/config (non-finite or negative): entry=${input.entry}, stop=${input.stop}, capital=${input.totalSwingCapital}, cash=${input.availableCash}.`,
      workings: {
        riskAmount: 0,
        qtyByRisk: 0,
        qtyByValue: 0,
        qtyByCash: 0,
        maxPositionValue: 0,
        deployableCash: 0,
      },
    };
  }

  const { entry, stop, totalSwingCapital, availableCash } = input;
  const lot = config.lotSize > 0 ? config.lotSize : 1;

  const riskPerShare = entry - stop;
  const riskAmount = Math.min(
    totalSwingCapital * (config.riskPerTradePct / 100),
    config.maxRiskPerTrade,
  );
  const maxPositionValue = totalSwingCapital * (config.maxPositionValuePct / 100);
  const deployableCash = Math.max(0, availableCash * (1 - config.reserveCashPct / 100));
  const affordPerShare = entry * (1 + config.slippageBufferPct / 100);

  const floorToLot = (n: number) => Math.floor(n / lot) * lot;

  const qtyByRisk = riskPerShare > 0 ? floorToLot(riskAmount / riskPerShare) : 0;
  const qtyByValue = entry > 0 ? floorToLot(maxPositionValue / entry) : 0;
  const qtyByCash = affordPerShare > 0 ? floorToLot(deployableCash / affordPerShare) : 0;

  const workings = {
    riskAmount,
    qtyByRisk,
    qtyByValue,
    qtyByCash,
    maxPositionValue,
    deployableCash,
  };

  const reject = (
    reason: SwingCashSizingReason,
    detail: string,
    qty = 0,
  ): SwingCashSizingResult => {
    const capitalRequired = qty * entry;
    const maxLoss = qty * Math.max(riskPerShare, 0);
    return {
      allowed: false,
      reason,
      qty,
      capitalRequired,
      riskPerShare,
      maxLoss,
      maxLossWithGap: maxLoss + qty * entry * (config.gapBufferPct / 100),
      riskPct: totalSwingCapital > 0 ? (maxLoss / totalSwingCapital) * 100 : 0,
      positionValuePct: totalSwingCapital > 0 ? (capitalRequired / totalSwingCapital) * 100 : 0,
      detail,
      workings,
    };
  };

  // Invalid risk-per-share (stop not below entry, or non-finite inputs).
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(stop) ||
    entry <= 0 ||
    riskPerShare <= 0
  ) {
    return reject(
      "RISK_PER_SHARE_INVALID",
      `Invalid risk per share: entry=${entry}, stop=${stop} (need stop < entry, positive entry).`,
    );
  }

  const qty = Math.min(qtyByRisk, qtyByValue, qtyByCash);

  if (qty < 1) {
    // Distinguish "no cash" from "binding constraint elsewhere".
    if (qtyByCash < 1) {
      return reject(
        "INSUFFICIENT_CASH",
        `Insufficient deployable cash: ₹${Math.round(deployableCash)} after ${config.reserveCashPct}% reserve cannot buy 1 share @ ₹${affordPerShare.toFixed(2)}.`,
      );
    }
    return reject(
      "QTY_LT_1",
      `Sizing resolves to 0 (byRisk=${qtyByRisk}, byValue=${qtyByValue}, byCash=${qtyByCash}).`,
    );
  }

  const capitalRequired = qty * entry;

  if (capitalRequired < config.minPositionValue) {
    return reject(
      "POSITION_TOO_SMALL",
      `Position value ₹${Math.round(capitalRequired)} < min viable ₹${config.minPositionValue} — not worth trading.`,
      qty,
    );
  }

  const maxLoss = qty * riskPerShare;
  const maxLossWithGap = maxLoss + qty * entry * (config.gapBufferPct / 100);
  const riskPct = totalSwingCapital > 0 ? (maxLoss / totalSwingCapital) * 100 : 0;
  const positionValuePct = totalSwingCapital > 0 ? (capitalRequired / totalSwingCapital) * 100 : 0;

  const binding =
    qty === qtyByRisk ? "risk" : qty === qtyByValue ? "max-position-value" : "cash";

  return {
    allowed: true,
    reason: null,
    qty,
    capitalRequired,
    riskPerShare,
    maxLoss,
    maxLossWithGap,
    riskPct,
    positionValuePct,
    detail: `Size ${qty} @ ₹${entry.toFixed(2)} (₹${Math.round(capitalRequired)}, risk ₹${Math.round(maxLoss)} = ${riskPct.toFixed(2)}%, gap-adj ₹${Math.round(maxLossWithGap)}); bound by ${binding}.`,
    workings,
  };
}
