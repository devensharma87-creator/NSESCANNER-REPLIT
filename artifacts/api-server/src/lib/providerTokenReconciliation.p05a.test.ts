/**
 * Data Foundation Phase 0.5A — Section B: provider-token rebind must never
 * leave an orphan subscription.
 *
 * WHY THIS MATTERS: the provider enforces a hard cap on concurrently
 * subscribed tokens. An orphan token consumes entitlement while delivering
 * ticks that resolve to nothing, so a rebind that "works" but leaks the old
 * token is a capacity regression, not a fix.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { instrumentRegistry } from "./canonicalInstrument";
import {
  reconcileProviderToken,
  _forTesting_clearPendingReconciliations,
  listPendingSubscriptionReconciliations,
  pendingReconciliationCount,
  type SubscriptionPort,
} from "./providerTokenReconciliation";
import { upsertQuote, getQuoteByCanonicalId, quoteCount, clearQuotes, evictQuote } from "./liveQuoteStore";

const ID = "NSE:EQUITY:RELIANCE";
const OLD_TOKEN = 738561;
const NEW_TOKEN = 999_111;
const BSE_ID = "BSE:EQUITY:RELIANCE";
const BSE_TOKEN = 128083204;

/** A fake ticker: records every subscription side-effect for assertion. */
function makePort(
  opts: { failUnsubscribe?: boolean; failSubscribeToken?: number; failAllSubscribes?: boolean } = {},
) {
  const subscribed = new Set<number>();
  const calls = { unsubscribe: [] as number[], subscribe: [] as number[], evict: [] as string[] };
  const port: SubscriptionPort = {
    isSubscribed: (t) => subscribed.has(t),
    unsubscribe: (t) => {
      calls.unsubscribe.push(t);
      if (opts.failUnsubscribe) throw new Error("socket write failed");
    },
    markUnsubscribed: (t) => { subscribed.delete(t); },
    subscribeToken: (t) => {
      calls.subscribe.push(t);
      if (opts.failAllSubscribes || opts.failSubscribeToken === t) throw new Error("socket write failed");
    },
    markSubscribed: (t) => { subscribed.add(t); },
    evictQuote: (id) => { calls.evict.push(id); evictQuote(id); },
  };
  return { port, subscribed, calls };
}

function registerReliance(token = OLD_TOKEN) {
  const r = instrumentRegistry.register({
    exchange: "NSE", segment: "EQUITY", tradingSymbol: "RELIANCE", providerInstrumentToken: token,
  });
  expect(r.ok).toBe(true);
}

function tick(token: number, ltp: number) {
  return upsertQuote({ providerInstrumentToken: token, provider: "KITE", ltp, ts: Date.now() });
}

beforeEach(() => {
  instrumentRegistry.clear();
  clearQuotes();
  _forTesting_clearPendingReconciliations();
});

describe("P0.5A-B — token rebind leaves no orphan subscription", () => {
  it("B1: the old token is unsubscribed BEFORE the new mapping is installed", () => {
    registerReliance();
    const { port, subscribed } = makePort();
    subscribed.add(OLD_TOKEN);

    const order: string[] = [];
    const spy: SubscriptionPort = {
      ...port,
      unsubscribe: (t) => { order.push(`unsubscribe:${t}`); },
      markUnsubscribed: (t) => { order.push(`drop:${t}`); subscribed.delete(t); },
      subscribeToken: (t) => { order.push(`subscribe:${t}`); },
      markSubscribed: (t) => { order.push(`add:${t}`); subscribed.add(t); },
    };
    // Observe registry state at the moment of unsubscribe: still the old token.
    const before = instrumentRegistry.resolveById(ID)?.providerInstrumentToken;

    const res = reconcileProviderToken({
      canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port: spy, nowMs: 1,
    });

    expect(before).toBe(OLD_TOKEN);
    expect(res.status).toBe("REBOUND");
    // The replacement is subscribed BEFORE the registry is committed, and the
    // old token is off the wire before that.
    expect(order).toEqual([
      `unsubscribe:${OLD_TOKEN}`, `drop:${OLD_TOKEN}`, `subscribe:${NEW_TOKEN}`, `add:${NEW_TOKEN}`,
    ]);
    expect(instrumentRegistry.resolveById(ID)?.providerInstrumentToken).toBe(NEW_TOKEN);
  });

  it("B2: the old token is unsubscribed exactly once", () => {
    registerReliance();
    const { port, subscribed, calls } = makePort();
    subscribed.add(OLD_TOKEN);

    reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port, nowMs: 1 });
    // A second pass over the same master must be a no-op, not a re-unsubscribe.
    const second = reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port, nowMs: 2 });

    expect(second.status).toBe("NOT_REQUIRED");
    expect(calls.unsubscribe).toEqual([OLD_TOKEN]);
  });

  it("B3: the old token is removed from the subscription set after unsubscribe", () => {
    registerReliance();
    const { port, subscribed } = makePort();
    subscribed.add(OLD_TOKEN);

    reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port, nowMs: 1 });

    expect(subscribed.has(OLD_TOKEN)).toBe(false);
  });

  it("B4: the retired token stops resolving and the new token owns the identity", () => {
    registerReliance();
    const { port, subscribed } = makePort();
    subscribed.add(OLD_TOKEN);

    reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port, nowMs: 1 });

    expect(instrumentRegistry.resolveByToken(OLD_TOKEN)).toBeNull();
    expect(instrumentRegistry.resolveByToken(NEW_TOKEN)?.canonicalInstrumentId).toBe(ID);
  });

  it("B5: a failed unsubscribe never creates two active tokens", () => {
    registerReliance();
    const { port, subscribed } = makePort({ failUnsubscribe: true });
    subscribed.add(OLD_TOKEN);

    const res = reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port, nowMs: 1 });

    expect(res.status).toBe("TOKEN_REBIND_REQUIRES_SUBSCRIPTION_RECONCILIATION");
    // Exactly one token is live, and it is the original one.
    expect([...subscribed]).toEqual([OLD_TOKEN]);
    // The new token was NOT installed anywhere.
    expect(instrumentRegistry.resolveByToken(NEW_TOKEN)).toBeNull();
    expect(instrumentRegistry.resolveById(ID)?.providerInstrumentToken).toBe(OLD_TOKEN);
  });

  it("B6: a failed unsubscribe keeps the existing valid token active and serving", () => {
    registerReliance();
    tick(OLD_TOKEN, 1500);
    const { port, subscribed } = makePort({ failUnsubscribe: true });
    subscribed.add(OLD_TOKEN);

    reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port, nowMs: 1 });

    // The instrument keeps working on its existing token — no silent outage.
    expect(tick(OLD_TOKEN, 1510).ok).toBe(true);
    expect(getQuoteByCanonicalId(ID)?.ltp).toBe(1510);
  });

  it("B7: a deferred rebind queues the identity for a controlled resubscription cycle", () => {
    registerReliance();
    const { port, subscribed } = makePort({ failUnsubscribe: true });
    subscribed.add(OLD_TOKEN);

    reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port, nowMs: 4242 });

    const pending = listPendingSubscriptionReconciliations();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      canonicalInstrumentId: ID, activeToken: OLD_TOKEN, desiredToken: NEW_TOKEN, recordedAtMs: 4242,
    });
  });

  it("B8: a successful rebind clears any queued reconciliation and does not grow the subscription count", () => {
    registerReliance();
    const failing = makePort({ failUnsubscribe: true });
    failing.subscribed.add(OLD_TOKEN);
    reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port: failing.port, nowMs: 1 });
    expect(pendingReconciliationCount()).toBe(1);

    const ok = makePort();
    ok.subscribed.add(OLD_TOKEN);
    const sizeBefore = ok.subscribed.size;
    const res = reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port: ok.port, nowMs: 2 });

    expect(res.status).toBe("REBOUND");
    expect(pendingReconciliationCount()).toBe(0);
    expect(ok.subscribed.size).toBe(sizeBefore);
    expect([...ok.subscribed]).toEqual([NEW_TOKEN]);
  });

  it("B9: a rebind cannot consume entitlement through orphan tokens across repeated rotations", () => {
    registerReliance();
    const { port, subscribed } = makePort();
    subscribed.add(OLD_TOKEN);

    // Three successive provider rotations.
    for (const t of [NEW_TOKEN, NEW_TOKEN + 1, NEW_TOKEN + 2]) {
      const res = reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: t, port, nowMs: 1 });
      expect(res.status).toBe("REBOUND");
    }

    // One instrument must still occupy exactly one subscription slot.
    expect(subscribed.size).toBe(1);
    expect([...subscribed]).toEqual([NEW_TOKEN + 2]);
    // Every retired token is dead to resolution.
    for (const t of [OLD_TOKEN, NEW_TOKEN, NEW_TOKEN + 1]) {
      expect(instrumentRegistry.resolveByToken(t)).toBeNull();
    }
  });

  it("B10: a late tick on the retired token is dropped, and the stale quote is evicted", () => {
    registerReliance();
    tick(OLD_TOKEN, 1500);
    expect(quoteCount()).toBe(1);

    const { port, subscribed, calls } = makePort();
    subscribed.add(OLD_TOKEN);
    reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port, nowMs: 1 });

    // The quote was priced off a token that no longer identifies this
    // instrument, so it must not survive the rotation.
    expect(calls.evict).toEqual([ID]);
    expect(getQuoteByCanonicalId(ID)).toBeNull();
    expect(quoteCount()).toBe(0);

    // A straggling tick on the old token resolves to nothing.
    expect(tick(OLD_TOKEN, 1234).ok).toBe(false);
    expect(quoteCount()).toBe(0);

    expect(tick(NEW_TOKEN, 1600).ok).toBe(true);
    expect(getQuoteByCanonicalId(ID)?.ltp).toBe(1600);
    expect(quoteCount()).toBe(1);
  });

  it("B11: a rebind cannot steal a token owned by another identity, and mutates nothing", () => {
    registerReliance();
    instrumentRegistry.register({
      exchange: "BSE", segment: "EQUITY", tradingSymbol: "RELIANCE", providerInstrumentToken: BSE_TOKEN,
    });
    const { port, subscribed, calls } = makePort();
    subscribed.add(OLD_TOKEN);
    subscribed.add(BSE_TOKEN);

    const res = reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: BSE_TOKEN, port, nowMs: 1 });

    expect(res.status).toBe("REJECTED");
    if (res.status === "REJECTED") expect(res.reason).toBe("DUPLICATE_TOKEN_CONFLICT");
    // Nothing was unsubscribed and both instruments still resolve correctly.
    expect(calls.unsubscribe).toEqual([]);
    expect(subscribed.size).toBe(2);
    expect(instrumentRegistry.resolveByToken(BSE_TOKEN)?.canonicalInstrumentId).toBe(BSE_ID);
    expect(instrumentRegistry.resolveByToken(OLD_TOKEN)?.canonicalInstrumentId).toBe(ID);
  });

  it("B12: a failed replacement subscribe restores the old token — never zero active tokens", () => {
    // The dangerous window: the old token is already retired. If the
    // replacement subscribe fails and nothing unwinds it, the instrument goes
    // dark while the subscription set still claims it is covered.
    registerReliance();
    const { port, subscribed, calls } = makePort({ failSubscribeToken: NEW_TOKEN });
    subscribed.add(OLD_TOKEN);

    const res = reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port, nowMs: 7 });

    expect(res.status).toBe("TOKEN_REBIND_REQUIRES_SUBSCRIPTION_RECONCILIATION");
    // Exactly one active token, and it is the original.
    expect([...subscribed]).toEqual([OLD_TOKEN]);
    expect(calls.subscribe).toEqual([NEW_TOKEN, OLD_TOKEN]);
    // The registry was never re-pointed.
    expect(instrumentRegistry.resolveById(ID)?.providerInstrumentToken).toBe(OLD_TOKEN);
    expect(instrumentRegistry.resolveByToken(NEW_TOKEN)).toBeNull();
    expect(instrumentRegistry.resolveByToken(OLD_TOKEN)?.canonicalInstrumentId).toBe(ID);
    // Ticks keep flowing on the surviving token.
    expect(tick(OLD_TOKEN, 1520).ok).toBe(true);
    // And the rotation is queued rather than lost.
    expect(listPendingSubscriptionReconciliations()).toHaveLength(1);
  });

  it("B13: if even the restore fails, the failure is recorded rather than silently swallowed", () => {
    registerReliance();
    const { port, subscribed } = makePort({ failAllSubscribes: true });
    subscribed.add(OLD_TOKEN);

    const res = reconcileProviderToken({ canonicalInstrumentId: ID, desiredToken: NEW_TOKEN, port, nowMs: 9 });

    expect(res.status).toBe("TOKEN_REBIND_REQUIRES_SUBSCRIPTION_RECONCILIATION");
    // The registry still points at the old token, so no orphan identity exists
    // and the rotation is explicitly queued for operator attention.
    expect(instrumentRegistry.resolveById(ID)?.providerInstrumentToken).toBe(OLD_TOKEN);
    const pending = listPendingSubscriptionReconciliations();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.activeToken).toBe(OLD_TOKEN);
    expect(pending[0]!.detail).toMatch(/could not be restored/);
  });

  it("B14: an unknown identity is not a rebind — the caller registers it fresh", () => {
    const { port, calls } = makePort();
    const res = reconcileProviderToken({
      canonicalInstrumentId: "NSE:EQUITY:NEWCO", desiredToken: 4242, port, nowMs: 1,
    });
    expect(res.status).toBe("NOT_REQUIRED");
    expect(calls.unsubscribe).toEqual([]);
    expect(pendingReconciliationCount()).toBe(0);
  });
});
