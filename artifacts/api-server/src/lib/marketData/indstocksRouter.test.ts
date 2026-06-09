import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { MarketQuote, DataMeta } from "./types";

// Force authoritative Kite to be unavailable so we can exercise the failover path
// deterministically (no live session, no network).
const kiteLive = vi.fn<() => unknown>(() => null);
const kiteBatch = vi.fn<() => Promise<unknown>>(async () => null);
vi.mock("./kiteProvider", () => ({
  getEquityLiveQuote: (...a: unknown[]) => kiteLive(...(a as [])),
  getEquityQuotes: (...a: unknown[]) => kiteBatch(...(a as [])),
}));

// INDstocks provider — enablement reads env (fail-closed), getFullQuotes is a spy.
const getFullQuotes = vi.fn<(m: Map<string, string>) => Promise<Map<string, MarketQuote> | null>>(
  async () => null,
);
vi.mock("./indstocksProvider", () => ({
  isIndstocksEnabled: () => {
    const raw = (process.env.INDSTOCKS_ENABLED ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  },
  getFullQuotes: (...a: unknown[]) => getFullQuotes(...(a as [Map<string, string>])),
}));

// Instrument-map store — VERIFIED mapping by default; tests override per-case.
const getVerifiedIndstocksScrip = vi.fn(async () => ({
  ok: true as boolean,
  scripCode: "NSE_1333" as string | null,
  securityId: "1333" as string | null,
  status: "VERIFIED" as string,
  reason: null as string | null,
}));
vi.mock("./instrumentMapStore", () => ({
  getVerifiedIndstocksScrip: (...a: unknown[]) => getVerifiedIndstocksScrip(...(a as [])),
}));

import { getEquityQuoteResolved, validateAgainstIndstocks } from "./router";
import { __resetValidationStatsForTests, getValidationStats } from "./validationStats";

function indMeta(over: Partial<DataMeta> = {}): DataMeta {
  return {
    source: "indstocks",
    trustTier: "secondary_validation",
    asOf: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    freshnessSec: 1,
    isStale: false,
    delayed: false,
    notForSignals: true,
    validationStatus: "unvalidated",
    warnings: [],
    ...over,
  };
}

function indQuote(over: Partial<MarketQuote> = {}): MarketQuote {
  return {
    symbol: "HDFCBANK",
    lastPrice: 1500,
    previousClose: 1495,
    meta: indMeta(),
    ...over,
  };
}

const saved = { ...process.env };
beforeEach(() => {
  process.env = { ...saved };
  kiteLive.mockReturnValue(null);
  kiteBatch.mockResolvedValue(null);
  getFullQuotes.mockReset();
  getVerifiedIndstocksScrip.mockReset();
  getVerifiedIndstocksScrip.mockResolvedValue({
    ok: true,
    scripCode: "NSE_1333",
    securityId: "1333",
    status: "VERIFIED",
    reason: null,
  });
  __resetValidationStatsForTests();
});
afterEach(() => {
  process.env = { ...saved };
  vi.clearAllMocks();
});

describe("getEquityQuoteResolved failover visibility", () => {
  it("does NOT touch INDstocks at all when the flag is disabled, even if Kite is down", async () => {
    delete process.env.INDSTOCKS_ENABLED;
    const r = await getEquityQuoteResolved("HDFCBANK");
    expect(r.ok).toBe(false);
    expect(r.source).toBe("kite");
    expect(r.failover).toBe(false);
    expect(getVerifiedIndstocksScrip).not.toHaveBeenCalled();
    expect(getFullQuotes).not.toHaveBeenCalled();
  });

  it("fails over to INDstocks (loudly, unbranded) when enabled + VERIFIED + complete", async () => {
    process.env.INDSTOCKS_ENABLED = "1";
    getFullQuotes.mockResolvedValue(new Map([["HDFCBANK", indQuote()]]));

    const r = await getEquityQuoteResolved("HDFCBANK");
    expect(r.ok).toBe(true);
    expect(r.source).toBe("indstocks");
    expect(r.failover).toBe(true);
    // Failover must be loud and must never claim to be tradeable/authoritative.
    expect(r.meta.warnings.some((w) => /FAILOVER/i.test(w))).toBe(true);
    expect(r.meta.trustTier).toBe("secondary_validation");
    expect(getValidationStats().failovers).toBe(1);
  });

  it("refuses failover when the mapping is not VERIFIED (no scrip)", async () => {
    process.env.INDSTOCKS_ENABLED = "1";
    getVerifiedIndstocksScrip.mockResolvedValue({
      ok: false,
      scripCode: null,
      securityId: null,
      status: "UNVERIFIED",
      reason: "No VERIFIED mapping.",
    });
    const r = await getEquityQuoteResolved("HDFCBANK");
    expect(r.ok).toBe(false);
    expect(r.failover).toBe(false);
    expect(getFullQuotes).not.toHaveBeenCalled();
  });

  it("refuses failover when the INDstocks quote is incomplete (ltp<=0)", async () => {
    process.env.INDSTOCKS_ENABLED = "1";
    getFullQuotes.mockResolvedValue(new Map([["HDFCBANK", indQuote({ lastPrice: 0 })]]));
    const r = await getEquityQuoteResolved("HDFCBANK");
    expect(r.ok).toBe(false);
    expect(r.failover).toBe(false);
  });

  it("refuses failover on a positive LTP but MISSING previousClose (incomplete)", async () => {
    process.env.INDSTOCKS_ENABLED = "1";
    getFullQuotes.mockResolvedValue(
      new Map([["HDFCBANK", indQuote({ lastPrice: 1500, previousClose: undefined })]]),
    );
    const r = await getEquityQuoteResolved("HDFCBANK");
    expect(r.ok).toBe(false);
    expect(r.failover).toBe(false);
  });
});

describe("validateAgainstIndstocks gating", () => {
  it("no-ops honestly (and never calls INDstocks) when disabled", async () => {
    delete process.env.INDSTOCKS_ENABLED;
    const cv = await validateAgainstIndstocks("HDFCBANK", {
      symbol: "HDFCBANK",
      lastPrice: 1500,
      previousClose: 1495,
      meta: indMeta(),
    });
    expect(cv.mappingOk).toBe(false);
    expect(cv.reason).toMatch(/disabled/i);
    expect(getVerifiedIndstocksScrip).not.toHaveBeenCalled();
    expect(getFullQuotes).not.toHaveBeenCalled();
  });

  it("records a verdict when enabled with a VERIFIED mapping + secondary quote", async () => {
    process.env.INDSTOCKS_ENABLED = "1";
    getFullQuotes.mockResolvedValue(new Map([["HDFCBANK", indQuote({ lastPrice: 1500.2 })]]));
    const cv = await validateAgainstIndstocks("HDFCBANK", {
      symbol: "HDFCBANK",
      lastPrice: 1500,
      previousClose: 1495,
      meta: indMeta(),
    });
    expect(cv.mappingOk).toBe(true);
    expect(cv.result?.verdict).toBe("MATCHED");
    expect(getValidationStats().validations).toBe(1);
  });

  it("does NOT record a verdict from an incomplete secondary quote", async () => {
    process.env.INDSTOCKS_ENABLED = "1";
    getFullQuotes.mockResolvedValue(
      new Map([["HDFCBANK", indQuote({ lastPrice: 1500, previousClose: undefined })]]),
    );
    const cv = await validateAgainstIndstocks("HDFCBANK", {
      symbol: "HDFCBANK",
      lastPrice: 1500,
      previousClose: 1495,
      meta: indMeta(),
    });
    expect(cv.mappingOk).toBe(true);
    expect(cv.result).toBeNull();
    expect(cv.reason).toMatch(/incomplete/i);
    expect(getValidationStats().validations).toBe(0);
  });
});
