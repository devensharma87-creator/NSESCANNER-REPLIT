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
 *   For explicit traceability, checkFnoBanAdmission() returns EXEMPT for
 *   recognised index derivative symbols even when the ban list is UNAVAILABLE.
 *   This is intentional: a ban-list outage must not block index F&O alerts.
 *
 * EQUITY/STOCK F&O:
 *   Individual stock symbols MUST be checked. UNAVAILABLE or LAST_KNOWN_STALE
 *   → BLOCKED (fail-closed). BANNED → BLOCKED. CLEAR → ALLOWED.
 */

import { isFnoBanned, getFnoBanList } from "./fnoBanList";
import type { FnoBanStatus } from "./fnoBanList";
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

// ── Result type ───────────────────────────────────────────────────────────────

export type FnoBanAdmissionVerdict =
  /** Symbol is an index derivative — exempt from individual stock F&O ban. */
  | "EXEMPT_INDEX_DERIVATIVE"
  /** Ban list is CURRENT and symbol is NOT banned — admission may proceed. */
  | "ALLOWED"
  /** Ban list is CURRENT and symbol IS on the ban list — admission blocked. */
  | "BLOCKED_BANNED"
  /** Ban list is LAST_KNOWN_STALE — cannot authorize admission (fail-closed). */
  | "BLOCKED_STALE_LIST"
  /** Ban list is UNAVAILABLE (no data at all) — admission blocked (fail-closed). */
  | "BLOCKED_UNAVAILABLE"
  /** Unknown null result from isFnoBanned — admission blocked (fail-closed). */
  | "BLOCKED_UNKNOWN";

export interface FnoBanAdmissionResult {
  // ── Core fields (backward-compatible) ────────────────────────────────────
  /** Machine-readable verdict. */
  verdict: FnoBanAdmissionVerdict;
  /** true when admission is permitted to proceed past this gate. Alias: canAuthorizeAdmission. */
  allowed: boolean;
  /** One-line reason for logging/audit. */
  reason: string;
  /** The raw tri-state from isFnoBanned(), or null if exempted/short-circuited. */
  rawBanResult: boolean | null | "EXEMPT";

  // ── Extended fields (Pack 33B correctness — distinguish STALE vs UNAVAILABLE) ──
  /**
   * Machine-readable ban-list availability status used for this check.
   *   CURRENT               — fresh data; check is authoritative.
   *   LAST_KNOWN_STALE      — stale data; admission blocked (fail-closed).
   *   UNAVAILABLE           — no data at all; admission blocked (fail-closed).
   *   EXEMPT                — index derivative; ban list not consulted.
   */
  banListStatus: FnoBanStatus | "EXEMPT";
  /** Alias for `allowed`. true ONLY when verdict is ALLOWED or EXEMPT_INDEX_DERIVATIVE. */
  canAuthorizeAdmission: boolean;
  /**
   * Whether the symbol is on the ban list. Only meaningful when banListStatus=CURRENT.
   * null for STALE, UNAVAILABLE, or EXEMPT (cannot assert banned/not-banned status).
   */
  banned: boolean | null;
  /**
   * ISO timestamp of the ban list snapshot used for this check.
   * null when UNAVAILABLE (no successful fetch has ever occurred).
   * Present (even if stale) when LAST_KNOWN_STALE.
   */
  asOf: string | null;
}

// ── Gate ──────────────────────────────────────────────────────────────────────

/**
 * Check the NSE F&O ban list admission gate for a given symbol.
 *
 * Always resolves — never throws. Fail-closed on data unavailability.
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
  if (isNseIndexDerivative(sym)) {
    logger.debug(
      { symbol: sym, context },
      "nseFnoBanGate: EXEMPT_INDEX_DERIVATIVE — individual stock ban list does not apply",
    );
    return {
      verdict: "EXEMPT_INDEX_DERIVATIVE",
      allowed: true,
      canAuthorizeAdmission: true,
      reason: "Index derivative — exempt from individual stock F&O ban list",
      rawBanResult: "EXEMPT",
      banListStatus: "EXEMPT",
      banned: null,
      asOf: null,
    };
  }

  // ── Individual stock check ─────────────────────────────────────────────────
  // Call getFnoBanList() (not just isFnoBanned) so we can distinguish
  // LAST_KNOWN_STALE from UNAVAILABLE and emit the correct verdict.
  let list: Awaited<ReturnType<typeof getFnoBanList>>;
  try {
    list = await getFnoBanList();
  } catch (err) {
    // getFnoBanList should never throw, but defensive:
    logger.error({ symbol: sym, context, err }, "nseFnoBanGate: getFnoBanList threw — fail-closed");
    return {
      verdict: "BLOCKED_UNKNOWN",
      allowed: false,
      canAuthorizeAdmission: false,
      reason: "getFnoBanList threw unexpectedly — fail-closed",
      rawBanResult: null,
      banListStatus: "UNAVAILABLE",
      banned: null,
      asOf: null,
    };
  }

  // null means UNAVAILABLE — no data has ever been fetched successfully.
  if (list === null) {
    logger.warn(
      { symbol: sym, context },
      "nseFnoBanGate: BLOCKED_UNAVAILABLE — ban list has no data (never fetched successfully)",
    );
    return {
      verdict: "BLOCKED_UNAVAILABLE",
      allowed: false,
      canAuthorizeAdmission: false,
      reason: "F&O ban list UNAVAILABLE (no data) — fail-closed",
      rawBanResult: null,
      banListStatus: "UNAVAILABLE",
      banned: null,
      asOf: null,
    };
  }

  // LAST_KNOWN_STALE — refresh failed; serving expired cache. Admission blocked.
  // This is now a distinct verdict from BLOCKED_UNAVAILABLE.
  if (!list.canAuthorizeAdmission) {
    logger.warn(
      { symbol: sym, context, status: list.status, sourceAsOf: list.sourceAsOf },
      "nseFnoBanGate: BLOCKED_STALE_LIST — ban list is stale; cannot authorize admission",
    );
    return {
      verdict: "BLOCKED_STALE_LIST",
      allowed: false,
      canAuthorizeAdmission: false,
      reason: `F&O ban list LAST_KNOWN_STALE (asOf: ${list.sourceAsOf ?? "unknown"}) — fail-closed`,
      rawBanResult: null,
      banListStatus: "LAST_KNOWN_STALE",
      banned: null,        // stale list cannot assert banned/clear status
      asOf: list.sourceAsOf,
    };
  }

  // CURRENT — ban list is authoritative; check membership.
  const bannedSymbols = new Set(list.symbols.map(s => s.toUpperCase()));
  const isBanned = bannedSymbols.has(sym);

  if (isBanned) {
    logger.info(
      { symbol: sym, context },
      "nseFnoBanGate: BLOCKED_BANNED — symbol is on the current F&O ban list",
    );
    return {
      verdict: "BLOCKED_BANNED",
      allowed: false,
      canAuthorizeAdmission: false,
      reason: `${sym} is on the NSE F&O ban list (MWPL breach) — admission blocked`,
      rawBanResult: true,
      banListStatus: "CURRENT",
      banned: true,
      asOf: list.sourceAsOf,
    };
  }

  // CURRENT, not banned — admission permitted.
  logger.debug(
    { symbol: sym, context },
    "nseFnoBanGate: ALLOWED — symbol is not on the current F&O ban list",
  );
  return {
    verdict: "ALLOWED",
    allowed: true,
    canAuthorizeAdmission: true,
    reason: "Symbol is not on the current NSE F&O ban list",
    rawBanResult: false,
    banListStatus: "CURRENT",
    banned: false,
    asOf: list.sourceAsOf,
  };
}
