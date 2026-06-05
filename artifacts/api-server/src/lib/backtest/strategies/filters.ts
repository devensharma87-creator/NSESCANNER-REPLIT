/**
 * Backtest Lab V2 — confirmation filters applied AFTER a strategy emits a setup.
 *
 * Honesty: filters that depend on option-chain / option-spread / option-volume
 * data are AUTO-DISABLED in the backtest (we have no such history) and reported
 * as auto-disabled — they NEVER silently block or fabricate. A strategy can also
 * declare filters it ignores by design (e.g. range plays ignore VWAP/EMA-trend).
 */

import {
  CHOP_ADX_FLOOR,
  LAST_15_MIN,
  OPTION_DEPENDENT_FILTERS,
  type FilterConfig,
  type FilterKey,
  type StrategyContext,
  type StrategyEntry,
} from "./base";

export interface FilterRejection {
  key: FilterKey;
  failedCondition: string;
  blockedRule: string;
}

export interface FilterResult {
  ok: boolean;
  rejections: FilterRejection[];
  /** Human-readable list of the filters that were actually evaluated. */
  appliedFilters: string[];
  /** Option/volume/chain filters that were auto-disabled (no historical data). */
  autoDisabled: FilterKey[];
}

const LABEL: Record<FilterKey, string> = {
  vwapFilter: "VWAP Filter",
  emaTrendFilter: "EMA Trend Filter",
  optionChainConfirmation: "Option Chain Confirmation",
  avoidChopZone: "Avoid Chop Zone",
  avoidLast15Minutes: "Avoid Last 15 Minutes",
  avoidWideSpread: "Avoid Wide Spread Options",
  avoidLowVolume: "Avoid Low Volume Options",
  minimumRiskReward: "Minimum Risk:Reward",
};

/**
 * Evaluate the confirmation filters for one candidate entry.
 * `ignored` are filters the strategy opts out of by design.
 */
export function applyFilters(
  ctx: StrategyContext,
  i: number,
  entry: StrategyEntry,
  config: FilterConfig,
  ignored: FilterKey[],
): FilterResult {
  const rejections: FilterRejection[] = [];
  const appliedFilters: string[] = [];
  const autoDisabled: FilterKey[] = [];
  const ignoredSet = new Set<FilterKey>(ignored);

  // Option/volume/chain filters: auto-disabled, recorded, never block.
  for (const k of OPTION_DEPENDENT_FILTERS) {
    if (config[k]) autoDisabled.push(k);
  }

  const isBull = entry.direction === "BULL";
  const sm = ctx.sessionMean[i];
  const e20 = ctx.ema20[i];
  const e50 = ctx.ema50[i];
  const ax = ctx.adx14[i];

  // VWAP filter ------------------------------------------------------------
  if (config.vwapFilter && !ignoredSet.has("vwapFilter")) {
    appliedFilters.push(LABEL.vwapFilter);
    if (Number.isFinite(sm)) {
      const ok = isBull ? entry.entrySpot >= sm : entry.entrySpot <= sm;
      if (!ok) {
        rejections.push({
          key: "vwapFilter",
          failedCondition: isBull
            ? "Price not above session VWAP at entry"
            : "Price not below session VWAP at entry",
          blockedRule: "VWAP confirmation filter",
        });
      }
    }
  }

  // EMA trend filter -------------------------------------------------------
  if (config.emaTrendFilter && !ignoredSet.has("emaTrendFilter")) {
    appliedFilters.push(LABEL.emaTrendFilter);
    if (e20 != null && e50 != null) {
      const ok = isBull ? e20 > e50 : e20 < e50;
      if (!ok) {
        rejections.push({
          key: "emaTrendFilter",
          failedCondition: isBull ? "EMA20 not above EMA50" : "EMA20 not below EMA50",
          blockedRule: "EMA trend confirmation filter",
        });
      }
    }
  }

  // Avoid chop zone --------------------------------------------------------
  if (config.avoidChopZone && !ignoredSet.has("avoidChopZone")) {
    appliedFilters.push(LABEL.avoidChopZone);
    if (ax != null && ax < CHOP_ADX_FLOOR) {
      rejections.push({
        key: "avoidChopZone",
        failedCondition: `ADX ${ax.toFixed(1)} below chop floor ${CHOP_ADX_FLOOR}`,
        blockedRule: "Avoid chop-zone filter",
      });
    }
  }

  // Avoid last 15 minutes --------------------------------------------------
  if (config.avoidLast15Minutes && !ignoredSet.has("avoidLast15Minutes")) {
    appliedFilters.push(LABEL.avoidLast15Minutes);
    if (ctx.istMinute[i]! >= LAST_15_MIN) {
      rejections.push({
        key: "avoidLast15Minutes",
        failedCondition: "Entry inside the final 15 minutes of the session",
        blockedRule: "Avoid last-15-minutes filter",
      });
    }
  }

  // Minimum risk:reward ----------------------------------------------------
  if (
    config.minimumRiskReward > 0 &&
    !ignoredSet.has("minimumRiskReward")
  ) {
    appliedFilters.push(`${LABEL.minimumRiskReward} ≥ ${config.minimumRiskReward}`);
    const riskDist = Math.abs(entry.entrySpot - entry.stop);
    const rewardDist = Math.abs(entry.target1 - entry.entrySpot);
    const rr = riskDist > 0 ? rewardDist / riskDist : 0;
    if (rr < config.minimumRiskReward) {
      rejections.push({
        key: "minimumRiskReward",
        failedCondition: `Reward:risk ${rr.toFixed(2)} below minimum ${config.minimumRiskReward}`,
        blockedRule: "Minimum risk:reward filter",
      });
    }
  }

  return {
    ok: rejections.length === 0,
    rejections,
    appliedFilters,
    autoDisabled,
  };
}

export function filterLabel(k: FilterKey): string {
  return LABEL[k];
}
