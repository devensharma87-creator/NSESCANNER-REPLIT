/**
 * PHASE 0.8B — GATE G: CANONICAL QUOTE RECORD
 *
 * Every accepted tick must produce a stored record with the full canonical
 * provenance contract: identity fields from the registry, both timestamps kept
 * distinct (exchangeTimestamp absent when provider did not supply it), and all
 * provenance fields from the admission context.
 *
 * The honesty invariants:
 * - exchangeTimestamp is null when the provider did not supply one — never
 *   replaced by the receipt time.
 * - lastValidTimestamp is null on first write, then the PREVIOUS receivedTimestamp.
 * - conflictStatus is NOT_EVALUATED — honest for Phase 0.8B.
 * - freshnessState is NOT_EVALUATED — honest for Phase 0.8B.
 * - validationStatus is ACCEPTED for canonical writes.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ingestTick, type TickAdmissionContext } from "./tickIngestion";
import type { FeedTickEnvelope } from "./feedClientPort";
import { instrumentRegistry } from "../canonicalInstrument";
import { clearQuotes, getQuoteByCanonicalId, quoteCount } from "../liveQuoteStore";

const GEN = "gen-g-canon-0001";
const TOKEN_A = 601001;
const TOKEN_B = 601002;
const TOKEN_NSE = 601010;
const TOKEN_BSE = 601011;
const TOKEN_IDX = 601020;
const SHARD_ID = 1;
const SHARD_HASH = "hash-shard-1-test";
const COMPLETE_HASH = "complete-manifest-hash-test";

function ctx(over: Partial<TickAdmissionContext> = {}): TickAdmissionContext {
  const map = new Map<number, number>([
    [TOKEN_A, SHARD_ID],
    [TOKEN_B, SHARD_ID],
    [TOKEN_NSE, SHARD_ID],
    [TOKEN_BSE, SHARD_ID],
    [TOKEN_IDX, SHARD_ID],
  ]);
  return {
    accepting: true,
    planGenerationId: GEN,
    currentGenerationId: GEN,
    tokenToShardId: map,
    getShardHash: (_shardId) => SHARD_HASH,
    completeManifestHash: COMPLETE_HASH,
    ...over,
  };
}

function env(
  token: number,
  over: Partial<FeedTickEnvelope> = {},
): FeedTickEnvelope {
  return {
    providerToken: token,
    ltp: 500.0,
    receivedTimestamp: 1_700_000_000_000,
    ...over,
  };
}

beforeEach(() => {
  instrumentRegistry.clear();
  clearQuotes();
});

function regNse(symbol: string, token: number) {
  const r = instrumentRegistry.register({
    exchange: "NSE",
    segment: "EQUITY",
    tradingSymbol: symbol,
    providerInstrumentToken: token,
  });
  expect(r.ok).toBe(true);
}

describe("P0.8B Gate G — mandatory field completeness", () => {
  it("G1: all mandatory provenance fields are present on every accepted tick", () => {
    regNse("TESTSYMG", TOKEN_A);
    const res = ingestTick(env(TOKEN_A), SHARD_ID, ctx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const q = getQuoteByCanonicalId(res.canonicalInstrumentId)!;
    expect(q).toBeDefined();

    // Identity
    expect(typeof q.canonicalInstrumentId).toBe("string");
    expect(q.canonicalInstrumentId.length).toBeGreaterThan(0);
    expect(q.exchange).toBe("NSE");
    expect(q.segment).toBe("EQUITY");
    expect(typeof q.tradingSymbol).toBe("string");
    expect(q.provider).toBe("KITE");

    // Timestamps — both must be present (or null with correct reason)
    expect(typeof q.receivedTimestamp).toBe("number");
    expect(Number.isFinite(q.receivedTimestamp)).toBe(true);
    expect(q.receivedTimestamp).toBeGreaterThan(0);
    // exchangeTimestamp absent from envelope → must be null, not fabricated
    expect(q.exchangeTimestamp).toBeNull();
    // ts backward-compat alias
    expect(q.ts).toBe(q.receivedTimestamp);

    // Provenance
    expect(q.registryGenerationId).toBe(GEN);
    expect(q.shardId).toBe(SHARD_ID);
    expect(q.subscriptionSetHash).toBe(SHARD_HASH);
    expect(q.completeManifestHash).toBe(COMPLETE_HASH);

    // Status fields
    expect(q.validationStatus).toBe("ACCEPTED");
    expect(q.freshnessState).toBe("NOT_EVALUATED");
    expect(q.conflictStatus).toBe("NOT_EVALUATED");
  });

  it("G2: two NSE+BSE instruments with same display symbol get distinct canonical ids, no collision", () => {
    regNse("DUALSYM", TOKEN_NSE);
    const r2 = instrumentRegistry.register({
      exchange: "BSE",
      segment: "EQUITY",
      tradingSymbol: "DUALSYM",
      providerInstrumentToken: TOKEN_BSE,
    });
    expect(r2.ok).toBe(true);

    const res1 = ingestTick(env(TOKEN_NSE, { ltp: 200.0 }), SHARD_ID, ctx());
    const res2 = ingestTick(env(TOKEN_BSE, { ltp: 201.0 }), SHARD_ID, ctx());

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    if (!res1.ok || !res2.ok) return;

    expect(res1.canonicalInstrumentId).not.toBe(res2.canonicalInstrumentId);
    expect(res1.canonicalInstrumentId).toContain("NSE:");
    expect(res2.canonicalInstrumentId).toContain("BSE:");

    const q1 = getQuoteByCanonicalId(res1.canonicalInstrumentId)!;
    const q2 = getQuoteByCanonicalId(res2.canonicalInstrumentId)!;
    expect(q1.ltp).toBe(200.0);
    expect(q2.ltp).toBe(201.0);
    expect(quoteCount()).toBe(2);
  });

  it("G3: index instrument gets correct exchange, segment, and securityClass", () => {
    const r = instrumentRegistry.register({
      exchange: "NSE",
      segment: "INDEX",
      tradingSymbol: "NIFTY 50",
      providerInstrumentToken: TOKEN_IDX,
    });
    expect(r.ok).toBe(true);

    const res = ingestTick(env(TOKEN_IDX), SHARD_ID, ctx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const q = getQuoteByCanonicalId(res.canonicalInstrumentId)!;
    expect(q.exchange).toBe("NSE");
    expect(q.segment).toBe("INDEX");
    expect(q.canonicalInstrumentId).toContain("INDEX");
  });
});

describe("P0.8B Gate G — timestamp contract", () => {
  it("G4: exchangeTimestamp is set when provider supplies it, null when absent", () => {
    regNse("TESTSYMG4", TOKEN_A);
    const EXCHANGE_TS = 1_700_000_010_000;

    // With exchangeTimestamp
    const res1 = ingestTick(
      env(TOKEN_A, { exchangeTimestamp: EXCHANGE_TS, receivedTimestamp: 1_700_000_020_000 }),
      SHARD_ID,
      ctx(),
    );
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;
    const q1 = getQuoteByCanonicalId(res1.canonicalInstrumentId)!;
    expect(q1.exchangeTimestamp).not.toBeNull();
    expect(q1.exchangeTimestamp!.getTime()).toBe(EXCHANGE_TS);
    expect(q1.receivedTimestamp).toBe(1_700_000_020_000);

    // Without exchangeTimestamp — different instrument to avoid lastValidTimestamp confusion
    regNse("TESTSYMG4B", TOKEN_B);
    const res2 = ingestTick(
      env(TOKEN_B, { receivedTimestamp: 1_700_000_030_000 }),
      SHARD_ID,
      ctx(),
    );
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    const q2 = getQuoteByCanonicalId(res2.canonicalInstrumentId)!;
    expect(q2.exchangeTimestamp).toBeNull();
    expect(q2.receivedTimestamp).toBe(1_700_000_030_000);
  });

  it("G5: receivedTimestamp is always present and equals the envelope value", () => {
    regNse("TESTSYMG5", TOKEN_A);
    const RECV = 1_700_099_000_000;
    const res = ingestTick(env(TOKEN_A, { receivedTimestamp: RECV }), SHARD_ID, ctx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const q = getQuoteByCanonicalId(res.canonicalInstrumentId)!;
    expect(q.receivedTimestamp).toBe(RECV);
  });

  it("G6: ts backward-compat alias = exchangeTimestamp.getTime() when present, else receivedTimestamp", () => {
    regNse("TESTSYMG6A", TOKEN_A);
    regNse("TESTSYMG6B", TOKEN_B);

    // With exchangeTimestamp
    const EXCH = 1_700_000_010_000;
    const RECV1 = 1_700_000_020_000;
    ingestTick(env(TOKEN_A, { exchangeTimestamp: EXCH, receivedTimestamp: RECV1 }), SHARD_ID, ctx());
    const q1 = getQuoteByCanonicalId("NSE:EQUITY:TESTSYMG6A")!;
    expect(q1.ts).toBe(EXCH);

    // Without exchangeTimestamp
    const RECV2 = 1_700_000_030_000;
    ingestTick(env(TOKEN_B, { receivedTimestamp: RECV2 }), SHARD_ID, ctx());
    const q2 = getQuoteByCanonicalId("NSE:EQUITY:TESTSYMG6B")!;
    expect(q2.ts).toBe(RECV2);
  });
});

describe("P0.8B Gate G — provenance binding", () => {
  it("G7: registryGenerationId matches the context planGenerationId", () => {
    regNse("TESTSYMG7", TOKEN_A);
    const res = ingestTick(env(TOKEN_A), SHARD_ID, ctx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const q = getQuoteByCanonicalId(res.canonicalInstrumentId)!;
    expect(q.registryGenerationId).toBe(GEN);
  });

  it("G8: shardId matches the shard that delivered the tick", () => {
    regNse("TESTSYMG8", TOKEN_A);
    const res = ingestTick(env(TOKEN_A), SHARD_ID, ctx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const q = getQuoteByCanonicalId(res.canonicalInstrumentId)!;
    expect(q.shardId).toBe(SHARD_ID);
  });

  it("G9: subscriptionSetHash = getShardHash(deliveryShard)", () => {
    regNse("TESTSYMG9", TOKEN_A);
    const CUSTOM_HASH = "shard-1-custom-hash";
    const res = ingestTick(env(TOKEN_A), SHARD_ID, ctx({ getShardHash: () => CUSTOM_HASH }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const q = getQuoteByCanonicalId(res.canonicalInstrumentId)!;
    expect(q.subscriptionSetHash).toBe(CUSTOM_HASH);
  });

  it("G10: completeManifestHash = ctx.completeManifestHash", () => {
    regNse("TESTSYMG10", TOKEN_A);
    const CUSTOM_CMH = "complete-custom-hash";
    const res = ingestTick(env(TOKEN_A), SHARD_ID, ctx({ completeManifestHash: CUSTOM_CMH }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const q = getQuoteByCanonicalId(res.canonicalInstrumentId)!;
    expect(q.completeManifestHash).toBe(CUSTOM_CMH);
  });
});

describe("P0.8B Gate G — lastValidTimestamp progression", () => {
  it("G11: lastValidTimestamp is null on first write — nothing to be valid before", () => {
    regNse("TESTSYMG11", TOKEN_A);
    const res = ingestTick(env(TOKEN_A, { receivedTimestamp: 1_700_000_001_000 }), SHARD_ID, ctx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const q = getQuoteByCanonicalId(res.canonicalInstrumentId)!;
    expect(q.lastValidTimestamp).toBeNull();
  });

  it("G12: lastValidTimestamp on second write = receivedTimestamp of the first write", () => {
    regNse("TESTSYMG12", TOKEN_A);
    const T1 = 1_700_000_001_000;
    const T2 = 1_700_000_002_000;

    ingestTick(env(TOKEN_A, { receivedTimestamp: T1 }), SHARD_ID, ctx());
    ingestTick(env(TOKEN_A, { receivedTimestamp: T2 }), SHARD_ID, ctx());

    const q = getQuoteByCanonicalId("NSE:EQUITY:TESTSYMG12")!;
    expect(q.receivedTimestamp).toBe(T2);
    expect(q.lastValidTimestamp).toBe(T1);
  });

  it("G13: validationStatus = ACCEPTED for canonical writes through the ingestion gate", () => {
    regNse("TESTSYMG13", TOKEN_A);
    const res = ingestTick(env(TOKEN_A), SHARD_ID, ctx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const q = getQuoteByCanonicalId(res.canonicalInstrumentId)!;
    expect(q.validationStatus).toBe("ACCEPTED");
    expect(q.conflictStatus).toBe("NOT_EVALUATED");
    expect(q.freshnessState).toBe("NOT_EVALUATED");
  });
});
