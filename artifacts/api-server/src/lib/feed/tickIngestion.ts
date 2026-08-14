/**
 * PHASE 0.8B — CANONICAL TICK INGESTION
 *
 * The single doorway between provider bytes and the live quote store.
 *
 * IDENTITY COMES FROM THE TOKEN, NEVER FROM A SYMBOL
 * --------------------------------------------------
 * A provider tick carries an instrument token and nothing else that identifies
 * it. Resolving that token through the canonical registry is the ONLY admitted
 * path to an identity. Symbol matching is prohibited outright: "SBIN" exists on
 * both NSE and BSE, "NIFTY 50" is an index whose alias differs per consumer,
 * and a symbol collision does not fail — it silently writes one exchange's
 * price under another exchange's key. That corruption is undetectable
 * downstream because the resulting quote looks perfectly well-formed.
 *
 * SUBSCRIPTION BINDING IS A SEPARATE QUESTION FROM REGISTRY MEMBERSHIP
 * -------------------------------------------------------------------
 * A token can resolve cleanly and still not belong here. Providers replay
 * subscriptions across reconnects and occasionally deliver instruments a
 * previous connection asked for. So a tick must ALSO be one this manager
 * currently subscribes, on the shard it actually arrived on. A tick arriving on
 * the wrong shard means the shard bookkeeping and the socket disagree, and a
 * manager that accepts it can no longer say which socket covers what.
 *
 * GENERATION BINDING
 * ------------------
 * Token→identity mappings belong to a registry generation. When the generation
 * rotates, the same integer can denote a different instrument. A tick admitted
 * under a stale generation is attributed to whatever that token means NOW,
 * which is a mis-attribution, not a staleness problem. So the generation the
 * feed started under must equal the generation being resolved against.
 *
 * ABSENT IS NOT ZERO
 * ------------------
 * An optional field that the provider did not send stays absent. It is never
 * defaulted to 0, because `volume: 0` and `volume: undefined` are different
 * claims — the first says "no shares traded", the second says "not reported".
 * A field that IS present but unusable rejects the whole tick rather than being
 * quietly dropped, since dropping it would fabricate the absent case.
 */

import type { FeedTickEnvelope } from "./feedClientPort";
import { upsertQuote, type UpsertQuoteInput } from "../liveQuoteStore";
import { instrumentRegistry } from "../canonicalInstrument";

export type TickRejectReason =
  | "FEED_NOT_ACCEPTING"
  | "REGISTRY_GENERATION_MISMATCH"
  | "INVALID_PROVIDER_TOKEN"
  | "TOKEN_NOT_SUBSCRIBED"
  | "TOKEN_ARRIVED_ON_WRONG_SHARD"
  | "UNKNOWN_PROVIDER_TOKEN"
  | "INVALID_PRICE"
  | "INVALID_TIMESTAMP"
  | "INVALID_OPTIONAL_FIELD"
  | "STORE_REJECTED";

export type TickIngestResult =
  | { readonly ok: true; readonly canonicalInstrumentId: string }
  | { readonly ok: false; readonly reason: TickRejectReason; readonly detail: string };

/**
 * What the manager knows at the instant a tick lands.
 *
 * Supplied per call rather than read from module state so ingestion stays pure
 * with respect to the manager and can be tested without one.
 */
export interface TickAdmissionContext {
  /** False whenever the manager is not RUNNING or DEGRADED. */
  readonly accepting: boolean;
  /** Generation the shard plan was built from. */
  readonly planGenerationId: string | null;
  /** Generation the registry would resolve against right now. */
  readonly currentGenerationId: string | null;
  /** token -> shardId, for every token this manager subscribes. */
  readonly tokenToShardId: ReadonlyMap<number, number>;
}

/**
 * Read one optional numeric field.
 *
 * Three outcomes, never two: absent (fine), present and finite (copy),
 * present and unusable (reject the tick). There is no fourth branch that
 * substitutes a value.
 */
type OptionalRead =
  | { readonly kind: "ABSENT" }
  | { readonly kind: "VALUE"; readonly value: number }
  | { readonly kind: "INVALID" };

function readOptionalNumber(raw: unknown): OptionalRead {
  if (raw === undefined || raw === null) return { kind: "ABSENT" };
  if (typeof raw !== "number" || !Number.isFinite(raw)) return { kind: "INVALID" };
  return { kind: "VALUE", value: raw };
}

const OPTIONAL_FIELDS = ["open", "high", "low", "close", "volume", "changePercent"] as const;
type OptionalField = (typeof OPTIONAL_FIELDS)[number];

/**
 * Admit or refuse one tick, and on admission write it to the live store.
 *
 * @param envelope  The provider tick.
 * @param shardId   The shard whose socket delivered it.
 * @param ctx       Manager state at delivery time.
 */
export function ingestTick(
  envelope: FeedTickEnvelope,
  shardId: number,
  ctx: TickAdmissionContext,
): TickIngestResult {
  if (!ctx.accepting) {
    return { ok: false, reason: "FEED_NOT_ACCEPTING", detail: "manager is not in an accepting state" };
  }

  // Generation binding before identity resolution: resolving first and
  // checking after would mean the mis-attributed identity already existed.
  if (ctx.planGenerationId === null || ctx.currentGenerationId === null) {
    return {
      ok: false,
      reason: "REGISTRY_GENERATION_MISMATCH",
      detail: "a generation id is absent; token meaning cannot be bound",
    };
  }
  if (ctx.planGenerationId !== ctx.currentGenerationId) {
    return {
      ok: false,
      reason: "REGISTRY_GENERATION_MISMATCH",
      detail: "shard plan generation differs from the current registry generation",
    };
  }

  const token = envelope.providerToken;
  if (!Number.isSafeInteger(token) || token <= 0) {
    return { ok: false, reason: "INVALID_PROVIDER_TOKEN", detail: String(token) };
  }

  const owningShard = ctx.tokenToShardId.get(token);
  if (owningShard === undefined) {
    return { ok: false, reason: "TOKEN_NOT_SUBSCRIBED", detail: String(token) };
  }
  if (owningShard !== shardId) {
    return {
      ok: false,
      reason: "TOKEN_ARRIVED_ON_WRONG_SHARD",
      detail: `expected shard ${owningShard}, delivered on ${shardId}`,
    };
  }

  // The registry is the identity authority. An unresolvable token is refused
  // here rather than being matched by symbol as a fallback.
  const identity = instrumentRegistry.resolveByToken(token);
  if (identity === null) {
    return { ok: false, reason: "UNKNOWN_PROVIDER_TOKEN", detail: String(token) };
  }

  if (typeof envelope.ltp !== "number" || !Number.isFinite(envelope.ltp)) {
    return { ok: false, reason: "INVALID_PRICE", detail: String(envelope.ltp) };
  }
  if (typeof envelope.ts !== "number" || !Number.isFinite(envelope.ts) || envelope.ts <= 0) {
    return { ok: false, reason: "INVALID_TIMESTAMP", detail: String(envelope.ts) };
  }

  const input: {
    -readonly [K in keyof UpsertQuoteInput]: UpsertQuoteInput[K];
  } = {
    providerInstrumentToken: token,
    provider: "KITE",
    ltp: envelope.ltp,
    ts: envelope.ts,
  };

  for (const field of OPTIONAL_FIELDS) {
    const read = readOptionalNumber((envelope as Record<OptionalField, unknown>)[field]);
    if (read.kind === "INVALID") {
      return { ok: false, reason: "INVALID_OPTIONAL_FIELD", detail: field };
    }
    if (read.kind === "VALUE") input[field] = read.value;
  }

  const stored = upsertQuote(input);
  if (!stored.ok) {
    return { ok: false, reason: "STORE_REJECTED", detail: `${stored.reason}: ${stored.detail}` };
  }
  return { ok: true, canonicalInstrumentId: stored.tick.canonicalInstrumentId };
}
