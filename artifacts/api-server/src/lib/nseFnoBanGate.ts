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

import { isFnoBanned } from "./fnoBanList";
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
  /** Machine-readable verdict. */
  verdict: FnoBanAdmissionVerdict;
  /** true when admission is permitted to proceed past this gate. */
  allowed: boolean;
  /** One-line reason for logging/audit. */
  reason: string;
  /** The raw tri-state from isFnoBanned(), or null if exempted/short-circuited. */
  rawBanResult: boolean | null | "EXEMPT";
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
      reason: "Index derivative — exempt from individual stock F&O ban list",
      rawBanResult: "EXEMPT",
    };
  }

  // ── Individual stock check ────────────────────────────────────────────────
  let rawResult: boolean | null;
  try {
    rawResult = await isFnoBanned(sym);
  } catch (err) {
    // isFnoBanned never throws per its contract, but extra defence:
    logger.error({ symbol: sym, context, err }, "nseFnoBanGate: isFnoBanned threw — fail-closed");
    return {
      verdict: "BLOCKED_UNKNOWN",
      allowed: false,
      reason: "isFnoBanned threw unexpectedly — fail-closed",
      rawBanResult: null,
    };
  }

  if (rawResult === null) {
    // null = UNAVAILABLE or LAST_KNOWN_STALE — fail closed.
    // We cannot distinguish STALE vs UNAVAILABLE here without calling
    // getFnoBanList() separately; both states require blocking.
    logger.warn(
      { symbol: sym, context },
      "nseFnoBanGate: BLOCKED — isFnoBanned returned null (UNAVAILABLE or LAST_KNOWN_STALE)",
    );
    return {
      verdict: "BLOCKED_UNAVAILABLE",
      allowed: false,
      reason: "F&O ban list UNAVAILABLE or LAST_KNOWN_STALE — fail-closed",
      rawBanResult: null,
    };
  }

  if (rawResult === true) {
    logger.info(
      { symbol: sym, context },
      "nseFnoBanGate: BLOCKED_BANNED — symbol is on the current F&O ban list",
    );
    return {
      verdict: "BLOCKED_BANNED",
      allowed: false,
      reason: `${sym} is on the NSE F&O ban list (MWPL breach) — admission blocked`,
      rawBanResult: true,
    };
  }

  // rawResult === false → CURRENT, not banned.
  logger.debug(
    { symbol: sym, context },
    "nseFnoBanGate: ALLOWED — symbol is not on the current F&O ban list",
  );
  return {
    verdict: "ALLOWED",
    allowed: true,
    reason: "Symbol is not on the current NSE F&O ban list",
    rawBanResult: false,
  };
}
