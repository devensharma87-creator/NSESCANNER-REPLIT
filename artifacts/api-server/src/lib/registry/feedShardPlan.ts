/**
 * PHASE 0.8A — DETERMINISTIC FEED SHARD PLANNER
 *
 * Turns an admitted subscription set into the exact socket layout a future
 * phase would use. It is a PURE function: same input, same plan, byte for byte,
 * on every process and every replica. Nothing here opens a socket, constructs a
 * ticker, subscribes, or records that a plan was "used" — planning and acting
 * are separate phases on purpose.
 *
 * WHY DETERMINISM IS A SAFETY PROPERTY, NOT A NICETY
 * --------------------------------------------------
 * Two processes that plan differently from the same universe will each believe
 * they hold the complete feed while between them duplicating some instruments
 * and dropping others. The drop is silent. So the plan is derived only from the
 * admitted set's own content — sorted canonically, never by arrival order, and
 * never by a clock, a random seed, or a hostname.
 *
 * CAPACITY IS A CEILING, NOT A TARGET
 * -----------------------------------
 * One Kite API key allows 3 concurrent sockets of 3,000 tokens each. When the
 * admitted set exceeds 9,000 the planner REFUSES with
 * `PROVIDER_CAPACITY_EXCEEDED`. It does not truncate: a truncated plan that
 * reports success is a coverage lie, and the caller cannot tell it apart from a
 * complete one.
 */

import { createHash } from "node:crypto";
import type { AdmittedInstrument, SubscriptionAdmissionManifest } from "./subscriptionManifest";
import { SUBSCRIPTION_POLICY_VERSION } from "./subscriptionManifest";

/** Provider limits. Documented Kite Connect WebSocket constraints. */
export const MAX_SOCKETS = 3;
export const MAX_TOKENS_PER_SOCKET = 3000;
export const PROVIDER_TOKEN_CAPACITY = MAX_SOCKETS * MAX_TOKENS_PER_SOCKET;

export const SHARD_POLICY_VERSION = 1;

/**
 * Shard 0 carries the indices and is reconnected first. Full-coverage failover
 * is impossible by construction at this scale (losing one full socket strands
 * ~2,600 tokens the survivors have no room for), so the plan states the
 * recovery priority explicitly instead of pretending failover is seamless.
 */
export type ShardPriorityClass = "PRIORITY_INDEX_FIRST" | "STANDARD_EQUITY";

export interface FeedShard {
  readonly shardId: number;
  readonly priorityClass: ShardPriorityClass;
  readonly count: number;
  readonly identities: readonly string[];
  readonly tokens: readonly number[];
  /** sha256 over this shard's ordered identity|token pairs. */
  readonly shardHash: string;
}

export type ShardPlanState = "PLANNED" | "REFUSED";

export interface FeedShardPlan {
  readonly state: ShardPlanState;
  readonly blockerCode: string | null;
  readonly registryGenerationId: string | null;
  readonly subscriptionPolicyVersion: number;
  readonly shardPolicyVersion: number;
  readonly capacity: number;
  readonly maxSockets: number;
  readonly maxTokensPerSocket: number;
  readonly totalTokens: number;
  readonly headroom: number;
  readonly shards: readonly FeedShard[];
  /** sha256 over every shard hash in shard order, plus the totals. */
  readonly completeManifestHash: string | null;
  /**
   * Planning is not activation. Even a perfect plan built from a
   * CANDIDATE_LAST_KNOWN manifest may not be acted on.
   */
  readonly activationAuthorized: boolean;
}

function hashPairs(pairs: readonly string[], header: string): string {
  return createHash("sha256").update(`${header}\n${pairs.join("\n")}`, "utf8").digest("hex");
}

function refused(blockerCode: string, generationId: string | null, totalTokens: number): FeedShardPlan {
  return Object.freeze({
    state: "REFUSED" as const,
    blockerCode,
    registryGenerationId: generationId,
    subscriptionPolicyVersion: SUBSCRIPTION_POLICY_VERSION,
    shardPolicyVersion: SHARD_POLICY_VERSION,
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

/**
 * Canonical planning order.
 *
 * Indices first (they are the reference series every downstream computation
 * hangs off, and there are few of them), then equities. Within each group,
 * ascending canonical instrument id. Input order is irrelevant by construction.
 */
export function orderForPlanning(admitted: readonly AdmittedInstrument[]): AdmittedInstrument[] {
  return [...admitted].sort((a, b) => {
    const ai = a.segment === "INDEX" ? 0 : 1;
    const bi = b.segment === "INDEX" ? 0 : 1;
    if (ai !== bi) return ai - bi;
    if (a.canonicalInstrumentId === b.canonicalInstrumentId) return 0;
    return a.canonicalInstrumentId < b.canonicalInstrumentId ? -1 : 1;
  });
}

/**
 * Plan the shard layout for an admission manifest.
 *
 * The manifest may be CANDIDATE_LAST_KNOWN — planning an expired universe is
 * legitimate and useful. What the plan then carries is `activationAuthorized:
 * false`, which is the manifest's own verdict, copied, never re-derived.
 */
export function planFeedShards(manifest: SubscriptionAdmissionManifest): FeedShardPlan {
  if (manifest.state === "UNAVAILABLE") {
    return refused(
      manifest.blockerCode ?? "SUBSCRIPTION_MANIFEST_UNAVAILABLE",
      manifest.registryGenerationId,
      0,
    );
  }

  const ordered = orderForPlanning(manifest.admitted);
  const total = ordered.length;

  if (total === 0) {
    return refused("NO_ADMITTED_LIVE_INSTRUMENTS", manifest.registryGenerationId, 0);
  }
  if (total > PROVIDER_TOKEN_CAPACITY) {
    return refused("PROVIDER_CAPACITY_EXCEEDED", manifest.registryGenerationId, total);
  }

  const shards: FeedShard[] = [];
  for (let shardId = 0; shardId * MAX_TOKENS_PER_SOCKET < total; shardId++) {
    const slice = ordered.slice(shardId * MAX_TOKENS_PER_SOCKET, (shardId + 1) * MAX_TOKENS_PER_SOCKET);
    const pairs = slice.map((a) => `${a.canonicalInstrumentId}|${a.providerExchange}|${a.providerToken}`);
    shards.push(
      Object.freeze({
        shardId,
        priorityClass: shardId === 0 ? ("PRIORITY_INDEX_FIRST" as const) : ("STANDARD_EQUITY" as const),
        count: slice.length,
        identities: Object.freeze(slice.map((a) => a.canonicalInstrumentId)),
        tokens: Object.freeze(slice.map((a) => a.providerToken)),
        shardHash: hashPairs(pairs, `shard=${shardId}\ncount=${slice.length}`),
      }),
    );
  }

  // Defensive: the loop cannot exceed MAX_SOCKETS given the capacity check
  // above, but a future edit to either constant must fail closed rather than
  // silently plan a fourth socket the key cannot open.
  if (shards.length > MAX_SOCKETS) {
    return refused("PROVIDER_CAPACITY_EXCEEDED", manifest.registryGenerationId, total);
  }

  const completeManifestHash = hashPairs(
    shards.map((s) => `${s.shardId}:${s.count}:${s.shardHash}`),
    [
      `generation=${manifest.registryGenerationId ?? "NULL"}`,
      `subscriptionPolicy=${SUBSCRIPTION_POLICY_VERSION}`,
      `shardPolicy=${SHARD_POLICY_VERSION}`,
      `total=${total}`,
      `subscriptionSetHash=${manifest.subscriptionSetHash ?? "NULL"}`,
    ].join("\n"),
  );

  return Object.freeze({
    state: "PLANNED" as const,
    blockerCode: null,
    registryGenerationId: manifest.registryGenerationId,
    subscriptionPolicyVersion: SUBSCRIPTION_POLICY_VERSION,
    shardPolicyVersion: SHARD_POLICY_VERSION,
    capacity: PROVIDER_TOKEN_CAPACITY,
    maxSockets: MAX_SOCKETS,
    maxTokensPerSocket: MAX_TOKENS_PER_SOCKET,
    totalTokens: total,
    headroom: PROVIDER_TOKEN_CAPACITY - total,
    shards: Object.freeze(shards),
    completeManifestHash,
    activationAuthorized: manifest.activationAuthorized,
  });
}
