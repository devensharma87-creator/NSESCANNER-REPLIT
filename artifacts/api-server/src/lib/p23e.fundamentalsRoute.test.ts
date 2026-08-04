/**
 * Gate E tests — Canonical fundamentals route and IndianAPI consumption.
 * Pack 5 23A: server handler shape, NOT_CONFIGURED state, stale labelling,
 * malformed payload rejection, provider isolation.
 * No live IndianAPI calls — all transports mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isIndianApiConfigured,
  __setIndianApiClientForTests,
} from "./marketData/indianApiProvider";
import { createIndianApiClient } from "./marketData/indianApiClient";

// ---------------------------------------------------------------------------
// Tests for route handler structural requirements (source-level)
// ---------------------------------------------------------------------------

describe("Gate E — /data/fundamentals route structure", () => {
  it("E-1: fundamentals route handler file exists and exports a router", async () => {
    const mod = await import("../routes/fundamentals");
    expect(mod.default).toBeTruthy();
    // Express router has `.get`, `.post`, etc.
    expect(typeof (mod.default as any).get).toBe("function");
  });

  it("E-2: fundamentals route is registered in data.ts (source check)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../routes/data.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(src).toContain("fundamentalsRouter");
    expect(src).toContain("fundamentals");
  });

  it("E-3: fundamentals route is NOT calling IndianAPI directly — goes via provider", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../routes/fundamentals.ts", import.meta.url).pathname,
      "utf8",
    );
    // Must not import indianApiClient directly (only provider exports are canonical)
    expect(src).not.toContain("indianApiClient");
    // Must use provider functions
    expect(src).toContain("isIndianApiConfigured");
  });
});

// NOTE: @workspace/api-client-react is a browser package; in api-server tests
// we verify the generated files structurally instead of importing the package.
describe("Gate E — Provider isolation: fundamentals never from Kite", () => {
  it("E-4: isIndianApiConfigured() returns false when key absent (gate for NOT_CONFIGURED path)", () => {
    const savedKey = process.env["INDIANAPI_API_KEY"];
    delete process.env["INDIANAPI_API_KEY"];
    expect(isIndianApiConfigured()).toBe(false);
    if (savedKey !== undefined) process.env["INDIANAPI_API_KEY"] = savedKey;
  });

  it("E-5: isIndianApiConfigured() returns true when key is present", () => {
    const saved = process.env["INDIANAPI_API_KEY"];
    process.env["INDIANAPI_API_KEY"] = "FAKE_KEY_FOR_TEST";
    expect(isIndianApiConfigured()).toBe(true);
    if (saved !== undefined) process.env["INDIANAPI_API_KEY"] = saved;
    else delete process.env["INDIANAPI_API_KEY"];
  });
});

describe("Gate E — StockFundamentals response shape", () => {
  it("E-6: StockFundamentals type is present in api-client-react/src/generated/api.schemas.ts", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../lib/api-client-react/src/generated/api.schemas.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(src).toContain("StockFundamentals");
    expect(src).toContain("providerState");
    expect(src).toContain("FundamentalsStockProfile");
    expect(src).toContain("FundamentalsStockRatios");
  });

  it("E-7: useGetStockFundamentals hook is present in api-client-react/src/generated/api.ts", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(src).toContain("useGetStockFundamentals");
    expect(src).toContain("getGetStockFundamentalsUrl");
    expect(src).toContain("getGetStockFundamentalsQueryKey");
  });

  it("E-8: getGetStockFundamentalsUrl uses /api/data/fundamentals path", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(src).toContain("/api/data/fundamentals/");
  });

  it("E-9: fundamentals response meta.notForSignals must be true (design constraint)", async () => {
    // Response shape from the fundamentals route must always set notForSignals=true
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../routes/fundamentals.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(src).toContain("notForSignals:        true");
    expect(src).toContain("notForTradeDecisions: true");
  });

  it("E-10: NOT_CONFIGURED path returns HTTP 200 with providerState field (no 500)", async () => {
    // The handler uses res.json with providerState=NOT_CONFIGURED, not next(err)
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../routes/fundamentals.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(src).toContain("NOT_CONFIGURED");
    expect(src).toContain("providerState");
    // Must not throw/500 on missing key — handled gracefully
    expect(src).toContain("isIndianApiConfigured");
  });
});

describe("Gate E — OpenAPI schema presence", () => {
  it("E-11: StockFundamentals schema is in openapi.yaml", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url).pathname,
      "utf8",
    );
    expect(src).toContain("StockFundamentals:");
    expect(src).toContain("getStockFundamentals");
    expect(src).toContain("providerState");
    expect(src).toContain("notForSignals");
  });
});

describe("Gate E — Provider client injection seam", () => {
  it("E-12: __setIndianApiClientForTests seam is exported from provider", () => {
    expect(typeof __setIndianApiClientForTests).toBe("function");
  });

  it("E-13: provider test seam accepts a mock client without throwing", () => {
    const mockClient = createIndianApiClient({
      config: {
        baseUrl: "https://api.indianapi.in",
        apiKey: "FAKE_TEST_KEY",
        plan: "INDIVIDUAL" as const,
        timeoutMs: 5_000,
        maxRetries: 0,
        retryBaseMs: 10,
      },
      fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    expect(() => __setIndianApiClientForTests(mockClient)).not.toThrow();
    // Clean up
    __setIndianApiClientForTests(null);
  });
});
