/**
 * Equity paper-trade session-admission module.
 *
 * Provides structured, reason-coded admission decisions for equity (and F&O)
 * paper opens and historical timestamp classification. All logic is pure —
 * no DB, no side-effects. Maps `getMarketStatusDetail` output to one of 11
 * structured reason codes.
 *
 * Design notes:
 *   - NSE equity session: 09:15–15:30 IST, Mon–Fri, non-holiday.
 *   - Pre-open (09:00–09:15) is NOT authorized for new paper opens.
 *   - Equity has NO separate intra-session entry cutoff beyond 15:30.
 *     The F&O BASELINE 14:45 cutoff (FNO_BASELINE_GUARDRAILS) is F&O-only
 *     and lives in the F&O path — it is NOT replicated here.
 *     ABB opened at 15:12:03 IST on 2026-06-29 is correctly VALID_SESSION.
 *   - MANUAL source is NO LONGER exempted from the gate (P0.2-correction-1).
 *     Manual closes (forceClosePaperEquityTrade) do not check the session —
 *     only opens are gated.
 */
import { getMarketStatusDetail } from "./marketEvents";

// ─── Calendar version ────────────────────────────────────────────────────────

/**
 * Monotonic version tag for the NSE holiday calendar embedded in
 * `marketEvents.ts`. Bump when the holiday list is updated (new year
 * published by NSE, corrections, etc.) so downstream consumers can detect
 * stale cached admission decisions.
 */
export const CALENDAR_VERSION = "NSE-2026-v1";

// ─── Reason codes ─────────────────────────────────────────────────────────────

/**
 * Structured reason codes for equity paper-trade session admission decisions.
 *
 * "MARKET_CLOSED" is a LEGACY ALIAS — it was written by the pre-P0.2 gate and
 * may appear in existing `paper_eq_audit` rows. New rows use one of the 11
 * precise codes. The UI / audit SKIP_TONE map should fall through gracefully
 * for legacy rows.
 */
export type EqSessionAdmissionReason =
  // ── Structured codes (P0.2) ────────────────────────────────────────────────
  /** Blocked — clock falls on Saturday or Sunday. */
  | "MARKET_CLOSED_WEEKEND"
  /** Blocked — date is a curated NSE holiday (equity segment). */
  | "MARKET_CLOSED_HOLIDAY"
  /** Blocked — clock is before 09:15 IST (but after 00:00). */
  | "BEFORE_MARKET_SESSION"
  /** Blocked — clock is after 15:30 IST (regular session close). */
  | "AFTER_MARKET_SESSION"
  /**
   * Blocked — an explicit equity entry cutoff has passed.
   * NOT currently fired for equity (no separate intra-session cutoff exists).
   * Reserved for future cutoff config or F&O session-gate reuse.
   */
  | "ENTRY_CUTOFF_PASSED"
  /**
   * Blocked — clock is in the NSE pre-open auction (09:00–09:15 IST).
   * Pre-open is a special price-discovery session; regular equity paper
   * opens are not authorized here.
   */
  | "SPECIAL_SESSION_NOT_AUTHORIZED"
  /** Blocked — calendar data unavailable or market status is UNKNOWN. */
  | "CALENDAR_UNAVAILABLE"
  /** Blocked — server clock is not a valid finite instant (NaN / ±Infinity). */
  | "INVALID_SERVER_TIMESTAMP"
  /**
   * Informational — the stored quote's own timestamp is outside the session.
   * Used by `classifyStoredTimestamp` for quote-time forensics, not open-time
   * admission.
   */
  | "QUOTE_OUTSIDE_SESSION"
  /**
   * Informational — the stored quote is stale or not authoritative at the time
   * the position was opened.
   */
  | "QUOTE_STALE_OR_NOT_TRADE_GRADE"
  /**
   * Fail-closed fallback — required admission context is incomplete or
   * internally inconsistent.
   */
  | "TRADE_ADMISSION_CONTEXT_INCOMPLETE"
  // ── Legacy alias (read-only for pre-P0.2 audit rows) ──────────────────────
  /** @deprecated Written by the pre-P0.2 gate only. Use structured codes. */
  | "MARKET_CLOSED";

// ─── Validity bucket for stored positions ─────────────────────────────────────

/** Derived session-validity bucket for a stored position's `openedAt` timestamp. */
export type EqOpenedSessionValidity =
  | "VALID_SESSION"      // 09:15–15:30 IST, Mon–Fri, non-holiday
  | "OFF_SESSION"        // opened outside the authorized window
  | "SESSION_UNKNOWN"    // status could not be determined
  | "TIMESTAMP_AMBIGUOUS"; // stored timestamp is invalid/unparseable

// ─── Discriminated admission result ──────────────────────────────────────────

/** Admission decision returned by `computeEquitySessionAdmission`. */
export type SessionAdmissionResult =
  | {
      allowed: true;
      openedSessionValidity: "VALID_SESSION";
      openedAtIst: string;
      calendarVersion: string;
      timestampConfidence: "HIGH";
    }
  | {
      allowed: false;
      reason: EqSessionAdmissionReason;
      detail: string;
      openedSessionValidity: EqOpenedSessionValidity;
      openedAtIst?: string;
      calendarVersion: string;
      timestampConfidence: "HIGH" | "LOW";
    };

// ─── Core admission gate ──────────────────────────────────────────────────────

/**
 * Compute the session-admission decision for a NEW equity (or F&O) paper open.
 *
 * Called by `openPaperEquityTrade` for EVERY source — AUTO, MANUAL, and
 * SWING_STAGED_APPROVAL. The legacy MANUAL bypass was removed in P0.2.
 *
 * No equity-specific intra-session cutoff exists. The session end (15:30 IST)
 * is the only time boundary. If a cutoff were ever configured, the caller
 * would fire ENTRY_CUTOFF_PASSED after the OPEN branch below.
 */
export function computeEquitySessionAdmission(now: Date): SessionAdmissionResult {
  if (!isFinite(now.getTime())) {
    return {
      allowed: false,
      reason: "INVALID_SERVER_TIMESTAMP",
      detail: "Server clock returned an invalid (non-finite) timestamp",
      openedSessionValidity: "TIMESTAMP_AMBIGUOUS",
      calendarVersion: CALENDAR_VERSION,
      timestampConfidence: "LOW",
    };
  }

  const msd = getMarketStatusDetail(now);

  switch (msd.reason) {
    case "OPEN":
      return {
        allowed: true,
        openedSessionValidity: "VALID_SESSION",
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        timestampConfidence: "HIGH",
      };

    case "WEEKEND":
      return {
        allowed: false,
        reason: "MARKET_CLOSED_WEEKEND",
        detail: `Market closed — weekend (server IST: ${msd.serverIst})`,
        openedSessionValidity: "OFF_SESSION",
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        timestampConfidence: "HIGH",
      };

    case "HOLIDAY":
      return {
        allowed: false,
        reason: "MARKET_CLOSED_HOLIDAY",
        detail: `Market closed — NSE trading holiday (server IST: ${msd.serverIst})`,
        openedSessionValidity: "OFF_SESSION",
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        timestampConfidence: "HIGH",
      };

    case "BEFORE_OPEN":
      return {
        allowed: false,
        reason: "BEFORE_MARKET_SESSION",
        detail: `Before NSE equity session — market opens at 09:15 IST (server IST: ${msd.serverIst})`,
        openedSessionValidity: "OFF_SESSION",
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        timestampConfidence: "HIGH",
      };

    case "PRE_OPEN":
      return {
        allowed: false,
        reason: "SPECIAL_SESSION_NOT_AUTHORIZED",
        detail: `NSE pre-open auction (09:00–09:15 IST) — equity paper opens not authorized (server IST: ${msd.serverIst})`,
        openedSessionValidity: "OFF_SESSION",
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        timestampConfidence: "HIGH",
      };

    case "AFTER_CLOSE":
      return {
        allowed: false,
        reason: "AFTER_MARKET_SESSION",
        detail: `NSE equity session closed for the day at 15:30 IST (server IST: ${msd.serverIst})`,
        openedSessionValidity: "OFF_SESSION",
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        timestampConfidence: "HIGH",
      };

    case "UNKNOWN":
    default:
      return {
        allowed: false,
        reason: "CALENDAR_UNAVAILABLE",
        detail: `Market session status could not be determined (server IST: ${msd.serverIst})`,
        openedSessionValidity: "SESSION_UNKNOWN",
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        timestampConfidence: "LOW",
      };
  }
}

// ─── Historical timestamp classification ─────────────────────────────────────

/** Fields augmented onto each open position by the positions API. */
export interface StoredPositionSessionInfo {
  openedSessionValidity: EqOpenedSessionValidity;
  /** Null when validity is VALID_SESSION. */
  openedSessionReason: EqSessionAdmissionReason | null;
  /** Human-readable IST string, null when timestamp is ambiguous. */
  openedAtIst: string | null;
  calendarVersion: string;
  timestampConfidence: "HIGH" | "LOW";
}

/**
 * Classify a stored position's `openedAt` ISO timestamp for display.
 *
 * Used by `GET /paper/positions/eq` to augment each row with derived
 * session-validity fields so the frontend can render provenance badges
 * without any client-side calendar logic.
 *
 * Read-only forensic classification only — never blocks or alters any open.
 */
export function classifyStoredTimestamp(iso: string | null | undefined): StoredPositionSessionInfo {
  if (!iso) {
    return {
      openedSessionValidity: "TIMESTAMP_AMBIGUOUS",
      openedSessionReason: "INVALID_SERVER_TIMESTAMP",
      openedAtIst: null,
      calendarVersion: CALENDAR_VERSION,
      timestampConfidence: "LOW",
    };
  }
  const d = new Date(iso);
  if (!isFinite(d.getTime())) {
    return {
      openedSessionValidity: "TIMESTAMP_AMBIGUOUS",
      openedSessionReason: "INVALID_SERVER_TIMESTAMP",
      openedAtIst: null,
      calendarVersion: CALENDAR_VERSION,
      timestampConfidence: "LOW",
    };
  }

  const result = computeEquitySessionAdmission(d);
  if (result.allowed) {
    return {
      openedSessionValidity: "VALID_SESSION",
      openedSessionReason: null,
      openedAtIst: result.openedAtIst,
      calendarVersion: result.calendarVersion,
      timestampConfidence: "HIGH",
    };
  }

  return {
    openedSessionValidity: result.openedSessionValidity,
    openedSessionReason: result.reason,
    openedAtIst: result.openedAtIst ?? null,
    calendarVersion: result.calendarVersion,
    timestampConfidence: result.timestampConfidence,
  };
}
