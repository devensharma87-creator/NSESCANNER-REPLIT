/**
 * Pure helper for the win-rate denominator policy (2026-05-11.b).
 *
 * Extracted from the SQL filter in `loadSetupWinRates` so the same
 * classification rule can be unit-tested without spinning up a DB.
 *
 * Source of truth for the SQL is `optionSignalGates.ts`; this helper
 * mirrors that filter exactly. Tests assert they stay in lock-step.
 *
 * Rule: a closed paper_trade_fo row counts toward the win-rate
 * denominator iff it represents a "decided" outcome:
 *
 *   TARGET1_HIT / TARGET2_HIT / STOPPED / MANUAL_OVERRIDE
 *     → ALWAYS count (a real exit signal fired or owner closed manually)
 *   EXPIRED
 *     → counts ONLY if realized_pnl != 0
 *       (a flat EXPIRED is an end-of-day sweep rescue, not an outcome)
 *   anything else → does NOT count
 *
 * Note: paper_trade_fo only contains FILLED trades (insert is inside
 * the open-txn after the account debit), so we don't need a separate
 * fill-state filter — every row is a fill.
 */
export type ExitReason =
  | "TARGET1_HIT"
  | "TARGET2_HIT"
  | "STOPPED"
  | "EXPIRED"
  | "MANUAL_OVERRIDE";

export function isCountedForWinRate(
  exitReason: ExitReason | string | null | undefined,
  realizedPnl: number,
): boolean {
  if (!exitReason) return false;
  switch (exitReason) {
    case "TARGET1_HIT":
    case "TARGET2_HIT":
    case "STOPPED":
    case "MANUAL_OVERRIDE":
      return true;
    case "EXPIRED":
      return realizedPnl !== 0;
    default:
      return false;
  }
}
