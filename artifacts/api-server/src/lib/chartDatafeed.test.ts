import { describe, it, expect } from "vitest";
import {
  normalizeChart,
  aggregateCandles,
  deriveFreshness,
  TIMEFRAME_CONFIG,
  ALL_TIMEFRAMES,
  type ChartCandlePoint,
} from "./chartDatafeed";
import type { YahooChart } from "./yahoo";

function chart(partial: Partial<YahooChart>): YahooChart {
  return {
    symbol: "TEST",
    meta: {} as YahooChart["meta"],
    timestamps: [],
    open: [],
    high: [],
    low: [],
    close: [],
    volume: [],
    ...partial,
  };
}

describe("normalizeChart", () => {
  it("maps aligned arrays into finite candles and sorts ascending", () => {
    const c = normalizeChart(
      chart({
        timestamps: [200, 100],
        open: [11, 10],
        high: [12, 11],
        low: [10, 9],
        close: [11.5, 10.5],
        volume: [500, 1000],
      }),
    );
    expect(c).toHaveLength(2);
    expect(c[0]!.t).toBe(100);
    expect(c[1]!.t).toBe(200);
    expect(c[0]!).toMatchObject({ o: 10, h: 11, l: 9, c: 10.5, v: 1000 });
  });

  it("drops rows with null/NaN/non-positive OHLC (never fabricates)", () => {
    const c = normalizeChart(
      chart({
        timestamps: [100, 200, 300, 400],
        open: [10, NaN, 0, 12],
        high: [11, 12, 1, 13],
        low: [9, 10, 0.5, 11],
        close: [10.5, 11, 0.9, 12.5],
        volume: [100, 100, 100, 100],
      }),
    );
    // Only first and last rows are valid.
    expect(c.map(x => x.t)).toEqual([100, 400]);
  });

  it("preserves null volume rather than coercing to 0", () => {
    const c = normalizeChart(
      chart({
        timestamps: [100],
        open: [10], high: [11], low: [9], close: [10.5],
        volume: [NaN],
      }),
    );
    expect(c[0]!.v).toBeNull();
  });
});

describe("aggregateCandles", () => {
  // Five consecutive trading days spanning two ISO weeks (Fri..Thu).
  const day = 86400;
  // 2024-01-04 is a Thursday (UTC). Build from a known Monday instead.
  // 2024-01-01 is Monday 00:00 UTC.
  const mon = Math.floor(Date.UTC(2024, 0, 1) / 1000) + 6 * 3600; // ~IST 11:30
  const daily: ChartCandlePoint[] = [
    { t: mon + 0 * day, o: 10, h: 12, l: 9, c: 11, v: 100 },   // Mon wk1
    { t: mon + 1 * day, o: 11, h: 13, l: 10, c: 12, v: 200 },  // Tue wk1
    { t: mon + 2 * day, o: 12, h: 14, l: 11, c: 13, v: 300 },  // Wed wk1
    { t: mon + 7 * day, o: 13, h: 16, l: 12, c: 15, v: 400 },  // next Mon wk2
    { t: mon + 8 * day, o: 15, h: 17, l: 14, c: 16, v: 500 },  // next Tue wk2
  ];

  it("aggregates daily candles into weekly OHLCV correctly", () => {
    const wk = aggregateCandles(daily, "week");
    expect(wk).toHaveLength(2);
    expect(wk[0]!).toMatchObject({ o: 10, h: 14, l: 9, c: 13, v: 600 });
    expect(wk[0]!.t).toBe(daily[0]!.t); // first bar's timestamp
    expect(wk[1]!).toMatchObject({ o: 13, h: 17, l: 12, c: 16, v: 900 });
  });

  it("aggregates into monthly buckets by IST calendar month", () => {
    const janA = Math.floor(Date.UTC(2024, 0, 10) / 1000);
    const janB = Math.floor(Date.UTC(2024, 0, 25) / 1000);
    const feb = Math.floor(Date.UTC(2024, 1, 5) / 1000);
    const monthly = aggregateCandles(
      [
        { t: janA, o: 10, h: 20, l: 8, c: 15, v: 1 },
        { t: janB, o: 15, h: 25, l: 12, c: 22, v: 2 },
        { t: feb, o: 22, h: 30, l: 20, c: 28, v: 3 },
      ],
      "month",
    );
    expect(monthly).toHaveLength(2);
    expect(monthly[0]!).toMatchObject({ o: 10, h: 25, l: 8, c: 22, v: 3 });
    expect(monthly[1]!).toMatchObject({ o: 22, h: 30, l: 20, c: 28, v: 3 });
  });

  it("returns null volume when every bar in a bucket lacks volume", () => {
    const noVol = aggregateCandles(
      [{ t: mon, o: 1, h: 2, l: 0.5, c: 1.5, v: null }],
      "week",
    );
    expect(noVol[0]!.v).toBeNull();
  });

  it("returns [] for empty input", () => {
    expect(aggregateCandles([], "week")).toEqual([]);
  });
});

describe("deriveFreshness", () => {
  it("returns asOf null + not-fresh for empty series", () => {
    expect(deriveFreshness([], "5m")).toEqual({ asOf: null, fresh: false });
  });

  it("flags recent newest bar as fresh and stale bar as not fresh", () => {
    const nowSec = 1_700_000_000;
    const series: ChartCandlePoint[] = [
      { t: nowSec - 10_000, o: 1, h: 1, l: 1, c: 1, v: null },
      { t: nowSec - 60, o: 1, h: 1, l: 1, c: 1, v: null },
    ];
    expect(deriveFreshness(series, "5m", nowSec * 1000).fresh).toBe(true);

    const staleSeries: ChartCandlePoint[] = [
      { t: nowSec - 100_000, o: 1, h: 1, l: 1, c: 1, v: null },
    ];
    const stale = deriveFreshness(staleSeries, "5m", nowSec * 1000);
    expect(stale.fresh).toBe(false);
    expect(stale.asOf).toBe(nowSec - 100_000);
  });
});

describe("TIMEFRAME_CONFIG", () => {
  it("covers every timeframe with a coherent config", () => {
    for (const tf of ALL_TIMEFRAMES) {
      const cfg = TIMEFRAME_CONFIG[tf];
      expect(cfg).toBeDefined();
      expect(cfg.freshnessSec).toBeGreaterThan(0);
      // 1W/1M aggregate from daily Kite bars (Kite has no week interval).
      if (tf === "1W") expect(cfg.aggregateTo).toBe("week");
      if (tf === "1M") expect(cfg.aggregateTo).toBe("month");
      if (cfg.aggregateTo) expect(cfg.kiteInterval).toBe("day");
    }
  });

  it("has no Yahoo fallback for sub-5m timeframes (Yahoo lacks 1m/3m)", () => {
    expect(TIMEFRAME_CONFIG["1m"].yahoo).toBeNull();
    expect(TIMEFRAME_CONFIG["3m"].yahoo).toBeNull();
    expect(TIMEFRAME_CONFIG["5m"].yahoo).not.toBeNull();
  });
});
