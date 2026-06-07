import { describe, it, expect } from "vitest";
import { computeAdvice, summarizeAdvice, type AdviceInput } from "./advice";
import type { LiveMetrics, HoldingMetrics, RawHolding } from "./types";

const RAW: RawHolding = { symbol: "TEST", name: "Test Co", qty: 10, rate: 100 };

function live(overrides: Partial<LiveMetrics> = {}): LiveMetrics {
  return {
    available: true,
    sector: "IT",
    cmp: 120,
    previousClose: 119,
    rsi14: null,
    dma50: null,
    dma200: null,
    supportZone: null,
    resistanceZone: null,
    trendStrength: null,
    peRatio: null,
    pbRatio: null,
    roe: null,
    marketCapCr: null,
    beta: null,
    roce: null,
    debtToEquity: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    ...overrides,
  };
}

function metrics(overrides: Partial<HoldingMetrics> = {}): HoldingMetrics {
  return {
    invested: 1000,
    currentValue: 1200,
    dayChange: 10,
    dayChangePct: 0.8,
    totalReturn: 200,
    totalReturnPct: 20,
    weightPct: 10,
    ...overrides,
  };
}

function input(over: Partial<AdviceInput> = {}): AdviceInput {
  return {
    raw: RAW,
    live: live(),
    metrics: metrics(),
    sectorWeightPct: 15,
    fundamentalsApplicable: true,
    ...over,
  };
}

describe("computeAdvice — verdicts", () => {
  it("DATA_INCOMPLETE when CMP is null", () => {
    const r = computeAdvice(input({ live: live({ cmp: null, available: false }) }));
    expect(r.verdict).toBe("DATA_INCOMPLETE");
    expect(r.confidence).toBe("Low");
    expect(r.headline).toMatch(/DATA INCOMPLETE/i);
    expect(r.targetZone).toBeNull();
    expect(r.stopLoss).toBeNull();
  });

  it("WATCHLIST when only a bare price is available", () => {
    const r = computeAdvice(
      input({ live: live({ cmp: 120, rsi14: null, dma50: null, dma200: null }) }),
    );
    expect(r.verdict).toBe("WATCHLIST");
    expect(r.confidence).toBe("Low");
    expect(r.dataQuality.level).toBe("price-only");
  });

  it("ACCUMULATE for strong structure + healthy momentum + quality", () => {
    const r = computeAdvice(
      input({
        live: live({
          cmp: 120,
          dma50: 110,
          dma200: 100,
          rsi14: 55,
          trendStrength: 65,
          peRatio: 18,
          roe: 18,
          resistanceZone: 140,
        }),
        metrics: metrics({ totalReturnPct: 12, weightPct: 10 }),
        sectorWeightPct: 15,
      }),
    );
    expect(r.verdict).toBe("ACCUMULATE");
    expect(r.accumulationZone).not.toBeNull();
    expect(r.accumulationZone!.low).toBe(110); // nearest support below = 50-DMA
  });

  it("HOLD when trend is intact but valuation is rich (no fresh add)", () => {
    const r = computeAdvice(
      input({
        live: live({ cmp: 120, dma50: 110, dma200: 100, rsi14: 55, peRatio: 60, roe: 18 }),
        metrics: metrics({ totalReturnPct: 12, weightPct: 10 }),
      }),
    );
    expect(r.verdict).toBe("HOLD");
    // technical-vs-fundamental conflict downgrades confidence off High.
    expect(r.confidence).not.toBe("High");
  });

  it("TRIM when overextended and overbought after a big run-up", () => {
    const r = computeAdvice(
      input({
        live: live({ cmp: 150, dma50: 120, dma200: 100, rsi14: 78, trendStrength: 70 }),
        metrics: metrics({ totalReturnPct: 50, weightPct: 12 }),
      }),
    );
    expect(r.verdict).toBe("TRIM");
  });

  it("TRIM when the position has become oversized", () => {
    const r = computeAdvice(
      input({
        live: live({ cmp: 120, dma50: 110, dma200: 100, rsi14: 55, peRatio: 18, roe: 18 }),
        metrics: metrics({ totalReturnPct: 12, weightPct: 30 }),
        sectorWeightPct: 20,
      }),
    );
    expect(r.verdict).toBe("TRIM");
  });

  it("EXIT when structure is broken and the position is deeply underwater", () => {
    const r = computeAdvice(
      input({
        live: live({ cmp: 80, dma50: 100, dma200: 110, rsi14: 35 }),
        metrics: metrics({ totalReturnPct: -25, weightPct: 8 }),
      }),
    );
    expect(r.verdict).toBe("EXIT");
    expect(r.riskLevel === "Elevated" || r.riskLevel === "High").toBe(true);
  });

  it("AVOID for a weak-but-not-broken name with rich valuation", () => {
    const r = computeAdvice(
      input({
        live: live({ cmp: 98, dma50: 105, dma200: 100, rsi14: 45, peRatio: 60 }),
        metrics: metrics({ totalReturnPct: -5, weightPct: 8 }),
      }),
    );
    expect(r.verdict).toBe("AVOID");
  });
});

describe("computeAdvice — data quality & confidence", () => {
  it("reduces confidence below High when fundamentals are missing on a strong verdict", () => {
    const r = computeAdvice(
      input({
        live: live({ cmp: 120, dma50: 110, dma200: 100, rsi14: 55, trendStrength: 65 }),
        metrics: metrics({ totalReturnPct: 12, weightPct: 10 }),
      }),
    );
    expect(r.verdict).toBe("ACCUMULATE");
    expect(r.dataQuality.level).toBe("partial");
    expect(r.confidence).toBe("Low");
    expect(r.dataQuality.missing).toContain("fundamentals (P/E, RoE, debt)");
  });

  it("ETF (fundamentals not applicable) is not penalised for missing fundamentals", () => {
    const r = computeAdvice(
      input({
        live: live({ cmp: 120, dma50: 110, dma200: 100, rsi14: 55, trendStrength: 65 }),
        fundamentalsApplicable: false,
      }),
    );
    expect(r.dataQuality.level).toBe("full");
    expect(r.fundamentalView).toMatch(/Not applicable/i);
  });
});

describe("computeAdvice — levels are never fabricated", () => {
  it("returns null target when no resistance and no support level exists", () => {
    const r = computeAdvice(
      input({
        live: live({ cmp: 120, rsi14: 55, dma50: null, dma200: null }),
      }),
    );
    expect(r.targetZone).toBeNull();
    expect(r.upsidePct).toBeNull();
    expect(r.stopLoss).toBeNull();
  });

  it("derives a target only from real resistance / risk-reward levels", () => {
    const r = computeAdvice(
      input({
        live: live({ cmp: 120, dma50: 110, dma200: 100, rsi14: 55, resistanceZone: 150 }),
      }),
    );
    expect(r.stopLoss).toBe(110); // nearest support below = 50-DMA
    expect(r.targetZone).not.toBeNull();
    // RR target = 120 + 2*(120-110) = 140; resistance = 150 → band [140, 150].
    expect(r.targetZone!.low).toBe(140);
    expect(r.targetZone!.high).toBe(150);
    expect(r.upsidePct).toBeCloseTo(25, 5);
  });
});

describe("computeAdvice — stale data never yields a strong verdict", () => {
  // Stale = a live CMP but NO derivable structure (DMA) and NO momentum (RSI).
  // A P/E alone makes `canAssess` true, so without the gate a strong branch could fire.
  it("caps a big-runup name to WATCHLIST instead of TRIM when data is stale", () => {
    const r = computeAdvice(
      input({
        live: live({ cmp: 150, dma50: null, dma200: null, rsi14: null, peRatio: 18 }),
        metrics: metrics({ totalReturnPct: 50, weightPct: 12 }),
      }),
    );
    expect(r.dataQuality.stale).toBe(true);
    expect(r.verdict).toBe("WATCHLIST");
    expect(r.confidence).toBe("Low");
    expect(r.reasonCodes.some(c => c.code === "STALE_DATA_GATE")).toBe(true);
  });

  it("caps a rich-valuation weak name to WATCHLIST instead of AVOID/EXIT when stale", () => {
    const r = computeAdvice(
      input({
        live: live({ cmp: 98, dma50: null, dma200: null, rsi14: null, peRatio: 60 }),
        metrics: metrics({ totalReturnPct: -25, weightPct: 8 }),
      }),
    );
    expect(r.dataQuality.stale).toBe(true);
    expect(["WATCHLIST", "HOLD"]).toContain(r.verdict);
    expect(r.confidence).toBe("Low");
  });
});

describe("summarizeAdvice", () => {
  it("counts verdicts and groups symbols by priority", () => {
    const mk = (symbol: string, over: Partial<AdviceInput>) => ({
      symbol,
      advice: computeAdvice(input({ raw: { ...RAW, symbol }, ...over })),
    });
    const items = [
      mk("EXITCO", { live: live({ cmp: 80, dma50: 100, dma200: 110, rsi14: 35 }), metrics: metrics({ totalReturnPct: -25 }) }),
      mk("ACCCO", { live: live({ cmp: 120, dma50: 110, dma200: 100, rsi14: 55, trendStrength: 65, peRatio: 18, roe: 18 }), metrics: metrics({ totalReturnPct: 12, weightPct: 10 }), sectorWeightPct: 15 }),
      mk("DATACO", { live: live({ cmp: null, available: false }) }),
    ];
    const s = summarizeAdvice(items);
    expect(s.counts.EXIT).toBe(1);
    expect(s.counts.ACCUMULATE).toBe(1);
    expect(s.counts.DATA_INCOMPLETE).toBe(1);
    // EXIT is highest priority → first group.
    expect(s.groups[0].verdict).toBe("EXIT");
    expect(s.groups[0].symbols).toContain("EXITCO");
  });
});
