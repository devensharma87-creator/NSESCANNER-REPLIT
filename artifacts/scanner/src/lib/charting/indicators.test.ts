import { describe, it, expect } from "vitest";
import {
  ema,
  rsi,
  vwap,
  istDateKey,
  emaRibbon,
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
