/**
 * The single shared evaluator: block semantics, AND/OR groups, market/setup
 * layering, ATR + swing geometry, session window, direction mode, and the
 * honesty rule that any unavailable input fails the dependent block.
 */
import { describe, it, expect } from "vitest";
import { computeSmcSeries, DEFAULT_SMC_CONFIG, type SmcBar, type SmcSeries } from "@workspace/indicators";
import { evaluateSpecAt } from "./customEval";
import type { FeatureSeries } from "./customFeatures";
import {
  type CustomStrategySpec,
  type SideRules,
  type RuleGroup,
  type RuleBlock,
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
  /** Override the SMC series wholesale (for deterministic SMC-block tests). */
  smc?: SmcSeries;
}

/** An all-quiet SMC bar; tests flip only the fields under test. */
function mkSmcBar(over: Partial<SmcBar> = {}): SmcBar {
  return {
    structDir: 0,
    bosUp: false,
    bosDn: false,
    chochUp: false,
    chochDn: false,
    breakHigh: null,
    breakLow: null,
    fvgBullPresent: false,
    fvgBearPresent: false,
    fvgBullFormed: false,
    fvgBearFormed: false,
    fvgBullRetest: false,
    fvgBearRetest: false,
    fvgBullFilled: false,
    fvgBearFilled: false,
    nearestBullFvgTop: null,
    nearestBullFvgBottom: null,
    nearestBearFvgTop: null,
    nearestBearFvgBottom: null,
    demandPresent: false,
    supplyPresent: false,
    demandTest: false,
    supplyTest: false,
    nearestDemandTop: null,
    nearestDemandBottom: null,
    nearestSupplyTop: null,
    nearestSupplyBottom: null,
    sweepBuySide: false,
    sweepSellSide: false,
    sweptHigh: null,
    sweptLow: null,
    displacementUp: false,
    displacementDown: false,
    ...over,
  };
}

function mkSeries(n: number, over: Over = {}): FeatureSeries {
  const close = over.close ?? Array.from({ length: n }, (_, i) => 100 + i);
  const fill = (v: number): Arr => Array.from({ length: n }, () => v);
  const open = over.open ?? close;
  const high = over.high ?? close.map((c) => c + 1);
  const low = over.low ?? close.map((c) => c - 1);
  const atr14 = over.atr14 ?? fill(2);
  return {
    n,
    open,
    high,
    low,
    close,
    ema9: over.ema9 ?? fill(100),
    ema20: over.ema20 ?? fill(100),
    ema50: over.ema50 ?? fill(100),
    rsi14: over.rsi14 ?? fill(50),
    vwap: over.vwap ?? fill(100),
    atr14,
    istMinute: over.istMinute ?? Array.from({ length: n }, (_, i) => 555 + i),
    smc: over.smc ?? computeSmcSeries({ open, high, low, close, atr14 }, DEFAULT_SMC_CONFIG),
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

describe("SMC blocks", () => {
  // Two-bar series; bar 1 is the bar under test. We override the SMC series so a
  // block's truth is fully controlled, isolating the evaluator's interpretation
  // from the engine. close[1]=110, ema/vwap=100, atr=2.
  const base = (smc1: SmcBar): FeatureSeries =>
    mkSeries(2, {
      close: [100, 110],
      ema9: [100, 100],
      ema20: [100, 100],
      ema50: [100, 100],
      vwap: [100, 100],
      atr14: [2, 2],
      smc: [mkSmcBar(), smc1],
    });
  const withBlock = (block: RuleBlock): CustomStrategySpec =>
    spec({ bull: bullSide({ logic: "AND", blocks: [block] }) });

  it("fvg present fires only when an active FVG exists on that side", () => {
    const yes = base(mkSmcBar({ fvgBullPresent: true, nearestBullFvgTop: 108, nearestBullFvgBottom: 105 }));
    const no = base(mkSmcBar({ fvgBullPresent: false }));
    expect(evaluateSpecAt(yes, 1, withBlock({ type: "fvg", side: "bull", mode: "present" })).fired).toBe(true);
    expect(evaluateSpecAt(no, 1, withBlock({ type: "fvg", side: "bull", mode: "present" })).fired).toBe(false);
  });

  it("fvg fill/retest read their own flags", () => {
    const s = base(mkSmcBar({ fvgBullRetest: true, fvgBullFilled: false }));
    expect(evaluateSpecAt(s, 1, withBlock({ type: "fvg", side: "bull", mode: "retest" })).fired).toBe(true);
    expect(evaluateSpecAt(s, 1, withBlock({ type: "fvg", side: "bull", mode: "fill" })).fired).toBe(false);
  });

  it("bos / choch read their directional flags", () => {
    const bos = base(mkSmcBar({ bosUp: true, breakHigh: 109 }));
    const choch = base(mkSmcBar({ chochUp: true, breakHigh: 109 }));
    expect(evaluateSpecAt(bos, 1, withBlock({ type: "bos", dir: "up" })).fired).toBe(true);
    expect(evaluateSpecAt(bos, 1, withBlock({ type: "bos", dir: "down" })).fired).toBe(false);
    expect(evaluateSpecAt(choch, 1, withBlock({ type: "choch", dir: "up" })).fired).toBe(true);
    // a CHoCH bar is not a BOS bar
    expect(evaluateSpecAt(choch, 1, withBlock({ type: "bos", dir: "up" })).fired).toBe(false);
  });

  it("liquidity_sweep / order_block / displacement read their flags", () => {
    const sweep = base(mkSmcBar({ sweepBuySide: true, sweptHigh: 112 }));
    expect(evaluateSpecAt(sweep, 1, withBlock({ type: "liquidity_sweep", side: "buy" })).fired).toBe(true);
    expect(evaluateSpecAt(sweep, 1, withBlock({ type: "liquidity_sweep", side: "sell" })).fired).toBe(false);

    const ob = base(mkSmcBar({ demandTest: true, nearestDemandTop: 106, nearestDemandBottom: 104 }));
    expect(evaluateSpecAt(ob, 1, withBlock({ type: "order_block", side: "demand", mode: "test" })).fired).toBe(true);
    expect(evaluateSpecAt(ob, 1, withBlock({ type: "order_block", side: "supply", mode: "test" })).fired).toBe(false);

    const disp = base(mkSmcBar({ displacementUp: true }));
    expect(evaluateSpecAt(disp, 1, withBlock({ type: "displacement", dir: "up" })).fired).toBe(true);
    expect(evaluateSpecAt(disp, 1, withBlock({ type: "displacement", dir: "down" })).fired).toBe(false);
  });

  it("surfaces honest per-block reasoning on the firing side", () => {
    const s = base(mkSmcBar({ bosUp: true, breakHigh: 109 }));
    const res = evaluateSpecAt(s, 1, withBlock({ type: "bos", dir: "up" }));
    expect(res.reasons.some((r) => r.label === "BOS up" && r.passed)).toBe(true);
  });
});

describe("SMC-anchored stop", () => {
  const setup: RuleGroup = { logic: "AND", blocks: [{ type: "price_vs_vwap", cmp: "above" }] };
  const base = (smc1: SmcBar): FeatureSeries =>
    mkSeries(2, { close: [100, 110], vwap: [100, 100], atr14: [2, 2], smc: [mkSmcBar(), smc1] });
  const smcStop = (source: "fvg" | "order_block" | "swing") =>
    spec({ bull: bullSide(setup), execution: { stop: { type: "smc", source, bufferAtrMult: 0.5 }, target1R: 1, target2R: 2 } });

  it("anchors a bull stop just below the nearest bull FVG bottom", () => {
    const s = base(mkSmcBar({ fvgBullPresent: true, nearestBullFvgTop: 108, nearestBullFvgBottom: 105 }));
    const res = evaluateSpecAt(s, 1, smcStop("fvg"));
    expect(res.fired).toBe(true);
    expect(res.stop).toBeCloseTo(105 - 0.5 * 2); // 104
  });

  it("anchors to the demand order-block bottom", () => {
    const s = base(mkSmcBar({ demandPresent: true, nearestDemandTop: 106, nearestDemandBottom: 103 }));
    const res = evaluateSpecAt(s, 1, smcStop("order_block"));
    expect(res.fired).toBe(true);
    expect(res.stop).toBeCloseTo(103 - 0.5 * 2); // 102
  });

  it("fails honestly with NO_SMC_ANCHOR when the zone does not exist", () => {
    const s = base(mkSmcBar({ fvgBullPresent: false }));
    const res = evaluateSpecAt(s, 1, smcStop("fvg"));
    expect(res.fired).toBe(false);
    expect(res.rejectCode).toBe("NO_SMC_ANCHOR");
  });

  it("rejects an anchor on the wrong side of entry (SMC_ANCHOR_WRONG_SIDE)", () => {
    // demand bottom 120 is ABOVE the entry 110 → cannot be a protective long stop.
    const s = base(mkSmcBar({ demandPresent: true, nearestDemandTop: 125, nearestDemandBottom: 120 }));
    const res = evaluateSpecAt(s, 1, smcStop("order_block"));
    expect(res.fired).toBe(false);
    expect(res.rejectCode).toBe("SMC_ANCHOR_WRONG_SIDE");
  });
});
