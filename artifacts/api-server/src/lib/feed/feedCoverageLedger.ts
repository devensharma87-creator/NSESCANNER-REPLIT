/**
 * PHASE 0.8B — FEED COVERAGE LEDGER
 *
 * Answers "how much of what we committed to cover is actually arriving?" with
 * an equation that cannot be satisfied by a convenient subset.
 *
 * TWO EQUATIONS, BOTH MANDATORY
 * -----------------------------
 *   (1) expected = fresh + stale + missing
 *   (2) expected = Σ per-shard expected
 *
 * (1) forces every committed instrument into exactly one bucket. Without it,
 * an instrument that is neither arriving nor accounted as missing simply
 * evaporates from the report, and coverage reads 100% of a shrunken universe.
 *
 * (2) forces the shard rows to reconcile with the total. A manager that lost a
 * shard and quietly stopped counting its instruments would otherwise report
 * full coverage of the two sockets it still holds — the most dangerous possible
 * reading, because DEGRADED would look identical to RUNNING.
 *
 * THE DENOMINATOR IS THE PLAN, NOT THE STORE
 * ------------------------------------------
 * `expected` comes from the accepted shard plan. It is never derived from how
 * many quotes happen to be in the store, because that denominator moves with
 * the numerator and can never expose a gap.
 *
 * A DISABLED FEED HAS ZERO COVERAGE, EVEN IF THE STORE IS FULL
 * ------------------------------------------------------------
 * When the feed is disabled or unobserved, every expected instrument counts as
 * MISSING regardless of what the live store contains. Quotes sitting in the
 * store while this feed has never run came from some other path; attributing
 * them to this feed would manufacture evidence of a feed that never opened a
 * socket. This is why development evidence reads DISABLED with zero fresh —
 * that is the honest reading, not a limitation of the harness.
 */

import type { FeedShardPlan } from "../registry/feedShardPlan";
import type { FeedManagerState } from "./feedManager";

/**
 * Whether this ledger reflects observed feed traffic.
 *
 * LIVE is deliberately absent from this union. Nothing in Phase 0.8B can
 * produce a live reading, so no code path can emit one.
 */
export type FeedObservationState =
  /** Feed is switched off by contract. No socket exists. */
  | "DISABLED"
  /** Feed could run but has not yet delivered an observation window. */
  | "NOT_OBSERVED"
  /** Real ticks were counted. Only reachable once the feed genuinely runs. */
  | "OBSERVED";

/**
 * Map manager state to what the ledger may CLAIM to have observed.
 *
 * Only RUNNING and DEGRADED can produce an observation, because only those
 * states hold a socket. Everything else is either switched off (DISABLED) or
 * capable-but-silent (NOT_OBSERVED). DEGRADED still counts as OBSERVED because
 * its surviving shards are genuinely delivering — the lost shard is excluded
 * by `lostShardIds`, which is what turns the gap into visible MISSING rows
 * rather than a shrunken denominator.
 */
export function observationStateForManager(state: FeedManagerState): FeedObservationState {
  if (state === "RUNNING" || state === "DEGRADED") return "OBSERVED";
  if (state === "DISABLED") return "DISABLED";
  return "NOT_OBSERVED";
}

export interface ShardCoverageRow {
  readonly shardId: number;
  readonly expected: number;
  readonly fresh: number;
  readonly stale: number;
  readonly missing: number;
  /** expected === fresh + stale + missing for THIS shard. */
  readonly equationHolds: boolean;
}

export interface FeedCoverageLedger {
  readonly observationState: FeedObservationState;
  readonly evaluatedAtMs: number;
  readonly freshnessWindowMs: number;
  readonly registryGenerationId: string | null;
  readonly expected: number;
  readonly fresh: number;
  readonly stale: number;
  readonly missing: number;
  readonly shards: readonly ShardCoverageRow[];
  /** expected === fresh + stale + missing across the whole feed. */
  readonly identityEquationHolds: boolean;
  /** expected === Σ shard.expected. */
  readonly shardSumEquationHolds: boolean;
  /** Both equations. A false here invalidates the entire report. */
  readonly equationsHold: boolean;
}

export interface BuildCoverageLedgerInput {
  /** The accepted plan. Null when no plan was admitted — expected is then 0. */
  readonly plan: FeedShardPlan | null;
  readonly observationState: FeedObservationState;
  readonly nowMs: number;
  readonly freshnessWindowMs: number;
  readonly registryGenerationId: string | null;
  /**
   * Last tick timestamp (epoch ms) for a canonical id, or null if none.
   * Consulted ONLY when observationState is OBSERVED.
   */
  readonly lookupLastTickMs: (canonicalInstrumentId: string) => number | null;
  /**
   * Shards whose socket is currently lost. Their instruments can never be
   * fresh: the socket that would deliver them does not exist.
   */
  readonly lostShardIds?: ReadonlySet<number>;
}

const EMPTY_LEDGER_SHARDS: readonly ShardCoverageRow[] = Object.freeze([]);

export function buildFeedCoverageLedger(input: BuildCoverageLedgerInput): FeedCoverageLedger {
  const { plan, observationState, nowMs, freshnessWindowMs } = input;
  const lostShardIds = input.lostShardIds ?? new Set<number>();

  if (plan === null || plan.state !== "PLANNED" || plan.shards.length === 0) {
    return Object.freeze({
      observationState,
      evaluatedAtMs: nowMs,
      freshnessWindowMs,
      registryGenerationId: input.registryGenerationId,
      expected: 0,
      fresh: 0,
      stale: 0,
      missing: 0,
      shards: EMPTY_LEDGER_SHARDS,
      identityEquationHolds: true,
      shardSumEquationHolds: true,
      equationsHold: true,
    });
  }

  const observing = observationState === "OBSERVED";
  const rows: ShardCoverageRow[] = [];
  let totalExpected = 0;
  let totalFresh = 0;
  let totalStale = 0;
  let totalMissing = 0;

  for (const shard of plan.shards) {
    const expected = shard.identities.length;
    let fresh = 0;
    let stale = 0;
    let missing = 0;
    const shardLost = lostShardIds.has(shard.shardId);

    for (const identity of shard.identities) {
      if (!observing || shardLost) {
        // No socket, or no observation window: the instrument is uncovered.
        // Reading the store here would credit this feed with another source's
        // data. See the header note.
        missing++;
        continue;
      }
      const lastTickMs = input.lookupLastTickMs(identity);
      if (lastTickMs === null || !Number.isFinite(lastTickMs) || lastTickMs <= 0) {
        missing++;
      } else if (nowMs - lastTickMs <= freshnessWindowMs) {
        fresh++;
      } else {
        stale++;
      }
    }

    rows.push(
      Object.freeze({
        shardId: shard.shardId,
        expected,
        fresh,
        stale,
        missing,
        equationHolds: expected === fresh + stale + missing,
      }),
    );

    totalExpected += expected;
    totalFresh += fresh;
    totalStale += stale;
    totalMissing += missing;
  }

  // Recomputed from the rows, never assumed from plan.totalTokens.
  const shardSum = rows.reduce((acc, r) => acc + r.expected, 0);
  const identityEquationHolds =
    totalExpected === totalFresh + totalStale + totalMissing &&
    rows.every((r) => r.equationHolds);
  const shardSumEquationHolds = totalExpected === shardSum;

  return Object.freeze({
    observationState,
    evaluatedAtMs: nowMs,
    freshnessWindowMs,
    registryGenerationId: input.registryGenerationId,
    expected: totalExpected,
    fresh: totalFresh,
    stale: totalStale,
    missing: totalMissing,
    shards: Object.freeze(rows),
    identityEquationHolds,
    shardSumEquationHolds,
    equationsHold: identityEquationHolds && shardSumEquationHolds,
  });
}
