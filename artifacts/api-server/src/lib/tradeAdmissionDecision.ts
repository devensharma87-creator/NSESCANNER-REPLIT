/**
 * P0-A: Shared TradeAdmissionDecision boundary.
 *
 * Every new-position writer (auto EQ, manual EQ, staged EQ, reconcile/resume
 * EQ, auto FO, manual FO, combo) must evaluate this decision BEFORE any
 * account mutation. The boundary separates WHAT was decided from HOW the
 * writer then acts.
 *
 * INVARIANT DURING PHASE 0 CONTAINMENT:
 *   The decision is always BLOCKED by the hard C0 constants.
 *   FNO_AUTO_OPEN_C0_BLOCKED = true  (paperTradingFO.ts)
 *   EQUITY_AUTO_OPEN_C0_BLOCKED = true  (paperTradingEq.ts)
 *   This module does NOT change those constants.
 *
 * This boundary is defence-in-depth for when C0 is eventually lifted after
 * explicit owner approval and all Phase 1 acceptance criteria are met (see
 * memory/PHASE1_TO_PHASE7_SEQUENCED_REMEDIATION_PLAN_2026-07-20.md).
 *
 * TIMESTAMP SEPARATION (§6.3):
 *   signalTime  = externally supplied timestamp from the signal source
 *   serverTime  = server wall-clock at evaluation time (Date.now())
 *   decisionAt  = ISO string of serverTime at the moment evaluateAdmission() runs
 *
 *   The serverTime is the authoritative timestamp for any state-changing event.
 *   signalTime must NEVER be used as the database-persisted open/fill time.
 */

export type TradeSegment = "FNO" | "EQUITY" | "COMBO";

export type AdmissionBlockReason =
  | "C0_FNO_CONTAINMENT"          // FNO_AUTO_OPEN_C0_BLOCKED is true
  | "C0_EQUITY_CONTAINMENT"       // EQUITY_AUTO_OPEN_C0_BLOCKED is true
  | "C0_COMBO_CONTAINMENT"        // Combo inherits FNO containment until explicitly lifted
  | "PAPER_AUTO_TRADING_DISABLED" // isPaperAutoTradingEnabled() returned false
  | "SESSION_CLOSED"              // Market session gate: not within executable session
  | "WEEKEND"                     // ISO weekday 6 (Sat) or 7 (Sun)
  | "OFFICIAL_HOLIDAY"            // Exchange holiday per NSE/BSE calendar
  | "AFTER_CLOSE"                 // After 15:30:00 IST (half-open — 15:30:59 is ALSO blocked)
  | "PRE_OPEN"                    // Before 09:15:00 IST
  | "CALENDAR_UNAVAILABLE"        // Calendar data missing/stale — fail closed
  | "SIGNAL_TIME_FORGED"          // signal.triggeredAt differs from serverTime by > allowed skew
  | "PROVENANCE_NOT_TRADE_GRADE"  // Source/freshness below trade-grade (Yahoo, stale, etc.)
  | "LEVELS_NOT_TRADE_GRADE"      // EQ: swing levels from Yahoo, not Kite historical
  | "CONTRACT_NOT_TRADE_GRADE"    // FO: lot size from static fallback, not live Kite master
  | "LEDGER_GATE_BLOCKED"         // checkLedgerReconciliationGate returned blocked
  | "LEDGER_GATE_ERROR"           // Ledger gate query failed — fail closed
  | "NO_FRESH_QUOTE"              // No fresh authoritative quote for fill price
  | "MISSING_INSTRUMENT_TOKEN"    // Contract has no verifiable Kite instrument token
  | "IDEMPOTENCY_DUPLICATE";      // Row already exists for this signal key

/**
 * Typed decision returned by evaluateAdmission().
 * All fields are readonly — the decision is immutable once made.
 */
export interface TradeAdmissionDecision {
  readonly allowed: boolean;
  /** Non-empty when allowed === false. May contain multiple reasons. */
  readonly blockedReasons: AdmissionBlockReason[];
  /** Human-readable summary of all blocking reasons. */
  readonly summary: string;
  /** Server wall-clock ISO timestamp at evaluation time. NOT the signal time. */
  readonly decisionAt: string;
  /** C0 containment constant was the first effective stop. */
  readonly c0Active: boolean;
  /** Segment this decision covers. */
  readonly segment: TradeSegment;
  /**
   * Signal timestamp provided by the caller (external, untrusted).
   * Stored for audit only — NEVER used as the database open/fill time.
   */
  readonly signalTimeIso: string | null;
  /** Server receipt timestamp (monotonic server clock). Authoritative. */
  readonly serverTimeIso: string;
}

/**
 * Synchronous, side-effect-free evaluation of the C0 containment hard-block.
 *
 * This is the minimum check that can be performed without any async call.
 * Full admission evaluation (session, calendar, provenance, ledger, quote)
 * will be implemented in Phase 1 as the individual gates are verified and
 * upgraded to fail-closed (see remediation plan).
 *
 * During Phase 0 the result is always BLOCKED because both C0 constants are
 * true. The function is exposed here so unit tests can verify the boundary
 * independently of C0 — pass c0FnoBlocked=false / c0EquityBlocked=false to
 * test the gates below C0 in isolation.
 *
 * @param segment - Trade segment being evaluated
 * @param c0FnoBlocked - Injected value of FNO_AUTO_OPEN_C0_BLOCKED (default true)
 * @param c0EquityBlocked - Injected value of EQUITY_AUTO_OPEN_C0_BLOCKED (default true)
 * @param signalTimeIso - Signal timestamp (audit only, not authoritative)
 */
export function evaluateAdmission(
  segment: TradeSegment,
  {
    c0FnoBlocked = true,
    c0EquityBlocked = true,
    signalTimeIso = null,
  }: {
    c0FnoBlocked?: boolean;
    c0EquityBlocked?: boolean;
    signalTimeIso?: string | null;
  } = {},
): TradeAdmissionDecision {
  const serverNow = new Date();
  const serverTimeIso = serverNow.toISOString();
  const decisionAt = serverTimeIso;
  const blockedReasons: AdmissionBlockReason[] = [];

  // ─── Hard C0 block ───────────────────────────────────────────────────
  // Must be the FIRST check. Returns immediately once blocked by C0.
  // This mirrors the in-writer C0 check (FNO_AUTO_OPEN_C0_BLOCKED /
  // EQUITY_AUTO_OPEN_C0_BLOCKED) so the boundary and the writer are
  // consistent.
  if (segment === "FNO" && c0FnoBlocked) {
    blockedReasons.push("C0_FNO_CONTAINMENT");
  }
  if ((segment === "EQUITY") && c0EquityBlocked) {
    blockedReasons.push("C0_EQUITY_CONTAINMENT");
  }
  if (segment === "COMBO" && c0FnoBlocked) {
    blockedReasons.push("C0_COMBO_CONTAINMENT");
  }

  const c0Active = blockedReasons.length > 0;

  const allowed = blockedReasons.length === 0;
  const summary = allowed
    ? "ADMITTED"
    : blockedReasons.join(", ");

  return {
    allowed,
    blockedReasons,
    summary,
    decisionAt,
    c0Active,
    segment,
    signalTimeIso,
    serverTimeIso,
  };
}

/**
 * Convenience wrapper that reads the real C0 constants.
 * Import and call this from production writers.
 * For unit tests, use evaluateAdmission() with injected constants.
 */
export function evaluateAdmissionWithC0(
  segment: TradeSegment,
  signalTimeIso?: string | null,
): TradeAdmissionDecision {
  // These constants are duplicated here (not imported from the writer modules)
  // to avoid circular dependencies. They must match the constants in
  // paperTradingFO.ts and paperTradingEq.ts exactly.
  // When C0 is lifted, change both the writer constant AND this constant.
  const C0_FNO_BLOCKED = true;    // Must match FNO_AUTO_OPEN_C0_BLOCKED
  const C0_EQUITY_BLOCKED = true; // Must match EQUITY_AUTO_OPEN_C0_BLOCKED

  return evaluateAdmission(segment, {
    c0FnoBlocked: C0_FNO_BLOCKED,
    c0EquityBlocked: C0_EQUITY_BLOCKED,
    signalTimeIso: signalTimeIso ?? null,
  });
}
