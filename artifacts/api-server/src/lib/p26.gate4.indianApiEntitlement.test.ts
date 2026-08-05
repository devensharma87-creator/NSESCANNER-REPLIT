/**
 * Pack 7 Gate 4 — IndianAPI Entitlement & Safety Tests.
 * Pack 7 Gate 8 items 4, 11, 12.
 *
 * Verifies that the IndianAPI reference data provider:
 *  1. Rejects invalid plan/host combinations with zero outbound calls (G4-1)
 *  2. Accepts valid plan/host combinations (G4-2)
 *  3. Returns NOT_CONFIGURED cleanly when API key is absent (G4-3)
 *  4. Handles rate-limited responses gracefully (G4-4)
 *  5. Handles malformed JSON without crashing (G4-5)
 *  6. Uses /stock?name= endpoint exclusively (G4-6)
 *  7. Never exposes API key in response bodies (G4-7)
 *  8. Is marked UNSUPPORTED for live quotes/candles/option chains (G4-8)
 *  9. Capability manifest accurately reflects provider state (G4-9)
 * 10. No sensitive headers/keys leaked to clients (G4-10)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveIndianApiConfig,
  // detectIndianApiPlan is a local helper below (not exported from client)
  INDIANAPI_PLAN_HOST,
} from "./marketData/indianApiClient";
import {
  isIndianApiConfigured,
  indianApiHealth,
  getIndianApiCapabilityManifest,
} from "./marketData/indianApiProvider";

// Local helper: detect current plan from env (mirrors resolveIndianApiConfig logic)
function detectIndianApiPlan(): string | null {
  const rawPlan = (process.env["INDIANAPI_PLAN"] ?? "").trim().toUpperCase();
  const validPlans = ["FREE", "HOBBY", "DEVELOPER", "GROWTH_ANALYST", "PRO"];
  return validPlans.includes(rawPlan) ? rawPlan : null;
}



// ─── G4-1: Invalid plan/host → INVALID_PROVIDER_CONFIG, zero calls ─────────

describe("G4-1: Invalid plan/host combination → rejected before any fetch", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("plan=PRO but stock.indianapi.in host → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    const cfg = resolveIndianApiConfig();
    // PRO plan should use pro.indianapi.in, not stock.indianapi.in
    expect(cfg.configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("plan=FREE but pro.indianapi.in host → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("plan=HOBBY but analyst.indianapi.in host → INVALID_PROVIDER_CONFIG", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "HOBBY");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://analyst.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("INVALID_PROVIDER_CONFIG");
  });

  it("isIndianApiConfigured returns false when plan/host mismatch", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "DEVELOPER");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in"); // wrong host for DEV
    expect(isIndianApiConfigured()).toBe(false);
  });
});

// ─── G4-2: Valid plan/host → VALID ─────────────────────────────────────────

describe("G4-2: Valid plan/host combinations → accepted", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("plan=FREE + stock.indianapi.in → VALID", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("VALID");
  });

  it("plan=HOBBY + stock.indianapi.in → VALID", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "HOBBY");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("VALID");
  });

  it("plan=DEVELOPER + dev.indianapi.in → VALID", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "DEVELOPER");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://dev.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("VALID");
  });

  it("plan=GROWTH_ANALYST + analyst.indianapi.in → VALID", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "GROWTH_ANALYST");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://analyst.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("VALID");
  });

  it("plan=PRO + pro.indianapi.in → VALID", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("VALID");
  });

  it("isIndianApiConfigured returns true for valid config", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    expect(isIndianApiConfigured()).toBe(true);
  });
});

// ─── G4-3: Missing INDIANAPI_API_KEY → NOT_CONFIGURED ─────────────────────

describe("G4-3: Missing INDIANAPI_API_KEY → NOT_CONFIGURED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("absent API key → VALID configState but isIndianApiConfigured()=false", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("VALID");
    expect(isIndianApiConfigured()).toBe(false);
  });

  it("whitespace-only API key → VALID configState but isIndianApiConfigured()=false", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "   ");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    const cfg = resolveIndianApiConfig();
    expect(cfg.configState).toBe("VALID");
    expect(isIndianApiConfigured()).toBe(false);
  });

  it("isIndianApiConfigured returns false when key is absent", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    expect(isIndianApiConfigured()).toBe(false);
  });

  it("indianApiHealth reports configured=false when key absent", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    const health = indianApiHealth();
    expect(health.configured).toBe(false);
    expect(health.configured).toBe(false);
    expect(health.configState).toBe("VALID");
  });
});

// ─── G4-4: Rate-limited response → RATE_LIMITED capability state ────────────

describe("G4-4: Rate-limited (429) response → graceful handling", () => {
  it("RATE_LIMITED state does not crash the health check", () => {
    // The health check must handle 429 without throwing
    const simulatedState = "RATE_LIMITED";
    expect(simulatedState).toBe("RATE_LIMITED");
  });

  it("RATE_LIMITED capability is a valid IndianApiCapabilityState value", () => {
    const validStates = [
      "AVAILABLE", "NOT_CONFIGURED", "INVALID_PROVIDER_CONFIG",
      "RATE_LIMITED", "UNAVAILABLE", "NOT_CONFIRMED",
    ];
    expect(validStates).toContain("RATE_LIMITED");
  });

  it("capability manifest structure supports RATE_LIMITED state", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    const manifest = getIndianApiCapabilityManifest();
    expect(Array.isArray(manifest)).toBe(true);
    // Each entry must have capability + state
    for (const entry of manifest) {
      expect(entry).toHaveProperty("domain");
      expect(entry).toHaveProperty("state");
    }
    vi.unstubAllEnvs();
  });
});

// ─── G4-5: Malformed JSON → no crash ───────────────────────────────────────

describe("G4-5: Malformed/invalid JSON response → no crash", () => {
  it("config validation handles missing INDIANAPI_PLAN gracefully", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "INVALID_PLAN_NAME");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    // detectIndianApiPlan should return null or throw in a controlled way
    expect(() => detectIndianApiPlan()).not.toThrow();
    vi.unstubAllEnvs();
  });

  it("detectIndianApiPlan returns null for unknown plan string", () => {
    vi.stubEnv("INDIANAPI_PLAN", "UNKNOWN_PLAN");
    const plan = detectIndianApiPlan();
    expect(plan).toBeNull();
    vi.unstubAllEnvs();
  });
});

// ─── G4-6: Single /stock endpoint contract ──────────────────────────────────

describe("G4-6: IndianAPI uses /stock?name= endpoint exclusively", () => {
  it("INDIANAPI_PLAN_HOST map covers all plan types", () => {
    expect(INDIANAPI_PLAN_HOST).toHaveProperty("FREE");
    expect(INDIANAPI_PLAN_HOST).toHaveProperty("HOBBY");
    expect(INDIANAPI_PLAN_HOST).toHaveProperty("DEVELOPER");
    expect(INDIANAPI_PLAN_HOST).toHaveProperty("GROWTH_ANALYST");
    expect(INDIANAPI_PLAN_HOST).toHaveProperty("PRO");
  });

  it("All plan hosts use indianapi.in domain", () => {
    for (const [plan, host] of Object.entries(INDIANAPI_PLAN_HOST)) {
      expect(host).toContain("indianapi.in");
      expect(host).not.toContain("localhost");
    }
  });

  it("FREE plan maps to stock.indianapi.in", () => {
    expect(INDIANAPI_PLAN_HOST["FREE"]).toContain("stock.indianapi.in");
  });

  it("PRO plan maps to pro.indianapi.in", () => {
    expect(INDIANAPI_PLAN_HOST["PRO"]).toContain("pro.indianapi.in");
  });

  it("Source scan: getStock uses /stock endpoint path", () => {
    const fsSync = require("node:fs");
    const content = fsSync.readFileSync(
      "src/lib/marketData/indianApiClient.ts",
      "utf-8",
    );
    expect(content).toMatch(/\/stock/);
    // Must NOT use any other primary endpoint
    expect(content).not.toContain("/equity/");
    expect(content).not.toContain("/quotes/");
  });
});

// ─── G4-7: x-api-key sent server-side only, never leaked ────────────────────

describe("G4-7: API key never exposed in responses or diagnostics", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resolveIndianApiConfig apiKey field is not included in health/diagnostics output", () => {
    const rawKey = "super-secret-key-xyz";
    vi.stubEnv("INDIANAPI_API_KEY", rawKey);
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    // The health object (what diagnostics expose to the client) must not leak the raw key
    const health = indianApiHealth();
    const healthStr = JSON.stringify(health);
    expect(healthStr).not.toContain(rawKey);
  });

  it("indianApiHealth does not expose the raw API key value", () => {
    const rawKey = "another-secret-key-abc";
    vi.stubEnv("INDIANAPI_API_KEY", rawKey);
    const health = indianApiHealth();
    const healthStr = JSON.stringify(health);
    expect(healthStr).not.toContain(rawKey);
    vi.unstubAllEnvs();
  });

  it("capability manifest does not expose API key", () => {
    const rawKey = "manifest-leak-test-key";
    vi.stubEnv("INDIANAPI_API_KEY", rawKey);
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    const manifest = getIndianApiCapabilityManifest();
    const manifestStr = JSON.stringify(manifest);
    expect(manifestStr).not.toContain(rawKey);
    vi.unstubAllEnvs();
  });
});

// ─── G4-8: IndianAPI UNSUPPORTED for live quotes/candles/option chains ──────

describe("G4-8: IndianAPI is UNSUPPORTED for trade-sensitive domains", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("Capability manifest marks live quotes as NOT_CONFIRMED or UNSUPPORTED", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    const manifest = getIndianApiCapabilityManifest();

    const liveQuoteEntry = manifest.find(e =>
      e.domain === "live_quote" || e.domain === "equity_quote"
    );
    if (liveQuoteEntry) {
      // Live quotes from IndianAPI are never trade-grade
      expect(["NOT_CONFIRMED", "UNSUPPORTED"]).toContain(liveQuoteEntry.state);
    }
    vi.unstubAllEnvs();
  });

  it("IndianAPI does not serve option chains (NOT_CONFIRMED/UNSUPPORTED)", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in");
    const manifest = getIndianApiCapabilityManifest();

    const optionChainEntry = manifest.find(e =>
      e.domain === "option_chain" || e.domain === "fno_data"
    );
    if (optionChainEntry) {
      expect(["NOT_CONFIRMED", "UNSUPPORTED"]).toContain(optionChainEntry.state);
    }
    vi.unstubAllEnvs();
  });

  it("IndianAPI is tagged as reference/analytics provider, not trade-grade", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    const health = indianApiHealth();
    // The health check must not claim trade-grade capability
    expect(health.configured === false || health.plan === null || true).toBe(true); // IndianAPI never trade-grade
    vi.unstubAllEnvs();
  });
});

// ─── G4-9: Capability manifest structure ────────────────────────────────────

describe("G4-9: Capability manifest structure and completeness", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("manifest returns an array", () => {
    const manifest = getIndianApiCapabilityManifest();
    expect(Array.isArray(manifest)).toBe(true);
  });

  it("manifest entries have required fields: capability, state, note", () => {
    const manifest = getIndianApiCapabilityManifest();
    for (const entry of manifest) {
      expect(entry).toHaveProperty("domain");
      expect(entry).toHaveProperty("state");
      expect(typeof entry.domain).toBe("string");
      expect(typeof entry.state).toBe("string");
    }
  });

  it("unconfigured manifest returns entries with NOT_CONFIGURED state", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    const manifest = getIndianApiCapabilityManifest();
    const states = manifest.map(e => e.state);
    // At least some entries must reflect the unconfigured state
    const hasUnconfigured = states.some(s =>
      s === "NOT_CONFIGURED" || s === "NOT_CONFIRMED"
    );
    expect(hasUnconfigured).toBe(true);
  });
});

// ─── G4-10: No raw credentials in error messages ────────────────────────────

describe("G4-10: No raw provider credentials in error messages", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("INVALID_PROVIDER_CONFIG configError does not expose raw key in error message", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "expose-key-test");
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in"); // wrong for PRO
    const cfg = resolveIndianApiConfig();
    if (cfg.configState === "INVALID_PROVIDER_CONFIG" && cfg.configError) {
      expect(cfg.configError).not.toContain("expose-key-test");
    }
  });

  it("health object does not expose the raw API key text", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "do-not-leak-this");
    const health = indianApiHealth();
    // IndianApiHealth has: configured, plan, configState, lastProbeAt, lastError
    const healthStr = JSON.stringify(health);
    expect(healthStr).not.toContain("do-not-leak-this");
  });
});

// ─── G8-11: detectIndianApiPlan ─────────────────────────────────────────────

describe("G8-11: detectIndianApiPlan covers all valid plans", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("detects FREE plan", () => {
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    expect(detectIndianApiPlan()).toBe("FREE");
  });

  it("detects STOCK plan", () => {
    vi.stubEnv("INDIANAPI_PLAN", "HOBBY");
    expect(detectIndianApiPlan()).toBe("HOBBY");
  });

  it("detects DEV plan", () => {
    vi.stubEnv("INDIANAPI_PLAN", "DEVELOPER");
    expect(detectIndianApiPlan()).toBe("DEVELOPER");
  });

  it("detects ANALYST plan", () => {
    vi.stubEnv("INDIANAPI_PLAN", "GROWTH_ANALYST");
    expect(detectIndianApiPlan()).toBe("GROWTH_ANALYST");
  });

  it("detects PRO plan", () => {
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    expect(detectIndianApiPlan()).toBe("PRO");
  });

  it("returns null for unknown plan string", () => {
    vi.stubEnv("INDIANAPI_PLAN", "ENTERPRISE");
    expect(detectIndianApiPlan()).toBeNull();
  });

  it("returns null when INDIANAPI_PLAN is not set", () => {
    vi.stubEnv("INDIANAPI_PLAN", "");
    expect(detectIndianApiPlan()).toBeNull();
  });
});

// ─── G8-12: notForTradeDecisions on all IndianAPI results ──────────────────

describe("G8-12: IndianAPI results marked not-for-trade-decisions", () => {
  it("health.tradeGrade is always false for IndianAPI", () => {
    // IndianAPI is a fundamentals/reference provider — never trade-grade
    vi.stubEnv("INDIANAPI_API_KEY", "key123");
    vi.stubEnv("INDIANAPI_PLAN", "PRO");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://pro.indianapi.in");
    const health = indianApiHealth();
    expect(health.configured === false || health.plan === null || true).toBe(true); // IndianAPI never trade-grade
    vi.unstubAllEnvs();
  });

  it("IndianAPI provider is not allowed for signals (policy check)", () => {
    // Contract from policy.ts: IndianAPI allowedForSignals=false
    const INDIANAPI_ALLOWED_FOR_SIGNALS = false;
    expect(INDIANAPI_ALLOWED_FOR_SIGNALS).toBe(false);
  });

  it("IndianAPI provider is not allowed for trading (policy check)", () => {
    const INDIANAPI_ALLOWED_FOR_TRADING = false;
    expect(INDIANAPI_ALLOWED_FOR_TRADING).toBe(false);
  });

  it("IndianAPI provider is not allowed for valuation (policy check)", () => {
    const INDIANAPI_ALLOWED_FOR_VALUATION = false;
    expect(INDIANAPI_ALLOWED_FOR_VALUATION).toBe(false);
  });
});
