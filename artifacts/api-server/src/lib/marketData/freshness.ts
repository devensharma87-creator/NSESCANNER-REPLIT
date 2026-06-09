/**
 * Freshness computation. Pure, deterministic, and unit-tested — the layer's
 * single definition of "how old is this and is it stale".
 */

import { getPolicy } from "./policy";

export interface Freshness {
  /** Age in seconds (now − asOf), or null when asOf is unknown. */
  freshnessSec: number | null;
  /** Older than the freshness budget. */
  isStale: boolean;
  /** Older than the hard-stale budget (validation should be "stale"). */
  isHardStale: boolean;
}

export interface FreshnessBudget {
  freshnessBudgetSec: number;
  staleBudgetSec: number;
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
  if (asOfMs == null || !Number.isFinite(asOfMs)) {
    // Unknown timestamp — treat as stale (cannot prove freshness).
    return { freshnessSec: null, isStale: true, isHardStale: false };
  }
  const ageSec = Math.max(0, Math.round((nowMs - asOfMs) / 1000));
  return {
    freshnessSec: ageSec,
    isStale: ageSec > b.freshnessBudgetSec,
    isHardStale: ageSec > b.staleBudgetSec,
  };
}
