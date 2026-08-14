/**
 * PHASE 0.8B — GATE E: COVERAGE LEDGER
 *
 * Both equations, on every path:
 *   expected = fresh + stale + missing
 *   expected = Σ per-shard expected
 *
 * Plus the honesty rule: a feed that never opened a socket reports zero
 * coverage even when the live store is full of quotes from another source.
 */

import { describe, it, expect } from "vitest";
import {
  buildFeedCoverageLedger,
  observationStateForManager,
  type FeedObservationState,
} from "./feedCoverageLedger";
import { makePlan, TEST_GENERATION_ID } from "./testing/p08bFixtures";

const NOW = 1_700_000_000_000;
const WINDOW = 60_000;

function build(
  observationState: FeedObservationState,
  lookupLastTickMs: (id: string) => number | null = () => null,
  lostShardIds?: ReadonlySet<number>,
  shardSizes: number[] = [3, 2, 2],
) {
  return buildFeedCoverageLedger({
    plan: makePlan(shardSizes),
    observationState,
    nowMs: NOW,
    freshnessWindowMs: WINDOW,
    registryGenerationId: TEST_GENERATION_ID,
    lookupLastTickMs,
    lostShardIds,
  });
}

describe("P0.8B Gate E — the two equations", () => {
  it("E1: expected equals fresh + stale + missing when DISABLED", () => {
    const l = build("DISABLED");
    expect(l.expected).toBe(7);
    expect(l.fresh + l.stale + l.missing).toBe(l.expected);
    expect(l.identityEquationHolds).toBe(true);
  });

  it("E2: expected equals the sum of per-shard expected", () => {
    const l = build("DISABLED");
    const sum = l.shards.reduce((a, s) => a + s.expected, 0);
    expect(sum).toBe(l.expected);
    expect(l.shardSumEquationHolds).toBe(true);
  });

  it("E3: both equations hold when fully observed and fresh", () => {
    const l = build("OBSERVED", () => NOW - 1_000);
    expect(l.fresh).toBe(7);
    expect(l.stale).toBe(0);
    expect(l.missing).toBe(0);
    expect(l.equationsHold).toBe(true);
  });

  it("E4: every per-shard row satisfies its own equation", () => {
    const l = build("OBSERVED", (id) => (id.endsWith("0") ? NOW - 1_000 : null));
    for (const row of l.shards) {
      expect(row.fresh + row.stale + row.missing).toBe(row.expected);
      expect(row.equationHolds).toBe(true);
    }
  });
});

describe("P0.8B Gate E — a disabled feed claims nothing", () => {
  it("E5: DISABLED counts every expected instrument as missing", () => {
    const l = build("DISABLED");
    expect(l.observationState).toBe("DISABLED");
    expect(l.fresh).toBe(0);
    expect(l.stale).toBe(0);
    expect(l.missing).toBe(l.expected);
  });

  it("E6: DISABLED never consults the quote store", () => {
    let reads = 0;
    const l = build("DISABLED", () => {
      reads++;
      return NOW;
    });
    expect(reads).toBe(0);
    expect(l.fresh).toBe(0);
  });

  it("E7: a store full of fresh quotes cannot make a DISABLED feed look covered", () => {
    // Every instrument has a brand-new tick from some OTHER source.
    const l = build("DISABLED", () => NOW);
    expect(l.fresh).toBe(0);
    expect(l.missing).toBe(l.expected);
  });

  it("E8: NOT_OBSERVED behaves the same as DISABLED for counting purposes", () => {
    const l = build("NOT_OBSERVED", () => NOW);
    expect(l.fresh).toBe(0);
    expect(l.missing).toBe(l.expected);
    expect(l.equationsHold).toBe(true);
  });

  it("E9: the ledger type cannot express a LIVE reading", () => {
    const l = build("DISABLED");
    expect(["DISABLED", "NOT_OBSERVED", "OBSERVED"]).toContain(l.observationState);
    expect(l.observationState).not.toBe("LIVE");
  });
});

describe("P0.8B Gate E — freshness and lost shards", () => {
  it("E10: a tick older than the window counts stale, not missing", () => {
    const l = build("OBSERVED", () => NOW - (WINDOW + 1));
    expect(l.stale).toBe(7);
    expect(l.fresh).toBe(0);
    expect(l.missing).toBe(0);
  });

  it("E11: a tick exactly at the window boundary counts fresh", () => {
    const l = build("OBSERVED", () => NOW - WINDOW);
    expect(l.fresh).toBe(7);
    expect(l.stale).toBe(0);
  });

  it("E12: an instrument with no tick counts missing", () => {
    const l = build("OBSERVED", () => null);
    expect(l.missing).toBe(7);
  });

  it("E13: a lost shard's instruments are all missing, even while observing", () => {
    const l = build("OBSERVED", () => NOW, new Set([1]));
    const lostRow = l.shards.find((s) => s.shardId === 1)!;
    expect(lostRow.missing).toBe(lostRow.expected);
    expect(lostRow.fresh).toBe(0);
  });

  it("E14: a lost shard does NOT shrink the denominator", () => {
    const healthy = build("OBSERVED", () => NOW);
    const degraded = build("OBSERVED", () => NOW, new Set([1]));
    expect(degraded.expected).toBe(healthy.expected);
    expect(degraded.shards).toHaveLength(healthy.shards.length);
    expect(degraded.equationsHold).toBe(true);
    // DEGRADED must be visibly different from RUNNING.
    expect(degraded.fresh).toBeLessThan(healthy.fresh);
  });

  it("E15: no plan yields zeroed counters with both equations satisfied", () => {
    const l = buildFeedCoverageLedger({
      plan: null,
      observationState: "DISABLED",
      nowMs: NOW,
      freshnessWindowMs: WINDOW,
      registryGenerationId: null,
      lookupLastTickMs: () => NOW,
    });
    expect(l.expected).toBe(0);
    expect(l.shards).toHaveLength(0);
    expect(l.equationsHold).toBe(true);
  });
});

describe("P0.8B Gate E — observation state mapping", () => {
  it("E16: only RUNNING and DEGRADED may claim OBSERVED", () => {
    expect(observationStateForManager("RUNNING")).toBe("OBSERVED");
    expect(observationStateForManager("DEGRADED")).toBe("OBSERVED");
    expect(observationStateForManager("DISABLED")).toBe("DISABLED");
    for (const s of ["WAITING_FOR_GATES", "STARTING", "STOPPING", "STOPPED", "FAILED"] as const) {
      expect(observationStateForManager(s)).toBe("NOT_OBSERVED");
    }
  });
});
