/**
 * PHASE 0.8E — SHARD_PLAN_CAPACITY_ADMITTED READINESS-GATE HONESTY
 *
 * These regression tests pin the FOUR distinct outcomes of the shard-plan
 * capacity gate and, crucially, that MISSING evidence is never rendered as a
 * PROVEN capacity overflow.
 *
 * THE DEFECT BEING GUARDED
 * ------------------------
 * The gate used to stamp a fixed literal reason ("SHARD_PLAN_EXCEEDS_PROVIDER_
 * CAPACITY") on every non-PASS outcome. When there is no registry generation /
 * manifest / shard plan at all, that described an ABSENCE as a specific,
 * hard-to-hit failure the operator never caused. Fixing the honesty of the
 * reason must NOT relax the gate: every non-PASS case still fails closed.
 *
 * NO DB, NO NETWORK, NO FEED. `judgeShardPlanCapacity` is a pure function over
 * a plan object, and the readiness-report assertion runs against a process with
 * no generation installed — the manifest is UNAVAILABLE, the planner refuses,
 * and nothing is contacted, opened or written.
 */

import { describe, it, expect } from "vitest";

import {
  MAX_SOCKETS,
  MAX_TOKENS_PER_SOCKET,
  PROVIDER_TOKEN_CAPACITY,
  type FeedShard,
  type FeedShardPlan,
} from "../registry/feedShardPlan";
import {
  buildActivationReadinessReport,
  judgeShardPlanCapacity,
  SHARD_PLAN_PROVIDER_TOKEN_CAPACITY,
} from "./productionFeedManager";

const GEN = "GEN-0.8E-TEST";
const NOW = 1_700_000_000_000;

/** A single valid shard carrying `n` contiguous positive tokens. */
function shard(shardId: number, startToken: number, n: number): FeedShard {
  const tokens: number[] = [];
  const identities: string[] = [];
  for (let i = 0; i < n; i++) {
    tokens.push(startToken + i);
    identities.push(`NSE:EQ:INST-${startToken + i}`);
  }
  return Object.freeze({
    shardId,
    priorityClass: shardId === 0 ? "PRIORITY_INDEX_FIRST" : "STANDARD_EQUITY",
    count: n,
    identities: Object.freeze(identities),
    tokens: Object.freeze(tokens),
    // The invariant checker never reads this hash, so any stable string is fine.
    shardHash: `hash-${shardId}-${n}`,
  });
}

/** A well-formed PLANNED plan carrying exactly `total` tokens across shards. */
function plannedPlan(shards: readonly FeedShard[]): FeedShardPlan {
  const total = shards.reduce((sum, s) => sum + s.tokens.length, 0);
  return Object.freeze({
    state: "PLANNED",
    blockerCode: null,
    registryGenerationId: GEN,
    subscriptionPolicyVersion: 1,
    shardPolicyVersion: 2,
    capacity: PROVIDER_TOKEN_CAPACITY,
    maxSockets: MAX_SOCKETS,
    maxTokensPerSocket: MAX_TOKENS_PER_SOCKET,
    totalTokens: total,
    headroom: PROVIDER_TOKEN_CAPACITY - total,
    shards: Object.freeze([...shards]),
    completeManifestHash: "complete-hash",
    activationAuthorized: false,
  });
}

/** A REFUSED plan with a given blocker code and computed total. */
function refusedPlan(blockerCode: string, totalTokens: number): FeedShardPlan {
  return Object.freeze({
    state: "REFUSED",
    blockerCode,
    registryGenerationId: GEN,
    subscriptionPolicyVersion: 1,
    shardPolicyVersion: 2,
    capacity: PROVIDER_TOKEN_CAPACITY,
    maxSockets: MAX_SOCKETS,
    maxTokensPerSocket: MAX_TOKENS_PER_SOCKET,
    totalTokens,
    headroom: PROVIDER_TOKEN_CAPACITY - totalTokens,
    shards: Object.freeze([]),
    completeManifestHash: null,
    activationAuthorized: false,
  });
}

describe("PHASE 0.8E — the provider capacity is DERIVED, not hardcoded", () => {
  it("equals MAX_SOCKETS * MAX_TOKENS_PER_SOCKET (i.e. 9,000)", () => {
    expect(SHARD_PLAN_PROVIDER_TOKEN_CAPACITY).toBe(MAX_SOCKETS * MAX_TOKENS_PER_SOCKET);
    expect(SHARD_PLAN_PROVIDER_TOKEN_CAPACITY).toBe(PROVIDER_TOKEN_CAPACITY);
    expect(SHARD_PLAN_PROVIDER_TOKEN_CAPACITY).toBe(9000);
  });
});

describe("PHASE 0.8E — missing plan is NOT_EVALUATED, never a capacity overflow", () => {
  it("a REFUSED plan for an unavailable manifest reports SHARD_PLAN_UNAVAILABLE", () => {
    const v = judgeShardPlanCapacity(refusedPlan("SUBSCRIPTION_MANIFEST_UNAVAILABLE", 0));
    expect(v.state).toBe("NOT_EVALUATED");
    expect(v.reasonCode).toBe("SHARD_PLAN_UNAVAILABLE");
    expect(v.requiredTokenCount).toBeNull();
    expect(v.headroom).toBeNull();
    expect(v.reasonCode).not.toBe("PROVIDER_CAPACITY_EXCEEDED");
    expect(v.reasonCode).not.toBe("SHARD_PLAN_EXCEEDS_PROVIDER_CAPACITY");
  });

  it("a REFUSED plan for no admitted instruments reports SHARD_PLAN_UNAVAILABLE", () => {
    const v = judgeShardPlanCapacity(refusedPlan("NO_ADMITTED_LIVE_INSTRUMENTS", 0));
    expect(v.state).toBe("NOT_EVALUATED");
    expect(v.reasonCode).toBe("SHARD_PLAN_UNAVAILABLE");
  });
});

describe("PHASE 0.8E — a structurally malformed plan is DISTINCT from overflow", () => {
  it("a REFUSED index-priority overflow is SHARD_PLAN_MALFORMED, not capacity", () => {
    const v = judgeShardPlanCapacity(refusedPlan("INDEX_PRIORITY_SHARD_OVERFLOW", 4200));
    expect(v.state).toBe("FAIL");
    expect(v.reasonCode).toBe("SHARD_PLAN_MALFORMED");
    expect(v.reasonCode).not.toBe("PROVIDER_CAPACITY_EXCEEDED");
  });

  it("a PLANNED plan failing a non-capacity invariant is SHARD_PLAN_MALFORMED", () => {
    // Duplicate token across two shards → admitShardPlan reports
    // TOKEN_IN_MULTIPLE_SHARDS (a structural, non-capacity blocker).
    const s0 = shard(0, 100, 10);
    const s1 = shard(1, 100, 10); // same token range → duplicates
    const v = judgeShardPlanCapacity(plannedPlan([s0, s1]));
    expect(v.state).toBe("FAIL");
    expect(v.reasonCode).toBe("SHARD_PLAN_MALFORMED");
    expect(v.reasonCode).not.toBe("PROVIDER_CAPACITY_EXCEEDED");
  });
});

describe("PHASE 0.8E — an admitted plan at/below capacity PASSES with exact metadata", () => {
  it("reports PASS and carries required / capacity / headroom", () => {
    // 3 balanced shards, 1000 tokens each = 3000 total, well under 9000.
    const s0 = shard(0, 1, 1000);
    const s1 = shard(1, 1_000_001, 1000);
    const s2 = shard(2, 2_000_001, 1000);
    const v = judgeShardPlanCapacity(plannedPlan([s0, s1, s2]));
    expect(v.state).toBe("PASS");
    expect(v.reasonCode).toBe("SHARD_PLAN_CAPACITY_ADMITTED");
    expect(v.requiredTokenCount).toBe(3000);
    expect(v.capacity).toBe(9000);
    expect(v.headroom).toBe(6000);
    // The headroom must be exactly capacity - required.
    expect(v.headroom).toBe(v.capacity - (v.requiredTokenCount ?? -1));
  });

  it("a plan exactly AT capacity (9000) still PASSES with zero headroom", () => {
    const s0 = shard(0, 1, 3000);
    const s1 = shard(1, 3_000_001, 3000);
    const s2 = shard(2, 6_000_001, 3000);
    const v = judgeShardPlanCapacity(plannedPlan([s0, s1, s2]));
    expect(v.state).toBe("PASS");
    expect(v.requiredTokenCount).toBe(9000);
    expect(v.headroom).toBe(0);
  });
});

describe("PHASE 0.8E — a TRUE overflow reports PROVIDER_CAPACITY_EXCEEDED", () => {
  it("the planner's PROVIDER_CAPACITY_EXCEEDED refusal is surfaced honestly", () => {
    // The planner already computed a token count above capacity.
    const v = judgeShardPlanCapacity(refusedPlan("PROVIDER_CAPACITY_EXCEEDED", 9500));
    expect(v.state).toBe("FAIL");
    expect(v.reasonCode).toBe("PROVIDER_CAPACITY_EXCEEDED");
    expect(v.requiredTokenCount).toBe(9500);
    expect(v.capacity).toBe(9000);
    expect(v.headroom).toBe(-500);
  });

  it("a PLANNED plan whose shard exceeds the per-socket ceiling is a capacity overflow", () => {
    // A single shard of 3001 tokens > MAX_TOKENS_PER_SOCKET (3000): the only
    // admission blocker is SHARD_TOKEN_CEILING_EXCEEDED, a capacity ceiling.
    const s0 = shard(0, 1, MAX_TOKENS_PER_SOCKET + 1);
    const v = judgeShardPlanCapacity(plannedPlan([s0]));
    expect(v.state).toBe("FAIL");
    expect(v.reasonCode).toBe("PROVIDER_CAPACITY_EXCEEDED");
    expect(v.requiredTokenCount).toBe(MAX_TOKENS_PER_SOCKET + 1);
  });
});

describe("PHASE 0.8E — the readiness report never lies about capacity when no generation exists", () => {
  it("with no generation installed the report never contains the dishonest literal", () => {
    // A fresh test process has no settled generation → manifest UNAVAILABLE →
    // planner REFUSED. This exercises the whole production report path without
    // any DB, network, provider or feed involvement.
    const report = buildActivationReadinessReport(NOW);
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain("SHARD_PLAN_EXCEEDS_PROVIDER_CAPACITY");

    const shardGate = (report.gates as Array<Record<string, unknown>>).find(
      (g) => g.gateId === "SHARD_PLAN_CAPACITY_ADMITTED",
    );
    expect(shardGate).toBeDefined();
    // Absence of a plan is NOT a proven overflow.
    expect(shardGate?.blockerCode).toBe("SHARD_PLAN_UNAVAILABLE");
    expect(shardGate?.state).toBe("NOT_EVALUATED");

    // The dedicated capacity summary agrees and reports no computed requirement.
    const cap = report.shardPlanCapacity as Record<string, unknown>;
    expect(cap.state).toBe("NOT_EVALUATED");
    expect(cap.blockerCode).toBe("SHARD_PLAN_UNAVAILABLE");
    expect(cap.requiredTokenCount).toBeNull();
    expect(cap.capacity).toBe(9000);
    expect(cap.headroom).toBeNull();

    // FAIL CLOSED: the feed is still refused; nothing was made admissible.
    expect(report.overall).toBe("REFUSED");
    expect(report.evidenceAdmittedByBoundary).toBe(false);
  });
});
