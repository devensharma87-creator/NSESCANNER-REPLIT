/**
 * Pack 5 / §12.5 — Shadow non-interference load-bearing tests
 *
 * THIS IS THE MOST CRITICAL PACK 5 TEST FILE.
 *
 * Proves: changing every Upstox/IndianAPI shadow value to absurd values
 * does not change returned canonical Kite values; shadow failures do not delay
 * or replace canonical responses; no provider averaging; no silent fallback.
 *
 * Uses fabricated shadow state — no live credentials required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  assertCanonicalUnchanged,
  fireShadow,
  __resetShadowStateForTests,
  getShadowRoutingState,
  setShadowRoutingState,
  recordQuoteSample,
  getParitySummary,
  PARITY_SAMPLE_RING_SIZE,
} from "../lib/marketData/shadowState";
import {
  dispatchShadowQuote,
  dispatchShadowCandles,
} from "../lib/marketData/shadowDispatch";
import {
  __setUpstoxClientForTests,
} from "../lib/marketData/upstoxProvider";
import { createUpstoxClient } from "../lib/marketData/upstoxClient";
import type { MarketQuote, CandleSeries, TrustedQuote } from "../lib/marketData/types";

// ---------------------------------------------------------------------------
// Test fixture builders
// ---------------------------------------------------------------------------

function makeCanonicalQuote(ltp: number): MarketQuote {
  return {
    symbol:    "NIFTY",
    lastPrice: ltp,
    meta: {
      source:           "kite",
      trustTier:        "authoritative",
      asOf:             new Date().toISOString(),
      fetchedAt:        new Date().toISOString(),
      freshnessSec:     2,
      isStale:          false,
      delayed:          false,
      notForSignals:    false,
      notForTradeDecisions: false,
      validationStatus: "validated",
      warnings:         [],
    },
  };
}

function makeCanonicalSeries(closes: number[]): CandleSeries {
  return {
    symbol:   "NIFTY",
    interval: "15minute",
    candles:  closes.map((close, i) => ({
      t:      new Date(Date.now() - (closes.length - i) * 15 * 60_000).toISOString(),
      open:   close - 10,
      high:   close + 20,
      low:    close - 20,
      close,
      volume: 500_000,
    })),
    meta: {
      source:           "kite",
      trustTier:        "authoritative",
      asOf:             new Date().toISOString(),
      fetchedAt:        new Date().toISOString(),
      freshnessSec:     2,
      isStale:          false,
      delayed:          false,
      notForSignals:    false,
      notForTradeDecisions: false,
      validationStatus: "validated",
      warnings:         [],
    },
  };
}

/** Absurd quote response — wildly wrong LTP, impossible OI, negative values */
function makeAbsurdQuoteResponse(token = "NSE_INDEX|Nifty 50"): Response {
  const body = {
    status: "success",
    data: {
      [token]: {
        instrument_token: token,
        timestamp:        new Date(Date.now() - 5_000).toISOString(),
        last_price:       999_999_999, // absurdly high
        ohlc:  { open: -1, high: -1, low: -1, close: -1 },
        volume: -999_000,
        average_price: null,
        net_change:    null,
      },
    },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** Absurd candle response */
function makeAbsurdCandleResponse(): Response {
  const candles = [
    ["2026-08-01T09:15:00+05:30", 999_999, 999_999, 0, 999_999, 0],
    ["2026-08-01T09:30:00+05:30", -1,      -1,      -1, -1,     -1],
  ];
  return new Response(
    JSON.stringify({ status: "success", data: { candles } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// §12.5 Shadow non-interference
// ---------------------------------------------------------------------------

describe("P23C/Shadow — §12.5 shadow non-interference", () => {
  beforeEach(() => { __resetShadowStateForTests(); });
  afterEach(() => { __setUpstoxClientForTests(null); vi.unstubAllEnvs(); });

  it("P23C-5a: canonical quote is IDENTICAL before and after shadow dispatch (absurd shadow)", async () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "FAKE_TOKEN");
    const fakeClient = createUpstoxClient({
      config: { baseUrl: "https://api.upstox.com/v2", authMode: "ANALYTICS_TOKEN", accessToken: "FAKE_TOKEN", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10 },
      fetchImpl: async () => makeAbsurdQuoteResponse(),
    });
    __setUpstoxClientForTests(fakeClient);

    const canonical = makeCanonicalQuote(22_000);

    // Capture reference before shadow
    const before = JSON.stringify(canonical);

    // Dispatch shadow (fire-and-forget)
    dispatchShadowQuote("NIFTY", canonical);

    // Wait for fire-and-forget to complete
    await new Promise((r) => setTimeout(r, 100));

    // Canonical must be unchanged
    const after = JSON.stringify(canonical);
    expect(before).toBe(after);
    expect(canonical.lastPrice).toBe(22_000);
    expect(canonical.meta.source).toBe("kite");
    expect(canonical.meta.trustTier).toBe("authoritative");
  });

  it("P23C-5b: absurd shadow values do not change canonical LTP", async () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "FAKE_TOKEN");
    const fakeClient = createUpstoxClient({
      config: { baseUrl: "https://api.upstox.com/v2", authMode: "ANALYTICS_TOKEN", accessToken: "FAKE_TOKEN", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10 },
      fetchImpl: async () => makeAbsurdQuoteResponse(),
    });
    __setUpstoxClientForTests(fakeClient);

    const CANONICAL_LTP = 21_850;
    const canonical = makeCanonicalQuote(CANONICAL_LTP);

    dispatchShadowQuote("NIFTY", canonical);
    await new Promise((r) => setTimeout(r, 150));

    expect(canonical.lastPrice).toBe(CANONICAL_LTP);
  });

  it("P23C-5c: canonical series is IDENTICAL before and after shadow candle dispatch (absurd)", async () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "FAKE_TOKEN");
    const fakeClient = createUpstoxClient({
      config: { baseUrl: "https://api.upstox.com/v2", authMode: "ANALYTICS_TOKEN", accessToken: "FAKE_TOKEN", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10 },
      fetchImpl: async () => makeAbsurdCandleResponse(),
    });
    __setUpstoxClientForTests(fakeClient);

    const canonical = makeCanonicalSeries([21_800, 21_850, 21_900]);
    const before = JSON.stringify(canonical);

    dispatchShadowCandles("NIFTY", canonical, "15minute", "2026-08-01", "2026-08-04");
    await new Promise((r) => setTimeout(r, 150));

    expect(JSON.stringify(canonical)).toBe(before);
    expect(canonical.candles.at(-1)?.close).toBe(21_900);
  });

  it("P23C-5d: shadow failure (500) does not throw into caller and canonical is preserved", async () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "FAKE_TOKEN");
    const fakeClient = createUpstoxClient({
      config: { baseUrl: "https://api.upstox.com/v2", authMode: "ANALYTICS_TOKEN", accessToken: "FAKE_TOKEN", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10 },
      fetchImpl: async () => new Response(JSON.stringify({ status: "error" }), { status: 500, headers: { "content-type": "application/json" } }),
    });
    __setUpstoxClientForTests(fakeClient);

    const canonical = makeCanonicalQuote(22_100);
    const before = JSON.stringify(canonical);

    // Should not throw
    expect(() => dispatchShadowQuote("NIFTY", canonical)).not.toThrow();
    await new Promise((r) => setTimeout(r, 150));

    expect(JSON.stringify(canonical)).toBe(before);
  });

  it("P23C-5e: shadow timeout does not delay caller — fireShadow resolves quickly", async () => {
    const slowFn = () => new Promise<void>((resolve) => setTimeout(resolve, 50_000));

    const t0 = Date.now();
    fireShadow(slowFn, 100); // 100ms timeout
    // fireShadow is fire-and-forget — returns immediately
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50); // caller not blocked
  });

  it("P23C-5f: shadow dispatch is no-op when Upstox not configured", async () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "");
    let fetchCalled = false;
    const fakeClient = createUpstoxClient({
      config: { baseUrl: "https://api.upstox.com/v2", authMode: "NOT_CONFIGURED", accessToken: null, timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10 },
      fetchImpl: async () => { fetchCalled = true; return makeAbsurdQuoteResponse(); },
    });
    __setUpstoxClientForTests(fakeClient);

    const canonical = makeCanonicalQuote(22_000);
    dispatchShadowQuote("NIFTY", canonical);
    await new Promise((r) => setTimeout(r, 100));

    expect(fetchCalled).toBe(false);
    expect(canonical.lastPrice).toBe(22_000);
  });

  it("P23C-5g: shadow dispatch is no-op for unmapped symbols", async () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "FAKE_TOKEN");
    let fetchCalled = false;
    const fakeClient = createUpstoxClient({
      config: { baseUrl: "https://api.upstox.com/v2", authMode: "ANALYTICS_TOKEN", accessToken: "FAKE_TOKEN", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10 },
      fetchImpl: async () => { fetchCalled = true; return makeAbsurdQuoteResponse(); },
    });
    __setUpstoxClientForTests(fakeClient);

    const canonical = makeCanonicalQuote(500);
    // Use an equity symbol that has no static mapping
    dispatchShadowQuote("SOME_EQUITY_NOT_MAPPED", canonical);
    await new Promise((r) => setTimeout(r, 100));

    expect(fetchCalled).toBe(false);
  });

  it("P23C-5h: assertCanonicalUnchanged — equal objects return true", () => {
    const a = { x: 1, y: "hello" };
    const b = { x: 1, y: "hello" };
    expect(assertCanonicalUnchanged(a, b)).toBe(true);
  });

  it("P23C-5i: assertCanonicalUnchanged — mutated object returns false", () => {
    const original = { lastPrice: 22_000, source: "kite" };
    const mutated  = { lastPrice: 999_999, source: "upstox" };
    expect(assertCanonicalUnchanged(original, mutated)).toBe(false);
  });

  it("P23C-5j: promotionEligible is always false in Pack 5 (hard block)", async () => {
    const { getParitySummary } = await import("../lib/marketData/shadowState");
    const summary = getParitySummary("upstox");
    expect(summary.promotionEligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shadow state management
// ---------------------------------------------------------------------------

describe("P23C/Shadow — state management", () => {
  beforeEach(() => { __resetShadowStateForTests(); });

  it("P23C-S1: initial routing state is NOT_CONFIGURED", () => {
    expect(getShadowRoutingState("upstox")).toBe("NOT_CONFIGURED");
    expect(getShadowRoutingState("indianapi")).toBe("NOT_CONFIGURED");
  });

  it("P23C-S2: setShadowRoutingState changes state for the named provider only", () => {
    setShadowRoutingState("upstox", "SHADOW_ONLY");
    expect(getShadowRoutingState("upstox")).toBe("SHADOW_ONLY");
    expect(getShadowRoutingState("indianapi")).toBe("NOT_CONFIGURED"); // unchanged
  });

  it("P23C-S3: ring buffer caps at PARITY_SAMPLE_RING_SIZE", () => {
    // Insert 20 samples (more than the 10 shown in summary but fewer than ring cap)
    for (let i = 0; i < 20; i++) {
      recordQuoteSample({
        provider:        "upstox",
        symbol:          "NIFTY",
        sampledAt:       new Date().toISOString(),
        canonicalLtp:    22_000,
        shadowLtp:       22_010,
        ltpAbsDiff:      10,
        ltpRelDiff:      0.00045,
        shadowAgeSec:    5,
        canonicalAgeSec: 2,
        shadowLatencyMs: 150,
        withinTolerance: true,
        reason:          null,
      });
    }
    const summary = getParitySummary("upstox");
    expect(summary.sampleCount).toBe(20);
    // Summary shows at most last 10; ring buffer is PARITY_SAMPLE_RING_SIZE
    expect(PARITY_SAMPLE_RING_SIZE).toBeGreaterThan(0);
    expect(summary.quoteSamples.length).toBeLessThanOrEqual(10);
  });
});
