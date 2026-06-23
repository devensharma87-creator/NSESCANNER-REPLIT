import { describe, it, expect, vi, beforeEach } from "vitest";

import type { DataMeta, TrustedQuote } from "./marketData";

const getEquityQuotes = vi.fn();
const scanAll = vi.fn();

vi.mock("./marketData", () => ({
  router: { getEquityQuotes: (...a: unknown[]) => getEquityQuotes(...a) },
}));
vi.mock("./scanner", () => ({
  scanAll: (...a: unknown[]) => scanAll(...a),
}));
vi.mock("./universe", () => ({
  getEntry: () => undefined,
}));
vi.mock("./watchlistLists", () => ({
  WATCHLIST_META: {
    NIFTY50: { label: "Nifty 50", description: "Top 50 by free-float mcap." },
  },
  getWatchlistSymbols: () => ["AAA", "BBB", "CCC"],
  watchlistName: (s: string) => s,
}));
vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { buildBasket, resolveBasketKey } from "./watchlistBasket";

function meta(over: Partial<DataMeta> = {}): DataMeta {
  return {
    source: "kite",
    trustTier: "authoritative",
    asOf: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    freshnessSec: 5,
    isStale: false,
    delayed: false,
    notForSignals: false,
    notForTradeDecisions: false,
    validationStatus: "validated",
    warnings: [],
    ...over,
  };
}

function quote(symbol: string, over: Partial<DataMeta> = {}): TrustedQuote {
  return {
    symbol,
    name: symbol,
    lastPrice: 100,
    previousClose: 99,
    change: 1,
    changePercent: 1.01,
    open: 99.5,
    high: 101,
    low: 98,
    volume: 1000,
    meta: meta(over),
  } as TrustedQuote;
}

describe("resolveBasketKey", () => {
  it("maps aliases to canonical watchlist keys", () => {
    expect(resolveBasketKey("MIDCAP100")).toBe("NIFTYMIDCAP100");
    expect(resolveBasketKey("smallcap100")).toBe("NIFTYSMALLCAP100");
    expect(resolveBasketKey("NIFTY100")).toBe("NIFTY100");
    expect(resolveBasketKey(" nifty50 ")).toBe("NIFTY50");
  });

  it("returns null for an unknown key", () => {
    expect(resolveBasketKey("BOGUS")).toBeNull();
  });
});

describe("buildBasket aggregation", () => {
  beforeEach(() => {
    getEquityQuotes.mockReset();
    scanAll.mockReset();
  });

  it("aggregates honestly: partials, freshness counts, source roll-up, trend/rsi enrichment", async () => {
    const quotes = new Map<string, TrustedQuote>([
      ["AAA", quote("AAA")],
      ["BBB", quote("BBB", { isStale: true })],
    ]);
    getEquityQuotes.mockResolvedValue({
      requested: ["AAA", "BBB", "CCC"],
      quotes,
      missing: [{ symbol: "CCC", reason: "No authoritative quote." }],
      meta: meta(),
    });
    scanAll.mockResolvedValue([
      { symbol: "AAA", recommendation: { signal: "STRONG_BUY" }, indicators: { rsi14: 65 } },
    ]);

    const res = await buildBasket("NIFTY50", "NIFTY50");

    expect(res.requested).toBe(3);
    expect(res.returned).toBe(2);
    expect(res.missing).toHaveLength(1);
    expect(res.missing[0]).toMatchObject({ symbol: "CCC" });
    expect(res.summary.fresh).toBe(1);
    expect(res.summary.stale).toBe(1);
    expect(res.summary.tradeable).toBe(2);
    expect(res.summary.bySource.kite).toBe(2);
    expect(res.sourcePolicy.authoritative).toBe("kite");

    const aaa = res.rows.find((r) => r.symbol === "AAA")!;
    expect(aaa.trend).toBe("Very Bullish");
    expect(aaa.rsi).toBe(65);

    const bbb = res.rows.find((r) => r.symbol === "BBB")!;
    expect(bbb.trend).toBeNull();
    expect(bbb.rsi).toBeNull();
    expect(bbb.isStale).toBe(true);
  });

  it("still returns a basket (trend null) when the scanner is unavailable", async () => {
    getEquityQuotes.mockResolvedValue({
      requested: ["AAA"],
      quotes: new Map([["AAA", quote("AAA")]]),
      missing: [],
      meta: meta(),
    });
    scanAll.mockRejectedValue(new Error("scanner down"));

    const res = await buildBasket("NIFTY50", "NIFTY50");
    expect(res.returned).toBe(1);
    expect(res.rows[0].trend).toBeNull();
  });
});
