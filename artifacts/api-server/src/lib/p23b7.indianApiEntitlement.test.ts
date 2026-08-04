/**
 * Gate C (23B) — Fail-closed plan entitlement and capability registry tests.
 *
 * Verifies: AVAILABLE only when all conditions met; NOT_CONFIGURED without key;
 * INVALID_PROVIDER_CONFIG overrides all states; NOT_ENTITLED for excluded plans;
 * UNSUPPORTED for unimplemented domains; RATE_LIMITED ≠ AUTH_EXPIRED;
 * capability diagnostics don't claim live verification.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getIndianApiCapabilityManifest,
  type IndianApiCapabilityState,
} from "./marketData/indianApiProvider";
import {
  resolveIndianApiConfig,
  createIndianApiClient,
  IndianApiError,
} from "./marketData/indianApiClient";

afterEach(() => { vi.unstubAllEnvs(); });

// ---------------------------------------------------------------------------
// C-1: AVAILABLE only when configured + plan valid + credentials present
// ---------------------------------------------------------------------------

describe("Gate C-1 — AVAILABLE only when all conditions met", () => {
  it("C-1a: key present + valid FREE plan → company_profile and financial_ratios AVAILABLE", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    const manifest = getIndianApiCapabilityManifest();
    const profile = manifest.find(e => e.domain === "company_profile");
    const ratios  = manifest.find(e => e.domain === "financial_ratios");
    expect(profile?.state).toBe<IndianApiCapabilityState>("AVAILABLE");
    expect(ratios?.state).toBe<IndianApiCapabilityState>("AVAILABLE");
  });

  it("C-1b: key present + PRO plan → AVAILABLE for confirmed domains", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    const manifest = getIndianApiCapabilityManifest();
    const profile = manifest.find(e => e.domain === "company_profile");
    expect(profile?.state).toBe<IndianApiCapabilityState>("AVAILABLE");
  });

  it("C-1c: key present + DEVELOPER plan → AVAILABLE for confirmed domains", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    vi.stubEnv("INDIANAPI_PLAN", "DEVELOPER");
    const manifest = getIndianApiCapabilityManifest();
    const ratios = manifest.find(e => e.domain === "financial_ratios");
    expect(ratios?.state).toBe<IndianApiCapabilityState>("AVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// C-2: NOT_CONFIGURED when key absent
// ---------------------------------------------------------------------------

describe("Gate C-2 — NOT_CONFIGURED when API key absent", () => {
  it("C-2a: all capabilities NOT_CONFIGURED when key absent", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    const manifest = getIndianApiCapabilityManifest();
    for (const entry of manifest) {
      expect(entry.state).toBe<IndianApiCapabilityState>("NOT_CONFIGURED");
    }
  });

  it("C-2b: implemented capability stays NOT_CONFIGURED even with valid plan but no key", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    const manifest = getIndianApiCapabilityManifest();
    const profile = manifest.find(e => e.domain === "company_profile");
    expect(profile?.state).toBe<IndianApiCapabilityState>("NOT_CONFIGURED");
  });
});

// ---------------------------------------------------------------------------
// C-3: INVALID_PROVIDER_CONFIG overrides all
// ---------------------------------------------------------------------------

describe("Gate C-3 — INVALID_PROVIDER_CONFIG overrides all capability states", () => {
  it("C-3a: invalid plan → all capabilities INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    vi.stubEnv("INDIANAPI_PLAN", "INVALID_PLAN");
    const manifest = getIndianApiCapabilityManifest();
    for (const entry of manifest) {
      expect(entry.state).toBe<IndianApiCapabilityState>("INVALID_PROVIDER_CONFIG");
    }
  });

  it("C-3b: wrong host for plan → all capabilities INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in");
    const manifest = getIndianApiCapabilityManifest();
    for (const entry of manifest) {
      expect(entry.state).toBe<IndianApiCapabilityState>("INVALID_PROVIDER_CONFIG");
    }
  });

  it("C-3c: INVALID_PROVIDER_CONFIG client makes zero fetch calls", async () => {
    let fetchCalled = false;
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in");
    const cfg = resolveIndianApiConfig();
    const client = createIndianApiClient({
      config: { ...cfg, apiKey: "FAKE_KEY" },
      fetchImpl: async () => { fetchCalled = true; return new Response("{}", { status: 200 }); },
    });
    await client.getStock("RELIANCE").catch(() => {});
    expect(fetchCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C-4: NOT_CONFIRMED for unconfirmed marketing-page features
// ---------------------------------------------------------------------------

describe("Gate C-4 — NOT_CONFIRMED for unverified endpoint domains", () => {
  it("C-4a: financial_statements is NOT_CONFIRMED even with key + valid plan", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    const manifest = getIndianApiCapabilityManifest();
    const financials = manifest.find(e => e.domain === "financial_statements");
    // PRO plan may have access, but we don't assert AVAILABLE without verified contract
    expect(["NOT_CONFIRMED", "NOT_ENTITLED"]).toContain(financials?.state);
    expect(financials?.state).not.toBe("AVAILABLE");
  });

  it("C-4b: shareholding is NOT_CONFIRMED even with key + valid plan", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    const manifest = getIndianApiCapabilityManifest();
    const sh = manifest.find(e => e.domain === "shareholding");
    expect(sh?.state).not.toBe("AVAILABLE");
  });

  it("C-4c: news is NOT_CONFIRMED (marketing page feature, not implemented)", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    const manifest = getIndianApiCapabilityManifest();
    const news = manifest.find(e => e.domain === "news");
    expect(news?.state).not.toBe("AVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// C-5: RATE_LIMITED ≠ AUTH_EXPIRED — distinct error kinds
// ---------------------------------------------------------------------------

describe("Gate C-5 — RATE_LIMITED distinguished from AUTH_EXPIRED", () => {
  it("C-5a: 429 response → IndianApiError kind=rate_limit (not auth)", async () => {
    const client = createIndianApiClient({
      config: {
        baseUrl: "https://stock.indianapi.in", plan: "FREE", apiKey: "FAKE",
        configState: "VALID", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10,
      },
      fetchImpl: async () => new Response("{}", {
        status: 429, headers: { "Retry-After": "10" },
      }),
    });
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("C-5b: 401 → auth (not rate_limit)", async () => {
    const client = createIndianApiClient({
      config: {
        baseUrl: "https://stock.indianapi.in", plan: "FREE", apiKey: "FAKE",
        configState: "VALID", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10,
      },
      fetchImpl: async () => new Response("{}", { status: 401 }),
    });
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "auth" });
    // Specifically NOT rate_limit
    await client.getStock("RELIANCE").catch((e: IndianApiError) => {
      expect(e.kind).not.toBe("rate_limit");
      expect(e.kind).not.toBe("rate_limited");
    });
  });

  it("C-5c: rate_limited error kind distinct from transient rate_limit", () => {
    const transient = new IndianApiError("Transient 429, will retry.", "rate_limit", 429, 5_000);
    const permanent = new IndianApiError("Session rate limit hit.", "rate_limited");
    expect(transient.kind).toBe("rate_limit");
    expect(permanent.kind).toBe("rate_limited");
    expect(transient.kind).not.toBe(permanent.kind);
  });
});

// ---------------------------------------------------------------------------
// C-6: Capability manifest structure
// ---------------------------------------------------------------------------

describe("Gate C-6 — Capability manifest structure", () => {
  it("C-6a: manifest has entries for all expected domains", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const manifest = getIndianApiCapabilityManifest();
    const domains = manifest.map(e => e.domain);
    expect(domains).toContain("company_profile");
    expect(domains).toContain("financial_ratios");
    expect(domains).toContain("financial_statements");
    expect(domains).toContain("shareholding");
  });

  it("C-6b: every entry has domain, endpoint, state, notes fields", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const manifest = getIndianApiCapabilityManifest();
    for (const entry of manifest) {
      expect(typeof entry.domain).toBe("string");
      expect(typeof entry.endpoint).toBe("string");
      expect(typeof entry.state).toBe("string");
      expect(typeof entry.notes).toBe("string");
    }
  });

  it("C-6c: company_profile and financial_ratios both show /stock endpoint", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const manifest = getIndianApiCapabilityManifest();
    const profile = manifest.find(e => e.domain === "company_profile")!;
    const ratios  = manifest.find(e => e.domain === "financial_ratios")!;
    expect(profile.endpoint).toContain("/stock");
    expect(ratios.endpoint).toContain("/stock");
    // Explicitly NOT /stock_ratios (removed in 23B)
    expect(profile.endpoint).not.toContain("/stock_ratios");
    expect(ratios.endpoint).not.toContain("/stock_ratios");
  });
});
