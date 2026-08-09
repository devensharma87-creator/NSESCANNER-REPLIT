/**
 * NSE F&O Ban List Admission Gate.
 *
 * Central fail-closed gate for ALL production admission paths (signal dispatch,
 * swing staging, F&O paper entry). Wraps isFnoBanned() and normalises the
 * tri-state result into a structured admission decision so callers don't have
 * to individually branch on null.
 *
 * SEMANTICS:
 *   isFnoBanned() returns:
 *     true  → symbol IS on the ban list (CURRENT source)
 *     false → symbol is NOT on the ban list (CURRENT source, admission permitted)
 *     null  → UNAVAILABLE or LAST_KNOWN_STALE (FAIL-CLOSED, admission blocked)
 *
 * INDEX DERIVATIVES (NIFTY, BANKNIFTY, SENSEX, MIDCPNIFTY, FINNIFTY):
 *   These are index derivatives, NOT individual equity F&O. The NSE individual
 *   stock F&O ban list covers stocks whose market-wide position limit (MWPL) is
 *   breached; it never covers index derivatives. isFnoBanned("NIFTY") always
 *   returns false (not found in the individual stock ban list).
 *
 *   For explicit traceability, checkFnoBanAdmission() returns status=CURRENT with
 *   banned=false for recognised index derivative symbols even when the ban list is
 *   UNAVAILABLE. This is intentional: a ban-list outage must not block index F&O
 *   alerts. The factual basis is that index derivatives are authoritatively excluded
 *   from the stock MWPL ban list by definition.
 *
 * EQUITY/STOCK F&O:
 *   Individual stock symbols MUST be checked. UNAVAILABLE or LAST_KNOWN_STALE
 *   → BLOCKED (fail-closed). BANNED → BLOCKED. CLEAR → ALLOWED.
 *
 * ADMISSION RULES (per structured result fields):
 *   CURRENT + canAuthorizeAdmission=true + banned=false  → gate may pass
 *   CURRENT + banned=true                                → block
 *   LAST_KNOWN_STALE                                     → block (fail-closed)
 *   UNAVAILABLE                                          → block (fail-closed)
 *   Malformed/unknown result                             → block (fail-closed)
 *   null must NEVER be interpreted as false.
 *   A stale list must NEVER authorize a new derivatives position.
 */

import { isFnoBanned, getFnoBanList } from "./fnoBanList";
import { logger } from "./logger";

// ── Index derivative exemption ─────────────────────────────────────────────────

/**
 * Symbols that are index derivatives, exempt from the individual stock F&O ban.
 * The individual stock ban (NSE MWPL breach) never applies to these.
 */
export const NSE_INDEX_DERIVATIVE_SYMBOLS = new Set([
  "NIFTY",
  "BANKNIFTY",
  "SENSEX",
  "MIDCPNIFTY",
  "FINNIFTY",
  "NIFTYNXT50",
  "BANKEX",
]);

export function isNseIndexDerivative(symbol: string): boolean {
  return NSE_INDEX_DERIVATIVE_SYMBOLS.has(symbol.toUpperCase());
}

// ── Structured result type (prompt-required contract) ─────────────────────────

/**
 * Ban-list availability status at the time of the check.
 *   CURRENT          — fresh data; the check is authoritative.
 *   LAST_KNOWN_STALE — stale data (refresh failed); admission blocked fail-closed.
 *   UNAVAILABLE      — no data at all; admission blocked fail-closed.
 */
export type FnoBanAdmissionStatus = "CURRENT" | "LAST_KNOWN_STALE" | "UNAVAILABLE";

/**
 * Machine-readable reason code for the gate outcome.
 *   FNO_BAN_CURRENT_CLEAR   — CURRENT list, symbol not banned — gate may pass.
 *   FNO_BAN_CURRENT_BANNED  — CURRENT list, symbol is banned — blocked.
 *   FNO_BAN_LAST_KNOWN_STALE — stale data — blocked fail-closed.
 *   FNO_BAN_UNAVAILABLE     — no data — blocked fail-closed.
 *   FNO_BAN_MALFORMED       — unexpected error — blocked fail-closed.
 */
export type FnoBanAdmissionReasonCode =
  | "FNO_BAN_CURRENT_CLEAR"
  | "FNO_BAN_CURRENT_BANNED"
  | "FNO_BAN_LAST_KNOWN_STALE"
  | "FNO_BAN_UNAVAILABLE"
  | "FNO_BAN_MALFORMED";

/**
 * Structured admission result from checkFnoBanAdmission().
 *
 * PRIMARY GATE FIELDS (use these for admission decisions):
 *   status               — ban-list availability status.
 *   banned               — true=on ban list, false=not banned, null=unknown/stale/unavailable.
 *   canAuthorizeAdmission — true only when admission is permitted. USE THIS for gate checks.
 *   asOf                 — ISO timestamp of the ban-list snapshot used (null when unavailable).
 *   reasonCode           — machine-readable outcome code.
 *
 * DIAGNOSTIC FIELDS (logging only; MUST NOT be used for gate decisions):
 *   verdict              — legacy machine-readable verdict string (for log contexts).
 *   reason               — human-readable one-line reason (for structured logs).
 *
 * REMOVED FIELDS (from prior packs — intentionally absent):
 *   allowed              — removed; use canAuthorizeAdmission.
 *   rawBanResult         — removed; use banned.
 *   banListStatus        — removed; use status.
 */
export interface FnoBanAdmissionResult {
  // ── Primary gate fields (required by prompt contract) ────────────────────
  /** Ban-list availability at the time of this check. */
  status: FnoBanAdmissionStatus;
  /**
   * Whether the symbol is on the ban list.
   * Only meaningful when status=CURRENT. null when status=LAST_KNOWN_STALE or UNAVAILABLE
   * (cannot assert banned/clear status from stale or absent data).
   * IMPORTANT: null must NEVER be interpreted as false.
   */
  banned: boolean | null;
  /**
   * Whether admission is permitted to proceed past this gate.
   * true ONLY when status=CURRENT and banned=false.
   * USE THIS FIELD for gate checks — not `allowed` (removed) or any other field.
   */
  canAuthorizeAdmission: boolean;
  /**
   * ISO timestamp of the ban-list snapshot used for this check.
   * null when status=UNAVAILABLE (no successful fetch has ever occurred).
   * Present (even if stale) when status=LAST_KNOWN_STALE.
   */
  asOf: string | null;
  /** Machine-readable reason code for the gate outcome. */
  reasonCode: FnoBanAdmissionReasonCode;

  // ── Diagnostic fields (logging only — must not drive gate logic) ─────────
  /**
   * @diagnostic Human-readable reason for structured log contexts.
   * Do not use for gate decisions.
   */
  reason: string;
  /**
   * @diagnostic Legacy verdict string for existing log contexts.
   * Do not use for gate decisions. Use canAuthorizeAdmission for gate checks.
   */
  verdict: string;
}

// ── Gate ──────────────────────────────────────────────────────────────────────

/**
 * Check the NSE F&O ban list admission gate for a given symbol.
 *
 * Always resolves — never throws. Fail-closed on data unavailability.
 *
 * Use result.canAuthorizeAdmission for gate decisions.
 * Use result.status + result.reasonCode for structured telemetry.
 *
 * @param symbol   - The trading symbol to check (e.g. "HINDCOPPER", "NIFTY").
 * @param context  - Caller context for structured logging (e.g. "stageSwingOrder").
 */
export async function checkFnoBanAdmission(
  symbol: string,
  context: string,
): Promise<FnoBanAdmissionResult> {
  const sym = symbol.toUpperCase();

  // ── Index derivative short-circuit ────────────────────────────────────────
  // Index derivatives are authoritatively exempt from the individual stock
  // F&O ban (MWPL breach): NSE's stock F&O ban list only ever contains
  // individual equities, not index derivatives. This is not a policy choice
  // but a definitional fact. Therefore status=CURRENT and banned=false.
  if (isNseIndexDerivative(sym)) {
    logger.debug(
      { symbol: sym, context },
      "nseFnoBanGate: FNO_BAN_CURRENT_CLEAR (EXEMPT_INDEX_DERIVATIVE) — individual stock ban list does not apply to index derivatives",
    );
    return {
      status: "CURRENT",
      banned: false,
      canAuthorizeAdmission: true,
      asOf: null,
      reasonCode: "FNO_BAN_CURRENT_CLEAR",
      reason: "Index derivative — exempt from individual stock F&O ban list (MWPL breach never covers index derivatives)",
      verdict: "EXEMPT_INDEX_DERIVATIVE",
    };
  }

  // ── Individual stock check ─────────────────────────────────────────────────
  // Call getFnoBanList() (not just isFnoBanned) so we can distinguish
  // LAST_KNOWN_STALE from UNAVAILABLE and emit the correct status/reasonCode.
  let list: Awaited<ReturnType<typeof getFnoBanList>>;
  try {
    list = await getFnoBanList();
  } catch (err) {
    // getFnoBanList should never throw, but defensive:
    logger.error({ symbol: sym, context, err }, "nseFnoBanGate: getFnoBanList threw — fail-closed");
    return {
      status: "UNAVAILABLE",
      banned: null,
      canAuthorizeAdmission: false,
      asOf: null,
      reasonCode: "FNO_BAN_MALFORMED",
      reason: "getFnoBanList threw unexpectedly — fail-closed",
      verdict: "BLOCKED_UNKNOWN",
    };
  }

  // null means UNAVAILABLE — no data has ever been fetched successfully.
  if (list === null) {
    logger.warn(
      { symbol: sym, context },
      "nseFnoBanGate: FNO_BAN_UNAVAILABLE — ban list has no data (never fetched successfully)",
    );
    return {
      status: "UNAVAILABLE",
      banned: null,
      canAuthorizeAdmission: false,
      asOf: null,
      reasonCode: "FNO_BAN_UNAVAILABLE",
      reason: "F&O ban list UNAVAILABLE (no data) — fail-closed",
      verdict: "BLOCKED_UNAVAILABLE",
    };
  }

  // LAST_KNOWN_STALE — refresh failed; serving expired cache. Admission blocked.
  // A stale list must NEVER authorize a new derivatives position.
  if (!list.canAuthorizeAdmission) {
    logger.warn(
      { symbol: sym, context, status: list.status, sourceAsOf: list.sourceAsOf },
      "nseFnoBanGate: FNO_BAN_LAST_KNOWN_STALE — ban list is stale; cannot authorize admission",
    );
    return {
      status: "LAST_KNOWN_STALE",
      banned: null,    // stale list cannot assert banned/clear status
      canAuthorizeAdmission: false,
      asOf: list.sourceAsOf,
      reasonCode: "FNO_BAN_LAST_KNOWN_STALE",
      reason: `F&O ban list LAST_KNOWN_STALE (asOf: ${list.sourceAsOf ?? "unknown"}) — stale list must not authorize admission; fail-closed`,
      verdict: "BLOCKED_STALE_LIST",
    };
  }

  // CURRENT — ban list is authoritative; check membership.
  const bannedSymbols = new Set(list.symbols.map(s => s.toUpperCase()));
  const isBanned = bannedSymbols.has(sym);

  if (isBanned) {
    logger.info(
      { symbol: sym, context },
      "nseFnoBanGate: FNO_BAN_CURRENT_BANNED — symbol is on the current F&O ban list",
    );
    return {
      status: "CURRENT",
      banned: true,
      canAuthorizeAdmission: false,
      asOf: list.sourceAsOf,
      reasonCode: "FNO_BAN_CURRENT_BANNED",
      reason: `${sym} is on the NSE F&O ban list (MWPL breach) — admission blocked`,
      verdict: "BLOCKED_BANNED",
    };
  }

  // CURRENT, not banned — admission permitted.
  logger.debug(
    { symbol: sym, context },
    "nseFnoBanGate: FNO_BAN_CURRENT_CLEAR — symbol is not on the current F&O ban list",
  );
  return {
    status: "CURRENT",
    banned: false,
    canAuthorizeAdmission: true,
    asOf: list.sourceAsOf,
    reasonCode: "FNO_BAN_CURRENT_CLEAR",
    reason: "Symbol is not on the current NSE F&O ban list",
    verdict: "ALLOWED",
  };
}

// ── Export for backward compatibility (tests that reference verdict values) ───
/** @deprecated Use FnoBanAdmissionReasonCode for new code. */
export type FnoBanAdmissionVerdict =
  | "EXEMPT_INDEX_DERIVATIVE"
  | "ALLOWED"
  | "BLOCKED_BANNED"
  | "BLOCKED_STALE_LIST"
  | "BLOCKED_UNAVAILABLE"
  | "BLOCKED_UNKNOWN";

// ── Re-export isFnoBanned for callers that need the raw tri-state ──────────────
export { isFnoBanned };
