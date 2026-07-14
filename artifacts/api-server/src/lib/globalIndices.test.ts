/**
 * Tests for the pure global-cue quote builder (data-authenticity guard).
 *
 * The core invariant: a failed/empty Yahoo fetch — which frequently returns
 * empty or zeroed data WITHOUT throwing — must NEVER produce a fabricated
 * `price: 0` / `changePercent: 0` entry. Such entries previously rendered as
 * a fake "0.00 / +0.00%" in the Home global-cues strip. The builder must omit
 * (return null) instead, mirroring the GIFT NIFTY discipline.
 */
import { describe, it, expect } from "vitest";
import { buildGlobalIndexQuote, type GlobalCfg } from "./globalIndices";
import type { YahooChart } from "./yahoo";

const cfg: GlobalCfg = { yahoo: "^GSPC", name: "S&P 500", region: "US" };

function chart(over: Partial<Omit<YahooChart, "meta">> & { meta?: Partial<YahooChart["meta"]> }): YahooChart {
  return {
    symbol: "^GSPC",
    meta: { symbol: "^GSPC", regularMarketPrice: 0, ...(over.meta ?? {}) },
    timestamps: over.timestamps ?? [],
    open: over.open ?? [],
    high: over.high ?? [],
    low: over.low ?? [],
    close: over.close ?? [],
    volume: over.volume ?? [],
  };
}

describe("buildGlobalIndexQuote — fake-zero guard", () => {
  it("returns null when both intraday and daily are null (total fetch failure)", () => {
    expect(buildGlobalIndexQuote(cfg, null, null)).toBeNull();
  });

  it("returns null when daily exists but price resolves to 0 (empty Yahoo payload)", () => {
    const daily = chart({ meta: { regularMarketPrice: 0 }, close: [0, 0] });
    expect(buildGlobalIndexQuote(cfg, null, daily)).toBeNull();
  });

  it("returns null when a price exists but no real previous close is available", () => {
    // Intraday has a real price, but daily is null → no prev close → cannot
    // compute an honest change/percent → omit rather than emit change 0.
    const intra = chart({ meta: { regularMarketPrice: 5200 }, close: [5200] });
    expect(buildGlobalIndexQuote(cfg, intra, null)).toBeNull();
  });

  it("returns null for a negative/non-finite price", () => {
    const daily = chart({ meta: { regularMarketPrice: Number.NaN }, close: [100, 101] });
    expect(buildGlobalIndexQuote(cfg, null, daily)).toBeNull();
  });

  it("builds a real quote with honest change/percent when price + prev close are present", () => {
    const daily = chart({
      meta: { regularMarketPrice: 5100, regularMarketTime: 1717900000 },
      open: [4990, 5000],
      close: [5000, 5100],
    });
    const q = buildGlobalIndexQuote(cfg, null, daily);
    expect(q).not.toBeNull();
    expect(q!.symbol).toBe("^GSPC");
    expect(q!.price).toBe(5100);
    expect(q!.previousClose).toBe(5000);
    expect(q!.change).toBeCloseTo(100, 6);
    expect(q!.changePercent).toBeCloseTo(2, 6);
    expect(q!.trend).toBe("bullish");
  });

  it("never emits a 0 changePercent from a fabricated prev (prev derived from chartPreviousClose)", () => {
    const daily = chart({
      meta: { regularMarketPrice: 200, chartPreviousClose: 190 },
      close: [200], // only one close → falls back to chartPreviousClose
    });
    const q = buildGlobalIndexQuote(cfg, null, daily);
    expect(q).not.toBeNull();
    expect(q!.previousClose).toBe(190);
    expect(q!.changePercent).toBeCloseTo((10 / 190) * 100, 2);
  });
});

describe("buildGlobalIndexQuote — indicator honesty (no fabricated VWAP/EMA/RSI)", () => {
  it("leaves vwap/ema9/ema21/rsi14 undefined when there is no intraday series", () => {
    // Daily-only quote: indicators are not computable. They must be absent,
    // NOT substituted with the spot price (VWAP/EMA) or a neutral 50 (RSI).
    const daily = chart({
      meta: { regularMarketPrice: 5100 },
      open: [4990, 5000],
      close: [5000, 5100],
    });
    const q = buildGlobalIndexQuote(cfg, null, daily);
    expect(q).not.toBeNull();
    expect(q!.vwap).toBeUndefined();
    expect(q!.ema9).toBeUndefined();
    expect(q!.ema21).toBeUndefined();
    expect(q!.rsi14).toBeUndefined();
  });

  it("leaves indicators undefined when the intraday series is too short to compute them", () => {
    // Intraday present but only a few bars (<=6) → builder must not attempt
    // (and must not fabricate) any indicator value.
    const intra = chart({
      meta: { regularMarketPrice: 5100 },
      high: [5100, 5110],
      low: [5090, 5095],
      close: [5095, 5100],
      volume: [1000, 1200],
    });
    const daily = chart({ meta: { regularMarketPrice: 5100 }, close: [5000, 5050] });
    const q = buildGlobalIndexQuote(cfg, intra, daily);
    expect(q).not.toBeNull();
    expect(q!.vwap).toBeUndefined();
    expect(q!.ema9).toBeUndefined();
    expect(q!.ema21).toBeUndefined();
    expect(q!.rsi14).toBeUndefined();
    // trend is still derived honestly from change alone when vwap is absent
    expect(q!.trend).toBe("bullish");
  });

  it("computes real indicators when a sufficiently long intraday series is present", () => {
    const n = 30;
    const close = Array.from({ length: n }, (_, i) => 5000 + i);
    const high = close.map(c => c + 5);
    const low = close.map(c => c - 5);
    const volume = close.map(() => 1000);
    const intra = chart({ meta: { regularMarketPrice: close[n - 1]! }, high, low, close, volume });
    const daily = chart({ meta: { regularMarketPrice: close[n - 1]! }, close: [4900, 4950] });
    const q = buildGlobalIndexQuote(cfg, intra, daily);
    expect(q).not.toBeNull();
    expect(typeof q!.vwap).toBe("number");
    expect(typeof q!.ema9).toBe("number");
    expect(typeof q!.ema21).toBe("number");
    expect(typeof q!.rsi14).toBe("number");
    // RSI of a monotonically rising series should be high, never a fake 50.
    expect(q!.rsi14).toBeGreaterThan(50);
  });
});
