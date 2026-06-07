/**
 * Backtest Lab — "why did this run produce no trades?" reasoning.
 *
 * When a Strategy Research / Compare run returns zero (or near-zero) trades, the
 * blocked-setups table already carries every rejection reason. These pure helpers
 * roll that table up into the single DOMINANT blocking rule and decide whether it
 * is a confirmation filter the owner can relax with one click.
 *
 * Honesty: we only ever report counts that are actually present in the blocked
 * array. A reason that is not a relaxable confirmation filter is reported with
 * `relaxKind = null` (no fake "relax" button) so the owner is never told a knob
 * exists when it does not.
 */

import type { BacktestBlockedSetup, BacktestFilterConfig } from "@workspace/api-client-react";

/** Boolean confirmation filters the owner can toggle OFF from the Lab. */
export const RELAXABLE_BOOLEAN_FILTERS = [
  "vwapFilter",
  "emaTrendFilter",
  "avoidChopZone",
  "avoidLast15Minutes",
] as const;

export type RelaxKind = "DISABLE_FILTER" | "LOWER_RR" | "RAISE_TRADE_CAP";

/**
 * Engine `reasonCode` → human label. For FILTER/DATA blocks the backtest runner
 * sets `reasonCode` to the FilterConfig key; the RISK trade-cap block uses
 * `MAX_TRADES_PER_DAY`.
 */
const REASON_LABELS: Record<string, string> = {
  vwapFilter: "VWAP Filter",
  emaTrendFilter: "EMA Trend Filter",
  avoidChopZone: "Avoid Chop Zone",
  avoidLast15Minutes: "Avoid Last 15 Minutes",
  minimumRiskReward: "Minimum Risk:Reward",
  MAX_TRADES_PER_DAY: "Max trades / day",
};

export interface DominantBlocker {
  /** Engine reason code (FilterConfig key, or MAX_TRADES_PER_DAY). */
  reasonCode: string;
  /** Human label for the dominant rule. */
  label: string;
  /** FILTER | DATA | RISK (from the blocked rows). */
  category: string;
  /** Setups blocked by this single rule. */
  topCount: number;
  /** Setups blocked across ALL rules (the denominator for the share). */
  totalCount: number;
  /** Share of all blocked setups stopped by this rule, 0–100. */
  sharePct: number;
  /** How (if at all) this rule can be relaxed in one click; null = not relaxable. */
  relaxKind: RelaxKind | null;
  /** The FilterConfig key to flip, when the relaxation is a filter toggle. */
  filterKey: keyof BacktestFilterConfig | null;
}

function classifyRelax(reasonCode: string): {
  relaxKind: RelaxKind | null;
  filterKey: keyof BacktestFilterConfig | null;
} {
  if ((RELAXABLE_BOOLEAN_FILTERS as readonly string[]).includes(reasonCode)) {
    return { relaxKind: "DISABLE_FILTER", filterKey: reasonCode as keyof BacktestFilterConfig };
  }
  if (reasonCode === "minimumRiskReward") {
    return { relaxKind: "LOWER_RR", filterKey: "minimumRiskReward" };
  }
  if (reasonCode === "MAX_TRADES_PER_DAY") {
    return { relaxKind: "RAISE_TRADE_CAP", filterKey: null };
  }
  return { relaxKind: null, filterKey: null };
}

/**
 * Roll the blocked-setups array up to its single biggest blocking rule.
 * Returns null when there is nothing blocked. Aggregates by `reasonCode`
 * (falling back to blockedRule / failedCondition for engine rows that carry no
 * code) and reports the winner's share of ALL blocked setups.
 */
export function computeDominantBlocker(
  blocked: BacktestBlockedSetup[],
): DominantBlocker | null {
  const byReason = new Map<string, { count: number; sample: BacktestBlockedSetup }>();
  let total = 0;
  for (const b of blocked) {
    const c = b.count ?? 0;
    if (c <= 0) continue;
    total += c;
    const key = b.reasonCode ?? b.blockedRule ?? b.failedCondition ?? "UNKNOWN";
    const existing = byReason.get(key);
    if (existing) existing.count += c;
    else byReason.set(key, { count: c, sample: b });
  }
  if (total === 0) return null;

  let topKey = "";
  let top: { count: number; sample: BacktestBlockedSetup } | null = null;
  for (const [key, value] of byReason) {
    if (top === null || value.count > top.count) {
      top = value;
      topKey = key;
    }
  }
  if (top === null) return null;

  const { relaxKind, filterKey } = classifyRelax(topKey);
  const label = REASON_LABELS[topKey] ?? top.sample.blockedRule ?? topKey;
  return {
    reasonCode: topKey,
    label,
    category: top.sample.category ?? "FILTER",
    topCount: top.count,
    totalCount: total,
    sharePct: (top.count / total) * 100,
    relaxKind,
    filterKey,
  };
}

/**
 * Should we surface the "likely over-filtered" callout? True when setups WERE
 * blocked and the run produced zero trades, or so few that blocks dwarf them
 * (≤2 trades while blocks outnumber trades by ≥10×).
 */
export function isLikelyOverFiltered(totalTrades: number, totalBlocked: number): boolean {
  if (totalBlocked <= 0) return false;
  if (totalTrades <= 0) return true;
  return totalTrades <= 2 && totalBlocked >= 10 * totalTrades;
}

/** Apply a one-click relaxation of the dominant filter to a filters object. */
export function relaxFilters(
  filters: Required<BacktestFilterConfig>,
  blocker: DominantBlocker,
): Required<BacktestFilterConfig> {
  if (blocker.relaxKind === "DISABLE_FILTER" && blocker.filterKey) {
    return { ...filters, [blocker.filterKey]: false };
  }
  if (blocker.relaxKind === "LOWER_RR") {
    return { ...filters, minimumRiskReward: 0 };
  }
  return filters;
}
