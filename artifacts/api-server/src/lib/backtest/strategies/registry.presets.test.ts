import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadHistoricalCandles } from "../candleSource";
import { isSessionValidUtcIso } from "../time";
import { buildContext } from "./context";
import { getStrategy } from "./registry";
import { runStrategy } from "./runner";
import {
  FILTER_PRESETS,
  FILTER_PRESET_ORDER,
  STRATEGY_IDS,
  type FilterPresetId,
} from "./base";
import { MIN_TRADES_TO_RANK } from "./comparison";

/**
 * Regression guard for the Practical / Conservative / Aggressive filter presets
 * (Task #103). The companion registry.candle-regression.test.ts guards the
 * server DEFAULT_FILTERS constant; this test guards the THREE named presets the
 * Backtest Lab UI ships, so a future tweak to a preset that quietly starves a
 * strategy (the original "every strategy shows n/a" bug, one level up) is caught.
 *
 * For each preset it asserts, against the committed real 2-year 15-min CSVs:
 *   1. every one of the six strategies clears a per-strategy trade floor (no
 *      strategy quietly dies under that preset), and
 *   2. every emitted trade's entry AND exit fall strictly within 09:15–15:30 IST
 *      (no off-session trade leaks through any preset path).
 *
 * Skips cleanly (does not fail) when the candle CSVs are absent, mirroring the
 * live-DB regression pattern elsewhere in the api-server suite.
 */

const INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
const TIMEFRAME = "15m";

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

// Observed lowest per-strategy count across all presets is ~93 (RANGE_REVERSAL,
// Conservative). Floor = 25: at/above MIN_TRADES_TO_RANK and far above a
// collapse toward zero, yet ~3.7× below the lowest observed count so honest
// preset tweaks don't nag.
const PER_STRATEGY_MIN_TRADES = 25;

describeCandles("filter presets × real candle CSVs — every preset trades all strategies", () => {
  // preset → strategyId → total trades across the 3 indices
  const perPresetStrategy = new Map<FilterPresetId, Map<string, number>>();
  // preset → list of off-session trade descriptors (must stay empty)
  const offSession = new Map<FilterPresetId, string[]>();

  beforeAll(async () => {
    for (const presetId of FILTER_PRESET_ORDER) {
      perPresetStrategy.set(presetId, new Map());
      offSession.set(presetId, []);
    }

    for (const sym of INDICES) {
      const { candles, available } = await loadHistoricalCandles(sym, null, null);
      expect(available).toBe(true);
      expect(candles.length).toBeGreaterThan(0);
      const ctx = buildContext(sym, candles);
      expect(ctx).not.toBeNull();

      for (const presetId of FILTER_PRESET_ORDER) {
        const preset = FILTER_PRESETS[presetId];
        const byStrategy = perPresetStrategy.get(presetId)!;
        const off = offSession.get(presetId)!;
        for (const id of STRATEGY_IDS) {
          const result = runStrategy(ctx!, getStrategy(id), preset.filters, {
            timeframe: TIMEFRAME,
            maxTradesPerDay: preset.maxTradesPerDay,
            includeCharges: true,
            includeSlippage: true,
          });
          byStrategy.set(id, (byStrategy.get(id) ?? 0) + result.trades.length);
          for (const t of result.trades) {
            if (!isSessionValidUtcIso(t.entryAt) || !isSessionValidUtcIso(t.exitAt)) {
              off.push(`${presetId}/${id}/${sym} entry=${t.entryAt} exit=${t.exitAt}`);
            }
          }
        }
      }
    }
  });

  it("floor sanity: per-strategy floor is at/above the rank-eligibility minimum", () => {
    expect(PER_STRATEGY_MIN_TRADES).toBeGreaterThanOrEqual(MIN_TRADES_TO_RANK);
  });

  for (const presetId of FILTER_PRESET_ORDER) {
    it(`${presetId}: EACH strategy clears the per-strategy floor (no strategy shows n/a)`, () => {
      const byStrategy = perPresetStrategy.get(presetId)!;
      const starved = STRATEGY_IDS.filter(
        (id) => (byStrategy.get(id) ?? 0) < PER_STRATEGY_MIN_TRADES,
      ).map((id) => `${id}=${byStrategy.get(id) ?? 0}`);
      expect(
        starved,
        `Under the ${presetId} preset these strategies fell below the ` +
          `${PER_STRATEGY_MIN_TRADES}-trade floor against the real candle history ` +
          `(would render as n/a in the lab): ${starved.join(", ")}`,
      ).toEqual([]);
    });

    it(`${presetId}: every trade entry & exit is within 09:15–15:30 IST`, () => {
      const off = offSession.get(presetId)!;
      expect(off, `Off-session trades under ${presetId}: ${off.join(" | ")}`).toEqual([]);
    });
  }
});
