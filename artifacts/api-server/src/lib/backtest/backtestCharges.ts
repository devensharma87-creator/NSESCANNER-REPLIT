/**
 * Backtest Lab — unified charges adapter for all backtest modes (A, B, C).
 *
 * Wraps `computeFnoTradeCost` from the shared F&O cost model and handles
 * the case where real option premiums are unavailable (Modes B/C use a
 * modeled ATM premium derived from entry spot × `MODELED_ATM_PREMIUM_PCT`).
 *
 * SCOPE CONTRACT: pure function, no DB, no network, no side effects.
 * All statutory rates live in `fnoCostModel.ts` as the single source of truth.
 *
 * Modes:
 *   A (REAL_REPLAY)     — real captured entry/exit premiums → premiumModeled=false
 *   B (DIRECTIONAL)     — no historical premiums → modeled from entrySpot
 *   C (STRATEGY_RESEARCH) — same as Mode B
 *   D (SNAPSHOT_PREMIUM_REPLAY) — uses its own `FnoCostBreakdown` path; not this module
 */

import { computeFnoTradeCost, FNO_COST_PARAMS, FNO_COST_PARAMS_ASOF } from "../fnoCostModel";
import type { BacktestTradeCostResult } from "./types";

/**
 * ATM option premium modeled as a fraction of entry spot for Modes B/C.
 * 0.7% is a conservative estimate for liquid ATM NIFTY/BANKNIFTY index options.
 * Actual premiums vary by IV and DTE; this is labeled honestly to the user.
 */
export const MODELED_ATM_PREMIUM_PCT = 0.007;

/**
 * Human-readable charges assumptions block — consumed by the UI assumptions panel.
 * All values mirror `FNO_COST_PARAMS` so there is a single source of truth.
 */
export const BACKTEST_CHARGES_ASSUMPTIONS = {
  asOf: FNO_COST_PARAMS_ASOF,
  brokeragePerSide: FNO_COST_PARAMS.BROKERAGE_PER_SIDE_INR,
  brokerageRoundTrip: FNO_COST_PARAMS.BROKERAGE_PER_SIDE_INR * 2,
  sttRatePct: FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM * 100,
  exchangeTxnRatePct: FNO_COST_PARAMS.EXCHANGE_TXN_RATE * 100,
  sebiRatePct: FNO_COST_PARAMS.SEBI_RATE * 100,
  gstRatePct: FNO_COST_PARAMS.GST_RATE * 100,
  stampDutyRatePct: FNO_COST_PARAMS.STAMP_DUTY_RATE_BUY * 100,
  spreadBpsPerSide: FNO_COST_PARAMS.SPREAD_BPS_PER_SIDE,
  slippageBpsPerSide: FNO_COST_PARAMS.SLIPPAGE_BPS_PER_SIDE,
  modeledAtmPremiumPct: MODELED_ATM_PREMIUM_PCT * 100,
} as const;

export interface BacktestTradeChargesInput {
  /** Gross P&L (before charges) — required. */
  pnl: number;
  /** Number of lots traded. */
  lots: number;
  /** Lot size per index (NSE constant). */
  lotSize: number;
  /**
   * Real captured entry premium (Mode A). When null/undefined the adapter
   * falls back to the modeled-ATM-premium path (requires entrySpot).
   */
  optionEntry?: number | null;
  /**
   * Real captured exit premium (Mode A). Null means the trade is still open
   * or no exit was captured — charges are still partially computable.
   */
  optionExit?: number | null;
  /**
   * Entry spot price (Modes B/C — used to model the ATM premium when no
   * real option entry is available).
   */
  entrySpot?: number | null;
}

const ZERO_RESULT = (pnl: number, premiumModeled: boolean): BacktestTradeCostResult => ({
  computable: false,
  premiumModeled,
  grossPnl: pnl,
  brokerage: 0,
  stt: 0,
  exchangeCharges: 0,
  sebiCharges: 0,
  stampDuty: 0,
  gst: 0,
  slippageCost: 0,
  totalCharges: 0,
  netPnl: pnl,
});

/**
 * Compute realistic round-trip charges for one backtest trade.
 *
 * Routing:
 *   1. If `optionEntry` is a finite positive number → Mode A path (real premiums).
 *   2. Else if `entrySpot` is finite and positive → Modes B/C path (modeled premium).
 *   3. Else → returns non-computable (no useful input available).
 *
 * The returned `netPnl` is `grossPnl − totalCharges`.
 * Never throws; returns a zeroed non-computable result on degenerate inputs.
 */
export function computeBacktestTradeCost(
  input: BacktestTradeChargesInput,
): BacktestTradeCostResult {
  const { pnl, lots, lotSize } = input;
  const qty = lots * lotSize;

  let entryPremium: number;
  let exitPremium: number | null;
  let premiumModeled: boolean;

  const realEntry = input.optionEntry;

  if (realEntry != null && Number.isFinite(realEntry) && realEntry > 0) {
    // ── Mode A: real captured premiums ──────────────────────────────────────
    entryPremium = realEntry;
    const re = input.optionExit;
    exitPremium = re != null && Number.isFinite(re) && re >= 0 ? re : null;
    premiumModeled = false;
  } else if (
    input.entrySpot != null &&
    Number.isFinite(input.entrySpot) &&
    input.entrySpot > 0
  ) {
    // ── Modes B/C: model ATM premium from entry spot ─────────────────────────
    // ATM premium ≈ MODELED_ATM_PREMIUM_PCT × spot (0.7% is a conservative
    // estimate for liquid NIFTY/BANKNIFTY ATM options).
    entryPremium = input.entrySpot * MODELED_ATM_PREMIUM_PCT;
    // Exit premium is derived from the delta-proxy P&L:
    //   pnl = Δ × sign × spotMove × qty  →  pnl/qty = per-unit option P&L
    //   exitPremiumModeled = max(0, entryPremium + pnl/qty)
    const pnlPerUnit = qty > 0 ? pnl / qty : 0;
    exitPremium = Math.max(0, entryPremium + pnlPerUnit);
    premiumModeled = true;
  } else {
    return ZERO_RESULT(pnl, false);
  }

  const breakdown = computeFnoTradeCost({ entryPremium, exitPremium, lots, lotSize });

  if (!breakdown.computable) {
    return ZERO_RESULT(pnl, premiumModeled);
  }

  // Spread and slippage are combined into one "slippageCost" field for the UI.
  const slippageCost = breakdown.spreadCost + breakdown.slippageCost;
  const totalCharges = breakdown.totalCost;
  const netPnl = pnl - totalCharges;

  return {
    computable: true,
    premiumModeled,
    grossPnl: pnl,
    brokerage: breakdown.brokerage,
    stt: breakdown.stt,
    exchangeCharges: breakdown.exchangeTxn,
    sebiCharges: breakdown.sebi,
    stampDuty: breakdown.stampDuty,
    gst: breakdown.gst,
    slippageCost,
    totalCharges,
    netPnl,
  };
}
