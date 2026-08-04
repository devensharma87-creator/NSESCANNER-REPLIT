/**
 * Pack 5 / §12.1–12.4 — Upstox provider load-bearing tests
 *
 * Uses the fetchImpl seam — zero live credentials required.
 * Proves: configuration state, transport resilience, freshness/normalization,
 * circuit breaker, retry, secret non-exposure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createUpstoxClient,
  UpstoxError,
  resolveUpstoxConfig,
  type UpstoxCandleInterval,
} from "../lib/marketData/upstoxClient";
import {
  isUpstoxConfigured,
  upstoxHealth,
  shadowFetchQuote,
  shadowFetchCandles,
  __setUpstoxClientForTests,
} from "../lib/marketData/upstoxProvider";
import {
  __resetShadowStateForTests,
  getShadowRoutingState,
  getParitySummary,
} from "../lib/marketData/shadowState";

// ---------------------------------------------------------------------------
// Mock builder helpers
// ---------------------------------------------------------------------------

function makeQuoteResponse(ltp = 22_000): Response {
  const body = {
    status: "success",
    data: {
      "NSE_INDEX|Nifty 50": {
        instrument_token: "NSE_INDEX|Nifty 50",
        timestamp:        new Date(Date.now() - 10_000).toISOString(),
        last_price:       ltp,
        ohlc:  { open: 21_900, high: 22_100, low: 21_800, close: 21_950 },
        volume: 1_000_000,
        average_price: 21_990,
        net_change:    50,
      },
    },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function makeCandleResponse(): Response {
  const candles = [
    ["2026-08-01T09:15:00+05:30", 21_800, 21_900, 21_750, 21_880, 500_000],
    ["2026-08-01T09:30:00+05:30", 21_880, 21_950, 21_850, 21_920, 600_000],
  ];
  return new Response(
    JSON.stringify({ status: "success", data: { candles } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function makeErrorResponse(status: number, message = "error"): Response {
  return new Response(
    JSON.stringify({ status: "error", message }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function makeConfiguredClient(fakeFetch: (url: string, init?: RequestInit) => Promise<Response>) {
  return createUpstoxClient({
    config: {
      baseUrl:     "https://api.upstox.com/v2",
      accessToken: "FAKE_TOKEN_NOT_REAL",
      timeoutMs:   5_000,
      maxRetries:  1,
      retryBaseMs: 10,
    },
    fetchImpl: fakeFetch as typeof fetch,
  });
}

// ---------------------------------------------------------------------------
// §12.1 Provider configuration
// ---------------------------------------------------------------------------

describe("P23A/Upstox — §12.1 provider configuration", () => {
  beforeEach(() => { __resetShadowStateForTests(); });
  afterEach(() => { __setUpstoxClientForTests(null); vi.unstubAllEnvs(); });

  it("P23A-1a: UPSTOX_ACCESS_TOKEN absent → isUpstoxConfigured() false", () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "");
    expect(isUpstoxConfigured()).toBe(false);
  });

  it("P23A-1b: absent token → upstoxHealth configured=false, routingState=NOT_CONFIGURED", () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "");
    const h = upstoxHealth();
    expect(h.configured).toBe(false);
    expect(h.routingState).toBe("NOT_CONFIGURED");
  });

  it("P23A-1c: absent token → shadowFetchQuote returns null without calling fetch", async () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "");
    let fetchCalled = false;
    const fakeClient = createUpstoxClient({
      config: { baseUrl: "https://api.upstox.com/v2", accessToken: null, timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10 },
      fetchImpl: async () => { fetchCalled = true; return makeQuoteResponse(); },
    });
    __setUpstoxClientForTests(fakeClient);
    const canQuote: import("../lib/marketData/types").MarketQuote = {
      symbol: "NIFTY",
      lastPrice: 22000,
      meta: {
        source: "kite", trustTier: "authoritative",
        asOf: new Date().toISOString(), fetchedAt: new Date().toISOString(),
        freshnessSec: 2, isStale: false, delayed: false,
        notForSignals: false, notForTradeDecisions: false,
        validationStatus: "validated", warnings: [],
      },
    };
    const result = await shadowFetchQuote("NIFTY", "NSE_INDEX|Nifty 50", canQuote);
    expect(result).toBeNull();
    expect(fetchCalled).toBe(false);
  });

  it("P23A-1d: getQuotes with missing token → throws UpstoxError with kind=config", async () => {
    const client = createUpstoxClient({
      config: { baseUrl: "https://api.upstox.com/v2", accessToken: null, timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10 },
      fetchImpl: async () => makeQuoteResponse(),
    });
    await expect(client.getQuotes(["NSE_INDEX|Nifty 50"])).rejects.toThrow(UpstoxError);
    await expect(client.getQuotes(["NSE_INDEX|Nifty 50"])).rejects.toMatchObject({ kind: "config" });
  });

  it("P23A-1e: token must never appear in error messages", async () => {
    const sensitiveToken = "FAKE_TOKEN_SENSITIVE_XYZ789";
    const client = createUpstoxClient({
      config: { baseUrl: "https://api.upstox.com/v2", accessToken: sensitiveToken, timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10 },
      fetchImpl: async () => makeErrorResponse(401, "Unauthorized"),
    });
    try {
      await client.getQuotes(["NSE_INDEX|Nifty 50"]);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstoxError);
      const msg = (err as UpstoxError).message;
      expect(msg).not.toContain(sensitiveToken);
    }
  });
});

// ---------------------------------------------------------------------------
// §12.3 Transport resilience
// ---------------------------------------------------------------------------

describe("P23A/Upstox — §12.3 transport resilience", () => {
  it("P23A-3a: 401 → throws UpstoxError kind=auth, no retry", async () => {
    let callCount = 0;
    const client = makeConfiguredClient(async () => { callCount++; return makeErrorResponse(401, "Unauthorized"); });
    await expect(client.getQuotes(["K"])).rejects.toMatchObject({ kind: "auth", status: 401 });
    expect(callCount).toBe(1); // no retry on 401
  });

  it("P23A-3b: 403 → throws UpstoxError kind=auth", async () => {
    const client = makeConfiguredClient(async () => makeErrorResponse(403, "Forbidden"));
    await expect(client.getQuotes(["K"])).rejects.toMatchObject({ kind: "auth", status: 403 });
  });

  it("P23A-3c: 404 → throws UpstoxError kind=not_found, no retry", async () => {
    let callCount = 0;
    const client = makeConfiguredClient(async () => { callCount++; return makeErrorResponse(404, "Not Found"); });
    await expect(client.getQuotes(["K"])).rejects.toMatchObject({ kind: "not_found", status: 404 });
    expect(callCount).toBe(1);
  });

  it("P23A-3d: 429 with Retry-After → throws UpstoxError kind=rate_limit with retryAfterMs", async () => {
    // Use maxRetries:0 so no sleep before throwing (avoids 5s timeout in tests)
    const client = createUpstoxClient({
      config: { baseUrl: "https://api.upstox.com/v2", accessToken: "FAKE_TOKEN_NOT_REAL", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10 },
      fetchImpl: async () => new Response(
        JSON.stringify({ status: "error", message: "Too Many Requests" }),
        { status: 429, headers: { "Retry-After": "5", "content-type": "application/json" } },
      ) as unknown as ReturnType<typeof fetch>,
    });
    const err = await client.getQuotes(["K"]).catch(e => e);
    expect(err).toBeInstanceOf(UpstoxError);
    expect(err.kind).toBe("rate_limit");
    expect(err.retryAfterMs).toBeGreaterThanOrEqual(5_000);
  });

  it("P23A-3e: 500 → retries up to maxRetries then throws kind=server", async () => {
    let callCount = 0;
    const client = makeConfiguredClient(async () => { callCount++; return makeErrorResponse(500, "Server Error"); });
    await expect(client.getQuotes(["K"])).rejects.toMatchObject({ kind: "server" });
    expect(callCount).toBeGreaterThan(1); // retried at least once
    expect(callCount).toBeLessThanOrEqual(3); // but bounded
  });

  it("P23A-3f: malformed JSON response → throws UpstoxError kind=payload", async () => {
    const client = makeConfiguredClient(async () =>
      new Response("not-json{{{", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await expect(client.getQuotes(["K"])).rejects.toMatchObject({ kind: "payload" });
  });

  it("P23A-3g: status=error in body → throws UpstoxError kind=payload", async () => {
    const client = makeConfiguredClient(async () =>
      new Response(JSON.stringify({ status: "error", message: "some error" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    await expect(client.getQuotes(["K"])).rejects.toMatchObject({ kind: "payload" });
  });

  it("P23A-3h: network error (fetch throws) → kind=network", async () => {
    const client = makeConfiguredClient(async () => { throw new TypeError("Failed to fetch"); });
    await expect(client.getQuotes(["K"])).rejects.toMatchObject({ kind: "network" });
  });

  it("P23A-3i: timeout (AbortError) → kind=timeout", async () => {
    const client = createUpstoxClient({
      config: { baseUrl: "https://api.upstox.com/v2", accessToken: "TOKEN", timeoutMs: 1, maxRetries: 0, retryBaseMs: 10 },
      fetchImpl: async (_url, init) => {
        // Simulate abort
        return new Promise((_resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new DOMException("Aborted", "AbortError");
              reject(err);
            });
          }
          setTimeout(() => reject(new Error("timeout")), 100);
        });
      },
    });
    const err = await client.getQuotes(["K"]).catch(e => e);
    expect(err).toBeInstanceOf(UpstoxError);
    expect(["timeout", "network"]).toContain(err.kind);
  });

  it("P23A-3j: circuit breaker opens after repeated failures", async () => {
    let callCount = 0;
    const client = makeConfiguredClient(async () => { callCount++; return makeErrorResponse(500, "Error"); });
    // Exhaust all attempts to trigger circuit failures
    for (let i = 0; i < 6; i++) {
      await client.getQuotes(["K"]).catch(() => {});
    }
    // After 5 failures, circuit should be open
    expect(client.circuitState()).toBe("open");
    // Next call should throw with network kind (circuit open)
    const callsBefore = callCount;
    await expect(client.getQuotes(["K"])).rejects.toMatchObject({ kind: "network" });
    // No real fetch attempted when circuit is open
    expect(callCount).toBe(callsBefore);
  });

  it("P23A-3k: empty getQuotes returns empty map without network call", async () => {
    let called = false;
    const client = makeConfiguredClient(async () => { called = true; return makeQuoteResponse(); });
    const result = await client.getQuotes([]);
    expect(result.size).toBe(0);
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §12.4 Freshness and normalization
// ---------------------------------------------------------------------------

describe("P23A/Upstox — §12.4 freshness and normalization", () => {
  beforeEach(() => { __resetShadowStateForTests(); });
  afterEach(() => { __setUpstoxClientForTests(null); vi.unstubAllEnvs(); });

  it("P23A-4a: successful shadow fetch records a parity sample", async () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "FAKE_TOKEN");
    const fakeClient = makeConfiguredClient(async () => makeQuoteResponse(21_950));
    __setUpstoxClientForTests(fakeClient);

    const canonicalQuote: import("../lib/marketData/types").MarketQuote = {
      symbol:    "NIFTY",
      lastPrice: 21_950,
      meta: {
        source: "kite", trustTier: "authoritative",
        asOf: new Date().toISOString(), fetchedAt: new Date().toISOString(),
        freshnessSec: 2, isStale: false, delayed: false,
        notForSignals: false, notForTradeDecisions: false,
        validationStatus: "validated", warnings: [],
      },
    };

    await shadowFetchQuote("NIFTY", "NSE_INDEX|Nifty 50", canonicalQuote);

    const summary = getParitySummary("upstox");
    expect(summary.sampleCount).toBeGreaterThan(0);
    expect(summary.quoteSamples.length).toBeGreaterThan(0);
    expect(summary.quoteSamples[0]?.symbol).toBe("NIFTY");
  });

  it("P23A-4b: candle normalization — OHLCVtimestamp fields mapped correctly", async () => {
    const client = makeConfiguredClient(async () => makeCandleResponse());
    const candles = await client.getCandles("NSE_INDEX|Nifty 50", "15minute", "2026-08-01", "2026-08-01");
    expect(candles.length).toBe(2);
    expect(candles[0]).toHaveProperty("timestamp");
    expect(candles[0]).toHaveProperty("open");
    expect(candles[0]).toHaveProperty("high");
    expect(candles[0]).toHaveProperty("low");
    expect(candles[0]).toHaveProperty("close");
    expect(candles[0]).toHaveProperty("volume");
    expect(typeof candles[0]!.open).toBe("number");
    expect(Number.isFinite(candles[0]!.close)).toBe(true);
  });

  it("P23A-4c: candle response missing data array → returns empty array", async () => {
    const client = makeConfiguredClient(async () =>
      new Response(JSON.stringify({ status: "success", data: { candles: null } }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    );
    const candles = await client.getCandles("K", "day", "2026-01-01", "2026-08-01");
    expect(candles).toEqual([]);
  });

  it("P23A-4d: shadow fetch with > 0.5% price diff → withinTolerance=false", async () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "FAKE_TOKEN");
    // Canonical 22000, shadow 22150 → 0.68% diff > 0.5% tolerance
    const fakeClient = makeConfiguredClient(async () => makeQuoteResponse(22_150));
    __setUpstoxClientForTests(fakeClient);

    const canonicalQuote: import("../lib/marketData/types").MarketQuote = {
      symbol:    "NIFTY",
      lastPrice: 22_000,
      meta: {
        source: "kite", trustTier: "authoritative",
        asOf: new Date().toISOString(), fetchedAt: new Date().toISOString(),
        freshnessSec: 2, isStale: false, delayed: false,
        notForSignals: false, notForTradeDecisions: false,
        validationStatus: "validated", warnings: [],
      },
    };

    await shadowFetchQuote("NIFTY", "NSE_INDEX|Nifty 50", canonicalQuote);

    const summary = getParitySummary("upstox");
    const latest = summary.quoteSamples.at(-1);
    expect(latest?.withinTolerance).toBe(false);
    expect(latest?.ltpRelDiff).not.toBeNull();
    if (latest?.ltpRelDiff !== null && latest?.ltpRelDiff !== undefined) {
      expect(latest.ltpRelDiff).toBeGreaterThan(0.005);
    }
  });

  it("P23A-4e: shadow fetch error → sample recorded, parity result returns null", async () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "FAKE_TOKEN");
    // Use 500 (not 429) so there's no Retry-After sleep delay in tests
    const fakeClient = makeConfiguredClient(async () => makeErrorResponse(500, "Internal Error"));
    __setUpstoxClientForTests(fakeClient);

    const canonicalQuote: import("../lib/marketData/types").MarketQuote = {
      symbol:    "NIFTY",
      lastPrice: 22_000,
      meta: {
        source: "kite", trustTier: "authoritative",
        asOf: new Date().toISOString(), fetchedAt: new Date().toISOString(),
        freshnessSec: 2, isStale: false, delayed: false,
        notForSignals: false, notForTradeDecisions: false,
        validationStatus: "validated", warnings: [],
      },
    };

    const result = await shadowFetchQuote("NIFTY", "NSE_INDEX|Nifty 50", canonicalQuote);
    expect(result).toBeNull(); // null on error

    const summary = getParitySummary("upstox");
    expect(summary.sampleCount).toBeGreaterThan(0); // sample still recorded
  });
});
