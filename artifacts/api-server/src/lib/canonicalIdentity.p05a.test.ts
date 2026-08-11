/**
 * DATA FOUNDATION PHASE 0.5A — exchange-safe canonical instrument identity.
 *
 * Section A of the directive (reproduction) was executed as a CHARACTERIZATION
 * of the extracted storage semantics, not as a reproduction of the untouched
 * baseline: the live store had to be lifted out of kiteFeed.ts before it could
 * be driven by a test at all. That characterization run is recorded in the
 * task report. The pristine-baseline evidence is the git HEAD source itself
 * (`liveQuotes = new Map<string, LiveTick>()` / `liveQuotes.set(sym, tick)`).
 *
 * Test A0 below is the durable regression lock that keeps the defect from
 * returning. Tests E1..E14 are the directive's required coverage.
 *
 * Instrument tokens are OBSERVED from the cached Kite masters
 * (artifacts/api-server/.cache/kite_instruments_{NSE,BSE}.json, 2026-08-11).
 * No provider call is made by this file.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach } from "vitest";
import {
  instrumentRegistry,
  buildCanonicalInstrumentId,
  parseCanonicalInstrumentId,
  normalizeTradingSymbol,
} from "./canonicalInstrument";
import {
  upsertQuote,
  getQuoteByCanonicalId,
  getQuoteByToken,
  getQuoteBySymbol,
  resolveQuoteBySymbol,
  allQuotes,
  allQuotesByCanonicalId,
  quoteCount,
  clearQuotes,
} from "./liveQuoteStore";

// OBSERVED — cached Kite instrument masters.
const NSE_RELIANCE = { token: 738561, exchToken: 2885 };
const BSE_RELIANCE = { token: 128083204, exchToken: 500325 };
const NSE_NIFTY50 = { token: 256265 };
const NSE_FINNIFTY = { token: 257801 };
const NSE_NIFTYBANK = { token: 260105 };

const TS = 1_786_000_000_000;

function registerNseReliance() {
  return instrumentRegistry.register({
    exchange: "NSE", segment: "EQUITY", tradingSymbol: "RELIANCE",
    providerInstrumentToken: NSE_RELIANCE.token, providerExchangeToken: NSE_RELIANCE.exchToken,
  });
}
function registerBseReliance() {
  return instrumentRegistry.register({
    exchange: "BSE", segment: "EQUITY", tradingSymbol: "RELIANCE",
    providerInstrumentToken: BSE_RELIANCE.token, providerExchangeToken: BSE_RELIANCE.exchToken,
  });
}
function tickFor(token: number, ltp: number) {
  return upsertQuote({ providerInstrumentToken: token, provider: "KITE" as const, ltp, ts: TS });
}

beforeEach(() => {
  instrumentRegistry.clear();
  clearQuotes();
});

/** Assertions below are about executable code, not the prose that documents it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("P0.5A-A0 — regression lock: symbol must never determine storage identity", () => {
  const storeSrc = stripComments(readFileSync(new URL("./liveQuoteStore.ts", import.meta.url), "utf8"));
  const feedSrc = stripComments(readFileSync(new URL("./kiteFeed.ts", import.meta.url), "utf8"));

  it("A0.1: the store never keys an insertion by symbol", () => {
    expect(storeSrc).not.toMatch(/liveQuotes\.set\(\s*(tick\.)?symbol/);
    expect(storeSrc).toMatch(/liveQuotes\.set\(identity\.canonicalInstrumentId, tick\)/);
  });

  it("A0.2: the feed resolves the provider token to an identity before storing", () => {
    expect(feedSrc).toMatch(/instrumentRegistry\.resolveByToken\(tok\)/);
    expect(feedSrc).not.toMatch(/tokenToSymbol/);
  });
});

describe("P0.5A-B — canonical identity format", () => {
  it("builds an exchange- and segment-qualified id", () => {
    expect(buildCanonicalInstrumentId("NSE", "EQUITY", "RELIANCE")).toBe("NSE:EQUITY:RELIANCE");
    expect(buildCanonicalInstrumentId("BSE", "EQUITY", "reliance")).toBe("BSE:EQUITY:RELIANCE");
  });

  it("round-trips exactly, including symbols containing spaces", () => {
    const id = buildCanonicalInstrumentId("NSE", "INDEX", "NIFTY FIN SERVICE");
    expect(parseCanonicalInstrumentId(id)).toEqual({
      exchange: "NSE", segment: "INDEX", tradingSymbol: "NIFTY FIN SERVICE",
    });
  });

  it("refuses symbols that would make the encoding ambiguous", () => {
    expect(normalizeTradingSymbol("A:B")).toBeNull();
    expect(normalizeTradingSymbol("   ")).toBeNull();
    expect(() => buildCanonicalInstrumentId("NSE", "EQUITY", "A:B")).toThrow();
  });
});

describe("P0.5A-E — required tests", () => {
  it("E1: the same symbol on NSE and BSE is stored simultaneously", () => {
    registerNseReliance();
    registerBseReliance();
    expect(tickFor(NSE_RELIANCE.token, 1500.0).ok).toBe(true);
    expect(tickFor(BSE_RELIANCE.token, 1502.5).ok).toBe(true);
    expect(quoteCount()).toBe(2);
    expect(Object.keys(allQuotesByCanonicalId()).sort()).toEqual(["BSE:EQUITY:RELIANCE", "NSE:EQUITY:RELIANCE"]);
  });

  it("E2: an NSE quote cannot overwrite a BSE quote", () => {
    registerNseReliance();
    registerBseReliance();
    tickFor(BSE_RELIANCE.token, 1502.5);
    tickFor(NSE_RELIANCE.token, 1500.0);
    const bse = getQuoteByCanonicalId("BSE:EQUITY:RELIANCE");
    expect(bse?.ltp).toBe(1502.5);
    expect(bse?.instrumentToken).toBe(BSE_RELIANCE.token);
    expect(bse?.exchange).toBe("BSE");
  });

  it("E3: a BSE quote cannot overwrite an NSE quote", () => {
    registerNseReliance();
    registerBseReliance();
    tickFor(NSE_RELIANCE.token, 1500.0);
    tickFor(BSE_RELIANCE.token, 1502.5);
    const nse = getQuoteByCanonicalId("NSE:EQUITY:RELIANCE");
    expect(nse?.ltp).toBe(1500.0);
    expect(nse?.instrumentToken).toBe(NSE_RELIANCE.token);
    expect(nse?.exchange).toBe("NSE");
  });

  it("E4: identically-named listings on different exchanges stay distinct end to end", () => {
    registerNseReliance();
    registerBseReliance();
    tickFor(NSE_RELIANCE.token, 1500.0);
    tickFor(BSE_RELIANCE.token, 1502.5);
    expect(getQuoteByToken(NSE_RELIANCE.token)?.canonicalInstrumentId).toBe("NSE:EQUITY:RELIANCE");
    expect(getQuoteByToken(BSE_RELIANCE.token)?.canonicalInstrumentId).toBe("BSE:EQUITY:RELIANCE");
    expect(getQuoteByToken(NSE_RELIANCE.token)?.ltp).not.toBe(getQuoteByToken(BSE_RELIANCE.token)?.ltp);
  });

  it("E5: an index and a stock sharing a symbol remain distinct", () => {
    // Key-space test. No such collision exists on NSE today (OBSERVED: 0),
    // so the segment qualifier is verified directly rather than via a live pair.
    instrumentRegistry.register({
      exchange: "NSE", segment: "INDEX", tradingSymbol: "NIFTY BANK",
      providerInstrumentToken: NSE_NIFTYBANK.token, securityClass: "INDEX", aliases: ["^NSEBANK"],
    });
    instrumentRegistry.register({
      exchange: "NSE", segment: "EQUITY", tradingSymbol: "NIFTY BANK",
      providerInstrumentToken: 99_000_001,
    });
    tickFor(NSE_NIFTYBANK.token, 52_000);
    tickFor(99_000_001, 11.5);
    expect(quoteCount()).toBe(2);
    expect(getQuoteByCanonicalId("NSE:INDEX:NIFTY BANK")?.ltp).toBe(52_000);
    expect(getQuoteByCanonicalId("NSE:EQUITY:NIFTY BANK")?.ltp).toBe(11.5);
  });

  it("E6: a provider token resolves to exactly one canonical identity", () => {
    registerNseReliance();
    registerBseReliance();
    const a = instrumentRegistry.resolveByToken(NSE_RELIANCE.token);
    const b = instrumentRegistry.resolveByToken(BSE_RELIANCE.token);
    expect(a?.canonicalInstrumentId).toBe("NSE:EQUITY:RELIANCE");
    expect(b?.canonicalInstrumentId).toBe("BSE:EQUITY:RELIANCE");
    expect(instrumentRegistry.resolveByToken(424242)).toBeNull();
  });

  it("E7: rebinding a provider token to a different identity is rejected", () => {
    expect(registerNseReliance().ok).toBe(true);
    const clash = instrumentRegistry.register({
      exchange: "NSE", segment: "EQUITY", tradingSymbol: "TCS",
      providerInstrumentToken: NSE_RELIANCE.token,
    });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.reason).toBe("DUPLICATE_TOKEN_CONFLICT");

    const reclash = instrumentRegistry.register({
      exchange: "NSE", segment: "EQUITY", tradingSymbol: "RELIANCE",
      providerInstrumentToken: 12345,
    });
    expect(reclash.ok).toBe(false);
    if (!reclash.ok) expect(reclash.reason).toBe("IDENTITY_TOKEN_CONFLICT");

    // Re-registering the identical pair is idempotent, not an error.
    const again = registerNseReliance();
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.created).toBe(false);
  });

  it("E8: ambiguous symbol-only lookup does not silently choose an exchange", () => {
    registerNseReliance();
    registerBseReliance();
    tickFor(NSE_RELIANCE.token, 1500.0);
    tickFor(BSE_RELIANCE.token, 1502.5);

    const res = resolveQuoteBySymbol("RELIANCE");
    expect(res.status).toBe("AMBIGUOUS");
    if (res.status === "AMBIGUOUS") {
      expect(res.candidates.map(c => c.exchange).sort()).toEqual(["BSE", "NSE"]);
    }
    // The compatibility accessor refuses rather than defaulting to NSE.
    expect(getQuoteBySymbol("RELIANCE")).toBeNull();
  });

  it("E9: unambiguous symbol lookup stays backward compatible", () => {
    registerNseReliance();
    tickFor(NSE_RELIANCE.token, 1500.0);
    expect(getQuoteBySymbol("RELIANCE")?.ltp).toBe(1500.0);
    expect(allQuotes()["RELIANCE"]?.canonicalInstrumentId).toBe("NSE:EQUITY:RELIANCE");
  });

  it("E9b: every Yahoo index alias resolves to the one canonical index identity", () => {
    // Pre-existing defect fixed here: the second alias for a shared token was
    // previously unreachable because tokenToSymbol kept only the first.
    instrumentRegistry.register({
      exchange: "NSE", segment: "INDEX", tradingSymbol: "NIFTY FIN SERVICE",
      providerInstrumentToken: NSE_FINNIFTY.token, securityClass: "INDEX",
      aliases: ["^CNXFIN", "NIFTY_FIN_SERVICE.NS"],
      // Declared explicitly — exactly as getIndexIdentityByToken() supplies it.
      // The preferred key must come from a declaration, never from the order
      // aliases happen to appear in INDEX_TABLE.
      preferredAlias: "^CNXFIN",
    });
    tickFor(NSE_FINNIFTY.token, 23_400);
    expect(getQuoteBySymbol("^CNXFIN")?.ltp).toBe(23_400);
    expect(getQuoteBySymbol("NIFTY_FIN_SERVICE.NS")?.ltp).toBe(23_400);
    expect(getQuoteBySymbol("NIFTY FIN SERVICE")?.ltp).toBe(23_400);
    expect(quoteCount()).toBe(1);
    // Legacy snapshot keeps the alias existing consumers already use.
    expect(Object.keys(allQuotes())).toEqual(["^CNXFIN"]);
  });

  it("E10: the SSE tick payload carries canonicalInstrumentId and exchange", () => {
    registerNseReliance();
    const res = tickFor(NSE_RELIANCE.token, 1500.0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // routes/kite.ts serialises this object verbatim into the SSE frame.
    const payload = JSON.parse(JSON.stringify(res.tick));
    expect(payload.canonicalInstrumentId).toBe("NSE:EQUITY:RELIANCE");
    expect(payload.exchange).toBe("NSE");
    expect(payload.segment).toBe("EQUITY");
    expect(payload.instrumentToken).toBe(NSE_RELIANCE.token);
    expect(payload.provider).toBe("KITE");
    expect(payload.ts).toBe(TS);
  });

  it("E11: a ticker restart preserves canonical identity", () => {
    registerNseReliance();
    tickFor(NSE_RELIANCE.token, 1500.0);
    // stopTicker() clears quotes but not the identity catalogue.
    clearQuotes();
    expect(quoteCount()).toBe(0);
    expect(instrumentRegistry.resolveByToken(NSE_RELIANCE.token)?.canonicalInstrumentId)
      .toBe("NSE:EQUITY:RELIANCE");
    tickFor(NSE_RELIANCE.token, 1511.0);
    expect(getQuoteByCanonicalId("NSE:EQUITY:RELIANCE")?.ltp).toBe(1511.0);
  });

  it("E12: unregistered, unapproved or malformed values cannot enter the store", () => {
    const unknown = tickFor(4_242_424, 999);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe("UNKNOWN_PROVIDER_TOKEN");

    registerNseReliance();
    const badProvider = upsertQuote({
      providerInstrumentToken: NSE_RELIANCE.token,
      provider: "FIXTURE" as unknown as "KITE", ltp: 1, ts: TS,
    });
    expect(badProvider.ok).toBe(false);
    if (!badProvider.ok) expect(badProvider.reason).toBe("UNAPPROVED_PROVIDER");

    const badPrice = upsertQuote({
      providerInstrumentToken: NSE_RELIANCE.token, provider: "KITE", ltp: Number.NaN, ts: TS,
    });
    expect(badPrice.ok).toBe(false);
    if (!badPrice.ok) expect(badPrice.reason).toBe("INVALID_PRICE");

    const badToken = upsertQuote({
      providerInstrumentToken: 0, provider: "KITE", ltp: 1, ts: TS,
    });
    expect(badToken.ok).toBe(false);
    if (!badToken.ok) expect(badToken.reason).toBe("INVALID_PROVIDER_TOKEN");

    expect(quoteCount()).toBe(0);
  });

  it("E13: the subscription universe is unchanged by this task", () => {
    const feedSrc = readFileSync(new URL("./kiteFeed.ts", import.meta.url), "utf8");
    // Default equity subscription is still exactly the NIFTY 50 watchlist.
    expect(feedSrc).toMatch(/await subscribe\(NIFTY50_SYMBOLS\)/);
    // Equities still come solely from the NSE EQ dump; no BSE expansion.
    expect(feedSrc).toMatch(/getInstruments\(\["NSE"\]\)/);
    expect(feedSrc).not.toMatch(/getInstruments\(\["BSE"\]\)/);
    // No shard/limit machinery introduced.
    expect(feedSrc).not.toMatch(/7890|2630|shard|SHARD/);
  });

  it("E14: all four frozen safety locks remain false", () => {
    const candle = readFileSync(new URL("./candleEvaluationControl.ts", import.meta.url), "utf8");
    const v2 = readFileSync(new URL("./v2PaperLocks.ts", import.meta.url), "utf8");
    expect(candle).toMatch(/export const FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean;/);
    expect(candle).toMatch(/export const SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean;/);
    expect(v2).toMatch(/export const FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;/);
    expect(v2).toMatch(/export const SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;/);
  });
});

describe("P0.5A-F — provider-token reconciliation (code-review follow-up)", () => {
  it("F1: an identity cannot silently change provider token", () => {
    registerNseReliance();
    const res = instrumentRegistry.register({
      exchange: "NSE", segment: "EQUITY", tradingSymbol: "RELIANCE",
      providerInstrumentToken: 999_111,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("IDENTITY_TOKEN_CONFLICT");
    expect(instrumentRegistry.resolveByToken(NSE_RELIANCE.token)?.canonicalInstrumentId)
      .toBe("NSE:EQUITY:RELIANCE");
  });

  it("F2: register() NEVER rebinds — a rotation must go through prepare/commit", () => {
    // register() has no rebind opt-in at all. Installing a new token there
    // would silently orphan the old token's live subscription.
    registerNseReliance();
    tickFor(NSE_RELIANCE.token, 1500.0);

    const res = instrumentRegistry.register({
      exchange: "NSE", segment: "EQUITY", tradingSymbol: "RELIANCE",
      providerInstrumentToken: 999_111,
    });
    expect(res.ok).toBe(false);
    expect(instrumentRegistry.resolveById("NSE:EQUITY:RELIANCE")?.providerInstrumentToken)
      .toBe(NSE_RELIANCE.token);

    // prepare() reports the rotation without mutating anything.
    const prep = instrumentRegistry.prepareTokenRebind("NSE:EQUITY:RELIANCE", 999_111);
    expect(prep.status).toBe("REBIND_REQUIRED");
    if (prep.status === "REBIND_REQUIRED") expect(prep.previousToken).toBe(NSE_RELIANCE.token);
    expect(instrumentRegistry.resolveByToken(NSE_RELIANCE.token)).not.toBeNull();

    // commit() re-points atomically. The caller is responsible for having
    // unsubscribed the old token first (see providerTokenReconciliation.ts).
    const commit = instrumentRegistry.commitTokenRebind("NSE:EQUITY:RELIANCE", 999_111);
    expect(commit.ok).toBe(true);
    expect(instrumentRegistry.resolveByToken(NSE_RELIANCE.token)).toBeNull();
    expect(tickFor(NSE_RELIANCE.token, 1234.0).ok).toBe(false);
    expect(instrumentRegistry.resolveByToken(999_111)?.canonicalInstrumentId).toBe("NSE:EQUITY:RELIANCE");
    expect(tickFor(999_111, 1600.0).ok).toBe(true);
    expect(quoteCount()).toBe(1);
    expect(getQuoteByCanonicalId("NSE:EQUITY:RELIANCE")?.ltp).toBe(1600.0);
  });

  it("F3: a rebind still cannot steal a token owned by another identity", () => {
    registerNseReliance();
    registerBseReliance();
    const prep = instrumentRegistry.prepareTokenRebind("NSE:EQUITY:RELIANCE", BSE_RELIANCE.token);
    expect(prep.status).toBe("TOKEN_OWNED_BY_OTHER_IDENTITY");
    const commit = instrumentRegistry.commitTokenRebind("NSE:EQUITY:RELIANCE", BSE_RELIANCE.token);
    expect(commit.ok).toBe(false);
    if (!commit.ok) expect(commit.reason).toBe("DUPLICATE_TOKEN_CONFLICT");
    expect(instrumentRegistry.resolveByToken(BSE_RELIANCE.token)?.canonicalInstrumentId)
      .toBe("BSE:EQUITY:RELIANCE");
  });

  it("F4: only ids in canonical form parse as canonical ids", () => {
    expect(parseCanonicalInstrumentId("NSE:EQUITY:RELIANCE")).not.toBeNull();
    expect(parseCanonicalInstrumentId("NSE:EQUITY:reliance")).toBeNull();
    expect(parseCanonicalInstrumentId("NSE:EQUITY: RELIANCE")).toBeNull();
    expect(parseCanonicalInstrumentId("MCX:EQUITY:GOLD")).toBeNull();
    expect(parseCanonicalInstrumentId("NSE:FUTURES:RELIANCE")).toBeNull();
    expect(parseCanonicalInstrumentId("RELIANCE")).toBeNull();
  });
});
