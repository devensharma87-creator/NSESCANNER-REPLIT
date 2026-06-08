/**
 * LIVE ↔ BACKTEST PARITY.
 *
 * Both surfaces interpret a custom spec through the SAME shared evaluator
 * (`evaluateSpecAt`) over a `FeatureSeries`. This test proves the backtest
 * adapter adds no divergence: for every bar, the module's `evaluate` output
 * equals a direct `evaluateSpecAt` call on the identical series the adapter
 * builds. Given identical feature inputs, the two surfaces are byte-identical.
 */
import { describe, it, expect } from "vitest";
import { ema, rsi } from "@workspace/indicators";
import {
  customStrategyModule,
  featureSeriesFromBacktestContext,
} from "./custom";
import type { StrategyContext } from "./base";
import { evaluateSpecAt } from "../../strategies/customEval";
import { type CustomStrategySpec } from "../../strategies/customSpec";

// Build a deterministic, oscillating SPOT-candle context so EMA/VWAP/Fib blocks
// all get exercised across the window.
function makeContext(n = 200): StrategyContext {
  const closes: number[] = [];
  for (let i = 0; i < n; i++) {
    closes.push(100 + 10 * Math.sin(i / 6) + i * 0.05);
  }
  const highs = closes.map((c) => c + 1.2);
  const lows = closes.map((c) => c - 1.2);
  const opens = closes.map((c, i) => (i === 0 ? c : closes[i - 1]!));
  const sessionMean = closes.map((c, i) => (c + (closes[i - 1] ?? c)) / 2);
  const atr14 = closes.map(() => 2);
  const istMinute = closes.map((_, i) => 555 + (i % 25) * 15); // 09:15 onward, 25 bars/day
  return {
    indexSymbol: "NIFTY",
    cfg: { expiryWeekday: 2, expiryCadence: "weekly", strikeStep: 50 },
    candles: [],
    closes,
    highs,
    lows,
    opens,
    ema9: [],
    ema20: [],
    ema50: [],
    rsi14: [],
    atr14,
    adx14: [],
    sessionMean,
    istMinute,
    barInSession: [],
    isLastBarOfDay: [],
    orHigh: [],
    orLow: [],
    dayHighSoFar: [],
    dayLowSoFar: [],
    prevDayHigh: [],
    prevDayLow: [],
    prevDayClose: [],
    cprHigh: [],
    cprLow: [],
  } as unknown as StrategyContext;
}

function trendSpec(): CustomStrategySpec {
  return {
    version: 2,
    id: "CUSTOM_parity",
    name: "Parity",
    category: "Test",
    description: "",
    direction: "BOTH",
    bull: {
      market: { logic: "AND", blocks: [{ type: "ema_stack", order: "bull" }] },
      setup: {
        logic: "OR",
        blocks: [
          { type: "vwap_cross", dir: "reclaim" },
          { type: "price_vs_ema", ema: "ema20", cmp: "above" },
        ],
      },
    },
    bear: {
      market: { logic: "AND", blocks: [{ type: "ema_stack", order: "bear" }] },
      setup: { logic: "AND", blocks: [{ type: "price_vs_vwap", cmp: "below" }] },
    },
    execution: { stop: { type: "atr", atrMult: 1.5 }, target1R: 1, target2R: 2 },
    baseConfidence: 60,
  };
}

describe("custom strategy live↔backtest parity", () => {
  it("the projector recomputes EMA/RSI via the shared lib", () => {
    const ctx = makeContext();
    const s = featureSeriesFromBacktestContext(ctx);
    expect(s.ema9).toEqual(ema(ctx.closes, 9));
    expect(s.ema20).toEqual(ema(ctx.closes, 20));
    expect(s.ema50).toEqual(ema(ctx.closes, 50));
    expect(s.rsi14).toEqual(rsi(ctx.closes, 14));
  });

  it("the backtest adapter yields exactly what a direct evaluateSpecAt yields", () => {
    const ctx = makeContext();
    const spec = trendSpec();
    const mod = customStrategyModule(spec);
    const series = featureSeriesFromBacktestContext(ctx);

    let fires = 0;
    for (let i = 0; i < ctx.closes.length; i++) {
      const adapter = mod.evaluate(ctx, i, { stopAtrMult: 1.5, target1R: 1, target2R: 2 });
      const direct = evaluateSpecAt(series, i, spec);

      if (!direct.fired) {
        expect(adapter).toBeNull();
        continue;
      }
      fires++;
      expect(adapter).not.toBeNull();
      expect(adapter!.direction).toBe(direct.side);
      expect(adapter!.entrySpot).toBe(direct.entry);
      expect(adapter!.stop).toBe(direct.stop);
      expect(adapter!.target1).toBe(direct.target1);
      expect(adapter!.target2).toBe(direct.target2);
      expect(adapter!.confidence).toBe(direct.confidence);
      expect(adapter!.passedConditions).toEqual(direct.passedLabels);
    }
    // sanity: the synthetic series actually triggers entries (parity is meaningful)
    expect(fires).toBeGreaterThan(0);
  });
});
