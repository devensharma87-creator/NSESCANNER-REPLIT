/**
 * Part F — Swing Cash Liquidity / Execution Gate (pure).
 *
 * Blocks illiquid or surveillance-flagged names. Never fabricates a "liquid"
 * verdict from incomplete data: when any required execution-quality field
 * (traded value, volume, spread, ASM/GSM, circuit) is unavailable it returns a
 * REVIEW_REQUIRED classification rather than assuming "clear".
 *
 * Pure function: no DB, no network, no side effects.
 */

import type {
  SwingCashLiquidityInput,
  SwingCashLiquidityConfig,
  SwingCashLiquidityResult,
  SwingCashLiquidityClassification,
} from "./swingCashTypes";

export function evaluateSwingCashLiquidity(
  input: SwingCashLiquidityInput,
  config: SwingCashLiquidityConfig,
): SwingCashLiquidityResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const metrics = {
    avgTradedValue: input.avgTradedValue,
    spreadPct: input.spreadPct,
    deliveryPct: input.deliveryPct,
  };

  const build = (
    classification: SwingCashLiquidityClassification,
    tradeable: boolean,
    reviewRequired: boolean,
  ): SwingCashLiquidityResult => ({
    classification,
    tradeable,
    reviewRequired,
    warnings,
    reasons,
    metrics,
  });

  // 1. Hard blocks first — these are definite facts regardless of any other
  //    missing field, so they take precedence over the completeness check.
  if (config.blockOnCircuit && input.circuitRisk === true) {
    reasons.push("Circuit / price-band risk flagged.");
    return build("CIRCUIT_RISK", false, false);
  }

  if (
    config.blockOnAsmGsm &&
    (input.asmGsmStatus === "ASM" || input.asmGsmStatus === "GSM")
  ) {
    reasons.push(`Under ${input.asmGsmStatus} surveillance — blocked for live entry.`);
    return build("ASM_GSM_RISK", false, false);
  }

  // 2. Surveillance status unknown → review required (never assume clear).
  if (config.blockOnAsmGsm && input.asmGsmStatus == null) {
    reasons.push("ASM/GSM surveillance status unavailable — manual review required.");
    return build("ASM_GSM_UNAVAILABLE_REVIEW_REQUIRED", false, true);
  }

  // 3. Required execution-quality fields must all be present. A one-sided or
  //    partial feed can NEVER be classified "liquid" — fail to review.
  // Non-finite numerics (NaN/Infinity) are treated exactly like missing data.
  const missing: string[] = [];
  if (!Number.isFinite(input.avgTradedValue)) missing.push("avgTradedValue");
  if (!Number.isFinite(input.volume)) missing.push("volume");
  if (!Number.isFinite(input.spreadPct)) missing.push("spreadPct");
  if (config.blockOnCircuit && input.circuitRisk == null) missing.push("circuitRisk");
  if (missing.length > 0) {
    reasons.push(`Liquidity data unavailable (missing: ${missing.join(", ")}).`);
    return build("LIQUIDITY_DATA_UNAVAILABLE", false, true);
  }

  // 4. Threshold blocks (all required fields are present beyond this point).
  if (input.avgTradedValue != null && input.avgTradedValue < config.minAvgTradedValue) {
    reasons.push(
      `Avg traded value ₹${Math.round(input.avgTradedValue)} < min ₹${config.minAvgTradedValue}.`,
    );
    return build("LOW_TRADED_VALUE", false, false);
  }

  if (input.volume != null && input.volume < config.minVolume) {
    reasons.push(`Avg volume ${input.volume} < min ${config.minVolume}.`);
    return build("LOW_VOLUME", false, false);
  }

  if (input.spreadPct != null && input.spreadPct > config.maxSpreadPct) {
    reasons.push(
      `Bid/ask spread ${input.spreadPct.toFixed(2)}% > max ${config.maxSpreadPct}%.`,
    );
    return build("HIGH_SPREAD", false, false);
  }

  // 5. Warnings (informational, do not block). Delivery % is not a hard gate.
  if (
    input.deliveryPct != null &&
    Number.isFinite(input.deliveryPct) &&
    input.deliveryPct < config.minDeliveryPct
  ) {
    warnings.push(
      `Low delivery %: ${input.deliveryPct.toFixed(1)}% < ${config.minDeliveryPct}% (more speculative).`,
    );
  }

  reasons.push("Liquidity OK.");
  return build("LIQUIDITY_OK", true, false);
}
