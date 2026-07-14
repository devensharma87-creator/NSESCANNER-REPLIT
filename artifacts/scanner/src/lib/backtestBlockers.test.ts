import { describe, expect, it } from "vitest";
import {
  computeDominantBlocker,
  isLikelyOverFiltered,
  relaxFilters,
  RELAXABLE_BOOLEAN_FILTERS,
} from "./backtestBlockers";
import type { BacktestBlockedSetup, BacktestFilterConfig } from "@workspace/api-client-react";

/**
 * Unit tests for the "why did this run produce no trades?" reasoning helpers.
 *
 * The backtest runner sets a blocked row's `reasonCode` to the FilterConfig key
 * for FILTER/DATA blocks (e.g. "emaTrendFilter") and to "MAX_TRADES_PER_DAY" for
 * the RISK trade-cap. These tests lock the dominant-rule roll-up, the
 * over-filtered heuristic, and the one-click relaxation to that contract so the
 * empty-state callout can never mislabel a blocker or fabricate a relax knob.
 */

function row(p: Partial<BacktestBlockedSetup>): BacktestBlockedSetup {
  return {
    id: Math.random().toString(36).slice(2),
    indexSymbol: "NIFTY",
    count: 1,
    ...p,
  } as BacktestBlockedSetup;
}

const DEFAULT_FILTERS: Required<BacktestFilterConfig> = {
  vwapFilter: true,
  emaTrendFilter: true,
  optionChainConfirmation: false,
  avoidChopZone: true,
  avoidLast15Minutes: true,
  avoidWideSpread: false,
  avoidLowVolume: false,
  minimumRiskReward: 1.5,
};

describe("computeDominantBlocker", () => {
  it("returns null for an empty blocked array", () => {
    expect(computeDominantBlocker([])).toBeNull();
  });

  it("returns null when every row has a non-positive count", () => {
    expect(computeDominantBlocker([row({ reasonCode: "emaTrendFilter", count: 0 })])).toBeNull();
  });

  it("aggregates counts across rows that share a reasonCode and reports the share", () => {
    const blocked = [
      row({ reasonCode: "emaTrendFilter", blockedRule: "EMA trend confirmation filter", count: 60, category: "FILTER" }),
      row({ reasonCode: "emaTrendFilter", blockedRule: "EMA trend confirmation filter", count: 27, category: "FILTER", indexSymbol: "BANKNIFTY" }),
      row({ reasonCode: "vwapFilter", blockedRule: "VWAP confirmation filter", count: 13, category: "FILTER" }),
    ];
    const d = computeDominantBlocker(blocked)!;
    expect(d.reasonCode).toBe("emaTrendFilter");
    expect(d.label).toBe("EMA Trend Filter");
    expect(d.topCount).toBe(87);
    expect(d.totalCount).toBe(100);
    expect(Math.round(d.sharePct)).toBe(87);
    expect(d.relaxKind).toBe("DISABLE_FILTER");
    expect(d.filterKey).toBe("emaTrendFilter");
    expect(d.category).toBe("FILTER");
  });

  it("classifies the minimum-risk:reward filter as a LOWER_RR relaxation", () => {
    const d = computeDominantBlocker([row({ reasonCode: "minimumRiskReward", count: 5 })])!;
    expect(d.relaxKind).toBe("LOWER_RR");
    expect(d.filterKey).toBe("minimumRiskReward");
    expect(d.label).toBe("Minimum Risk:Reward");
  });

  it("classifies the daily trade cap as a RAISE_TRADE_CAP relaxation with no filter key", () => {
    const d = computeDominantBlocker([
      row({ reasonCode: "MAX_TRADES_PER_DAY", blockedRule: "Max trades per day", count: 9, category: "RISK" }),
    ])!;
    expect(d.relaxKind).toBe("RAISE_TRADE_CAP");
    expect(d.filterKey).toBeNull();
    expect(d.category).toBe("RISK");
  });

  it("treats a DATA-category block (filter key, data unavailable) as relaxable by disabling the filter", () => {
    const d = computeDominantBlocker([
      row({ reasonCode: "emaTrendFilter", blockedRule: "EMA trend filter — data unavailable", count: 4, category: "DATA" }),
    ])!;
    expect(d.category).toBe("DATA");
    expect(d.relaxKind).toBe("DISABLE_FILTER");
    expect(d.filterKey).toBe("emaTrendFilter");
  });

  it("falls back to blockedRule label and marks unknown engine reasons not relaxable", () => {
    const d = computeDominantBlocker([
      row({ reasonCode: "ENGINE_REGIME_VETO", blockedRule: "Regime veto", count: 3 }),
    ])!;
    expect(d.relaxKind).toBeNull();
    expect(d.filterKey).toBeNull();
    expect(d.label).toBe("Regime veto");
  });

  it("falls back to blockedRule as the aggregation key when reasonCode is missing", () => {
    const d = computeDominantBlocker([
      row({ reasonCode: null, blockedRule: "Some engine rule", count: 7 }),
    ])!;
    expect(d.reasonCode).toBe("Some engine rule");
    expect(d.topCount).toBe(7);
  });
});

describe("isLikelyOverFiltered", () => {
  it("is false when nothing was blocked", () => {
    expect(isLikelyOverFiltered(0, 0)).toBe(false);
    expect(isLikelyOverFiltered(5, 0)).toBe(false);
  });

  it("is true on a zero-trade run with blocks", () => {
    expect(isLikelyOverFiltered(0, 12)).toBe(true);
  });

  it("is true on a near-zero run when blocks dwarf trades (≥10×)", () => {
    expect(isLikelyOverFiltered(2, 20)).toBe(true);
    expect(isLikelyOverFiltered(1, 10)).toBe(true);
  });

  it("is false when there are enough trades that blocking is incidental", () => {
    expect(isLikelyOverFiltered(2, 19)).toBe(false);
    expect(isLikelyOverFiltered(5, 100)).toBe(false);
  });
});

describe("relaxFilters", () => {
  it("disables the offending boolean filter and leaves the rest intact", () => {
    const blocker = computeDominantBlocker([row({ reasonCode: "emaTrendFilter", count: 5 })])!;
    const next = relaxFilters(DEFAULT_FILTERS, blocker);
    expect(next.emaTrendFilter).toBe(false);
    expect(next.vwapFilter).toBe(true);
    expect(next.avoidChopZone).toBe(true);
    expect(next.minimumRiskReward).toBe(1.5);
  });

  it("zeroes the minimum risk:reward when that is the dominant blocker", () => {
    const blocker = computeDominantBlocker([row({ reasonCode: "minimumRiskReward", count: 5 })])!;
    const next = relaxFilters(DEFAULT_FILTERS, blocker);
    expect(next.minimumRiskReward).toBe(0);
    expect(next.emaTrendFilter).toBe(true);
  });

  it("does not mutate filters for a non-toggle (trade cap) relaxation", () => {
    const blocker = computeDominantBlocker([row({ reasonCode: "MAX_TRADES_PER_DAY", count: 5, category: "RISK" })])!;
    const next = relaxFilters(DEFAULT_FILTERS, blocker);
    expect(next).toEqual(DEFAULT_FILTERS);
  });

  it("every relaxable boolean key is a real FilterConfig key", () => {
    for (const k of RELAXABLE_BOOLEAN_FILTERS) {
      expect(k in DEFAULT_FILTERS).toBe(true);
    }
  });
});
