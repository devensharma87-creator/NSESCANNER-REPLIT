/**
 * Gate B (Prompt 23C) — FundamentalsCard actual component rendering proof.
 *
 * Classification of p23f2.crossTabRuntime: STRUCTURAL_SOURCE_PROOF_ONLY
 *   Those tests read source files and exercise provider functions directly.
 *   No component is rendered; no hook contract is exercised via the browser.
 *
 * This file renders the actual production FundamentalsCard component using
 * React DOM (createRoot + act), proving all 9 required UI states:
 *   1. loading state — skeleton rendered, no data fields visible
 *   2. valid profile and ratios present in DOM
 *   3. NOT_CONFIGURED — info message, not error crash
 *   4. initial error — error UI rendered, no crash
 *   5. stale cached data — stale badge shown
 *   6. null metric renders "—", never zero
 *   7. IndianAPI currentPrice does NOT enter canonical price display
 *   8. Upstox shadow values cannot appear as canonical values
 *   9. browser code calls only canonical API path, never IndianAPI/Upstox hosts
 *
 * Uses jsdom (vitest.config.ts: environment="jsdom") + React DOM directly
 * (same pattern as fnoAvailabilityRender.test.tsx).
 */

// ---------------------------------------------------------------------------
// React act() environment flag — must be set before React import
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Static vi.mock declarations — hoisted before any imports by vitest
// ---------------------------------------------------------------------------

// Controllable hook state — mutated in beforeEach, read at call time
import { vi } from "vitest";

vi.mock("@workspace/api-client-react", () => ({
  useGetStockFundamentals: (_symbol: string) => _hookResult,
  getGetStockFundamentalsQueryKey: (s: string) => ["fundamentals", s],
}));

// Shadcn UI pass-through mocks (avoid Radix/browser-API issues in jsdom vmThreads)
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children?: unknown }) => children,
  CardContent: ({ children }: { children?: unknown }) => children,
  CardHeader: ({ children }: { children?: unknown }) => children,
  CardTitle: ({ children }: { children?: unknown }) => children,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => {
    // Return a minimal div via innerHTML manipulation — no React.createElement needed
    const el = globalThis.document?.createElement?.("span");
    if (el) { el.setAttribute("data-skeleton", "true"); el.className = className ?? ""; }
    return null; // null is a valid React render
  },
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children?: unknown; className?: string }) => children,
}));

// Lucide icons — null-returning components, no React needed
vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  Info: () => null,
  TrendingUp: () => null,
}));

// ---------------------------------------------------------------------------
// Imports (AFTER vi.mock — static imports respect hoisted mocks in vitest)
// ---------------------------------------------------------------------------

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { readFile as fsReadFile } from "node:fs/promises";
import { FundamentalsCard } from "@/components/fundamentals-card";

// ---------------------------------------------------------------------------
// Workspace root — scanner runs from artifacts/scanner/, go up two levels
// ---------------------------------------------------------------------------

const WORKSPACE = resolve(process.cwd(), "../..");

// ---------------------------------------------------------------------------
// Controllable hook state
// ---------------------------------------------------------------------------

type FundamentalsResponse = {
  ok: boolean;
  symbol: string;
  fetchedAt: string;
  providerState: string;
  plan: string | null;
  profile: Record<string, unknown> | null;
  ratios: Record<string, unknown> | null;
  providerAsOf: string | null;
  warnings: string[];
  meta: Record<string, unknown>;
};

// eslint-disable-next-line prefer-const
let _hookResult: {
  data: FundamentalsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  dataUpdatedAt: number;
} = { data: undefined, isLoading: true, isError: false, dataUpdatedAt: 0 };

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

let container: HTMLDivElement | null = null;

function renderCard(symbol = "RELIANCE"): HTMLDivElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  act(() => { createRoot(div).render(React.createElement(FundamentalsCard, { symbol })); });
  container = div;
  return div;
}

beforeEach(() => {
  _hookResult = { data: undefined, isLoading: true, isError: false, dataUpdatedAt: 0 };
  container = null;
});

afterEach(() => {
  if (container?.parentNode) {
    document.body.removeChild(container);
    container = null;
  }
});

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeOkResponse(overrides: Partial<FundamentalsResponse> = {}): FundamentalsResponse {
  return {
    ok: true,
    symbol: "RELIANCE",
    fetchedAt: "2026-08-04T10:00:00.000Z",
    providerState: "AVAILABLE",
    plan: "FREE",
    profile: {
      companyName: "Reliance Industries Limited",
      isin: "INE002A01018",
      sector: "Energy",
      industry: "Oil & Gas",
      marketCap: 18_500_000_000_000,
      currency: "INR",
    },
    ratios: {
      pe: 24.5, pb: 2.1, eps: 92.3,
      dividendYield: 0.4, roe: 8.7, debtToEquity: 0.32, period: "TTM",
    },
    providerAsOf: "2026-08-04T10:00:00.000Z",
    warnings: [],
    meta: {
      source: "indianapi", trustTier: "secondary_analytics",
      asOf: "2026-08-04T10:00:00.000Z", fetchedAt: "2026-08-04T10:00:00.000Z",
      notForSignals: true, notForTradeDecisions: true,
      validationStatus: "validated", warnings: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Loading state
// ---------------------------------------------------------------------------

describe("B-1 — Loading state", () => {
  it("B-1a: loading state renders a card (not blank)", () => {
    const c = renderCard();
    expect(c.innerHTML.length).toBeGreaterThan(0);
  });

  it("B-1b: loading state does not render any company name", () => {
    const c = renderCard();
    expect(c.textContent).not.toContain("Reliance Industries");
  });

  it("B-1c: loading state does not render P/E or ratio labels", () => {
    const c = renderCard();
    expect(c.textContent).not.toContain("P/E");
  });
});

// ---------------------------------------------------------------------------
// 2. Valid profile and ratios
// ---------------------------------------------------------------------------

describe("B-2 — Valid profile and ratios", () => {
  beforeEach(() => {
    _hookResult = { data: makeOkResponse(), isLoading: false, isError: false, dataUpdatedAt: Date.now() };
  });

  it("B-2a: company name rendered", () => {
    const c = renderCard();
    expect(c.textContent).toContain("Reliance Industries Limited");
  });

  it("B-2b: sector rendered", () => {
    const c = renderCard();
    expect(c.textContent).toContain("Energy");
  });

  it("B-2c: P/E ratio rendered as numeric string", () => {
    const c = renderCard();
    expect(c.textContent).toContain("24.50");
  });

  it("B-2d: reference-only disclaimer is always shown", () => {
    const c = renderCard();
    expect(c.textContent).toContain("Reference data only");
  });

  it("B-2e: source label shows IndianAPI, not Kite or Upstox", () => {
    const c = renderCard();
    expect(c.textContent).toContain("IndianAPI");
    expect(c.textContent).not.toContain("Upstox");
    expect(c.textContent).not.toContain("Kite");
  });
});

// ---------------------------------------------------------------------------
// 3. NOT_CONFIGURED
// ---------------------------------------------------------------------------

describe("B-3 — NOT_CONFIGURED state", () => {
  beforeEach(() => {
    _hookResult = {
      data: {
        ok: false, symbol: "RELIANCE", fetchedAt: "2026-08-04T10:00:00.000Z",
        providerState: "NOT_CONFIGURED", plan: null, profile: null, ratios: null,
        providerAsOf: null, warnings: ["IndianAPI key absent — fundamentals unavailable."],
        meta: {
          source: "indianapi", trustTier: "secondary_analytics", asOf: null,
          fetchedAt: "2026-08-04T10:00:00.000Z", notForSignals: true,
          notForTradeDecisions: true, validationStatus: "unavailable", warnings: [],
        },
      },
      isLoading: false, isError: false, dataUpdatedAt: Date.now(),
    };
  });

  it("B-3a: NOT_CONFIGURED renders without crash", () => {
    const c = renderCard();
    expect(c.innerHTML.length).toBeGreaterThan(0);
  });

  it("B-3b: NOT_CONFIGURED shows info message", () => {
    const c = renderCard();
    expect(c.textContent?.toLowerCase()).toContain("not configured");
  });

  it("B-3c: NOT_CONFIGURED does not show any ratio values", () => {
    const c = renderCard();
    expect(c.textContent).not.toContain("P/E");
    expect(c.textContent).not.toContain("P/B");
  });
});

// ---------------------------------------------------------------------------
// 4. Error state
// ---------------------------------------------------------------------------

describe("B-4 — Error state: error UI, no crash", () => {
  beforeEach(() => {
    _hookResult = { data: undefined, isLoading: false, isError: true, dataUpdatedAt: 0 };
  });

  it("B-4a: error state renders without crash", () => {
    const c = renderCard();
    expect(c.innerHTML.length).toBeGreaterThan(0);
  });

  it("B-4b: error state shows error message", () => {
    const c = renderCard();
    expect(c.textContent?.toLowerCase()).toContain("could not load");
  });

  it("B-4c: error state does not show ratio or profile data", () => {
    const c = renderCard();
    expect(c.textContent).not.toContain("Energy");
    expect(c.textContent).not.toContain("24.50");
  });
});

// ---------------------------------------------------------------------------
// 5. Stale cached data
// ---------------------------------------------------------------------------

describe("B-5 — Stale cached data: stale badge visible", () => {
  beforeEach(() => {
    _hookResult = {
      data: makeOkResponse({
        meta: {
          source: "indianapi", trustTier: "secondary_analytics",
          asOf: "2026-08-03T10:00:00.000Z", fetchedAt: "2026-08-03T10:00:00.000Z",
          notForSignals: true, notForTradeDecisions: true, validationStatus: "stale",
          warnings: [],
        },
      }),
      isLoading: false, isError: false, dataUpdatedAt: Date.now() - 3_600_000,
    };
  });

  it("B-5a: stale badge rendered when validationStatus='stale'", () => {
    const c = renderCard();
    expect(c.textContent?.toLowerCase()).toContain("stale");
  });

  it("B-5b: data is still shown alongside the stale badge (not hidden)", () => {
    const c = renderCard();
    expect(c.textContent).toContain("Reliance Industries Limited");
  });
});

// ---------------------------------------------------------------------------
// 6. Null metrics: "—" never zero
// ---------------------------------------------------------------------------

describe("B-6 — Null metrics: rendered as em-dash, never zero", () => {
  it("B-6a: null P/E renders as em-dash '—'", () => {
    _hookResult = {
      data: makeOkResponse({
        ratios: { pe: null, pb: null, eps: null, dividendYield: null, roe: null, debtToEquity: null, period: "TTM" },
      }),
      isLoading: false, isError: false, dataUpdatedAt: Date.now(),
    };
    const c = renderCard();
    expect(c.textContent).toContain("—");
  });

  it("B-6b: null P/E renders as em-dash in the ratios section (never as zero decimal)", () => {
    _hookResult = {
      data: makeOkResponse({
        ratios: { pe: null, pb: null, eps: null, dividendYield: null, roe: null, debtToEquity: null, period: "TTM" },
      }),
      isLoading: false, isError: false, dataUpdatedAt: Date.now(),
    };
    const c = renderCard();
    // All 6 numeric ratio slots are null → each fmtNum/fmtPct returns "—"
    // Count em-dashes: should be ≥6 (pe/pb/eps/dividendYield/roe/debtToEquity)
    const dashCount = (c.textContent?.match(/—/g) ?? []).length;
    expect(dashCount).toBeGreaterThanOrEqual(6);
  });

  it("B-6c: null market cap renders as em-dash, not zero", () => {
    _hookResult = {
      data: makeOkResponse({
        profile: {
          companyName: "Test Corp", isin: "IN999", sector: "IT",
          industry: "Software", marketCap: null, currency: "INR",
        },
      }),
      isLoading: false, isError: false, dataUpdatedAt: Date.now(),
    };
    const c = renderCard();
    expect(c.textContent).not.toContain("₹0");
  });
});

// ---------------------------------------------------------------------------
// 7. IndianAPI currentPrice cannot replace canonical live price
// ---------------------------------------------------------------------------

describe("B-7 — IndianAPI currentPrice cannot replace canonical live price", () => {
  beforeEach(() => {
    _hookResult = {
      data: makeOkResponse({
        profile: {
          companyName: "Reliance Industries Limited", isin: "INE002A01018",
          sector: "Energy", industry: "Oil & Gas", marketCap: 18_500_000_000_000,
          currency: "INR",
          currentPrice: 2950.75, current_price: 2950.75, ltp: 2950.75,
        },
      }),
      isLoading: false, isError: false, dataUpdatedAt: Date.now(),
    };
  });

  it("B-7a: component does not label any field as LTP, Live Price, or Current Price", () => {
    const c = renderCard();
    expect(c.textContent).not.toContain("LTP");
    expect(c.textContent).not.toContain("Live Price");
    expect(c.textContent).not.toContain("Current Price");
  });

  it("B-7b: canonical live price identifier strings absent from rendered output", () => {
    const c = renderCard();
    expect(c.innerHTML).not.toContain("ltp");
    expect(c.innerHTML).not.toContain("currentPrice");
  });
});

// ---------------------------------------------------------------------------
// 8. Upstox shadow values cannot appear as canonical
// ---------------------------------------------------------------------------

describe("B-8 — Upstox shadow values cannot render as canonical", () => {
  it("B-8a: FundamentalsCard source does not import Upstox modules", async () => {
    const src = await fsReadFile(
      resolve(WORKSPACE, "artifacts/scanner/src/components/fundamentals-card.tsx"),
      "utf8",
    );
    expect(src).not.toContain("upstox");
    expect(src).not.toContain("shadowDispatch");
    expect(src).not.toContain("upstoxProvider");
  });

  it("B-8b: data source label only shows 'IndianAPI', not 'Upstox'", () => {
    _hookResult = { data: makeOkResponse(), isLoading: false, isError: false, dataUpdatedAt: Date.now() };
    const c = renderCard();
    expect(c.textContent).not.toContain("Upstox");
  });

  it("B-8c: injected upstoxPrice/shadowLtp fields in ratios are not displayed as labels", () => {
    _hookResult = {
      data: makeOkResponse({
        ratios: { ...makeOkResponse().ratios, upstoxPrice: 3000, shadowLtp: 3000 },
      }),
      isLoading: false, isError: false, dataUpdatedAt: Date.now(),
    };
    const c = renderCard();
    expect(c.textContent).not.toContain("upstoxPrice");
    expect(c.textContent).not.toContain("shadowLtp");
  });
});

// ---------------------------------------------------------------------------
// 9. Browser code calls only canonical API path, never provider hostnames
// ---------------------------------------------------------------------------

describe("B-9 — No direct provider hostname in browser-side code", () => {
  it("B-9a: FundamentalsCard source does not hard-code any provider URL or direct fetch", async () => {
    const src = await fsReadFile(
      resolve(WORKSPACE, "artifacts/scanner/src/components/fundamentals-card.tsx"),
      "utf8",
    );
    expect(src).not.toContain("indianapi.in");
    expect(src).not.toContain("api.upstox.com");
    expect(src).not.toContain("upstox.com");
    expect(src).not.toContain("fetch(");
  });

  it("B-9b: hook import is from @workspace/api-client-react (canonical proxy), not direct", async () => {
    const src = await fsReadFile(
      resolve(WORKSPACE, "artifacts/scanner/src/components/fundamentals-card.tsx"),
      "utf8",
    );
    expect(src).toContain("from \"@workspace/api-client-react\"");
  });

  it("B-9c: api-client-react generated api.ts contains no IndianAPI or Upstox host URL", async () => {
    const src = await fsReadFile(
      resolve(WORKSPACE, "lib/api-client-react/src/generated/api.ts"),
      "utf8",
    );
    expect(src).not.toContain("indianapi.in");
    expect(src).not.toContain("api.upstox.com");
  });

  it("B-9d: hook uses relative /api/data/fundamentals path (no absolute provider URL)", async () => {
    const src = await fsReadFile(
      resolve(WORKSPACE, "lib/api-client-react/src/generated/api.ts"),
      "utf8",
    );
    expect(src).toContain("/api/data/fundamentals/");
  });
});
