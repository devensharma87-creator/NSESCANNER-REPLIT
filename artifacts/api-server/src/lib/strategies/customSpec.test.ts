/**
 * Honesty/safety unit tests for the context-agnostic custom-strategy evaluator
 * (Task #109). The same `evaluateCustomSpec` drives BOTH the live F&O engine
 * (`makeCustomEngineDetected`) and the Backtest Lab adapter, so a regression
 * here would either fabricate a signal from missing data or silently drop a
 * valid one on both surfaces at once.
 *
 * The contract under test (from the module's own honesty rules):
 *   - a condition referencing a null / NaN / non-finite feature FAILS the side
 *     (never assumed true), so no emission;
 *   - geometry requires a finite close AND a finite, positive ATR — without it
 *     the evaluator returns `null` rather than inventing a stop distance;
 *   - when a side does fire on real finite features, the stop/targets are
 *     derived from the spec params (defined-risk, both directions).
 */
import { describe, it, expect } from "vitest";
import {
  evaluateCustomSpec,
  type CustomStrategySpec,
  type FeatureSnapshot,
  FEATURE_KEYS,
} from "./customSpec";

function fullSnapshot(over: Partial<FeatureSnapshot> = {}): FeatureSnapshot {
  const base = Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, 0] as const),
  ) as FeatureSnapshot;
  return { ...base, ...over };
}

/** A simple bull-only spec: close > ema20, with defined-risk geometry. */
function bullSpec(over: Partial<CustomStrategySpec> = {}): CustomStrategySpec {
  return {
    id: "CUSTOM_test_bull",
    name: "Test Bull",
    category: "Test",
    description: "",
    bull: [{ left: "close", op: "gt", right: { type: "feature", feature: "ema20" } }],
    bear: [],
    params: { stopAtrMult: 2, target1R: 1, target2R: 2 },
    baseConfidence: 60,
    ...over,
  };
}

describe("evaluateCustomSpec — honesty / no fabrication", () => {
  it("emits a defined-risk BULL plan when conditions hold on real finite features", () => {
    const f = fullSnapshot({ close: 100, ema20: 95, atr14: 5 });
    const r = evaluateCustomSpec(f, bullSpec());
    expect(r).not.toBeNull();
    expect(r!.direction).toBe("BULL");
    expect(r!.entrySpot).toBe(100);
    // risk = stopAtrMult(2) * atr(5) = 10
    expect(r!.stop).toBe(90); // 100 - 10
    expect(r!.target1).toBe(110); // 100 + 1R
    expect(r!.target2).toBe(120); // 100 + 2R
    expect(r!.confidence).toBe(60);
    expect(r!.passed.length).toBe(1);
  });

  it("emits a mirrored BEAR plan (defined-risk on the short side)", () => {
    const spec = bullSpec({
      id: "CUSTOM_test_bear",
      bull: [],
      bear: [{ left: "close", op: "lt", right: { type: "feature", feature: "ema20" } }],
    });
    const f = fullSnapshot({ close: 100, ema20: 105, atr14: 5 });
    const r = evaluateCustomSpec(f, spec);
    expect(r).not.toBeNull();
    expect(r!.direction).toBe("BEAR");
    expect(r!.stop).toBe(110); // 100 + 10 (stop ABOVE entry on a short)
    expect(r!.target1).toBe(90); // 100 - 1R
    expect(r!.target2).toBe(80); // 100 - 2R
  });

  it("returns null when no side's conditions are met (no fabricated signal)", () => {
    const f = fullSnapshot({ close: 90, ema20: 95, atr14: 5 }); // close < ema20
    expect(evaluateCustomSpec(f, bullSpec())).toBeNull();
  });

  it("a condition on a NULL feature FAILS the side → null", () => {
    const f = fullSnapshot({ close: 100, ema20: null, atr14: 5 });
    expect(evaluateCustomSpec(f, bullSpec())).toBeNull();
  });

  it("a condition on a NaN feature FAILS the side → null", () => {
    const f = fullSnapshot({ close: NaN, ema20: 95, atr14: 5 });
    expect(evaluateCustomSpec(f, bullSpec())).toBeNull();
  });

  it("a condition on a non-finite (Infinity) feature FAILS the side → null", () => {
    const f = fullSnapshot({ close: Infinity, ema20: 95, atr14: 5 });
    expect(evaluateCustomSpec(f, bullSpec())).toBeNull();
  });

  it("a NaN right-hand operand FAILS the side → null", () => {
    const f = fullSnapshot({ close: 100, ema20: NaN, atr14: 5 });
    expect(evaluateCustomSpec(f, bullSpec())).toBeNull();
  });

  it("conditions met but NULL ATR → null (never invents a stop distance)", () => {
    const f = fullSnapshot({ close: 100, ema20: 95, atr14: null });
    expect(evaluateCustomSpec(f, bullSpec())).toBeNull();
  });

  it("conditions met but NaN ATR → null", () => {
    const f = fullSnapshot({ close: 100, ema20: 95, atr14: NaN });
    expect(evaluateCustomSpec(f, bullSpec())).toBeNull();
  });

  it("conditions met but non-positive ATR (0) → null", () => {
    const f = fullSnapshot({ close: 100, ema20: 95, atr14: 0 });
    expect(evaluateCustomSpec(f, bullSpec())).toBeNull();
  });

  it("conditions met but negative ATR → null", () => {
    const f = fullSnapshot({ close: 100, ema20: 95, atr14: -5 });
    expect(evaluateCustomSpec(f, bullSpec())).toBeNull();
  });

  it("conditions met but NULL close → null (no entry without a finite price)", () => {
    const f = fullSnapshot({ close: null, ema20: 95, atr14: 5 });
    // close is the left operand of the only condition, so the side won't even
    // pass — but assert the geometry guard too with a value-only spec.
    const valueSpec = bullSpec({
      bull: [{ left: "rsi14", op: "gt", right: { type: "value", value: 50 } }],
    });
    const f2 = fullSnapshot({ close: null, rsi14: 60, atr14: 5 });
    expect(evaluateCustomSpec(f, bullSpec())).toBeNull();
    expect(evaluateCustomSpec(f2, valueSpec)).toBeNull();
  });

  it("an empty side never fires (empty bull/bear = disabled)", () => {
    const spec = bullSpec({ bull: [], bear: [] } as Partial<CustomStrategySpec>);
    const f = fullSnapshot({ close: 100, ema20: 95, atr14: 5 });
    expect(evaluateCustomSpec(f, spec)).toBeNull();
  });

  it("bull takes precedence and the two sides are mutually exclusive", () => {
    // Both sides would pass; bull is checked first and wins.
    const spec = bullSpec({
      bull: [{ left: "close", op: "gt", right: { type: "value", value: 50 } }],
      bear: [{ left: "close", op: "gt", right: { type: "value", value: 50 } }],
    });
    const f = fullSnapshot({ close: 100, atr14: 5 });
    const r = evaluateCustomSpec(f, spec);
    expect(r!.direction).toBe("BULL");
  });
});
