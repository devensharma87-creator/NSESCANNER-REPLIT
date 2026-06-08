/**
 * The FeatureSeries projector: EMA/RSI must come from the shared
 * `@workspace/indicators` primitives (the parity guarantee), and every accessor
 * must be null-safe so the evaluator can fail honestly during warm-up.
 */
import { describe, it, expect } from "vitest";
import { ema, rsi } from "@workspace/indicators";
import {
  projectFeatureSeries,
  featureAt,
  closeAt,
  emaAt,
  istMinuteAt,
  type FeatureSeriesInput,
} from "./customFeatures";

function ramp(n: number, start = 100, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

function input(n: number): FeatureSeriesInput {
  const close = ramp(n);
  return {
    open: close,
    high: close.map((c) => c + 1),
    low: close.map((c) => c - 1),
    close,
    vwap: close.map((c) => c - 0.5),
    atr14: close.map(() => 2),
    istMinute: close.map((_, i) => 555 + i),
  };
}

describe("projectFeatureSeries", () => {
  it("derives EMA/RSI from closes via the shared primitives (byte-identical)", () => {
    const inp = input(60);
    const s = projectFeatureSeries(inp);
    expect(s.n).toBe(60);
    expect(s.ema9).toEqual(ema(inp.close, 9));
    expect(s.ema20).toEqual(ema(inp.close, 20));
    expect(s.ema50).toEqual(ema(inp.close, 50));
    expect(s.rsi14).toEqual(rsi(inp.close, 14));
  });

  it("passes VWAP/ATR/istMinute straight through (surface-provided)", () => {
    const inp = input(30);
    const s = projectFeatureSeries(inp);
    expect(s.vwap).toBe(inp.vwap);
    expect(s.atr14).toBe(inp.atr14);
    expect(s.istMinute).toBe(inp.istMinute);
  });

  it("accessors return null during EMA warm-up and out of range", () => {
    const s = projectFeatureSeries(input(60));
    expect(emaAt(s, "ema50", 10)).toBeNull(); // warm-up
    expect(emaAt(s, "ema50", 59)).not.toBeNull();
    expect(closeAt(s, 999)).toBeNull();
    expect(closeAt(s, -1)).toBeNull();
    expect(featureAt(s, "close", 0)).toBe(100);
    expect(istMinuteAt(s, 0)).toBe(555);
    expect(istMinuteAt(s, 999)).toBeNull();
  });

  it("treats NaN/null inputs as unavailable", () => {
    const inp = input(20);
    const withGap: FeatureSeriesInput = { ...inp, vwap: inp.vwap.map(() => null) };
    const s = projectFeatureSeries(withGap);
    expect(featureAt(s, "vwap", 10)).toBeNull();
  });
});
