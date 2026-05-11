import { describe, expect, it } from "vitest";
import type { Indicators, Quote, Signal } from "@workspace/api-zod";
import { computeEntrySafety } from "./scoring";

// ---- Test fixtures ----
//
// APOLLOHOSP-like setup: Strong Bullish, +2.7% same day, price = 8115 right at
// 52W high 8120, R1 8110, ATR 110. This is the canonical case the gate was
// designed to catch.

function bullishQuote(over: Partial<Quote> = {}): Quote {
  return {
    symbol: "APOLLOHOSP",
    name: "Apollo Hospitals",
    exchange: "NSE",
    price: 8115,
    change: 213,
    changePercent: 2.7,
    open: 7920,
    high: 8118,           // tagged 52W high (8120 * 0.9998)
    low: 7905,
    previousClose: 7902,
    volume: 1_500_000,
    avgVolume: 900_000,
    fiftyTwoWeekHigh: 8120,
    fiftyTwoWeekLow: 5400,
    updatedAt: new Date(),
    ...over,
  };
}
function bullishIndicators(over: Partial<Indicators> = {}): Indicators {
  return {
    resistanceLevel: 8118,    // 20D swing high (also tagged today)
    supportLevel: 7600,
    r1: 8110,
    s1: 7700,
    pivot: 7900,
    atr14: 110,
    vwap: 7960,
    ema20: 7840,
    ema50: 7600,
    rsi14: 72,
    ...over,
  };
}
function bearishQuote(over: Partial<Quote> = {}): Quote {
  return {
    symbol: "FOO",
    name: "Foo Co",
    exchange: "NSE",
    price: 100,
    change: -3,
    changePercent: -3.0,
    open: 105,
    low: 99.6,            // tagged 52W low (99.5 * 1.001)
    high: 106,
    previousClose: 103,
    volume: 1_000_000,
    avgVolume: 800_000,
    fiftyTwoWeekHigh: 180,
    fiftyTwoWeekLow: 99.5,
    updatedAt: new Date(),
    ...over,
  };
}
function bearishIndicators(over: Partial<Indicators> = {}): Indicators {
  return {
    resistanceLevel: 130,
    supportLevel: 99.6,    // tagged today
    r1: 110,
    s1: 100,
    pivot: 105,
    atr14: 4,
    vwap: 104,
    ema20: 108,
    ema50: 115,
    rsi14: 28,
    ...over,
  };
}
function run(signal: Signal, q: Quote, ind: Indicators) {
  return computeEntrySafety({ signal, price: q.price, quote: q, indicators: ind, atr14: ind.atr14 ?? null });
}

describe("computeEntrySafety — bullish POOR (Pass-A demote)", () => {
  it("APOLLOHOSP-like case fires POOR + LATE_ENTRY_AT_RESISTANCE", () => {
    const r = run("STRONG_BUY", bullishQuote(), bullishIndicators());
    expect(r.quality).toBe("POOR");
    expect(r.demoteTag).toBe("LATE_ENTRY_AT_RESISTANCE");
    expect(r.plan?.reason).toContain("extended");
    // Avoid zone straddles a level near today's price; breakout above it.
    expect(r.plan?.avoidZone?.low).toBeGreaterThan(8050);
    expect(r.plan?.breakoutTrigger).toBeGreaterThan(r.plan!.avoidZone!.high);
    // Pullback zone uses VWAP (7960) and EMA20 (7840), both below price.
    expect(r.plan?.pullbackZone).toEqual({ low: 7840, high: 7960 });
  });

  it("does NOT fire when today's move is below the 2.5% threshold", () => {
    const r = run("STRONG_BUY", bullishQuote({ changePercent: 2.0, change: 158 }), bullishIndicators());
    // Still inside 1.5% proximity → FAIR (advisory), but no demote.
    expect(r.quality).toBe("FAIR");
    expect(r.demoteTag).toBeUndefined();
  });

  it("does NOT fire when today's high never tagged the level", () => {
    // Today's high 7990 is well below 8120 (52W) and 8118 (20D high) → not tagged.
    const r = run("STRONG_BUY", bullishQuote({ high: 7990, price: 7980, change: 200, changePercent: 2.6 }), bullishIndicators());
    expect(r.quality).not.toBe("POOR");
    expect(r.demoteTag).toBeUndefined();
  });
});

describe("computeEntrySafety — strict pre-filter (architect HIGH fix)", () => {
  it("does NOT fire after a clean break above resistance (level already crossed)", () => {
    // Price 8200 has cleared every candidate; 52W=8120, R1=8110, swing=8118 all < price.
    const q = bullishQuote({ price: 8200, high: 8205, change: 280, changePercent: 3.5 });
    const r = run("STRONG_BUY", q, bullishIndicators());
    expect(r.quality).toBe("GOOD");
    expect(r.demoteTag).toBeUndefined();
  });

  it("ATR proximity does NOT apply to 52W high (architect HIGH fix)", () => {
    // Price 8000 sits 120 below 52W high 8120; that's within 1 ATR (110? no — > 110 here),
    // but more importantly: even if ATR were larger, 52W must use %-only.
    // Configure: ATR 200 (would normally pull 52W into range), price 7950 (1.5%+ off level).
    const q = bullishQuote({ price: 7950, high: 7960, change: 200, changePercent: 2.6,
                             fiftyTwoWeekHigh: 8120 });
    const ind = bullishIndicators({
      atr14: 200,
      resistanceLevel: undefined,    // remove the swing-high candidate
      r1: undefined,                  // remove R1 too
    });
    const r = run("STRONG_BUY", q, ind);
    // Only 52W left; %-distance = (8120-7950)/7950 = 2.14% > 1.5% → not "near".
    expect(r.quality).not.toBe("POOR");
    expect(r.demoteTag).toBeUndefined();
  });

  it("ATR proximity DOES apply to R1 / swing-high", () => {
    // Price 8000, R1 8100 → distance 100, within 1 ATR (110). Tagged today, +2.7%.
    const q = bullishQuote({ price: 8000, high: 8095, change: 210, changePercent: 2.7,
                             fiftyTwoWeekHigh: 9000 });   // 52W far away, irrelevant
    const ind = bullishIndicators({
      resistanceLevel: undefined,
      r1: 8100,
      atr14: 110,
    });
    const r = run("STRONG_BUY", q, ind);
    expect(r.quality).toBe("POOR");
    expect(r.demoteTag).toBe("LATE_ENTRY_AT_RESISTANCE");
  });
});

describe("computeEntrySafety — bearish mirror", () => {
  it("fires POOR + LATE_ENTRY_AT_SUPPORT for STRONG_SELL near 52W low after -3% day", () => {
    const r = run("STRONG_SELL", bearishQuote(), bearishIndicators());
    expect(r.quality).toBe("POOR");
    expect(r.demoteTag).toBe("LATE_ENTRY_AT_SUPPORT");
  });

  it("does NOT fire when bearish move is shallower than -2.5%", () => {
    const r = run("STRONG_SELL", bearishQuote({ changePercent: -1.5, change: -1.5 }), bearishIndicators());
    expect(r.demoteTag).toBeUndefined();
  });
});

describe("computeEntrySafety — degraded inputs", () => {
  it("missing ATR → still works via %-proximity only", () => {
    const r = run("STRONG_BUY", bullishQuote(), bullishIndicators({ atr14: undefined }));
    expect(r.quality).toBe("POOR");                   // 1.5% proximity to 52W still trips
  });

  it("missing VWAP + EMA20 → pullback zone falls back to EMA50 or omits", () => {
    const r = run("STRONG_BUY", bullishQuote(),
                  bullishIndicators({ vwap: undefined, ema20: undefined, ema50: 7600 }));
    expect(r.quality).toBe("POOR");
    // EMA50 alone produces a thin band [7600, 7600*1.005=7638]
    expect(r.plan?.pullbackZone?.low).toBe(7600);
    expect(r.plan?.pullbackZone?.high).toBeCloseTo(7638, 0);
  });

  it("no major levels at all → GOOD (no plan)", () => {
    const r = run("STRONG_BUY", bullishQuote({ fiftyTwoWeekHigh: undefined }),
                  bullishIndicators({ resistanceLevel: undefined, r1: undefined }));
    expect(r.quality).toBe("GOOD");
    expect(r.plan).toBeUndefined();
  });

  it("NEUTRAL signal → no quality, no plan", () => {
    const r = run("NEUTRAL", bullishQuote(), bullishIndicators());
    expect(r.quality).toBeUndefined();
    expect(r.plan).toBeUndefined();
    expect(r.demoteTag).toBeUndefined();
  });
});

describe("computeEntrySafety — FAIR advisory", () => {
  it("inside 3% but outside 1.5% with no tag → FAIR, no demote", () => {
    // Price 7900, 52W 8120 → 2.78% off. ATR removed so R1 doesn't catch. Not tagged.
    const q = bullishQuote({ price: 7900, high: 7910, change: 50, changePercent: 0.6 });
    const ind = bullishIndicators({ atr14: undefined, resistanceLevel: undefined, r1: undefined });
    const r = run("BUY", q, ind);
    expect(r.quality).toBe("FAIR");
    expect(r.demoteTag).toBeUndefined();
    expect(r.plan?.reason).toContain("approaching");
  });
});
