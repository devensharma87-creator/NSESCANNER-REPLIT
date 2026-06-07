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
  SCALE_OUT_T1_FRACTION,
  SCALE_OUT_T2_FRACTION,
  type FilterConfig,
  type FilterKey,
  type StrategyContext,
  type StrategyEntry,
} from "./base";

export interface FilterRejection {
  key: FilterKey;
  failedCondition: string;
  blockedRule: string;
  /**
   * FILTER = the confirmation was evaluated and the setup failed it.
   * DATA   = the confirmation was enabled but could NOT be evaluated because the
   *          required indicator series was unavailable at this bar (insufficient
   *          history). We block instead of silently passing — an enabled filter we
   *          cannot evaluate must never count as a confirmed trade.
   */
  category: "FILTER" | "DATA";
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
          category: "FILTER",
        });
      }
    } else {
      rejections.push({
        key: "vwapFilter",
        failedCondition: "Session VWAP unavailable at this bar (insufficient history)",
        blockedRule: "VWAP filter — data unavailable",
        category: "DATA",
      });
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
          category: "FILTER",
        });
      }
    } else {
      rejections.push({
        key: "emaTrendFilter",
        failedCondition: "EMA20/EMA50 unavailable at this bar (insufficient history)",
        blockedRule: "EMA trend filter — data unavailable",
        category: "DATA",
      });
    }
  }

  // Avoid chop zone --------------------------------------------------------
  if (config.avoidChopZone && !ignoredSet.has("avoidChopZone")) {
    appliedFilters.push(LABEL.avoidChopZone);
    if (ax != null) {
      if (ax < CHOP_ADX_FLOOR) {
        rejections.push({
          key: "avoidChopZone",
          failedCondition: `ADX ${ax.toFixed(1)} below chop floor ${CHOP_ADX_FLOOR}`,
          blockedRule: "Avoid chop-zone filter",
          category: "FILTER",
        });
      }
    } else {
      rejections.push({
        key: "avoidChopZone",
        failedCondition: "ADX unavailable at this bar (insufficient history)",
        blockedRule: "Avoid chop-zone filter — data unavailable",
        category: "DATA",
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
        category: "FILTER",
      });
    }
  }

  // Minimum risk:reward ----------------------------------------------------
  // Measured against the trade's PLANNED BLENDED reward across the runner's
  // 50/50 scale-out (half to Target-1, half to Target-2) — NOT Target-1 alone.
  // Target-1 sits at exactly 1R for every strategy, so a Target-1-only ratio
  // would block every default setup for any threshold above 1.0; the blended
  // reward honestly reflects the position the runner actually manages.
  if (
    config.minimumRiskReward > 0 &&
    !ignoredSet.has("minimumRiskReward")
  ) {
    appliedFilters.push(`${LABEL.minimumRiskReward} ≥ ${config.minimumRiskReward}`);
    const riskDist = Math.abs(entry.entrySpot - entry.stop);
    const rewardToT1 = Math.abs(entry.target1 - entry.entrySpot);
    const rewardToT2 = Math.abs(entry.target2 - entry.entrySpot);
    const blendedReward = SCALE_OUT_T1_FRACTION * rewardToT1 + SCALE_OUT_T2_FRACTION * rewardToT2;
    const rr = riskDist > 0 ? blendedReward / riskDist : 0;
    if (rr < config.minimumRiskReward) {
      rejections.push({
        key: "minimumRiskReward",
        failedCondition: `Planned blended reward:risk ${rr.toFixed(2)} (50% to T1, 50% to T2) below minimum ${config.minimumRiskReward}`,
        blockedRule: "Minimum risk:reward filter",
        category: "FILTER",
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
