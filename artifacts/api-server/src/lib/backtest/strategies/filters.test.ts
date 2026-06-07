import { describe, expect, it } from "vitest";
import { applyFilters } from "./filters";
import { DEFAULT_FILTERS, type FilterConfig, type StrategyContext, type StrategyEntry } from "./base";

/**
 * Minimal context — the minimum-risk:reward filter reads none of the per-bar
 * series, so a one-element stub is enough when only that filter is enabled.
 */
function stubCtx(): StrategyContext {
  return {
    indexSymbol: "NIFTY",
    cfg: { expiryWeekday: 2, expiryCadence: "weekly", strikeStep: 50 },
    candles: [],
    closes: [0],
    highs: [0],
    lows: [0],
    opens: [0],
    ema9: [null],
    ema20: [null],
    ema50: [null],
    rsi14: [null],
    atr14: [null],
    adx14: [null],
    sessionMean: [Number.NaN],
    istMinute: [600],
    barInSession: [0],
    isLastBarOfDay: [false],
    orHigh: [null],
    orLow: [null],
    dayHighSoFar: [0],
    dayLowSoFar: [0],
    prevDayHigh: [null],
    prevDayLow: [null],
    prevDayClose: [null],
    cprHigh: [null],
    cprLow: [null],
  };
}

/** A standard bull setup: stop 1R below entry, T1 at 1R, T2 at 2R (the runner default). */
function bullEntry(entry: number, risk: number, t1R: number, t2R: number): StrategyEntry {
  return {
    direction: "BULL",
    optionType: "CALL",
    entrySpot: entry,
    stop: entry - risk,
    target1: entry + t1R * risk,
    target2: entry + t2R * risk,
    confidence: 65,
    entryReason: "",
    passedConditions: [],
    failedConditions: [],
    warnings: [],
  };
}

const onlyRR = (minimumRiskReward: number): FilterConfig => ({
  vwapFilter: false,
  emaTrendFilter: false,
  optionChainConfirmation: false,
  avoidChopZone: false,
  avoidLast15Minutes: false,
  avoidWideSpread: false,
  avoidLowVolume: false,
  minimumRiskReward,
});

describe("minimum risk:reward filter — blended scale-out reward", () => {
  it("PASSES the default 1.5 threshold for the default T1=1R / T2=2R structure (regression)", () => {
    // Blended planned reward = 0.5*1R + 0.5*2R = 1.5R. 1.5 >= 1.5 → must pass.
    const fr = applyFilters(stubCtx(), 0, bullEntry(20000, 50, 1, 2), onlyRR(1.5), []);
    expect(fr.ok).toBe(true);
    expect(fr.rejections).toHaveLength(0);
  });

  it("DEFAULT_FILTERS' 1.5 threshold is exactly the default trade's blended R:R", () => {
    expect(DEFAULT_FILTERS.minimumRiskReward).toBe(1.5);
    const fr = applyFilters(stubCtx(), 0, bullEntry(20000, 50, 1, 2), onlyRR(DEFAULT_FILTERS.minimumRiskReward), []);
    expect(fr.ok).toBe(true);
  });

  it("BLOCKS when the threshold exceeds the blended reward", () => {
    // Blended = 1.5R; a 1.6 minimum must reject.
    const fr = applyFilters(stubCtx(), 0, bullEntry(20000, 50, 1, 2), onlyRR(1.6), []);
    expect(fr.ok).toBe(false);
    expect(fr.rejections[0]?.key).toBe("minimumRiskReward");
    expect(fr.rejections[0]?.category).toBe("FILTER");
  });

  it("BLOCKS when custom params make targets too tight (blended below threshold)", () => {
    // T1=0.5R, T2=1R → blended = 0.75R < 1.5.
    const fr = applyFilters(stubCtx(), 0, bullEntry(20000, 50, 0.5, 1), onlyRR(1.5), []);
    expect(fr.ok).toBe(false);
    expect(fr.rejections[0]?.key).toBe("minimumRiskReward");
  });

  it("a wider T2 raises the blended reward and passes a stricter threshold", () => {
    // T1=1R, T2=4R → blended = 2.5R, passes a 2.0 minimum.
    const fr = applyFilters(stubCtx(), 0, bullEntry(20000, 50, 1, 4), onlyRR(2.0), []);
    expect(fr.ok).toBe(true);
  });

  it("is a no-op when the strategy opts out of the filter", () => {
    const fr = applyFilters(stubCtx(), 0, bullEntry(20000, 50, 0.1, 0.1), onlyRR(1.5), ["minimumRiskReward"]);
    expect(fr.ok).toBe(true);
  });
});
