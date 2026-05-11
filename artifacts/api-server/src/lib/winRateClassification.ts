/**
 * Pure helper for the win-rate / expectancy classification policy
 * (2026-05-11.c, reviewer-amended).
 *
 * Extracted from the SQL filter in `loadSetupWinRates` so the same
 * rule can be unit-tested without spinning up a DB. The SQL filter and
 * `classifyTradeOutcome()` are kept in lock-step by the parity test
 * in `winRateClassification.test.ts` (`SQL_PREDICATE_MIRROR`).
 *
 * Four buckets — chosen so a future expectancy/calibration view can
 * compute win-rate AND expectancy from the same source of truth:
 *
 *   WIN    : filled system-trade, realized_pnl > 0
 *   LOSS   : filled system-trade, realized_pnl < 0
 *   SCRATCH: filled system-trade, realized_pnl == 0  (break-even / EOD sweep)
 *   EXCLUDE: not a filled autonomous-system trade   (e.g. MANUAL_OVERRIDE, unknown)
 *
 * Win-rate denominator = WIN + LOSS only (scratches do NOT depress it).
 * Expectancy denominator = WIN + LOSS + SCRATCH (every filled system fill).
 *
 * MANUAL_OVERRIDE is *operator-influenced* P&L, not autonomous-system
 * P&L; it's excluded from setup calibration but still appears in the
 * account ledger.
 *
 * paper_trade_fo only contains FILLED trades by construction (insert
 * is inside the open-txn after account debit), so there's no separate
 * fill-state filter — every row is a fill.
 */
export type ExitReason =
  | "TARGET1_HIT"
  | "TARGET2_HIT"
  | "STOPPED"
  | "EXPIRED"
  | "MANUAL_OVERRIDE";

export type TradeOutcome = "WIN" | "LOSS" | "SCRATCH" | "EXCLUDE";

/** System-exit reasons that represent autonomous setup performance. */
const SYSTEM_EXIT_REASONS: ReadonlySet<string> = new Set([
  "TARGET1_HIT",
  "TARGET2_HIT",
  "STOPPED",
  "EXPIRED",
]);

export function classifyTradeOutcome(
  exitReason: ExitReason | string | null | undefined,
  realizedPnl: number,
): TradeOutcome {
  if (!exitReason) return "EXCLUDE";
  if (!SYSTEM_EXIT_REASONS.has(exitReason)) return "EXCLUDE";
  if (realizedPnl > 0) return "WIN";
  if (realizedPnl < 0) return "LOSS";
  return "SCRATCH";
}

/** Back-compat boolean: WIN or LOSS only (the win-rate denominator). */
export function isCountedForWinRate(
  exitReason: ExitReason | string | null | undefined,
  realizedPnl: number,
): boolean {
  const c = classifyTradeOutcome(exitReason, realizedPnl);
  return c === "WIN" || c === "LOSS";
}

/** Wider bucket: any filled system-trade (used for expectancy). */
export function isFilledSystemTrade(
  exitReason: ExitReason | string | null | undefined,
  realizedPnl: number,
): boolean {
  const c = classifyTradeOutcome(exitReason, realizedPnl);
  return c === "WIN" || c === "LOSS" || c === "SCRATCH";
}
