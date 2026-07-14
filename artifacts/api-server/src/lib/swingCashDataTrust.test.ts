/**
 * Unit tests for swingCashDataTrust.ts (Part B) — pure module.
 */

import { describe, it, expect } from "vitest";
import { evaluateSwingCashDataTrust } from "./swingCashDataTrust";
import { DEFAULT_SWING_CASH_CONFIG } from "./swingCashRiskGuards";
import type { SwingCashDataInput } from "./swingCashTypes";

const CFG = DEFAULT_SWING_CASH_CONFIG.dataTrust;
const NOW = Date.UTC(2026, 5, 29, 5, 0, 0);
const OHLC = { open: 100, high: 105, low: 99, close: 104 };

function make(overrides: Partial<SwingCashDataInput> = {}): SwingCashDataInput {
  return {
    symbol: "ACME",
    dataSource: "kite",
    ltp: 104,
    ohlc: OHLC,
    dailyCandleAsOfMs: NOW - 60 * 60 * 1000,
    ltpAsOfMs: NOW - 60 * 1000,
    benchmarkAvailable: true,
    sectorAvailable: true,
    nowMs: NOW,
    ...overrides,
  };
}

describe("evaluateSwingCashDataTrust", () => {
  it("classifies fresh complete Kite data as trade-grade", () => {
    const r = evaluateSwingCashDataTrust(make(), CFG);
    expect(r.classification).toBe("TRADE_GRADE_KITE");
    expect(r.trustedForTrade).toBe(true);
    expect(r.reviewRequired).toBe(false);
    expect(r.stale).toBe(false);
  });

  it("rejects Yahoo as information-only (never trade-grade)", () => {
    const r = evaluateSwingCashDataTrust(make({ dataSource: "yahoo" }), CFG);
    expect(r.classification).toBe("INFO_ONLY_YAHOO");
    expect(r.trustedForTrade).toBe(false);
  });

  it("marks stale Kite daily candle as STALE and not tradeable", () => {
    const r = evaluateSwingCashDataTrust(
      make({ dailyCandleAsOfMs: NOW - 40 * 60 * 60 * 1000 }),
      CFG,
    );
    expect(r.classification).toBe("STALE");
    expect(r.trustedForTrade).toBe(false);
    expect(r.stale).toBe(true);
  });

  it("marks stale LTP as STALE", () => {
    const r = evaluateSwingCashDataTrust(make({ ltpAsOfMs: NOW - 10 * 60 * 1000 }), CFG);
    expect(r.classification).toBe("STALE");
    expect(r.metrics.ltpStale).toBe(true);
  });

  it("returns UNAVAILABLE when core price data is missing", () => {
    const r = evaluateSwingCashDataTrust(make({ ltp: null }), CFG);
    expect(r.classification).toBe("UNAVAILABLE");
    expect(r.trustedForTrade).toBe(false);
    expect(r.missingFields).toContain("ltp");
  });

  it("returns UNTRUSTED for an unknown source", () => {
    const r = evaluateSwingCashDataTrust(make({ dataSource: "indstocks" }), CFG);
    expect(r.classification).toBe("UNTRUSTED");
    expect(r.trustedForTrade).toBe(false);
  });

  it("treats a 'licensed' source as UNTRUSTED under the Kite-only default", () => {
    const r = evaluateSwingCashDataTrust(make({ dataSource: "licensed" }), CFG);
    expect(r.classification).toBe("UNTRUSTED");
    expect(r.trustedForTrade).toBe(false);
  });

  it("never promotes a stamp-less LTP to trade-grade (missing ltpAsOf is core)", () => {
    const r = evaluateSwingCashDataTrust(make({ ltpAsOfMs: null }), CFG);
    expect(r.classification).toBe("UNAVAILABLE");
    expect(r.trustedForTrade).toBe(false);
    expect(r.missingFields).toContain("ltpAsOf");
  });

  it("flags review when benchmark/sector unavailable but data fresh", () => {
    const r = evaluateSwingCashDataTrust(make({ benchmarkAvailable: false }), CFG);
    expect(r.trustedForTrade).toBe(true);
    expect(r.reviewRequired).toBe(true);
    expect(r.missingFields).toContain("benchmark");
  });

  it("treats a non-finite (NaN) candle timestamp as UNAVAILABLE, not fresh", () => {
    const r = evaluateSwingCashDataTrust(make({ dailyCandleAsOfMs: NaN }), CFG);
    expect(r.classification).toBe("UNAVAILABLE");
    expect(r.trustedForTrade).toBe(false);
    expect(r.missingFields).toContain("dailyCandleAsOf");
  });

  it("treats a non-finite (NaN) ltp timestamp as UNAVAILABLE, not fresh", () => {
    const r = evaluateSwingCashDataTrust(make({ ltpAsOfMs: NaN }), CFG);
    expect(r.classification).toBe("UNAVAILABLE");
    expect(r.trustedForTrade).toBe(false);
    expect(r.missingFields).toContain("ltpAsOf");
  });

  it("requires review when benchmark/sector availability is OMITTED (fail-closed)", () => {
    const r = evaluateSwingCashDataTrust(
      make({ benchmarkAvailable: undefined, sectorAvailable: undefined }),
      CFG,
    );
    expect(r.trustedForTrade).toBe(true);
    expect(r.reviewRequired).toBe(true);
    expect(r.missingFields).toContain("benchmark");
    expect(r.missingFields).toContain("sector");
  });

  it("treats a non-finite (NaN) clock as UNAVAILABLE — freshness can't be computed", () => {
    const r = evaluateSwingCashDataTrust(make({ nowMs: NaN }), CFG);
    expect(r.classification).toBe("UNAVAILABLE");
    expect(r.trustedForTrade).toBe(false);
    expect(r.missingFields).toContain("nowMs");
  });
});
