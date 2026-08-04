/**
 * Pack 5 / §12.1, 12.3, 12.4 — IndianAPI provider load-bearing tests
 *
 * Uses the fetchImpl seam — zero live credentials required.
 * Proves: NOT_CONFIGURED behavior, transport resilience, normalization rules,
 * secret non-exposure, capability manifest honesty.
 *
 * Updated for 23B: single /stock endpoint; new plan types (FREE/PRO/…);
 * merged profile+ratios fixture; AVAILABLE state in capability manifest.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createIndianApiClient,
  IndianApiError,
  resolveIndianApiConfig,
} from "../lib/marketData/indianApiClient";
import {
  isIndianApiConfigured,
  indianApiHealth,
  getStockProfile,
  getStockRatios,
  getIndianApiCapabilityManifest,
  __setIndianApiClientForTests,
} from "../lib/marketData/indianApiProvider";

// ---------------------------------------------------------------------------
// Fixtures — merged /stock response (Gate B: single endpoint)
// ---------------------------------------------------------------------------

function makeStockResponse(overrides: Record<string, unknown> = {}): Response {
  const body = {
    // Profile fields
    companyName: "Reliance Industries Limited",
    isin:        "INE002A01018",
    sector:      "Energy",
    industry:    "Oil & Gas",
    marketCap:   18_500_000_000_000,
    currency:    "INR",
    // Ratios fields — from the same /stock response
    pe: 24.5, pb: 2.1, eps: 92.3,
    dividendYield: 0.4, roe: 8.7, debtToEquity: 0.32,
    period: "TTM",
    ...overrides,
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function makeErrorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: "error", message: "err" }), {
    status, headers: { "content-type": "application/json" },
  });
}

function makeConfiguredClient(fakeFetch: (url: string, init?: RequestInit) => Promise<Response>) {
  return createIndianApiClient({
    config: {
      baseUrl:     "https://stock.indianapi.in",
      apiKey:      "FAKE_API_KEY_NOT_REAL",
      plan:        "FREE" as const,
      configState: "VALID" as const,
      timeoutMs:   5_000,
      maxRetries:  1,
      retryBaseMs: 10,
    },
    fetchImpl: fakeFetch as typeof fetch,
  });
}

// ---------------------------------------------------------------------------
// §12.1 Configuration
// ---------------------------------------------------------------------------

describe("P23B/IndianAPI — §12.1 provider configuration", () => {
  afterEach(() => { __setIndianApiClientForTests(null); vi.unstubAllEnvs(); });

  it("P23B-1a: INDIANAPI_API_KEY absent → isIndianApiConfigured() false", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    expect(isIndianApiConfigured()).toBe(false);
  });

  it("P23B-1b: absent key → getStockProfile returns NOT_CONFIGURED result without network call", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    let fetchCalled = false;
    const fakeClient = createIndianApiClient({
      config: {
        baseUrl: "https://stock.indianapi.in", plan: "FREE", apiKey: null,
        configState: "VALID", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10,
      },
      fetchImpl: async () => { fetchCalled = true; return makeStockResponse(); },
    });
    __setIndianApiClientForTests(fakeClient);
    const result = await getStockProfile("RELIANCE");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("NOT_CONFIGURED");
    expect(fetchCalled).toBe(false);
  });

  it("P23B-1c: absent key → getStockRatios returns NOT_CONFIGURED without network call", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    let fetchCalled = false;
    const fakeClient = createIndianApiClient({
      config: {
        baseUrl: "https://stock.indianapi.in", plan: "FREE", apiKey: null,
        configState: "VALID", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10,
      },
      fetchImpl: async () => { fetchCalled = true; return makeStockResponse(); },
    });
    __setIndianApiClientForTests(fakeClient);
    const result = await getStockRatios("RELIANCE");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("NOT_CONFIGURED");
    expect(fetchCalled).toBe(false);
  });

  it("P23B-1d: NOT_CONFIGURED result meta has notForSignals and notForTradeDecisions", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    __setIndianApiClientForTests(createIndianApiClient({
      config: {
        baseUrl: "https://stock.indianapi.in", plan: "FREE", apiKey: null,
        configState: "VALID", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10,
      },
      fetchImpl: async () => makeStockResponse(),
    }));
    const result = await getStockProfile("RELIANCE");
    expect(result.meta.notForSignals).toBe(true);
    expect(result.meta.notForTradeDecisions).toBe(true);
  });

  it("P23B-1e: API key must not appear in error messages", async () => {
    const sensitiveKey = "FAKE_API_KEY_SENSITIVE_ABC123";
    const client = createIndianApiClient({
      config: {
        baseUrl: "https://stock.indianapi.in", apiKey: sensitiveKey, plan: "FREE" as const,
        configState: "VALID", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10,
      },
      fetchImpl: async () => makeErrorResponse(401),
    });
    try {
      await client.getStock("RELIANCE");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(IndianApiError);
      const msg = (err as IndianApiError).message;
      expect(msg).not.toContain(sensitiveKey);
    }
  });
});

// ---------------------------------------------------------------------------
// §12.3 Transport resilience
// ---------------------------------------------------------------------------

describe("P23B/IndianAPI — §12.3 transport resilience", () => {
  it("P23B-3a: config error (null key) → throws IndianApiError kind=config", async () => {
    const client = createIndianApiClient({
      config: {
        baseUrl: "https://stock.indianapi.in", plan: "FREE", apiKey: null,
        configState: "VALID", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10,
      },
      fetchImpl: async () => makeStockResponse(),
    });
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "config" });
  });

  it("P23B-3b: 401 → throws IndianApiError kind=auth", async () => {
    const client = makeConfiguredClient(async () => makeErrorResponse(401));
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "auth", status: 401 });
  });

  it("P23B-3c: 403 → throws IndianApiError kind=auth", async () => {
    const client = makeConfiguredClient(async () => makeErrorResponse(403));
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "auth", status: 403 });
  });

  it("P23B-3d: 404 → throws IndianApiError kind=not_found", async () => {
    const client = makeConfiguredClient(async () => makeErrorResponse(404));
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("P23B-3e: 429 with Retry-After → throws IndianApiError kind=rate_limit, retryAfterMs set", async () => {
    const client = createIndianApiClient({
      config: {
        baseUrl: "https://stock.indianapi.in", plan: "FREE", apiKey: "FAKE_API_KEY_NOT_REAL",
        configState: "VALID", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10,
      },
      fetchImpl: async () => new Response(
        JSON.stringify({ error: "rate_limit" }),
        { status: 429, headers: { "Retry-After": "10", "content-type": "application/json" } },
      ) as unknown as ReturnType<typeof fetch>,
    });
    const err = await client.getStock("RELIANCE").catch(e => e);
    expect(err).toBeInstanceOf(IndianApiError);
    expect(err.kind).toBe("rate_limit");
    expect(err.retryAfterMs).toBeGreaterThanOrEqual(10_000);
  });

  it("P23B-3f: 500 → retries, then throws kind=server", async () => {
    let count = 0;
    const client = makeConfiguredClient(async () => { count++; return makeErrorResponse(500); });
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "server" });
    expect(count).toBeGreaterThan(1);
  });

  it("P23B-3g: non-JSON response → throws kind=payload", async () => {
    const client = makeConfiguredClient(async () =>
      new Response("not json at all", { status: 200, headers: { "content-type": "text/html" } }),
    );
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "payload" });
  });

  it("P23B-3h: network error → throws kind=network", async () => {
    const client = makeConfiguredClient(async () => { throw new TypeError("Failed to fetch"); });
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "network" });
  });
});

// ---------------------------------------------------------------------------
// §12.4 Normalization
// ---------------------------------------------------------------------------

describe("P23B/IndianAPI — §12.4 normalization", () => {
  afterEach(() => { __setIndianApiClientForTests(null); vi.unstubAllEnvs(); });

  it("P23B-4a: stock profile fields correctly mapped from /stock response", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const fakeClient = makeConfiguredClient(async () => makeStockResponse());
    __setIndianApiClientForTests(fakeClient);
    const result = await getStockProfile("RELIANCE");
    expect(result.ok).toBe(true);
    expect(result.data?.companyName).toBe("Reliance Industries Limited");
    expect(result.data?.isin).toBe("INE002A01018");
    expect(result.data?.sector).toBe("Energy");
    expect(result.data?.currency).toBe("INR");
  });

  it("P23B-4b: null/missing fields in profile mapped to null (not zero, not empty string)", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const fakeClient = makeConfiguredClient(async () =>
      makeStockResponse({ isin: null, sector: undefined, marketCap: null }),
    );
    __setIndianApiClientForTests(fakeClient);
    const result = await getStockProfile("RELIANCE");
    expect(result.ok).toBe(true);
    expect(result.data?.isin).toBeNull();
    expect(result.data?.sector).toBeNull();
    expect(result.data?.marketCap).toBeNull();
  });

  it("P23B-4c: ratios fields correctly mapped from same /stock response", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const fakeClient = makeConfiguredClient(async () => makeStockResponse());
    __setIndianApiClientForTests(fakeClient);
    const result = await getStockRatios("RELIANCE");
    expect(result.ok).toBe(true);
    expect(result.data?.pe).toBe(24.5);
    expect(result.data?.period).toBe("TTM");
    expect(result.data?.dividendYield).toBe(0.4);
  });

  it("P23B-4d: result meta is always notForSignals=true and notForTradeDecisions=true", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const fakeClient = makeConfiguredClient(async () => makeStockResponse());
    __setIndianApiClientForTests(fakeClient);
    const r = await getStockProfile("RELIANCE");
    expect(r.meta.notForSignals).toBe(true);
    expect(r.meta.notForTradeDecisions).toBe(true);
  });

  it("P23B-4e: result meta source=indianapi, trustTier=secondary_analytics", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const fakeClient = makeConfiguredClient(async () => makeStockResponse());
    __setIndianApiClientForTests(fakeClient);
    const r = await getStockProfile("RELIANCE");
    expect(r.meta.source).toBe("indianapi");
    expect(r.meta.trustTier).toBe("secondary_analytics");
  });
});

// ---------------------------------------------------------------------------
// Capability manifest (updated for 23B: AVAILABLE state)
// ---------------------------------------------------------------------------

describe("P23B/IndianAPI — capability manifest", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("P23B-M1: manifest has company_profile and financial_ratios as AVAILABLE when key present", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const manifest = getIndianApiCapabilityManifest();
    const profile  = manifest.find(e => e.domain === "company_profile");
    const ratios   = manifest.find(e => e.domain === "financial_ratios");
    expect(profile?.state).toBe("AVAILABLE");
    expect(ratios?.state).toBe("AVAILABLE");
  });

  it("P23B-M2: unconfirmed domains are NOT_CONFIRMED even when key present", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const manifest     = getIndianApiCapabilityManifest();
    const financials   = manifest.find(e => e.domain === "financial_statements");
    const shareholding = manifest.find(e => e.domain === "shareholding");
    expect(financials?.state).toBe("NOT_CONFIRMED");
    expect(shareholding?.state).toBe("NOT_CONFIRMED");
  });

  it("P23B-M3: all entries are NOT_CONFIGURED when key absent", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    const manifest = getIndianApiCapabilityManifest();
    for (const entry of manifest) {
      expect(entry.state).toBe("NOT_CONFIGURED");
    }
  });
});
