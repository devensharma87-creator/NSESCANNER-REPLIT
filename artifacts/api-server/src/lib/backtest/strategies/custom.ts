/**
 * Backtest adapter for owner-defined custom strategies. Turns a declarative v2
 * `CustomStrategySpec` into a `StrategyModule` the Backtest Lab runner can drive
 * on the REAL 2-year spot candles — using the SAME shared evaluator
 * (`evaluateSpecAt`) the live engine uses, so a custom strategy behaves
 * identically on both surfaces (locked by a parity test).
 *
 * Honesty contract is inherited from base.ts: this module reads only causal
 * series (index ≤ i), never fabricates data, and a null/NaN feature simply makes
 * the relevant block fail. VWAP here is the labeled equal-weighted session-mean
 * substitute (historical index candles carry no volume).
 */
import type { BacktestStrategyMetaOut } from "../types";
import {
  type CustomStrategySpec,
  type ExecutionConfig,
  sideIsEmpty,
} from "../../strategies/customSpec";
import { projectFeatureSeries, type FeatureSeries } from "../../strategies/customFeatures";
import { evaluateSpecAt } from "../../strategies/customEval";
import {
  paramNum,
  type StrategyContext,
  type StrategyEntry,
  type StrategyModule,
  type StrategyParams,
} from "./base";

/**
 * Build the shared FeatureSeries from a backtest context. EMA/RSI are recomputed
 * from closes inside the projector (the parity contract); VWAP uses the honest
 * session-mean substitute and ATR is the backtest's own ATR(14).
 */
export function featureSeriesFromBacktestContext(ctx: StrategyContext): FeatureSeries {
  return projectFeatureSeries({
    open: ctx.opens,
    high: ctx.highs,
    low: ctx.lows,
    close: ctx.closes,
    vwap: ctx.sessionMean,
    atr14: ctx.atr14,
    istMinute: ctx.istMinute,
  });
}

// One FeatureSeries per context object (it is independent of strategy params).
const seriesCache = new WeakMap<StrategyContext, FeatureSeries>();
function seriesFor(ctx: StrategyContext): FeatureSeries {
  let s = seriesCache.get(ctx);
  if (!s) {
    s = featureSeriesFromBacktestContext(ctx);
    seriesCache.set(ctx, s);
  }
  return s;
}

function sidesOf(spec: CustomStrategySpec): string[] {
  const sides: string[] = [];
  if (!sideIsEmpty(spec.bull) && spec.direction !== "PUT_ONLY") sides.push("long");
  if (!sideIsEmpty(spec.bear) && spec.direction !== "CALL_ONLY") sides.push("short");
  return sides;
}

function stopDescription(exec: ExecutionConfig): string {
  const s = exec.stop;
  if (s.type === "atr") return `stop = ${s.atrMult}×ATR`;
  if (s.type === "swing") return `stop = swing(${s.swingSpan}) ± ${s.bufferAtrMult}×ATR`;
  return `stop = SMC ${s.source} ± ${s.bufferAtrMult}×ATR`;
}

export function customStrategyMeta(spec: CustomStrategySpec): BacktestStrategyMetaOut {
  const sides = sidesOf(spec);
  const defaultParams: Record<string, number> = {
    target1R: spec.execution.target1R,
    target2R: spec.execution.target2R,
  };
  if (spec.execution.stop.type === "atr") defaultParams["stopAtrMult"] = spec.execution.stop.atrMult;
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
      `Custom v${spec.version} strategy (${sides.join(" / ") || "no side"}). Defined-risk: ${stopDescription(
        spec.execution,
      )}, targets ${spec.execution.target1R}R / ${spec.execution.target2R}R.`,
    ignoredFilters: [],
    ignoredFiltersRationale: "",
    defaultParams,
  };
}

export function customStrategyModule(spec: CustomStrategySpec): StrategyModule {
  return {
    meta: customStrategyMeta(spec),
    evaluate(ctx: StrategyContext, i: number, params: StrategyParams): StrategyEntry | null {
      const exec: ExecutionConfig = {
        ...spec.execution,
        target1R: paramNum(params, "target1R", spec.execution.target1R),
        target2R: paramNum(params, "target2R", spec.execution.target2R),
        stop:
          spec.execution.stop.type === "atr"
            ? { type: "atr", atrMult: paramNum(params, "stopAtrMult", spec.execution.stop.atrMult) }
            : spec.execution.stop,
      };
      const effSpec: CustomStrategySpec = { ...spec, execution: exec };
      const res = evaluateSpecAt(seriesFor(ctx), i, effSpec);
      if (!res.fired || res.side == null || res.entry == null || res.stop == null || res.target1 == null || res.target2 == null) {
        return null;
      }
      const failed = res.reasons.filter((r) => !r.passed).map((r) => r.label);
      return {
        direction: res.side,
        optionType: res.side === "BULL" ? "CALL" : "PUT",
        entrySpot: res.entry,
        stop: res.stop,
        target1: res.target1,
        target2: res.target2,
        confidence: res.confidence ?? spec.baseConfidence,
        entryReason: `${spec.name}: ${res.passedLabels.join(" & ") || "rules met"}`,
        passedConditions: res.passedLabels,
        failedConditions: failed,
        warnings: [],
      };
    },
  };
}
