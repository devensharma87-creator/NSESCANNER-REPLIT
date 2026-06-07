import { describe, it, expect } from "vitest";
import {
  ema,
  rsi,
  vwap,
  istDateKey,
  emaRibbon,
  cvdProxy,
  volumeProfilePoc,
  detectFvgs,
  detectSweeps,
  sliceByWindow,
  fibLevels,
  fixedVolumeProfile,
  swingPivots,
  computeKeyLevels,
  EMA_PERIODS,
  type IndicatorCandle,
} from "./indicators";

describe("ema", () => {
  it("returns all null when fewer values than the period", () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });

  it("seeds with the SMA of the first `period` values", () => {
    const out = ema([2, 4, 6, 8], 2);
    // seed at index1 = (2+4)/2 = 3
    expect(out[0]).toBeNull();
    expect(out[1]).toBeCloseTo(3, 9);
    // k = 2/3; idx2 = 6*2/3 + 3*1/3 = 5
    expect(out[2]).toBeCloseTo(5, 9);
    // idx3 = 8*2/3 + 5*1/3 = 7
    expect(out[3]).toBeCloseTo(7, 9);
  });

  it("is constant for a constant series", () => {
    const out = ema([5, 5, 5, 5, 5], 3);
    expect(out[2]).toBeCloseTo(5, 9);
    expect(out[4]).toBeCloseTo(5, 9);
  });
});

describe("rsi", () => {
  it("returns null until period+1 data points", () => {
    const out = rsi([1, 2, 3], 14);
    expect(out.every(v => v === null)).toBe(true);
  });

  it("is 100 for a monotonically rising series (no losses)", () => {
    const rising = Array.from({ length: 20 }, (_, i) => i + 1);
    const out = rsi(rising, 14);
    expect(out[14]).toBeCloseTo(100, 6);
  });

  it("stays within [0,100]", () => {
    const series = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22];
    const out = rsi(series, 14);
    for (const v of out) {
      if (v != null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

function candle(t: number, o: number, h: number, l: number, c: number, v: number | null): IndicatorCandle {
  return { t, o, h, l, c, v };
}

describe("vwap", () => {
  it("equals typical price for a single bar", () => {
    const out = vwap([candle(100, 10, 12, 8, 11, 1000)], false);
    expect(out[0]).toBeCloseTo((12 + 8 + 11) / 3, 9);
  });

  it("carries forward when a bar has null/zero volume", () => {
    const out = vwap(
      [
        candle(100, 10, 12, 8, 10, 1000),
        candle(160, 10, 12, 8, 10, null),
      ],
      false,
    );
    expect(out[1]).toBeCloseTo(out[0] as number, 9);
  });

  it("resets cumulative sums across IST day boundaries when sessionReset=true", () => {
    // Two bars on different IST days. With reset, second bar's VWAP = its own typical.
    const day1 = Math.floor(Date.UTC(2024, 0, 1, 6, 0, 0) / 1000); // IST 2024-01-01
    const day2 = Math.floor(Date.UTC(2024, 0, 2, 6, 0, 0) / 1000); // IST 2024-01-02
    const out = vwap(
      [
        candle(day1, 10, 30, 10, 20, 1000),
        candle(day2, 5, 9, 3, 6, 2000),
      ],
      true,
    );
    expect(out[1]).toBeCloseTo((9 + 3 + 6) / 3, 9);
  });

  it("returns null while no positive volume has been seen", () => {
    const out = vwap([candle(100, 10, 12, 8, 11, 0)], false);
    expect(out[0]).toBeNull();
  });
});

describe("istDateKey", () => {
  it("rolls to the IST calendar date (UTC+5:30)", () => {
    // 2024-01-01 19:00 UTC = 2024-01-02 00:30 IST
    const t = Math.floor(Date.UTC(2024, 0, 1, 19, 0, 0) / 1000);
    expect(istDateKey(t)).toBe("2024-01-02");
  });
});

describe("emaRibbon", () => {
  it("produces an aligned series for every configured period", () => {
    const candles: IndicatorCandle[] = Array.from({ length: 250 }, (_, i) =>
      candle(i * 60, 100 + i, 101 + i, 99 + i, 100 + i, 1000),
    );
    const ribbon = emaRibbon(candles);
    for (const p of EMA_PERIODS) {
      expect(ribbon[p]).toHaveLength(250);
      expect(ribbon[p][p - 1]).not.toBeNull();
      expect(ribbon[p][p - 2]).toBeNull();
    }
  });
});

describe("cvdProxy", () => {
  it("accumulates +volume on up bars and -volume on down bars", () => {
    const out = cvdProxy([
      candle(1, 10, 11, 9, 11, 100), // up   → +100
      candle(2, 11, 12, 10, 10, 50), // down → -50  → cumulative 50
      candle(3, 10, 11, 9, 12, 30), // up   → +30  → cumulative 80
    ]);
    expect(out).toEqual([100, 50, 80]);
  });

  it("treats a doji (close==open) as zero delta", () => {
    const out = cvdProxy([
      candle(1, 10, 11, 9, 11, 100),
      candle(2, 11, 12, 10, 11, 100), // doji → +0
    ]);
    expect(out).toEqual([100, 100]);
  });

  it("ignores bars with null/zero volume but keeps the running total aligned", () => {
    const out = cvdProxy([
      candle(1, 10, 11, 9, 11, 100), // +100
      candle(2, 11, 12, 10, 9, null), // null vol → +0
      candle(3, 9, 11, 8, 11, 40), // +40 → 140
    ]);
    expect(out).toEqual([100, 100, 140]);
  });

  it("returns all-null (nothing to plot) when no bar has positive volume", () => {
    const out = cvdProxy([
      candle(1, 10, 11, 9, 11, null),
      candle(2, 11, 12, 10, 9, 0),
    ]);
    expect(out).toEqual([null, null]);
  });
});

describe("volumeProfilePoc", () => {
  it("returns the price level carrying the most volume", () => {
    // A heavy bar parked tightly around 100 dominates the profile.
    const poc = volumeProfilePoc(
      [
        candle(1, 100, 100.5, 99.5, 100, 100000),
        candle(2, 120, 121, 119, 120, 100),
        candle(3, 80, 81, 79, 80, 100),
      ],
      60,
    );
    expect(poc).not.toBeNull();
    expect(poc as number).toBeGreaterThan(99);
    expect(poc as number).toBeLessThan(101);
  });

  it("is null when no bar has positive volume", () => {
    expect(
      volumeProfilePoc([candle(1, 10, 12, 8, 11, null), candle(2, 11, 13, 9, 12, 0)]),
    ).toBeNull();
  });

  it("is null for a degenerate (flat) price range", () => {
    expect(volumeProfilePoc([candle(1, 10, 10, 10, 10, 5000)])).toBeNull();
  });
});

describe("detectFvgs", () => {
  it("flags a bullish gap when candle1.high < candle3.low", () => {
    const zones = detectFvgs([
      candle(1, 10, 11, 9, 10, 100),
      candle(2, 12, 15, 11, 14, 100),
      candle(3, 16, 18, 13, 17, 100), // c3.low 13 > c1.high 11 → bullish
    ]);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ type: "bullish", top: 13, bottom: 11, time: 3 });
  });

  it("flags a bearish gap when candle1.low > candle3.high", () => {
    const zones = detectFvgs([
      candle(1, 20, 22, 18, 19, 100),
      candle(2, 16, 17, 13, 14, 100),
      candle(3, 12, 15, 11, 12, 100), // c1.low 18 > c3.high 15 → bearish
    ]);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ type: "bearish", top: 18, bottom: 15, time: 3 });
  });

  it("keeps only the most recent maxZones gaps", () => {
    // Strictly rising, non-overlapping bars → an FVG at every 3-window.
    const candles: IndicatorCandle[] = Array.from({ length: 30 }, (_, i) =>
      candle(i, i * 10, i * 10 + 1, i * 10 - 1, i * 10, 100),
    );
    expect(detectFvgs(candles, 3)).toHaveLength(3);
  });
});

describe("detectSweeps", () => {
  it("flags a high sweep that pierces the prior high then closes back inside", () => {
    const candles: IndicatorCandle[] = [
      candle(1, 10, 11, 9, 10, 100),
      candle(2, 10, 11, 9, 10, 100),
      candle(3, 10, 11, 9, 10, 100),
      candle(4, 10, 11, 9, 10, 100),
      candle(5, 10, 11, 9, 10, 100), // prior-5 high = 11
      candle(6, 10, 15, 9, 10.5, 100), // high 15 > 11, close 10.5 < 11 → sweep
      candle(7, 10, 11, 9, 10, 100), // next close 10 < 15 confirms
    ];
    const sweeps = detectSweeps(candles, 5);
    expect(sweeps).toEqual([{ time: 6, type: "HIGH_SWEEP" }]);
  });

  it("flags a low sweep that pierces the prior low then closes back inside", () => {
    const candles: IndicatorCandle[] = [
      candle(1, 10, 11, 9, 10, 100),
      candle(2, 10, 11, 9, 10, 100),
      candle(3, 10, 11, 9, 10, 100),
      candle(4, 10, 11, 9, 10, 100),
      candle(5, 10, 11, 9, 10, 100), // prior-5 low = 9
      candle(6, 10, 11, 5, 9.5, 100), // low 5 < 9, close 9.5 > 9 → sweep
      candle(7, 10, 11, 9, 10, 100), // next close 10 > 5 confirms
    ];
    expect(detectSweeps(candles, 5)).toEqual([{ time: 6, type: "LOW_SWEEP" }]);
  });

  it("never flags the final still-forming bar (needs a confirming bar)", () => {
    const candles: IndicatorCandle[] = [
      candle(1, 10, 11, 9, 10, 100),
      candle(2, 10, 11, 9, 10, 100),
      candle(3, 10, 11, 9, 10, 100),
      candle(4, 10, 11, 9, 10, 100),
      candle(5, 10, 11, 9, 10, 100),
      candle(6, 10, 15, 9, 10.5, 100), // a sweep shape, but it is the LAST bar
    ];
    expect(detectSweeps(candles, 5)).toEqual([]);
  });
});

const DAY = 86400;

describe("sliceByWindow", () => {
  const candles: IndicatorCandle[] = Array.from({ length: 30 }, (_, i) =>
    candle(i * DAY, 100, 101, 99, 100, 1000),
  );

  it("returns the input untouched for ALL", () => {
    expect(sliceByWindow(candles, "ALL")).toHaveLength(30);
  });

  it("keeps only the trailing window measured back from the last candle", () => {
    // last t = 29*DAY; 1W = 7 days → cutoff 22*DAY → indices 22..29 = 8 bars.
    expect(sliceByWindow(candles, "1W")).toHaveLength(8);
  });

  it("handles an empty input", () => {
    expect(sliceByWindow([], "1M")).toEqual([]);
  });
});

describe("fibLevels", () => {
  it("is null with fewer than two candles", () => {
    expect(fibLevels([candle(1, 10, 12, 8, 11, 100)])).toBeNull();
  });

  it("is null when the range is degenerate (flat)", () => {
    expect(
      fibLevels([candle(1, 10, 10, 10, 10, 100), candle(2, 10, 10, 10, 10, 100)]),
    ).toBeNull();
  });

  it("retraces DOWN from the high in an uptrend (low precedes high)", () => {
    const c: IndicatorCandle[] = [
      candle(1, 10, 12, 8, 10, 100), // low 8 first
      candle(2, 18, 28, 16, 26, 100), // high 28 later → uptrend
    ];
    const res = fibLevels(c);
    expect(res).not.toBeNull();
    expect(res!.direction).toBe("up");
    expect(res!.high).toBe(28);
    expect(res!.low).toBe(8);
    const r0 = res!.levels.find(l => l.ratio === 0)!;
    const r1 = res!.levels.find(l => l.ratio === 1)!;
    const half = res!.levels.find(l => l.ratio === 0.5)!;
    expect(r0.price).toBeCloseTo(28, 9); // 0 ratio anchored at high
    expect(r1.price).toBeCloseTo(8, 9); // 1.0 ratio anchored at low
    expect(half.price).toBeCloseTo(18, 9); // mid of 8..28
    const ext = res!.levels.find(l => l.ratio === 1.618)!;
    expect(ext.kind).toBe("extension");
    expect(ext.price).toBeGreaterThan(28); // extends UP beyond the high
  });

  it("retraces UP from the low in a downtrend (high precedes low)", () => {
    const c: IndicatorCandle[] = [
      candle(1, 28, 28, 24, 26, 100), // high 28 first
      candle(2, 12, 14, 8, 10, 100), // low 8 later → downtrend
    ];
    const res = fibLevels(c);
    expect(res!.direction).toBe("down");
    const ext = res!.levels.find(l => l.ratio === 1.618)!;
    expect(ext.price).toBeLessThan(8); // extends DOWN below the low
  });
});

describe("fixedVolumeProfile", () => {
  it("is null when no bar has positive volume", () => {
    expect(
      fixedVolumeProfile([candle(1, 10, 12, 8, 11, null), candle(2, 11, 13, 9, 12, 0)]),
    ).toBeNull();
  });

  it("is null for a degenerate price range", () => {
    expect(fixedVolumeProfile([candle(1, 10, 10, 10, 10, 5000)])).toBeNull();
  });

  it("locates the POC at the heaviest-volume price and brackets it with VAL<=POC<=VAH", () => {
    const c: IndicatorCandle[] = [
      candle(1, 100, 100.5, 99.5, 100, 100000), // heavy, tight around 100
      candle(2, 120, 121, 119, 120, 100),
      candle(3, 80, 81, 79, 80, 100),
    ];
    const vp = fixedVolumeProfile(c, 60);
    expect(vp).not.toBeNull();
    expect(vp!.poc).toBeGreaterThan(99);
    expect(vp!.poc).toBeLessThan(101);
    expect(vp!.val).toBeLessThanOrEqual(vp!.poc);
    expect(vp!.vah).toBeGreaterThanOrEqual(vp!.poc);
    expect(vp!.bars).toBe(3);
    expect(vp!.maxVol).toBeGreaterThan(0);
  });
});

describe("swingPivots", () => {
  it("never marks the leading/trailing span bars", () => {
    const c: IndicatorCandle[] = Array.from({ length: 9 }, (_, i) =>
      candle(i, 10, 10 + (i === 4 ? 5 : 0), 10 - (i === 4 ? 5 : 0), 10, 100),
    );
    const pivots = swingPivots(c, 3);
    expect(pivots.every(p => p.index >= 3 && p.index <= c.length - 1 - 3)).toBe(true);
  });

  it("flags a strict local high pivot", () => {
    const c: IndicatorCandle[] = [
      candle(0, 10, 11, 9, 10, 100),
      candle(1, 10, 12, 9, 10, 100),
      candle(2, 10, 13, 9, 10, 100),
      candle(3, 10, 20, 9, 10, 100), // strict max high
      candle(4, 10, 13, 9, 10, 100),
      candle(5, 10, 12, 9, 10, 100),
      candle(6, 10, 11, 9, 10, 100),
    ];
    const highs = swingPivots(c, 3).filter(p => p.type === "high");
    expect(highs).toHaveLength(1);
    expect(highs[0]).toMatchObject({ index: 3, price: 20, type: "high" });
  });
});

describe("computeKeyLevels", () => {
  // A clean uptrend with a few pullbacks so swing pivots + fib both seed levels.
  const trend: IndicatorCandle[] = Array.from({ length: 60 }, (_, i) => {
    const base = 100 + i;
    const wobble = i % 5 === 0 ? 3 : 0;
    return candle(i * DAY, base, base + 1 + wobble, base - 1 - wobble, base, 1000);
  });

  it("is null without enough data", () => {
    expect(computeKeyLevels([candle(1, 10, 11, 9, 10, 100)], 10)).toBeNull();
  });

  it("returns supports below and resistances above the current price, ranked nearest-first", () => {
    const price = 150;
    const res = computeKeyLevels(trend, price);
    expect(res).not.toBeNull();
    for (const s of res!.supports) expect(s.price).toBeLessThan(price);
    for (const r of res!.resistances) expect(r.price).toBeGreaterThan(price);
    expect(res!.supports.length).toBeLessThanOrEqual(3);
    expect(res!.resistances.length).toBeLessThanOrEqual(3);
    // S1 is the nearest support (highest price below current).
    for (let i = 1; i < res!.supports.length; i++) {
      expect(res!.supports[i - 1]!.price).toBeGreaterThan(res!.supports[i]!.price);
    }
    // R1 is the nearest resistance (lowest price above current).
    for (let i = 1; i < res!.resistances.length; i++) {
      expect(res!.resistances[i - 1]!.price).toBeLessThan(res!.resistances[i]!.price);
    }
    expect(res!.usedOptionChain).toBe(false);
    // labels are S1.. / R1..
    res!.supports.forEach((s, i) => expect(s.label).toBe(`S${i + 1}`));
    res!.resistances.forEach((r, i) => expect(r.label).toBe(`R${i + 1}`));
  });

  it("tags option-chain contributions and flags usedOptionChain", () => {
    const price = 150;
    const res = computeKeyLevels(trend, price, {
      supports: [148],
      resistances: [152],
    });
    expect(res!.usedOptionChain).toBe(true);
    const allSources = [...res!.supports, ...res!.resistances].flatMap(l => l.sources);
    expect(allSources).toContain("Put OI");
    expect(allSources).toContain("Call OI");
  });

  it("keeps the NEAREST supports when scores tie (nearest survives the top-3 slice)", () => {
    // Flat candles → no swing pivots and a degenerate (null) Fib, so the only
    // candidates are the four equal-weight single-source Put-OI supports. They
    // are spaced wider than the 0.4% cluster tolerance, so each is its own
    // cluster with an identical score; only the three NEAREST (99/98/97) to the
    // current price of 100 must survive the top-3 slice — 96 is dropped.
    const flat: IndicatorCandle[] = Array.from({ length: 8 }, (_, i) =>
      candle(i * DAY, 100, 100, 100, 100, 1000),
    );
    const res = computeKeyLevels(flat, 100, { supports: [96, 97, 98, 99], resistances: [] });
    expect(res).not.toBeNull();
    expect(res!.supports.map(s => Math.round(s.price))).toEqual([99, 98, 97]);
    expect(res!.supports.every(s => s.score === res!.supports[0]!.score)).toBe(true);
  });

  it("scores confluent clusters above single-source levels", () => {
    // Put OI exactly at a swing/fib cluster should boost that support's score.
    const price = 150;
    const res = computeKeyLevels(trend, price, { supports: [120], resistances: [] });
    const confluent = res!.supports.find(s => s.sources.length > 1);
    if (confluent) {
      const single = res!.supports.find(s => s.sources.length === 1);
      if (single) expect(confluent.score).toBeGreaterThan(single.score);
    }
    expect(res).not.toBeNull();
  });
});
