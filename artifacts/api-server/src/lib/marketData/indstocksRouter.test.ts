import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { MarketQuote, DataMeta } from "./types";

// Force authoritative Kite to be unavailable so we can exercise the failover path
// deterministically (no live session, no network).
const kiteLive = vi.fn<() => unknown>(() => null);
const kiteBatch = vi.fn<() => Promise<unknown>>(async () => null);
vi.mock("./kiteProvider", () => ({
  getEquityLiveQuote: (...a: unknown[]) => kiteLive(...(a as [])),
  getEquityQuotes: (...a: unknown[]) => kiteBatch(...(a as [])),
  kiteHealth: () => ({ credsConfigured: false, liveQuotes: 0, subscribed: 0 }),
  kiteSessionActive: () => false,
}));

// INDstocks provider — enablement reads env (fail-closed), getFullQuotes is a spy.
const getFullQuotes = vi.fn<(m: Map<string, string>) => Promise<Map<string, MarketQuote> | null>>(
  async () => null,
);
// Health probe + cached-health spies for the diagnostics path. The probe mutates
// the cached state so `indstocksHealth()` reflects it, mirroring the real module.
let indstocksHealthState: Record<string, unknown> = {
  enabled: false,
  reachable: false,
  reason: "not probed",
  lastProbeAt: null,
  lastError: null,
};
const probeIndstocksHealth = vi.fn(async () => {
  indstocksHealthState = {
    enabled: true,
    reachable: true,
    reason: "INDstocks reachable and authenticated.",
    lastProbeAt: new Date().toISOString(),
    lastError: null,
  };
  return indstocksHealthState;
});
const indstocksHealth = vi.fn(() => indstocksHealthState);
vi.mock("./indstocksProvider", () => ({
  isIndstocksEnabled: () => {
    const raw = (process.env.INDSTOCKS_ENABLED ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  },
  getFullQuotes: (...a: unknown[]) => getFullQuotes(...(a as [Map<string, string>])),
  probeIndstocksHealth: (...a: unknown[]) => probeIndstocksHealth(...(a as [])),
  indstocksHealth: () => indstocksHealth(),
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
  getMapSyncStats: () => ({ lastSyncAt: null, rows: 0, verified: 0, conflicts: 0, expired: 0 }),
}));

import { getEquityQuoteResolved, validateAgainstIndstocks } from "./router";
import { buildSymbolDiagnostic, buildDataDiagnostics } from "./diagnostics";
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
  probeIndstocksHealth.mockClear();
  indstocksHealth.mockClear();
  indstocksHealthState = {
    enabled: false,
    reachable: false,
    reason: "not probed",
    lastProbeAt: null,
    lastError: null,
  };
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

describe("buildSymbolDiagnostic failover visibility (owner diagnostics)", () => {
  it("surfaces source=indstocks + failover=true (un-tradeable) when Kite is down and INDstocks is VERIFIED+complete", async () => {
    process.env.INDSTOCKS_ENABLED = "1";
    // Kite unavailable (kiteLive/kiteBatch null by default) → failover path.
    getFullQuotes.mockResolvedValue(
      new Map([["HDFCBANK", indQuote({ lastPrice: 1500, previousClose: 1495 })]]),
    );
    const d = await buildSymbolDiagnostic("HDFCBANK");
    expect(d.source).toBe("indstocks");
    expect(d.failover).toBe(true);
    // A failover quote is shown but NEVER branded tradeable.
    expect(d.tradeable).toBe(false);
    expect(d.quote?.tradeable).toBe(false);
    expect(d.quote?.lastPrice).toBe(1500);
    expect(d.indstocks?.quote?.lastPrice).toBe(1500);
  });

  it("records exactly ONE validation per Kite-success symbol diagnostic (no double-count)", async () => {
    process.env.INDSTOCKS_ENABLED = "1";
    __resetValidationStatsForTests();
    // Kite authoritative succeeds (via batch); INDstocks supplies a complete
    // secondary quote so the cross-validation actually scores a verdict.
    // kiteProvider.getEquityQuotes returns a raw Map<symbol, quote>; the router
    // brands it into a TrustedQuote.
    kiteBatch.mockResolvedValue(
      new Map([
        ["HDFCBANK", { symbol: "HDFCBANK", lastPrice: 1501, previousClose: 1495, meta: indMeta({ source: "kite", trustTier: "authoritative", notForSignals: false }) }],
      ]),
    );
    getFullQuotes.mockResolvedValue(
      new Map([["HDFCBANK", indQuote({ lastPrice: 1500, previousClose: 1495 })]]),
    );
    const d = await buildSymbolDiagnostic("HDFCBANK");
    expect(d.source).toBe("kite");
    expect(d.failover).toBe(false);
    expect(d.tradeable).toBe(true);
    // getEquityQuoteResolved records once; the diagnostic display call is non-recording.
    expect(getValidationStats().validations).toBe(1);
    expect(d.indstocks?.validation).not.toBeNull();
  });

  it("does NOT fail over (source=kite stays) when INDstocks is disabled, even with Kite down", async () => {
    delete process.env.INDSTOCKS_ENABLED;
    getFullQuotes.mockResolvedValue(
      new Map([["HDFCBANK", indQuote({ lastPrice: 1500, previousClose: 1495 })]]),
    );
    const d = await buildSymbolDiagnostic("HDFCBANK");
    expect(d.source).toBe("kite");
    expect(d.failover).toBe(false);
    expect(d.tradeable).toBe(false);
    expect(d.quote).toBeNull();
    expect(getFullQuotes).not.toHaveBeenCalled();
  });
});

describe("buildDataDiagnostics health probe (owner diagnostics)", () => {
  it("actively probes INDstocks connectivity when enabled and reflects it in health", async () => {
    process.env.INDSTOCKS_ENABLED = "1";
    const d = await buildDataDiagnostics();
    expect(probeIndstocksHealth).toHaveBeenCalledTimes(1);
    expect(d.indstocks.health.reachable).toBe(true);
  });

  it("never probes the network when INDstocks is disabled", async () => {
    delete process.env.INDSTOCKS_ENABLED;
    const d = await buildDataDiagnostics();
    expect(probeIndstocksHealth).not.toHaveBeenCalled();
    expect(d.indstocks.health.reachable).toBe(false);
  });
});
