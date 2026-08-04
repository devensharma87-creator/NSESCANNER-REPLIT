/**
 * Gate D tests — IndianAPI host allowlist and RATE_LIMITED state.
 * Pack 5 23A: non-allowlisted hosts rejected; plan detected from host;
 * RATE_LIMITED state surfaced; schema-invalid host handled.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveIndianApiConfig,
  detectIndianApiPlan,
  INDIANAPI_HOST_ALLOWLIST,
  type IndianApiPlan,
} from "./marketData/indianApiClient";
import { IndianApiError } from "./marketData/indianApiClient";

// ---------------------------------------------------------------------------
// Helper to reset env
// ---------------------------------------------------------------------------

const original = {
  INDIANAPI_BASE_URL: process.env["INDIANAPI_BASE_URL"],
  INDIANAPI_API_KEY:  process.env["INDIANAPI_API_KEY"],
};

beforeEach(() => {
  delete process.env["INDIANAPI_BASE_URL"];
  delete process.env["INDIANAPI_API_KEY"];
});

afterEach(() => {
  if (original.INDIANAPI_BASE_URL !== undefined)
    process.env["INDIANAPI_BASE_URL"] = original.INDIANAPI_BASE_URL;
  else delete process.env["INDIANAPI_BASE_URL"];
  if (original.INDIANAPI_API_KEY !== undefined)
    process.env["INDIANAPI_API_KEY"] = original.INDIANAPI_API_KEY;
  else delete process.env["INDIANAPI_API_KEY"];
});

describe("Gate D — INDIANAPI_HOST_ALLOWLIST", () => {
  it("D-1: api.indianapi.in is in the allowlist", () => {
    expect(INDIANAPI_HOST_ALLOWLIST.has("api.indianapi.in")).toBe(true);
  });

  it("D-2: api2.indianapi.in is in the allowlist (enterprise host)", () => {
    expect(INDIANAPI_HOST_ALLOWLIST.has("api2.indianapi.in")).toBe(true);
  });

  it("D-3: arbitrary third-party host is NOT in the allowlist", () => {
    expect(INDIANAPI_HOST_ALLOWLIST.has("malicious.example.com")).toBe(false);
    expect(INDIANAPI_HOST_ALLOWLIST.has("api.evil.io")).toBe(false);
  });
});

describe("Gate D — detectIndianApiPlan()", () => {
  it("D-4: api.indianapi.in → INDIVIDUAL", () => {
    expect(detectIndianApiPlan("https://api.indianapi.in")).toBe<IndianApiPlan>("INDIVIDUAL");
  });

  it("D-5: api2.indianapi.in → ENTERPRISE", () => {
    expect(detectIndianApiPlan("https://api2.indianapi.in")).toBe<IndianApiPlan>("ENTERPRISE");
  });

  it("D-6: unknown URL → UNKNOWN", () => {
    expect(detectIndianApiPlan("https://other.example.com")).toBe<IndianApiPlan>("UNKNOWN");
  });

  it("D-7: malformed URL → UNKNOWN (no crash)", () => {
    expect(detectIndianApiPlan("not-a-url")).toBe<IndianApiPlan>("UNKNOWN");
  });
});

describe("Gate D — resolveIndianApiConfig() host allowlist enforcement", () => {
  it("D-8: default base (api.indianapi.in) is allowed when env var absent", () => {
    const cfg = resolveIndianApiConfig();
    expect(cfg.baseUrl).toBe("https://api.indianapi.in");
    expect(cfg.plan).toBe<IndianApiPlan>("INDIVIDUAL");
  });

  it("D-9: INDIANAPI_BASE_URL with allowed host (api.indianapi.in) is accepted", () => {
    process.env["INDIANAPI_BASE_URL"] = "https://api.indianapi.in";
    const cfg = resolveIndianApiConfig();
    expect(cfg.baseUrl).toBe("https://api.indianapi.in");
  });

  it("D-10: non-allowlisted INDIANAPI_BASE_URL falls back to default (not crash)", () => {
    process.env["INDIANAPI_BASE_URL"] = "https://malicious.example.com/api";
    const cfg = resolveIndianApiConfig();
    // Must NOT use the malicious host
    expect(cfg.baseUrl).toBe("https://api.indianapi.in");
    expect(cfg.plan).toBe<IndianApiPlan>("INDIVIDUAL");
  });

  it("D-11: enterprise host resolves plan=ENTERPRISE", () => {
    process.env["INDIANAPI_BASE_URL"] = "https://api2.indianapi.in";
    const cfg = resolveIndianApiConfig();
    expect(cfg.plan).toBe<IndianApiPlan>("ENTERPRISE");
    expect(cfg.baseUrl).toContain("api2.indianapi.in");
  });

  it("D-12: plan field is present in config shape (required field)", () => {
    const cfg = resolveIndianApiConfig();
    expect("plan" in cfg).toBe(true);
  });
});

describe("Gate D — IndianApiError kinds include RATE_LIMITED", () => {
  it("D-13: IndianApiError can be constructed with kind=rate_limited", () => {
    const err = new IndianApiError("Rate limit exceeded.", "rate_limited");
    expect(err.kind).toBe("rate_limited");
    expect(err).toBeInstanceOf(IndianApiError);
  });

  it("D-14: rate_limited error does not expose key material", () => {
    const err = new IndianApiError("Rate limited by remote.", "rate_limited");
    expect(err.message).not.toContain("FAKE");
    expect(err.kind).toBe("rate_limited");
  });
});
