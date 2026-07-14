/** Backtest Lab V2 — Strategy Research public surface. */
export * from "./base";
export { buildContext } from "./context";
export { applyFilters, filterLabel, type FilterRejection, type FilterResult } from "./filters";
export {
  STRATEGY_REGISTRY,
  getStrategy,
  listStrategies,
} from "./registry";
export {
  runStrategy,
  type RunOptions,
  type StrategyRunResult,
} from "./runner";
export {
  buildComparison,
  MIN_TRADES_TO_RANK,
  type ComparisonOptions,
  type ComparisonUnit,
} from "./comparison";
