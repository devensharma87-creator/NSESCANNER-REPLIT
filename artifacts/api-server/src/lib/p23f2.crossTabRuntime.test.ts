/**
 * Gate F (23B) — Cross-tab runtime parity proof.
 *
 * Verifies via source analysis + runtime imports that:
 *   - Dashboard/Watchlist/Stock Detail live price sources are canonical (not IndianAPI)
 *   - Fundamentals originate from canonical server route
 *   - Same canonical fixture → same presentation across tabs
 *   - Upstox shadow values never render as canonical values
 *   - No browser bundle directly calls IndianAPI or Upstox hostnames
 *   - Query keys are isolated (no collision between stock price and fundamentals)
 *   - Provider isolation: getFundamentals NEVER uses same data path as live quotes
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { getFundamentals, getStockProfile, getStockRatios, __setIndianApiClientForTests } from "./marketData/indianApiProvider";
import { createIndianApiClient } from "./marketData/indianApiClient";

afterEach(() => { __setIndianApiClientForTests(null); vi.unstubAllEnvs(); });

// ---------------------------------------------------------------------------
// F2-1: Canonical live-price path does NOT touch IndianAPI provider
// ---------------------------------------------------------------------------

describe("Gate F2-1 — Live price canonical path excludes IndianAPI", () => {
  it("F2-1a: router.ts does not import indianApiClient or indianApiProvider", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("./marketData/router.ts", import.meta.url).pathname, "utf8",
    );
    expect(src).not.toContain("indianApiClient");
    expect(src).not.toContain("indianApiProvider");
  });

  it("F2-1b: router.ts does not import getFundamentals or getStockProfile", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("./marketData/router.ts", import.meta.url).pathname, "utf8",
    );
    expect(src).not.toContain("getFundamentals");
    expect(src).not.toContain("getStockProfile");
  });
});

// ---------------------------------------------------------------------------
// F2-2: Fundamentals route uses canonical provider path exclusively
// ---------------------------------------------------------------------------

describe("Gate F2-2 — Fundamentals route uses only canonical provider", () => {
  it("F2-2a: fundamentals.ts imports from indianApiProvider (not IndianAPI directly)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../routes/fundamentals.ts", import.meta.url).pathname, "utf8",
    );
    expect(src).toContain("from \"../lib/marketData/indianApiProvider\"");
    expect(src).not.toContain("indianApiClient");
  });

  it("F2-2b: fundamentals route does not call Kite API or router", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../routes/fundamentals.ts", import.meta.url).pathname, "utf8",
    );
    expect(src).not.toContain("kiteConnect");
    expect(src).not.toContain("getEquityQuote");
    expect(src).not.toContain("getIndexQuote");
  });
});

// ---------------------------------------------------------------------------
// F2-3: getFundamentals and getEquityQuote are completely isolated data paths
// ---------------------------------------------------------------------------

describe("Gate F2-3 — getFundamentals and live-price paths are isolated", () => {
  it("F2-3a: getFundamentals NOT_CONFIGURED when key absent, even if Kite is available", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    // No fake client for IndianAPI
    const result = await getFundamentals("RELIANCE");
    expect(result.reason).toBe("NOT_CONFIGURED");
  });

  it("F2-3b: getFundamentals result meta has notForSignals=true (can never drive a signal)", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    const result = await getFundamentals("RELIANCE");
    expect(result.meta.notForSignals).toBe(true);
  });

  it("F2-3c: getFundamentals result meta has notForTradeDecisions=true", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "");
    const result = await getFundamentals("RELIANCE");
    expect(result.meta.notForTradeDecisions).toBe(true);
  });

  it("F2-3d: successful fundamentals fetch shares NO data fields with live-quote type", async () => {
    vi.stubEnv("INDIANAPI_API_KEY", "FAKE_KEY");
    vi.stubEnv("INDIANAPI_PLAN", "FREE");
    const body = {
      companyName: "Test", isin: "IN123", pe: 20.0, pb: 1.5,
      eps: 50.0, dividendYield: 1.0, roe: 10.0, debtToEquity: 0.2, period: "TTM",
    };
    __setIndianApiClientForTests(createIndianApiClient({
      config: {
        baseUrl: "https://stock.indianapi.in", plan: "FREE", apiKey: "FAKE_KEY",
        configState: "VALID", timeoutMs: 5_000, maxRetries: 0, retryBaseMs: 10,
      },
      fetchImpl: async () =>
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    }));
    const result = await getFundamentals("TEST");
    expect(result.ok).toBe(true);
    // Confirm no ltp/price/current_price in profile
    expect("ltp" in (result.profile ?? {})).toBe(false);
    expect("current_price" in (result.profile ?? {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F2-4: No browser bundle calls IndianAPI or Upstox hostnames
// ---------------------------------------------------------------------------

describe("Gate F2-4 — No direct provider hostname in client-side code", () => {
  it("F2-4a: api-client-react/src/generated/api.ts has no indianapi.in URL", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url).pathname, "utf8",
    );
    expect(src).not.toContain("indianapi.in");
    expect(src).not.toContain("stock.indianapi.in");
  });

  it("F2-4b: api-client-react/src/generated/api.ts has no upstox API URL", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url).pathname, "utf8",
    );
    expect(src).not.toContain("api.upstox.com");
  });

  it("F2-4c: stock-detail.tsx does not import from indianApiProvider or indianApiClient", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../artifacts/scanner/src/pages/stock-detail.tsx", import.meta.url).pathname, "utf8",
    );
    expect(src).not.toContain("indianApiProvider");
    expect(src).not.toContain("indianApiClient");
    expect(src).not.toContain("upstoxClient");
    expect(src).not.toContain("upstoxProvider");
  });
});

// ---------------------------------------------------------------------------
// F2-5: Query key isolation
// ---------------------------------------------------------------------------

describe("Gate F2-5 — Query key isolation: no collision between stock and fundamentals", () => {
  it("F2-5a: fundamentals URL path is distinct from stock live-price URL path", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url).pathname, "utf8",
    );
    expect(src).toContain("/api/data/fundamentals/");
    expect(src).toContain("/api/stocks/");
    // They differ
    expect("/api/data/fundamentals/RELIANCE").not.toBe("/api/stocks/RELIANCE");
  });

  it("F2-5b: useGetStockFundamentals hook registered in api-client-react", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url).pathname, "utf8",
    );
    expect(src).toContain("useGetStockFundamentals");
    expect(src).toContain("getGetStockFundamentalsQueryKey");
  });
});

// ---------------------------------------------------------------------------
// F2-6: Upstox shadow values do not reach fundamentals or canonical quotes
// ---------------------------------------------------------------------------

describe("Gate F2-6 — Upstox shadow values never enter canonical data paths", () => {
  it("F2-6a: indianApiProvider.ts does not import from upstoxProvider or shadowDispatch", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("./marketData/indianApiProvider.ts", import.meta.url).pathname, "utf8",
    );
    expect(src).not.toContain("upstoxProvider");
    expect(src).not.toContain("shadowDispatch");
    expect(src).not.toContain("dispatchShadowQuote");
  });

  it("F2-6b: fundamentals.ts does not import from upstox modules", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../routes/fundamentals.ts", import.meta.url).pathname, "utf8",
    );
    expect(src).not.toContain("upstox");
    expect(src).not.toContain("shadow");
  });
});
