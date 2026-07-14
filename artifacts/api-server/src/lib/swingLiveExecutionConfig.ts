/**
 * Swing CASH Live-Readiness — Phase 2 execution-mode config + the HARD broker
 * kill flag.
 *
 * Two independent switches:
 *
 *   1. Execution MODE (`SWING_CASH_EXECUTION_MODE`): which workflow the staging
 *      lane runs in. Default `paper_only`. Validated against the known modes;
 *      anything unrecognised fails CLOSED to `paper_only`.
 *
 *   2. The HARD broker flag (`LIVE_CASH_SWING_ORDER_ENABLED`): the single gate
 *      that would ever permit a *real* broker order. It defaults to **false**
 *      and — unlike the paper-trading auto flag — it NEVER auto-enables in a
 *      deployment. Only an explicit truthy env value enables it. In this phase
 *      no real-order code exists at all, so even `true` only unlocks the
 *      (still synthetic) dry-run adapter.
 *
 * ABSOLUTE RULE: when the hard flag is false, no staged order may carry a real
 * broker order id and every broker field stays null / `BROKER_DISABLED`.
 */

import type { SwingCashMode } from "./swingCashTypes";

const KNOWN_MODES: readonly SwingCashMode[] = [
  "paper_only",
  "live_dry_run",
  "live_staged_approval",
  "live_auto_small_size",
];

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * The active swing-cash execution mode. Default `paper_only`. Unknown values
 * fail closed to `paper_only` (never silently to a live mode).
 *
 * Phase-2 policy: `live_auto_small_size` is NOT permitted yet — if someone sets
 * it we clamp DOWN to `live_staged_approval` (approval still required, broker
 * still disabled) rather than honour blind automation.
 */
export function getSwingExecutionMode(): SwingCashMode {
  const raw = process.env.SWING_CASH_EXECUTION_MODE;
  if (raw == null || raw.trim().length === 0) return "paper_only";
  const v = raw.trim().toLowerCase() as SwingCashMode;
  if (!KNOWN_MODES.includes(v)) return "paper_only";
  if (v === "live_auto_small_size") return "live_staged_approval";
  return v;
}

/**
 * The HARD broker flag. True ONLY when `LIVE_CASH_SWING_ORDER_ENABLED` is an
 * explicit truthy value. Defaults false; never auto-enables in deployment.
 */
export function isLiveCashSwingOrderEnabled(): boolean {
  const raw = process.env.LIVE_CASH_SWING_ORDER_ENABLED;
  if (raw == null) return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Notional swing-cash BOOK used purely for position sizing + exposure math in
 * the staging lane. This is NOT a real broker balance and NO real money moves —
 * broker execution is hard-disabled. Overridable via `SWING_CASH_BOOK_CAPITAL`
 * (a positive number); defaults to ₹10,00,000. Used only to derive quantity /
 * risk-percent / exposure caps for staged (paper-only) orders.
 */
export function getSwingCashBookCapital(): number {
  const raw = process.env.SWING_CASH_BOOK_CAPITAL;
  if (raw != null) {
    const n = Number(raw.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1_000_000;
}

/**
 * Whether a *real* broker order could ever be placed. In this phase always
 * false: it requires BOTH the hard flag AND a live mode, and even then the
 * adapter is dry-run only (no real-order code exists). Kept as the single
 * choke point any future real-order path must consult.
 */
export function isBrokerExecutionEnabled(): boolean {
  const mode = getSwingExecutionMode();
  const live = mode === "live_dry_run" || mode === "live_staged_approval";
  return isLiveCashSwingOrderEnabled() && live;
}

export interface SwingExecutionStatus {
  mode: SwingCashMode;
  /** The hard `LIVE_CASH_SWING_ORDER_ENABLED` flag. */
  liveCashSwingOrderEnabled: boolean;
  /** Whether a real broker order could ever be placed (always false here). */
  brokerExecutionEnabled: boolean;
  /** Constant human label for UI banners. */
  brokerStatus: "DISABLED";
  /** Honest one-line summary safe for logs/UI (no secrets). */
  summary: string;
}

/** Diagnostics/banner payload. Never leaks secrets. */
export function getSwingExecutionStatus(): SwingExecutionStatus {
  const mode = getSwingExecutionMode();
  const liveCashSwingOrderEnabled = isLiveCashSwingOrderEnabled();
  const brokerExecutionEnabled = isBrokerExecutionEnabled();
  return {
    mode,
    liveCashSwingOrderEnabled,
    brokerExecutionEnabled,
    brokerStatus: "DISABLED",
    summary: brokerExecutionEnabled
      ? `mode=${mode}; broker execution flag set (still dry-run only — no real-order code exists)`
      : `mode=${mode}; broker execution DISABLED — staging/approval only, no real order is ever placed`,
  };
}
