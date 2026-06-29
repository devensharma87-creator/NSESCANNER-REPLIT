/**
 * Unit tests for swingCashRiskGuards.ts (Part D, composer) — pure module.
 * Verifies the default config is the safest (paper_only, manual approval) and
 * that the full gate chain aggregates block reasons correctly.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateSwingCashRisk,
  DEFAULT_SWING_CASH_CONFIG,
} from "./swingCashRiskGuards";
import type {
  SwingCashCandidate,
  SwingCashPortfolioState,
} from "./swingCashTypes";

const NOW = Date.UTC(2026, 5, 29, 5, 0, 0);

function makeCandidate(overrides: Partial<SwingCashCandidate> = {}): SwingCashCandidate {
  return {
    symbol: "ACME",
    sector: "IT",
    entry: 100,
    stop: 95,
    target1: 115,
    target2: 120,
    atr: 4,
    ltp: 101,
    rr: 3,
    dataSource: "kite",
    ohlc: { open: 100, high: 105, low: 99, close: 104 },
    dailyCandleAsOfMs: NOW - 60 * 1000,
    ltpAsOfMs: NOW - 60 * 1000,
    benchmarkAvailable: true,
    sectorAvailable: true,
    signalAgeDays: 0,
    triggered: true,
    avgTradedValue: 100_000_000,
    volume: 500_000,
    spreadPct: 0.2,
    deliveryPct: 60,
    asmGsmStatus: "NONE",
    circuitRisk: false,
    daysToResult: 30,
    isResultDay: false,
    corporateActionRisk: false,
    eventDataAvailable: true,
    resultScheduleKnown: true,
    newsRiskAvailable: true,
    nowMs: NOW,
    ...overrides,
  };
}

function makePortfolio(
  overrides: Partial<SwingCashPortfolioState> = {},
): SwingCashPortfolioState {
  return {
    totalSwingCapital: 1_000_000,
    availableCash: 1_000_000,
    openPositionSymbols: [],
    sectorExposureValueBySector: {},
    singleStockExposureValueBySymbol: {},
    sectorOpenCountBySector: {},
    lastEntryDateBySymbolIst: {},
    todayIst: "2026-06-29",
    dailyEntriesUsed: 0,
    weeklyEntriesUsed: 0,
    openPositionsCount: 0,
    ...overrides,
  };
}

describe("DEFAULT_SWING_CASH_CONFIG", () => {
  it("defaults to the safest mode with manual approval", () => {
    expect(DEFAULT_SWING_CASH_CONFIG.mode).toBe("paper_only");
    expect(DEFAULT_SWING_CASH_CONFIG.requireManualApproval).toBe(true);
    expect(DEFAULT_SWING_CASH_CONFIG.liveCapitalCapPct).toBeLessThanOrEqual(10);
  });
});

describe("evaluateSwingCashRisk", () => {
  it("allows a fully clean candidate in paper_only mode (no live order)", () => {
    const d = evaluateSwingCashRisk(makeCandidate(), makePortfolio());
    expect(d.reasons).toEqual([]);
    expect(d.allowed).toBe(true);
    expect(d.severity).toBe("info");
    expect(d.mode).toBe("paper_only");
    expect(d.metrics.qty).toBeGreaterThan(0);
  });

  it("blocks a Yahoo-sourced candidate", () => {
    const d = evaluateSwingCashRisk(makeCandidate({ dataSource: "yahoo" }), makePortfolio());
    expect(d.allowed).toBe(false);
    expect(d.severity).toBe("block");
    expect(d.reasons).toContain("DATA_NOT_TRADE_GRADE");
  });

  it("blocks stale data", () => {
    const d = evaluateSwingCashRisk(
      makeCandidate({ dailyCandleAsOfMs: NOW - 40 * 60 * 60 * 1000 }),
      makePortfolio(),
    );
    expect(d.reasons).toContain("DATA_STALE");
  });

  it("blocks a chased entry", () => {
    const d = evaluateSwingCashRisk(makeCandidate({ ltp: 103 }), makePortfolio());
    expect(d.reasons).toContain("ENTRY_CHASED");
  });

  it("blocks once the daily entry cap is hit", () => {
    const d = evaluateSwingCashRisk(
      makeCandidate(),
      makePortfolio({ dailyEntriesUsed: 1 }),
    );
    expect(d.reasons).toContain("MAX_DAILY_ENTRIES");
  });

  it("blocks a duplicate position", () => {
    const d = evaluateSwingCashRisk(
      makeCandidate(),
      makePortfolio({ openPositionSymbols: ["ACME"], openPositionsCount: 1 }),
    );
    expect(d.reasons).toContain("DUPLICATE_POSITION");
  });

  it("requires manual review for a clean candidate in a live-capable mode", () => {
    const d = evaluateSwingCashRisk(makeCandidate(), makePortfolio(), {
      ...DEFAULT_SWING_CASH_CONFIG,
      mode: "live_staged_approval",
    });
    expect(d.reasons).toEqual([]);
    expect(d.reviewRequired).toBe(true);
    expect(d.allowed).toBe(false);
    expect(d.severity).toBe("warn");
  });

  it("requires review (not a hard block) when event data is unavailable", () => {
    const d = evaluateSwingCashRisk(
      makeCandidate({ eventDataAvailable: false }),
      makePortfolio(),
    );
    expect(d.reviewRequired).toBe(true);
    expect(d.allowed).toBe(false);
    expect(d.metrics.eventClassification).toBe("EVENT_DATA_UNAVAILABLE_REVIEW_REQUIRED");
  });

  it("blocks (never silently passes) when a portfolio counter is non-finite", () => {
    const d = evaluateSwingCashRisk(
      makeCandidate(),
      makePortfolio({ openPositionsCount: NaN }),
    );
    expect(d.allowed).toBe(false);
    expect(d.severity).toBe("block");
    expect(d.reasons).toContain("PORTFOLIO_STATE_INVALID");
  });

  it("blocks when total swing capital is non-finite (sizing input invalid)", () => {
    const d = evaluateSwingCashRisk(
      makeCandidate(),
      makePortfolio({ totalSwingCapital: NaN }),
    );
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain("SIZING_INPUT_INVALID");
    expect(d.reasons).toContain("PORTFOLIO_STATE_INVALID");
  });

  it("blocks when the current sector exposure snapshot is non-finite", () => {
    const d = evaluateSwingCashRisk(
      makeCandidate({ sector: "IT" }),
      makePortfolio({ sectorExposureValueBySector: { IT: NaN } }),
    );
    expect(d.allowed).toBe(false);
    expect(d.severity).toBe("block");
    expect(d.reasons).toContain("EXPOSURE_INPUT_INVALID");
  });
});
