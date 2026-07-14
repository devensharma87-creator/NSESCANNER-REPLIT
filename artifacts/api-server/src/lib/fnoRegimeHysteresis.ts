/**
 * Regime hysteresis + expiry-day helpers.
 *
 * These pure (state-bearing for hysteresis, pure-compute for calendar) helpers
 * are extracted into their own module so they can be tested independently of
 * the heavy `optionSignals` sweep machinery.
 *
 * Imported by `optionSignals.ts` only.
 */
import type { RegimeResult, Regime } from "./regimeClassifier";

/** Minimal expiry-config interface used by isExpiryDayForAnyIndex. */
export interface ExpiryConfig {
  expiryWeekday: number;
  expiryCadence: "weekly" | "monthly";
}

// ─── Regime hysteresis state ──────────────────────────────────────────────────
//
// Require 2 consecutive 15-min bars with the SAME proposed regime before
// accepting a flip. This prevents a single volatile bar from bouncing the
// regime label and producing conflicting signal tiers within a 30-min window.
//
// EXPIRY_DAY is date-based (not indicator-based) and bypasses hysteresis —
// it is always accepted immediately.
//
// State is per-index, module-scoped, resets on server restart (acceptable —
// the 30-min window comfortably survives normal restarts).
interface RegimeHysteresisEntry {
  confirmed: RegimeResult;
  /** The regime the classifier wants to flip to (or null if stable). */
  pendingRegime: Regime | null;
  /** closes.length at which we first saw pendingRegime. Used to detect bar advancement. */
  pendingBarCount: number;
}

const regimeHysteresisByIndex = new Map<string, RegimeHysteresisEntry>();

/** Reset hysteresis state for all indices. Intended for use in unit tests only. */
export function resetRegimeHysteresisForTest(): void {
  regimeHysteresisByIndex.clear();
}

/**
 * Apply 2-bar hysteresis to a proposed regime flip.
 * Returns either the confirmed regime (if the flip is not yet stable)
 * or the new regime (if 2 consecutive bars with the proposed regime have
 * been observed or the new regime is EXPIRY_DAY).
 *
 * @param symbol   Index symbol (e.g. "NIFTY")
 * @param proposed Latest classifyRegime() result
 * @param barCount closes.length — a proxy for the 15-min bar index. Grows by 1
 *                 each time a new 15-min candle closes. Used to detect whether
 *                 the ticker has advanced to a new bar since we last saw the
 *                 pending regime.
 */
export function applyRegimeHysteresis(symbol: string, proposed: RegimeResult, barCount: number): RegimeResult {
  const entry = regimeHysteresisByIndex.get(symbol);

  // First call for this index — accept immediately as the baseline.
  if (!entry) {
    regimeHysteresisByIndex.set(symbol, {
      confirmed: proposed,
      pendingRegime: null,
      pendingBarCount: 0,
    });
    return proposed;
  }

  // Stable — no change needed.
  if (proposed.regime === entry.confirmed.regime) {
    entry.pendingRegime = null;
    entry.pendingBarCount = 0;
    return proposed;
  }

  // EXPIRY_DAY is date-based — always accept immediately.
  if (proposed.regime === "EXPIRY_DAY") {
    entry.confirmed = proposed;
    entry.pendingRegime = null;
    entry.pendingBarCount = 0;
    return proposed;
  }

  // Proposed regime differs from confirmed. Check if we already saw this
  // pending regime on a PREVIOUS bar (barCount must have advanced).
  if (entry.pendingRegime === proposed.regime && barCount > entry.pendingBarCount) {
    // Second consecutive bar with the same proposed regime → accept the flip.
    entry.confirmed = proposed;
    entry.pendingRegime = null;
    entry.pendingBarCount = 0;
    return proposed;
  }

  // First time we see this proposed flip — record as pending and hold at confirmed.
  entry.pendingRegime = proposed.regime;
  entry.pendingBarCount = barCount;
  // Return the confirmed result (not the proposed one) to hold the current regime.
  return entry.confirmed;
}

// ─── isExpiryDay helper ───────────────────────────────────────────────────────
//
// Used by the 12:30 IST expiry-day early-close check in the sweep.
// We derive isExpiry from OPTION_INDICES config so the check is consistent
// with the signal layer.

/**
 * Returns true if `nowMs` (UTC epoch ms) falls on an expiry day for any of the
 * provided index configs.
 */
export function isExpiryDayForAnyIndex(nowMs: number, indices: ExpiryConfig[]): boolean {
  const ist = new Date(nowMs + 5.5 * 60 * 60 * 1000);
  const istWd    = ist.getUTCDay();
  const istDate  = ist.getUTCDate();
  const istMonth = ist.getUTCMonth();
  const istYear  = ist.getUTCFullYear();

  for (const cfg of indices) {
    if (cfg.expiryCadence === "weekly") {
      if (istWd === cfg.expiryWeekday) return true;
    } else {
      // Monthly: last occurrence of expiryWeekday in the month.
      if (istWd === cfg.expiryWeekday) {
        const next = new Date(Date.UTC(istYear, istMonth, istDate + 7));
        if (next.getUTCMonth() !== istMonth) return true;
      }
    }
  }
  return false;
}
