/** Strategy registry — the single source of truth for available strategy modules. */
import type { StrategyId, StrategyModule } from "./base";
import { orbBreakout } from "./orb-breakout";
import { vwapPullback } from "./vwap-pullback";
import { emaTrendRetest } from "./ema-trend-retest";
import { failedBreakoutReversal } from "./failed-breakout-reversal";
import { rangeReversal } from "./range-reversal";
import { compressionBreakout } from "./compression-breakout";

export const STRATEGY_REGISTRY: Record<StrategyId, StrategyModule> = {
  ORB_BREAKOUT: orbBreakout,
  VWAP_PULLBACK: vwapPullback,
  EMA_TREND_RETEST: emaTrendRetest,
  FAILED_BREAKOUT_REVERSAL: failedBreakoutReversal,
  RANGE_REVERSAL: rangeReversal,
  COMPRESSION_BREAKOUT: compressionBreakout,
};

export function getStrategy(id: StrategyId): StrategyModule {
  return STRATEGY_REGISTRY[id];
}

export function listStrategies(): StrategyModule[] {
  return Object.values(STRATEGY_REGISTRY);
}
