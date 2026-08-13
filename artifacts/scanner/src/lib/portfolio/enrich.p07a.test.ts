/**
 * Phase 0.7A — portfolio enrichment must not invent an exchange.
 *
 * Both ETF branches used to end in `?? "NSE"`, so a holding whose exchange was
 * genuinely unknown — or one held on BSE that arrived without the field — was
 * labelled NSE in the UI, in the CSV export and in the persisted row. Unknown
 * now stays unknown (`null`), exactly as the sibling branches already report.
 */

import { describe, it, expect, vi } from "vitest";
import {
  resolveHolding,
  etfQuoteExchange,
  normalizeExchangeLabel,
  type EnrichFetchers,
} from "./enrich";

describe("P0.7A — normalizeExchangeLabel is a closed set", () => {
  it("accepts NSE/BSE only", () => {
    expect(normalizeExchangeLabel(" nse ")).toBe("NSE");
    expect(normalizeExchangeLabel("BSE")).toBe("BSE");
    for (const bad of [null, undefined, "", "NSEIDX", "MCX", 7, {}]) {
      expect(normalizeExchangeLabel(bad)).toBeNull();
    }
  });
});

describe("P0.7A — etfQuoteExchange reports the listing that produced the price", () => {
  it("the quote's exchange wins over the recorded holding exchange", () => {
    expect(etfQuoteExchange("NSE", "BSE")).toBe("NSE");
    expect(etfQuoteExchange("BSE", "NSE")).toBe("BSE");
  });

  it("falls back to the declared exchange only when the quote names none", () => {
    expect(etfQuoteExchange(null, "BSE")).toBe("BSE");
    expect(etfQuoteExchange("MCX", "NSE")).toBe("NSE");
  });

  it("never invents an exchange", () => {
    expect(etfQuoteExchange(null, null)).toBeNull();
    expect(etfQuoteExchange("", "")).toBeNull();
    expect(etfQuoteExchange(undefined, "NSEIDX")).toBeNull();
  });
});

function makeFetchers(over: Partial<EnrichFetchers> = {}): EnrichFetchers {
  return {
    stockDetail: vi.fn(async () => null),
    searchInstruments: vi.fn(async () => []),
    candles: vi.fn(async () => ({ candles: [] })),
    ...over,
  };
}

describe("P0.7A — ETF branch (step 1b) reports a real exchange or null", () => {
  const etfQuote = () => vi.fn(async () => ({ price: 285.4, previousClose: 283.1 }));

  it("reports null when neither the alias nor the holding names an exchange", async () => {
    const fx = makeFetchers({ etfQuote: etfQuote() });
    const r = await resolveHolding({ symbol: "GOLDBEES" }, fx);
    expect(r.meta.dataSource).toBe("etf-quote");
    expect(r.meta.exchange).toBeNull();
  });

  it("keeps a BSE holding on BSE", async () => {
    const fx = makeFetchers({ etfQuote: etfQuote() });
    const r = await resolveHolding({ symbol: "GOLDBEES", exchange: "BSE" }, fx);
    expect(r.meta.dataSource).toBe("etf-quote");
    expect(r.meta.exchange).toBe("BSE");
  });

  it("still reports NSE when the holding says NSE", async () => {
    const fx = makeFetchers({ etfQuote: etfQuote() });
    const r = await resolveHolding({ symbol: "GOLDBEES", exchange: "NSE" }, fx);
    expect(r.meta.exchange).toBe("NSE");
  });

  it("reports the exchange the backend actually priced, not the recorded one", async () => {
    // The ETF quote endpoint prices the NSE listing. A holding recorded on BSE
    // must not be shown as a BSE-priced row.
    const fx = makeFetchers({
      etfQuote: vi.fn(async () => ({ price: 285.4, previousClose: 283.1, exchange: "NSE" })),
    });
    const r = await resolveHolding({ symbol: "GOLDBEES", exchange: "BSE" }, fx);
    expect(r.meta.exchange).toBe("NSE");
  });
});

describe("P0.7A — last-resort ETF branch (step 3.5) reports a real exchange or null", () => {
  it("reports null for an ETF the client classifier missed", async () => {
    const fx = makeFetchers({
      stockDetail: vi.fn(async () => null),
      searchInstruments: vi.fn(async () => []),
      etfQuote: vi.fn(async () => ({ price: 142.5, previousClose: 141.0 })),
    });
    const r = await resolveHolding({ symbol: "MON100" }, fx);
    expect(r.meta.dataSource).toBe("etf-quote");
    expect(r.meta.exchange).toBeNull();
  });
});

describe("P0.7A — no NSE fallback remains in the enrichment cascade", () => {
  it("every branch reports the exchange it knows, or null", async () => {
    // A holding with no exchange anywhere in the cascade must never come back
    // labelled NSE, whichever branch resolves it.
    const unpriced = await resolveHolding({ symbol: "UNKNOWNSYM" }, makeFetchers());
    expect(unpriced.meta.exchange).toBeNull();
  });
});
