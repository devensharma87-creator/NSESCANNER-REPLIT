import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadHistoricalCandles } from "../candleSource";
import { buildContext } from "./context";
import { getStrategy } from "./registry";
import { runStrategy } from "./runner";
import { DEFAULT_FILTERS, STRATEGY_IDS } from "./base";
import { MIN_TRADES_TO_RANK } from "./comparison";

/**
 * Regression guard for the "default filters → 0 trades" class of bug.
 *
 * Task #81 found the default confirmation filters were mis-calibrated so the
 * generic strategy registry qualified ZERO trades against the real 2-year 15-min
 * candle history. That root cause is fixed (the minimum-risk:reward filter now
 * measures the blended 50/50 scale-out reward), but nothing ran the FULL
 * registry against the REAL candle CSVs to catch a regression if a filter
 * default, a strategy's target params, or the runner's scale-out is tweaked
 * again. This integration test is that guard.
 *
 * It mirrors the route's Strategy-Research defaults exactly: 15m timeframe,
 * DEFAULT_FILTERS, maxTradesPerDay=3, charges/slippage OFF.
 *
 * It skips cleanly (does not fail) when the candle CSVs are absent, mirroring
 * the live-DB regression pattern elsewhere in the api-server suite.
 */

const INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

// Mirror the route's Strategy-Research defaults so this guards the real config.
const TIMEFRAME = "15m";
const MAX_TRADES_PER_DAY = 3;

/** Synchronously resolve the candle data dir (mirrors candleSource.resolveDataDir). */
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

const dataDir = resolveDataDir();
const candlesPresent =
  dataDir !== null && INDICES.every((sym) => existsSync(join(dataDir, `${sym}.csv`)));

const describeCandles = candlesPresent ? describe : describe.skip;

describeCandles("registry × real candle CSVs — default filters must qualify trades", () => {
  let totalTrades = 0;
  const perStrategy = new Map<string, number>();
  // Per-(strategy, index) counts, keyed `${strategyId}|${indexSymbol}`.
  const perStrategyIndex = new Map<string, number>();

  beforeAll(async () => {
    for (const sym of INDICES) {
      const { candles, available } = await loadHistoricalCandles(sym, null, null);
      expect(available).toBe(true);
      expect(candles.length).toBeGreaterThan(0);
      const ctx = buildContext(sym, candles);
      expect(ctx).not.toBeNull();

      for (const id of STRATEGY_IDS) {
        const result = runStrategy(ctx!, getStrategy(id), DEFAULT_FILTERS, {
          timeframe: TIMEFRAME,
          maxTradesPerDay: MAX_TRADES_PER_DAY,
          includeCharges: false,
          includeSlippage: false,
        });
        totalTrades += result.trades.length;
        perStrategy.set(id, (perStrategy.get(id) ?? 0) + result.trades.length);
        perStrategyIndex.set(`${id}|${sym}`, result.trades.length);
      }
    }
  });

  it("qualifies a healthy, non-zero number of trades across the whole registry", () => {
    // Observed total against the committed real CSVs ≈ 4680 (6 strategies × 3
    // indices over ~2 years of 15-min candles). Bounds bracket that with wide
    // margin so honest param/filter tweaks don't nag, but a true regression does.
    //
    // Note: RANGE_REVERSAL contributes ~94 (Task #85). It previously fired only
    // ~4 times total because a momentum-breakout gate (close beyond the prior
    // bar's extreme) was grafted onto a counter-trend fade; that gate was removed
    // as structurally incompatible with a mean-reversion play.
    //
    // Lower bound: the core regression — DEFAULT_FILTERS must never starve the
    // registry toward zero against the real history. 1000 is well below the
    // observed ~4680 yet far above 0, so it flags a severe starvation without
    // being flaky.
    expect(totalTrades).toBeGreaterThan(1000);
    // Upper bound: catch an over-loosening (e.g. a confirmation default flipped
    // off) that lets almost everything through. ~2× the observed count.
    expect(totalTrades).toBeLessThan(9000);
  });

  it("EACH strategy qualifies at least the per-strategy floor (no single strategy quietly dies)", () => {
    // Why this exists: the aggregate bound above plus the old "≥1 productive"
    // check could BOTH stay green while one strategy quietly collapsed toward
    // zero — the other five strategies' large counts mask it in the total. That
    // is exactly how RANGE_REVERSAL fired only ~4 times in 2 years without the
    // guard noticing (Task #85). A per-strategy floor catches it immediately.
    //
    // Observed per-strategy counts against the committed real 2y 15-min CSVs
    // (3 indices summed; for future calibration):
    //   ORB_BREAKOUT             1189
    //   VWAP_PULLBACK             773
    //   EMA_TREND_RETEST         1403
    //   FAILED_BREAKOUT_REVERSAL  292
    //   RANGE_REVERSAL             94   ← lowest; was ~4 before the Task #85 fix
    //   COMPRESSION_BREAKOUT      929
    //
    // Floor = 25: comfortably above MIN_TRADES_TO_RANK (10, below which a
    // strategy is ineligible to rank — "effectively dead") and far above the
    // ~4 "quietly dead" range, yet well below the lowest observed count (94 →
    // ~3.7× headroom) so honest param/filter tweaks don't nag. A strategy
    // collapsing toward zero blows straight through it.
    const PER_STRATEGY_MIN_TRADES = 25;
    expect(PER_STRATEGY_MIN_TRADES).toBeGreaterThanOrEqual(MIN_TRADES_TO_RANK);

    const starved = STRATEGY_IDS.filter(
      (id) => (perStrategy.get(id) ?? 0) < PER_STRATEGY_MIN_TRADES,
    ).map((id) => `${id}=${perStrategy.get(id) ?? 0}`);

    expect(
      starved,
      `These strategies fell below the ${PER_STRATEGY_MIN_TRADES}-trade per-strategy floor ` +
        `against the real candle history (a strategy quietly stopped trading): ${starved.join(", ")}`,
    ).toEqual([]);
  });

  it("EACH strategy×index pair clears the per-index floor (no single-index collapse hides in the total)", () => {
    // Why this exists: the per-strategy floor above SUMS each strategy's trades
    // across all three indices before checking the floor. A strategy that quietly
    // dies on ONE index (e.g. SENSEX) but fires normally on the other two still
    // clears the summed floor, so a single-index collapse toward zero slips
    // through unnoticed — the same masking problem the per-strategy floor removed,
    // one level deeper. Asserting a per-(strategy, index) floor closes it.
    //
    // Observed per-(strategy, index) counts against the committed real 2y 15-min
    // CSVs (for future calibration):
    //                            NIFTY  BANKNIFTY  SENSEX
    //   ORB_BREAKOUT               422        377     390
    //   VWAP_PULLBACK              260        270     243
    //   EMA_TREND_RETEST           475        474     454
    //   FAILED_BREAKOUT_REVERSAL   110         83      99
    //   RANGE_REVERSAL              26         29      39   ← lowest pair = 26
    //   COMPRESSION_BREAKOUT       296        308     325
    //
    // Floor = 10: equal to MIN_TRADES_TO_RANK (below which a strategy is
    // ineligible to rank on that index — "effectively dead" there), far above a
    // single-index collapse toward zero, yet ~2.6× below the lowest observed pair
    // (26) so honest per-index param/filter tweaks don't nag. An index dying out
    // for one strategy blows straight through it and is named in the failure.
    const PER_STRATEGY_INDEX_MIN_TRADES = 10;
    expect(PER_STRATEGY_INDEX_MIN_TRADES).toBeGreaterThanOrEqual(MIN_TRADES_TO_RANK);

    const starved: string[] = [];
    for (const id of STRATEGY_IDS) {
      for (const sym of INDICES) {
        const n = perStrategyIndex.get(`${id}|${sym}`) ?? 0;
        if (n < PER_STRATEGY_INDEX_MIN_TRADES) starved.push(`${id}×${sym}=${n}`);
      }
    }

    expect(
      starved,
      `These strategy×index pairs fell below the ${PER_STRATEGY_INDEX_MIN_TRADES}-trade per-index floor ` +
        `against the real candle history (a strategy quietly stopped trading on one index): ${starved.join(", ")}`,
    ).toEqual([]);
  });
});
