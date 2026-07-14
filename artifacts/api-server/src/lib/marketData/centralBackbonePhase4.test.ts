import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks for kiteProvider
const mockKiteGetEquityCandlesByToken = vi.fn();
vi.mock("./kiteProvider", () => ({
  getEquityCandlesByToken: (...args: any[]) => mockKiteGetEquityCandlesByToken(...args),
  buildMeta: (opts: any) => ({
    source: "kite",
    trustTier: "authoritative",
    asOf: opts.asOfMs ? new Date(opts.asOfMs).toISOString() : null,
    fetchedAt: new Date().toISOString(),
    freshnessSec: 1,
    isStale: false,
    delayed: false,
    notForSignals: opts.notForSignals ?? false,
    notForTradeDecisions: false,
    validationStatus: "validated",
    warnings: [],
  }),
}));

// Mocks for instrumentResolver
const mockResolveInstrument = vi.fn();
vi.mock("./instrumentResolver", () => ({
  resolveInstrument: (...args: any[]) => mockResolveInstrument(...args),
}));

import { getEquityCandlesByToken } from "./router";
import { getChartCandles } from "../chartDatafeed";

describe("centralBackbonePhase4 - getEquityCandlesByToken & chartDatafeed routing", () => {
  beforeEach(() => {
    mockKiteGetEquityCandlesByToken.mockReset();
    mockResolveInstrument.mockReset();
  });

  it("getEquityCandlesByToken returns standardized CandleSeries metadata", async () => {
    const mockCandles = [
      { t: "2026-06-18T00:00:00.000Z", open: 100, high: 110, low: 90, close: 105, volume: 1000 }
    ];
    mockKiteGetEquityCandlesByToken.mockResolvedValue({
      symbol: "TESTLABEL",
      interval: "day",
      candles: mockCandles,
      meta: {
        source: "kite",
        trustTier: "authoritative",
        asOf: "2026-06-18T00:00:00.000Z",
        fetchedAt: new Date().toISOString(),
        freshnessSec: 1,
        isStale: false,
        delayed: false,
        notForSignals: false,
        notForTradeDecisions: false,
        validationStatus: "validated",
        warnings: [],
      }
    });

    const res = await getEquityCandlesByToken(12345, "TESTLABEL", "day", 10);
    expect(res.ok).toBe(true);
    expect(res.data).not.toBeNull();
    expect(res.data!.symbol).toBe("TESTLABEL");
    expect(res.data!.candles).toEqual(mockCandles);
    expect(res.meta.source).toBe("kite");
    expect(res.meta.trustTier).toBe("authoritative");
  });

  it("missing token returns TOKEN_NOT_FOUND in chartDatafeed", async () => {
    mockResolveInstrument.mockReturnValue({
      resolved: false,
      instrument: null,
      reason: "Instrument not found in master",
      attempts: [],
    });

    const res = await getChartCandles("MISSING_SYM", "equity", "1D");
    expect(res.source).toBe("none");
    expect(res.candles).toEqual([]);
    expect(res.message).toBe("TOKEN NOT FOUND");
    expect(res.errorType).toBe("TOKEN_NOT_FOUND");
    expect(res.warnings).toContain("Instrument token not found in Kite master.");
  });

  it("token with no candles returns CANDLES_UNAVAILABLE in chartDatafeed", async () => {
    mockResolveInstrument.mockReturnValue({
      resolved: true,
      instrument: {
        canonical_symbol: "RESOLVED_SYM",
        display_name: "Resolved Symbol",
        exchange: "NSE",
        instrument_type: "EQ",
        instrument_token: 99999,
        bse_code: null,
      },
      reason: null,
      attempts: [],
    });

    mockKiteGetEquityCandlesByToken.mockResolvedValue(null);

    const res = await getChartCandles("RESOLVED_SYM", "equity", "1D");
    expect(res.source).toBe("none");
    expect(res.candles).toEqual([]);
    expect(res.message).toBe("CANDLES UNAVAILABLE");
    expect(res.errorType).toBe("CANDLES_UNAVAILABLE");
    expect(res.warnings).toContain("No trusted candle source available. Kite session required for Indian instruments.");
  });
});
