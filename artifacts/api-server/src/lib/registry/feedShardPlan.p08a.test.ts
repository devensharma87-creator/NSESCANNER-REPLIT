/**
 * PHASE 0.8A — DETERMINISTIC SHARD PLANNER (10 targeted tests)
 *
 * Plans are built from REAL admission manifests produced by the production
 * builder. Nothing here opens a socket or constructs a ticker; the planner is
 * a pure function and these tests hold it to that.
 */

import { describe, it, expect } from "vitest";

import {
  MAX_SOCKETS,
  MAX_TOKENS_PER_SOCKET,
  PROVIDER_TOKEN_CAPACITY,
  orderForPlanning,
  planFeedShards,
} from "./feedShardPlan";
import { buildSubscriptionAdmissionManifest } from "./subscriptionManifest";
import {
  buildUniverseManifest,
  REQUIRED_SOURCE_IDS,
  type BuildManifestInput,
} from "./universeManifest";
import type { RegistryGeneration } from "./manifestStore";
import type { RegistryRecord } from "./instrumentRegistry";
import {
  makeLiveRecord,
  makeLiveRecords,
  makeBuildResult,
  makeAcceptedSources,
  makeCurrentAuthoritativeBse,
  makeCalendarCommitment,
  GEN_ID,
  GENERATED_AT,
  EFFECTIVE_DATE,
} from "./p06TestFixtures";

const BUILD_MS = Date.parse(GENERATED_AT);
/** IST 15:10 — same IST day, and before the session close the commitment names. */
const SAME_DAY_MS = BUILD_MS + 600_000;
const NEXT_DAY_MS = BUILD_MS + 86_400_000;

function buildInput(records: readonly RegistryRecord[]): BuildManifestInput {
  return {
    build: makeBuildResult(records),
    sources: makeAcceptedSources(),
    manifestVersion: 1,
    registryGenerationId: GEN_ID,
    generatedAt: GENERATED_AT,
    effectiveDate: EFFECTIVE_DATE,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
    bseAuthority: makeCurrentAuthoritativeBse(),
    tradingCalendar: makeCalendarCommitment(),
  };
}

function generation(records: readonly RegistryRecord[]): RegistryGeneration {
  return { manifest: buildUniverseManifest(buildInput(records)), records: [...records] };
}

function manifestOf(records: readonly RegistryRecord[], nowMs = SAME_DAY_MS) {
  return buildSubscriptionAdmissionManifest({
    generation: generation(records),
    nowMs,
    restorationSettled: true,
  });
}

function indexRecord(name: string, token: number): RegistryRecord {
  return makeLiveRecord({
    tradingSymbol: name,
    normalizedTradingSymbol: name,
    officialSymbol: name,
    canonicalInstrumentId: `NSE:INDEX:${name}`,
    authoritativeSecurityId: `NSE:${name}:INDEX`,
    segment: "INDEX",
    securityClass: "INDEX",
    kiteInstrumentToken: token,
    kiteExchangeToken: token,
    aliases: [name],
  });
}

describe("P08A S1-S5 — capacity arithmetic and determinism", () => {
  it("S1 an admitted set of exactly one socket's worth plans a single shard", () => {
    const plan = planFeedShards(manifestOf(makeLiveRecords(MAX_TOKENS_PER_SOCKET)));
    expect(plan.state).toBe("PLANNED");
    expect(plan.shards).toHaveLength(1);
    expect(plan.shards[0].count).toBe(MAX_TOKENS_PER_SOCKET);
    expect(plan.totalTokens).toBe(MAX_TOKENS_PER_SOCKET);
    expect(plan.headroom).toBe(PROVIDER_TOKEN_CAPACITY - MAX_TOKENS_PER_SOCKET);
  });

  it("S2 one token past a socket boundary opens a second shard, never an oversized one", () => {
    const plan = planFeedShards(manifestOf(makeLiveRecords(MAX_TOKENS_PER_SOCKET + 1)));
    expect(plan.shards.map((s) => s.count)).toEqual([MAX_TOKENS_PER_SOCKET, 1]);
    expect(plan.shards.every((s) => s.count <= MAX_TOKENS_PER_SOCKET)).toBe(true);
  });

  it("S3 a full 9,000-token universe fills exactly three sockets with zero headroom", () => {
    const plan = planFeedShards(manifestOf(makeLiveRecords(PROVIDER_TOKEN_CAPACITY)));
    expect(plan.state).toBe("PLANNED");
    expect(plan.shards).toHaveLength(MAX_SOCKETS);
    expect(plan.shards.map((s) => s.count)).toEqual([3000, 3000, 3000]);
    expect(plan.headroom).toBe(0);
    // Every admitted token appears exactly once across the shards.
    const all = plan.shards.flatMap((s) => s.tokens);
    expect(all).toHaveLength(PROVIDER_TOKEN_CAPACITY);
    expect(new Set(all).size).toBe(PROVIDER_TOKEN_CAPACITY);
  });

  it("S4 exceeding provider capacity REFUSES — it never truncates", () => {
    const plan = planFeedShards(manifestOf(makeLiveRecords(PROVIDER_TOKEN_CAPACITY + 1)));
    expect(plan.state).toBe("REFUSED");
    expect(plan.blockerCode).toBe("PROVIDER_CAPACITY_EXCEEDED");
    expect(plan.shards).toEqual([]);
    expect(plan.completeManifestHash).toBeNull();
    expect(plan.activationAuthorized).toBe(false);
    // The refusal reports the true requirement, so the overshoot is visible.
    expect(plan.totalTokens).toBe(PROVIDER_TOKEN_CAPACITY + 1);
    expect(plan.headroom).toBe(-1);
  });

  it("S5 the same universe plans byte-identically every time", () => {
    const records = makeLiveRecords(4_000);
    const a = planFeedShards(manifestOf(records));
    const b = planFeedShards(manifestOf(records));
    expect(b.completeManifestHash).toBe(a.completeManifestHash);
    expect(b.shards.map((s) => s.shardHash)).toEqual(a.shards.map((s) => s.shardHash));
    // ...and a single changed token changes the complete-manifest commitment.
    const moved = records.map((r, i) => (i === 7 ? { ...r, kiteInstrumentToken: 8_888_888 } : r));
    expect(planFeedShards(manifestOf(moved)).completeManifestHash).not.toBe(a.completeManifestHash);
  });
});

describe("P08A S6-S10 — order independence, priority and authorization", () => {
  it("S6 input order cannot change the plan", () => {
    const records = makeLiveRecords(3_500);
    const shuffled = [...records].reverse();
    const forward = planFeedShards(manifestOf(records));
    const backward = planFeedShards(manifestOf(shuffled));
    expect(backward.completeManifestHash).toBe(forward.completeManifestHash);
    expect(backward.shards[0].identities).toEqual(forward.shards[0].identities);
    expect(backward.shards[1].tokens).toEqual(forward.shards[1].tokens);
  });

  it("S7 indices are planned into shard 0 ahead of equities", () => {
    const records: RegistryRecord[] = [
      ...makeLiveRecords(3_100),
      indexRecord("NIFTY 50", 256265),
      indexRecord("NIFTY BANK", 260105),
    ];
    const plan = planFeedShards(manifestOf(records));
    expect(plan.shards).toHaveLength(2);
    expect(plan.shards[0].identities.slice(0, 2)).toEqual(["NSE:INDEX:NIFTY 50", "NSE:INDEX:NIFTY BANK"]);
    // No index leaked into a later shard.
    expect(plan.shards[1].identities.some((id) => id.includes(":INDEX:"))).toBe(false);
  });

  it("S8 shard 0 is the priority socket and the others are standard", () => {
    const plan = planFeedShards(manifestOf(makeLiveRecords(7_000)));
    expect(plan.shards.map((s) => s.priorityClass)).toEqual([
      "PRIORITY_INDEX_FIRST",
      "STANDARD_EQUITY",
      "STANDARD_EQUITY",
    ]);
    expect(plan.shards.map((s) => s.shardId)).toEqual([0, 1, 2]);
    expect(plan.maxSockets).toBe(MAX_SOCKETS);
    expect(plan.maxTokensPerSocket).toBe(MAX_TOKENS_PER_SOCKET);
  });

  it("S9 a candidate universe can be planned but never authorizes activation", () => {
    const plan = planFeedShards(manifestOf(makeLiveRecords(1_200), NEXT_DAY_MS));
    expect(plan.state).toBe("PLANNED");
    expect(plan.shards).toHaveLength(1);
    expect(plan.activationAuthorized).toBe(false);
    // The activatable case, for contrast.
    expect(planFeedShards(manifestOf(makeLiveRecords(1_200), SAME_DAY_MS)).activationAuthorized).toBe(true);
  });

  it("S10 an unavailable manifest yields no plan and propagates its blocker", () => {
    const unavailable = buildSubscriptionAdmissionManifest({
      generation: null,
      nowMs: SAME_DAY_MS,
      restorationSettled: true,
    });
    const plan = planFeedShards(unavailable);
    expect(plan.state).toBe("REFUSED");
    expect(plan.blockerCode).toBe("SUBSCRIPTION_MANIFEST_UNAVAILABLE");
    expect(plan.shards).toEqual([]);
    expect(plan.completeManifestHash).toBeNull();
    // The ordering helper is itself pure: it does not mutate its input.
    const input = [
      { canonicalInstrumentId: "NSE:EQUITY:B", exchange: "NSE" as const, segment: "EQUITY" as const, providerExchange: "NSE", providerToken: 2 },
      { canonicalInstrumentId: "NSE:INDEX:A", exchange: "NSE" as const, segment: "INDEX" as const, providerExchange: "NSE", providerToken: 1 },
    ];
    const snapshot = JSON.stringify(input);
    expect(orderForPlanning(input).map((x) => x.canonicalInstrumentId)).toEqual([
      "NSE:INDEX:A",
      "NSE:EQUITY:B",
    ]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
