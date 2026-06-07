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
