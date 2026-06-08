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
import { projectFeatureSeries } from "../../strategies/customFeatures";
import { type CustomStrategySpec } from "../../strategies/customSpec";

interface RawCandles {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  vwap: (number | null)[];
  atr14: (number | null)[];
  istMinute: number[];
}

// Deterministic, oscillating SPOT candles so EMA/VWAP/Fib blocks all get
// exercised across the window. This is the SINGLE source of candle data both
// projection surfaces consume in the cross-surface test below.
function makeRaw(n = 200): RawCandles {
  const close: number[] = [];
  for (let i = 0; i < n; i++) close.push(100 + 10 * Math.sin(i / 6) + i * 0.05);
  return {
    open: close.map((c, i) => (i === 0 ? c : close[i - 1]!)),
    high: close.map((c) => c + 1.2),
    low: close.map((c) => c - 1.2),
    close,
    vwap: close.map((c, i) => (c + (close[i - 1] ?? c)) / 2),
    atr14: close.map(() => 2),
    istMinute: close.map((_, i) => 555 + (i % 25) * 15), // 09:15 onward, 25 bars/day
  };
}

// Build a StrategyContext (backtest surface) from raw candles.
function makeContext(n = 200): StrategyContext {
  const raw = makeRaw(n);
  return {
    indexSymbol: "NIFTY",
    cfg: { expiryWeekday: 2, expiryCadence: "weekly", strikeStep: 50 },
    candles: [],
    closes: raw.close,
    highs: raw.high,
    lows: raw.low,
    opens: raw.open,
    ema9: [],
    ema20: [],
    ema50: [],
    rsi14: [],
    atr14: raw.atr14,
    adx14: [],
    sessionMean: raw.vwap,
    istMinute: raw.istMinute,
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

// An SMC-only spec: every block family that the shared engine surfaces, so the
// cross-surface parity check actually exercises the SMC math (not just EMA/VWAP).
function smcSpec(): CustomStrategySpec {
  return {
    version: 2,
    id: "CUSTOM_parity_smc",
    name: "Parity SMC",
    category: "Test",
    description: "",
    direction: "BOTH",
    bull: {
      market: { logic: "AND", blocks: [] },
      setup: {
        logic: "OR",
        blocks: [
          { type: "bos", dir: "up" },
          { type: "choch", dir: "up" },
          { type: "fvg", side: "bull", mode: "present" },
          { type: "order_block", side: "demand", mode: "present" },
          { type: "liquidity_sweep", side: "buy" },
          { type: "displacement", dir: "up" },
        ],
      },
    },
    bear: {
      market: { logic: "AND", blocks: [] },
      setup: {
        logic: "OR",
        blocks: [
          { type: "bos", dir: "down" },
          { type: "choch", dir: "down" },
          { type: "fvg", side: "bear", mode: "present" },
          { type: "order_block", side: "supply", mode: "present" },
          { type: "liquidity_sweep", side: "sell" },
          { type: "displacement", dir: "down" },
        ],
      },
    },
    execution: { stop: { type: "smc", source: "swing", bufferAtrMult: 0.5 }, target1R: 1, target2R: 2 },
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

  // The stronger guarantee: feed the SAME candles into BOTH projection paths —
  // the live path (`projectFeatureSeries`, exactly the call optionSignals makes
  // when it builds `customFeatureSeries`) AND the backtest path
  // (`featureSeriesFromBacktestContext`). The two FeatureSeries must be deeply
  // equal, and a per-bar `evaluateSpecAt` over each must produce identical
  // results. This proves the cross-surface invariant directly, not merely that
  // the backtest adapter mirrors a direct evaluator call on its own series.
  it("live and backtest projection paths produce an identical FeatureSeries and signals on the same candles", () => {
    const raw = makeRaw();

    // Live surface: the exact shape optionSignals.ts passes to projectFeatureSeries.
    const liveSeries = projectFeatureSeries({
      open: raw.open,
      high: raw.high,
      low: raw.low,
      close: raw.close,
      vwap: raw.vwap,
      atr14: raw.atr14,
      istMinute: raw.istMinute,
    });

    // Backtest surface: built from a StrategyContext over the same candles
    // (sessionMean is the labeled VWAP substitute === raw.vwap here).
    const ctx = makeContext();
    const backtestSeries = featureSeriesFromBacktestContext(ctx);

    // Same candles in ⇒ byte-identical FeatureSeries out.
    expect(backtestSeries).toEqual(liveSeries);

    // The SMC arrays are part of that deep-equal, but assert them explicitly so a
    // regression in the shared SMC projection can't hide behind the EMA/VWAP fields.
    expect(backtestSeries.smc).toEqual(liveSeries.smc);

    // And therefore identical per-bar evaluation on every bar.
    const spec = trendSpec();
    let fires = 0;
    for (let i = 0; i < raw.close.length; i++) {
      const live = evaluateSpecAt(liveSeries, i, spec);
      const back = evaluateSpecAt(backtestSeries, i, spec);
      expect(back).toEqual(live);
      if (live.fired) fires++;
    }
    expect(fires).toBeGreaterThan(0);
  });

  // The same guarantee, but driven entirely by SMC blocks + an SMC-anchored stop,
  // so the shared SMC engine is the thing under cross-surface parity.
  it("SMC blocks + smc stop evaluate identically across live and backtest surfaces", () => {
    const raw = makeRaw();
    const liveSeries = projectFeatureSeries({
      open: raw.open,
      high: raw.high,
      low: raw.low,
      close: raw.close,
      vwap: raw.vwap,
      atr14: raw.atr14,
      istMinute: raw.istMinute,
    });
    const backtestSeries = featureSeriesFromBacktestContext(makeContext());

    // The synthetic oscillation must actually print structure — otherwise an
    // all-quiet SMC series would make this parity check vacuous.
    const hasStructure = liveSeries.smc.some(
      (b) => b.structDir !== 0 || b.bosUp || b.bosDn || b.chochUp || b.chochDn,
    );
    expect(hasStructure).toBe(true);

    const spec = smcSpec();
    for (let i = 0; i < raw.close.length; i++) {
      expect(evaluateSpecAt(backtestSeries, i, spec)).toEqual(evaluateSpecAt(liveSeries, i, spec));
    }
  });
});
