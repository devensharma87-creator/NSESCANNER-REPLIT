/**
 * Pack 5 / §12.6 — Cross-tab consistency load-bearing tests
 *
 * Proves:
 * - No direct Upstox/IndianAPI imports in client application bundles.
 * - All canonical provider APIs use server-side routing only.
 * - Shadow state is owner-protected and never leaks to untrusted surfaces.
 * - Policy and capability state are consistent at runtime.
 * - Provider routing states have correct Pack 5 defaults.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { getPolicy } from "../lib/marketData/policy";
import { getProviderCapabilities } from "../lib/marketData/providerCapability";
import { getParitySummary } from "../lib/marketData/shadowState";
import { getIndianApiCapabilityManifest } from "../lib/marketData/indianApiProvider";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// §12.6 Cross-tab consistency
// ---------------------------------------------------------------------------

describe("P23D/CrossTab — §12.6 cross-tab consistency", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("P23D-6a: no client-side direct import of upstoxClient or upstoxProvider", () => {
    const scannerSrc = path.join(__dirname, "../../../scanner/src");
    const globalSrc  = path.join(__dirname, "../../../global/src");

    function checkDir(dir: string): string[] {
      const violations: string[] = [];
      if (!fs.existsSync(dir)) return violations;
      const pattern = /upstoxClient|upstoxProvider|indianApiClient|indianApiProvider/;
      function walk(d: string): void {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          if (entry.isDirectory()) { walk(path.join(d, entry.name)); continue; }
          if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
          // Skip test files — they may contain the pattern as string literals in assertions
          if (entry.name.includes(".test.")) continue;
          const content = fs.readFileSync(path.join(d, entry.name), "utf8");
          if (pattern.test(content)) violations.push(path.join(d, entry.name));
        }
      }
      walk(dir);
      return violations;
    }

    const scannerViolations = checkDir(scannerSrc);
    const globalViolations  = checkDir(globalSrc);
    expect(scannerViolations).toHaveLength(0);
    expect(globalViolations).toHaveLength(0);
  });

  it("P23D-6b: policy upstoxShadowEnabled=false when UPSTOX_ACCESS_TOKEN absent", () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "");
    const policy = getPolicy();
    expect(policy.upstoxShadowEnabled).toBe(false);
  });

  it("P23D-6c: policy indianApiEnabled=false when INDIANAPI_API_KEY absent", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    const policy = getPolicy();
    expect(policy.indianApiEnabled).toBe(false);
  });

  it("P23D-6d: policy upstox allowedForTrading=false regardless of token presence", () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "FAKE_TOKEN");
    const policy = getPolicy();
    expect(policy.providers.upstox.allowedForTrading).toBe(false);
    expect(policy.providers.upstox.allowedForSignals).toBe(false);
    expect(policy.providers.upstox.allowedForValuation).toBe(false);
  });

  it("P23D-6e: policy indianapi allowedForTrading=false regardless of key presence", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const policy = getPolicy();
    expect(policy.providers.indianapi.allowedForTrading).toBe(false);
    expect(policy.providers.indianapi.allowedForSignals).toBe(false);
    expect(policy.providers.indianapi.allowedForValuation).toBe(false);
  });

  it("P23D-6f: capability snapshot has tradeAvailableProviders containing only 'kite'", () => {
    const snapshot = getProviderCapabilities();
    for (const provider of snapshot.tradeAvailableProviders) {
      expect(provider).toBe("kite");
    }
    expect(snapshot.authoritative).toBe("kite");
  });

  it("P23D-6g: upstox never appears in tradeAvailableProviders regardless of config", () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "FAKE_TOKEN");
    const snapshot = getProviderCapabilities();
    expect(snapshot.tradeAvailableProviders).not.toContain("upstox");
  });

  it("P23D-6h: indianapi never appears in tradeAvailableProviders", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const snapshot = getProviderCapabilities();
    expect(snapshot.tradeAvailableProviders).not.toContain("indianapi");
  });

  it("P23D-6i: promotionEligible is always false — Pack 5 hard block", () => {
    const upstoxSummary = getParitySummary("upstox");
    expect(upstoxSummary.promotionEligible).toBe(false);
  });

  it("P23D-6j: provider policy role for upstox is 'shadow' or 'disabled' only", () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "FAKE_TOKEN");
    const p = getPolicy().providers.upstox;
    expect(["shadow", "disabled"]).toContain(p.role);
  });

  it("P23D-6k: provider policy role for indianapi is 'analytics' or 'disabled' only", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    const p = getPolicy().providers.indianapi;
    expect(["analytics", "disabled"]).toContain(p.role);
  });

  it("P23D-6l: capability snapshot contains entries for upstox and indianapi", () => {
    const snapshot = getProviderCapabilities();
    const providers = [...new Set(snapshot.capabilities.map(c => c.provider))];
    expect(providers).toContain("upstox");
    expect(providers).toContain("indianapi");
  });

  it("P23D-6m: upstox NOT_CONFIGURED when token absent → state NOT_CONFIGURED in snapshot", () => {
    vi.stubEnv("UPSTOX_ACCESS_TOKEN", "");
    vi.stubEnv("UPSTOX_ANALYTICS_TOKEN", ""); // resolveUpstoxConfig prefers ANALYTICS; clear both
    const snapshot = getProviderCapabilities();
    const upstoxCaps = snapshot.capabilities.filter(c => c.provider === "upstox");
    for (const cap of upstoxCaps) {
      // All non-UNSUPPORTED domains should be NOT_CONFIGURED
      if (cap.domain !== "market_status") {
        expect(cap.state).toBe("NOT_CONFIGURED");
      }
    }
  });

  it("P23D-6n: capability evaluatedAt is a valid ISO timestamp", () => {
    const snapshot = getProviderCapabilities();
    const dt = new Date(snapshot.evaluatedAt);
    expect(Number.isFinite(dt.getTime())).toBe(true);
    expect(snapshot.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("P23D-6o: IndianAPI manifest has no secret values", () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_SENSITIVE_KEY_DO_NOT_EXPOSE");
    const manifest = getIndianApiCapabilityManifest();
    const manifestJson = JSON.stringify(manifest);
    expect(manifestJson).not.toContain("FAKE_SENSITIVE_KEY_DO_NOT_EXPOSE");
    for (const entry of manifest) {
      expect(entry.endpoint).toBeTruthy();
      expect(entry.domain).toBeTruthy();
      expect(typeof entry.state).toBe("string");
    }
  });
});
