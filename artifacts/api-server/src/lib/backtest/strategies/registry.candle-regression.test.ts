import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadHistoricalCandles } from "../candleSource";
import { buildContext } from "./context";
import { getStrategy } from "./registry";
import { runStrategy } from "./runner";
import { DEFAULT_FILTERS, STRATEGY_IDS } from "./base";

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
      }
    }
  });

  it("qualifies a healthy, non-zero number of trades across the whole registry", () => {
    // Observed total against the committed real CSVs ≈ 4590 (6 strategies × 3
    // indices over ~2 years of 15-min candles). Bounds bracket that with wide
    // margin so honest param/filter tweaks don't nag, but a true regression does.
    //
    // Lower bound: the core regression — DEFAULT_FILTERS must never starve the
    // registry toward zero against the real history. 1000 is well below the
    // observed ~4590 yet far above 0, so it flags a severe starvation without
    // being flaky.
    expect(totalTrades).toBeGreaterThan(1000);
    // Upper bound: catch an over-loosening (e.g. a confirmation default flipped
    // off) that lets almost everything through. ~2× the observed count.
    expect(totalTrades).toBeLessThan(9000);
  });

  it("at least one strategy qualifies trades (no whole-strategy starvation)", () => {
    const productive = [...perStrategy.values()].filter((n) => n > 0).length;
    expect(productive).toBeGreaterThan(0);
  });
});
