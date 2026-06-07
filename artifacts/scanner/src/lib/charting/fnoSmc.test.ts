import { describe, it, expect } from "vitest";
import type { IndicatorCandle } from "./indicators";
import {
  atr,
  rollingStdev,
  vwapWithBands,
  smcStructure,
  supplyDemandZones,
  fnoFvgs,
  alignHtfBias,
  computeFnoSmc,
  DEFAULT_FNO_SMC_PARAMS,
  type FnoSmcParams,
} from "./fnoSmc";

const HOUR = 3600;

function c(
  t: number,
  o: number,
  h: number,
  l: number,
  cl: number,
  v: number | null = 1000,
): IndicatorCandle {
  return { t, o, h, l, c: cl, v };
}

/** A simple deterministic uptrend with volume. */
function uptrend(n: number, start = 100, step = 1): IndicatorCandle[] {
  const out: IndicatorCandle[] = [];
  for (let i = 0; i < n; i++) {
    const base = start + i * step;
    out.push(c(i * HOUR, base, base + 0.5, base - 0.5, base + 0.4, 1000 + i));
  }
  return out;
}

describe("atr", () => {
  it("returns null until the period is satisfied, then a positive value", () => {
    const candles = uptrend(20);
    const a = atr(candles, 14);
    expect(a.slice(0, 13).every(x => x === null)).toBe(true);
    expect(a[13]).not.toBeNull();
    expect(a[13]!).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    expect(atr([], 14)).toEqual([]);
  });
});

describe("rollingStdev", () => {
  it("is null before the window fills and zero for a flat series", () => {
    const flat = new Array(10).fill(5);
    const s = rollingStdev(flat, 5);
    expect(s.slice(0, 4).every(x => x === null)).toBe(true);
    expect(s[4]).toBeCloseTo(0, 10);
  });

  it("matches a hand-computed population stdev", () => {
    // window [2,4,4,4,5,5,7,9] population stdev = 2
    const s = rollingStdev([2, 4, 4, 4, 5, 5, 7, 9], 8);
    expect(s[7]).toBeCloseTo(2, 10);
  });
});

describe("vwapWithBands", () => {
  it("produces bands straddling vwap where volume exists", () => {
    const candles = uptrend(30);
    const { vwap, upper, lower } = vwapWithBands(candles);
    const i = 25;
    expect(vwap[i]).not.toBeNull();
    expect(upper[i]).not.toBeNull();
    expect(lower[i]).not.toBeNull();
    expect(upper[i]!).toBeGreaterThanOrEqual(vwap[i]!);
    expect(lower[i]!).toBeLessThanOrEqual(vwap[i]!);
  });

  it("is honestly null when there is no volume", () => {
    const candles = uptrend(30).map(x => ({ ...x, v: null }));
    const { vwap, upper, lower } = vwapWithBands(candles);
    expect(vwap.every(v => v === null)).toBe(true);
    expect(upper.every(v => v === null)).toBe(true);
    expect(lower.every(v => v === null)).toBe(true);
  });
});

describe("smcStructure", () => {
  it("prints a BOS when price closes above a confirmed swing high", () => {
    const pivot = 2;
    // Build a swing high at index 3, then later close above it.
    const candles: IndicatorCandle[] = [
      c(0 * HOUR, 100, 101, 99, 100),
      c(1 * HOUR, 100, 102, 99, 101),
      c(2 * HOUR, 101, 103, 100, 102),
      c(3 * HOUR, 102, 110, 101, 105), // swing-high bar (high 110)
      c(4 * HOUR, 105, 106, 103, 104),
      c(5 * HOUR, 104, 105, 102, 103),
      c(6 * HOUR, 103, 108, 102, 104),
      c(7 * HOUR, 104, 115, 103, 112), // closes above 110 -> BOS up
      c(8 * HOUR, 112, 116, 110, 114),
    ];
    const { events } = smcStructure(candles, pivot);
    const up = events.find(e => e.dir === "up");
    expect(up).toBeDefined();
    expect(up!.kind).toBe("BOS");
    expect(up!.price).toBeCloseTo(110, 6);
  });

  it("returns no events on a strictly monotonic ramp (no fractal pivots)", () => {
    const { events } = smcStructure(uptrend(40), 5);
    expect(events.length).toBe(0);
  });
});

describe("supplyDemandZones", () => {
  const params: FnoSmcParams = { ...DEFAULT_FNO_SMC_PARAMS, zPivot: 2, zMax: 3, hideTested: false };

  it("creates a demand zone at a swing low", () => {
    const candles: IndicatorCandle[] = [
      c(0 * HOUR, 100, 101, 99, 100),
      c(1 * HOUR, 100, 101, 98, 99),
      c(2 * HOUR, 99, 100, 95, 96), // swing low (low 95)
      c(3 * HOUR, 96, 101, 97, 100),
      c(4 * HOUR, 100, 103, 99, 102),
    ];
    const a = atr(candles, 14);
    const { zones } = supplyDemandZones(candles, params, a);
    const demand = zones.find(z => z.type === "demand");
    expect(demand).toBeDefined();
    expect(demand!.bottom).toBeCloseTo(95, 6);
  });

  it("caps zones per side at zMax", () => {
    const candles = uptrend(60);
    // Force alternating swing structure by jittering highs/lows.
    for (let i = 0; i < candles.length; i++) {
      if (i % 4 === 0) candles[i]!.l -= 5;
      if (i % 4 === 2) candles[i]!.h += 5;
    }
    const a = atr(candles, 14);
    const { zones } = supplyDemandZones(candles, params, a);
    expect(zones.filter(z => z.type === "demand").length).toBeLessThanOrEqual(params.zMax);
    expect(zones.filter(z => z.type === "supply").length).toBeLessThanOrEqual(params.zMax);
  });
});

describe("fnoFvgs", () => {
  const params: FnoSmcParams = {
    ...DEFAULT_FNO_SMC_PARAMS,
    fvgAuto: false,
    fvgThrPct: 0.01,
    fvgRemoveMitigated: false,
  };

  it("detects a bullish gap when low > high[2] beyond threshold", () => {
    const candles: IndicatorCandle[] = [
      c(0 * HOUR, 100, 101, 99, 100),
      c(1 * HOUR, 100, 102, 100, 101),
      c(2 * HOUR, 103, 105, 103, 104), // low 103 > high[2]=101 -> bull gap
      c(3 * HOUR, 104, 106, 104, 105),
    ];
    const z = fnoFvgs(candles, params);
    const bull = z.find(x => x.type === "fvgBull");
    expect(bull).toBeDefined();
    expect(bull!.bottom).toBeCloseTo(101, 6);
    expect(bull!.top).toBeCloseTo(103, 6);
  });

  it("removes mitigated gaps when requested", () => {
    const candles: IndicatorCandle[] = [
      c(0 * HOUR, 100, 101, 99, 100),
      c(1 * HOUR, 100, 102, 100, 101),
      c(2 * HOUR, 103, 105, 103, 104), // bull gap [101,103]
      c(3 * HOUR, 104, 106, 100, 101), // low 100 <= 101 -> mitigates
    ];
    const withMit = fnoFvgs(candles, { ...params, fvgRemoveMitigated: false });
    const withoutMit = fnoFvgs(candles, { ...params, fvgRemoveMitigated: true });
    expect(withMit.some(z => z.type === "fvgBull")).toBe(true);
    expect(withoutMit.some(z => z.type === "fvgBull")).toBe(false);
  });
});

describe("alignHtfBias", () => {
  it("is all-zero (unknown) when no HTF candles are supplied", () => {
    const ltf = uptrend(10);
    expect(alignHtfBias(ltf, [], 9, 20).every(b => b === 0)).toBe(true);
  });

  it("maps each LTF bar to the most recent already-closed HTF bar (no look-ahead)", () => {
    // HTF bar every 3 LTF bars; enough HTF history for EMA20 to be computable.
    const htf = uptrend(30, 100, 2).map((x, i) => ({ ...x, t: i * 3 * HOUR }));
    const ltf: IndicatorCandle[] = [];
    for (let i = 0; i < 90; i++) ltf.push(c(i * HOUR, 100, 101, 99, 100));
    const bias = alignHtfBias(ltf, htf, 9, 20);
    // Bars before the first HTF EMA is computable should be unknown (0).
    expect(bias[0]).toBe(0);
    // A clean HTF uptrend should yield bullish (1) for the last LTF bar, which
    // maps back to a late HTF bar whose fast EMA leads its slow EMA.
    expect(bias[bias.length - 1]).toBe(1);
  });
});

describe("computeFnoSmc", () => {
  it("reports a bullish dashboard on a clean uptrend with volume", () => {
    const candles = uptrend(120);
    const res = computeFnoSmc(candles, [], DEFAULT_FNO_SMC_PARAMS);
    expect(res.dashboard.score).toBeGreaterThan(0);
    expect(res.dashboard.biasText).toBe("Up");
    // No HTF series supplied -> honestly unavailable, maxScore drops to 4.
    expect(res.dashboard.htfText).toBe("Unavailable");
    expect(res.dashboard.maxScore).toBe(4);
  });

  it("labels VWAP n/a when the source carries no volume", () => {
    const candles = uptrend(60).map(x => ({ ...x, v: null }));
    const res = computeFnoSmc(candles, [], DEFAULT_FNO_SMC_PARAMS);
    expect(res.vwap).toBeNull();
    expect(res.dashboard.vwapText).toBe("n/a");
  });

  it("keeps the VWAP mid-line but nulls the bands when showVwapBands is off", () => {
    const candles = uptrend(60);
    const on = computeFnoSmc(candles, [], DEFAULT_FNO_SMC_PARAMS);
    expect(on.vwap).not.toBeNull();
    expect(on.vwap!.upper.some(v => v != null)).toBe(true);
    expect(on.vwap!.lower.some(v => v != null)).toBe(true);

    const off = computeFnoSmc(candles, [], { ...DEFAULT_FNO_SMC_PARAMS, showVwapBands: false });
    expect(off.vwap).not.toBeNull();
    expect(off.vwap!.vwap.some(v => v != null)).toBe(true);
    expect(off.vwap!.upper.every(v => v === null)).toBe(true);
    expect(off.vwap!.lower.every(v => v === null)).toBe(true);
  });

  it("nulls the whole VWAP block when showVwap is off", () => {
    const candles = uptrend(60);
    const res = computeFnoSmc(candles, [], { ...DEFAULT_FNO_SMC_PARAMS, showVwap: false });
    expect(res.vwap).toBeNull();
  });

  it("uses maxScore 5 when an HTF series is available", () => {
    const candles = uptrend(120);
    const htf = uptrend(60, 100, 2).map((x, i) => ({ ...x, t: i * 4 * HOUR }));
    const res = computeFnoSmc(candles, htf, DEFAULT_FNO_SMC_PARAMS);
    expect(res.htfAvailable).toBe(true);
    expect(res.dashboard.maxScore).toBe(5);
  });

  it("emits only well-formed long signals (sl below entry, tgt above, rr honored)", () => {
    const candles = uptrend(150);
    const res = computeFnoSmc(candles, [], { ...DEFAULT_FNO_SMC_PARAMS, reqZone: false, reqHtf: false });
    for (const s of res.signals.filter(x => x.dir === "long")) {
      expect(s.sl).toBeLessThan(s.entry);
      expect(s.tgt).toBeGreaterThan(s.entry);
      expect(s.tgt - s.entry).toBeCloseTo((s.entry - s.sl) * s.rr, 4);
    }
  });

  it("does not throw on empty input", () => {
    const res = computeFnoSmc([], [], DEFAULT_FNO_SMC_PARAMS);
    expect(res.signals).toEqual([]);
    expect(res.zones).toEqual([]);
    expect(res.dashboard.score).toBe(0);
  });
});
