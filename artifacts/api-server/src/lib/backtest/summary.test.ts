import { describe, it, expect } from "vitest";
import { computeSummary, decidedTrades } from "./summary";
import type { BacktestTradeOut } from "./types";

function trade(partial: Partial<BacktestTradeOut>): BacktestTradeOut {
  return {
    id: Math.random().toString(36).slice(2),
    indexSymbol: "NIFTY",
    setupKey: "X",
    setupName: "X",
    direction: "BULLISH",
    optionType: "CALL",
    strike: 100,
    entryAt: "2026-01-01T03:45:00.000Z",
    exitAt: "2026-01-01T04:45:00.000Z",
    entrySpot: 100,
    exitSpot: 110,
    optionEntry: null,
    optionExit: null,
    optionStop: null,
    optionTarget1: null,
    optionTarget2: null,
    lots: 1,
    lotSize: 75,
    qty: 75,
    pnl: 0,
    exitReason: "TARGET",
    confidence: null,
    tier: null,
    regime: null,
    modeled: false,
    maxFavorableExcursion: null,
    maxAdverseExcursion: null,
    ...partial,
  };
}

describe("computeSummary", () => {
  it("returns honest nulls (never fabricated 0/100) when there are no decided trades", () => {
    const s = computeSummary([trade({ pnl: null })], 1_000_000);
    expect(s.totalTrades).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.avgWin).toBeNull();
    expect(s.avgLoss).toBeNull();
    expect(s.expectancy).toBeNull();
    expect(s.returnPct).toBeNull();
    expect(s.equityCurve).toHaveLength(0);
  });

  it("profitFactor is null when there are no losers (no divide-by-zero fabrication)", () => {
    const s = computeSummary(
      [trade({ pnl: 100, exitAt: "2026-01-01T04:00:00Z" }), trade({ pnl: 50, exitAt: "2026-01-01T05:00:00Z" })],
      1_000_000,
    );
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(0);
    expect(s.winRate).toBe(100);
    expect(s.profitFactor).toBeNull();
    expect(s.avgLoss).toBeNull();
  });

  it("computes win-rate, profit-factor, drawdown and expectancy from decided trades", () => {
    const trades = [
      trade({ pnl: 100, exitAt: "2026-01-01T04:00:00Z" }),
      trade({ pnl: -50, exitAt: "2026-01-01T05:00:00Z" }),
      trade({ pnl: -50, exitAt: "2026-01-01T06:00:00Z" }),
      trade({ pnl: 200, exitAt: "2026-01-01T07:00:00Z" }),
    ];
    const s = computeSummary(trades, 1_000_000);
    expect(s.totalTrades).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.winRate).toBe(50);
    expect(s.grossProfit).toBe(300);
    expect(s.grossLoss).toBe(100);
    expect(s.profitFactor).toBe(3);
    expect(s.totalPnl).toBe(200);
    expect(s.avgWin).toBe(150);
    expect(s.avgLoss).toBe(50);
    // equity walks forward in exit order: 1.0M+100, -50, -50, +200
    expect(s.equityCurve.map((p) => p.equity)).toEqual([
      1_000_100, 1_000_050, 1_000_000, 1_000_200,
    ]);
    // peak after first =1_000_100; trough 1_000_000 ⇒ maxDD 100
    expect(s.maxDrawdown).toBe(100);
  });

  it("decidedTrades excludes undecided (null pnl) rows", () => {
    const arr = [trade({ pnl: 10 }), trade({ pnl: null }), trade({ pnl: -5 })];
    expect(decidedTrades(arr)).toHaveLength(2);
  });
});
