/**
 * PHASE 0.8B — GATE B: TRANSACTIONAL STARTUP AND ROLLBACK
 *
 * The property under test: a start attempt either holds EVERY shard or holds
 * NONE. There is no intermediate outcome that reports success.
 */

import { describe, it, expect } from "vitest";
import { createFeedManagerForTesting } from "./feedManager";
import {
  makeFakeClientHarness,
  makePlan,
  makeAllPassDecision,
  TEST_GENERATION_ID,
} from "./testing/p08bFixtures";
import type { FakeClientBehavior } from "./testing/p08bFixtures";

function build(behavior: FakeClientBehavior = {}, shardSizes: number[] = [3, 3, 3]) {
  const h = makeFakeClientHarness(behavior);
  const dec = makeAllPassDecision(makePlan(shardSizes));
  const m = createFeedManagerForTesting({
    clientFactory: h.factory,
    getActivation: () => dec,
    getCurrentGenerationId: () => TEST_GENERATION_ID,
  });
  return { h, m, dec };
}

describe("P0.8B Gate B — the happy path", () => {
  it("B1: every shard connected and fully subscribed reaches RUNNING", async () => {
    const { h, m } = build();
    const out = await m.start();
    expect(out.started).toBe(true);
    expect(out.state).toBe("RUNNING");
    expect(out.blocker).toBeNull();
    expect(h.constructed).toHaveLength(3);
    expect(m.diagnostics().clientsHeld).toBe(3);
  });

  it("B2: one client is constructed per non-empty shard, no more", async () => {
    const { h, m } = build({}, [2, 2]);
    await m.start();
    expect(h.callsOfKind("CONSTRUCT")).toHaveLength(2);
    expect(h.constructed.map((c) => c.shardId)).toEqual([0, 1]);
  });

  it("B3: every token is mapped to exactly one shard", async () => {
    const { m, dec } = build({}, [3, 3, 3]);
    await m.start();
    const map = m.subscribedTokenMap();
    expect(map.size).toBe(9);
    for (const shard of dec.plan.shards) {
      for (const token of shard.tokens) expect(map.get(token)).toBe(shard.shardId);
    }
  });
});

describe("P0.8B Gate B — failure is total", () => {
  it("B4: a connect failure on the last shard lands in FAILED", async () => {
    const { m } = build({ connectFailsOn: new Set([2]) });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("FAILED");
    expect(out.blocker).toBe("CLIENT_CONNECT_FAILED");
  });

  it("B5: rollback closes every client opened earlier in the attempt", async () => {
    const { h, m } = build({ connectFailsOn: new Set([2]) });
    await m.start();
    // Shards 0 and 1 fully succeeded, shard 2 was constructed then failed.
    // All three must have been closed.
    expect(h.callsOfKind("CLOSE").map((c) => c.shardId).sort()).toEqual([0, 1, 2]);
    expect(h.constructed.every((c) => c.closed())).toBe(true);
  });

  it("B6: no clients remain held after a failed start", async () => {
    const { h, m } = build({ connectFailsOn: new Set([1]) });
    await m.start();
    expect(m.diagnostics().clientsHeld).toBe(0);
    expect(h.liveCount()).toBe(0);
  });

  it("B7: the token map is empty after a failed start", async () => {
    const { m } = build({ connectFailsOn: new Set([1]) });
    await m.start();
    expect(m.subscribedTokenMap().size).toBe(0);
  });

  it("B8: a SHORT subscription is a failure, never a degraded success", async () => {
    const { m } = build({ subscribeShortOn: new Set([1]) });
    const out = await m.start();
    expect(out.state).toBe("FAILED");
    expect(out.blocker).toBe("SUBSCRIPTION_INCOMPLETE");
    // The critical assertion: it did NOT report RUNNING or DEGRADED.
    expect(out.state).not.toBe("RUNNING");
    expect(out.state).not.toBe("DEGRADED");
  });

  it("B9: a short subscription still rolls back every socket", async () => {
    const { h, m } = build({ subscribeShortOn: new Set([1]) });
    await m.start();
    expect(h.liveCount()).toBe(0);
    expect(m.diagnostics().clientsHeld).toBe(0);
  });

  it("B10: a throwing subscribe is caught and rolled back", async () => {
    const { h, m } = build({ subscribeThrowsOn: new Set([2]) });
    const out = await m.start();
    expect(out.state).toBe("FAILED");
    expect(out.blocker).toBe("SUBSCRIBE_FAILED");
    expect(h.liveCount()).toBe(0);
  });

  it("B11: a throwing connect is caught and rolled back", async () => {
    const { h, m } = build({ connectThrowsOn: new Set([0]) });
    const out = await m.start();
    expect(out.state).toBe("FAILED");
    expect(out.blocker).toBe("CLIENT_CONNECT_FAILED");
    expect(h.liveCount()).toBe(0);
  });

  it("B12: a factory that throws leaks nothing and stops the attempt", async () => {
    const { h, m } = build({ constructThrowsOn: new Set([1]) });
    const out = await m.start();
    expect(out.state).toBe("FAILED");
    expect(out.blocker).toBe("CLIENT_CONSTRUCTION_FAILED");
    // Shard 2 must never have been attempted after shard 1 failed.
    expect(h.callsOfKind("CONSTRUCT").map((c) => c.shardId)).toEqual([0, 1]);
    expect(h.liveCount()).toBe(0);
  });

  it("B13: a rollback that cannot release a socket reports the error honestly", async () => {
    const { m } = build({ connectFailsOn: new Set([2]), closeFailsOn: new Set([0]) });
    const out = await m.start();
    expect(out.state).toBe("FAILED");
    expect(out.rollbackErrors.length).toBeGreaterThan(0);
    expect(out.detail).toContain("rollback incomplete");
  });

  it("B18: a shard that drops mid-startup fails the start instead of reaching RUNNING", async () => {
    const h = makeFakeClientHarness();
    const decB18 = makeAllPassDecision(makePlan([2, 2, 2]));
    const m = createFeedManagerForTesting({
      clientFactory: async (spec) => {
        const client = await h.factory(spec);
        return {
          ...client,
          connect: async () => {
            const res = await client.connect();
            // Shard 0 drops while shard 2 is still being brought up.
            if (spec.shardId === 2) h.specFor(0)?.events.onDisconnected("dropped mid-start");
            return res;
          },
        };
      },
      getActivation: () => decB18,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });

    const out = await m.start();

    expect(out.started).toBe(false);
    expect(out.blocker).toBe("SHARD_LOST_DURING_STARTUP");
    expect(m.state()).not.toBe("RUNNING");
    // The failure must roll everything back, not leave two live shards.
    expect(h.liveCount()).toBe(0);
  });

  it("B15: an unconfirmed subscription is visible in diagnostics, not hidden behind RUNNING", async () => {
    const { m } = build({ unconfirmedSubscribeOn: new Set([1]) });
    const out = await m.start();
    expect(out.state).toBe("RUNNING");
    // RUNNING is reachable, but it must not be readable as "the provider agreed".
    expect(m.diagnostics().subscriptionConfirmation).toBe("REQUEST_ACCEPTED_UNCONFIRMED");
  });

  it("B16: a fully acknowledged subscription reports as acknowledged", async () => {
    const { m } = build();
    await m.start();
    expect(m.diagnostics().subscriptionConfirmation).toBe("PROVIDER_ACKNOWLEDGED");
  });

  it("B17: a failed start leaves no subscription confirmation claim behind", async () => {
    const { m } = build({ connectFailsOn: new Set([1]) });
    await m.start();
    expect(m.diagnostics().subscriptionConfirmation).toBeNull();
  });

  it("B14: a start while RUNNING is refused without touching the sockets", async () => {
    const { h, m } = build();
    await m.start();
    const before = h.calls.length;
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.blocker).toBe("MANAGER_ALREADY_ACTIVE");
    expect(h.calls.length).toBe(before);
    expect(m.state()).toBe("RUNNING");
  });
});
