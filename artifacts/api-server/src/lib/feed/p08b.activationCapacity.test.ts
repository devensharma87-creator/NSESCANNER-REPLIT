/**
 * PHASE 0.8B — GATE A: ACTIVATION AND CAPACITY
 *
 * Proves the feed cannot start unless it is authorised AND every gate passes,
 * and that a plan is re-proven from its own contents before it is acted on.
 */

import { describe, it, expect } from "vitest";
import {
  createFeedManager,
  createFeedManagerForTesting,
  FEED_RUNTIME_ACTIVATION_AUTHORIZED,
} from "./feedManager";
import { admitShardPlan } from "./shardPlanInvariants";
import { MAX_SOCKETS, MAX_TOKENS_PER_SOCKET } from "../registry/feedShardPlan";
import {
  makeFakeClientHarness,
  makePlan,
  makeAllPassDecision,
  makeDecisionWithFailedGate,
  withShardTokens,
  TEST_GENERATION_ID,
} from "./testing/p08bFixtures";

function decision(planOverride?: ReturnType<typeof makePlan>) {
  return makeAllPassDecision(planOverride ?? makePlan([3, 2, 2]));
}

describe("P0.8B Gate A — the phase lock", () => {
  it("A1: FEED_RUNTIME_ACTIVATION_AUTHORIZED is false in this build", () => {
    expect(FEED_RUNTIME_ACTIVATION_AUTHORIZED).toBe(false);
  });

  it("A2: start() under the real lock lands in DISABLED with the lock blocker", async () => {
    const h = makeFakeClientHarness();
    const m = createFeedManager({
      clientFactory: h.factory,
      getActivation: () => decision(),
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("DISABLED");
    expect(out.blocker).toBe("FEED_RUNTIME_ACTIVATION_NOT_AUTHORIZED");
  });

  it("A3: an unauthorised start constructs no client at all", async () => {
    const h = makeFakeClientHarness();
    const m = createFeedManager({
      clientFactory: h.factory,
      getActivation: () => decision(),
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    await m.start();
    expect(h.constructed).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("A4: an unauthorised start does not even read the activation evidence", async () => {
    const h = makeFakeClientHarness();
    let reads = 0;
    const m = createFeedManager({
      clientFactory: h.factory,
      getActivation: () => {
        reads++;
        return decision();
      },
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    await m.start();
    expect(reads).toBe(0);
  });
});

describe("P0.8B Gate A — gates and plan admission", () => {
  it("A5: gates not passing lands in WAITING_FOR_GATES, not FAILED", async () => {
    const h = makeFakeClientHarness();
    const plan = makePlan([3, 2, 2]);
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => makeDecisionWithFailedGate(plan, "KITE_SESSION_VALID"),
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.state).toBe("WAITING_FOR_GATES");
    expect(out.blocker).toBe("ACTIVATION_GATES_NOT_PASSED");
    expect(out.detail).toContain("KITE_SESSION_VALID");
  });

  it("A6: gates not passing constructs no client", async () => {
    const h = makeFakeClientHarness();
    const plan = makePlan([3, 2, 2]);
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => makeDecisionWithFailedGate(plan, "REGISTRY_AUTHORITY_CURRENT"),
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    await m.start();
    expect(h.constructed).toHaveLength(0);
  });

  it("A7: a REFUSED plan is rejected even when every gate passes", async () => {
    const h = makeFakeClientHarness();
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => decision(makePlan([3, 2], { state: "REFUSED" })),
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.state).toBe("FAILED");
    expect(out.blocker).toBe("SHARD_PLAN_NOT_ADMISSIBLE");
    expect(h.constructed).toHaveLength(0);
  });
});

describe("P0.8B Gate A — shard plan invariants", () => {
  it("A8: a valid three-shard plan is admitted", () => {
    const v = admitShardPlan(makePlan([3, 2, 2]));
    expect(v.admitted).toBe(true);
    expect(v.blockers).toEqual([]);
    expect(v.observedTotalTokens).toBe(7);
    expect(v.observedShardCount).toBe(3);
  });

  it("A9: a token appearing in two shards is refused", () => {
    // Shard 1 is rewritten to reuse shard 0's first token.
    const base = makePlan([3, 3]);
    const collide = withShardTokens(base, 1, [base.shards[0]!.tokens[0]!, 9001, 9002]);
    const v = admitShardPlan(collide);
    expect(v.admitted).toBe(false);
    expect(v.blockers).toContain("TOKEN_IN_MULTIPLE_SHARDS");
  });

  it("A10: more than three shards is refused", () => {
    const v = admitShardPlan(makePlan([1, 1, 1, 1]));
    expect(v.admitted).toBe(false);
    expect(v.blockers).toContain("SOCKET_CEILING_EXCEEDED");
  });

  it("A11: a shard over the per-socket ceiling is refused", () => {
    const v = admitShardPlan(makePlan([MAX_TOKENS_PER_SOCKET + 1]));
    expect(v.admitted).toBe(false);
    expect(v.blockers).toContain("SHARD_TOKEN_CEILING_EXCEEDED");
  });

  it("A12: a declared total that disagrees with the shard contents is refused", () => {
    const v = admitShardPlan(makePlan([3, 2], { totalTokensOverride: 99 }));
    expect(v.admitted).toBe(false);
    expect(v.blockers).toContain("TOTAL_TOKENS_DISAGREE_WITH_SHARDS");
  });

  it("A13: shard 0 must carry the index-first priority class", () => {
    const v = admitShardPlan(makePlan([3, 2], { firstShardPriority: "STANDARD_EQUITY" }));
    expect(v.admitted).toBe(false);
    expect(v.blockers).toContain("INDEX_PRIORITY_SHARD_MISSING");
  });

  it("A14: an empty shard is refused rather than skipped", () => {
    const v = admitShardPlan(makePlan([3, 0, 2]));
    expect(v.admitted).toBe(false);
    expect(v.blockers).toContain("EMPTY_SHARD_PRESENT");
  });

  it("A15: a plan missing its complete manifest hash is refused", () => {
    const v = admitShardPlan(makePlan([3, 2], { completeManifestHash: null }));
    expect(v.admitted).toBe(false);
    expect(v.blockers).toContain("MISSING_COMPLETE_MANIFEST_HASH");
  });

  it("A16: an unusable provider token is refused", () => {
    const v = admitShardPlan(withShardTokens(makePlan([3, 2]), 1, [0, -4]));
    expect(v.admitted).toBe(false);
    expect(v.blockers).toContain("INVALID_PROVIDER_TOKEN");
  });

  it("A17: the manager never holds more clients than the socket ceiling", async () => {
    const h = makeFakeClientHarness();
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => decision(makePlan([3, 3, 3])),
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    await m.start();
    expect(h.peakLive()).toBeLessThanOrEqual(MAX_SOCKETS);
    expect(m.diagnostics().clientsHeld).toBeLessThanOrEqual(MAX_SOCKETS);
  });
});
