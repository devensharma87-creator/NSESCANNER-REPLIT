import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadHistoricalCandles } from "../candleSource";
import type { BacktestTradeOut } from "../types";
import { buildComparison, type ComparisonUnit } from "./comparison";
import { buildContext } from "./context";
import { getStrategy } from "./registry";
import { runStrategy } from "./runner";
import { DEFAULT_FILTERS } from "./base";

/**
 * End-to-end guard for the per-strategy `ignoredFilters` honesty column.
 *
 * Task #96 unit-tested the pure config-summary helper in isolation, but nothing
 * proved that a strategy module's `meta.ignoredFilters` actually FLOWS through a
 * route-shaped `ComparisonUnit` into `buildComparison`'s emitted
 * `BacktestComparisonRow` rows AND `BacktestStrategyAggregate` aggregates. The
 * route builds ComparisonUnits at three call sites (`runStrategyResearch` and
 * the COMPARE_OFFICIAL_VS_STRATEGIES branch's official + strategy units); a
 * regression in any of them that dropped `ignoredFilters` would silently revert
 * the honesty fix without failing a single test. This test mirrors that exact
 * construction sourcing from the REAL strategy registry, so the contract is
 * locked from strategy metadata all the way to the comparison output.
 *
 * The Official Engine is a real engine, not a hand-tuned strategy, so it ignores
 * NO confirmation filters by design — its units must always carry `[]`.
 */

const OFFICIAL_STRATEGY_ID = "OFFICIAL_ENGINE";
const OFFICIAL_STRATEGY_NAME = "Official F&O Engine";
const TIMEFRAME = "15m";

/** Mirror the route's strategy ComparisonUnit build, sourcing real module meta. */
function strategyUnit(
  id: string,
  indexSymbol: string,
  trades: BacktestTradeOut[],
): ComparisonUnit {
  const module = getStrategy(id as Parameters<typeof getStrategy>[0]);
  return {
    strategyId: module.meta.id,
    strategyName: module.meta.name,
    indexSymbol,
    timeframe: TIMEFRAME,
    // The line under test — identical to routes/backtest.ts.
    ignoredFilters: [...module.meta.ignoredFilters],
    trades,
    blocked: [],
  };
}

/** Mirror the route's Official-Engine ComparisonUnit build (no ignored filters). */
function officialUnit(indexSymbol: string): ComparisonUnit {
  return {
    strategyId: OFFICIAL_STRATEGY_ID,
    strategyName: OFFICIAL_STRATEGY_NAME,
    indexSymbol,
    timeframe: TIMEFRAME,
    ignoredFilters: [],
    trades: [],
    blocked: [],
  };
}

const OPTS = { includeCharges: false, includeSlippage: false } as const;

describe("ignoredFilters flow: real strategy modules → buildComparison rows + aggregates", () => {
  // The two strategies named in the task: a 3-filter and a 1-filter case.
  const RANGE = getStrategy("RANGE_REVERSAL");
  const FAILED = getStrategy("FAILED_BREAKOUT_REVERSAL");

  it("emits each strategy's real ignoredFilters onto its comparison rows", () => {
    const units = [
      strategyUnit("RANGE_REVERSAL", "NIFTY", []),
      strategyUnit("FAILED_BREAKOUT_REVERSAL", "NIFTY", []),
      officialUnit("NIFTY"),
    ];
    const { rows } = buildComparison(units, OPTS);

    const rangeRow = rows.find((r) => r.strategyId === "RANGE_REVERSAL");
    const failedRow = rows.find((r) => r.strategyId === "FAILED_BREAKOUT_REVERSAL");
    const officialRow = rows.find((r) => r.strategyId === OFFICIAL_STRATEGY_ID);

    expect(rangeRow).toBeDefined();
    expect(failedRow).toBeDefined();
    expect(officialRow).toBeDefined();

    // Exactly the strategy's declared ignored filters — sourced from real meta,
    // not hard-coded, so this stays correct if a strategy revises its list.
    expect(rangeRow!.ignoredFilters).toEqual(RANGE.meta.ignoredFilters);
    expect(failedRow!.ignoredFilters).toEqual(FAILED.meta.ignoredFilters);
    // Sanity: these strategies genuinely ignore filters (the fix is meaningful).
    expect(rangeRow!.ignoredFilters.length).toBeGreaterThan(0);
    expect(failedRow!.ignoredFilters.length).toBeGreaterThan(0);
    // The real engine ignores nothing.
    expect(officialRow!.ignoredFilters).toEqual([]);
  });

  it("carries each strategy's real ignoredFilters onto the per-strategy aggregates", () => {
    const units = [
      strategyUnit("RANGE_REVERSAL", "NIFTY", []),
      strategyUnit("RANGE_REVERSAL", "BANKNIFTY", []),
      strategyUnit("FAILED_BREAKOUT_REVERSAL", "NIFTY", []),
      officialUnit("NIFTY"),
      officialUnit("BANKNIFTY"),
    ];
    const { byStrategy } = buildComparison(units, OPTS);

    const rangeAgg = byStrategy.find((a) => a.strategyId === "RANGE_REVERSAL");
    const failedAgg = byStrategy.find((a) => a.strategyId === "FAILED_BREAKOUT_REVERSAL");
    const officialAgg = byStrategy.find((a) => a.strategyId === OFFICIAL_STRATEGY_ID);

    expect(rangeAgg).toBeDefined();
    expect(failedAgg).toBeDefined();
    expect(officialAgg).toBeDefined();

    // Aggregates collapse a strategy across indices but must preserve the same
    // ignoredFilters (they are a property of the strategy, not the index).
    expect(rangeAgg!.ignoredFilters).toEqual(RANGE.meta.ignoredFilters);
    expect(failedAgg!.ignoredFilters).toEqual(FAILED.meta.ignoredFilters);
    expect(officialAgg!.ignoredFilters).toEqual([]);
  });

  it("does not mutate the strategy module's meta.ignoredFilters array", () => {
    const before = [...RANGE.meta.ignoredFilters];
    const { rows, byStrategy } = buildComparison(
      [strategyUnit("RANGE_REVERSAL", "NIFTY", [])],
      OPTS,
    );
    // Mutate the emitted copies; the source-of-truth meta must be untouched.
    rows[0]!.ignoredFilters.push("__leak__");
    byStrategy[0]!.ignoredFilters.push("__leak__");
    expect(RANGE.meta.ignoredFilters).toEqual(before);
  });
});

/**
 * The same contract, but with trades produced by the REAL backtest engine over
 * the committed real candle CSVs. Skips cleanly (does not fail) when the candle
 * data is absent, mirroring the live-DB / candle-regression pattern in this suite.
 */
function resolveDataDir(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "tools", "fno-backtester", "data");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
const dataDir = resolveDataDir();
const candlesPresent =
  dataDir !== null && INDICES.every((sym) => existsSync(join(dataDir, `${sym}.csv`)));
const describeCandles = candlesPresent ? describe : describe.skip;

describeCandles("ignoredFilters flow with REAL engine-produced trades", () => {
  it("preserves ignoredFilters end-to-end on rows + aggregates from real trades", async () => {
    const STRATS = ["RANGE_REVERSAL", "FAILED_BREAKOUT_REVERSAL"] as const;
    const units: ComparisonUnit[] = [];
    for (const sym of INDICES) {
      const { candles, available } = await loadHistoricalCandles(sym, null, null);
      expect(available).toBe(true);
      const ctx = buildContext(sym, candles);
      expect(ctx).not.toBeNull();
      for (const id of STRATS) {
        const result = runStrategy(ctx!, getStrategy(id), DEFAULT_FILTERS, {
          timeframe: TIMEFRAME,
          maxTradesPerDay: 3,
          includeCharges: false,
          includeSlippage: false,
        });
        units.push(strategyUnit(id, sym, result.trades));
      }
      units.push(officialUnit(sym));
    }

    const { rows, byStrategy } = buildComparison(units, OPTS);

    // Every emitted row carries exactly its strategy's declared ignored filters.
    for (const row of rows) {
      const expected =
        row.strategyId === OFFICIAL_STRATEGY_ID
          ? []
          : getStrategy(row.strategyId as Parameters<typeof getStrategy>[0]).meta.ignoredFilters;
      expect(row.ignoredFilters).toEqual(expected);
    }
    for (const agg of byStrategy) {
      const expected =
        agg.strategyId === OFFICIAL_STRATEGY_ID
          ? []
          : getStrategy(agg.strategyId as Parameters<typeof getStrategy>[0]).meta.ignoredFilters;
      expect(agg.ignoredFilters).toEqual(expected);
    }

    // The real engine actually produced rows for these strategies (not a no-op).
    expect(rows.some((r) => r.strategyId === "RANGE_REVERSAL" && r.totalTrades > 0)).toBe(true);
    expect(rows.some((r) => r.strategyId === "FAILED_BREAKOUT_REVERSAL" && r.totalTrades > 0)).toBe(
      true,
    );
  });
});
