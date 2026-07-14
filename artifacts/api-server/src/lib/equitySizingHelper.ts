/**
 * Equity sizing helper / preview (Priority 5 — visibility infra only).
 *
 * Pure-function "what would happen if we tried to open this equity
 * paper trade right now?" — mirrors EXACTLY the gate sequence and
 * formulas in `paperTradingEq.openPaperEquityTrade`. Zero side
 * effects: no DB writes, no audit rows, no `paper_account` mutation,
 * no signal-pipeline contact. Pure function over an `EquitySizingInput`.
 *
 * The point: today the only way to see WHY an equity STRONG_BUY was
 * sized to 17 shares (or rejected) is to inspect `paper_eq_audit` AFTER
 * the live `openPaperEquityTrade` runs. This helper lets us preview
 * the same decision deterministically — useful for:
 *   - debugging "why 0 shares" complaints,
 *   - validating that a planned dial change (slots, heat cap) would
 *     produce the expected sizing on yesterday's candidates,
 *   - building a per-candidate "if you opened this, you'd get N shares
 *     and Y% heat" report on the stocks-to-watch screen — without ever
 *     placing a paper order.
 *
 * Formula (mirrors `openPaperEquityTrade`):
 *
 *   accountValue = balance + Σ(capital_deployed for OPEN positions)
 *   slots        = max(EQUITY_RISK.BASE_SLOTS, openCount + 1)
 *   perPosition  = accountValue / slots
 *   deploy       = min(perPosition, balance)
 *   qty          = floor(deploy / entry)
 *   capDeployed  = qty * entry
 *   perShareRisk = max(entry - stop, 0)         // long-only
 *   newHeat      = qty * perShareRisk
 *   heatCap      = SEED_CAPITAL.EQUITY * PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT
 *
 * Gate order (early-return on first failure, same as live path):
 *   1.  INVALID_STOP    — entry/stop not finite or stop >= entry
 *   2.  STOP_SANITY     — (entry - stop)/entry < 1% or > 8%
 *   3.  DD_DAILY        — equity daily DD cap latched (sticky 2%)
 *   4.  DD_WEEKLY       — equity weekly DD cap latched (sticky 4%)
 *   5.  DD_MONTHLY      — equity monthly DD cap latched (sticky 8%)
 *   6.  DAILY_CAP       — dayTradeCount >= MAX_NEW_PER_DAY (3)
 *   7.  CONCURRENT_CAP  — openCount    >= MAX_CONCURRENT (10)
 *   8.  DEPLOY_LE_0     — deploy <= 0 (balance depleted)
 *   9.  QTY_LT_1        — qty < 1 (per-slot allocation < entry price)
 *   10. INSUFF_BAL      — qty * entry > balance after rounding
 *   11. HEAT_CAP        — currentHeat + newHeat > heatCap
 *
 * The caller is responsible for calling `ensureDailyReset("EQUITY")`
 * BEFORE reading the snapshot fields (balance / openCount / dayTradeCount)
 * — exactly as the live `openPaperEquityTrade` path does at line 210.
 * The route does this; the helper assumes its inputs are post-reset.
 *
 * The reason strings are stable ENUM-like strings so a UI can switch
 * on them. `verdict` is "ACCEPT" only when no gate fired.
 */

import {
  EQUITY_DD_CAPS,
  EQUITY_RISK,
  EQUITY_STOP_SANITY,
  PORTFOLIO_HEAT,
  SEED_CAPITAL,
} from "./paperAccount";

export type SizingVerdict = "ACCEPT" | "REJECT";

export type SizingRejectReason =
  | "INVALID_STOP"
  | "STOP_SANITY_TIGHT"
  | "STOP_SANITY_WIDE"
  | "DD_DAILY"
  | "DD_WEEKLY"
  | "DD_MONTHLY"
  | "DAILY_CAP"
  | "CONCURRENT_CAP"
  | "DEPLOY_LE_0"
  | "QTY_LT_1"
  | "INSUFF_BAL"
  | "HEAT_CAP";

export interface EquitySizingInput {
  /** Display tag (only echoed back; no lookups). */
  symbol: string;
  /** Planned entry price (₹). */
  entry: number;
  /** Planned stop-loss price (₹). Must be < entry for long. */
  stop: number;
  /** Cash balance currently in the EQUITY paper account (₹). */
  balance: number;
  /** Sum of capital_deployed across all currently OPEN equity positions (₹). */
  bookValue: number;
  /** Count of currently OPEN equity positions. */
  openCount: number;
  /** Count of new equity entries already opened in the current IST day. */
  dayTradeCount: number;
  /** Current portfolio heat (₹) = Σ(qty × max(entry-stop, 0)) over OPEN positions. */
  currentHeat: number;
  /** Daily DD cap reached (sticky). When true, helper rejects with `DD_DAILY`. */
  ddDailyCapReached?: boolean;
  /** Weekly DD cap reached (sticky). When true, helper rejects with `DD_WEEKLY`. */
  ddWeeklyCapReached?: boolean;
  /** Monthly DD cap reached (sticky). When true, helper rejects with `DD_MONTHLY`. */
  ddMonthlyCapReached?: boolean;
  /** Echo of realised drawdown % (display only — does not affect verdict). */
  ddDailyPct?: number;
  ddWeeklyPct?: number;
  ddMonthlyPct?: number;
}

export interface EquitySizingResult {
  verdict: SizingVerdict;
  /** Specific reason when verdict === "REJECT"; null on ACCEPT. */
  reason: SizingRejectReason | null;
  /** Human-readable explanation (matches the live path's audit detail style). */
  detail: string;

  /* Computed sizing — populated regardless of verdict so the UI can
   * show "would have been N shares" even on rejection. */
  qty: number;
  capitalRequired: number;
  perShareRisk: number;
  totalRisk: number;
  riskPct: number; // newHeat / SEED_CAPITAL.EQUITY (fraction, e.g. 0.012)

  /* Working numbers — useful for debugging / UI tooltips. */
  accountValue: number;
  slots: number;
  perPosition: number;
  deploy: number;
  newHeat: number;
  projectedHeat: number;
  heatCap: number;

  /* Echo of the input limits actually used (so callers can verify
   * they're seeing the live constants, not a stale snapshot). */
  limits: {
    seedCapital: number;
    baseSlots: number;
    maxConcurrent: number;
    maxNewPerDay: number;
    minStopPct: number;
    maxStopPct: number;
    maxEqHeatPct: number;
  };
}

const LIMITS = {
  seedCapital: SEED_CAPITAL.EQUITY,
  baseSlots: EQUITY_RISK.BASE_SLOTS,
  maxConcurrent: EQUITY_RISK.MAX_CONCURRENT,
  maxNewPerDay: EQUITY_RISK.MAX_NEW_PER_DAY,
  minStopPct: EQUITY_STOP_SANITY.MIN_STOP_PCT,
  maxStopPct: EQUITY_STOP_SANITY.MAX_STOP_PCT,
  maxEqHeatPct: PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT,
} as const;

function buildResult(
  partial: Pick<EquitySizingResult, "verdict" | "reason" | "detail"> &
    Partial<Omit<EquitySizingResult, "verdict" | "reason" | "detail" | "limits">>,
): EquitySizingResult {
  return {
    verdict: partial.verdict,
    reason: partial.reason,
    detail: partial.detail,
    qty: partial.qty ?? 0,
    capitalRequired: partial.capitalRequired ?? 0,
    perShareRisk: partial.perShareRisk ?? 0,
    totalRisk: partial.totalRisk ?? 0,
    riskPct: partial.riskPct ?? 0,
    accountValue: partial.accountValue ?? 0,
    slots: partial.slots ?? LIMITS.baseSlots,
    perPosition: partial.perPosition ?? 0,
    deploy: partial.deploy ?? 0,
    newHeat: partial.newHeat ?? 0,
    projectedHeat: partial.projectedHeat ?? 0,
    heatCap: LIMITS.seedCapital * LIMITS.maxEqHeatPct,
    limits: LIMITS,
  };
}

export function computeEquitySizingPreview(input: EquitySizingInput): EquitySizingResult {
  const { symbol, entry, stop, balance, bookValue, openCount, dayTradeCount, currentHeat } = input;

  // Gate 1 — stop validity (mirrors implicit assertions in the live path).
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry <= 0 || stop <= 0 || stop >= entry) {
    return buildResult({
      verdict: "REJECT",
      reason: "INVALID_STOP",
      detail: `Invalid entry/stop for ${symbol}: entry=${entry}, stop=${stop} (require finite positives with stop < entry)`,
    });
  }

  // Gate 2 — stop-sanity bounds (1%–8%).
  const stopPct = (entry - stop) / entry;
  if (stopPct < LIMITS.minStopPct) {
    return buildResult({
      verdict: "REJECT",
      reason: "STOP_SANITY_TIGHT",
      detail: `Stop too tight: ${(stopPct * 100).toFixed(2)}% < ${(LIMITS.minStopPct * 100).toFixed(2)}% min (entry ${entry}, stop ${stop})`,
      perShareRisk: entry - stop,
    });
  }
  if (stopPct > LIMITS.maxStopPct) {
    return buildResult({
      verdict: "REJECT",
      reason: "STOP_SANITY_WIDE",
      detail: `Stop too wide: ${(stopPct * 100).toFixed(2)}% > ${(LIMITS.maxStopPct * 100).toFixed(2)}% max (entry ${entry}, stop ${stop})`,
      perShareRisk: entry - stop,
    });
  }

  // Gates 3-5 — sticky equity drawdown caps (daily / weekly / monthly).
  // Mirrors paperTradingEq lines 163-208. Each is a sticky-once-hit
  // latch maintained inside `paperAccount.getEqXxxRealizedDrawdown()`;
  // the route reads them and passes the boolean through.
  if (input.ddDailyCapReached) {
    return buildResult({
      verdict: "REJECT",
      reason: "DD_DAILY",
      detail: `Daily DD cap reached (sticky): ${(((input.ddDailyPct ?? 0) * 100).toFixed(2))}% > ${(EQUITY_DD_CAPS.MAX_DAILY_LOSS_PCT * 100).toFixed(2)}%`,
      perShareRisk: entry - stop,
    });
  }
  if (input.ddWeeklyCapReached) {
    return buildResult({
      verdict: "REJECT",
      reason: "DD_WEEKLY",
      detail: `Weekly DD cap reached (sticky): ${(((input.ddWeeklyPct ?? 0) * 100).toFixed(2))}% > ${(EQUITY_DD_CAPS.MAX_WEEKLY_LOSS_PCT * 100).toFixed(2)}%`,
      perShareRisk: entry - stop,
    });
  }
  if (input.ddMonthlyCapReached) {
    return buildResult({
      verdict: "REJECT",
      reason: "DD_MONTHLY",
      detail: `Monthly DD cap reached (sticky): ${(((input.ddMonthlyPct ?? 0) * 100).toFixed(2))}% > ${(EQUITY_DD_CAPS.MAX_MONTHLY_LOSS_PCT * 100).toFixed(2)}%`,
      perShareRisk: entry - stop,
    });
  }

  // Gate 6 — daily new-entry cap.
  if (dayTradeCount >= LIMITS.maxNewPerDay) {
    return buildResult({
      verdict: "REJECT",
      reason: "DAILY_CAP",
      detail: `Daily new-entry cap reached: ${dayTradeCount} ≥ ${LIMITS.maxNewPerDay}`,
      perShareRisk: entry - stop,
    });
  }

  // Gate 7 — concurrent-open cap.
  if (openCount >= LIMITS.maxConcurrent) {
    return buildResult({
      verdict: "REJECT",
      reason: "CONCURRENT_CAP",
      detail: `Concurrent-open cap reached: ${openCount} ≥ ${LIMITS.maxConcurrent}`,
      perShareRisk: entry - stop,
    });
  }

  // Sizing math — same as the live path.
  const accountValue = balance + bookValue;
  const slots = Math.max(LIMITS.baseSlots, openCount + 1);
  const perPosition = accountValue / slots;
  const deploy = Math.min(perPosition, balance);

  if (!(deploy > 0)) {
    return buildResult({
      verdict: "REJECT",
      reason: "DEPLOY_LE_0",
      detail: `No deployable capital — balance ₹${balance.toFixed(2)}, accountValue ₹${accountValue.toFixed(2)}`,
      perShareRisk: entry - stop,
      accountValue, slots, perPosition, deploy,
    });
  }

  const qty = Math.floor(deploy / entry);
  const capitalRequired = qty * entry;
  const perShareRisk = entry - stop;
  const newHeat = qty * perShareRisk;
  const projectedHeat = currentHeat + newHeat;
  const heatCap = LIMITS.seedCapital * LIMITS.maxEqHeatPct;

  if (qty < 1) {
    const accountDepleted = accountValue < entry;
    return buildResult({
      verdict: "REJECT",
      reason: "QTY_LT_1",
      detail: accountDepleted
        ? `Account depleted: deploy ₹${deploy.toFixed(2)} < entry ₹${entry.toFixed(2)} (balance ₹${balance.toFixed(2)})`
        : `Per-slot allocation < 1 share: deploy ₹${deploy.toFixed(2)} / entry ₹${entry.toFixed(2)} (slots ${slots})`,
      perShareRisk,
      accountValue, slots, perPosition, deploy,
    });
  }

  if (capitalRequired > balance) {
    return buildResult({
      verdict: "REJECT",
      reason: "INSUFF_BAL",
      detail: `Insufficient balance after rounding: needed ₹${capitalRequired.toFixed(2)}, have ₹${balance.toFixed(2)}`,
      qty, capitalRequired, perShareRisk,
      accountValue, slots, perPosition, deploy,
      newHeat, projectedHeat,
      totalRisk: newHeat,
      riskPct: newHeat / LIMITS.seedCapital,
    });
  }

  if (projectedHeat > heatCap) {
    return buildResult({
      verdict: "REJECT",
      reason: "HEAT_CAP",
      detail: `Heat cap would be breached: ${(projectedHeat / LIMITS.seedCapital * 100).toFixed(2)}% > ${(LIMITS.maxEqHeatPct * 100).toFixed(2)}% (currentHeat ₹${currentHeat.toFixed(2)} + newHeat ₹${newHeat.toFixed(2)} > cap ₹${heatCap.toFixed(2)})`,
      qty, capitalRequired, perShareRisk,
      accountValue, slots, perPosition, deploy,
      newHeat, projectedHeat,
      totalRisk: newHeat,
      riskPct: newHeat / LIMITS.seedCapital,
    });
  }

  return buildResult({
    verdict: "ACCEPT",
    reason: null,
    detail: `Would open ${qty} shares of ${symbol} @ ₹${entry.toFixed(2)} (capital ₹${capitalRequired.toFixed(2)}, risk ₹${newHeat.toFixed(2)} = ${(newHeat / LIMITS.seedCapital * 100).toFixed(3)}% of seed)`,
    qty, capitalRequired, perShareRisk,
    accountValue, slots, perPosition, deploy,
    newHeat, projectedHeat,
    totalRisk: newHeat,
    riskPct: newHeat / LIMITS.seedCapital,
  });
}
