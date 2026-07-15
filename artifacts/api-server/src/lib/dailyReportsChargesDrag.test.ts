/**
 * Charges-Drag line rendering test — extends the post-market report
 * (P0 Phase B) to surface how much of gross P&L was eaten by friction.
 *
 * The drag line is silent when no CURRENT-tagged row closed today;
 * it MUST NOT print a phantom line from legacy-only or empty data.
 */
import { describe, it, expect } from "vitest";
import {
  buildPostMarketReport,
  type PostMarketReportData,
  type PostMarketFno,
  type PostMarketEquityPaper,
} from "./dailyReports";

function makeFno(overrides: Partial<PostMarketFno> = {}): PostMarketFno {
  return {
    tradesOpened: 2,
    tradesClosed: 2,
    openCount: 0,
    totalPnl: 1000,
    totalCharges: 80,
    totalNetPnl: 920,
    chargesCoverage: { current: 2, legacy: 0 },
    ...overrides,
  };
}

function makeEquityPaper(
  overrides: Partial<PostMarketEquityPaper> = {},
): PostMarketEquityPaper {
  return {
    openedToday: 1,
    closedToday: 1,
    openCount: 0,
    grossPnlToday: 500,
    chargesTotalToday: 25,
    netPnlToday: 475,
    chargesCoverage: { current: 1, legacy: 0 },
    ...overrides,
  };
}

function makeData(overrides: Partial<PostMarketReportData> = {}): PostMarketReportData {
  return {
    isManualTest: false,
    istDate: "2026-07-15",
    isWeekend: false,
    canonicalFno: null,
    fno: makeFno(),
    swing: null,
    equityPaper: makeEquityPaper(),
    indexPerformance: null,
    optionChainEod: null,
    exitMonitorVerified: true,
    observabilityToday: null,
    ...overrides,
  };
}

describe("Charges Drag line — F&O", () => {
  it("renders drag % + bps when both gross and charges are present (CURRENT rows)", () => {
    const text = buildPostMarketReport(makeData());
    // 80 / |1000| × 100 = 8.00%
    // 80 / |1000| × 10000 = 800 bps
    expect(text).toContain("F&O charges drag: 8.00% of |gross| (800 bps)");
  });

  it("negative gross still renders correctly (uses absolute value)", () => {
    const text = buildPostMarketReport(
      makeData({
        fno: makeFno({ totalPnl: -500, totalCharges: 60, totalNetPnl: -560 }),
      }),
    );
    // 60 / 500 × 100 = 12%
    expect(text).toContain("F&O charges drag: 12.00% of |gross| (1200 bps)");
  });

  it("gross ≈ 0 with non-zero charges: uses the 'friction is the entire result' path", () => {
    const text = buildPostMarketReport(
      makeData({
        fno: makeFno({ totalPnl: 0, totalCharges: 40, totalNetPnl: -40 }),
      }),
    );
    expect(text).toContain("F&O charges drag: gross ≈ ₹0 today");
    expect(text).toContain("friction ₹-40");
    // Must NOT print the divide-by-zero percentage line.
    expect(text).not.toMatch(/F&O charges drag: [^g]+% of/);
  });

  it("silent when no CURRENT rows (legacy-only day)", () => {
    const text = buildPostMarketReport(
      makeData({
        fno: makeFno({
          totalCharges: null,
          totalNetPnl: null,
          chargesCoverage: { current: 0, legacy: 3 },
        }),
      }),
    );
    expect(text).not.toContain("F&O charges drag");
    expect(text).toContain("F&O charges: not stored (3 legacy pre-P0 trades closed today)");
  });

  it("silent when zero trades closed today", () => {
    const text = buildPostMarketReport(
      makeData({
        fno: makeFno({
          tradesOpened: 0,
          tradesClosed: 0,
          openCount: 0,
          totalPnl: null,
          totalCharges: null,
          totalNetPnl: null,
          chargesCoverage: { current: 0, legacy: 0 },
        }),
      }),
    );
    expect(text).not.toContain("F&O charges drag");
    expect(text).toContain("F&O paper trades: none today");
  });
});

describe("Charges Drag line — Equity", () => {
  it("renders equity drag % + bps when both gross and charges present", () => {
    const text = buildPostMarketReport(makeData());
    // 25 / |500| × 100 = 5.00%
    expect(text).toContain("Equity charges drag: 5.00% of |gross| (500 bps)");
    expect(text).toContain("Equity gross realized P&L: ₹+500");
    expect(text).toContain("Equity net realized P&L: ₹+475");
    expect(text).toContain("Equity charges (durable, 1 trade): ₹-25");
  });

  it("silent when equityPaper has no CURRENT rows", () => {
    const text = buildPostMarketReport(
      makeData({
        equityPaper: makeEquityPaper({
          grossPnlToday: null,
          chargesTotalToday: null,
          netPnlToday: null,
          chargesCoverage: { current: 0, legacy: 0 },
        }),
      }),
    );
    expect(text).not.toContain("Equity charges drag");
    expect(text).not.toContain("Equity gross realized");
  });

  it("legacy-only equity day emits explicit 'not stored' line, no drag", () => {
    const text = buildPostMarketReport(
      makeData({
        equityPaper: makeEquityPaper({
          grossPnlToday: null,
          chargesTotalToday: null,
          netPnlToday: null,
          chargesCoverage: { current: 0, legacy: 2 },
        }),
      }),
    );
    expect(text).toContain("Equity charges: not stored (2 legacy pre-P0 trades closed today)");
    expect(text).not.toContain("Equity charges drag");
  });
});
