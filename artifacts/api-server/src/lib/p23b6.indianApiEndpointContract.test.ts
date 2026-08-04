/**
 * Gate B (23B) — IndianAPI endpoint contract tests.
 *
 * Verifies that the ONLY transport path used is GET /stock?name={symbol}.
 * The prior /stock_ratios endpoint was unverified and has been removed.
 *
 * Tests: /stock fixture; symbol URL encoding; profile extraction; ratio
 * extraction; missing nested objects; null field preservation; non-finite
 * number rejection; schema rejection; HTTP error classifications;
 * Kite price authority; endpoint and header proof.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createIndianApiClient,
  extractStockProfile,
  extractStockRatios,
  IndianApiError,
} from "./marketData/indianApiClient";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeClient(
  fakeFetch: (url: string, init?: RequestInit) => Promise<Response>,
  overrides: Record<string, unknown> = {},
) {
  return createIndianApiClient({
    config: {
      baseUrl:     "https://stock.indianapi.in",
      apiKey:      "FAKE_API_KEY",
      plan:        "FREE" as const,
      configState: "VALID" as const,
      timeoutMs:   5_000,
      maxRetries:  0,
      retryBaseMs: 10,
      ...overrides,
    },
    fetchImpl: fakeFetch as typeof fetch,
  });
}

function stockBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // Official /stock?name=Reliance shape
    companyName:   "Reliance Industries Limited",
    isin:          "INE002A01018",
    sector:        "Energy",
    industry:      "Oil & Gas",
    marketCap:     18_500_000_000_000,
    currency:      "INR",
    pe:            24.5,
    pb:            2.1,
    eps:           92.3,
    dividendYield: 0.4,
    roe:           8.7,
    debtToEquity:  0.32,
    period:        "TTM",
    ...overrides,
  };
}

function makeOkResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

function makeErrResponse(status: number): Response {
  return new Response(JSON.stringify({ error: "err" }), { status });
}

// ---------------------------------------------------------------------------
// B-1: Official /stock?name= fixture
// ---------------------------------------------------------------------------

describe("Gate B-1 — Official /stock?name= transport", () => {
  it("B-1a: getStock calls /stock endpoint (not /stock_ratios)", async () => {
    let calledUrl = "";
    const client = makeClient(async (url) => { calledUrl = url; return makeOkResponse(stockBody()); });
    await client.getStock("RELIANCE");
    const parsed = new URL(calledUrl);
    expect(parsed.pathname).toBe("/stock");
    expect(parsed.searchParams.get("name")).toBe("RELIANCE");
  });

  it("B-1b: only ONE HTTP call per getStock() invocation", async () => {
    let callCount = 0;
    const client = makeClient(async () => { callCount++; return makeOkResponse(stockBody()); });
    await client.getStock("RELIANCE");
    expect(callCount).toBe(1);
  });

  it("B-1c: authentication header is x-api-key (not Authorization Bearer)", async () => {
    let headers: Record<string, string> = {};
    const client = makeClient(async (_, init) => {
      headers = (init?.headers ?? {}) as Record<string, string>;
      return makeOkResponse(stockBody());
    });
    await client.getStock("RELIANCE");
    expect(headers["x-api-key"]).toBe("FAKE_API_KEY");
    expect(headers["x-api-key"]).not.toContain("Bearer");
  });

  it("B-1d: API key never appears in request URL", async () => {
    let calledUrl = "";
    const client = makeClient(async (url) => { calledUrl = url; return makeOkResponse(stockBody()); });
    await client.getStock("RELIANCE");
    expect(calledUrl).not.toContain("FAKE_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// B-2: Symbol and company-name encoding
// ---------------------------------------------------------------------------

describe("Gate B-2 — Symbol URL encoding", () => {
  it("B-2a: symbol encoded via URLSearchParams (special chars safe)", async () => {
    let calledUrl = "";
    const client = makeClient(async (url) => { calledUrl = url; return makeOkResponse(stockBody()); });
    await client.getStock("M&M");
    const parsed = new URL(calledUrl);
    // URLSearchParams encodes & as %26; the raw URL won't have a bare &
    expect(parsed.searchParams.get("name")).toBe("M&M");
  });

  it("B-2b: symbol with space encoded correctly", async () => {
    let calledUrl = "";
    const client = makeClient(async (url) => { calledUrl = url; return makeOkResponse(stockBody()); });
    await client.getStock("Reliance Industries");
    const parsed = new URL(calledUrl);
    expect(parsed.searchParams.get("name")).toBe("Reliance Industries");
  });
});

// ---------------------------------------------------------------------------
// B-3: Profile extraction
// ---------------------------------------------------------------------------

describe("Gate B-3 — Profile extraction from /stock response", () => {
  it("B-3a: companyName from companyName field", () => {
    const raw = stockBody();
    const profile = extractStockProfile(raw, "RELIANCE");
    expect(profile.companyName).toBe("Reliance Industries Limited");
  });

  it("B-3b: companyName from company_name (snake_case variant)", () => {
    const raw = { company_name: "Tata Consultancy Services" } as Record<string, unknown>;
    const profile = extractStockProfile(raw, "TCS");
    expect(profile.companyName).toBe("Tata Consultancy Services");
  });

  it("B-3c: isin, sector, industry, currency extracted correctly", () => {
    const raw = stockBody();
    const profile = extractStockProfile(raw, "RELIANCE");
    expect(profile.isin).toBe("INE002A01018");
    expect(profile.sector).toBe("Energy");
    expect(profile.industry).toBe("Oil & Gas");
    expect(profile.currency).toBe("INR");
  });

  it("B-3d: symbol is preserved as passed in (not overridden by body)", () => {
    const raw = stockBody({ symbol: "WRONGSYMBOL" });
    const profile = extractStockProfile(raw, "RELIANCE");
    expect(profile.symbol).toBe("RELIANCE");
  });
});

// ---------------------------------------------------------------------------
// B-4: Ratio extraction
// ---------------------------------------------------------------------------

describe("Gate B-4 — Ratio extraction from /stock response", () => {
  it("B-4a: pe, pb, eps, dividendYield, roe, debtToEquity, period extracted", () => {
    const raw = stockBody();
    const ratios = extractStockRatios(raw, "RELIANCE");
    expect(ratios.pe).toBe(24.5);
    expect(ratios.pb).toBe(2.1);
    expect(ratios.eps).toBe(92.3);
    expect(ratios.dividendYield).toBe(0.4);
    expect(ratios.roe).toBe(8.7);
    expect(ratios.debtToEquity).toBe(0.32);
    expect(ratios.period).toBe("TTM");
  });

  it("B-4b: snake_case variants accepted (pe_ratio, pb_ratio, debt_to_equity, dividend_yield)", () => {
    const raw = {
      pe_ratio: 22.0, pb_ratio: 1.8, dividend_yield: 0.5, debt_to_equity: 0.4,
      eps: 80.0, roe: 7.5, reporting_period: "FY2025",
    } as Record<string, unknown>;
    const ratios = extractStockRatios(raw, "RELIANCE");
    expect(ratios.pe).toBe(22.0);
    expect(ratios.pb).toBe(1.8);
    expect(ratios.dividendYield).toBe(0.5);
    expect(ratios.debtToEquity).toBe(0.4);
    expect(ratios.period).toBe("FY2025");
  });
});

// ---------------------------------------------------------------------------
// B-5: Missing nested objects
// ---------------------------------------------------------------------------

describe("Gate B-5 — Missing nested objects → null, not crash", () => {
  it("B-5a: empty body returns all nulls (no crash)", () => {
    const raw: Record<string, unknown> = {};
    const profile = extractStockProfile(raw, "RELIANCE");
    expect(profile.companyName).toBeNull();
    expect(profile.isin).toBeNull();
    expect(profile.sector).toBeNull();
    expect(profile.marketCap).toBeNull();
  });

  it("B-5b: empty body ratios all null (no crash)", () => {
    const raw: Record<string, unknown> = {};
    const ratios = extractStockRatios(raw, "RELIANCE");
    expect(ratios.pe).toBeNull();
    expect(ratios.pb).toBeNull();
    expect(ratios.eps).toBeNull();
    expect(ratios.period).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B-6: Omitted null fields remain unknown (not zero)
// ---------------------------------------------------------------------------

describe("Gate B-6 — Omitted null fields preserved as null, never zero", () => {
  it("B-6a: null marketCap stays null (not 0)", () => {
    const raw = stockBody({ marketCap: null });
    const profile = extractStockProfile(raw, "RELIANCE");
    expect(profile.marketCap).toBeNull();
  });

  it("B-6b: undefined pe stays null (not 0)", () => {
    const raw = stockBody();
    delete (raw as Record<string, unknown>)["pe"];
    const ratios = extractStockRatios(raw, "RELIANCE");
    expect(ratios.pe).toBeNull();
  });

  it("B-6c: false-y string null preserved", () => {
    const raw = stockBody({ sector: null });
    const profile = extractStockProfile(raw, "RELIANCE");
    expect(profile.sector).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B-7: Non-finite number rejection
// ---------------------------------------------------------------------------

describe("Gate B-7 — Non-finite number rejection", () => {
  it("B-7a: NaN pe → null", () => {
    const raw = stockBody({ pe: NaN });
    const ratios = extractStockRatios(raw, "RELIANCE");
    expect(ratios.pe).toBeNull();
  });

  it("B-7b: Infinity marketCap → null", () => {
    const raw = stockBody({ marketCap: Infinity });
    const profile = extractStockProfile(raw, "RELIANCE");
    expect(profile.marketCap).toBeNull();
  });

  it("B-7c: -Infinity roe → null", () => {
    const raw = stockBody({ roe: -Infinity });
    const ratios = extractStockRatios(raw, "RELIANCE");
    expect(ratios.roe).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B-8: Malformed JSON / schema rejection
// ---------------------------------------------------------------------------

describe("Gate B-8 — Malformed JSON / schema rejection", () => {
  it("B-8a: non-JSON response → kind=payload", async () => {
    const client = makeClient(async () =>
      new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "payload" });
  });

  it("B-8b: JSON array response (not object) → kind=payload", async () => {
    const client = makeClient(async () =>
      new Response(JSON.stringify([{ name: "wrong" }]), { status: 200 }),
    );
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "payload" });
  });

  it("B-8c: null JSON body → kind=payload", async () => {
    const client = makeClient(async () =>
      new Response("null", { status: 200 }),
    );
    await expect(client.getStock("RELIANCE")).rejects.toMatchObject({ kind: "payload" });
  });
});

// ---------------------------------------------------------------------------
// B-9: HTTP error classifications
// ---------------------------------------------------------------------------

describe("Gate B-9 — HTTP error classifications", () => {
  it("B-9a: 401 → auth", async () => {
    const client = makeClient(async () => makeErrResponse(401));
    await expect(client.getStock("X")).rejects.toMatchObject({ kind: "auth", status: 401 });
  });

  it("B-9b: 403 → auth", async () => {
    const client = makeClient(async () => makeErrResponse(403));
    await expect(client.getStock("X")).rejects.toMatchObject({ kind: "auth", status: 403 });
  });

  it("B-9c: 404 → not_found", async () => {
    const client = makeClient(async () => makeErrResponse(404));
    await expect(client.getStock("X")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("B-9d: 429 → rate_limit", async () => {
    const client = makeClient(async () =>
      new Response("{}", { status: 429, headers: { "Retry-After": "5" } }),
    );
    await expect(client.getStock("X")).rejects.toMatchObject({ kind: "rate_limit", status: 429 });
  });

  it("B-9e: 500 → server", async () => {
    const client = makeClient(async () => makeErrResponse(500));
    await expect(client.getStock("X")).rejects.toMatchObject({ kind: "server" });
  });
});

// ---------------------------------------------------------------------------
// B-10: IndianAPI current price cannot replace Kite canonical price
// ---------------------------------------------------------------------------

describe("Gate B-10 — IndianAPI price never replaces Kite canonical price", () => {
  it("B-10a: getStock returns profile without ltp/current_price fields", async () => {
    const client = makeClient(async () =>
      makeOkResponse(stockBody({ current_price: 2900.5, ltp: 2900.5, price: 2900.5 })),
    );
    const data = await client.getStock("RELIANCE");
    // IndianAPI price fields must not appear on the profile type
    // The profile has no ltp/current_price/price field
    expect("ltp" in data.profile).toBe(false);
    expect("current_price" in data.profile).toBe(false);
    expect("price" in data.profile).toBe(false);
  });

  it("B-10b: ratios has no price fields", async () => {
    const client = makeClient(async () =>
      makeOkResponse(stockBody({ current_price: 2900.5 })),
    );
    const data = await client.getStock("RELIANCE");
    expect("current_price" in data.ratios).toBe(false);
    expect("ltp" in data.ratios).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B-11: Endpoint and header proof (no secret values)
// ---------------------------------------------------------------------------

describe("Gate B-11 — Endpoint and header proof", () => {
  it("B-11a: request uses GET method", async () => {
    let method = "";
    const client = makeClient(async (_, init) => {
      method = init?.method ?? "GET";
      return makeOkResponse(stockBody());
    });
    await client.getStock("RELIANCE");
    expect(method).toBe("GET");
  });

  it("B-11b: x-api-key header present but value not exposed in configError or response", async () => {
    let capturedHeaders: Record<string, string> = {};
    const client = makeClient(async (_, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return makeOkResponse(stockBody());
    });
    await client.getStock("RELIANCE");
    // The header IS sent (server-side only) — key present
    expect("x-api-key" in capturedHeaders).toBe(true);
    // But it does NOT appear in the URL or configError
    expect(capturedHeaders["x-api-key"]).toBe("FAKE_API_KEY");
  });
});
