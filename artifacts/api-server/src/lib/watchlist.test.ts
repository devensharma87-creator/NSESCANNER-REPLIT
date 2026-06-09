import { describe, expect, it } from "vitest";
import type { Indicators, Quote, Signal, StockRow } from "@workspace/api-zod";
import { rowFromScanner } from "./watchlist";

// rowFromScanner is the heart of the Watchlist data-path fix: instead of
// re-fetching every basket constituent from Yahoo's rate-limited per-symbol
// chart endpoint, the watchlist now reuses the live Kite-first scanner row
// directly. These tests pin the mapping (price/OHLC/volume/indicators/trend)
// and the no-synthetic-data gates.

function quote(over: Partial<Quote> = {}): Quote {
  return {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    exchange: "NSE",
    price: 2500,
    change: 20,
    changePercent: 0.81,
    open: 2490,
    high: 2510,
    low: 2485,
    previousClose: 2480,
    volume: 1_200_000,
    avgVolume: 900_000,
    updatedAt: new Date(),
    ...over,
  };
}

function indicators(over: Partial<Indicators> = {}): Indicators {
  return {
    ema20: 2450.567,
    ema50: 2400.222,
    rsi14: 58.47,
    ...over,
  };
}

function stockRow(signal: Signal, q: Quote, ind: Indicators): StockRow {
  // rowFromScanner only reads recommendation.signal, so a minimal
  // recommendation is sufficient for these mapping tests.
  return {
    symbol: q.symbol,
    name: q.name,
    quote: q,
    indicators: ind,
    recommendation: { signal },
  } as unknown as StockRow;
}

describe("rowFromScanner", () => {
  it("maps a full live scanner row into a watchlist row", () => {
    const row = rowFromScanner(stockRow("BUY", quote(), indicators()));
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      symbol: "RELIANCE",
      name: "Reliance Industries",
      livePrice: 2500,
      previousClose: 2480,
      change: 20,
      changePercent: 0.81,
      open: 2490,
      todayHigh: 2510,
      todayLow: 2485,
      volume: 1_200_000,
      mcTrend: "Bullish",
    });
    // indicators are rounded, not passed through raw
    expect(row!.ema20).toBe(2450.57);
    expect(row!.ema50).toBe(2400.22);
    expect(row!.rsi).toBe(58.5);
  });

  it("maps every signal band to the matching trend label", () => {
    const cases: Array<[Signal, string]> = [
      ["STRONG_BUY", "Very Bullish"],
      ["BUY", "Bullish"],
      ["NEUTRAL", "Neutral"],
      ["SELL", "Bearish"],
      ["STRONG_SELL", "Very Bearish"],
    ];
    for (const [sig, label] of cases) {
      const row = rowFromScanner(stockRow(sig, quote(), indicators()));
      expect(row!.mcTrend).toBe(label);
    }
  });

  it("leaves missing indicators undefined (never coerced to 0)", () => {
    const ind = indicators({ ema20: undefined, ema50: undefined, rsi14: undefined });
    const row = rowFromScanner(stockRow("NEUTRAL", quote(), ind));
    expect(row).not.toBeNull();
    expect(row!.ema20).toBeUndefined();
    expect(row!.ema50).toBeUndefined();
    expect(row!.rsi).toBeUndefined();
  });

  it("rejects rows without a real positive price", () => {
    expect(rowFromScanner(stockRow("BUY", quote({ price: 0 }), indicators()))).toBeNull();
    expect(rowFromScanner(stockRow("BUY", quote({ price: -5 }), indicators()))).toBeNull();
  });

  it("rejects rows without a real positive previous close", () => {
    expect(rowFromScanner(stockRow("BUY", quote({ previousClose: 0 }), indicators()))).toBeNull();
  });
});
