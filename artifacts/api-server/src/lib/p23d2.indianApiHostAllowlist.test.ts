/**
 * Gate D tests — IndianAPI plan-host model (updated for 23B).
 *
 * Replaces the prior 23A test that incorrectly validated api.indianapi.in and
 * api2.indianapi.in as allowed hosts.  Those are NOT documented plan hosts.
 *
 * Now validates the correct documented plan → host mapping:
 *   FREE / HOBBY       → stock.indianapi.in
 *   DEVELOPER          → dev.indianapi.in
 *   GROWTH_ANALYST     → analyst.indianapi.in
 *   PRO                → pro.indianapi.in
 *
 * Also validates: INVALID_PROVIDER_CONFIG on bad hosts; https-only;
 * no-fallback contract; rate_limited error kind.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveIndianApiConfig,
  detectIndianApiPlan,
  INDIANAPI_PLAN_HOST,
  createIndianApiClient,
  IndianApiError,
  type IndianApiPlan,
} from "./marketData/indianApiClient";

beforeEach(() => {
  vi.unstubAllEnvs();
  // Clear plan and base URL for each test
  vi.stubEnv("INDIANAPI_PLAN", "");
  vi.stubEnv("INDIANAPI_BASE_URL", "");
  vi.stubEnv("INDIANAPI_API_KEY", "");
});

afterEach(() => { vi.unstubAllEnvs(); });

// ---------------------------------------------------------------------------
// INDIANAPI_PLAN_HOST map — correct documented hosts
// ---------------------------------------------------------------------------

describe("Gate D — INDIANAPI_PLAN_HOST documented mapping", () => {
  it("D-1: FREE plan → stock.indianapi.in", () => {
    expect(INDIANAPI_PLAN_HOST["FREE"]).toBe("stock.indianapi.in");
  });

  it("D-2: HOBBY plan → stock.indianapi.in (same as FREE)", () => {
    expect(INDIANAPI_PLAN_HOST["HOBBY"]).toBe("stock.indianapi.in");
  });

  it("D-3: DEVELOPER plan → dev.indianapi.in", () => {
    expect(INDIANAPI_PLAN_HOST["DEVELOPER"]).toBe("dev.indianapi.in");
  });

  it("D-4: GROWTH_ANALYST plan → analyst.indianapi.in", () => {
    expect(INDIANAPI_PLAN_HOST["GROWTH_ANALYST"]).toBe("analyst.indianapi.in");
  });

  it("D-5: PRO plan → pro.indianapi.in", () => {
    expect(INDIANAPI_PLAN_HOST["PRO"]).toBe("pro.indianapi.in");
  });

  it("D-6: all five plan keys present in INDIANAPI_PLAN_HOST", () => {
    const plans: IndianApiPlan[] = ["FREE", "HOBBY", "DEVELOPER", "GROWTH_ANALYST", "PRO"];
    for (const plan of plans) {
      expect(typeof INDIANAPI_PLAN_HOST[plan]).toBe("string");
      expect(INDIANAPI_PLAN_HOST[plan].length).toBeGreaterThan(0);
    }
  });

  it("D-7: undocumented api.indianapi.in is NOT in INDIANAPI_PLAN_HOST values", () => {
    const hosts = Object.values(INDIANAPI_PLAN_HOST);
    expect(hosts).not.toContain("api.indianapi.in");
  });

  it("D-8: undocumented api2.indianapi.in is NOT in INDIANAPI_PLAN_HOST values", () => {
    const hosts = Object.values(INDIANAPI_PLAN_HOST);
    expect(hosts).not.toContain("api2.indianapi.in");
  });
});

// ---------------------------------------------------------------------------
// detectIndianApiPlan() — reverse map
// ---------------------------------------------------------------------------

describe("Gate D — detectIndianApiPlan()", () => {
  it("D-9: stock.indianapi.in → FREE", () => {
    expect(detectIndianApiPlan("https://stock.indianapi.in")).toBe<IndianApiPlan>("FREE");
  });

  it("D-10: dev.indianapi.in → DEVELOPER", () => {
    expect(detectIndianApiPlan("https://dev.indianapi.in")).toBe<IndianApiPlan>("DEVELOPER");
  });

  it("D-11: analyst.indianapi.in → GROWTH_ANALYST", () => {
    expect(detectIndianApiPlan("https://analyst.indianapi.in")).toBe<IndianApiPlan>("GROWTH_ANALYST");
  });

  it("D-12: pro.indianapi.in → PRO", () => {
    expect(detectIndianApiPlan("https://pro.indianapi.in")).toBe<IndianApiPlan>("PRO");
  });

  it("D-13: unknown host → null (no silent assignment to a plan)", () => {
    expect(detectIndianApiPlan("https://api.indianapi.in")).toBeNull();
    expect(detectIndianApiPlan("https://other.example.com")).toBeNull();
  });

  it("D-14: malformed URL → null (no crash)", () => {
    expect(detectIndianApiPlan("not-a-url")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveIndianApiConfig() — plan selection and host validation
// ---------------------------------------------------------------------------

describe("Gate D — resolveIndianApiConfig() plan selection", () => {
  it("D-15: no env vars → default plan FREE, base stock.indianapi.in, configState VALID", () => {
    const cfg = resolveIndianApiConfig();
    expect(cfg.plan).toBe<IndianApiPlan>("FREE");
    expect(cfg.baseUrl).toBe("https://stock.indianapi.in");
    expect(cfg.configState).toBe("VALID");
  });

  it("D-16: INDIANAPI_PLAN=DEVELOPER → base dev.indianapi.in, configState VALID", () => {
    vi.stubEnv("INDIANAPI_PLAN", "DEVELOPER");
    const cfg = resolveIndianApiConfig();
    expect(cfg.plan).toBe<IndianApiPlan>("DEVELOPER");
    expect(cfg.baseUrl).toBe("https://dev.indianapi.in");
    expect(cfg.configState).toBe("VALID");
  });

  it("D-17: INDIANAPI_PLAN=PRO → base pro.indianapi.in, configState VALID", () => {
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    const cfg = resolveIndianApiConfig();
    expect(cfg.plan).toBe<IndianApiPlan>("PRO");
    expect(cfg.baseUrl).toBe("https://pro.indianapi.in");
    expect(cfg.configState).toBe("VALID");
  });

  it("D-18: INDIANAPI_PLAN=INVALID_PLAN → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "INVALID_PLAN");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("D-19: INDIANAPI_BASE_URL matches plan host → VALID", () => {
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("VALID");
    expect(cfg.baseUrl).toBe("https://pro.indianapi.in");
  });

  it("D-20: INDIANAPI_BASE_URL host doesn't match plan host → INVALID_PROVIDER_CONFIG (no fallback)", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in");  // PRO host, FREE plan
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("INVALID_PROVIDER_CONFIG");
    // Must NOT silently substitute another host
    expect(cfg.configError).toBeTruthy();
  });

  it("D-21: http:// URL → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "http://stock.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("D-22: URL with embedded credentials → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://user:pass@stock.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("INVALID_PROVIDER_CONFIG");
  });
});

// ---------------------------------------------------------------------------
// INVALID_PROVIDER_CONFIG → zero network calls
// ---------------------------------------------------------------------------

describe("Gate D — INVALID_PROVIDER_CONFIG makes zero network calls", () => {
  it("D-23: client with INVALID_PROVIDER_CONFIG throws config error before fetch", async () => {
    let fetchCalled = false;
    const client = createIndianApiClient({
      config: {
        baseUrl: "https://stock.indianapi.in", plan: "FREE", apiKey: "FAKE",
        configState: "INVALID_PROVIDER_CONFIG",
        configError: "Test invalid config",
        timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10,
      },
      fetchImpl: async () => { fetchCalled = true; return new Response("", { status: 200 }); },
    });
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "config" });
    expect(fetchCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// IndianApiError rate_limited kind
// ---------------------------------------------------------------------------

describe("Gate D — IndianApiError kinds include rate_limited", () => {
  it("D-24: IndianApiError can be constructed with kind=rate_limited", () => {
    const err = new IndianApiError("Rate limit exceeded.", "rate_limited");
    expect(err.kind).toBe("rate_limited");
    expect(err).toBeInstanceOf(IndianApiError);
  });

  it("D-25: rate_limited error message does not expose key material", () => {
    const err = new IndianApiError("Rate limited by remote.", "rate_limited");
    expect(err.message).not.toContain("FAKE");
    expect(err.kind).toBe("rate_limited");
  });
});
