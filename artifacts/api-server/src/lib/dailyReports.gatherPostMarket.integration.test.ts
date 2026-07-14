/**
 * Checkpoint 2.5 integration test: verifies gatherPostMarketData's
 * INDEX PERFORMANCE section is wired to the new report-grade facade
 * (`marketData/reportGradeIndexQuotes`) and not the raw `kiteIndexQuotes`
 * import it replaced.
 *
 * All other gatherPostMarketData sections (option chain EOD, swing, F&O
 * summary, exit-monitor health) are isolated by mocking their dependencies
 * to fail; each section has its own try/catch in the source, so this
 * proves those failures don't affect (or get affected by) the index
 * performance wiring under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReportGradeIndexQuote } from "./marketData/reportGradeIndexQuotes";

vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn().mockRejectedValue(new Error("no db in unit test env")) },
}));
vi.mock("./kiteAuth", () => ({
  getActiveSessionStatus: vi.fn().mockReturnValue({ active: false }),
}));
vi.mock("./kiteFeed", () => ({
  feedStatus: vi.fn().mockReturnValue({ connected: false }),
}));
vi.mock("./paperDailySummaryFo", () => ({
  computeDailySummaryFo: vi.fn().mockRejectedValue(new Error("no db in unit test env")),
}));
vi.mock("./canonicalFnoReadiness", () => ({
  getCanonicalFnoReadiness: vi.fn().mockRejectedValue(new Error("no db in unit test env")),
  deriveFnoReadinessLabel: vi.fn().mockReturnValue("UNKNOWN"),
}));
vi.mock("./fnoExitMonitorHealth", () => ({
  getFnoExitMonitorHealth: vi.fn().mockReturnValue({ exitedTotal: 0 }),
}));
vi.mock("./alerting", () => ({
  sendPrePostTelegramMessage: vi.fn(),
  getPrePostTelegramStatus: vi.fn().mockReturnValue({ configured: false }),
}));

const getReportGradeIndexQuotesMock = vi.fn<(...args: unknown[]) => Promise<Map<string, ReportGradeIndexQuote>>>();
vi.mock("./marketData/reportGradeIndexQuotes", async () => {
  const actual = await vi.importActual<typeof import("./marketData/reportGradeIndexQuotes")>(
    "./marketData/reportGradeIndexQuotes",
  );
  return {
    ...actual,
    getReportGradeIndexQuotes: (...args: unknown[]) => getReportGradeIndexQuotesMock(...args),
  };
});

import { gatherPostMarketData } from "./dailyReports";
import { REPORT_INDEX_KEYS } from "./marketData/reportGradeIndexQuotes";

function makeGoodQuote(overrides: Partial<ReportGradeIndexQuote> = {}): ReportGradeIndexQuote {
  return {
    symbol: "^NSEI",
    name: "NIFTY 50",
    marketSession: "post_market",
    reportGrade: true,
    tradeGrade: false,
    canDriveSignals: false,
    canDrivePaperTrades: false,
    canDriveReports: true,
    ltp: 24500,
    open: 24400,
    changePct: 0.49,
    change: 120,
    high: 24600,
    low: 24350,
    close: 24500,
    previousClose: 24380,
    source: "KITE",
    sourceAsOf: new Date().toISOString(),
    freshnessSec: 900,
    reason: null,
    ...overrides,
  };
}

function makeUnavailableQuote(symbol: string, name: string): ReportGradeIndexQuote {
  return {
    symbol,
    name,
    marketSession: "post_market",
    reportGrade: false,
    tradeGrade: false,
    canDriveSignals: false,
    canDrivePaperTrades: false,
    canDriveReports: false,
    ltp: null,
    open: null,
    changePct: null,
    change: null,
    high: null,
    low: null,
    close: null,
    previousClose: null,
    source: "UNAVAILABLE",
    sourceAsOf: null,
    freshnessSec: null,
    reason: "INDEX_QUOTES_UNAVAILABLE",
  };
}

beforeEach(() => {
  getReportGradeIndexQuotesMock.mockReset();
});

describe("gatherPostMarketData — INDEX PERFORMANCE wiring (Checkpoint 2.5)", () => {
  it("populates indexPerformance rows when the report-grade facade returns usable data", async () => {
    const map = new Map<string, ReportGradeIndexQuote>();
    for (const { key, name } of REPORT_INDEX_KEYS) {
      map.set(key, makeGoodQuote({ symbol: key, name }));
    }
    getReportGradeIndexQuotesMock.mockResolvedValue(map);

    const result = await gatherPostMarketData(Date.now(), false);

    expect(getReportGradeIndexQuotesMock).toHaveBeenCalled();
    expect(result.indexPerformance).not.toBeNull();
    expect(result.indexPerformance!.rows.length).toBe(REPORT_INDEX_KEYS.length);
    const nifty = result.indexPerformance!.rows.find((r) => r.name === "NIFTY 50");
    expect(nifty?.close).toBe(24500);
    expect(nifty?.changePct).toBe(0.49);
  });

  it("collapses indexPerformance to null when the facade reports every index unavailable", async () => {
    const map = new Map<string, ReportGradeIndexQuote>();
    for (const { key, name } of REPORT_INDEX_KEYS) {
      map.set(key, makeUnavailableQuote(key, name));
    }
    getReportGradeIndexQuotesMock.mockResolvedValue(map);

    const result = await gatherPostMarketData(Date.now(), false);

    expect(result.indexPerformance).toBeNull();
  });

  it("skips a row missing changePct rather than fabricating one, while keeping other valid rows", async () => {
    const map = new Map<string, ReportGradeIndexQuote>();
    const [first, ...rest] = REPORT_INDEX_KEYS;
    map.set(first.key, makeGoodQuote({ symbol: first.key, name: first.name, changePct: null }));
    for (const { key, name } of rest) {
      map.set(key, makeGoodQuote({ symbol: key, name }));
    }
    getReportGradeIndexQuotesMock.mockResolvedValue(map);

    const result = await gatherPostMarketData(Date.now(), false);

    expect(result.indexPerformance).not.toBeNull();
    expect(result.indexPerformance!.rows.length).toBe(rest.length);
    expect(result.indexPerformance!.rows.some((r) => r.name === first.name)).toBe(false);
  });

  it("does not crash and still returns indexPerformance when unrelated DB-backed sections fail", async () => {
    const map = new Map<string, ReportGradeIndexQuote>();
    for (const { key, name } of REPORT_INDEX_KEYS) {
      map.set(key, makeGoodQuote({ symbol: key, name }));
    }
    getReportGradeIndexQuotesMock.mockResolvedValue(map);

    const result = await gatherPostMarketData(Date.now(), false);

    // Sections backed by the rejected db.execute()/computeDailySummaryFo mocks fail open.
    expect(result.optionChainEod).toBeNull();
    expect(result.swing).toBeNull();
    // The section under test is unaffected by those independent failures.
    expect(result.indexPerformance).not.toBeNull();
  });
});
