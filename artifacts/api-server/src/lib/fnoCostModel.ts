/**
 * P17b — Shadow F&O Cost / Slippage / Spread Model.
 *
 * SHADOW / REPORTING ONLY. This module is **pure** and is never imported
 * by any signal-generation, gate, sizing, entry, exit, stop, target,
 * scheduler, paper-trade execution, Kite, swing, equity, scanner,
 * strategy, combo, snapshot, or candle path. It computes an estimate
 * of the realistic costs that a live broker would have applied to a
 * paper trade and exposes both the gross and shadow-net P&L so the
 * operator can see whether weak setups would actually have been
 * profitable after costs.
 *
 * Cost assumptions (Indian retail F&O options, Zerodha-style, NSE):
 *   - Brokerage: flat ₹20 per executed order side
 *     (we assume one order per side → ₹40 per round trip).
 *   - STT: 0.15% on the SELL-side premium turnover for options
 *     (statutory rate effective 2026-04-01 per Budget 2026 — see
 *     `FNO_COST_PARAMS_ASOF`; raised from the prior 0.10% Oct-2024 era
 *     and the 0.0625% pre-Oct-2024 era). Index option paper trades close
 *     on premium, so the exercise-day ITM rate (0.15% on intrinsic, see
 *     `STT_RATE_EXERCISE_INTRINSIC`) is published as a constant but not
 *     applied. Futures are not traded by this paper book; the futures
 *     sell-side rate (0.05%, see `STT_RATE_SELL_FUTURES`) is published
 *     for completeness only.
 *   - Exchange transaction charges (NSE option turnover): 0.03503%
 *     on premium turnover, applied to BOTH sides.
 *   - SEBI charges: ₹10 per crore = 0.0001% on total premium turnover.
 *   - GST: 18% on (brokerage + transaction + SEBI).
 *   - Stamp duty: 0.003% on the BUY-side premium turnover.
 *   - Spread cost: `SPREAD_BPS` of premium per side (paper-trade entry
 *     uses mid; live would cross the spread on both legs).
 *   - Slippage: `SLIPPAGE_BPS` of premium per side (price moves between
 *     trigger and fill in a real order).
 *
 * These are deliberately published as named constants in
 * `FNO_COST_PARAMS` so a future operator approval can dial them
 * independently of the formula. All numbers are estimates — a real
 * fill could be cheaper (deep liquidity) or much more expensive
 * (illiquid strike, opening/closing volatility), and the model does
 * not attempt to model auction matching or partial fills.
 *
 * Public API:
 *   - `FNO_COST_PARAMS` — the named constants block.
 *   - `computeFnoTradeCost(input)` — pure per-trade calculator that
 *     never throws and returns a fully-shaped breakdown even for
 *     degenerate inputs (NaN / zero qty / missing exit premium).
 *   - `isShadowCostsEnabled()` — reads `PAPER_FO_COSTS_SHADOW_ENABLED`.
 *     The flag only gates whether the reporting endpoint surfaces
 *     values; it never affects realised P&L or any trading decision.
 *
 * Test coverage in `fnoCostModel.test.ts`.
 */

/**
 * As-of date for the statutory STT rates encoded below. Kept OUTSIDE
 * `FNO_COST_PARAMS` because that block is asserted to be numeric-only.
 */
export const FNO_COST_PARAMS_ASOF = "2026-04-01" as const;

/* ─────────────────── Cost parameters (single source of truth) ────────── */
export const FNO_COST_PARAMS = {
  /** Flat brokerage charged per executed order side. */
  BROKERAGE_PER_SIDE_INR: 20,

  /** STT rate on SELL-side premium turnover for options (0.15%, eff 2026-04-01). */
  STT_RATE_SELL_PREMIUM: 0.0015,

  /** STT rate on SELL-side futures turnover (0.05%, eff 2026-04-01). Published for completeness — futures are not traded by this paper book. */
  STT_RATE_SELL_FUTURES: 0.0005,

  /** STT rate on intrinsic value of ITM options exercised at expiry (0.15%, eff 2026-04-01). Published only — paper trades close on premium, not exercise. */
  STT_RATE_EXERCISE_INTRINSIC: 0.0015,

  /** NSE exchange transaction-charge rate on premium turnover. */
  EXCHANGE_TXN_RATE: 0.0003503,

  /** SEBI charges (₹10 per crore = 0.0001%) on total premium turnover. */
  SEBI_RATE: 0.000001,

  /** GST levied on (brokerage + exchange + SEBI). */
  GST_RATE: 0.18,

  /** Stamp duty on BUY-side premium turnover. */
  STAMP_DUTY_RATE_BUY: 0.00003,

  /** Bid/ask spread cost as a fraction of premium per side. 25 bps. */
  SPREAD_BPS_PER_SIDE: 25,

  /** Slippage estimate as a fraction of premium per side. 10 bps. */
  SLIPPAGE_BPS_PER_SIDE: 10,
} as const;

/* ─────────────────── Types ────────────────────────────────────────────── */
export interface FnoTradeCostInput {
  /** Per-contract entry premium (₹). */
  entryPremium: number;
  /** Per-contract exit premium (₹). May be null/0 if trade is still OPEN. */
  exitPremium: number | null;
  /** Lots traded (e.g. 10). */
  lots: number;
  /** Lot size (e.g. 25 for NIFTY). */
  lotSize: number;
}

export interface FnoTradeCostBreakdown {
  /** True if the input was usable and a real cost number was produced. */
  computable: boolean;
  /** Quantity in contracts = lots × lotSize (0 if invalid). */
  quantity: number;
  /** Premium × quantity, buy side (₹). */
  buyTurnover: number;
  /** Premium × quantity, sell side (₹). 0 when exit is missing. */
  sellTurnover: number;
  /** Sum of the two — used by SEBI / exchange charges. */
  totalTurnover: number;
  /** Component breakdown. All ≥ 0. */
  brokerage: number;
  stt: number;
  exchangeTxn: number;
  sebi: number;
  gst: number;
  stampDuty: number;
  spreadCost: number;
  slippageCost: number;
  /** Total estimated round-trip cost (₹). */
  totalCost: number;
  /** Gross P&L = (exit - entry) × qty. Null when exit is missing. */
  grossPnl: number | null;
  /** Shadow net P&L = grossPnl - totalCost. Null when grossPnl is null. */
  netPnl: number | null;
  /** Cost as a fraction of buy turnover (0..1). Null when turnover = 0. */
  costPctOfPremium: number | null;
}

/* ─────────────────── Helpers ──────────────────────────────────────────── */
function finiteOrZero(n: number | null | undefined): number {
  if (n == null) return 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* ─────────────────── Per-trade calculator ─────────────────────────────── */
export function computeFnoTradeCost(input: FnoTradeCostInput): FnoTradeCostBreakdown {
  const entry = finiteOrZero(input.entryPremium);
  const exitRaw = input.exitPremium;
  // Distinguish "trade still open" (null/undefined/NaN/negative) from
  // "trade closed at zero" (option expired worthless). The former
  // leaves the sell side absent — only 1 brokerage side, no STT, no
  // gross/net P&L. The latter is a fully known round trip with
  // sellTurnover=0 — 2 brokerage sides, STT=0, gross/net computed.
  const exitKnown =
    exitRaw != null && Number.isFinite(exitRaw) && (exitRaw as number) >= 0;
  const exit = exitKnown ? (exitRaw as number) : 0;
  const lots = Math.max(0, Math.floor(finiteOrZero(input.lots)));
  const lotSize = Math.max(0, Math.floor(finiteOrZero(input.lotSize)));
  const quantity = lots * lotSize;

  // Degenerate input — return a zeroed, non-computable breakdown so callers
  // can render "—" without special-casing missing premium/quantity.
  if (entry <= 0 || quantity <= 0) {
    return {
      computable: false,
      quantity,
      buyTurnover: 0,
      sellTurnover: 0,
      totalTurnover: 0,
      brokerage: 0,
      stt: 0,
      exchangeTxn: 0,
      sebi: 0,
      gst: 0,
      stampDuty: 0,
      spreadCost: 0,
      slippageCost: 0,
      totalCost: 0,
      grossPnl: null,
      netPnl: null,
      costPctOfPremium: null,
    };
  }

  const buyTurnover = entry * quantity;
  const sellTurnover = exitKnown ? exit * quantity : 0;
  const totalTurnover = buyTurnover + sellTurnover;

  // (1) Brokerage — 1 order per side. If exit is unknown we still
  // charge the entry order; the close charge will be added later.
  const brokerage = FNO_COST_PARAMS.BROKERAGE_PER_SIDE_INR * (exitKnown ? 2 : 1);

  // (2) STT — sell-side premium only.
  const stt = sellTurnover * FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM;

  // (3) Exchange transaction — both sides' premium turnover.
  const exchangeTxn = totalTurnover * FNO_COST_PARAMS.EXCHANGE_TXN_RATE;

  // (4) SEBI — total turnover.
  const sebi = totalTurnover * FNO_COST_PARAMS.SEBI_RATE;

  // (5) GST — 18% on (brokerage + exchange + SEBI).
  const gst = (brokerage + exchangeTxn + sebi) * FNO_COST_PARAMS.GST_RATE;

  // (6) Stamp duty — buy-side only.
  const stampDuty = buyTurnover * FNO_COST_PARAMS.STAMP_DUTY_RATE_BUY;

  // (7) Spread + (8) Slippage — bps of premium per side.
  const spreadRate = FNO_COST_PARAMS.SPREAD_BPS_PER_SIDE / 10_000;
  const slippageRate = FNO_COST_PARAMS.SLIPPAGE_BPS_PER_SIDE / 10_000;
  const spreadCost = totalTurnover * spreadRate;
  const slippageCost = totalTurnover * slippageRate;

  const totalCost =
    brokerage + stt + exchangeTxn + sebi + gst + stampDuty + spreadCost + slippageCost;

  const grossPnl = exitKnown ? (exit - entry) * quantity : null;
  const netPnl = grossPnl == null ? null : grossPnl - totalCost;
  const costPctOfPremium = buyTurnover > 0 ? totalCost / buyTurnover : null;

  return {
    computable: true,
    quantity,
    buyTurnover,
    sellTurnover,
    totalTurnover,
    brokerage,
    stt,
    exchangeTxn,
    sebi,
    gst,
    stampDuty,
    spreadCost,
    slippageCost,
    totalCost,
    grossPnl,
    netPnl,
    costPctOfPremium,
  };
}

/* ─────────────────── Feature flag ─────────────────────────────────────── */
/**
 * `PAPER_FO_COSTS_SHADOW_ENABLED` env override.
 *
 * Accepted truthy values: `1`, `true`, `yes`, `on` (case-insensitive).
 * Anything else (including unset) → enabled by default — the flag only
 * gates whether the shadow report SURFACES values; it cannot change any
 * trading behaviour, so defaulting ON is safe and matches the P17b spec
 * goal of making reporting realistic without changing decisions.
 */
export function isShadowCostsEnabled(): boolean {
  const v = process.env.PAPER_FO_COSTS_SHADOW_ENABLED;
  if (v == null) return true;
  const norm = v.trim().toLowerCase();
  if (norm === "" ) return true;
  if (["0", "false", "no", "off"].includes(norm)) return false;
  return true;
}
