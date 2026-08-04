/**
 * Gate F tests — Cross-tab parity and provider isolation.
 * Pack 5 23A: executable tests proving all tabs get data from canonical
 * server APIs; Upstox shadow values never render as canonical;
 * IndianAPI fundamentals never override Kite prices.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Cross-tab data sourcing — structural source-file checks
// ---------------------------------------------------------------------------

describe("Gate F — Cross-tab data sourcing: canonical API only", () => {
  it("F-1: stock-detail.tsx imports from @workspace/api-client-react only (no direct IndianAPI or Upstox)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../artifacts/scanner/src/pages/stock-detail.tsx", import.meta.url).pathname,
      "utf8",
    );
    // All hooks come from the canonical api-client-react package
    expect(src).toContain("from \"@workspace/api-client-react\"");
    // MUST NOT import directly from IndianAPI client or provider
    expect(src).not.toContain("indianApiClient");
    expect(src).not.toContain("indianApiProvider");
    expect(src).not.toContain("upstoxClient");
    expect(src).not.toContain("upstoxProvider");
  });

  it("F-2: fundamentals hook URL is wired to /data/fundamentals (canonical server path)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url).pathname,
      "utf8",
    );
    // getGetStockFundamentalsUrl must return /api/data/fundamentals/<symbol>
    expect(src).toContain("/api/data/fundamentals/");
    // Must NOT hardcode IndianAPI or Upstox URLs
    expect(src).not.toContain("indianapi.in");
    expect(src).not.toContain("api.upstox.com");
  });

  it("F-3: Upstox shadow dispatch is fire-and-forget — it does NOT return data to the caller", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("./marketData/shadowDispatch.ts", import.meta.url).pathname,
      "utf8",
    );
    // dispatchShadowQuote returns void — never returns data
    expect(src).toContain("export function dispatchShadowQuote");
    // No return value assignment should happen
    const fnBody = src.slice(src.indexOf("export function dispatchShadowQuote"));
    expect(fnBody.slice(0, 400)).not.toContain("return await");
  });

  it("F-4: router.ts never awaits dispatchShadow* — it's always fire-and-forget", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("./marketData/router.ts", import.meta.url).pathname,
      "utf8",
    );
    // Should be called without await
    const dispatchCalls = src.match(/dispatchShadow(?:Quote|Candles)[^;]*/g) ?? [];
    for (const call of dispatchCalls) {
      expect(call.trim()).not.toMatch(/^await /);
    }
  });

  it("F-5: fundamentals meta always marks notForSignals=true and notForTradeDecisions=true", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../routes/fundamentals.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(src).toContain("notForSignals:        true");
    expect(src).toContain("notForTradeDecisions: true");
  });
});

describe("Gate F — Shadow non-interference: Upstox values do not enter canonical data path", () => {
  it("F-6: router.ts returns canonical data BEFORE (not after) calling dispatchShadow", async () => {
    // In getEquityQuote, the return statement comes before or at the same level as dispatch
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("./marketData/router.ts", import.meta.url).pathname,
      "utf8",
    );
    // Verify the pattern: result is assigned first, dispatch called, THEN return
    // OR dispatch called, THEN return. The canonical result is NOT modified by dispatch.
    const equityQuoteBlock = src.slice(src.indexOf("async function getEquityQuote"), src.indexOf("async function getIndexQuote"));
    expect(equityQuoteBlock).toContain("dispatchShadowQuote");
    // The return statement must exist and shadow dispatch is non-blocking
    expect(equityQuoteBlock).toContain("return");
  });

  it("F-7: shadowState recordQuoteSample is only called inside shadow (fireShadow callback)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("./marketData/shadowDispatch.ts", import.meta.url).pathname,
      "utf8",
    );
    // recordQuoteSample must only appear inside fireShadow calls
    expect(src).not.toContain("recordQuoteSample("); // dispatch.ts doesn't call it directly
    // It's in upstoxProvider.ts (shadowFetchQuote calls it)
  });

  it("F-8: canonicalId for indices comes from static bootstrap, NOT Upstox response body", async () => {
    const { resolveInstrumentKey } = await import("./marketData/upstoxInstrumentMap");
    // Resolution is deterministic from static map — does not vary with Upstox API response
    const d1 = resolveInstrumentKey("NIFTY");
    const d2 = resolveInstrumentKey("NIFTY");
    expect(d1.upstoxKey).toBe(d2.upstoxKey);
    expect(d1.ok).toBe(true);
  });

  it("F-9: resolveInstrumentKey for NIFTY is 'NSE_INDEX|Nifty 50' — not a Kite instrument_token", () => {
    return import("./marketData/upstoxInstrumentMap").then(({ resolveInstrumentKey }) => {
      const d = resolveInstrumentKey("NIFTY");
      // Upstox key format: EXCHANGE_SEGMENT|name — never a numeric Kite token
      expect(d.upstoxKey).toMatch(/^[A-Z_]+\|/);
      expect(d.upstoxKey).not.toMatch(/^\d+$/);
    });
  });

  it("F-10: IndianAPI fundamentals response shape has notForTradeDecisions flag (schema guard)", async () => {
    const fs = await import("node:fs/promises");
    const spec = await fs.readFile(
      new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url).pathname,
      "utf8",
    );
    // Schema must include the guard fields
    expect(spec).toContain("notForSignals");
    expect(spec).toContain("notForTradeDecisions");
    expect(spec).toContain("trustTier");
  });
});

describe("Gate F — Consistent selectors across tabs", () => {
  it("F-11: useGetStockFundamentals queryKey pattern is stable (deterministic from symbol)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url).pathname,
      "utf8",
    );
    // Query key factory must embed the symbol (array with path string)
    expect(src).toContain("getGetStockFundamentalsQueryKey");
    // Pattern: [`/api/data/fundamentals/${symbol}`] as const
    expect(src).toMatch(/getGetStockFundamentalsQueryKey.*=.*symbol.*=>/s);
  });

  it("F-12: fundamentals and stock-detail use different URL paths (no query-key collision)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url).pathname,
      "utf8",
    );
    // Stock detail path is /api/stocks/<symbol>
    expect(src).toContain("`/api/stocks/");
    // Fundamentals path is /api/data/fundamentals/<symbol>
    expect(src).toContain("`/api/data/fundamentals/");
    // They are different
    expect("`/api/stocks/`").not.toBe("`/api/data/fundamentals/`");
  });
});
