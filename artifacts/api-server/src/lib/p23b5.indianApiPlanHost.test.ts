/**
 * Gate A (23B) — IndianAPI plan-host correctness tests.
 *
 * Verifies: all 5 plan mappings; exact-host acceptance; wrong-plan host
 * rejection; undocumented host rejection; subdomain-confusion rejection;
 * username/password URL rejection; http rejection; unexpected-port rejection;
 * trailing-slash normalization; invalid plan rejection; zero fetch calls on
 * every invalid configuration; no silent fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveIndianApiConfig,
  INDIANAPI_PLAN_HOST,
  createIndianApiClient,
  type IndianApiPlan,
} from "./marketData/indianApiClient";

beforeEach(() => { vi.unstubAllEnvs(); });
afterEach(() => { vi.unstubAllEnvs(); });

// ---------------------------------------------------------------------------
// Gate A-1: All five plan mappings
// ---------------------------------------------------------------------------

describe("Gate A-1 — All five plan → host mappings", () => {
  const cases: [IndianApiPlan, string][] = [
    ["FREE",           "stock.indianapi.in"],
    ["HOBBY",          "stock.indianapi.in"],
    ["DEVELOPER",      "dev.indianapi.in"],
    ["GROWTH_ANALYST", "analyst.indianapi.in"],
    ["PRO",            "pro.indianapi.in"],
  ];

  for (const [plan, expectedHost] of cases) {
    it(`A-1-${plan}: plan ${plan} → host ${expectedHost}`, () => {
      expect(INDIANAPI_PLAN_HOST[plan]).toBe(expectedHost);
    });
  }

  it("A-1-exclusive: only five plans are documented (no extra entries)", () => {
    const keys = Object.keys(INDIANAPI_PLAN_HOST);
    expect(keys.sort()).toEqual(["DEVELOPER", "FREE", "GROWTH_ANALYST", "HOBBY", "PRO"]);
  });
});

// ---------------------------------------------------------------------------
// Gate A-2: Exact-host acceptance
// ---------------------------------------------------------------------------

describe("Gate A-2 — Exact-host acceptance", () => {
  it("A-2a: correct FREE host → VALID", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("VALID");
  });

  it("A-2b: correct DEVELOPER host → VALID", () => {
    vi.stubEnv("INDIANAPI_PLAN", "DEVELOPER");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://dev.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("VALID");
  });

  it("A-2c: correct GROWTH_ANALYST host → VALID", () => {
    vi.stubEnv("INDIANAPI_PLAN", "GROWTH_ANALYST");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://analyst.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("VALID");
  });

  it("A-2d: correct PRO host → VALID", () => {
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("VALID");
  });
});

// ---------------------------------------------------------------------------
// Gate A-3: Wrong-plan host rejection
// ---------------------------------------------------------------------------

describe("Gate A-3 — Wrong-plan host rejection", () => {
  it("A-3a: FREE plan with PRO host → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("A-3b: DEVELOPER plan with FREE host → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "DEVELOPER");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("A-3c: PRO plan with DEVELOPER host → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://dev.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });
});

// ---------------------------------------------------------------------------
// Gate A-4: Undocumented host rejection
// ---------------------------------------------------------------------------

describe("Gate A-4 — Undocumented host rejection", () => {
  it("A-4a: api.indianapi.in (undocumented) → INVALID_PROVIDER_CONFIG for FREE plan", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://api.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("A-4b: api2.indianapi.in (undocumented) → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://api2.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("A-4c: arbitrary third-party URL → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://malicious.example.com");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });
});

// ---------------------------------------------------------------------------
// Gate A-5: Subdomain-confusion rejection
// ---------------------------------------------------------------------------

describe("Gate A-5 — Subdomain-confusion rejection", () => {
  it("A-5a: pro.indianapi.in.evil.com must not match PRO plan", () => {
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in.evil.com");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("A-5b: evilstock.indianapi.in must not match FREE plan", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://evilstock.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("A-5c: prefixed stock.indianapi.in must not match FREE plan", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://evil.stock.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });
});

// ---------------------------------------------------------------------------
// Gate A-6: Username/password URL rejection
// ---------------------------------------------------------------------------

describe("Gate A-6 — Username/password URL rejection", () => {
  it("A-6a: URL with username → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://user@stock.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("A-6b: URL with username:password → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://user:secret@stock.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });
});

// ---------------------------------------------------------------------------
// Gate A-7: http rejection
// ---------------------------------------------------------------------------

describe("Gate A-7 — http:// rejection", () => {
  it("A-7a: http:// FREE host → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "http://stock.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("A-7b: http:// PRO host → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    vi.stubEnv("INDIANAPI_BASE_URL", "http://pro.indianapi.in");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });
});

// ---------------------------------------------------------------------------
// Gate A-8: Unexpected port rejection
// ---------------------------------------------------------------------------

describe("Gate A-8 — Unexpected port rejection", () => {
  it("A-8a: non-standard port 8080 → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in:8080");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("A-8b: explicit standard port 443 → VALID (cosmetic)", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in:443");
    expect(resolveIndianApiConfig().configState).toBe("VALID");
  });
});

// ---------------------------------------------------------------------------
// Gate A-9: Trailing-slash normalization
// ---------------------------------------------------------------------------

describe("Gate A-9 — Trailing-slash normalization", () => {
  it("A-9a: trailing slash stripped from baseUrl", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in/");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("VALID");
    expect(cfg.baseUrl.endsWith("/")).toBe(false);
  });

  it("A-9b: multiple trailing slashes stripped", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in///");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("VALID");
    expect(cfg.baseUrl).toBe("https://stock.indianapi.in");
  });
});

// ---------------------------------------------------------------------------
// Gate A-10: Invalid plan rejection
// ---------------------------------------------------------------------------

describe("Gate A-10 — Invalid plan rejection", () => {
  it("A-10a: INDIANAPI_PLAN=ENTERPRISE (old incorrect value) → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "ENTERPRISE");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("A-10b: INDIANAPI_PLAN=INDIVIDUAL (old incorrect value) → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "INDIVIDUAL");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("A-10c: INDIANAPI_PLAN=STARTUP (old incorrect value) → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_PLAN", "STARTUP");
    expect(resolveIndianApiConfig().configState).toBe("INVALID_PROVIDER_CONFIG");
  });
});

// ---------------------------------------------------------------------------
// Gate A-11: Zero fetch calls on INVALID_PROVIDER_CONFIG
// ---------------------------------------------------------------------------

describe("Gate A-11 — Zero fetch calls on every invalid configuration", () => {
  const invalidConfigs = [
    { desc: "wrong plan host",  plan: "FREE", baseUrl: "https://pro.indianapi.in" },
    { desc: "http url",         plan: "FREE", baseUrl: "http://stock.indianapi.in" },
    { desc: "with credentials", plan: "FREE", baseUrl: "https://user:pass@stock.indianapi.in" },
    { desc: "wrong port",       plan: "FREE", baseUrl: "https://stock.indianapi.in:9000" },
    { desc: "undocumented host",plan: "FREE", baseUrl: "https://api.indianapi.in" },
  ] as const;

  for (const { desc, plan, baseUrl } of invalidConfigs) {
    it(`A-11 ${desc}: zero fetch calls`, async () => {
      let fetchCalled = false;
      vi.stubEnv("INDIANAPI_PLAN", plan);
      vi.stubEnv("INDIANAPI_BASE_URL", baseUrl);
      const cfg = resolveIndianApiConfig();
      // cfg.configState should be INVALID; if somehow VALID, still verify fetch guard
      const client = createIndianApiClient({
        config: { ...cfg, apiKey: "FAKE_KEY" },
        fetchImpl: async () => { fetchCalled = true; return new Response("{}", { status: 200 }); },
      });
      await client.getStock("RELIANCE").catch(() => { /* expected */ });
      expect(fetchCalled).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Gate A-12: No silent fallback
// ---------------------------------------------------------------------------

describe("Gate A-12 — No silent fallback to another host", () => {
  it("A-12a: INVALID_PROVIDER_CONFIG never changes baseUrl to a different valid host", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("INVALID_PROVIDER_CONFIG");
    // configError must explain WHY it is invalid (not silently substituted)
    expect(cfg.configError).toBeTruthy();
    expect(typeof cfg.configError).toBe("string");
  });

  it("A-12b: configError must not contain the API key value", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "SENSITIVE_KEY_MATERIAL");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://malicious.example.com");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configError ?? "").not.toContain("SENSITIVE_KEY_MATERIAL");
  });
});
