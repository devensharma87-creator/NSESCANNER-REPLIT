import { describe, it, expect } from "vitest";
import { sma, rsi14 } from "./indicators";

describe("sma", () => {
  it("averages the last `period` closes", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 2)).toBe(4.5);
  });

  it("returns null when there is insufficient history", () => {
    expect(sma([1, 2], 5)).toBeNull();
    expect(sma([], 1)).toBeNull();
  });

  it("returns null for non-positive period", () => {
    expect(sma([1, 2, 3], 0)).toBeNull();
  });

  it("returns null when a close is non-finite (never fabricates)", () => {
    expect(sma([1, 2, NaN], 3)).toBeNull();
  });
});

describe("rsi14", () => {
  it("needs at least period+1 closes", () => {
    expect(rsi14(Array(14).fill(100))).toBeNull();
  });

  it("returns 100 for a strictly rising series (no losses)", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi14(closes)).toBe(100);
  });

  it("returns 50 for a perfectly flat series", () => {
    expect(rsi14(Array(20).fill(100))).toBe(50);
  });

  it("returns a value in (0,100) for a mixed series", () => {
    const closes = [
      44, 44.25, 44.5, 43.75, 44.5, 45, 45.5, 45.25, 46, 47, 46.75, 46.5, 46, 46.25, 47, 47.5,
    ];
    const v = rsi14(closes);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(0);
    expect(v!).toBeLessThan(100);
  });

  it("returns null when any close is non-finite", () => {
    const closes = Array.from({ length: 20 }, (_, i) => (i === 5 ? NaN : 100 + i));
    expect(rsi14(closes)).toBeNull();
  });
});
