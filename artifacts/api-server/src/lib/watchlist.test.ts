import { describe, expect, it } from "vitest";
import type { Signal } from "@workspace/api-zod";
import type { DataMeta, TrustedQuote } from "./marketData";
import { rowFromTrustedQuote, type WatchlistEnrichment } from "./watchlist";

// rowFromTrustedQuote is the heart of the Watchlist migration (Task #125):
// prices/OHLC/volume now come from the central trusted market-data router
// (Kite authoritative) — never Yahoo — and the scanner is reused only to
// ENRICH a row with the system signal + EMA/RSI. These tests pin the mapping
// and the no-synthetic-data gates.

function meta(over: Partial<DataMeta> = {}): DataMeta {
  return {
    source: "kite",
    trustTier: "authoritative",
    asOf: "2026-06-09T09:30:00.000Z",
    fetchedAt: "2026-06-09T09:30:01.000Z",
    freshnessSec: 1,
    isStale: false,
    delayed: false,
    notForSignals: false,
    validationStatus: "validated",
    warnings: [],
    ...over,
  };
}

function trustedQuote(over: Partial<TrustedQuote> = {}): TrustedQuote {
  return {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    lastPrice: 2500,
    open: 2490,
    high: 2510,
    low: 2485,
    previousClose: 2480,
    changePercent: 0.81,
    volume: 1_200_000,
    meta: meta(),
    // Brand is a phantom type; the cast stands in for the runtime guard.
    ...over,
  } as TrustedQuote;
}

function enrich(over: Partial<WatchlistEnrichment> = {}): WatchlistEnrichment {
  return { signal: "BUY", ema20: 2450.567, ema50: 2400.222, rsi14: 58.47, ...over };
}

describe("rowFromTrustedQuote", () => {
  it("maps a full trusted quote + scanner enrichment into a watchlist row", () => {
    const row = rowFromTrustedQuote(trustedQuote(), enrich());
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

  it("derives change/changePct from last+prev (single source of truth)", () => {
    const row = rowFromTrustedQuote(trustedQuote({ lastPrice: 2520, previousClose: 2500 }), enrich());
    expect(row!.change).toBe(20);
    expect(row!.changePercent).toBe(0.8);
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
      const row = rowFromTrustedQuote(trustedQuote(), enrich({ signal: sig }));
      expect(row!.mcTrend).toBe(label);
    }
  });

  it("falls back to the local heuristic when there is no scanner signal", () => {
    // No signal + no indicators + tiny move → honestly Neutral (never a guess).
    const row = rowFromTrustedQuote(
      trustedQuote({ lastPrice: 2500, previousClose: 2499 }),
      { signal: undefined, ema20: undefined, ema50: undefined, rsi14: undefined },
    );
    expect(row!.mcTrend).toBe("Neutral");
  });

  it("leaves missing indicators undefined (never coerced to 0)", () => {
    const row = rowFromTrustedQuote(trustedQuote(), enrich({ ema20: undefined, ema50: undefined, rsi14: undefined }));
    expect(row).not.toBeNull();
    expect(row!.ema20).toBeUndefined();
    expect(row!.ema50).toBeUndefined();
    expect(row!.rsi).toBeUndefined();
  });

  it("rejects (→ null) a quote without a real positive last price", () => {
    expect(rowFromTrustedQuote(trustedQuote({ lastPrice: 0 }), enrich())).toBeNull();
    expect(rowFromTrustedQuote(trustedQuote({ lastPrice: -5 }), enrich())).toBeNull();
  });

  it("rejects a quote without a real positive previous close", () => {
    expect(rowFromTrustedQuote(trustedQuote({ previousClose: 0 }), enrich())).toBeNull();
    expect(rowFromTrustedQuote(trustedQuote({ previousClose: undefined }), enrich())).toBeNull();
  });

  it("rejects a quote with incomplete OHLC (no fabrication)", () => {
    expect(rowFromTrustedQuote(trustedQuote({ open: undefined }), enrich())).toBeNull();
    expect(rowFromTrustedQuote(trustedQuote({ high: 0 }), enrich())).toBeNull();
    expect(rowFromTrustedQuote(trustedQuote({ low: undefined }), enrich())).toBeNull();
  });

  it("accepts zero volume (legitimate no-trade) but rejects missing volume", () => {
    expect(rowFromTrustedQuote(trustedQuote({ volume: 0 }), enrich())).not.toBeNull();
    expect(rowFromTrustedQuote(trustedQuote({ volume: undefined }), enrich())).toBeNull();
  });
});
