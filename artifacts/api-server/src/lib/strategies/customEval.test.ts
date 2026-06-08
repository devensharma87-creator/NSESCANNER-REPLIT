/**
 * The single shared evaluator: block semantics, AND/OR groups, market/setup
 * layering, ATR + swing geometry, session window, direction mode, and the
 * honesty rule that any unavailable input fails the dependent block.
 */
import { describe, it, expect } from "vitest";
import { evaluateSpecAt } from "./customEval";
import type { FeatureSeries } from "./customFeatures";
import {
  type CustomStrategySpec,
  type SideRules,
  type RuleGroup,
  emptySide,
} from "./customSpec";

type Arr = (number | null)[];
interface Over {
  open?: number[];
  high?: number[];
  low?: number[];
  close?: number[];
  ema9?: Arr;
  ema20?: Arr;
  ema50?: Arr;
  rsi14?: Arr;
  vwap?: Arr;
  atr14?: Arr;
  istMinute?: number[];
}

function mkSeries(n: number, over: Over = {}): FeatureSeries {
  const close = over.close ?? Array.from({ length: n }, (_, i) => 100 + i);
  const fill = (v: number): Arr => Array.from({ length: n }, () => v);
  return {
    n,
    open: over.open ?? close,
    high: over.high ?? close.map((c) => c + 1),
    low: over.low ?? close.map((c) => c - 1),
    close,
    ema9: over.ema9 ?? fill(100),
    ema20: over.ema20 ?? fill(100),
    ema50: over.ema50 ?? fill(100),
    rsi14: over.rsi14 ?? fill(50),
    vwap: over.vwap ?? fill(100),
    atr14: over.atr14 ?? fill(2),
    istMinute: over.istMinute ?? Array.from({ length: n }, (_, i) => 555 + i),
  };
}

function spec(over: Partial<CustomStrategySpec> = {}): CustomStrategySpec {
  return {
    version: 2,
    id: "CUSTOM_test",
    name: "Test",
    category: "Test",
    description: "",
    direction: "BOTH",
    bull: emptySide(),
    bear: emptySide(),
    execution: { stop: { type: "atr", atrMult: 1.5 }, target1R: 1, target2R: 2 },
    baseConfidence: 60,
    ...over,
  };
}

function bullSide(setup: RuleGroup, market?: RuleGroup): SideRules {
  return { market: market ?? emptySide().market, setup };
}

describe("block semantics", () => {
  it("price_vs_ema above fires only when close > ema", () => {
    const s = mkSeries(5, { close: [10, 10, 10, 10, 110], ema9: [100, 100, 100, 100, 100] });
    const sp = spec({ bull: bullSide({ logic: "AND", blocks: [{ type: "price_vs_ema", ema: "ema9", cmp: "above" }] }) });
    expect(evaluateSpecAt(s, 4, sp).fired).toBe(true);
    expect(evaluateSpecAt(s, 0, sp).fired).toBe(false);
  });

  it("ema_stack bull requires ema9>ema20>ema50", () => {
    const s = mkSeries(3, { ema9: [3, 3, 3], ema20: [2, 2, 2], ema50: [1, 1, 1], close: [10, 10, 10] });
    const sp = spec({ bull: bullSide({ logic: "AND", blocks: [{ type: "ema_stack", order: "bull" }] }) });
    expect(evaluateSpecAt(s, 2, sp).fired).toBe(true);
  });

  it("ema_cross golden fires only at the crossing bar", () => {
    const s = mkSeries(3, { ema9: [1, 1, 5], ema20: [2, 2, 4], close: [10, 10, 10] });
    const sp = spec({ bull: bullSide({ logic: "AND", blocks: [{ type: "ema_cross", fast: "ema9", slow: "ema20", dir: "golden" }] }) });
    expect(evaluateSpecAt(s, 2, sp).fired).toBe(true);
    expect(evaluateSpecAt(s, 1, sp).fired).toBe(false);
  });

  it("vwap_cross reclaim fires when close crosses up VWAP", () => {
    const s = mkSeries(3, { close: [9, 9, 11], vwap: [10, 10, 10] });
    const sp = spec({ bull: bullSide({ logic: "AND", blocks: [{ type: "vwap_cross", dir: "reclaim" }] }) });
    expect(evaluateSpecAt(s, 2, sp).fired).toBe(true);
  });

  it("fib_zone bull fires when price sits in the retracement band of an up-impulse", () => {
    // build a clear swing low at idx2 (low 90) then swing high at idx6 (high 130),
    // then price retraces to ~112 (between 0.382=114.7 and 0.618=105.3) at idx10.
    const high = [101, 100, 91, 100, 110, 120, 130, 121, 118, 114, 113];
    const low = [99, 98, 90, 98, 108, 118, 128, 119, 116, 112, 111];
    const close = [100, 99, 90.5, 99, 109, 119, 129, 120, 117, 113, 112];
    const s = mkSeries(11, { high, low, close, atr14: close.map(() => 2) });
    const sp = spec({
      bull: bullSide({ logic: "AND", blocks: [{ type: "fib_zone", side: "bull", lo: 0.382, hi: 0.618, swingSpan: 2 }] }),
    });
    const res = evaluateSpecAt(s, 10, sp);
    expect(res.fired).toBe(true);
  });

  it("compare honours null operands by failing", () => {
    const s = mkSeries(3, { rsi14: [null, null, null], close: [10, 10, 10] });
    const sp = spec({ bull: bullSide({ logic: "AND", blocks: [{ type: "compare", left: "rsi14", op: "gt", right: { type: "value", value: 50 } }] }) });
    const res = evaluateSpecAt(s, 2, sp);
    expect(res.fired).toBe(false);
    expect(res.rejectCode).toBe("RULES_NOT_MET");
  });
});

describe("groups: AND / OR + layering", () => {
  const aboveVwap: RuleGroup = { logic: "AND", blocks: [{ type: "price_vs_vwap", cmp: "above" }] };
  it("OR fires if any child passes", () => {
    const s = mkSeries(2, { close: [10, 110], vwap: [100, 100], ema9: [200, 200] });
    const sp = spec({
      bull: bullSide({
        logic: "OR",
        blocks: [
          { type: "price_vs_vwap", cmp: "above" }, // passes (110>100)
          { type: "price_vs_ema", ema: "ema9", cmp: "above" }, // fails (110<200)
        ],
      }),
    });
    expect(evaluateSpecAt(s, 1, sp).fired).toBe(true);
  });

  it("AND market layer must also pass", () => {
    const s = mkSeries(2, { close: [10, 110], vwap: [100, 100], ema50: [200, 200] });
    const market: RuleGroup = { logic: "AND", blocks: [{ type: "price_vs_ema", ema: "ema50", cmp: "above" }] };
    const sp = spec({ bull: bullSide(aboveVwap, market) });
    // setup passes (110>100) but market fails (110<200) → no fire
    expect(evaluateSpecAt(s, 1, sp).fired).toBe(false);
  });

  it("an empty side is disabled (NO_ENABLED_SIDE)", () => {
    const s = mkSeries(2);
    const res = evaluateSpecAt(s, 1, spec());
    expect(res.fired).toBe(false);
    expect(res.rejectCode).toBe("NO_ENABLED_SIDE");
  });
});

describe("execution geometry + gates", () => {
  const setup: RuleGroup = { logic: "AND", blocks: [{ type: "price_vs_vwap", cmp: "above" }] };
  const fireSeries = () => mkSeries(3, { close: [10, 10, 110], vwap: [100, 100, 100], atr14: [2, 2, 2] });

  it("ATR stop/targets are signed correctly for a bull", () => {
    const s = fireSeries();
    const res = evaluateSpecAt(s, 2, spec({ bull: bullSide(setup) }));
    expect(res.fired).toBe(true);
    expect(res.entry).toBe(110);
    expect(res.stop).toBeCloseTo(110 - 1.5 * 2); // 107
    expect(res.target1).toBeCloseTo(110 + 1 * 3); // risk=3
    expect(res.target2).toBeCloseTo(110 + 2 * 3);
  });

  it("fails honestly when ATR is unavailable", () => {
    const s = mkSeries(3, { close: [10, 10, 110], vwap: [100, 100, 100], atr14: [null, null, null] });
    const res = evaluateSpecAt(s, 2, spec({ bull: bullSide(setup) }));
    expect(res.fired).toBe(false);
    expect(res.rejectCode).toBe("NO_ATR");
  });

  it("swing stop fails when no confirmed swing exists", () => {
    const s = mkSeries(3, { close: [10, 10, 110], vwap: [100, 100, 100] });
    const res = evaluateSpecAt(
      s,
      2,
      spec({ bull: bullSide(setup), execution: { stop: { type: "swing", swingSpan: 3, bufferAtrMult: 0.5 }, target1R: 1, target2R: 2 } }),
    );
    expect(res.fired).toBe(false);
    expect(res.rejectCode).toBe("NO_SWING_FOR_STOP");
  });

  it("session window blocks entries outside the window", () => {
    const s = mkSeries(3, { close: [10, 10, 110], vwap: [100, 100, 100], istMinute: [555, 556, 600] });
    const res = evaluateSpecAt(
      s,
      2,
      spec({ bull: bullSide(setup), execution: { stop: { type: "atr", atrMult: 1.5 }, target1R: 1, target2R: 2, sessionWindow: { startMin: 555, endMin: 559 } } }),
    );
    expect(res.fired).toBe(false);
    expect(res.rejectCode).toBe("OUTSIDE_SESSION");
  });

  it("STOP_TOO_WIDE rejects an oversized swing stop", () => {
    // confirmed swing low far away → wide stop
    const high = [101, 100, 60, 100, 110, 120, 130];
    const low = [99, 98, 50, 98, 108, 118, 128];
    const close = [100, 99, 55, 99, 109, 119, 129];
    const s = mkSeries(7, { high, low, close, vwap: close.map(() => 0), atr14: close.map(() => 2) });
    const res = evaluateSpecAt(
      s,
      6,
      spec({
        bull: bullSide({ logic: "AND", blocks: [{ type: "price_vs_vwap", cmp: "above" }] }),
        execution: { stop: { type: "swing", swingSpan: 2, bufferAtrMult: 0.5 }, target1R: 1, target2R: 2, maxStopAtrMult: 3 },
      }),
    );
    expect(res.fired).toBe(false);
    expect(res.rejectCode).toBe("STOP_TOO_WIDE");
  });
});

describe("direction mode", () => {
  it("CALL_ONLY suppresses a bear signal", () => {
    const s = mkSeries(2, { close: [200, 10], vwap: [100, 100], atr14: [2, 2] });
    const bear: SideRules = { market: emptySide().market, setup: { logic: "AND", blocks: [{ type: "price_vs_vwap", cmp: "below" }] } };
    const sp = spec({ direction: "CALL_ONLY", bear });
    const res = evaluateSpecAt(s, 1, sp);
    expect(res.fired).toBe(false);
  });

  it("BOTH lets the bear side fire", () => {
    const s = mkSeries(2, { close: [200, 10], vwap: [100, 100], atr14: [2, 2] });
    const bear: SideRules = { market: emptySide().market, setup: { logic: "AND", blocks: [{ type: "price_vs_vwap", cmp: "below" }] } };
    const res = evaluateSpecAt(s, 1, spec({ direction: "BOTH", bear }));
    expect(res.fired).toBe(true);
    expect(res.side).toBe("BEAR");
    expect(res.stop).toBeCloseTo(10 + 1.5 * 2); // bear stop above entry
  });
});

describe("execution: maxEntryDistanceAtrMult (anti-chase)", () => {
  // Bull setup that fires when close > ema9; entry = close at the bar, the
  // trend reference is ema20, ATR = 2. Entry sits 15×ATR above ema20.
  const bullPullback = (over: Over): { s: FeatureSeries; bull: SideRules } => ({
    s: mkSeries(1, { close: [130], ema9: [90], ema20: [100], atr14: [2], ...over }),
    bull: { market: emptySide().market, setup: { logic: "AND", blocks: [{ type: "price_vs_ema", ema: "ema9", cmp: "above" }] } },
  });

  it("rejects an entry that is too extended from EMA20", () => {
    const { s, bull } = bullPullback({});
    const sp = spec({ bull, execution: { stop: { type: "atr", atrMult: 1.5 }, target1R: 1, target2R: 2, maxEntryDistanceAtrMult: 5 } });
    const res = evaluateSpecAt(s, 0, sp);
    expect(res.fired).toBe(false);
    expect(res.rejectCode).toBe("ENTRY_TOO_EXTENDED");
    expect(res.reasons.some((r) => r.label === "max entry distance" && !r.passed)).toBe(true);
  });

  it("allows the same entry when the threshold is generous", () => {
    const { s, bull } = bullPullback({});
    const sp = spec({ bull, execution: { stop: { type: "atr", atrMult: 1.5 }, target1R: 1, target2R: 2, maxEntryDistanceAtrMult: 20 } });
    const res = evaluateSpecAt(s, 0, sp);
    expect(res.fired).toBe(true);
    expect(res.reasons.some((r) => r.label === "max entry distance" && r.passed)).toBe(true);
  });

  it("fails honestly (no pass-through) when the EMA20 reference is unavailable", () => {
    const { s, bull } = bullPullback({ ema20: [null] });
    const sp = spec({ bull, execution: { stop: { type: "atr", atrMult: 1.5 }, target1R: 1, target2R: 2, maxEntryDistanceAtrMult: 5 } });
    const res = evaluateSpecAt(s, 0, sp);
    expect(res.fired).toBe(false);
    expect(res.rejectCode).toBe("NO_TREND_REF");
  });

  it("is a no-op when the gate is unset", () => {
    const { s, bull } = bullPullback({});
    const sp = spec({ bull, execution: { stop: { type: "atr", atrMult: 1.5 }, target1R: 1, target2R: 2 } });
    const res = evaluateSpecAt(s, 0, sp);
    expect(res.fired).toBe(true);
    expect(res.reasons.some((r) => r.label === "max entry distance")).toBe(false);
  });
});
