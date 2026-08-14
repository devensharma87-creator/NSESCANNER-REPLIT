/**
 * PHASE 0.8B — GATE H: ACTIVATION BOUNDARY
 *
 * Two families of tests:
 *
 * 1. Per-gate refusals: every one of the 15 named gates, when it fails, is
 *    sufficient to block start(). No gate is a no-op.
 *
 * 2. Cross-validation: the manager cross-checks registryGenerationId and
 *    completeManifestHash against the plan — independently of the gate array,
 *    so passing gate values alone cannot defeat these checks.
 *
 * 3. Compile-time lock: createFeedManager (production) refuses even when all
 *    15 gates pass, because FEED_RUNTIME_ACTIVATION_AUTHORIZED is false.
 *    createFeedManagerForTesting bypasses ONLY the constant — all other checks
 *    still apply.
 *
 * 4. Production callers: createFeedManagerForTesting must have zero callers in
 *    production source files (non-test .ts files under the feed directory).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFeedManager,
  createFeedManagerForTesting,
  FEED_RUNTIME_ACTIVATION_AUTHORIZED,
  REQUIRED_ACTIVATION_GATE_IDS,
  type FeedActivationGateId,
} from "./feedManager";
import {
  makeFakeClientHarness,
  makePlan,
  makeAllPassDecision,
  makeDecisionWithFailedGate,
  makeDecisionWithMissingGate,
  makeDecisionWithNotEvaluatedGate,
  TEST_GENERATION_ID,
} from "./testing/p08bFixtures";

const FEED_DIR = path.dirname(fileURLToPath(import.meta.url));

const PLAN_3 = makePlan([3, 3, 3]);

// ---------------------------------------------------------------------------
// G14: baseline — all-pass decision succeeds
// ---------------------------------------------------------------------------

describe("P0.8B Gate H — baseline", () => {
  it("G14: all 15 gates PASS reaches RUNNING through createFeedManagerForTesting", async () => {
    const h = makeFakeClientHarness();
    const dec = makeAllPassDecision(PLAN_3);
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(true);
    expect(out.state).toBe("RUNNING");
    expect(out.blocker).toBeNull();
    expect(h.constructed).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// G15–G22: each individual gate, when FAIL, blocks start()
// ---------------------------------------------------------------------------

describe("P0.8B Gate H — per-gate refusals", () => {
  const gateIds: FeedActivationGateId[] = [
    "REGISTRY_RESTORATION_SETTLED",
    "REGISTRY_AUTHORITY_CURRENT",
    "REGISTRY_SCHEMA_AND_POLICY_SUPPORTED",
    "SUBSCRIPTION_MANIFEST_ACCEPTED",
    "REGISTRY_GENERATION_ID_PRESENT",
    "SUBSCRIPTION_SET_HASH_PRESENT",
    "COMPLETE_MANIFEST_HASH_PRESENT",
    "SHARD_POLICY_VERSION_SUPPORTED",
  ];

  for (const gateId of gateIds) {
    it(`G-FAIL[${gateId}]: one failing gate is sufficient to block activation`, async () => {
      const h = makeFakeClientHarness();
      const dec = makeDecisionWithFailedGate(PLAN_3, gateId);
      const m = createFeedManagerForTesting({
        clientFactory: h.factory,
        getActivation: () => dec,
        getCurrentGenerationId: () => TEST_GENERATION_ID,
      });
      const out = await m.start();
      expect(out.started).toBe(false);
      expect(out.state).toBe("WAITING_FOR_GATES");
      expect(out.blocker).toBe("ACTIVATION_GATES_NOT_PASSED");
      expect(out.detail).toContain(gateId);
      expect(h.constructed).toHaveLength(0);
    });
  }

  it("G-FAIL[SHARD_PLAN_CAPACITY_ADMITTED]: one failing gate blocks activation", async () => {
    const h = makeFakeClientHarness();
    const dec = makeDecisionWithFailedGate(PLAN_3, "SHARD_PLAN_CAPACITY_ADMITTED");
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("WAITING_FOR_GATES");
    expect(h.constructed).toHaveLength(0);
  });

  it("G-FAIL[FEED_OWNERSHIP_SINGLETON_ATTESTED]: one failing gate blocks activation", async () => {
    const h = makeFakeClientHarness();
    const dec = makeDecisionWithFailedGate(PLAN_3, "FEED_OWNERSHIP_SINGLETON_ATTESTED");
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("WAITING_FOR_GATES");
    expect(h.constructed).toHaveLength(0);
  });

  it("G-FAIL[KITE_SESSION_VALID]: one failing gate blocks activation", async () => {
    const h = makeFakeClientHarness();
    const dec = makeDecisionWithFailedGate(PLAN_3, "KITE_SESSION_VALID");
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("WAITING_FOR_GATES");
    expect(h.constructed).toHaveLength(0);
  });

  it("G-FAIL[OWNER_ACTIVATION_AUTHORIZATION]: one failing gate blocks activation", async () => {
    const h = makeFakeClientHarness();
    const dec = makeDecisionWithFailedGate(PLAN_3, "OWNER_ACTIVATION_AUTHORIZATION");
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("WAITING_FOR_GATES");
    expect(h.constructed).toHaveLength(0);
  });

  it("G-FAIL[TOKEN_RECONCILIATION_CLEAR]: one failing gate blocks activation", async () => {
    const h = makeFakeClientHarness();
    const dec = makeDecisionWithFailedGate(PLAN_3, "TOKEN_RECONCILIATION_CLEAR");
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("WAITING_FOR_GATES");
    expect(h.constructed).toHaveLength(0);
  });

  it("G-FAIL[SHUTDOWN_LIFECYCLE_INSTALLED]: one failing gate blocks activation", async () => {
    const h = makeFakeClientHarness();
    const dec = makeDecisionWithFailedGate(PLAN_3, "SHUTDOWN_LIFECYCLE_INSTALLED");
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("WAITING_FOR_GATES");
    expect(h.constructed).toHaveLength(0);
  });

  it("G24: COMPILE_TIME_FEED_LOCK=FAIL via createFeedManagerForTesting → WAITING_FOR_GATES", async () => {
    const h = makeFakeClientHarness();
    const dec = makeDecisionWithFailedGate(PLAN_3, "COMPILE_TIME_FEED_LOCK");
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("WAITING_FOR_GATES");
    expect(out.detail).toContain("COMPILE_TIME_FEED_LOCK");
    expect(h.constructed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Missing and NOT_EVALUATED gates are treated as FAIL
// ---------------------------------------------------------------------------

describe("P0.8B Gate H — missing and unevaluated gates", () => {
  it("G30: a gate missing from the array is treated as NOT_EVALUATED → refused", async () => {
    const h = makeFakeClientHarness();
    const dec = makeDecisionWithMissingGate(PLAN_3, "KITE_SESSION_VALID");
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("WAITING_FOR_GATES");
    // The missing gate surfaces by its own id (used as blockerCode fallback)
    expect(out.detail).toContain("KITE_SESSION_VALID");
    expect(h.constructed).toHaveLength(0);
  });

  it("G31: a gate with state NOT_EVALUATED never counts as PASS → refused", async () => {
    const h = makeFakeClientHarness();
    const dec = makeDecisionWithNotEvaluatedGate(PLAN_3, "OWNER_ACTIVATION_AUTHORIZATION");
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("WAITING_FOR_GATES");
    expect(h.constructed).toHaveLength(0);
  });

  it("G-REQUIRED_IDS: REQUIRED_ACTIVATION_GATE_IDS has exactly 15 entries, all unique", () => {
    expect(REQUIRED_ACTIVATION_GATE_IDS.length).toBe(15);
    const unique = new Set(REQUIRED_ACTIVATION_GATE_IDS);
    expect(unique.size).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Cross-validation: generation id and manifest hash checked against the plan
// ---------------------------------------------------------------------------

describe("P0.8B Gate H — cross-validation of generation id and manifest hash", () => {
  it("G26: decision.registryGenerationId mismatches plan → ACTIVATION_GENERATION_MISMATCH", async () => {
    const h = makeFakeClientHarness();
    const plan = makePlan([3, 3, 3]);
    const dec = { ...makeAllPassDecision(plan), registryGenerationId: "different-gen" };
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.blocker).toBe("ACTIVATION_GENERATION_MISMATCH");
    expect(h.constructed).toHaveLength(0);
  });

  it("G27: decision.registryGenerationId null → ACTIVATION_GENERATION_MISSING", async () => {
    const h = makeFakeClientHarness();
    const plan = makePlan([3, 3, 3]);
    const dec = { ...makeAllPassDecision(plan), registryGenerationId: null };
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.blocker).toBe("ACTIVATION_GENERATION_MISSING");
    expect(h.constructed).toHaveLength(0);
  });

  it("G28: decision.completeManifestHash mismatches plan → ACTIVATION_MANIFEST_HASH_MISMATCH", async () => {
    const h = makeFakeClientHarness();
    const plan = makePlan([3, 3, 3]);
    const dec = { ...makeAllPassDecision(plan), completeManifestHash: "wrong-hash" };
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.blocker).toBe("ACTIVATION_MANIFEST_HASH_MISMATCH");
    expect(h.constructed).toHaveLength(0);
  });

  it("G29: decision.completeManifestHash null → ACTIVATION_MANIFEST_HASH_MISSING", async () => {
    const h = makeFakeClientHarness();
    const plan = makePlan([3, 3, 3]);
    const dec = { ...makeAllPassDecision(plan), completeManifestHash: null };
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.blocker).toBe("ACTIVATION_MANIFEST_HASH_MISSING");
    expect(h.constructed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// G23: compile-time lock refuses even with all-pass gates
// G25: test factory bypasses ONLY the lock
// ---------------------------------------------------------------------------

describe("P0.8B Gate H — compile-time lock vs test factory", () => {
  it("G23: createFeedManager (production) refuses with DISABLED even when all 15 gates PASS", async () => {
    expect(FEED_RUNTIME_ACTIVATION_AUTHORIZED).toBe(false);
    const h = makeFakeClientHarness();
    const dec = makeAllPassDecision(PLAN_3);
    const m = createFeedManager({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(false);
    expect(out.state).toBe("DISABLED");
    expect(out.blocker).toBe("FEED_RUNTIME_ACTIVATION_NOT_AUTHORIZED");
    // Never even read the decision — factory is never called.
    expect(h.constructed).toHaveLength(0);
  });

  it("G25: createFeedManagerForTesting with all 15 PASS creates exactly the shard count of clients", async () => {
    const h = makeFakeClientHarness();
    const plan = makePlan([3, 3, 3]);
    const dec = makeAllPassDecision(plan);
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });
    const out = await m.start();
    expect(out.started).toBe(true);
    expect(out.state).toBe("RUNNING");
    expect(h.constructed).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// G32: createFeedManagerForTesting has zero production callers
// ---------------------------------------------------------------------------

describe("P0.8B Gate H — createFeedManagerForTesting isolation", () => {
  it("G32: createFeedManagerForTesting is never called by production source files", () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(FEED_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts")) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      const src = readFileSync(path.join(FEED_DIR, entry.name), "utf8");
      if (src.includes("createFeedManagerForTesting")) {
        offenders.push(entry.name);
      }
    }
    // feedManager.ts exports it (expected); it must not appear in any other production file.
    const forbidden = offenders.filter((f) => f !== "feedManager.ts");
    expect(forbidden).toHaveLength(0);
  });
});
