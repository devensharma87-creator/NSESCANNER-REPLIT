/**
 * Data Foundation Phase 0.5A — Section C: index alias invariant.
 *
 * One provider token is ONE canonical index instrument. Several Yahoo-style
 * aliases legitimately point at the same token (OBSERVED: INDEX_TABLE has 9
 * alias rows but only 8 distinct tokens — "^CNXFIN" and
 * "NIFTY_FIN_SERVICE.NS" share token 257801). Aliases must therefore be
 * metadata on one instrument, never a reason to mint a second one.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { instrumentRegistry } from "./canonicalInstrument";
import { upsertQuote, getQuoteByCanonicalId, quoteCount, clearQuotes, allQuotes } from "./liveQuoteStore";

const FIN_TOKEN = 257801;
const FIN_ID = "NSE:INDEX:NIFTY FIN SERVICE";
const ALIASES = ["^CNXFIN", "NIFTY_FIN_SERVICE.NS"];

/** Mirrors exactly what subscribeIndices passes for the shared-token index. */
function registerFinService(aliases: string[], preferredAlias = "^CNXFIN") {
  return instrumentRegistry.register({
    exchange: "NSE",
    segment: "INDEX",
    tradingSymbol: "NIFTY FIN SERVICE",
    providerInstrumentToken: FIN_TOKEN,
    securityClass: "INDEX",
    aliases,
    preferredAlias,
  });
}

function tick(token: number, ltp: number) {
  return upsertQuote({ providerInstrumentToken: token, provider: "KITE", ltp, ts: Date.now() });
}

beforeEach(() => {
  instrumentRegistry.clear();
  clearQuotes();
});

describe("P0.5A-C — index aliases canonicalize to one instrument", () => {
  it("C1: two aliases sharing one token produce exactly ONE identity", () => {
    const res = registerFinService(ALIASES);
    expect(res.ok).toBe(true);
    expect(instrumentRegistry.size()).toBe(1);
    expect(instrumentRegistry.listAll()).toHaveLength(1);
  });

  it("C2: every alias resolves to the same canonical id", () => {
    registerFinService(ALIASES);
    for (const a of ALIASES) {
      const r = instrumentRegistry.resolveBySymbol(a);
      expect(r.status).toBe("UNIQUE");
      if (r.status === "UNIQUE") expect(r.identity.canonicalInstrumentId).toBe(FIN_ID);
    }
    // The exchange trading symbol resolves to it too.
    const byTs = instrumentRegistry.resolveBySymbol("NIFTY FIN SERVICE");
    expect(byTs.status).toBe("UNIQUE");
  });

  it("C3: the previously unresolvable alias now resolves", () => {
    // Regression lock. The old loop `continue`d before recording the second
    // alias, so NIFTY_FIN_SERVICE.NS was permanently unresolvable.
    registerFinService(ALIASES);
    const r = instrumentRegistry.resolveBySymbol("NIFTY_FIN_SERVICE.NS");
    expect(r.status).toBe("UNIQUE");
    if (r.status === "UNIQUE") expect(r.identity.canonicalInstrumentId).toBe(FIN_ID);
  });

  it("C4: a tick on the shared token stores exactly one quote and counts once", () => {
    registerFinService(ALIASES);
    tick(FIN_TOKEN, 23_100.5);
    tick(FIN_TOKEN, 23_105.0);

    expect(quoteCount()).toBe(1);
    expect(getQuoteByCanonicalId(FIN_ID)?.ltp).toBe(23_105.0);
    // The legacy-shaped snapshot exposes one row, not one per alias.
    expect(Object.keys(allQuotes())).toHaveLength(1);
  });

  it("C5: one tick yields one canonical identity for emission, with aliases as metadata", () => {
    registerFinService(ALIASES);
    const stored = tick(FIN_TOKEN, 23_100.5);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    // A single tick object carries one identity — an SSE listener fires once.
    expect(stored.tick.canonicalInstrumentId).toBe(FIN_ID);
    expect(stored.tick.tradingSymbol).toBe("NIFTY FIN SERVICE");
    // Aliases are lookup metadata pointing back at this one identity — they
    // are not fields that could mint a second instrument.
    for (const a of ALIASES) {
      const r = instrumentRegistry.resolveBySymbol(a);
      expect(r.status === "UNIQUE" && r.identity.canonicalInstrumentId).toBe(FIN_ID);
    }
  });

  it("C6: reversing alias registration order produces the SAME preferred identity", () => {
    registerFinService([...ALIASES]);
    const forward = instrumentRegistry.resolveById(FIN_ID);

    instrumentRegistry.clear();
    registerFinService([...ALIASES].reverse());
    const reversed = instrumentRegistry.resolveById(FIN_ID);

    expect(reversed?.canonicalInstrumentId).toBe(forward?.canonicalInstrumentId);
    expect(reversed?.primaryAlias).toBe(forward?.primaryAlias);
    expect(reversed?.primaryAlias).toBe("^CNXFIN");
  });

  it("C7: the preferred symbol is deterministic across a simulated restart", () => {
    const seen = new Set<string>();
    for (let restart = 0; restart < 4; restart++) {
      instrumentRegistry.clear();
      clearQuotes();
      // Shuffle the alias order the way a reordered source table would.
      const order = restart % 2 === 0 ? [...ALIASES] : [...ALIASES].reverse();
      registerFinService(order);
      const id = instrumentRegistry.resolveById(FIN_ID);
      expect(id).not.toBeNull();
      seen.add(id!.primaryAlias);
    }
    expect([...seen]).toEqual(["^CNXFIN"]);
  });

  it("C8: with no declared preference the preferred alias is order-independent, never positional", () => {
    // Lexicographically smallest wins — the same answer whichever order the
    // aliases arrive in, so reordering INDEX_TABLE cannot change it.
    registerFinService([...ALIASES], /* preferredAlias */ "");
    const a = instrumentRegistry.resolveById(FIN_ID)?.primaryAlias;

    instrumentRegistry.clear();
    registerFinService([...ALIASES].reverse(), "");
    const b = instrumentRegistry.resolveById(FIN_ID)?.primaryAlias;

    expect(a).toBe(b);
    // "NIFTY FIN SERVICE" < "NIFTY_FIN_SERVICE.NS" < "^CNXFIN" in ASCII.
    expect(a).toBe("NIFTY FIN SERVICE");
  });

  it("C9: a declared preference that is not a real alias falls back deterministically", () => {
    registerFinService([...ALIASES], "NOT_AN_ALIAS");
    expect(instrumentRegistry.resolveById(FIN_ID)?.primaryAlias).toBe("NIFTY FIN SERVICE");
  });

  it("C10: a second index token is a separate instrument — aliases never merge distinct tokens", () => {
    registerFinService(ALIASES);
    instrumentRegistry.register({
      exchange: "NSE", segment: "INDEX", tradingSymbol: "NIFTY BANK",
      providerInstrumentToken: 260105, securityClass: "INDEX",
      aliases: ["^NSEBANK"], preferredAlias: "^NSEBANK",
    });
    tick(FIN_TOKEN, 23_100);
    tick(260105, 51_200);

    expect(instrumentRegistry.size()).toBe(2);
    expect(quoteCount()).toBe(2);
    expect(getQuoteByCanonicalId(FIN_ID)?.ltp).toBe(23_100);
    expect(getQuoteByCanonicalId("NSE:INDEX:NIFTY BANK")?.ltp).toBe(51_200);
  });
});
