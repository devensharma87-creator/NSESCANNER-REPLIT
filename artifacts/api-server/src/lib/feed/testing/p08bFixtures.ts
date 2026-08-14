/**
 * PHASE 0.8B — TEST FIXTURES
 *
 * Imported ONLY by `*.test.ts` files. No production module imports this file;
 * a test in `p08b.shutdownDiagnostics.test.ts` asserts that by scanning the
 * feed directory, so the assertion fails if this ever leaks into a shipped
 * path.
 *
 * The fake client is deliberately a full participant in the port contract
 * rather than a stub that returns `true`: it records call ORDER, which is the
 * only way to prove "old socket closed before replacement constructed".
 */

import type {
  FeedClientFactory,
  FeedClientOpResult,
  FeedClientPort,
  FeedClientSpec,
  FeedClientState,
  FeedSubscribeResult,
} from "../feedClientPort";
import type { FeedShard, FeedShardPlan } from "../../registry/feedShardPlan";
import {
  MAX_SOCKETS,
  MAX_TOKENS_PER_SOCKET,
  PROVIDER_TOKEN_CAPACITY,
  SHARD_POLICY_VERSION,
} from "../../registry/feedShardPlan";

export const TEST_GENERATION_ID = "gen-p08b-0001";

/** Build a shard whose tokens are unique across the whole plan. */
export function makeShard(shardId: number, tokens: number[], indexFirst: boolean): FeedShard {
  return Object.freeze({
    shardId,
    priorityClass: indexFirst ? ("PRIORITY_INDEX_FIRST" as const) : ("STANDARD_EQUITY" as const),
    count: tokens.length,
    identities: Object.freeze(tokens.map((t) => `NSE:EQUITY:SYM${t}`)),
    tokens: Object.freeze([...tokens]),
    shardHash: `hash-shard-${shardId}-${tokens.length}`,
  });
}

export interface MakePlanOptions {
  readonly state?: "PLANNED" | "REFUSED";
  readonly totalTokensOverride?: number;
  readonly completeManifestHash?: string | null;
  readonly firstShardPriority?: "PRIORITY_INDEX_FIRST" | "STANDARD_EQUITY";
}

/**
 * Build a plan from shard sizes. Tokens are globally unique and sequential
 * unless a test deliberately introduces a collision.
 */
export function makePlan(shardSizes: number[], opts: MakePlanOptions = {}): FeedShardPlan {
  let next = 1000;
  const shards = shardSizes.map((size, i) => {
    const tokens: number[] = [];
    for (let k = 0; k < size; k++) tokens.push(next++);
    const shard = makeShard(i, tokens, i === 0);
    if (i === 0 && opts.firstShardPriority !== undefined) {
      return Object.freeze({ ...shard, priorityClass: opts.firstShardPriority });
    }
    return shard;
  });
  const total = shardSizes.reduce((a, b) => a + b, 0);
  return Object.freeze({
    state: opts.state ?? ("PLANNED" as const),
    blockerCode: opts.state === "REFUSED" ? "TEST_REFUSED" : null,
    registryGenerationId: TEST_GENERATION_ID,
    subscriptionPolicyVersion: 1,
    shardPolicyVersion: SHARD_POLICY_VERSION,
    capacity: PROVIDER_TOKEN_CAPACITY,
    maxSockets: MAX_SOCKETS,
    maxTokensPerSocket: MAX_TOKENS_PER_SOCKET,
    totalTokens: opts.totalTokensOverride ?? total,
    headroom: PROVIDER_TOKEN_CAPACITY - total,
    shards: Object.freeze(shards),
    completeManifestHash:
      opts.completeManifestHash === undefined ? "complete-hash" : opts.completeManifestHash,
    activationAuthorized: true,
  });
}

/** Replace one shard's token list wholesale (used to force collisions). */
export function withShardTokens(plan: FeedShardPlan, shardId: number, tokens: number[]): FeedShardPlan {
  const shards = plan.shards.map((s) =>
    s.shardId === shardId ? makeShard(shardId, tokens, s.priorityClass === "PRIORITY_INDEX_FIRST") : s,
  );
  return Object.freeze({ ...plan, shards: Object.freeze(shards) });
}

// ---------------------------------------------------------------------------
// Fake client
// ---------------------------------------------------------------------------

export type CallKind = "CONSTRUCT" | "CONNECT" | "SUBSCRIBE" | "CLOSE";

export interface CallRecord {
  readonly kind: CallKind;
  readonly shardId: number;
}

export interface FakeClientBehavior {
  /** Shard ids whose factory call should throw. */
  readonly constructThrowsOn?: ReadonlySet<number>;
  /** Shard ids whose connect() should resolve ok:false. */
  readonly connectFailsOn?: ReadonlySet<number>;
  /** Shard ids whose connect() should throw. */
  readonly connectThrowsOn?: ReadonlySet<number>;
  /** Shard ids whose subscribe() should resolve ok:false. */
  readonly subscribeFailsOn?: ReadonlySet<number>;
  /** Shard ids whose subscribe() should throw. */
  readonly subscribeThrowsOn?: ReadonlySet<number>;
  /** Shard ids that confirm FEWER tokens than requested. */
  readonly subscribeShortOn?: ReadonlySet<number>;
  /** Shard ids whose close() resolves ok:false. */
  readonly closeFailsOn?: ReadonlySet<number>;
  /** Shard ids whose close() throws. */
  readonly closeThrowsOn?: ReadonlySet<number>;
  /** Shard ids that accept the subscribe request without provider confirmation. */
  readonly unconfirmedSubscribeOn?: ReadonlySet<number>;
}

export interface FakeClientHarness {
  readonly factory: FeedClientFactory;
  readonly calls: CallRecord[];
  /** Every client ever constructed, in construction order. */
  readonly constructed: FakeClient[];
  /** Clients that have not been closed. Peak of this is the concurrency. */
  liveCount(): number;
  peakLive(): number;
  callsOfKind(kind: CallKind): CallRecord[];
  specFor(shardId: number): FeedClientSpec | undefined;
}

export interface FakeClient extends FeedClientPort {
  readonly spec: FeedClientSpec;
  closed(): boolean;
}

export function makeFakeClientHarness(behavior: FakeClientBehavior = {}): FakeClientHarness {
  const calls: CallRecord[] = [];
  const constructed: FakeClient[] = [];
  let live = 0;
  let peak = 0;

  const factory: FeedClientFactory = async (spec) => {
    calls.push({ kind: "CONSTRUCT", shardId: spec.shardId });
    if (behavior.constructThrowsOn?.has(spec.shardId)) {
      throw new Error(`CONSTRUCT_FAILED_SHARD_${spec.shardId}`);
    }

    let state: FeedClientState = "CONSTRUCTED";
    let isClosed = false;
    let subscribedCount = 0;
    live++;
    if (live > peak) peak = live;

    const client: FakeClient = {
      shardId: spec.shardId,
      spec,
      state: () => state,
      closed: () => isClosed,
      subscribedTokenCount: () => subscribedCount,

      async connect(): Promise<FeedClientOpResult> {
        calls.push({ kind: "CONNECT", shardId: spec.shardId });
        if (behavior.connectThrowsOn?.has(spec.shardId)) {
          throw new Error(`CONNECT_THREW_SHARD_${spec.shardId}`);
        }
        if (behavior.connectFailsOn?.has(spec.shardId)) {
          state = "FAILED";
          return { ok: false, detail: `CONNECT_REFUSED_SHARD_${spec.shardId}` };
        }
        state = "CONNECTED";
        return { ok: true, detail: "CONNECTED" };
      },

      async subscribe(tokens: readonly number[]): Promise<FeedSubscribeResult> {
        calls.push({ kind: "SUBSCRIBE", shardId: spec.shardId });
        if (behavior.subscribeThrowsOn?.has(spec.shardId)) {
          throw new Error(`SUBSCRIBE_THREW_SHARD_${spec.shardId}`);
        }
        if (behavior.subscribeFailsOn?.has(spec.shardId)) {
          return {
            ok: false,
            acceptedTokens: [],
            detail: "SUBSCRIBE_REFUSED",
            confirmation: "PROVIDER_ACKNOWLEDGED",
          };
        }
        if (behavior.subscribeShortOn?.has(spec.shardId)) {
          const short = tokens.slice(0, Math.max(0, tokens.length - 1));
          subscribedCount = short.length;
          return { ok: true, acceptedTokens: short, detail: "PARTIAL", confirmation: "PROVIDER_ACKNOWLEDGED" };
        }
        subscribedCount = tokens.length;
        return {
          ok: true,
          acceptedTokens: [...tokens],
          detail: "SUBSCRIBED",
          confirmation: behavior.unconfirmedSubscribeOn?.has(spec.shardId)
            ? "REQUEST_ACCEPTED_UNCONFIRMED"
            : "PROVIDER_ACKNOWLEDGED",
        };
      },

      async close(): Promise<FeedClientOpResult> {
        calls.push({ kind: "CLOSE", shardId: spec.shardId });
        if (behavior.closeThrowsOn?.has(spec.shardId)) {
          throw new Error(`CLOSE_THREW_SHARD_${spec.shardId}`);
        }
        if (behavior.closeFailsOn?.has(spec.shardId)) {
          return { ok: false, detail: `CLOSE_REFUSED_SHARD_${spec.shardId}` };
        }
        if (!isClosed) {
          isClosed = true;
          live--;
        }
        state = "CLOSED";
        return { ok: true, detail: "CLOSED" };
      },
    };

    constructed.push(client);
    return client;
  };

  return {
    factory,
    calls,
    constructed,
    liveCount: () => live,
    peakLive: () => peak,
    callsOfKind: (kind) => calls.filter((c) => c.kind === kind),
    specFor: (shardId) => constructed.find((c) => c.shardId === shardId)?.spec,
  };
}
