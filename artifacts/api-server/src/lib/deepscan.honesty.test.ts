import { describe, it, expect, vi, beforeEach } from "vitest";

const yahooState = vi.hoisted(() => ({
  chart: null as unknown,
  intraday: null as unknown,
}));

vi.mock("./yahoo", () => ({
  fetchChart: vi.fn(async () => yahooState.chart),
  fetchIntraday: vi.fn(async () => yahooState.intraday),
  fetchFundamentals: vi.fn(async () => null),
  yahooTickerFor: (s: string) => `${s}.NS`,
}));

vi.mock("./nseBhavcopy", () => ({
  getAllSymbols: vi.fn(async () => ({ symbols: [], sourceDate: "2026-06-10" })),
}));

vi.mock("../logger", () => ({
  logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
}));

import { getDeepSnapshot } from "./deepscan";

const NOW_SEC = Math.floor(Date.UTC(2026, 5, 10, 6, 0, 0) / 1000);
const DAY = 86400;

function dailyChart(opts?: { withHole?: boolean }) {
  const n = 30;
  const timestamps: number[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  const volume: number[] = [];
  for (let i = 0; i < n; i++) {
    timestamps.push(NOW_SEC - (n - 1 - i) * DAY);
    const base = 100 + i;
    open.push(base);
    high.push(base + 2);
    low.push(base - 2);
    close.push(base + 1);
    volume.push(1000 + i);
  }
  if (opts?.withHole) {
    // A bar with missing OHLC (source gap) — must be DROPPED, never coerced to 0.
    const j = 10;
    open[j] = NaN;
    high[j] = NaN;
    low[j] = NaN;
    close[j] = NaN;
  }
  return {
    symbol: "RELIANCE.NS",
    meta: {
      symbol: "RELIANCE.NS",
      regularMarketPrice: close[n - 1],
      regularMarketTime: NOW_SEC,
      chartPreviousClose: close[0],
    },
    timestamps,
    open,
    high,
    low,
    close,
    volume,
  };
}

describe("getDeepSnapshot honesty", () => {
  beforeEach(() => {
    yahooState.chart = dailyChart();
    yahooState.intraday = null;
  });

  it("never fabricates a 0 OHLC bar — drops incomplete bars and warns", async () => {
    yahooState.chart = dailyChart({ withHole: true });
    const snap = await getDeepSnapshot("RELIANCE", "1mo", "stock");
    expect(snap).not.toBeNull();
    // No candle has a 0 (or non-finite) OHLC value.
    for (const c of snap!.candles) {
      for (const v of [c.o, c.h, c.l, c.c]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    }
    // The dropped bar is reported as a warning, not silently swallowed.
    expect(snap!.provenance.warnings.some(w => /incomplete bar/i.test(w))).toBe(true);
    // Indicator series stay aligned 1:1 with the kept candle array.
    expect(snap!.series.ema20.length).toBe(snap!.candles.length);
    expect(snap!.series.vwap20.length).toBe(snap!.candles.length);
  });

  it("labels Deep Scan data as Yahoo secondary_analytics, delayed, not-for-signals", async () => {
    const snap = await getDeepSnapshot("RELIANCE", "1mo", "stock");
    expect(snap).not.toBeNull();
    const p = snap!.provenance;
    expect(p.sourceProvider).toBe("yahoo");
    expect(p.trustTier).toBe("secondary_analytics");
    expect(p.delayed).toBe(true);
    expect(p.notForSignals).toBe(true);
    expect(p.notForTradeDecisions).toBe(true);
    expect(p.asOf).toBe(NOW_SEC);
  });

  it("labels the intraday→daily fallback when intraday data is unavailable", async () => {
    yahooState.intraday = null; // intraday fetch yields nothing
    const snap = await getDeepSnapshot("RELIANCE", "1d", "stock");
    expect(snap).not.toBeNull();
    expect(snap!.intradayFallback).toBe(true);
    expect(snap!.provenance.warnings.some(w => /intraday/i.test(w))).toBe(true);
  });
});
