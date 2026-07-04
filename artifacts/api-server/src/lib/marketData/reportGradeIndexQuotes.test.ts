/**
 * Tests for the Checkpoint 2.5 report-grade index quote facade.
 *
 * Coverage:
 *   - accepts a same-day close snapshot even past the 10-minute trade-grade
 *     hard-stale budget (the exact 15:45 post-market scenario);
 *   - never tradeGrade / canDriveSignals / canDrivePaperTrades;
 *   - can drive reports when data is valid;
 *   - refuses a quote older than today's session (previous-day cache);
 *   - market-closed/weekend never fakes live data;
 *   - upstream unavailable → honest UNAVAILABLE, not fabricated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MarketQuote } from "./types";

const getIndexQuotesMock = vi.fn<() => Promise<Map<string, MarketQuote> | null>>();

vi.mock("./kiteProvider", () => ({
  getIndexQuotes: () => getIndexQuotesMock(),
}));

import { getReportGradeIndexQuotes, deriveMarketSession, REPORT_INDEX_KEYS } from "./reportGradeIndexQuotes";

function makeQuote(overrides: Partial<MarketQuote> = {}, asOfIso: string | null): MarketQuote {
  return {
    symbol: "^NSEI",
    name: "NIFTY 50",
    lastPrice: 24500,
    open: 24400,
    high: 24600,
    low: 24350,
    previousClose: 24380,
    change: 120,
    changePercent: 0.49,
    ...overrides,
    meta: {
      source: "kite",
      trustTier: "authoritative",
      asOf: asOfIso,
      fetchedAt: new Date().toISOString(),
      freshnessSec: null,
      isStale: false,
      delayed: false,
      notForSignals: false,
      notForTradeDecisions: false,
      validationStatus: "validated",
      warnings: [],
    },
  };
}

// A Tuesday, well clear of weekends — 15:45 IST post-market report instant.
const POST_MARKET_NOW = Date.parse("2026-07-07T10:15:00.000Z"); // 15:45 IST
// The IST market close (15:30) the same day — 15 minutes before "now".
const MARKET_CLOSE_ASOF = new Date(Date.parse("2026-07-07T10:00:00.000Z")).toISOString(); // 15:30 IST
// Yesterday's close — before today's session, must never be shown as today's data.
const YESTERDAY_ASOF = new Date(Date.parse("2026-07-06T10:00:00.000Z")).toISOString();
// Saturday — market genuinely closed all day.
const SATURDAY_NOW = Date.parse("2026-07-11T06:00:00.000Z"); // 11:30 IST Saturday

beforeEach(() => {
  getIndexQuotesMock.mockReset();
});

describe("deriveMarketSession", () => {
  it("classifies weekday market hours as open", () => {
    // 2026-07-07 is a Tuesday; 10:00 IST is 04:30 UTC.
    expect(deriveMarketSession(Date.parse("2026-07-07T04:30:00.000Z"))).toBe("open");
  });

  it("classifies weekday post-close window as post_market", () => {
    expect(deriveMarketSession(POST_MARKET_NOW)).toBe("post_market");
  });

  it("classifies weekends as closed", () => {
    expect(deriveMarketSession(SATURDAY_NOW)).toBe("closed");
  });

  it("classifies late-night weekday as closed", () => {
    // 23:00 IST Tuesday.
    expect(deriveMarketSession(Date.parse("2026-07-07T17:30:00.000Z"))).toBe("closed");
  });
});

describe("getReportGradeIndexQuotes", () => {
  it("accepts today's close snapshot past the 10-minute trade-grade hard-stale budget", async () => {
    const map = new Map<string, MarketQuote>();
    for (const { key, name } of REPORT_INDEX_KEYS) {
      map.set(key, makeQuote({ symbol: key, name }, MARKET_CLOSE_ASOF));
    }
    getIndexQuotesMock.mockResolvedValue(map);

    const result = await getReportGradeIndexQuotes("REPORT_POST_MARKET", POST_MARKET_NOW);

    for (const { key } of REPORT_INDEX_KEYS) {
      const q = result.get(key);
      expect(q).toBeDefined();
      expect(q!.reportGrade).toBe(true);
      expect(q!.canDriveReports).toBe(true);
      expect(q!.ltp).toBe(24500);
      expect(q!.source).toBe("KITE");
      expect(q!.sourceAsOf).toBe(MARKET_CLOSE_ASOF);
      expect(q!.freshnessSec).toBeGreaterThan(600); // proves it IS past the 10-min trade-grade budget
      expect(q!.reason).toBeNull();
    }
  });

  it("never marks a row tradeGrade / canDriveSignals / canDrivePaperTrades", async () => {
    const map = new Map<string, MarketQuote>();
    map.set("^NSEI", makeQuote({}, MARKET_CLOSE_ASOF));
    getIndexQuotesMock.mockResolvedValue(map);

    const result = await getReportGradeIndexQuotes("REPORT_POST_MARKET", POST_MARKET_NOW);
    const q = result.get("^NSEI")!;
    expect(q.tradeGrade).toBe(false);
    expect(q.canDriveSignals).toBe(false);
    expect(q.canDrivePaperTrades).toBe(false);
  });

  it("refuses a quote from before today's session (previous-day cache) as report-grade", async () => {
    const map = new Map<string, MarketQuote>();
    map.set("^NSEI", makeQuote({}, YESTERDAY_ASOF));
    getIndexQuotesMock.mockResolvedValue(map);

    const result = await getReportGradeIndexQuotes("REPORT_POST_MARKET", POST_MARKET_NOW);
    const q = result.get("^NSEI")!;
    expect(q.reportGrade).toBe(false);
    expect(q.canDriveReports).toBe(false);
    expect(q.ltp).toBeNull();
    expect(q.source).toBe("UNAVAILABLE");
    expect(q.reason).toBe("REPORT_INDEX_QUOTES_STALE");
  });

  it("does not fake a live quote on a weekend/market-closed day with no fresh data", async () => {
    const map = new Map<string, MarketQuote>();
    map.set("^NSEI", makeQuote({}, YESTERDAY_ASOF)); // last known data predates today
    getIndexQuotesMock.mockResolvedValue(map);

    const result = await getReportGradeIndexQuotes("DISPLAY_ONLY", SATURDAY_NOW);
    const q = result.get("^NSEI")!;
    expect(q.marketSession).toBe("closed");
    expect(q.reportGrade).toBe(false);
    expect(q.canDriveReports).toBe(false);
    expect(q.source).toBe("UNAVAILABLE");
  });

  it("returns UNAVAILABLE with a clear reason when the upstream provider has no data at all", async () => {
    getIndexQuotesMock.mockResolvedValue(null);

    const result = await getReportGradeIndexQuotes("REPORT_POST_MARKET", POST_MARKET_NOW);
    for (const { key } of REPORT_INDEX_KEYS) {
      const q = result.get(key)!;
      expect(q.reportGrade).toBe(false);
      expect(q.canDriveReports).toBe(false);
      expect(q.reason).toBe("INDEX_QUOTES_UNAVAILABLE");
    }
  });

  it("returns UNAVAILABLE for a symbol missing from the upstream map", async () => {
    const map = new Map<string, MarketQuote>();
    map.set("^NSEI", makeQuote({}, MARKET_CLOSE_ASOF));
    // ^NSEBANK / ^BSESN intentionally absent.
    getIndexQuotesMock.mockResolvedValue(map);

    const result = await getReportGradeIndexQuotes("REPORT_POST_MARKET", POST_MARKET_NOW);
    expect(result.get("^NSEI")!.canDriveReports).toBe(true);
    expect(result.get("^NSEBANK")!.canDriveReports).toBe(false);
    expect(result.get("^NSEBANK")!.reason).toBe("INDEX_QUOTES_UNAVAILABLE");
  });

  it("fails open (unavailable, never throws) when the upstream provider rejects", async () => {
    getIndexQuotesMock.mockRejectedValue(new Error("kite session expired"));

    const result = await getReportGradeIndexQuotes("REPORT_POST_MARKET", POST_MARKET_NOW);
    for (const { key } of REPORT_INDEX_KEYS) {
      expect(result.get(key)!.canDriveReports).toBe(false);
    }
  });

  it("accepts a fresh intraday quote during market-open hours as report-grade (not trade-grade)", async () => {
    const openNow = Date.parse("2026-07-07T05:00:00.000Z"); // 10:30 IST
    const asOf = new Date(Date.parse("2026-07-07T04:58:00.000Z")).toISOString(); // 10:28 IST, 2 min old
    const map = new Map<string, MarketQuote>();
    map.set("^NSEI", makeQuote({}, asOf));
    getIndexQuotesMock.mockResolvedValue(map);

    const result = await getReportGradeIndexQuotes("DISPLAY_ONLY", openNow);
    const q = result.get("^NSEI")!;
    expect(q.marketSession).toBe("open");
    expect(q.reportGrade).toBe(true);
    expect(q.tradeGrade).toBe(false);
  });
});
