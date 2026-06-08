/**
 * Backtest adapter for owner-defined custom strategies. Turns a declarative
 * `CustomStrategySpec` into a `StrategyModule` the Backtest Lab runner can drive
 * on the REAL 2-year spot candles — using the SAME context-agnostic evaluator
 * the live engine uses, so a custom strategy behaves identically on both
 * surfaces.
 *
 * Honesty contract is inherited from base.ts: this module reads only causal
 * series (index ≤ i), never fabricates data, and a null/NaN feature simply makes
 * the relevant condition fail.
 */
import type { BacktestStrategyMetaOut } from "../types";
import {
  evaluateCustomSpec,
  type CustomStrategySpec,
  type FeatureSnapshot,
} from "../../strategies/customSpec";
import {
  paramNum,
  type StrategyContext,
  type StrategyEntry,
  type StrategyModule,
  type StrategyParams,
} from "./base";

/** Project a backtest context at bar `i` into the common feature snapshot. */
export function featuresFromBacktestContext(ctx: StrategyContext, i: number): FeatureSnapshot {
  return {
    close: ctx.closes[i] ?? null,
    ema9: ctx.ema9[i] ?? null,
    ema20: ctx.ema20[i] ?? null,
    ema50: ctx.ema50[i] ?? null,
    rsi14: ctx.rsi14[i] ?? null,
    atr14: ctx.atr14[i] ?? null,
    // Equal-weighted session-mean is the honest VWAP substitute (no historical volume).
    vwap: ctx.sessionMean[i] ?? null,
  };
}

export function customStrategyMeta(spec: CustomStrategySpec): BacktestStrategyMetaOut {
  const sides: string[] = [];
  if (spec.bull.length > 0) sides.push("long");
  if (spec.bear.length > 0) sides.push("short");
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    bestCondition: spec.description || "Owner-defined conditions.",
    suitableIndices: ["NIFTY", "BANKNIFTY", "SENSEX"],
    recommendedTimeframes: ["15m"],
    riskLevel: "Custom",
    description:
      (spec.description ? spec.description + " " : "") +
      `Custom strategy (${sides.join(" / ") || "no side"}). Defined-risk: stop = ${spec.params.stopAtrMult}×ATR, targets ${spec.params.target1R}R / ${spec.params.target2R}R.`,
    ignoredFilters: [],
    ignoredFiltersRationale: "",
    defaultParams: {
      stopAtrMult: spec.params.stopAtrMult,
      target1R: spec.params.target1R,
      target2R: spec.params.target2R,
    },
  };
}

export function customStrategyModule(spec: CustomStrategySpec): StrategyModule {
  return {
    meta: customStrategyMeta(spec),
    evaluate(ctx: StrategyContext, i: number, params: StrategyParams): StrategyEntry | null {
      const effSpec: CustomStrategySpec = {
        ...spec,
        params: {
          stopAtrMult: paramNum(params, "stopAtrMult", spec.params.stopAtrMult),
          target1R: paramNum(params, "target1R", spec.params.target1R),
          target2R: paramNum(params, "target2R", spec.params.target2R),
        },
      };
      const f = featuresFromBacktestContext(ctx, i);
      const r = evaluateCustomSpec(f, effSpec);
      if (!r) return null;
      return {
        direction: r.direction,
        optionType: r.direction === "BULL" ? "CALL" : "PUT",
        entrySpot: r.entrySpot,
        stop: r.stop,
        target1: r.target1,
        target2: r.target2,
        confidence: r.confidence,
        entryReason: `${spec.name}: ${r.passed.join(" & ")}`,
        passedConditions: r.passed,
        failedConditions: [],
        warnings: [],
      };
    },
  };
}
