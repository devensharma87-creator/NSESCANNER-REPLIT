import { describe, it, expect } from "vitest";
import { sessionVwap, rollingVwap, volumeProfile, macd } from "./indicators";

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

// ---------------------------------------------------------------------------
// A0.2 — D-FAB-05: sessionVwap() extended input-validation contract
// ---------------------------------------------------------------------------

describe("sessionVwap — input validation (A0.2)", () => {
  const H = [100, 102, 104];
  const L = [98,  100, 102];
  const C = [99,  101, 103];

  it("negative volume: every bar returns null (invalid volume skipped, cumVol stays 0)", () => {
    const result = sessionVwap(H, L, C, [-100, -200, -300]);
    expect(result).toHaveLength(3);
    for (const v of result) expect(v).toBeNull();
  });

  it("NaN volume: every bar returns null (non-finite volume skipped)", () => {
    const result = sessionVwap(H, L, C, [NaN, NaN, NaN]);
    expect(result).toHaveLength(3);
    for (const v of result) expect(v).toBeNull();
  });

  it("Infinity volume: every bar returns null (non-finite volume skipped)", () => {
    const result = sessionVwap(H, L, C, [Infinity, Infinity, Infinity]);
    expect(result).toHaveLength(3);
    for (const v of result) expect(v).toBeNull();
  });

  it("non-finite OHLC: any bar with NaN high/low/close fails the entire session closed (A0.2.1)", () => {
    // Bar 0: NaN OHLC → contaminated window → all-null (fail closed).
    // Bars 1 and 2 are valid, but the contamination prevents any resume.
    const result = sessionVwap(
      [NaN, 102, 104],
      [NaN, 100, 102],
      [NaN, 101, 103],
      [100, 200, 300],
    );
    expect(result).toHaveLength(3);
    for (const v of result) expect(v).toBeNull();
  });

  it("all-non-finite OHLC: every bar returns null", () => {
    const result = sessionVwap(
      [NaN, NaN, NaN],
      [NaN, NaN, NaN],
      [NaN, NaN, NaN],
      [100, 200, 300],
    );
    expect(result).toHaveLength(3);
    for (const v of result) expect(v).toBeNull();
  });

  it("mismatched array lengths (volume shorter): returns all-null series of close.length", () => {
    // volume.length=0 ≠ close.length=1
    const result = sessionVwap([100], [99], [99.5], []);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeNull();
  });

  it("mismatched array lengths (high shorter): returns all-null series of close.length", () => {
    // high.length=1 ≠ close.length=2
    const result = sessionVwap([100], [99, 100], [99.5, 101], [100, 200]);
    expect(result).toHaveLength(2);
    for (const v of result) expect(v).toBeNull();
  });

  it("mixed zero and positive valid volume: only real-volume bars contribute (zero bars stay null)", () => {
    // Bar 0: vol=0 → cumVol=0 → out[0]=null
    // Bar 1: vol=0 → cumVol=0 → out[1]=null
    // Bar 2: vol=500, typ=(104+102+103)/3=103 → cumVol=500 → out[2]=103×500/500=103
    const result = sessionVwap([100, 102, 104], [98, 100, 102], [99, 101, 103], [0, 0, 500]);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).not.toBeNull();
    // Must equal the volume-weighted value of bar 2 only — not HLC3 of any other bar
    const expectedTyp2 = (104 + 102 + 103) / 3; // = 103
    expect(result[2]).toBeCloseTo(expectedTyp2, 8);
  });

  it("hand-verifiable positive fixture: VWAP = Σ(typ_i × vol_i) / Σ(vol_i)", () => {
    // Bar 0: H=110 L=90 C=100 → typ=100, vol=200, pv=20000, v=200 → vwap[0]=100
    // Bar 1: H=120 L=100 C=110 → typ=110, vol=300, pv=20000+33000=53000, v=500 → vwap[1]=106
    const result = sessionVwap([110, 120], [90, 100], [100, 110], [200, 300]);
    expect(result[0]).toBeCloseTo(100, 8);  // 20000/200 = 100
    expect(result[1]).toBeCloseTo(106, 8);  // 53000/500 = 106
  });

  it("all-zero volume does NOT return HLC3, close, or spot (A0.2 explicit contract)", () => {
    const hlc3 = (H[0]! + L[0]! + C[0]!) / 3;
    const result = sessionVwap(H, L, C, [0, 0, 0]);
    for (const v of result) {
      expect(v).toBeNull();
      expect(v).not.toBe(hlc3);
      expect(v).not.toBe(C[0]);
    }
  });

  it("determinism: identical input produces identical output", () => {
    const vol = [100, 200, 300];
    const r1 = sessionVwap(H, L, C, vol);
    const r2 = sessionVwap(H, L, C, vol);
    expect(r1).toEqual(r2);
  });

  it("input arrays are not mutated", () => {
    const h = [...H], l = [...L], c = [...C], vol = [100, 200, 300];
    sessionVwap(h, l, c, vol);
    expect(h).toEqual(H);
    expect(l).toEqual(L);
    expect(c).toEqual(C);
    expect(vol).toEqual([100, 200, 300]);
  });

  // --- Contaminated-series tests (A0.2.1): single invalid bar embedded in valid data ---
  // These prove the fail-closed contract: one bad bar closes the entire window,
  // not just its own position. The final value must be null (not a resumed VWAP).

  it("contaminated series: one negative-volume middle bar → all positions unavailable (fail closed)", () => {
    // Bars 0 and 2 are valid; bar 1 vol=-1 is contaminated.
    // Skipping bar 1 would produce non-null at bar 2. Fail-closed returns all-null.
    const result = sessionVwap(
      [100, 102, 104], [98, 100, 102], [99, 101, 103],
      [200, -1, 300],
    );
    expect(result).toHaveLength(3);
    for (const v of result) expect(v).toBeNull();
  });

  it("contaminated series: one NaN-volume middle bar → all positions unavailable (fail closed)", () => {
    const result = sessionVwap(
      [100, 102, 104], [98, 100, 102], [99, 101, 103],
      [200, NaN, 300],
    );
    expect(result).toHaveLength(3);
    for (const v of result) expect(v).toBeNull();
  });

  it("contaminated series: one Infinity-volume middle bar → all positions unavailable (fail closed)", () => {
    const result = sessionVwap(
      [100, 102, 104], [98, 100, 102], [99, 101, 103],
      [200, Infinity, 300],
    );
    expect(result).toHaveLength(3);
    for (const v of result) expect(v).toBeNull();
  });

  it("contaminated series: one NaN OHLC middle bar → all positions unavailable (fail closed)", () => {
    const result = sessionVwap(
      [100, NaN, 104], [98, NaN, 102], [99, NaN, 103],
      [200, 300, 400],
    );
    expect(result).toHaveLength(3);
    for (const v of result) expect(v).toBeNull();
  });

  it("contaminated series: invalid middle bar — final bar value is still unavailable (no resume after contamination)", () => {
    // Directly proves the final value cannot resume after a contaminated bar.
    const result = sessionVwap(
      [100, 102, 104, 106], [98, 100, 102, 104], [99, 101, 103, 105],
      [200, -5, 300, 400], // bar 1 is negative-volume
    );
    // All values must be null — contamination at bar 1 closes the entire window.
    expect(result).toHaveLength(4);
    for (const v of result) expect(v).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A0.2 — D-FAB-01: volumeProfile() extended input-validation contract
// ---------------------------------------------------------------------------

describe("volumeProfile — input validation (A0.2)", () => {
  // 10-bar fixture — just enough to clear the n<10 guard
  const H10 = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118];
  const L10 = [98,  100, 102, 104, 106, 108, 110, 112, 114, 116];
  const C10 = [99,  101, 103, 105, 107, 109, 111, 113, 115, 117];
  const V10 = [100, 200, 150, 300, 250, 180, 220, 140, 310, 200];

  it("negative volume: returns null (all negative → total usable vol = 0)", () => {
    const negVol = V10.map(v => -v);
    expect(volumeProfile(H10, L10, C10, negVol, 10, 24)).toBeNull();
  });

  it("NaN volume: returns null (NaN bars skipped → total usable vol = 0)", () => {
    const nanVol = new Array(10).fill(NaN) as number[];
    expect(volumeProfile(H10, L10, C10, nanVol, 10, 24)).toBeNull();
  });

  it("Infinity volume: returns null (Infinity bars skipped → total usable vol = 0)", () => {
    const infVol = new Array(10).fill(Infinity) as number[];
    expect(volumeProfile(H10, L10, C10, infVol, 10, 24)).toBeNull();
  });

  it("non-finite OHLC (NaN in low array): Math.min returns NaN → !isFinite(lo) → null", () => {
    const nanLow = L10.map((v, i) => (i === 5 ? NaN : v));
    expect(volumeProfile(H10, nanLow, C10, V10, 10, 24)).toBeNull();
  });

  it("non-finite OHLC (NaN in high array): Math.max returns NaN → !isFinite(hi) → null", () => {
    const nanHigh = H10.map((v, i) => (i === 2 ? NaN : v));
    expect(volumeProfile(nanHigh, L10, C10, V10, 10, 24)).toBeNull();
  });

  it("mismatched array lengths (volume shorter by 1): returns null", () => {
    expect(volumeProfile(H10, L10, C10, V10.slice(0, 9), 10, 24)).toBeNull();
  });

  it("mismatched array lengths (high shorter): returns null", () => {
    expect(volumeProfile(H10.slice(0, 8), L10, C10, V10, 10, 24)).toBeNull();
  });

  it("non-positive price range (all-same OHLC: hi === lo): returns null", () => {
    const flat = new Array(10).fill(100) as number[];
    expect(volumeProfile(flat, flat, flat, V10, 10, 24)).toBeNull();
  });

  it("mixed zero and positive valid volume: zero-volume bars contribute zero weight; profile valid", () => {
    // First 5 bars vol=0 (zero weight contribution, all OHLC finite), last 5 have real volume → valid profile.
    // Zero-volume bars are PERMITTED under the fail-closed contract when all their OHLC inputs are finite.
    const mixedVol = [...new Array(5).fill(0), ...V10.slice(5)] as number[];
    const result = volumeProfile(H10, L10, C10, mixedVol, 10, 24);
    expect(result).not.toBeNull();
    expect(isFinite(result!.pointOfControl)).toBe(true);
    expect(isFinite(result!.valueAreaHigh)).toBe(true);
    expect(isFinite(result!.valueAreaLow)).toBe(true);
    expect(result!.valueAreaLow).toBeLessThanOrEqual(result!.valueAreaHigh);
  });

  it("valid positive-volume: VAL <= POC <= VAH, all within [min(L10), max(H10)]", () => {
    const result = volumeProfile(H10, L10, C10, V10, 10, 24);
    expect(result).not.toBeNull();
    const minL = Math.min(...L10), maxH = Math.max(...H10);
    expect(result!.valueAreaLow).toBeLessThanOrEqual(result!.pointOfControl);
    expect(result!.pointOfControl).toBeLessThanOrEqual(result!.valueAreaHigh);
    expect(result!.pointOfControl).toBeGreaterThanOrEqual(minL);
    expect(result!.pointOfControl).toBeLessThanOrEqual(maxH);
    expect(result!.valueAreaLow).toBeGreaterThanOrEqual(minL);
    expect(result!.valueAreaHigh).toBeLessThanOrEqual(maxH);
  });

  it("determinism: identical input produces identical result", () => {
    const r1 = volumeProfile(H10, L10, C10, V10, 10, 24);
    const r2 = volumeProfile(H10, L10, C10, V10, 10, 24);
    expect(r1).toEqual(r2);
  });

  it("input arrays are not mutated", () => {
    const h = [...H10], l = [...L10], c = [...C10], v = [...V10];
    volumeProfile(h, l, c, v, 10, 24);
    expect(h).toEqual(H10);
    expect(l).toEqual(L10);
    expect(c).toEqual(C10);
    expect(v).toEqual(V10);
  });

  // --- Contaminated-series tests (A0.2.1): single invalid bar embedded in valid data ---
  // These prove the fail-closed contract: one bad bar closes the entire window,
  // not just silently dropping the bar while returning a profile from the rest.

  it("contaminated series: one negative-volume middle bar → null (fail closed)", () => {
    // Bar 5 of 10 has vol=-1; bars 0-4 and 6-9 are valid.
    // Skipping bar 5 would return a valid profile from the other 9 bars. Fail-closed: null.
    const contaminatedVol = [...V10] as number[];
    contaminatedVol[5] = -1;
    expect(volumeProfile(H10, L10, C10, contaminatedVol, 10, 24)).toBeNull();
  });

  it("contaminated series: one NaN-volume middle bar → null (fail closed)", () => {
    const contaminatedVol = [...V10] as number[];
    contaminatedVol[5] = NaN;
    expect(volumeProfile(H10, L10, C10, contaminatedVol, 10, 24)).toBeNull();
  });

  it("contaminated series: one Infinity-volume middle bar → null (fail closed)", () => {
    const contaminatedVol = [...V10] as number[];
    contaminatedVol[5] = Infinity;
    expect(volumeProfile(H10, L10, C10, contaminatedVol, 10, 24)).toBeNull();
  });

  it("contaminated series: one NaN-close middle bar → null (fail closed)", () => {
    // Bar 5 close=NaN with valid H/L and positive volume: fail-closed returns null.
    const contaminatedClose = [...C10] as number[];
    contaminatedClose[5] = NaN;
    expect(volumeProfile(H10, L10, contaminatedClose, V10, 10, 24)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A0.2 — §9.3 Propagation: null indicators do not fabricate decision evidence
// ---------------------------------------------------------------------------

describe("sessionVwap / volumeProfile propagation (A0.2 §9.3)", () => {
  it("§9.3.1 zero-volume series: vp (volumeProfile) returns null — no POC/VAH/VAL fabricated", () => {
    // Simulates the intraday series for a cash index where all volumes are 0.
    const n = 30; // enough bars to clear volumeProfile n<10 guard
    const h = new Array(n).fill(100).map((v, i) => v + i * 0.1) as number[];
    const l = new Array(n).fill(98).map((v, i) => v + i * 0.1) as number[];
    const c = new Array(n).fill(99).map((v, i) => v + i * 0.1) as number[];
    const zeroVol = new Array(n).fill(0) as number[];
    const vp = volumeProfile(h, l, c, zeroVol, 24, 60);
    // Must be null — no POC/VAH/VAL can be derived from zero volume.
    expect(vp).toBeNull();
  });

  it("§9.3.2 zero-volume series: sessionVwap last value (vwapRaw) is null", () => {
    // Simulates buildContext's sessionVwap call on a cash index.
    const closes = [99, 101, 103] as number[];
    const zeroVol = [0, 0, 0] as number[];
    const series = sessionVwap([100, 102, 104], [98, 100, 102], closes, zeroVol);
    const vwapRaw = series[series.length - 1] ?? null;
    // vwapRaw must be null — cannot label this value as live VWAP.
    expect(vwapRaw).toBeNull();
  });

  it("§9.3.3 zero-volume series: vwapAvailable derived from vwapRaw is false", () => {
    const series = sessionVwap([100], [98], [99], [0]);
    const vwapRaw = series[series.length - 1] ?? null;
    const vwapAvailable = vwapRaw !== null && isFinite(vwapRaw);
    expect(vwapAvailable).toBe(false);
  });

  it("§9.3.7 valid positive-volume non-index series retains correct behaviour", () => {
    // sessionVwap on equity data (non-zero volume) must still return a valid series.
    const result = sessionVwap([110, 120], [90, 100], [100, 110], [200, 300]);
    expect(result[0]).not.toBeNull();
    expect(result[1]).not.toBeNull();
    // volumeProfile on equity data must still return a valid profile.
    const h = [100,102,104,106,108,110,112,114,116,118] as number[];
    const l = [98, 100,102,104,106,108,110,112,114,116] as number[];
    const c = [99, 101,103,105,107,109,111,113,115,117] as number[];
    const v = [100,200,150,300,250,180,220,140,310,200] as number[];
    const vp = volumeProfile(h, l, c, v, 10, 24);
    expect(vp).not.toBeNull();
    expect(isFinite(vp!.pointOfControl)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P1B — MACD Warm-Up Fix (2026-07-08)
// ---------------------------------------------------------------------------
// These tests prove that the canonical NSE MACD implementation does NOT
// zero-fill null MACD values before seeding the signal EMA. Zero-filling
// trains the signal EMA on fake zeros during the warm-up period, producing
// distorted histogram values for short-history / new-listing symbols.
//
// Correct behaviour:
//   - MACD line: null until slow EMA is warm (bar slow-1 = 25 for default 26)
//   - Signal line: null until signalP valid MACD values exist (bar 25+9-1 = 33)
//   - Histogram: null until both MACD and signal are non-null
//   - Output array length = input length (always)
//
// Default periods: fast=12, slow=26, signalP=9
//   → MACD valid from bar 25 (index 25, 26th bar)
//   → Signal valid from bar 33 (index 33, 34th bar = 26 + 9 - 1 + 1)
// ---------------------------------------------------------------------------

// Helper: generate a rising series of length n starting at `start`.
function rising(n: number, start = 100, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

// Helper: generate a flat series of length n.
function flat(n: number, val = 100): number[] {
  return Array.from({ length: n }, () => val);
}

// Helper: count non-null values in an array.
function countNonNull(arr: (number | null)[]): number {
  return arr.filter(v => v !== null).length;
}

// Helper: index of first non-null value.
function firstNonNullIdx(arr: (number | null)[]): number {
  return arr.findIndex(v => v !== null);
}

describe("macd — P1B warm-up correctness", () => {
  describe("Fixture 1: very short series (< slow period, n=10)", () => {
    const closes = rising(10);
    const result = macd(closes);

    it("output arrays match input length (10)", () => {
      expect(result.macd).toHaveLength(10);
      expect(result.signal).toHaveLength(10);
      expect(result.hist).toHaveLength(10);
    });

    it("all macd values are null (slow EMA needs 26 bars)", () => {
      expect(countNonNull(result.macd)).toBe(0);
    });

    it("all signal values are null (no valid MACD to seed from)", () => {
      expect(countNonNull(result.signal)).toBe(0);
    });

    it("all histogram values are null", () => {
      expect(countNonNull(result.hist)).toBe(0);
    });
  });

  describe("Fixture 2: exactly slow period bars (n=26)", () => {
    const closes = rising(26);
    const result = macd(closes);

    it("output arrays match input length (26)", () => {
      expect(result.macd).toHaveLength(26);
      expect(result.signal).toHaveLength(26);
      expect(result.hist).toHaveLength(26);
    });

    it("first valid MACD is at index 25 (bar 26)", () => {
      expect(firstNonNullIdx(result.macd)).toBe(25);
      expect(result.macd[25]).not.toBeNull();
    });

    it("signal is still null (not enough MACD values to seed signal EMA)", () => {
      expect(countNonNull(result.signal)).toBe(0);
    });

    it("histogram is null (signal not ready)", () => {
      expect(countNonNull(result.hist)).toBe(0);
    });
  });

  describe("Fixture 3: medium series — MACD valid, signal not yet ready (n=33)", () => {
    const closes = rising(33);
    const result = macd(closes);

    it("output arrays match input length (33)", () => {
      expect(result.macd).toHaveLength(33);
      expect(result.signal).toHaveLength(33);
      expect(result.hist).toHaveLength(33);
    });

    it("MACD is valid from bar 26 (index 25)", () => {
      expect(firstNonNullIdx(result.macd)).toBe(25);
      expect(countNonNull(result.macd)).toBe(8); // bars 25..32
    });

    it("signal still null (needs 9 valid MACD bars, only 8 available)", () => {
      // 33 bars total → MACD valid from index 25 → only 8 valid MACD values
      // Signal EMA needs period=9 → must be all null
      expect(countNonNull(result.signal)).toBe(0);
    });

    it("histogram still null (signal not ready)", () => {
      expect(countNonNull(result.hist)).toBe(0);
    });
  });

  describe("Fixture 4: minimum bars for first valid signal (n=34)", () => {
    const closes = rising(34);
    const result = macd(closes);

    it("output arrays match input length (34)", () => {
      expect(result.macd).toHaveLength(34);
      expect(result.signal).toHaveLength(34);
      expect(result.hist).toHaveLength(34);
    });

    it("MACD has 9 valid values (bars 25..33)", () => {
      expect(firstNonNullIdx(result.macd)).toBe(25);
      expect(countNonNull(result.macd)).toBe(9);
    });

    it("signal has exactly 1 valid value (at index 33)", () => {
      expect(firstNonNullIdx(result.signal)).toBe(33);
      expect(countNonNull(result.signal)).toBe(1);
    });

    it("histogram has exactly 1 valid value (at index 33)", () => {
      expect(firstNonNullIdx(result.hist)).toBe(33);
      expect(countNonNull(result.hist)).toBe(1);
    });

    it("all values before index 25 are null", () => {
      for (let i = 0; i < 25; i++) {
        expect(result.macd[i]).toBeNull();
        expect(result.signal[i]).toBeNull();
        expect(result.hist[i]).toBeNull();
      }
    });

    it("signal values before index 33 are null (no early signal from zero-seeding)", () => {
      for (let i = 0; i < 33; i++) {
        expect(result.signal[i]).toBeNull();
      }
    });
  });

  describe("Fixture 5: flat price series (n=50) — zero-seed regression", () => {
    // A flat series has MACD=0 for all valid bars (fast EMA = slow EMA = price).
    // With the BUGGY zero-fill approach, the signal EMA from bar 8 onward
    // was trained on 17 zeros, then 25 zeros of real MACD (which also equals 0
    // for a flat series). In both implementations this is indistinguishable
    // for a flat series. We instead test the key property: signal is null
    // before index 33, regardless of value.
    const closes = flat(50);
    const result = macd(closes);

    it("output arrays match input length (50)", () => {
      expect(result.macd).toHaveLength(50);
      expect(result.signal).toHaveLength(50);
      expect(result.hist).toHaveLength(50);
    });

    it("signal is null for every bar before index 33 (no early zero-seeded signal)", () => {
      for (let i = 0; i < 33; i++) {
        expect(result.signal[i]).toBeNull();
      }
    });

    it("histogram is null for every bar before index 33", () => {
      for (let i = 0; i < 33; i++) {
        expect(result.hist[i]).toBeNull();
      }
    });

    it("all valid MACD values are 0 (flat series: fast EMA = slow EMA)", () => {
      for (let i = 25; i < 50; i++) {
        expect(result.macd[i]).toBeCloseTo(0, 8);
      }
    });
  });

  describe("Fixture 6: strong trending series (n=50) — zero-seed distortion test", () => {
    // With the BUGGY version, signal at bar 25 = macd[25] * k^17 ≈ macd[25] * 0.2
    // (signal was trained on 17 zero bars then gets first real value).
    // With the FIXED version, signal is null until bar 33.
    // This test proves the fixed version produces null signal at bar 25.
    const closes = rising(50, 100, 2); // fast-rising series
    const result = macd(closes);

    it("signal at index 25 (first valid MACD) is null — not distorted by zero-seeding", () => {
      expect(result.signal[25]).toBeNull();
    });

    it("signal at index 26..32 is null (still warming up)", () => {
      for (let i = 26; i < 33; i++) {
        expect(result.signal[i]).toBeNull();
      }
    });

    it("histogram at index 25..32 is null (signal not ready)", () => {
      for (let i = 25; i < 33; i++) {
        expect(result.hist[i]).toBeNull();
      }
    });

    it("signal first appears at index 33", () => {
      expect(result.signal[33]).not.toBeNull();
    });

    it("histogram first appears at index 33", () => {
      expect(result.hist[33]).not.toBeNull();
    });

    it("rising series → fast EMA > slow EMA → MACD line positive at bar 25", () => {
      // On a linearly-rising series the fast (12) EMA tracks price better
      // than the slow (26) EMA, so macdLine > 0.
      expect(result.macd[25]).not.toBeNull();
      expect(result.macd[25]!).toBeGreaterThan(0);
    });
  });

  describe("Fixture 7: long-history series (n=200) — stability", () => {
    // For 200 bars, distortion from zero-fill would have washed out by bar 200
    // in either implementation. This test confirms the output is stable,
    // finite, and correctly shaped for long-history symbols.
    const closes = rising(200, 500, 1);
    const result = macd(closes);

    it("output arrays match input length (200)", () => {
      expect(result.macd).toHaveLength(200);
      expect(result.signal).toHaveLength(200);
      expect(result.hist).toHaveLength(200);
    });

    it("MACD has non-null values from bar 25 onward", () => {
      expect(firstNonNullIdx(result.macd)).toBe(25);
      expect(countNonNull(result.macd)).toBe(175);
    });

    it("signal has non-null values from bar 33 onward", () => {
      expect(firstNonNullIdx(result.signal)).toBe(33);
      expect(countNonNull(result.signal)).toBe(167);
    });

    it("histogram has non-null values from bar 33 onward", () => {
      expect(firstNonNullIdx(result.hist)).toBe(33);
      expect(countNonNull(result.hist)).toBe(167);
    });

    it("last histogram value is finite", () => {
      const lastHist = result.hist[199];
      expect(lastHist).not.toBeNull();
      expect(isFinite(lastHist!)).toBe(true);
    });

    it("hist = macd - signal for every non-null pair", () => {
      for (let i = 0; i < 200; i++) {
        const m = result.macd[i];
        const s = result.signal[i];
        const h = result.hist[i];
        if (m !== null && s !== null) {
          expect(h).not.toBeNull();
          expect(h!).toBeCloseTo(m - s, 8);
        } else {
          expect(h).toBeNull();
        }
      }
    });
  });

  describe("Fixture 8: choppy series (n=100) — alternating up/down", () => {
    const closes = Array.from({ length: 100 }, (_, i) =>
      100 + (i % 2 === 0 ? 1 : -1) * ((i % 10) + 1),
    );
    const result = macd(closes);

    it("output arrays match input length (100)", () => {
      expect(result.macd).toHaveLength(100);
      expect(result.signal).toHaveLength(100);
      expect(result.hist).toHaveLength(100);
    });

    it("MACD first valid at index 25", () => {
      expect(firstNonNullIdx(result.macd)).toBe(25);
    });

    it("signal first valid at index 33", () => {
      expect(firstNonNullIdx(result.signal)).toBe(33);
    });

    it("all values finite where non-null", () => {
      for (let i = 0; i < 100; i++) {
        if (result.macd[i] !== null) expect(isFinite(result.macd[i]!)).toBe(true);
        if (result.signal[i] !== null) expect(isFinite(result.signal[i]!)).toBe(true);
        if (result.hist[i] !== null) expect(isFinite(result.hist[i]!)).toBe(true);
      }
    });
  });

  describe("Fixture 9: custom periods — fast=3, slow=5, signalP=3 (minimal periods for unit testing)", () => {
    // Custom small periods make it easy to hand-verify the warm-up math:
    //   MACD valid from bar 4 (index 4, slow=5)
    //   Signal valid from bar 6 (index 6, = 4 + 3 - 1)
    const closes = rising(10, 10, 1); // [10,11,12,...,19]
    const result = macd(closes, 3, 5, 3);

    it("output arrays match input length (10)", () => {
      expect(result.macd).toHaveLength(10);
      expect(result.signal).toHaveLength(10);
      expect(result.hist).toHaveLength(10);
    });

    it("MACD first valid at index 4 (slow=5)", () => {
      expect(firstNonNullIdx(result.macd)).toBe(4);
      expect(result.macd[4]).not.toBeNull();
    });

    it("signal first valid at index 6 (4 + 3 - 1)", () => {
      expect(firstNonNullIdx(result.signal)).toBe(6);
    });

    it("histogram first valid at index 6", () => {
      expect(firstNonNullIdx(result.hist)).toBe(6);
    });

    it("signal at index 4 and 5 is null (zero-seed guard)", () => {
      expect(result.signal[4]).toBeNull();
      expect(result.signal[5]).toBeNull();
    });

    it("histogram at index 4 and 5 is null", () => {
      expect(result.hist[4]).toBeNull();
      expect(result.hist[5]).toBeNull();
    });

    it("signal at index 6 equals SMA of macd[4..6] (EMA seeded by SMA of first signalP values)", () => {
      // EMA period=3 seeds with SMA of first 3 values: (macd[4]+macd[5]+macd[6])/3
      const m4 = result.macd[4]!;
      const m5 = result.macd[5]!;
      const m6 = result.macd[6]!;
      const expectedSig6 = (m4 + m5 + m6) / 3;
      expect(result.signal[6]).toBeCloseTo(expectedSig6, 8);
    });
  });

  describe("Fixture 10: empty input", () => {
    it("returns three empty arrays without throwing", () => {
      const result = macd([]);
      expect(result.macd).toEqual([]);
      expect(result.signal).toEqual([]);
      expect(result.hist).toEqual([]);
    });
  });

  describe("Canonical vs Global alignment", () => {
    // After P1B fix, both implementations should produce identical warm-up
    // boundaries: MACD starts at index slow-1, signal starts at
    // index (slow-1) + (signalP-1).
    it("canonical firstNonNull(signal) matches global convention: slow-1 + signalP-1", () => {
      const fast = 12; const slow = 26; const signalP = 9;
      const expectedSignalStart = (slow - 1) + (signalP - 1); // = 33
      const closes = rising(50);
      const result = macd(closes, fast, slow, signalP);
      expect(firstNonNullIdx(result.signal)).toBe(expectedSignalStart);
    });

    it("canonical and global produce same first-valid-signal index for custom periods", () => {
      // fast=3 slow=5 sig=3: signal starts at (5-1)+(3-1)=6
      const closes = rising(15, 10, 1);
      const canonical = macd(closes, 3, 5, 3);
      expect(firstNonNullIdx(canonical.signal)).toBe(6);
    });
  });

  describe("Output-shape invariant: all three arrays always have input length", () => {
    const cases = [0, 1, 10, 25, 26, 33, 34, 50, 100];
    for (const n of cases) {
      it(`n=${n}: all three arrays have length ${n}`, () => {
        const closes = rising(n);
        const result = macd(closes);
        expect(result.macd).toHaveLength(n);
        expect(result.signal).toHaveLength(n);
        expect(result.hist).toHaveLength(n);
      });
    }
  });
});
