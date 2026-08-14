/**
 * PHASE 0.8B — SHARD PLAN ADMISSION INVARIANTS
 *
 * The planner (Phase 0.8A) produced a plan. This module re-proves that plan is
 * safe to ACT on, immediately before acting, from the plan's own content.
 *
 * WHY RE-PROVE SOMETHING ALREADY PROVEN
 * -------------------------------------
 * The planner's guarantees were established at planning time, against the
 * manifest it was handed. Between planning and starting, the plan travels
 * through a diagnostics surface, a manager, and a start call. Trusting
 * `state === "PLANNED"` means trusting that nothing in that journey — and no
 * future refactor of the planner — ever produced a plan whose declared state
 * disagrees with its actual contents.
 *
 * That is the fail-open shape: a label is not the property it names. Every
 * check below is recomputed from `shards`, never read from a summary field.
 *
 * THE INVARIANT THAT ACTUALLY PREVENTS DATA LOSS
 * ----------------------------------------------
 * TOKEN EXCLUSIVITY. If one token lands in two shards, two sockets subscribe
 * to it, and the token budget is overspent by one — silently. If a token lands
 * in NO shard, the instrument is simply never quoted, and nothing anywhere
 * reports a gap: coverage looks complete because the denominator was computed
 * from the same broken plan. So the union of shard tokens is checked for both
 * duplication AND completeness against the declared total.
 */

import type { FeedShardPlan } from "../registry/feedShardPlan";
import { MAX_SOCKETS, MAX_TOKENS_PER_SOCKET } from "../registry/feedShardPlan";

export type ShardAdmissionBlocker =
  | "SHARD_PLAN_NOT_PLANNED"
  | "SHARD_PLAN_EMPTY"
  | "SOCKET_CEILING_EXCEEDED"
  | "SHARD_TOKEN_CEILING_EXCEEDED"
  | "SHARD_IDENTITY_TOKEN_LENGTH_MISMATCH"
  | "SHARD_DECLARED_COUNT_MISMATCH"
  | "TOKEN_IN_MULTIPLE_SHARDS"
  | "INVALID_PROVIDER_TOKEN"
  | "TOTAL_TOKENS_DISAGREE_WITH_SHARDS"
  | "IDENTITY_IN_MULTIPLE_SHARDS"
  | "EMPTY_SHARD_PRESENT"
  | "SHARD_IDS_NOT_CONTIGUOUS"
  | "INDEX_PRIORITY_SHARD_MISSING"
  | "MISSING_COMPLETE_MANIFEST_HASH";

export interface ShardAdmissionVerdict {
  readonly admitted: boolean;
  readonly blockers: readonly ShardAdmissionBlocker[];
  /** Recomputed from shard contents — never copied from `plan.totalTokens`. */
  readonly observedTotalTokens: number;
  readonly observedShardCount: number;
}

function verdict(
  blockers: ShardAdmissionBlocker[],
  observedTotalTokens: number,
  observedShardCount: number,
): ShardAdmissionVerdict {
  return Object.freeze({
    admitted: blockers.length === 0,
    blockers: Object.freeze([...blockers]),
    observedTotalTokens,
    observedShardCount,
  });
}

/**
 * Decide whether this plan may be acted on.
 *
 * Pure. Opens nothing, mutates nothing, and reaches no registry — it reasons
 * only about the plan object it was given.
 */
export function admitShardPlan(plan: FeedShardPlan): ShardAdmissionVerdict {
  const blockers: ShardAdmissionBlocker[] = [];

  if (plan.state !== "PLANNED") {
    // Nothing below is meaningful for a refused plan; report only the refusal
    // so the caller sees the actual cause rather than a cascade of symptoms.
    return verdict(["SHARD_PLAN_NOT_PLANNED"], 0, plan.shards.length);
  }

  const shards = plan.shards;
  if (shards.length === 0) {
    return verdict(["SHARD_PLAN_EMPTY"], 0, 0);
  }
  if (shards.length > MAX_SOCKETS) blockers.push("SOCKET_CEILING_EXCEEDED");
  if (plan.completeManifestHash === null) blockers.push("MISSING_COMPLETE_MANIFEST_HASH");

  const seenTokens = new Set<number>();
  const seenIdentities = new Set<string>();
  let duplicateToken = false;
  let duplicateIdentity = false;
  let badToken = false;
  let observedTotal = 0;

  for (let i = 0; i < shards.length; i++) {
    const shard = shards[i]!;

    if (shard.shardId !== i) blockers.push("SHARD_IDS_NOT_CONTIGUOUS");
    if (shard.tokens.length === 0) blockers.push("EMPTY_SHARD_PRESENT");
    if (shard.tokens.length > MAX_TOKENS_PER_SOCKET) blockers.push("SHARD_TOKEN_CEILING_EXCEEDED");
    if (shard.tokens.length !== shard.identities.length) {
      blockers.push("SHARD_IDENTITY_TOKEN_LENGTH_MISMATCH");
    }
    if (shard.count !== shard.tokens.length) blockers.push("SHARD_DECLARED_COUNT_MISMATCH");

    for (const token of shard.tokens) {
      observedTotal++;
      if (!Number.isSafeInteger(token) || token <= 0) badToken = true;
      if (seenTokens.has(token)) duplicateToken = true;
      seenTokens.add(token);
    }
    for (const identity of shard.identities) {
      if (seenIdentities.has(identity)) duplicateIdentity = true;
      seenIdentities.add(identity);
    }
  }

  if (badToken) blockers.push("INVALID_PROVIDER_TOKEN");
  if (duplicateToken) blockers.push("TOKEN_IN_MULTIPLE_SHARDS");
  if (duplicateIdentity) blockers.push("IDENTITY_IN_MULTIPLE_SHARDS");
  if (observedTotal !== plan.totalTokens) blockers.push("TOTAL_TOKENS_DISAGREE_WITH_SHARDS");
  if (shards[0]!.priorityClass !== "PRIORITY_INDEX_FIRST") {
    blockers.push("INDEX_PRIORITY_SHARD_MISSING");
  }

  return verdict(blockers, observedTotal, shards.length);
}
