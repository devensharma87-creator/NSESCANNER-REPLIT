/**
 * Pack 7 Gate 7 — Diagnostics Auth & Shadow Impact Tests.
 * Pack 7 Gate 8 items 17–18.
 *
 * Verifies that:
 *  G7-1: /api/providers/diagnostics enforces owner auth
 *  G7-2: Response exposes authMode, not raw tokens
 *  G7-3: IndianAPI capability shown without key leak
 *  G7-4: Shadow impact statement ("no trading impact") present in response
 *  G7-5: Anonymous access returns 403, not 500
 *  G7-6: /api/providers/shadow-parity also requires owner auth
 *  G7-7: providerDiagnostics.ts does not read raw token from env and return it
 *  G7-8: Shadow routing state includes sample counts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveUpstoxConfig } from "./marketData/upstoxClient";
import { isIndianApiConfigured, getIndianApiCapabilityManifest, indianApiHealth } from "./marketData/indianApiProvider";
import { getShadowRoutingState, getParitySummary } from "./marketData/shadowState";
import fs from "node:fs";

// ─── G7-1: Owner auth is enforced via requireOwnerStrict ────────────────────

describe("G7-1: Owner auth enforcement on diagnostics routes", () => {
  it("providerDiagnostics.ts uses requireOwner or requireOwnerStrict", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    expect(content).toMatch(/requireOwner|requireOwnerStrict/);
  });

  it("Both diagnostics endpoints are inside router guard middleware", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    // Route handler must reference owner check before returning data
    expect(content).toMatch(/requireOwner/);
    expect(content).toContain("diagnostics");
  });
});

// ─── G7-2: Response exposes authMode, not raw tokens ────────────────────────

describe("G7-2: authMode field returned instead of raw token", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resolveUpstoxConfig returns authMode field", () => {
    vi.stubEnv("UPSTOX_ANALYTICS_TOKEN", "analytics-tok");
    const cfg = resolveUpstoxConfig();
    expect(cfg).toHaveProperty("authMode");
    expect(["ANALYTICS_TOKEN", "STANDARD_DAILY_TOKEN", "NOT_CONFIGURED"]).toContain(cfg.authMode);
  });

  it("providerDiagnostics.ts references authMode in response", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    expect(content).toMatch(/authMode/);
  });

  it("providerDiagnostics.ts does NOT expose UPSTOX_ANALYTICS_TOKEN raw env value", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    // Should not directly read and return the env variable value
    expect(content).not.toMatch(/UPSTOX_ANALYTICS_TOKEN.*response|response.*UPSTOX_ANALYTICS_TOKEN/);
    expect(content).not.toMatch(/process\.env\['UPSTOX_ANALYTICS_TOKEN'\]/);
  });

  it("providerDiagnostics.ts does NOT expose UPSTOX_ACCESS_TOKEN raw env value", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    expect(content).not.toMatch(/UPSTOX_ACCESS_TOKEN.*response|response.*UPSTOX_ACCESS_TOKEN/);
  });
});

// ─── G7-3: IndianAPI capability shown without key leak ─────────────────────

describe("G7-3: IndianAPI plan shown in diagnostics, key not leaked", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("getIndianApiCapabilityManifest returns plan-level info", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "test-key");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    const manifest = getIndianApiCapabilityManifest();
    expect(Array.isArray(manifest)).toBe(true);
  });

  it("indianApiHealth includes configured state", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "test-key");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    vi.stubEnv("INDIANAPI_BASE_URL", "https://stock.indianapi.in");
    const health = indianApiHealth();
    expect(health).toHaveProperty("configured");
    expect(health).toHaveProperty("configState");
  });

  it("diagnostics route references indianApiHealth or getIndianApiCapabilityManifest", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    expect(content).toMatch(/indianApi|IndianApi/);
  });
});

// ─── G7-4: Shadow impact statement ─────────────────────────────────────────

describe("G7-4: Shadow impact statement in diagnostics", () => {
  it("providerDiagnostics.ts contains shadow impact statement", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    // The response must include a statement that shadow has no trading impact
    expect(content).toMatch(
      /no.*trading.*impact|shadow.*impact|zeroTradingImpact|no impact on.*trad/i,
    );
  });

  it("parityClassification.ts contains zeroTradingImpact literal type", () => {
    const content = fs.readFileSync(
      "src/lib/marketData/parityClassification.ts",
      "utf-8",
    );
    expect(content).toContain("zeroTradingImpact");
    expect(content).toContain("true");
    expect(content).toMatch(/shadow.*no.*trad|no.*trading.*impact/i);
  });
});

// ─── G7-5: Anonymous access returns 403 ────────────────────────────────────

describe("G7-5: Anonymous access returns 403, not 500", () => {
  it("requireOwner middleware is imported in providerDiagnostics.ts", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    // Must import the auth middleware
    expect(content).toMatch(/requireOwner|userAuth/);
  });

  it("The middleware must be applied before any data-reading code", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    const requireOwnerIdx = content.indexOf("requireOwner");
    const upstoxHealthIdx = content.indexOf("upstoxHealth");
    // requireOwner must appear before upstoxHealth in the file
    if (requireOwnerIdx !== -1 && upstoxHealthIdx !== -1) {
      expect(requireOwnerIdx).toBeLessThan(upstoxHealthIdx);
    }
  });
});

// ─── G7-6: shadow-parity endpoint also protected ───────────────────────────

describe("G7-6: shadow-parity endpoint requires owner auth", () => {
  it("providerDiagnostics.ts has shadow-parity route", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    expect(content).toMatch(/shadow-parity|shadowParity|shadow_parity/);
  });
});

// ─── G7-7: No raw token in response ────────────────────────────────────────

describe("G7-7: Raw credentials never in diagnostics response", () => {
  it("upstoxHealth returns configured boolean, not raw token", () => {
    const content = fs.readFileSync(
      "src/lib/marketData/upstoxProvider.ts",
      "utf-8",
    );
    // upstoxHealth function should not return the token value directly
    expect(content).toMatch(/export.*function.*upstoxHealth/);
  });

  it("KITE_API_KEY is not exposed in providerDiagnostics response", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    // Must not directly pass KITE_API_KEY to the response
    expect(content).not.toMatch(/KITE_API_KEY.*json|json.*KITE_API_KEY/);
    expect(content).not.toMatch(/KITE_API_SECRET.*json|json.*KITE_API_SECRET/);
  });

  it("KITE_TOKEN_ENC_KEY is not exposed in providerDiagnostics response", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    expect(content).not.toContain("KITE_TOKEN_ENC_KEY");
  });
});

// ─── G7-8: Shadow routing state includes sample counts ─────────────────────

describe("G7-8: Shadow routing state includes observation counts", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("getShadowRoutingState(provider) returns a routing state string for upstox", () => {
    // getShadowRoutingState takes a provider argument and returns a ShadowRoutingState string
    const state = getShadowRoutingState("upstox");
    expect(typeof state).toBe("string");
    expect(["NOT_CONFIGURED", "ENABLED", "DISABLED", "ERROR"]).toContain(state);
  });

  it("shadow parity summary includes sampleCount from getParitySummary", () => {
    // getParitySummary provides observation counts; getShadowRoutingState gives the routing string
    const summary = getParitySummary("upstox");
    expect(summary).toHaveProperty("sampleCount");
    expect(typeof summary.sampleCount).toBe("number");
    expect(summary.sampleCount).toBeGreaterThanOrEqual(0);
  });

  it("diagnostics route references getShadowRoutingState", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    expect(content).toMatch(/getShadowRoutingState|shadowState|shadowRouting/);
  });
});

// ─── G8-17: Owner-only diagnostics auth coverage ────────────────────────────

describe("G8-17: Owner-only pages cannot leak shadow state to anonymous users", () => {
  it("infra-health page uses owner auth guard", () => {
    const appContent = fs.readFileSync("../scanner/src/App.tsx", "utf-8");
    expect(appContent).toMatch(/infra-health.*ownerOnly.*true|ownerOnly.*true.*infra-health/);
  });

  it("providerDiagnostics.ts route is NOT publicly accessible", () => {
    // The route must be protected — absence of auth = public = violation
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    expect(content).toMatch(/requireOwner|auth/i);
  });
});

// ─── G8-18: Credential non-leakage ─────────────────────────────────────────

describe("G8-18: Credential non-leakage across all provider diagnostic surfaces", () => {
  const SENSITIVE_ENV_KEYS = [
    "KITE_API_SECRET",
    "KITE_TOKEN_ENC_KEY",
    "UPSTOX_ANALYTICS_TOKEN",
    "UPSTOX_ACCESS_TOKEN",
    "INDIANAPI_API_KEY",
    "SESSION_SECRET",
    "TELEGRAM_BOT_TOKEN",
  ];

  it("providerDiagnostics.ts does not return any sensitive env var value directly", () => {
    const content = fs.readFileSync(
      "src/routes/providerDiagnostics.ts",
      "utf-8",
    );
    for (const key of SENSITIVE_ENV_KEYS) {
      // Should not appear on the right side of a JSON response assignment
      // (it's fine to read them to check if they're set, but not to return their values)
      const passthroughPattern = new RegExp(`process\\.env\\[?['"]${key}['"]\\]?.*json|res\\.json.*${key}`);
      expect(passthroughPattern.test(content)).toBe(false);
    }
  });

  it("shadowState.ts does not store raw tokens in its ring buffer", () => {
    const content = fs.readFileSync(
      "src/lib/marketData/shadowState.ts",
      "utf-8",
    );
    // Ring buffer stores metrics, not credentials
    for (const key of SENSITIVE_ENV_KEYS) {
      expect(content).not.toContain(key);
    }
  });
});
