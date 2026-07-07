import { describe, it, expect } from "vitest";
import { sessionVwap, rollingVwap, volumeProfile } from "./indicators";

// ---------------------------------------------------------------------------
// P0-2 Zero-Volume VWAP / Volume Profile Honesty
// ---------------------------------------------------------------------------
// These tests verify that VWAP and volumeProfile return null (never a fake
// HLC3/close/degenerate value) when candle volume is zero. This is the
// structural reality for NIFTY/BANKNIFTY/SENSEX cash-index Kite candles.
// ---------------------------------------------------------------------------

describe("sessionVwap — zero-volume guard", () => {
  const H = [100, 102, 104];
  const L = [98,  100, 102];
  const C = [99,  101, 103];
  const zeroVol = [0, 0, 0];
  const realVol = [1000, 2000, 3000];

  it("returns null for every bar when ALL volume is 0", () => {
    const result = sessionVwap(H, L, C, zeroVol);
    expect(result).toHaveLength(3);
    for (const v of result) expect(v).toBeNull();
  });

  it("returns null for bars where cumulative volume is still 0", () => {
    // First two bars zero, third has real volume → only index 2 non-null
    const vol = [0, 0, 500];
    const result = sessionVwap(H, L, C, vol);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).not.toBeNull();
  });

  it("returns a valid VWAP series (non-null) when volume is real", () => {
    const result = sessionVwap(H, L, C, realVol);
    expect(result).toHaveLength(3);
    for (const v of result) {
      expect(v).not.toBeNull();
      expect(typeof v).toBe("number");
      expect(isFinite(v!)).toBe(true);
    }
  });

  it("does NOT return HLC3 when volume is 0 (the old buggy behaviour)", () => {
    // Old code returned HLC3 = (H+L+C)/3 for zero-volume bars
    const hlc3Bar0 = (H[0] + L[0] + C[0]) / 3;
    const result = sessionVwap(H, L, C, zeroVol);
    expect(result[0]).not.toBe(hlc3Bar0);
    expect(result[0]).toBeNull();
  });

  it("handles empty arrays without throwing", () => {
    const result = sessionVwap([], [], [], []);
    expect(result).toEqual([]);
  });

  it("handles mismatched-length arrays gracefully", () => {
    expect(() => sessionVwap([100], [99], [99.5], [])).not.toThrow();
  });
});

describe("rollingVwap — zero-volume guard", () => {
  // rollingVwap is a SCALAR function: returns number | null (not an array).
  // It computes a rolling VWAP over the last `lookback` bars using the full
  // provided arrays as input. Returns null when total volume over the window is 0.
  const H = [100, 102, 104, 106, 108];
  const L = [98,  100, 102, 104, 106];
  const C = [99,  101, 103, 105, 107];
  const zeroVol = [0, 0, 0, 0, 0];
  const realVol = [100, 200, 150, 300, 250];

  it("returns null when ALL volume is 0 (regardless of window)", () => {
    const result = rollingVwap(H, L, C, zeroVol, 3);
    expect(result).toBeNull();
  });

  it("returns null when empty arrays provided", () => {
    expect(rollingVwap([], [], [], [], 3)).toBeNull();
  });

  it("does NOT return a close-price when volume is 0 (the old buggy behaviour)", () => {
    // Old code returned pv/v = HLC3 when v=0, which is NaN/close.
    const result = rollingVwap(H, L, C, zeroVol, 5);
    // Must be null, never a number
    expect(result).toBeNull();
    // And definitely not the last close (99, 101, 103, 105, 107)
    expect(result).not.toBe(C[C.length - 1]);
  });

  it("returns a valid VWAP scalar when volume is real", () => {
    const result = rollingVwap(H, L, C, realVol, 3);
    expect(result).not.toBeNull();
    expect(typeof result).toBe("number");
    expect(isFinite(result!)).toBe(true);
    expect(result!).toBeGreaterThan(0);
    // Should be in the range of the input prices
    expect(result!).toBeGreaterThanOrEqual(Math.min(...L));
    expect(result!).toBeLessThanOrEqual(Math.max(...H));
  });

  it("window=1 with a single zero-volume last bar still returns null", () => {
    // Last bar has vol=0, even though prior bars have real volume
    const vol = [100, 200, 0];
    const result = rollingVwap(
      H.slice(0, 3), L.slice(0, 3), C.slice(0, 3), vol, 1,
    );
    expect(result).toBeNull();
  });
});

describe("volumeProfile — zero-volume guard", () => {
  const H = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118];
  const L = [98,  100, 102, 104, 106, 108, 110, 112, 114, 116];
  const C = [99,  101, 103, 105, 107, 109, 111, 113, 115, 117];
  const zeroVol = new Array(10).fill(0);
  const realVol = [100, 200, 150, 300, 250, 180, 220, 140, 310, 200];

  it("returns null when ALL volume is 0", () => {
    const result = volumeProfile(H, L, C, zeroVol, 10, 24);
    expect(result).toBeNull();
  });

  it("returns null for insufficient data (< lookback bars)", () => {
    const result = volumeProfile(H.slice(0, 3), L.slice(0, 3), C.slice(0, 3), realVol.slice(0, 3), 10, 24);
    expect(result).toBeNull();
  });

  it("does NOT return a degenerate all-zero-bucket profile (old buggy behaviour)", () => {
    // Old code would return a VolumeProfile with all buckets vol=0 and
    // a spurious POC = midprice of the first bucket
    const result = volumeProfile(H, L, C, zeroVol, 10, 24);
    // Must be null, never an object with totalVol=0
    expect(result).toBeNull();
  });

  it("returns a valid profile when volume is real", () => {
    const result = volumeProfile(H, L, C, realVol, 10, 24);
    expect(result).not.toBeNull();
    if (result) {
      // VolumeProfile has three exported fields: pointOfControl, valueAreaHigh, valueAreaLow
      expect(isFinite(result.pointOfControl)).toBe(true);
      expect(isFinite(result.valueAreaHigh)).toBe(true);
      expect(isFinite(result.valueAreaLow)).toBe(true);
      // POC should be within the high/low range of the data
      expect(result.pointOfControl).toBeGreaterThanOrEqual(Math.min(...L));
      expect(result.pointOfControl).toBeLessThanOrEqual(Math.max(...H));
      // Value area ordering
      expect(result.valueAreaLow).toBeLessThanOrEqual(result.valueAreaHigh);
    }
  });

  it("handles empty arrays without throwing", () => {
    expect(() => volumeProfile([], [], [], [], 10, 24)).not.toThrow();
    expect(volumeProfile([], [], [], [], 10, 24)).toBeNull();
  });
});
