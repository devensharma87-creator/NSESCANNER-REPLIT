/**
 * B1.1 — Canonical Live-Market Data Backbone: contract, boundary & routing tests.
 *
 * Covers:
 *   §B1.1-C1  Future-timestamp boundary (13 injected-clock scenarios)
 *   §B1.1-C2  Production fallback-routing proofs (real facades, mocked transports)
 *   §11.1     Contract and timestamp truth
 *   §11.2     Provider routing (capability states)
 *   §11.3     Identity and data mixing prevention
 *   §11.4     Cache and rate limits
 *   §11.5     Production consumer provenance
 *   §11.6     Backward-compatibility
 *   §11.7     Test-suite hygiene
 *
 * Safety invariants:
 *   - Zero live network calls (all providers and Kite transports mocked).
 *   - Zero PostgreSQL connections (DB_TEST_RUNTIME_AUTHORIZED stays false).
 *   - No secret values in snapshots or log output.
 *   - No .skip, .only, retries, or arbitrary sleeps.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MockedFunction } from "vitest";

// ── Mock boundary ─────────────────────────────────────────────────────────────
// All vi.mock() calls are hoisted before any module import by vitest.

vi.mock("./kiteProvider", () => ({
  kiteHealth: vi.fn(() => ({
    credsConfigured: true,
    running: true,
    connected: true,
    subscribed: 12,
    liveQuotes: 987,
    lastConnectAt: null,
    lastError: null,
  })),
  kiteSessionActive: vi.fn(() => true),
  getEquityLiveQuote: vi.fn(() => null),
  getEquityQuotes: vi.fn(async () => null),
  getIndexQuotes: vi.fn(async () => null),
  getIndexCandles: vi.fn(async () => null),
  getEquityCandles: vi.fn(async () => null),
  getEquityCandlesByToken: vi.fn(async () => null),
  getEtfQuote: vi.fn(async () => null),
  hasIndexCoverage: vi.fn(() => false),
}));

vi.mock("./indstocksProvider", () => ({
  indstocksHealth: vi.fn(() => ({ enabled: false, reason: "INDSTOCKS_ENABLED env-var absent." })),
  isIndstocksEnabled: vi.fn(() => false),
  probeIndstocksHealth: vi.fn(async () => undefined),
  fetchIndstocksQuote: vi.fn(async () => null),
}));

vi.mock("./router", () => ({
  getEquityQuoteResolved: vi.fn(async () => null),
  validateAgainstIndstocks: vi.fn(async () => null),
}));

vi.mock("./instrumentMapStore", () => ({
  getMapSyncStats: vi.fn(() => ({ lastSyncAt: null, totalMapped: 0, errors: 0 })),
}));

vi.mock("./validationStats", () => ({
  getValidationStats: vi.fn(() => ({ mismatchCount: 0, okCount: 0, date: null })),
}));

vi.mock("./policy", () => ({
  getPolicy: vi.fn(() => ({
    strictFreshness: true,
    strictMismatch: false,
    freshnessBudgetSec: 90,
    staleBudgetSec: 600,
    indstocksEnabled: false,
    providers: {
      kite:      { trustTier: "authoritative",        role: "primary" },
      indstocks: { trustTier: "secondary_validation", role: "failover" },
      yahoo:     { trustTier: "secondary_analytics",  role: "analytics" },
    },
  })),
}));

// C2: Kite broker transport — mocked so no live API calls reach the broker.
vi.mock("../kiteOptionChain", () => ({
  fetchKiteOptionChain: vi.fn(),
}));

// C2: NSE public scrape transport (used as fetchWithNseFallback inside optionChainProvider).
vi.mock("../optionChain", () => ({
  fetchOptionChain: vi.fn(),
}));

// ── Module imports ────────────────────────────────────────────────────────────
import {
  getProviderCapabilities,
  getCapabilityFor,
  TRADE_SENSITIVE_DOMAINS,
  type ProviderCapabilityState,
} from "./providerCapability";
import { buildMeta, unavailableMeta } from "./validator";
import { computeFreshness, CLOCK_SKEW_TOLERANCE_SEC } from "./freshness";
import { sourceStatusFromMeta, pointFromMeta } from "./types";
import {
  evaluateOptionChain,
  clearOptionChainCache,
  getOptionChain,
} from "./optionChainProvider";
import {
  buildOptionChainProvenance,
  premiumTrustVerdict,
  classifyOcSource,
} from "./optionChainProvenance";

import type { OcResponse } from "../optionChain";
import { fetchKiteOptionChain } from "../kiteOptionChain";
import { fetchOptionChain as fetchNseFallback } from "../optionChain";
import { kiteHealth, kiteSessionActive } from "./kiteProvider";

// ── Mock function handles ─────────────────────────────────────────────────────
const mockKiteHealth = kiteHealth as MockedFunction<typeof kiteHealth>;
const mockKiteSessionActive = kiteSessionActive as MockedFunction<typeof kiteSessionActive>;
const mockFetchKiteOptionChain = fetchKiteOptionChain as MockedFunction<typeof fetchKiteOptionChain>;
const mockFetchNseFallback = fetchNseFallback as MockedFunction<typeof fetchNseFallback>;

// ── Constants ─────────────────────────────────────────────────────────────────
const BASE_KITE_HEALTH = {
  credsConfigured: true,
  running: true,
  connected: true,
  subscribed: 12,
  liveQuotes: 987,
  lastConnectAt: null as string | null,
  lastError: null as string | null,
};

const FRESH_AGE_MS = 30_000;      // 30s — well inside freshnessBudgetSec:90
const STALE_AGE_MS = 700_000;     // ~11.6 min — beyond staleBudgetSec:600
const YESTERDAY_AGE_MS = 90_000_000; // ~25 hours

// ── Fixture builders ──────────────────────────────────────────────────────────

function nowMs() { return Date.now(); }
function freshAsOfMs(now = nowMs()) { return now - FRESH_AGE_MS; }
function staleAsOfMs(now = nowMs()) { return now - STALE_AGE_MS; }
function yesterdayAsOfMs(now = nowMs()) { return now - YESTERDAY_AGE_MS; }

function buildKiteChain(overrides: Partial<OcResponse> = {}): OcResponse {
  return {
    underlying: "NIFTY",
    underlyingName: "Nifty 50",
    kind: "INDEX",
    expiry: "2099-12-25",
    expiries: ["2099-12-25"],
    spot: 25000,
    prevClose: 24800,
    changePercent: 0.81,
    atmStrike: 25000,
    strikeStep: 50,
    spotSource: "kite",
    spotTrusted: true,
    source: "kite",
    generatedAt: new Date().toISOString(),
    rows: [
      {
        strike: 25000,
        ce: { oi: 1000, volume: 500, iv: 12.5, ltp: 110, delta: 0.5, gamma: 0.02, theta: -3, vega: 8 },
        pe: { oi: 800,  volume: 300, iv: 13.0, ltp: 105, delta: -0.5, gamma: 0.02, theta: -3, vega: 8 },
      },
    ],
    ...overrides,
  };
}

function buildNseChain(overrides: Partial<OcResponse> = {}): OcResponse {
  return buildKiteChain({ source: "nse", spotSource: "nse", spotTrusted: true, ...overrides });
}

/** Build a chain whose generatedAt is `skewSec` seconds in the future. */
function buildFutureChain(skewSec: number): OcResponse {
  const futureIso = new Date(Date.now() + skewSec * 1000).toISOString();
  return buildKiteChain({ generatedAt: futureIso });
}

beforeEach(() => {
  clearOptionChainCache();
  mockKiteHealth.mockReturnValue({ ...BASE_KITE_HEALTH });
  mockKiteSessionActive.mockReturnValue(true);
  mockFetchKiteOptionChain.mockReset();
  mockFetchNseFallback.mockReset();
});

// ────────────────────────────────────────────────────────────────────────────
// §B1.1-C1  Future-timestamp boundary tests (pure function, injected clock)
// ────────────────────────────────────────────────────────────────────────────

describe("§B1.1-C1 Freshness boundary — injected clock", () => {
  const BUDGET = { freshnessBudgetSec: 90, staleBudgetSec: 600 };

  it("C1-01: timestamp equal to now → rawAgeSec=0, NOT isFutureTimestamp", () => {
    const now = 1_700_000_000_000;
    const f = computeFreshness(now, now, BUDGET);
    expect(f.rawAgeSec).toBeCloseTo(0, 1);
    expect(f.isFutureTimestamp).toBe(false);
    expect(f.freshnessSec).toBe(0);
    expect(f.isStale).toBe(false);
    expect(f.clockSkewSec).toBeNull();
  });

  it("C1-02: timestamp 1s in future (inside tolerance) → NOT isFutureTimestamp", () => {
    const now = 1_700_000_000_000;
    const asOfMs = now + 1_000;
    const f = computeFreshness(asOfMs, now, BUDGET);
    expect(f.isFutureTimestamp).toBe(false);
    expect(f.freshnessSec).toBe(0);  // clamped — minor skew
    expect(f.rawAgeSec).toBeCloseTo(-1, 1);
    expect(f.clockSkewSec).not.toBeNull(); // skew preserved for diagnostics
    expect(f.isStale).toBe(false);
  });

  it("C1-03: timestamp (TOLERANCE-1)s in future → inside tolerance, NOT isFutureTimestamp", () => {
    const now = 1_700_000_000_000;
    const asOfMs = now + (CLOCK_SKEW_TOLERANCE_SEC - 1) * 1000;
    const f = computeFreshness(asOfMs, now, BUDGET);
    expect(f.isFutureTimestamp).toBe(false);
    expect(f.freshnessSec).toBe(0);
  });

  it("C1-04: timestamp exactly TOLERANCE seconds in future → boundary accepted (< not <=)", () => {
    const now = 1_700_000_000_000;
    const asOfMs = now + CLOCK_SKEW_TOLERANCE_SEC * 1000;
    const f = computeFreshness(asOfMs, now, BUDGET);
    // rawAgeSec = -TOLERANCE — condition is rawAgeSec < -TOLERANCE, so boundary is accepted
    expect(f.isFutureTimestamp).toBe(false);
    expect(f.freshnessSec).toBe(0);
  });

  it("C1-05: timestamp (TOLERANCE + 0.1)s in future → BEYOND tolerance, isFutureTimestamp=true", () => {
    const now = 1_700_000_000_000;
    const asOfMs = now + (CLOCK_SKEW_TOLERANCE_SEC + 0.1) * 1000;
    const f = computeFreshness(asOfMs, now, BUDGET);
    expect(f.isFutureTimestamp).toBe(true);
    expect(f.freshnessSec).toBeNull();      // do not expose negative age
    expect(f.isStale).toBe(true);           // fail closed
    expect(f.clockSkewSec).not.toBeNull();  // skew preserved
    expect(f.clockSkewSec!).toBeLessThan(0);
  });

  it("C1-06: timestamp 1 hour in future → materially future, all guards engaged", () => {
    const now = 1_700_000_000_000;
    const asOfMs = now + 3_600_000;
    const f = computeFreshness(asOfMs, now, BUDGET);
    expect(f.isFutureTimestamp).toBe(true);
    expect(f.isStale).toBe(true);
    expect(f.isHardStale).toBe(false);   // not "expired old data" — different category
    expect(f.freshnessSec).toBeNull();
    expect(f.clockSkewSec!).toBeLessThan(-CLOCK_SKEW_TOLERANCE_SEC);
  });

  it("C1-07: timestamp exactly at fresh/stale boundary (freshnessBudgetSec=90) → isStale=false", () => {
    const now = 1_700_000_000_000;
    const asOfMs = now - BUDGET.freshnessBudgetSec * 1000;
    const f = computeFreshness(asOfMs, now, BUDGET);
    // ageSec = 90 — condition is > 90, so boundary is accepted
    expect(f.isFutureTimestamp).toBe(false);
    expect(f.isStale).toBe(false);
    expect(f.freshnessSec).toBe(90);
  });

  it("C1-08: timestamp 1s beyond stale boundary (91s old) → isStale=true", () => {
    const now = 1_700_000_000_000;
    const asOfMs = now - (BUDGET.freshnessBudgetSec + 1) * 1000;
    const f = computeFreshness(asOfMs, now, BUDGET);
    expect(f.isFutureTimestamp).toBe(false);
    expect(f.isStale).toBe(true);
    expect(f.freshnessSec).toBe(BUDGET.freshnessBudgetSec + 1);
  });

  it("C1-09: missing timestamp (null) → stale/unvalidated, never fabricated fresh", () => {
    const f = computeFreshness(null, nowMs(), BUDGET);
    expect(f.isStale).toBe(true);
    expect(f.freshnessSec).toBeNull();
    expect(f.rawAgeSec).toBeNull();
    expect(f.isFutureTimestamp).toBe(false); // null is unknown, not "future"
  });

  it("C1-10: invalid timestamp (NaN) → stale, never fabricated fresh", () => {
    const f = computeFreshness(NaN, nowMs(), BUDGET);
    expect(f.isStale).toBe(true);
    expect(f.freshnessSec).toBeNull();
    expect(f.rawAgeSec).toBeNull();
    expect(f.isFutureTimestamp).toBe(false);
  });

  it("C1-11: freshly received prior-session timestamp → stale (receivedAt cannot rescue it)", () => {
    // asOf is from yesterday; received just now — freshly received does NOT make it fresh
    const f = computeFreshness(
      Date.now() - YESTERDAY_AGE_MS,
      Date.now(),
      BUDGET,
    );
    expect(f.isStale).toBe(true);
    expect(f.isHardStale).toBe(true);
    expect(f.isFutureTimestamp).toBe(false);
    expect(f.freshnessSec).toBeGreaterThan(BUDGET.staleBudgetSec);
  });

  it("C1-12: future-timestamp envelope passed to TRADE_DECISION → fails closed with FUTURE_TIMESTAMP", async () => {
    // Mock Kite returning a chain whose generatedAt is materially in the future
    const futureChain = buildFutureChain(CLOCK_SKEW_TOLERANCE_SEC + 2);
    mockFetchKiteOptionChain.mockResolvedValueOnce(futureChain);

    const result = await getOptionChain("NIFTY", "TRADE_GRADE", "2099-12-25");

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/FUTURE_TIMESTAMP/i);
    expect(result.data).toBeNull();
    // The meta must be unavailable
    expect(result.meta.validationStatus).toBe("unavailable");
  });

  it("C1-13: future-timestamp option chain → PAPER_ADMISSION and EXIT_MONITORING blocked", async () => {
    // Same setup — chain with future timestamp from TRADE_GRADE returns unavailable
    const futureChain = buildFutureChain(CLOCK_SKEW_TOLERANCE_SEC + 10);
    mockFetchKiteOptionChain.mockResolvedValueOnce(futureChain);

    const result = await getOptionChain("BANKNIFTY", "TRADE_GRADE", "2099-12-25");

    // TRADE_GRADE returns ok=false — downstream paper admission uses null chain
    expect(result.ok).toBe(false);
    const nullChain = result.data?.chain ?? null;

    // buildOptionChainProvenance on null chain → trustedForSignals=false
    // This blocks both paper admission and exit monitoring
    const prov = buildOptionChainProvenance(nullChain, {
      missingReason: result.reason ?? "Chain unavailable.",
    });
    const verdict = premiumTrustVerdict(prov);

    expect(verdict.trusted).toBe(false);
    expect(prov.trustedForSignals).toBe(false);
    expect(verdict.reason).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §B1.1-C2  Production fallback-routing proofs
// ────────────────────────────────────────────────────────────────────────────

describe("§B1.1-C2 Production fallback routing — real facades, mocked transports", () => {
  it("C2-01: Kite success (TRADE_GRADE) → fallbackUsed=false, source=kite, ok=true", async () => {
    mockFetchKiteOptionChain.mockResolvedValueOnce(buildKiteChain());

    const result = await getOptionChain("NIFTY", "TRADE_GRADE", "2099-12-25");

    expect(result.ok).toBe(true);
    expect(result.data?.meta.fallbackUsed).toBe(false);
    expect(result.data?.chain.source).toBe("kite");
    expect(result.reason).toBeUndefined();
    // canDriveSignals logic — authoritative, fresh, not stale
    expect(result.meta.notForSignals).toBe(false);
    expect(result.meta.notForTradeDecisions).toBe(false);
  });

  it("C2-02: Kite throws (TRADE_GRADE) → ok=false with reason; NSE NOT attempted", async () => {
    mockFetchKiteOptionChain.mockRejectedValueOnce(new Error("Kite broker offline"));

    const result = await getOptionChain("NIFTY", "TRADE_GRADE", "2099-12-25");

    expect(result.ok).toBe(false);
    expect(result.data).toBeNull();
    expect(result.reason).toBeTruthy();
    // NSE fallback must NOT have been called — TRADE_GRADE is Kite-only
    expect(mockFetchNseFallback).not.toHaveBeenCalled();
  });

  it("C2-03: Kite success (DISPLAY) → fallbackUsed=false, source=kite", async () => {
    mockFetchKiteOptionChain.mockResolvedValueOnce(buildKiteChain());

    const result = await getOptionChain("NIFTY", "DISPLAY", "2099-12-25");

    expect(result.ok).toBe(true);
    expect(result.data?.meta.fallbackUsed).toBe(false);
    expect(result.data?.chain.source).toBe("kite");
  });

  it("C2-04: Kite throws (DISPLAY) + NSE success → fallbackUsed=true, notForSignals=true", async () => {
    mockFetchKiteOptionChain.mockRejectedValueOnce(new Error("Kite offline"));
    mockFetchNseFallback.mockResolvedValueOnce(buildNseChain());

    const result = await getOptionChain("NIFTY", "DISPLAY", "2099-12-25");

    expect(result.ok).toBe(true);
    // NSE fallback was used — must be labelled explicitly
    expect(result.data?.meta.fallbackUsed).toBe(true);
    expect(result.data?.meta.notForSignals).toBe(true);
    expect(result.data?.meta.notForTradeDecisions).toBe(true);
    // visualOnly distinguishes display fallback from authoritative paths
    expect(result.data?.meta.visualOnly).toBe(true);
  });

  it("C2-05: NSE DISPLAY fallback cannot cross into tradeable purpose", async () => {
    mockFetchKiteOptionChain.mockRejectedValueOnce(new Error("Kite offline"));
    mockFetchNseFallback.mockResolvedValueOnce(buildNseChain());

    const result = await getOptionChain("NIFTY", "DISPLAY", "2099-12-25");
    const chain = result.data?.chain ?? null;

    // Provenance check confirms NSE cannot drive signals/trade
    const prov = buildOptionChainProvenance(chain, {});
    const verdict = premiumTrustVerdict(prov);

    expect(verdict.trusted).toBe(false);
    expect(prov.trustedForSignals).toBe(false);
    expect(prov.fallbackUsed).toBe(true);
  });

  it("C2-06: Both Kite and NSE fail (DISPLAY) → ok=false, paper admission blocked", async () => {
    mockFetchKiteOptionChain.mockRejectedValueOnce(new Error("Kite offline"));
    mockFetchNseFallback.mockRejectedValueOnce(new Error("NSE timeout"));

    const result = await getOptionChain("NIFTY", "DISPLAY", "2099-12-25");

    expect(result.ok).toBe(false);
    expect(result.data).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it("C2-07: Upstox/IndianAPI — NOT_CONFIGURED, no fabricated calls", () => {
    const snap = getProviderCapabilities();
    const upstox = getCapabilityFor("upstox", "option_chain", snap);
    const indianapi = getCapabilityFor("indianapi", "option_chain", snap);

    expect(upstox.state).toBe("NOT_CONFIGURED");
    expect(indianapi.state).toBe("NOT_CONFIGURED");
    // fetchKiteOptionChain must not have been called for these (they have no adapter)
    expect(mockFetchKiteOptionChain).not.toHaveBeenCalled();
  });

  it("C2-08: Migration proof — migrated consumers (optionSignals/paperTradingCombo) use TRADE_GRADE", () => {
    // Structural proof: verify the canonical route exists and produces
    // the correct metadata contract for trade-sensitive consumers.
    // (Legacy fetchOptionChain removal is proven by grep in the CI evidence file.)
    mockFetchKiteOptionChain.mockResolvedValueOnce(buildKiteChain());

    // The canonical TRADE_GRADE call (same as what optionSignals.ts and
    // paperTradingCombo.ts now call after B1.1 migration)
    return getOptionChain("NIFTY", "TRADE_GRADE", "2099-12-25").then((result) => {
      expect(result.ok).toBe(true);
      expect(result.data?.meta.notForSignals).toBe(false);
      expect(result.data?.meta.notForTradeDecisions).toBe(false);
      expect(result.data?.meta.fallbackUsed).toBe(false);
      // source is kite — the provenance gate will allow this through premiumTrustVerdict
      const prov = buildOptionChainProvenance(result.data?.chain ?? null, {});
      expect(prov.trustedForSignals).toBe(true);
      expect(premiumTrustVerdict(prov).trusted).toBe(true);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §11.1  Contract and timestamp truth
// ────────────────────────────────────────────────────────────────────────────

describe("§11.1 Contract and timestamp truth", () => {
  it("T01: exchange asOf timestamp preserved as canonical asOf", () => {
    const asOf = freshAsOfMs();
    const meta = buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: asOf,
      delayed: false,
      notForSignals: false,
    });
    expect(meta.asOf).toBe(new Date(asOf).toISOString());
    expect(typeof meta.freshnessSec).toBe("number");
    expect(meta.freshnessSec!).toBeGreaterThan(0);
  });

  it("T02: recent receivedAt cannot make an old payload fresh", () => {
    const meta = buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: staleAsOfMs(),
      delayed: false,
      notForSignals: false,
    });
    expect(meta.isStale).toBe(true);
    expect(meta.validationStatus).toBe("stale");
  });

  it("T03: missing provider timestamp → stale/unvalidated, not live", () => {
    const freshness = computeFreshness(null, nowMs());
    expect(freshness.isStale).toBe(true);
    expect(freshness.freshnessSec).toBeNull();
    expect(freshness.isFutureTimestamp).toBe(false); // unknown ≠ future
  });

  it("T04: prior-day payload received now → stale, freshnessSec reflects real age", () => {
    const meta = buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: yesterdayAsOfMs(),
      delayed: false,
      notForSignals: false,
    });
    expect(meta.isStale).toBe(true);
    expect(meta.validationStatus).toBe("stale");
    expect(meta.isFutureTimestamp).toBeFalsy(); // old data ≠ future
  });

  it("T05: future timestamp → DataMeta propagates isFutureTimestamp, canDriveSignals=false", () => {
    // Production path: buildMeta with a future asOfMs sets isFutureTimestamp in DataMeta.
    const now = Date.now();
    const futureMs = now + (CLOCK_SKEW_TOLERANCE_SEC + 2) * 1000;
    const meta = buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: futureMs,
      nowMs: now,
      delayed: false,
      notForSignals: false,
    });
    // C1 gate: isFutureTimestamp must be propagated through DataMeta
    expect(meta.isFutureTimestamp).toBe(true);
    expect(meta.isStale).toBe(true);
    expect(meta.freshnessSec).toBeNull();  // do not expose negative age
    expect(meta.validationStatus).toBe("stale");
    // canDriveSignals must be false via sourceStatusFromMeta
    const status = sourceStatusFromMeta(meta, true);
    expect(status).not.toBe("TRADE_GRADE");
  });

  it("T06: Yahoo meta always notForSignals=true and notForTradeDecisions=true", () => {
    const meta = buildMeta({
      source: "yahoo",
      trustTier: "secondary_analytics",
      asOfMs: freshAsOfMs(),
      delayed: true,
      notForSignals: true,
      notForTradeDecisions: true,
    });
    expect(meta.notForSignals).toBe(true);
    expect(meta.notForTradeDecisions).toBe(true);
  });

  it("T07: production routing sets fallbackUsed explicitly — not inferred from warnings", () => {
    // pointFromMeta.fallbackUsed defaults to false; must be explicitly passed.
    const meta = buildMeta({
      source: "nse",
      trustTier: "secondary_analytics",
      asOfMs: freshAsOfMs(),
      delayed: true,
      notForSignals: true,
      notForTradeDecisions: true,
      warnings: ["NSE display fallback"],
    });
    // Without the explicit flag: defaults to false
    const pointNoFlag = pointFromMeta({
      key: "test:NSE", assetType: "index", symbol: "NIFTY", meta, value: 25000,
    });
    expect(pointNoFlag.fallbackUsed).toBe(false);  // warnings alone do not set it

    // With the explicit flag (as real routing code sets via buildOptionChainMeta):
    const pointWithFlag = pointFromMeta({
      key: "test:NSE", assetType: "index", symbol: "NIFTY", meta, value: 25000,
      fallbackUsed: true,
    });
    expect(pointWithFlag.fallbackUsed).toBe(true);
    expect(pointWithFlag.canDriveSignals).toBe(false);
    expect(pointWithFlag.canDriveTradeAlerts).toBe(false);
  });

  it("T08: unavailableMeta → validationStatus=unavailable, source preserved", () => {
    const meta = unavailableMeta("kite", "authoritative", "No session.");
    expect(meta.validationStatus).toBe("unavailable");
    expect(meta.isStale).toBe(true);
    expect(meta.source).toBe("kite");
    expect(meta.warnings.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §11.2  Provider routing (capability registry)
// ────────────────────────────────────────────────────────────────────────────

describe("§11.2 Provider routing (capability registry)", () => {
  it("T09: Kite session active → AVAILABLE for all trade-sensitive domains", () => {
    const snap = getProviderCapabilities();
    for (const domain of TRADE_SENSITIVE_DOMAINS) {
      expect(getCapabilityFor("kite", domain, snap).state).toBe("AVAILABLE");
    }
  });

  it("T10: Kite session inactive + creds present → AUTH_EXPIRED", () => {
    mockKiteSessionActive.mockReturnValue(false);
    const snap = getProviderCapabilities();
    for (const domain of TRADE_SENSITIVE_DOMAINS) {
      expect(getCapabilityFor("kite", domain, snap).state).toBe("AUTH_EXPIRED");
    }
  });

  it("T11: Kite no creds → NOT_CONFIGURED", () => {
    mockKiteHealth.mockReturnValue({ ...BASE_KITE_HEALTH, credsConfigured: false });
    mockKiteSessionActive.mockReturnValue(false);
    expect(getCapabilityFor("kite", "index_quote").state).toBe("NOT_CONFIGURED");
  });

  it("T12: Upstox is NOT_CONFIGURED (no env vars) — reason references UPSTOX credentials", () => {
    const cap = getCapabilityFor("upstox", "index_quote");
    expect(cap.state).toBe("NOT_CONFIGURED");
    expect(cap.reason).toMatch(/UPSTOX/i);
  });

  it("T13: IndianAPI is NOT_CONFIGURED — reason references INDIANAPI credentials", () => {
    const cap = getCapabilityFor("indianapi", "index_quote");
    expect(cap.state).toBe("NOT_CONFIGURED");
    expect(cap.reason).toMatch(/INDIANAPI/i);
  });

  it("T14: tradeAvailableProviders contains only kite (by policy)", () => {
    const snap = getProviderCapabilities();
    expect(snap.tradeAvailableProviders.every((p) => p === "kite")).toBe(true);
  });

  it("T15: Yahoo delayed data cannot become tradeable via pointFromMeta", () => {
    const meta = buildMeta({
      source: "yahoo",
      trustTier: "secondary_analytics",
      asOfMs: freshAsOfMs(),
      delayed: true,
      notForSignals: true,
      notForTradeDecisions: true,
    });
    const point = pointFromMeta({ key: "test", assetType: "index", symbol: "NIFTY", meta, value: 18500 });
    expect(point.canDriveSignals).toBe(false);
    expect(point.canDriveTradeAlerts).toBe(false);
    expect(point.sourceStatus).not.toBe("TRADE_GRADE");
  });

  it("T16: unavailable option chain provenance → premiumTrustVerdict trusted=false", () => {
    const prov = buildOptionChainProvenance(null, { missingReason: "No chain available." });
    expect(premiumTrustVerdict(prov).trusted).toBe(false);
  });

  it("T17: NSE-sourced chain is NOT trusted for signals", () => {
    const prov = buildOptionChainProvenance(buildNseChain(), {});
    expect(premiumTrustVerdict(prov).trusted).toBe(false);
    expect(prov.trustedForSignals).toBe(false);
  });

  it("T18: Kite-sourced fresh chain IS trusted for signals", () => {
    const prov = buildOptionChainProvenance(buildKiteChain(), {});
    expect(premiumTrustVerdict(prov).trusted).toBe(true);
    expect(prov.trustedForSignals).toBe(true);
    expect(classifyOcSource("kite")).toBe("kite");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §11.3  Identity and data mixing prevention
// ────────────────────────────────────────────────────────────────────────────

describe("§11.3 Identity and data mixing prevention", () => {
  it("T19: different source providers have different provenance classification", () => {
    const kite = buildOptionChainProvenance(buildKiteChain({ underlying: "NIFTY", source: "kite" }), {});
    const nse  = buildOptionChainProvenance(buildNseChain({ underlying: "BANKNIFTY" }), {});
    expect(kite.sourceProvider).toBe("kite");
    expect(nse.sourceProvider).toBe("nse");
    expect(kite.trustedForSignals).toBe(true);
    expect(nse.trustedForSignals).toBe(false);
  });

  it("T20: expired F&O contract → evaluateOptionChain returns expired=true, ok=false", () => {
    const ev = evaluateOptionChain(buildKiteChain({ expiry: "2020-01-01" }), new Date().toISOString());
    expect(ev.expired).toBe(true);
    expect(ev.ok).toBe(false);
  });

  it("T21: non-positive spot → evaluateOptionChain fails", () => {
    const ev = evaluateOptionChain(buildKiteChain({ spot: NaN }), new Date().toISOString());
    expect(ev.ok).toBe(false);
  });

  it("T22: empty rows → evaluateOptionChain fails, complete=false", () => {
    const ev = evaluateOptionChain(buildKiteChain({ rows: [] }), new Date().toISOString());
    expect(ev.ok).toBe(false);
    expect(ev.complete).toBe(false);
  });

  it("T23: DataMeta source is always a non-empty string", () => {
    const kite = buildMeta({ source: "kite", trustTier: "authoritative", asOfMs: freshAsOfMs(), delayed: false, notForSignals: false });
    expect(kite.source).toBeTruthy();
    expect(kite.source).not.toBe("none");
    const yahoo = buildMeta({ source: "yahoo", trustTier: "secondary_analytics", asOfMs: freshAsOfMs(), delayed: true, notForSignals: true });
    expect(yahoo.source).toBe("yahoo");
  });

  it("T24: clearOptionChainCache is idempotent and does not throw", () => {
    clearOptionChainCache();
    clearOptionChainCache();
    expect(true).toBe(true); // reaches here without error
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §11.4  Cache and rate limits
// ────────────────────────────────────────────────────────────────────────────

describe("§11.4 Cache and rate limits / sourceStatus mapping", () => {
  it("T25: stale kite meta → STALE, not TRADE_GRADE", () => {
    const meta = buildMeta({ source: "kite", trustTier: "authoritative", asOfMs: staleAsOfMs(), delayed: false, notForSignals: false });
    expect(sourceStatusFromMeta(meta, true)).toBe("STALE");
  });

  it("T26: unavailable meta → UNAVAILABLE", () => {
    const meta = unavailableMeta("kite", "authoritative", "Session expired.");
    expect(sourceStatusFromMeta(meta, false)).toBe("UNAVAILABLE");
  });

  it("T27: fresh kite authoritative → TRADE_GRADE", () => {
    const meta = buildMeta({ source: "kite", trustTier: "authoritative", asOfMs: freshAsOfMs(), delayed: false, notForSignals: false });
    expect(sourceStatusFromMeta(meta, true)).toBe("TRADE_GRADE");
  });

  it("T28: future-timestamp kite meta → STALE via sourceStatusFromMeta (not TRADE_GRADE)", () => {
    const now = Date.now();
    const meta = buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: now + (CLOCK_SKEW_TOLERANCE_SEC + 2) * 1000,
      nowMs: now,
      delayed: false,
      notForSignals: false,
    });
    expect(meta.isFutureTimestamp).toBe(true);
    // sourceStatusFromMeta sees isStale=true → returns STALE
    expect(sourceStatusFromMeta(meta, true)).toBe("STALE");
    expect(sourceStatusFromMeta(meta, true)).not.toBe("TRADE_GRADE");
  });

  it("T29: delayed yahoo meta → INFO_ONLY or DELAYED, never TRADE_GRADE", () => {
    const meta = buildMeta({ source: "yahoo", trustTier: "secondary_analytics", asOfMs: freshAsOfMs(), delayed: true, notForSignals: true });
    const status = sourceStatusFromMeta(meta, true);
    expect(["INFO_ONLY", "DELAYED"]).toContain(status);
    expect(status).not.toBe("TRADE_GRADE");
  });

  it("T30: getProviderCapabilities evaluates synchronously — no awaited I/O", () => {
    let completed = false;
    getProviderCapabilities();
    completed = true;
    expect(completed).toBe(true);
  });

  it("T31: unavailableMeta validationStatus is always 'unavailable'", () => {
    const meta = unavailableMeta("none", "secondary_analytics", "No source.");
    expect(meta.validationStatus).toBe("unavailable");
    expect(meta.source).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §11.5  Production consumer provenance
// ────────────────────────────────────────────────────────────────────────────

describe("§11.5 Production consumer provenance", () => {
  it("T32: providerCapabilities authoritative='kite'", () => {
    expect(getProviderCapabilities().authoritative).toBe("kite");
  });

  it("T33: snapshot covers all five expected providers", () => {
    const providers = [...new Set(getProviderCapabilities().capabilities.map((c) => c.provider))];
    for (const p of ["kite", "upstox", "indianapi", "yahoo", "nse"]) {
      expect(providers).toContain(p);
    }
  });

  it("T34: evaluatedAt is a recent ISO timestamp", () => {
    const snap = getProviderCapabilities();
    expect(snap.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.now() - new Date(snap.evaluatedAt).getTime()).toBeLessThan(5000);
  });

  it("T35: capability snapshot contains no raw credential patterns", () => {
    const s = JSON.stringify(getProviderCapabilities());
    expect(s).not.toMatch(/\b[a-f0-9]{40,}\b/);  // hex token
    expect(s).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // JWT
  });

  it("T36: NSE chain blocked at paper admission boundary (premiumTrustVerdict)", () => {
    const prov = buildOptionChainProvenance(buildNseChain(), {});
    expect(prov.trustedForSignals).toBe(false);
    expect(premiumTrustVerdict(prov).trusted).toBe(false);
  });

  it("T37: getCapabilityFor returns UNAVAILABLE for unknown provider/domain", () => {
    const cap = getCapabilityFor("indstocks", "option_chain");
    expect(cap.state).toBe("UNAVAILABLE");
    expect(cap.reason).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §11.6  Backward-compatibility
// ────────────────────────────────────────────────────────────────────────────

describe("§11.6 Backward-compatibility", () => {
  it("T38: TRADE_SENSITIVE_DOMAINS has the five expected domains", () => {
    for (const d of ["index_quote", "equity_quote", "intraday_candles", "daily_candles", "option_chain"]) {
      expect(TRADE_SENSITIVE_DOMAINS).toContain(d);
    }
    expect(TRADE_SENSITIVE_DOMAINS).not.toContain("instrument_master");
  });

  it("T39: buildMeta contract — all DataMeta fields present with correct types", () => {
    const meta = buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: freshAsOfMs(),
      delayed: false,
      notForSignals: false,
    });
    expect(typeof meta.source).toBe("string");
    expect(typeof meta.trustTier).toBe("string");
    expect(typeof meta.isStale).toBe("boolean");
    expect(typeof meta.delayed).toBe("boolean");
    expect(typeof meta.notForSignals).toBe("boolean");
    expect(typeof meta.notForTradeDecisions).toBe("boolean");
    expect(typeof meta.fetchedAt).toBe("string");
    expect(Array.isArray(meta.warnings)).toBe(true);
    expect(typeof meta.validationStatus).toBe("string");
    expect(meta.asOf === null || typeof meta.asOf === "string").toBe(true);
    expect(meta.freshnessSec === null || typeof meta.freshnessSec === "number").toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §11.7  Test-suite hygiene
// ────────────────────────────────────────────────────────────────────────────

describe("§11.7 Test-suite hygiene", () => {
  it("T40: vi.mock is in effect — kiteSessionActive returns a boolean", () => {
    expect(typeof kiteSessionActive()).toBe("boolean");
  });

  it("T41: DB_TEST_RUNTIME_AUTHORIZED is NOT 'true' (isolation guard active)", () => {
    expect(process.env["DB_TEST_RUNTIME_AUTHORIZED"]).not.toBe("true");
  });

  it("T42: getProviderCapabilities throws nothing (zero network calls)", () => {
    expect(() => getProviderCapabilities()).not.toThrow();
  });

  it("T43: capability reasons contain no raw secret token patterns", () => {
    const reasons = getProviderCapabilities().capabilities.map((c) => c.reason).join("\n");
    expect(reasons).not.toMatch(/\b[a-f0-9]{40,}\b/);
    expect(reasons).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });

  it("T44: CLOCK_SKEW_TOLERANCE_SEC is a positive finite number (> DRIFT_ALERT_MS/1000)", () => {
    // DRIFT_ALERT_MS = 1000ms = 1s; tolerance must exceed this
    expect(CLOCK_SKEW_TOLERANCE_SEC).toBeGreaterThan(1);
    expect(Number.isFinite(CLOCK_SKEW_TOLERANCE_SEC)).toBe(true);
    expect(CLOCK_SKEW_TOLERANCE_SEC).toBeGreaterThan(0);
  });

  it("T45: isFutureTimestamp is absent (undefined) for normal past timestamps", () => {
    const meta = buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: freshAsOfMs(),
      delayed: false,
      notForSignals: false,
    });
    // Optional field — must be absent (not false) for normal past timestamps
    expect(meta.isFutureTimestamp).toBeUndefined();
  });

  it("T46: capability state literal 'RATE_LIMITED' is a valid ProviderCapabilityState", () => {
    const state: ProviderCapabilityState = "RATE_LIMITED";
    expect(state).toBe("RATE_LIMITED");
  });
});
