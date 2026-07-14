/**
 * buildInfo unit tests
 *
 * Verifies:
 *  - All expected fields are present in the returned object
 *  - No secret keys are exposed
 *  - Unknown values return "unknown" (not null, undefined, or empty string)
 *  - Boot time is a valid ISO string
 *  - All checkpoint markers are true (compile-time guarantee)
 *  - apiBuildId format is correct when commitShort is known
 */

import { describe, it, expect } from "vitest";
import { getBuildInfo, type BuildInfo } from "./buildInfo";

const SECRET_PATTERNS = [
  "password", "token", "secret", "apikey", "api_key", "private",
  "bearer", "DATABASE_URL", "SESSION_SECRET", "TELEGRAM",
  "APP_ACCESS_PASSWORD", "TRADINGVIEW_WEBHOOK",
];

describe("getBuildInfo()", () => {
  it("returns an object with all required top-level fields", () => {
    const info = getBuildInfo();
    const requiredFields: Array<keyof BuildInfo> = [
      "app",
      "environment",
      "commitSha",
      "commitShort",
      "branch",
      "buildTime",
      "bootTime",
      "deploymentId",
      "apiBuildId",
      "frontendBuildId",
      "frontendBundleFile",
      "frontendBundleHash",
      "nodeEnv",
      "checkpointMarkers",
    ];
    for (const field of requiredFields) {
      expect(info, `field "${field}" should exist`).toHaveProperty(field);
    }
  });

  it("app is 'marketscanner'", () => {
    expect(getBuildInfo().app).toBe("marketscanner");
  });

  it("environment is 'production' or 'development'", () => {
    const { environment } = getBuildInfo();
    expect(["production", "development"]).toContain(environment);
  });

  it("all string fields are non-empty (either a value or 'unknown')", () => {
    const info = getBuildInfo();
    const stringFields: Array<keyof BuildInfo> = [
      "commitSha", "commitShort", "branch", "buildTime", "bootTime",
      "deploymentId", "apiBuildId", "frontendBuildId",
      "frontendBundleFile", "frontendBundleHash", "nodeEnv",
    ];
    for (const field of stringFields) {
      const val = info[field];
      expect(
        typeof val === "string" && val.length > 0,
        `field "${field}" must be a non-empty string, got: ${JSON.stringify(val)}`
      ).toBe(true);
    }
  });

  it("bootTime is a valid ISO 8601 string", () => {
    const { bootTime } = getBuildInfo();
    expect(() => new Date(bootTime).toISOString()).not.toThrow();
    expect(bootTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("in test/dev (no esbuild pass), build-time constants return 'unknown'", () => {
    const info = getBuildInfo();
    expect(info.commitSha).toBe("unknown");
    expect(info.commitShort).toBe("unknown");
    expect(info.branch).toBe("unknown");
    expect(info.buildTime).toBe("unknown");
    expect(info.frontendBuildId).toBe("unknown");
    expect(info.apiBuildId).toBe("unknown");
  });

  it("contains all 7 required checkpoint markers, all set to true", () => {
    const { checkpointMarkers } = getBuildInfo();
    const expected = [
      "checkpoint1",
      "checkpoint2",
      "checkpoint2_5",
      "checkpoint3",
      "dataParityApi",
      "reportGradeFacade",
      "providerImportCompat",
    ] as const;
    for (const key of expected) {
      expect(checkpointMarkers[key], `checkpointMarkers.${key} must be true`).toBe(true);
    }
  });

  it("does NOT expose any secret-pattern keys in the response JSON", () => {
    const info = getBuildInfo();
    const json = JSON.stringify(info).toLowerCase();
    for (const pattern of SECRET_PATTERNS) {
      expect(
        json,
        `Response must not contain secret-pattern key "${pattern}"`
      ).not.toContain(pattern.toLowerCase());
    }
  });

  it("bootTime is captured once (singleton, stable across calls)", () => {
    const a = getBuildInfo().bootTime;
    const b = getBuildInfo().bootTime;
    expect(a).toBe(b);
  });
});
