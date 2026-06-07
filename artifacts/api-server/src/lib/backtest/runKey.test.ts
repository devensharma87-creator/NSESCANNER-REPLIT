import { describe, it, expect } from "vitest";
import { computeBacktestRunKey, stableStringify, type RunKeyInputs } from "./runKey";

const base: RunKeyInputs = {
  mode: "DIRECTIONAL",
  backtestMode: "STRATEGY_RESEARCH",
  instrument: "NIFTY",
  timeframe: "15m",
  fromDate: "2024-01-01",
  toDate: "2024-06-01",
  startingCapital: 1_000_000,
  riskPerTradePct: 1,
  maxTradesPerDay: 3,
  includeCharges: true,
  includeSlippage: false,
  strategyIds: ["A", "B"],
  filters: { ema: true, vwap: false },
  strategyParams: { A: { stop: 1 } },
  dataVersion: "NIFTY:100:1700000000000",
};

describe("computeBacktestRunKey", () => {
  it("is deterministic for identical inputs", () => {
    expect(computeBacktestRunKey(base)).toBe(computeBacktestRunKey({ ...base }));
  });

  it("returns null for REAL_REPLAY (live data, never deduped)", () => {
    expect(computeBacktestRunKey({ ...base, mode: "REAL_REPLAY" })).toBeNull();
  });

  it("is independent of strategy selection order", () => {
    const a = computeBacktestRunKey({ ...base, strategyIds: ["A", "B"] });
    const b = computeBacktestRunKey({ ...base, strategyIds: ["B", "A"] });
    expect(a).toBe(b);
  });

  it("is independent of filter object key order", () => {
    const a = computeBacktestRunKey({ ...base, filters: { ema: true, vwap: false } });
    const b = computeBacktestRunKey({ ...base, filters: { vwap: false, ema: true } });
    expect(a).toBe(b);
  });

  it("changes when the candle data-version changes", () => {
    const a = computeBacktestRunKey(base);
    const b = computeBacktestRunKey({ ...base, dataVersion: "NIFTY:200:1700000099999" });
    expect(a).not.toBe(b);
  });

  it("changes when any output-affecting input changes", () => {
    const k0 = computeBacktestRunKey(base);
    expect(computeBacktestRunKey({ ...base, instrument: "BANKNIFTY" })).not.toBe(k0);
    expect(computeBacktestRunKey({ ...base, startingCapital: 500_000 })).not.toBe(k0);
    expect(computeBacktestRunKey({ ...base, maxTradesPerDay: 5 })).not.toBe(k0);
    expect(computeBacktestRunKey({ ...base, includeSlippage: true })).not.toBe(k0);
    expect(computeBacktestRunKey({ ...base, toDate: "2024-07-01" })).not.toBe(k0);
  });

  it("treats null/undefined nested values stably", () => {
    const a = computeBacktestRunKey({ ...base, filters: null, strategyParams: null });
    const b = computeBacktestRunKey({ ...base, filters: null, strategyParams: undefined });
    expect(a).toBe(b);
  });
});

describe("stableStringify", () => {
  it("sorts object keys recursively", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it("preserves array order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });
  it("encodes null and undefined as null", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(undefined)).toBe("null");
  });
});
