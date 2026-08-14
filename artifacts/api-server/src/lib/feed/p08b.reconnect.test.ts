/**
 * PHASE 0.8B — GATE C: RECONNECT WITHOUT REDISTRIBUTION
 *
 * The two properties that matter:
 *   1. A lost shard's tokens are NEVER moved to a surviving socket.
 *   2. The old socket is released BEFORE a replacement is constructed, so the
 *      manager can never require a fourth concurrent socket.
 */

import { describe, it, expect } from "vitest";
import { createFeedManagerForTesting } from "./feedManager";
import { MAX_SOCKETS } from "../registry/feedShardPlan";
import {
  makeFakeClientHarness,
  makePlan,
  makeAllPassDecision,
  TEST_GENERATION_ID,
} from "./testing/p08bFixtures";
import type { FakeClientBehavior } from "./testing/p08bFixtures";

function build(behavior: FakeClientBehavior = {}) {
  const h = makeFakeClientHarness(behavior);
  const dec = makeAllPassDecision(makePlan([3, 3, 3]));
  const m = createFeedManagerForTesting({
    clientFactory: h.factory,
    getActivation: () => dec,
    getCurrentGenerationId: () => TEST_GENERATION_ID,
  });
  return { h, m, dec };
}

/**
 * Builds a manager whose closes take real asynchronous time, so a second
 * lifecycle call genuinely lands while the first is mid-teardown. Without the
 * delay the operations complete in one microtask and the race never occurs.
 */
function buildSlowClose(opts: { readonly refuseCloseOn?: number; readonly delayMs?: number } = {}) {
  const h = makeFakeClientHarness();
  const dec = makeAllPassDecision(makePlan([3, 3, 3]));
  const m = createFeedManagerForTesting({
    clientFactory: async (spec) => {
      const client = await h.factory(spec);
      return {
        ...client,
        close: async () => {
          await new Promise((r) => setTimeout(r, opts.delayMs ?? 10));
          // A refused close leaves the harness's socket LIVE, which is exactly
          // what a provider connection we failed to drop looks like.
          if (spec.shardId === opts.refuseCloseOn) return { ok: false, detail: "REFUSED" };
          return client.close();
        },
      };
    },
    getActivation: () => dec,
    getCurrentGenerationId: () => TEST_GENERATION_ID,
  });
  return { h, m };
}

describe("P0.8B Gate C — concurrent lifecycle operations cannot breach the ceiling", () => {
  it("C17: two overlapping reconnects for one shard never open a fourth socket", async () => {
    const { h, m } = buildSlowClose({ refuseCloseOn: 1 });
    await m.start();
    expect(h.liveCount()).toBe(3);
    m.notifyShardDisconnected(1, "dropped");

    // Fired together: the second lands while the first is awaiting its close.
    const [a, b] = await Promise.all([m.reconnectShard(1), m.reconnectShard(1)]);

    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    // The old socket is still live and unreleased, so NEITHER call may build a
    // replacement. Four constructions here would be four provider sockets.
    expect(h.constructed).toHaveLength(3);
    expect(h.peakLive()).toBeLessThanOrEqual(MAX_SOCKETS);
  });

  it("C18: a close overlapping a reconnect still ends with every socket released", async () => {
    const { h, m } = buildSlowClose();
    await m.start();
    m.notifyShardDisconnected(1, "dropped");

    const [, closed] = await Promise.all([m.reconnectShard(1), m.close("SIGTERM")]);

    expect(closed.closed).toBe(true);
    expect(h.liveCount()).toBe(0);
    expect(h.peakLive()).toBeLessThanOrEqual(MAX_SOCKETS);
  });

  it("C19: a reconnect queued behind a completed close never opens a socket after shutdown", async () => {
    const { h, m } = buildSlowClose();
    await m.start();
    m.notifyShardDisconnected(1, "dropped");

    const closeP = m.close("SIGTERM");
    const reconP = m.reconnectShard(1);
    const [closed, recon] = await Promise.all([closeP, reconP]);

    expect(closed.closed).toBe(true);
    // The critical property: shutdown finished, so nothing may be opened after it.
    expect(recon.ok).toBe(false);
    expect(h.liveCount()).toBe(0);
    expect(h.constructed).toHaveLength(3);
  });
});

describe("P0.8B Gate C — losing a shard", () => {
  it("C1: a disconnect moves RUNNING to DEGRADED", async () => {
    const { m } = build();
    await m.start();
    m.notifyShardDisconnected(1, "socket closed");
    expect(m.state()).toBe("DEGRADED");
  });

  it("C2: the lost shard is named in diagnostics", async () => {
    const { m } = build();
    await m.start();
    m.notifyShardDisconnected(1, "socket closed");
    expect(m.diagnostics().lostShardIds).toEqual([1]);
  });

  it("C3: the lost shard's tokens are NOT redistributed to survivors", async () => {
    const { m, dec } = build();
    await m.start();
    const before = new Map(m.subscribedTokenMap());
    m.notifyShardDisconnected(1, "socket closed");
    const after = m.subscribedTokenMap();

    // Every token still maps to its ORIGINAL shard — nothing moved to 0 or 2.
    expect(after.size).toBe(before.size);
    for (const shard of dec.plan.shards) {
      for (const token of shard.tokens) expect(after.get(token)).toBe(shard.shardId);
    }
  });

  it("C4: losing a shard does not open a compensating socket", async () => {
    const { h, m } = build();
    await m.start();
    const constructsBefore = h.callsOfKind("CONSTRUCT").length;
    m.notifyShardDisconnected(1, "socket closed");
    expect(h.callsOfKind("CONSTRUCT").length).toBe(constructsBefore);
  });

  it("C5: a disconnect while DISABLED is ignored rather than inventing DEGRADED", () => {
    const { m } = build();
    m.notifyShardDisconnected(0, "spurious");
    expect(m.state()).toBe("DISABLED");
    expect(m.diagnostics().lostShardIds).toEqual([]);
  });
});

describe("P0.8B Gate C — replacing a shard", () => {
  it("C6: the old client is closed BEFORE the replacement is constructed", async () => {
    const { h, m } = build();
    await m.start();
    m.notifyShardDisconnected(1, "dropped");
    const mark = h.calls.length;
    await m.reconnectShard(1);

    const after = h.calls.slice(mark);
    const closeIdx = after.findIndex((c) => c.kind === "CLOSE" && c.shardId === 1);
    const constructIdx = after.findIndex((c) => c.kind === "CONSTRUCT" && c.shardId === 1);
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(constructIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeLessThan(constructIdx);
  });

  it("C7: concurrency never exceeds the three-socket ceiling during recovery", async () => {
    const { h, m } = build();
    await m.start();
    m.notifyShardDisconnected(1, "dropped");
    await m.reconnectShard(1);
    expect(h.peakLive()).toBeLessThanOrEqual(MAX_SOCKETS);
  });

  it("C8: a successful replacement returns the manager to RUNNING", async () => {
    const { m } = build();
    await m.start();
    m.notifyShardDisconnected(1, "dropped");
    const res = await m.reconnectShard(1);
    expect(res.ok).toBe(true);
    expect(m.state()).toBe("RUNNING");
    expect(m.diagnostics().lostShardIds).toEqual([]);
  });

  it("C9: with two shards lost, recovering one leaves the manager DEGRADED", async () => {
    const { m } = build();
    await m.start();
    m.notifyShardDisconnected(1, "dropped");
    m.notifyShardDisconnected(2, "dropped");
    await m.reconnectShard(1);
    expect(m.state()).toBe("DEGRADED");
    expect(m.diagnostics().lostShardIds).toEqual([2]);
  });

  it("C10: reconnect is refused when the manager is not DEGRADED", async () => {
    const { m } = build();
    await m.start();
    const res = await m.reconnectShard(1);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("RUNNING");
  });

  it("C11: reconnect is refused for a shard that is not marked lost", async () => {
    const { m } = build();
    await m.start();
    m.notifyShardDisconnected(1, "dropped");
    const res = await m.reconnectShard(0);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("not marked lost");
  });

  it("C12: a replacement with an incomplete subscription is rejected and the slot left empty", async () => {
    const { h, m } = build({ subscribeShortOn: new Set([1]) });
    // Shard 1 subscribes short on the FIRST attempt too, so start fails.
    // Use a harness where only the replacement is short instead.
    void h;
    const h2 = makeFakeClientHarness();
    const dec2 = makeAllPassDecision(makePlan([3, 3, 3]));
    let shortNow = false;
    const m2 = createFeedManagerForTesting({
      clientFactory: async (spec) => {
        const client = await h2.factory(spec);
        return {
          ...client,
          subscribe: async (tokens: readonly number[]) =>
            shortNow && spec.shardId === 1
              ? {
                  ok: true as const,
                  acceptedTokens: tokens.slice(0, -1),
                  detail: "PARTIAL",
                  confirmation: "PROVIDER_ACKNOWLEDGED" as const,
                }
              : client.subscribe(tokens),
        };
      },
      getActivation: () => dec2,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });

    await m2.start();
    expect(m2.state()).toBe("RUNNING");
    m2.notifyShardDisconnected(1, "dropped");
    shortNow = true;
    const res = await m2.reconnectShard(1);
    expect(res.ok).toBe(false);
    expect(m2.state()).toBe("DEGRADED");
    // The failed replacement must not be left held.
    const slot = m2.diagnostics().shards.find((s) => s.shardId === 1);
    expect(slot?.held).toBe(false);
  });

  it("C14: if the OLD socket cannot be released, no replacement is constructed", async () => {
    const { h, m } = build({ closeFailsOn: new Set([1]) });
    await m.start();
    m.notifyShardDisconnected(1, "dropped");
    const constructsBefore = h.callsOfKind("CONSTRUCT").length;

    const res = await m.reconnectShard(1);

    expect(res.ok).toBe(false);
    expect(res.detail).toContain("replacement refused");
    // The critical assertion: building a replacement while the provider may
    // still count the old socket would be a fourth concurrent connection.
    expect(h.callsOfKind("CONSTRUCT").length).toBe(constructsBefore);
    expect(m.state()).toBe("DEGRADED");
    expect(m.diagnostics().blocker).toBe("SOCKET_RELEASE_FAILED");
  });

  it("C15: an unreleasable old socket is remembered, not dropped", async () => {
    const { m } = build({ closeThrowsOn: new Set([1]) });
    await m.start();
    m.notifyShardDisconnected(1, "dropped");
    await m.reconnectShard(1);
    expect(m.diagnostics().unreleasedSockets).toBe(1);
    // And it still forces an honest shutdown.
    await expect(m.close("SIGTERM")).rejects.toThrow(/FEED_CLOSE_INCOMPLETE/);
  });

  it("C16: total sockets never exceed the ceiling even when releases keep failing", async () => {
    const { h, m } = build({ closeFailsOn: new Set([1]) });
    await m.start();
    m.notifyShardDisconnected(1, "dropped");
    await m.reconnectShard(1);
    await m.reconnectShard(1);
    await m.reconnectShard(1);
    expect(h.constructed).toHaveLength(3);
    expect(h.peakLive()).toBeLessThanOrEqual(MAX_SOCKETS);
  });

  it("C13: a replacement whose connect fails leaves the manager DEGRADED, not FAILED", async () => {
    const h = makeFakeClientHarness();
    const dec13 = makeAllPassDecision(makePlan([2, 2, 2]));
    let failConnect = false;
    const m = createFeedManagerForTesting({
      clientFactory: async (spec) => {
        const client = await h.factory(spec);
        return {
          ...client,
          connect: async () =>
            failConnect && spec.shardId === 2
              ? { ok: false, detail: "REPLACEMENT_REFUSED" }
              : client.connect(),
        };
      },
      getActivation: () => dec13,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });

    await m.start();
    m.notifyShardDisconnected(2, "dropped");
    failConnect = true;
    const res = await m.reconnectShard(2);
    expect(res.ok).toBe(false);
    expect(m.state()).toBe("DEGRADED");
    expect(m.diagnostics().lostShardIds).toEqual([2]);
  });
});
