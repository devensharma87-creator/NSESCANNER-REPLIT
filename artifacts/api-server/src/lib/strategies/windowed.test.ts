import { describe, it, expect } from "vitest";
import {
  slopeDir,
  crossedUpAt,
  crossedDownAt,
  distancePct,
  withinPct,
  lastConfirmedSwings,
  fibRetracePrice,
  fibExtensionPrice,
} from "@workspace/indicators";

describe("slopeDir", () => {
  it("classifies rising / falling / flat over the lookback", () => {
    const s = [1, 2, 3, 4, 5];
    expect(slopeDir(s, 4, 2)).toBe("rising");
    const d = [5, 4, 3, 2, 1];
    expect(slopeDir(d, 4, 2)).toBe("falling");
    const f = [3, 9, 3, 9, 3];
    expect(slopeDir(f, 4, 2)).toBe("flat");
  });
  it("returns null when the window runs off the start or has a null", () => {
    expect(slopeDir([1, 2], 1, 5)).toBeNull();
    expect(slopeDir([null, 2, 3], 2, 2)).toBeNull();
  });
});

describe("crossedUpAt / crossedDownAt", () => {
  const a = [1, 1, 2, 2];
  const b = [2, 2, 1, 3];
  it("detects an up-cross only at the exact bar", () => {
    expect(crossedUpAt(a, b, 2)).toBe(true); // 1<=2 then 2>1
    expect(crossedUpAt(a, b, 3)).toBe(false); // 2<1 false
  });
  it("detects a down-cross only at the exact bar", () => {
    expect(crossedDownAt(a, b, 3)).toBe(true); // 2>=1 then 2<3
    expect(crossedDownAt(a, b, 2)).toBe(false);
  });
  it("is false at bar 0 and with nulls", () => {
    expect(crossedUpAt(a, b, 0)).toBe(false);
    expect(crossedUpAt([null, 2], [1, 1], 1)).toBe(false);
  });
});

describe("distancePct / withinPct", () => {
  it("computes signed percent distance", () => {
    expect(distancePct(110, 100)).toBeCloseTo(10);
    expect(distancePct(90, 100)).toBeCloseTo(-10);
  });
  it("guards zero ref and nulls", () => {
    expect(distancePct(1, 0)).toBeNull();
    expect(distancePct(null, 100)).toBeNull();
  });
  it("withinPct uses absolute distance", () => {
    expect(withinPct(101, 100, 1.5)).toBe(true);
    expect(withinPct(98, 100, 1.5)).toBe(false);
    expect(withinPct(null, 100, 1.5)).toBe(false);
  });
});

describe("lastConfirmedSwings (no repaint)", () => {
  // A clear peak at idx 5 and trough at idx 11.
  const highs = [10, 11, 12, 13, 14, 20, 14, 13, 12, 11, 10, 9, 10, 11, 12];
  const lows = [9, 10, 11, 12, 13, 19, 13, 12, 11, 10, 9, 3, 9, 10, 11];
  it("only confirms a pivot once span bars have closed after it", () => {
    // span 2: pivot at 5 confirmed at bar 7. At bar 6 it is NOT yet confirmed.
    expect(lastConfirmedSwings(highs, lows, 6, 2).highIdx).toBeNull();
    const at7 = lastConfirmedSwings(highs, lows, 7, 2);
    expect(at7.highIdx).toBe(5);
    expect(at7.highPrice).toBe(20);
  });
  it("finds the most recent confirmed swing low", () => {
    const at13 = lastConfirmedSwings(highs, lows, 13, 2);
    expect(at13.lowIdx).toBe(11);
    expect(at13.lowPrice).toBe(3);
  });
  it("returns nulls when nothing qualifies in range", () => {
    const flat = [5, 5, 5, 5, 5];
    const s = lastConfirmedSwings(flat, flat, 4, 2);
    expect(s.highIdx).toBeNull();
    expect(s.lowIdx).toBeNull();
  });
});

describe("fibRetracePrice / fibExtensionPrice", () => {
  it("retraces an up-impulse down from the high", () => {
    // low 100, high 200, 0.618 retrace = 200 - 61.8 = 138.2
    expect(fibRetracePrice(200, 100, 0.618, "up")).toBeCloseTo(138.2);
  });
  it("retraces a down-impulse up from the low", () => {
    expect(fibRetracePrice(200, 100, 0.382, "down")).toBeCloseTo(138.2);
  });
  it("projects extensions beyond the swing", () => {
    expect(fibExtensionPrice(200, 100, 1.272, "up")).toBeCloseTo(227.2);
    expect(fibExtensionPrice(200, 100, 1.272, "down")).toBeCloseTo(72.8);
  });
  it("guards degenerate swings", () => {
    expect(fibRetracePrice(100, 100, 0.5, "up")).toBeNull();
    expect(fibRetracePrice(null, 100, 0.5, "up")).toBeNull();
  });
});
