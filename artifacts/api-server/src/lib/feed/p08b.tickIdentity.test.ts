/**
 * PHASE 0.8B — GATE D: TICK IDENTITY
 *
 * Every rejection path that stops a tick being written under the wrong
 * identity, plus the guarantee that an absent field never becomes a zero.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ingestTick, type TickAdmissionContext } from "./tickIngestion";
import type { FeedTickEnvelope } from "./feedClientPort";
import { instrumentRegistry } from "../canonicalInstrument";
import { clearQuotes, getQuoteByCanonicalId, quoteCount } from "../liveQuoteStore";

const GEN = "gen-p08b-0001";
const TOKEN = 500001;
const CANONICAL = "NSE:EQUITY:TESTSYMA";

function ctx(over: Partial<TickAdmissionContext> = {}): TickAdmissionContext {
  return {
    accepting: true,
    planGenerationId: GEN,
    currentGenerationId: GEN,
    tokenToShardId: new Map([[TOKEN, 0]]),
    getShardHash: (_shardId) => "shard-hash-test",
    completeManifestHash: "complete-hash-test",
    ...over,
  };
}

function tick(over: Partial<FeedTickEnvelope> = {}): FeedTickEnvelope {
  return { providerToken: TOKEN, ltp: 101.5, receivedTimestamp: 1_700_000_000_000, ...over };
}

beforeEach(() => {
  instrumentRegistry.clear();
  clearQuotes();
  const r = instrumentRegistry.register({
    exchange: "NSE",
    segment: "EQUITY",
    tradingSymbol: "TESTSYMA",
    providerInstrumentToken: TOKEN,
  });
  expect(r.ok).toBe(true);
});

describe("P0.8B Gate D — admission refusals", () => {
  it("D1: a tick is refused when the manager is not accepting", () => {
    const res = ingestTick(tick(), 0, ctx({ accepting: false }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("FEED_NOT_ACCEPTING");
    expect(quoteCount()).toBe(0);
  });

  it("D2: a generation mismatch is refused", () => {
    const res = ingestTick(tick(), 0, ctx({ currentGenerationId: "gen-other" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("REGISTRY_GENERATION_MISMATCH");
    expect(quoteCount()).toBe(0);
  });

  it("D3: an absent generation id is refused, never treated as a match", () => {
    const a = ingestTick(tick(), 0, ctx({ currentGenerationId: null }));
    const b = ingestTick(tick(), 0, ctx({ planGenerationId: null }));
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe("REGISTRY_GENERATION_MISMATCH");
    if (!b.ok) expect(b.reason).toBe("REGISTRY_GENERATION_MISMATCH");
  });

  it("D4: two null generation ids do NOT satisfy the equality check", () => {
    const res = ingestTick(tick(), 0, ctx({ planGenerationId: null, currentGenerationId: null }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("REGISTRY_GENERATION_MISMATCH");
  });

  it("D5: a token this manager does not subscribe is refused", () => {
    const res = ingestTick(tick({ providerToken: 999999 }), 0, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("TOKEN_NOT_SUBSCRIBED");
  });

  it("D6: a token arriving on the wrong shard is refused", () => {
    const res = ingestTick(tick(), 2, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("TOKEN_ARRIVED_ON_WRONG_SHARD");
    expect(quoteCount()).toBe(0);
  });

  it("D7: a token that resolves to no registry identity is refused, not symbol-matched", () => {
    // Subscribed by the manager, but absent from the canonical registry.
    const orphan = 777777;
    const res = ingestTick(
      tick({ providerToken: orphan }),
      0,
      ctx({ tokenToShardId: new Map([[orphan, 0]]) }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("UNKNOWN_PROVIDER_TOKEN");
    expect(quoteCount()).toBe(0);
  });

  it("D8: a structurally invalid provider token is refused", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const res = ingestTick(
        tick({ providerToken: bad }),
        0,
        ctx({ tokenToShardId: new Map([[bad, 0]]) }),
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("INVALID_PROVIDER_TOKEN");
    }
  });

  it("D9: a non-finite price is refused", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const res = ingestTick(tick({ ltp: bad }), 0, ctx());
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("INVALID_PRICE");
    }
    expect(quoteCount()).toBe(0);
  });

  it("D10: a non-positive or non-finite receivedTimestamp is refused", () => {
    for (const bad of [0, -5, Number.NaN]) {
      const res = ingestTick(tick({ receivedTimestamp: bad }), 0, ctx());
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("INVALID_TIMESTAMP");
    }
  });
});

describe("P0.8B Gate D — admission and field honesty", () => {
  it("D11: a valid tick is stored under the canonical exchange-qualified id", () => {
    const res = ingestTick(tick(), 0, ctx());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.canonicalInstrumentId).toBe(CANONICAL);
    const stored = getQuoteByCanonicalId(CANONICAL);
    expect(stored).not.toBeNull();
    expect(stored?.ltp).toBe(101.5);
    expect(stored?.exchange).toBe("NSE");
    expect(stored?.segment).toBe("EQUITY");
  });

  it("D12: an absent optional field stays absent — it is never zero-filled", () => {
    const res = ingestTick(tick(), 0, ctx());
    expect(res.ok).toBe(true);
    const stored = getQuoteByCanonicalId(CANONICAL);
    expect(stored?.volume).toBeUndefined();
    expect(stored?.open).toBeUndefined();
    expect(stored?.changePercent).toBeUndefined();
    // The distinction that matters: undefined, NOT 0.
    expect(stored?.volume).not.toBe(0);
  });

  it("D13: a present optional field is copied through unchanged", () => {
    ingestTick(tick({ open: 100, high: 102, low: 99, close: 100.5, volume: 4242 }), 0, ctx());
    const stored = getQuoteByCanonicalId(CANONICAL);
    expect(stored?.open).toBe(100);
    expect(stored?.high).toBe(102);
    expect(stored?.low).toBe(99);
    expect(stored?.close).toBe(100.5);
    expect(stored?.volume).toBe(4242);
  });

  it("D14: a genuine zero is preserved as zero, not treated as absent", () => {
    ingestTick(tick({ volume: 0 }), 0, ctx());
    expect(getQuoteByCanonicalId(CANONICAL)?.volume).toBe(0);
  });

  it("D15: a present-but-unusable optional field rejects the tick instead of being dropped", () => {
    const res = ingestTick(tick({ volume: Number.NaN }), 0, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("INVALID_OPTIONAL_FIELD");
      expect(res.detail).toBe("volume");
    }
    // Nothing partial was written.
    expect(quoteCount()).toBe(0);
  });

  it("D16: a later valid tick replaces the earlier one under the same identity", () => {
    ingestTick(tick({ ltp: 100, receivedTimestamp: 1_700_000_000_000 }), 0, ctx());
    ingestTick(tick({ ltp: 105, receivedTimestamp: 1_700_000_060_000 }), 0, ctx());
    expect(quoteCount()).toBe(1);
    expect(getQuoteByCanonicalId(CANONICAL)?.ltp).toBe(105);
  });
});
