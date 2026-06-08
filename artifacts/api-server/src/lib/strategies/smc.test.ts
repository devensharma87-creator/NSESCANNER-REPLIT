/**
 * Causality / no-repaint tests for the shared SMC engine (`lib/indicators`).
 *
 * The central guarantee: every per-bar SMC value at index i depends ONLY on
 * bars ≤ i. We assert this structurally — recomputing the series over a PREFIX
 * [0..i] must yield exactly the same bar i as the full-window computation.
 */
import { describe, it, expect } from "vitest";
import {
  isPivotHigh,
  isPivotLow,
  structurePass,
  fvgPass,
  swingZonePass,
  sweepPass,
  displacementPass,
  computeSmcSeries,
  DEFAULT_SMC_CONFIG,
  type SmcInput,
} from "@workspace/indicators";

function sliceInput(inp: SmcInput, end: number): SmcInput {
  return {
    open: inp.open.slice(0, end),
    high: inp.high.slice(0, end),
    low: inp.low.slice(0, end),
    close: inp.close.slice(0, end),
    atr14: inp.atr14.slice(0, end),
  };
}

// Deterministic oscillating candles with occasional gaps + displacement spikes.
function makeInput(n = 160): SmcInput {
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  const atr14: (number | null)[] = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const c = 100 + 12 * Math.sin(i / 5) + i * 0.05 + (i % 17 === 0 ? 6 : 0);
    const o = prev;
    open.push(o);
    close.push(c);
    high.push(Math.max(o, c) + 1.0);
    low.push(Math.min(o, c) - 1.0);
    atr14.push(2);
    prev = c;
  }
  return { open, high, low, close, atr14 };
}

describe("isPivotHigh / isPivotLow", () => {
  it("require a strict fractal beyond the span on both sides, bounds-checked", () => {
    const highs = [1, 2, 5, 2, 1];
    const lows = [5, 4, 1, 4, 5];
    expect(isPivotHigh(highs, 2, 2)).toBe(true);
    expect(isPivotLow(lows, 2, 2)).toBe(true);
    // Window runs off either end ⇒ never a pivot.
    expect(isPivotHigh(highs, 1, 2)).toBe(false);
    expect(isPivotHigh(highs, 3, 2)).toBe(false);
    // A tie on one side rejects the strict pivot.
    expect(isPivotHigh([1, 5, 5, 2, 1], 2, 2)).toBe(false);
  });
});

describe("structurePass", () => {
  it("is causal (prefix == full) over the whole window", () => {
    const inp = makeInput();
    const full = structurePass(inp.high, inp.low, inp.close, DEFAULT_SMC_CONFIG.structurePivot);
    for (let i = 0; i < inp.close.length; i++) {
      const s = sliceInput(inp, i + 1);
      const prefix = structurePass(s.high, s.low, s.close, DEFAULT_SMC_CONFIG.structurePivot);
      expect(prefix[i]).toEqual(full[i]);
    }
  });

  it("prints a BOS up, then a down-break after up-structure is a CHoCH", () => {
    // Hand-verified (pivot=1): swing high@1 broken by close@3 (BOS up);
    // swing low@4 broken by close@6 while structure is up (CHoCH down).
    const high = [10, 12, 11, 13, 12, 11, 10];
    const low = [9, 10, 10, 11, 8, 10, 6];
    const close = [9.5, 11, 10.5, 12.5, 9, 10.5, 7];
    const pts = structurePass(high, low, close, 1);
    expect(pts[3]!.bosUp).toBe(true);
    expect(pts[3]!.chochUp).toBe(false);
    expect(pts[3]!.breakHigh).toBe(12);
    expect(pts[6]!.chochDn).toBe(true);
    expect(pts[6]!.bosDn).toBe(false);
    expect(pts[6]!.breakLow).toBe(8);
  });
});

describe("fvgPass", () => {
  it("forms, retests and fills a bull gap with causal mitigation indices", () => {
    // Hand-verified single bull gap: bar2.low (102) > bar0.high (100) ⇒ zone
    // [100,102]. Bar3 dips to 101.3 (inside ⇒ retest); bar4 trades to 99.5
    // (< bottom ⇒ fill). Other bars are shaped to NOT form a second gap.
    const open = [99, 99, 101, 102, 101];
    const high = [100, 101.5, 103, 103, 102.5];
    const low = [98, 99.5, 102, 101.3, 99.5];
    const close = [99.5, 100.5, 103, 102.5, 100];
    const cfg = { ...DEFAULT_SMC_CONFIG, fvgAuto: false, fvgThresholdPct: 0.05 };
    const { zones, perBar } = fvgPass(open, high, low, close, cfg);
    const bull = zones.filter((z) => z.type === "fvgBull");
    expect(bull.length).toBe(1);
    expect(bull[0]!.formedIndex).toBe(2);
    expect(bull[0]!.bottom).toBe(100);
    expect(bull[0]!.top).toBe(102);
    expect(perBar[2]!.bullFormed).toBe(true);
    expect(perBar[2]!.bullPresent).toBe(true);
    // Bar 3 dips to 101.3 — inside (bottom=100, top=102) ⇒ retest, not fill.
    expect(perBar[3]!.bullRetest).toBe(true);
    expect(perBar[3]!.bullFilled).toBe(false);
    // Bar 4 trades to 99.5 < bottom ⇒ fill, zone consumed.
    expect(perBar[4]!.bullFilled).toBe(true);
    expect(bull[0]!.mitigatedIndex).toBe(4);
    expect(perBar[4]!.bullPresent).toBe(false);
  });

  it("is causal: recomputing over each prefix reproduces the same bar", () => {
    const inp = makeInput();
    const cfg = DEFAULT_SMC_CONFIG;
    const full = fvgPass(inp.open, inp.high, inp.low, inp.close, cfg);
    for (let i = 0; i < inp.close.length; i++) {
      const s = sliceInput(inp, i + 1);
      const prefix = fvgPass(s.open, s.high, s.low, s.close, cfg);
      expect(prefix.perBar[i]).toEqual(full.perBar[i]);
    }
  });
});

describe("swingZonePass", () => {
  it("seeds demand/supply at confirmed swings and fires test once (causal)", () => {
    const inp = makeInput();
    const cfg = DEFAULT_SMC_CONFIG;
    const full = swingZonePass(inp.open, inp.high, inp.low, inp.close, inp.atr14, cfg, true);
    for (let i = 0; i < inp.close.length; i++) {
      const s = sliceInput(inp, i + 1);
      const prefix = swingZonePass(s.open, s.high, s.low, s.close, s.atr14, cfg, true);
      expect(prefix.perBar[i]).toEqual(full.perBar[i]);
    }
  });

  it("body bounds do not depend on ATR (parity-stable)", () => {
    const inp = makeInput();
    const cfg = DEFAULT_SMC_CONFIG;
    const a = swingZonePass(inp.open, inp.high, inp.low, inp.close, inp.atr14, cfg, true);
    const atrDifferent = inp.atr14.map(() => 7);
    const b = swingZonePass(inp.open, inp.high, inp.low, inp.close, atrDifferent, cfg, true);
    expect(b.zones).toEqual(a.zones);
    expect(b.perBar).toEqual(a.perBar);
  });
});

describe("sweepPass", () => {
  it("flags a buy-side sweep (pierce a swing high, close back below)", () => {
    // Swing high at index 2 (5). Later bar pierces above then closes below.
    const high = [3, 4, 5, 4, 3, 4, 6];
    const low = [2, 3, 4, 3, 2, 3, 4];
    const close = [2.5, 3.5, 4.5, 3.5, 2.5, 3.5, 4.8]; // last: high 6 > 5 but close 4.8 < 5
    const pts = sweepPass(high, low, close, 1);
    expect(pts[6]!.buySide).toBe(true);
    expect(pts[6]!.level).toBe(5);
  });

  it("is causal over prefixes", () => {
    const inp = makeInput();
    const full = sweepPass(inp.high, inp.low, inp.close, DEFAULT_SMC_CONFIG.sweepPivot);
    for (let i = 0; i < inp.close.length; i++) {
      const s = sliceInput(inp, i + 1);
      const prefix = sweepPass(s.high, s.low, s.close, DEFAULT_SMC_CONFIG.sweepPivot);
      expect(prefix[i]).toEqual(full[i]);
    }
  });
});

describe("displacementPass", () => {
  it("flags a candle whose body ≥ mult×ATR, with direction", () => {
    const open = [100, 100, 100];
    const close = [103, 97, 100.5];
    const atr = [2, 2, 2];
    const pts = displacementPass(open, close, atr, 1.2);
    expect(pts[0]).toEqual({ up: true, down: false }); // body 3 ≥ 2.4
    expect(pts[1]).toEqual({ up: false, down: true }); // body 3 ≥ 2.4
    expect(pts[2]).toEqual({ up: false, down: false }); // body 0.5 < 2.4
  });

  it("fails closed on null/zero ATR (never assumed)", () => {
    expect(displacementPass([100], [110], [null], 1.2)[0]).toEqual({ up: false, down: false });
    expect(displacementPass([100], [110], [0], 1.2)[0]).toEqual({ up: false, down: false });
  });
});

describe("computeSmcSeries", () => {
  it("is causal end-to-end: each prefix reproduces the same final bar", () => {
    const inp = makeInput();
    const full = computeSmcSeries(inp);
    for (let i = 0; i < inp.close.length; i++) {
      const prefix = computeSmcSeries(sliceInput(inp, i + 1));
      expect(prefix[i]).toEqual(full[i]);
    }
  });
});
