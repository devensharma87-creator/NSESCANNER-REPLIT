/**
 * Freshness computation. Pure, deterministic, and unit-tested — the layer's
 * single definition of "how old is this and is it stale".
 *
 * B1.1-C1: future provider timestamps are explicitly classified FUTURE_TIMESTAMP
 * and must not power any trade decision, paper admission, contract selection,
 * or exit confirmation. The raw signed age is preserved for diagnostics.
 */

import { getPolicy } from "./policy";

// ── Clock-skew tolerance ──────────────────────────────────────────────────────
//
// Derived from the project's accepted clock-health policy (clockDrift.ts):
//   DRIFT_ALERT_MS  = 1 000 ms  (server clock-health alert threshold)
//   MAX_RTT         = 3 000 ms  (probe RTT ceiling for reliable offset estimates)
//
// A 5-second tolerance accommodates:
//   • DRIFT_ALERT_MS for local server clock drift (1 s)
//   • Symmetric provider-side clock drift of similar magnitude (1 s)
//   • Network latency up to MAX_RTT_FOR_RELIABLE_PROBE_MS/2 (≈ 1.5 s)
//   • Rounding/serialisation jitter (0.5 s)
//
// Any provider timestamp more than CLOCK_SKEW_TOLERANCE_SEC seconds in the
// future is classified FUTURE_TIMESTAMP and fails all honesty checks.
export const CLOCK_SKEW_TOLERANCE_SEC = 5;

export interface FreshnessBudget {
  freshnessBudgetSec: number;
  staleBudgetSec: number;
}

export interface Freshness {
  /**
   * Raw signed age in seconds (now − asOf). Negative when asOf is in the
   * future relative to now. Null when asOf is unknown or unparseable.
   * Never use this value as a display age — use freshnessSec instead.
   */
  rawAgeSec: number | null;
  /**
   * Display-safe age in seconds: null when asOf is unknown or isFutureTimestamp.
   * Always ≥ 0 — never expose a negative age as a UI freshness value.
   */
  freshnessSec: number | null;
  /** Older than the freshness budget OR isFutureTimestamp. */
  isStale: boolean;
  /** Older than the hard-stale budget (validation should be "stale"). */
  isHardStale: boolean;
  /**
   * True when the provider timestamp is more than CLOCK_SKEW_TOLERANCE_SEC
   * seconds in the future relative to the server clock.
   *
   * Such data is unverified — it must never power:
   *   - trade-decision routing (TRADE_DECISION)
   *   - paper-trade admission (PAPER_ADMISSION)
   *   - contract selection
   *   - exit monitoring / stop-loss confirmation
   *
   * This is a fail-closed gate, not a warning.
   */
  isFutureTimestamp: boolean;
  /**
   * Observed clock skew in seconds when rawAgeSec < 0 (provider timestamp in
   * future). Negative = provider is ahead of server. Null when no skew observed.
   * Preserved for diagnostics and alerting; never used to make data appear fresh.
   */
  clockSkewSec: number | null;
}

/**
 * Compute freshness for a datum.
 * @param asOfMs  epoch ms of the data instant (null/NaN ⇒ unknown).
 * @param nowMs   epoch ms reference (defaults to Date.now()).
 * @param budget  optional override; defaults to the active policy budgets.
 */
export function computeFreshness(
  asOfMs: number | null | undefined,
  nowMs: number = Date.now(),
  budget?: FreshnessBudget,
): Freshness {
  const b = budget ?? getPolicy();

  // ── Case 1: Unknown/invalid timestamp ─────────────────────────────────────
  // Cannot prove freshness. Fail closed: treat as stale.
  if (asOfMs == null || !Number.isFinite(asOfMs)) {
    return {
      rawAgeSec: null,
      freshnessSec: null,
      isStale: true,
      isHardStale: false,
      isFutureTimestamp: false,
      clockSkewSec: null,
    };
  }

  // rawAgeSec is signed: positive = data is in the past (expected), negative = future.
  const rawAgeSec = (nowMs - asOfMs) / 1000;

  // ── Case 2: Materially in the future ─────────────────────────────────────
  // Beyond CLOCK_SKEW_TOLERANCE_SEC — unverified timestamp, must not be tradeable.
  // Do NOT clamp to zero. Do NOT classify as live. Preserve the raw skew.
  if (rawAgeSec < -CLOCK_SKEW_TOLERANCE_SEC) {
    return {
      rawAgeSec,
      freshnessSec: null,      // Do not expose impossible negative age to the UI.
      isStale: true,           // Fail closed: not fresh, not tradeable.
      isHardStale: false,      // Distinct from "expired old data" — this is "impossible future".
      isFutureTimestamp: true,
      clockSkewSec: rawAgeSec, // Preserve the signed skew for diagnostics.
    };
  }

  // ── Case 3: Normal past timestamp or within negative-skew tolerance ───────
  // Minor clock jitter within tolerance: clamp to 0 for budget comparison.
  // Preserve the raw signed skew for diagnostics without fabricating freshness.
  const ageSec = Math.max(0, rawAgeSec);

  return {
    rawAgeSec,
    freshnessSec: Math.round(ageSec),
    isStale: ageSec > b.freshnessBudgetSec,
    isHardStale: ageSec > b.staleBudgetSec,
    isFutureTimestamp: false,
    clockSkewSec: rawAgeSec < 0 ? rawAgeSec : null, // Record minor skew for diagnostics.
  };
}
