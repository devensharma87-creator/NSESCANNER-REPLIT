import { describe, it, expect } from "vitest";
import { ema as sharedEma, rsi as sharedRsi } from "@workspace/indicators";
import { ema as apiEma, rsi as apiRsi } from "./indicators";

/**
 * Golden + identity tests for the shared indicator primitives.
 *
 * These lock the EXACT numeric behaviour of EMA and the series RSI so that the
 * single source of truth in `@workspace/indicators` can never silently drift
 * from the trading-critical values the scanner/scoring relied on before the
 * consolidation. The identity checks prove the api-server module re-exports the
 * shared functions (no accidental shadow copy).
 */
describe("@workspace/indicators — identity", () => {
  it("api-server re-exports the shared ema/rsi (same reference)", () => {
    expect(apiEma).toBe(sharedEma);
    expect(apiRsi).toBe(sharedRsi);
  });
});

describe("@workspace/indicators — ema golden values", () => {
  it("SMA-seeded EMA matches hand-computed values", () => {
    // seed = (1+2+3)/3 = 2 at index 2; k = 0.5
    // i3 = 4*0.5 + 2*0.5 = 3 ; i4 = 5*0.5 + 3*0.5 = 4
    expect(sharedEma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("returns all-null when fewer values than the period", () => {
    expect(sharedEma([1, 2], 3)).toEqual([null, null]);
  });

  it("handles an empty input", () => {
    expect(sharedEma([], 3)).toEqual([]);
  });
});

describe("@workspace/indicators — rsi golden values", () => {
  it("monotonic rise yields 100 (zero average loss)", () => {
    const out = sharedRsi([1, 2, 3, 4, 5, 6], 5);
    expect(out.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(out[5]).toBe(100);
  });

  it("monotonic fall yields 0", () => {
    expect(sharedRsi([6, 5, 4, 3, 2, 1], 5)[5]).toBe(0);
  });

  it("a flat series yields 100 (series-RSI convention, NOT 50)", () => {
    // This is the deliberate divergence from portfolio rsi14, which returns 50.
    expect(sharedRsi([5, 5, 5, 5, 5, 5], 5)[5]).toBe(100);
  });

  it("alternating ±1 (gain 0.6 / loss 0.4) yields 60", () => {
    expect(sharedRsi([10, 11, 10, 11, 10, 11], 5)[5]).toBe(60);
  });

  it("returns all-null when there are fewer than period+1 values", () => {
    expect(sharedRsi([1, 2, 3], 5)).toEqual([null, null, null]);
  });

  it("stays within [0, 100] across a noisy series", () => {
    const series = [10, 12, 11, 13, 9, 14, 8, 15, 7, 16, 6, 17, 5, 18, 4, 19];
    for (const v of sharedRsi(series, 14)) {
      if (v != null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});
