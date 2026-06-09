import { describe, it, expect, vi } from "vitest";
import {
  resolveHolding,
  liveFromDetail,
  liveFromCandles,
  pickBestInstrument,
  pendingMeta,
  EMPTY_LIVE,
  type EnrichFetchers,
  type DetailLike,
  type InstrumentLike,
  type CandleLike,
} from "./enrich";
import { isEtfClass } from "./symbol";

function detailWithPrice(price: number, sector = "IT"): DetailLike {
  return {
    quote: { price, previousClose: price - 1 },
    indicators: { rsi14: 55, supportLevel: price - 10, resistanceLevel: price + 10, trendStrength: 7 },
    profile: {
      sector,
      keyStats: { fiftyDayAverage: price - 2, twoHundredDayAverage: price - 5, peRatio: 20, beta: 1.1 },
    },
  };
}

function makeFetchers(over: Partial<EnrichFetchers> = {}): EnrichFetchers {
  return {
    stockDetail: vi.fn(async () => null),
    searchInstruments: vi.fn(async () => []),
    candles: vi.fn(async () => []),
    ...over,
  };
}

describe("liveFromDetail", () => {
  it("maps a full detail payload", () => {
    const live = liveFromDetail(detailWithPrice(100));
    expect(live.available).toBe(true);
    expect(live.cmp).toBe(100);
    expect(live.previousClose).toBe(99);
    expect(live.dma50).toBe(98);
    expect(live.peRatio).toBe(20);
  });

  it("returns EMPTY_LIVE for nullish input", () => {
    expect(liveFromDetail(null)).toEqual(EMPTY_LIVE);
    expect(liveFromDetail(undefined)).toEqual(EMPTY_LIVE);
  });

  it("is unavailable when price is missing", () => {
    expect(liveFromDetail({ quote: { price: null } }).available).toBe(false);
  });
});

describe("liveFromCandles", () => {
  const closes: CandleLike[] = Array.from({ length: 60 }, (_, i) => ({ c: 100 + i }));

  it("uses last close as CMP and second-last as previous", () => {
    const live = liveFromCandles(closes, "Financials");
    expect(live.available).toBe(true);
    expect(live.cmp).toBe(159);
    expect(live.previousClose).toBe(158);
    expect(live.sector).toBe("Financials");
  });

  it("derives DMA50 from real closes and leaves DMA200 null when short", () => {
    const live = liveFromCandles(closes);
    expect(live.dma50).not.toBeNull();
    expect(live.dma200).toBeNull();
  });

  it("returns sector-only EMPTY when no candles", () => {
    expect(liveFromCandles([], "X")).toEqual({ ...EMPTY_LIVE, sector: "X" });
  });
});

describe("pickBestInstrument", () => {
  const eq: InstrumentLike = { symbol: "TATAPOWER", name: "Tata Power", segment: "equity", type: "Equity" };
  const idx: InstrumentLike = { symbol: "TATAPOWER", name: "Tata Power Idx", segment: "index", type: "Index" };

  it("prefers an exact symbol match in the equity segment", () => {
    expect(pickBestInstrument([idx, eq], "TATAPOWER")).toBe(eq);
  });

  it("falls back to exact name match", () => {
    const list = [{ symbol: "XX", name: "Tata Power", segment: "equity", type: "Equity" }];
    expect(pickBestInstrument(list, "NOPE", "Tata Power")?.symbol).toBe("XX");
  });

  it("returns null on empty list", () => {
    expect(pickBestInstrument([], "ANY")).toBeNull();
  });
});

describe("resolveHolding cascade", () => {
  it("Step 1: enriches directly from stock detail on the normalised symbol", async () => {
    const stockDetail = vi.fn(async () => detailWithPrice(2500));
    const fx = makeFetchers({ stockDetail });
    const r = await resolveHolding({ symbol: "reliance.ns" }, fx);
    expect(stockDetail).toHaveBeenCalledWith("RELIANCE");
    expect(r.live.cmp).toBe(2500);
    expect(r.meta.dataSource).toBe("stock-detail");
    expect(r.meta.resolvedSymbol).toBe("RELIANCE");
    expect(r.meta.reason).toBeNull();
  });

  it("Step 2/2b: resolves via search then retries stock detail", async () => {
    const stockDetail = vi
      .fn()
      .mockResolvedValueOnce(null) // first call on the typed symbol
      .mockResolvedValueOnce(detailWithPrice(300)); // retry on resolved symbol
    const searchInstruments = vi.fn(async () => [
      { symbol: "TATAPOWER", name: "Tata Power", segment: "equity", type: "Equity" },
    ]);
    const fx = makeFetchers({ stockDetail, searchInstruments });
    const r = await resolveHolding({ symbol: "TATAPWR" }, fx);
    expect(searchInstruments).toHaveBeenCalled();
    expect(stockDetail).toHaveBeenLastCalledWith("TATAPOWER");
    expect(r.live.cmp).toBe(300);
    expect(r.meta.resolvedSymbol).toBe("TATAPOWER");
    expect(r.meta.dataSource).toBe("stock-detail");
  });

  it("Step 3: falls back to candles for a price-only CMP", async () => {
    const searchInstruments = vi.fn(async () => [
      { symbol: "ABCAPITAL", name: "Aditya Birla Capital", segment: "equity", type: "Equity" },
    ]);
    const candles = vi.fn(async () => Array.from({ length: 60 }, (_, i) => ({ c: 200 + i })));
    const fx = makeFetchers({ searchInstruments, candles });
    const r = await resolveHolding({ symbol: "ABCAPITAL" }, fx);
    expect(r.meta.dataSource).toBe("chart-candles");
    expect(r.live.cmp).toBe(259);
    expect(r.live.peRatio).toBeNull(); // no fundamentals from candles
  });

  it("ETF via candles: marks fundamentals not applicable", async () => {
    const searchInstruments = vi.fn(async () => [
      { symbol: "NIFTYBEES", name: "Nippon Nifty BeES", segment: "equity", type: "ETF" },
    ]);
    const candles = vi.fn(async () => Array.from({ length: 5 }, (_, i) => ({ c: 250 + i })));
    const fx = makeFetchers({ searchInstruments, candles });
    const r = await resolveHolding({ symbol: "NIFTYBEES" }, fx);
    expect(r.meta.instrumentType).toBe("Index ETF");
    expect(r.meta.fundamentalsApplicable).toBe(false);
    expect(r.meta.reason).toBe("ETF fundamentals unavailable");
    expect(r.live.cmp).toBe(254);
  });

  it("Step 1b: resolves a whitelisted ETF via the lightweight etfQuote branch", async () => {
    const stockDetail = vi.fn(async () => null); // ETF 404s on the curated detail endpoint
    const searchInstruments = vi.fn(async () => []); // ETFs absent from the chart universe
    const etfQuote = vi.fn(async () => ({ price: 285.4, previousClose: 283.1 }));
    const fx = makeFetchers({ stockDetail, searchInstruments, etfQuote });
    const r = await resolveHolding({ symbol: "NIFTYBEES" }, fx);
    expect(etfQuote).toHaveBeenCalledWith("NIFTYBEES");
    expect(searchInstruments).not.toHaveBeenCalled(); // short-circuits before search
    expect(r.live.cmp).toBe(285.4);
    expect(r.live.previousClose).toBe(283.1);
    expect(r.live.peRatio).toBeNull(); // no fundamentals from an ETF quote
    expect(r.meta.dataSource).toBe("etf-quote");
    expect(r.meta.instrumentType).toBe("Index ETF");
    expect(r.meta.fundamentalsApplicable).toBe(false);
    expect(r.meta.reason).toBeNull();
  });

  it("Step 1b: ETF quote unavailable (Kite offline) falls through to the preserved state", async () => {
    const etfQuote = vi.fn(async () => null); // 503 / no quote
    const fx = makeFetchers({ etfQuote });
    const r = await resolveHolding({ symbol: "GOLDBEES" }, fx);
    expect(etfQuote).toHaveBeenCalledWith("GOLDBEES");
    expect(r.live.available).toBe(false);
    expect(r.meta.reason).toBe("No instrument match");
  });

  it("Step 1b: never fires the ETF branch for a plain equity", async () => {
    const etfQuote = vi.fn(async () => ({ price: 999 }));
    const stockDetail = vi.fn(async () => detailWithPrice(2500));
    const fx = makeFetchers({ stockDetail, etfQuote });
    const r = await resolveHolding({ symbol: "RELIANCE" }, fx);
    expect(etfQuote).not.toHaveBeenCalled();
    expect(r.meta.dataSource).toBe("stock-detail");
    expect(r.live.cmp).toBe(2500);
  });

  it("Step 3.5: last-resort etfQuote prices an ETF the client classifier missed", async () => {
    // "MON100" with no name carries no ETF/BEES token → classified Equity → the
    // dedicated step-1b ETF branch is skipped. The authoritative backend ETF
    // endpoint still recognises and prices it, so the row resolves rather than
    // being preserved as unpriced.
    const stockDetail = vi.fn(async () => null);
    const searchInstruments = vi.fn(async () => []);
    const etfQuote = vi.fn(async () => ({ price: 142.5, previousClose: 141.0 }));
    const fx = makeFetchers({ stockDetail, searchInstruments, etfQuote });
    const r = await resolveHolding({ symbol: "MON100" }, fx);
    expect(etfQuote).toHaveBeenCalledWith("MON100");
    expect(r.live.cmp).toBe(142.5);
    expect(r.live.previousClose).toBe(141.0);
    expect(r.live.peRatio).toBeNull();
    expect(r.meta.dataSource).toBe("etf-quote");
    expect(r.meta.fundamentalsApplicable).toBe(false);
    expect(isEtfClass(r.meta.instrumentType)).toBe(true);
    expect(r.meta.reason).toBeNull();
  });

  it("Step 3.5: does not double-call etfQuote when step 1b already attempted it", async () => {
    // GOLDBEES classifies as an ETF → step 1b fires etfQuote once; when that
    // returns null the last-resort branch must NOT fire a second redundant call.
    const etfQuote = vi.fn(async () => null);
    const fx = makeFetchers({ etfQuote });
    const r = await resolveHolding({ symbol: "GOLDBEES" }, fx);
    expect(etfQuote).toHaveBeenCalledTimes(1);
    expect(r.live.available).toBe(false);
    expect(r.meta.reason).toBe("No instrument match");
  });

  it("Step 4: preserves the holding with 'No instrument match' when search is empty", async () => {
    const r = await resolveHolding({ symbol: "ZZZZ" }, makeFetchers());
    expect(r.live).toEqual({ ...EMPTY_LIVE, sector: null });
    expect(r.meta.reason).toBe("No instrument match");
    expect(r.meta.dataSource).toBeNull();
  });

  it("Step 4: 'CMP unavailable' when resolved but neither detail nor candles return a price", async () => {
    const searchInstruments = vi.fn(async () => [
      { symbol: "XYZLTD", name: "XYZ", segment: "equity", type: "Equity" },
    ]);
    const fx = makeFetchers({ searchInstruments }); // candles default to []
    const r = await resolveHolding({ symbol: "XYZLTD2" }, fx);
    expect(r.meta.resolvedSymbol).toBe("XYZLTD");
    expect(r.meta.reason).toBe("CMP unavailable");
    expect(r.live.available).toBe(false);
  });

  it("never throws even when every fetcher rejects", async () => {
    const fx: EnrichFetchers = {
      stockDetail: vi.fn(async () => {
        throw new Error("boom");
      }),
      searchInstruments: vi.fn(async () => {
        throw new Error("boom");
      }),
      candles: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const r = await resolveHolding({ symbol: "ANY" }, fx);
    expect(r.live.available).toBe(false);
    expect(r.meta.reason).toBe("No instrument match");
  });
});

describe("pendingMeta", () => {
  it("produces an awaiting-data placeholder", () => {
    const m = pendingMeta({ symbol: "tcs.ns" });
    expect(m.normalisedSymbol).toBe("TCS");
    expect(m.reason).toBe("Awaiting data source");
    expect(m.dataSource).toBeNull();
  });
});
