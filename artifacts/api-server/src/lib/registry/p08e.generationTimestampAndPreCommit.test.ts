/**
 * PHASE 0.8E — GENERATION TIMESTAMP DERIVATION + THE PRE-COMMIT INTEGRITY GATE
 *
 * The first authorized live run persisted a generation that boot can never
 * load: its `generatedAt` was stamped at run start, so it pre-dated the very
 * source evidence it was built from, and the rule that catches that
 * inconsistency only ran AFTER the insert.
 *
 * Two separate defects, so two separate contracts here:
 *
 *   1. the generation is stamped as of its LAST INPUT, never its first moment;
 *   2. the cold-load authority boundary is re-applied BEFORE the write, so an
 *      inconsistent generation costs a refusal instead of a stored row.
 *
 * Every port is a counting fake: asserting "persistence was never called" is
 * the only way to prove a gate runs before the work it guards. A test that
 * checked the reason code alone would pass just as happily if the gate ran
 * after the write and threw its verdict away.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  __TEST_ONLY_createAuthorizedRegistryRefreshService,
  __resetRegistryRefreshDiagnosticsForTests,
  REGISTRY_REFRESH_REASON,
  type GenerationIntegrityVerdict,
  type RegistryRefreshPorts,
} from "./registryRefreshOrchestrator";
import type { RegistryGeneration } from "./manifestStore";

const GEN_ID = "REG-GEN-P08E-TEST";

const generation = {
  manifest: { registryGenerationId: GEN_ID },
  records: [],
} as unknown as RegistryGeneration;

interface Spy {
  buildNowMs: number[];
  integrityNowMs: number[];
  saveCalls: number;
  coldLoadCalls: number;
  promoteCalls: number;
  stages: string[];
}

/** Fixed instants: a run "start", later retrievals, and a clock that lags. */
const RUN_START = 1_800_000_000_000;
const LAST_RETRIEVAL = RUN_START + 6_000;

function makePorts(
  over: Partial<{
    /** Per-source retrieval offsets from RUN_START, in call order. */
    retrievalOffsets: number[];
    /** What every clock read after the first returns. */
    clockAfterStart: number;
    integrity: GenerationIntegrityVerdict;
    integrityThrows: boolean;
  }> = {},
): { ports: RegistryRefreshPorts; spy: Spy } {
  const spy: Spy = {
    buildNowMs: [],
    integrityNowMs: [],
    saveCalls: 0,
    coldLoadCalls: 0,
    promoteCalls: 0,
    stages: [],
  };

  let fetchIndex = 0;
  let clockReads = 0;

  const ports: RegistryRefreshPorts = {
    clock: {
      nowMs() {
        clockReads++;
        return clockReads === 1 ? RUN_START : (over.clockAfterStart ?? RUN_START + 10_000);
      },
    },
    sourceFetch: {
      async fetchSource({ sourceId, url }) {
        const offsets = over.retrievalOffsets ?? [];
        const offset = offsets[fetchIndex] ?? LAST_RETRIEVAL - RUN_START;
        fetchIndex++;
        return {
          sourceId,
          url,
          body: "row\n".repeat(5000),
          retrievedAtMs: RUN_START + offset,
          contentHash: `hash-${sourceId}`,
          cacheMode: "LIVE_RETRIEVAL",
        };
      },
    },
    sourceValidation: {
      validate(source) {
        return { sourceId: source.sourceId, accepted: true, rowCount: 5000, rejectionCode: null };
      },
    },
    calendar: {
      async buildAndResolveLatestCompletedSession() {
        return {
          ok: true,
          reasonCode: null,
          calendarGenerationId: "CAL-1",
          latestCompletedSessionDate: "2026-08-13",
          calendarValidUntilMs: null,
          subBlockers: [],
        };
      },
    },
    bseAuthority: {
      async evaluate() {
        return { authorized: true, reasonCode: null, authorityExpiresAtMs: null };
      },
    },
    generationBuilder: {
      async buildAndReconcile({ nowMs }) {
        spy.buildNowMs.push(nowMs);
        return {
          ok: true,
          reasonCode: null,
          generation,
          unexplainedRemainderByExchange: { NSE: 0, BSE: 0 },
        };
      },
    },
    generationIntegrity: {
      evaluate({ nowMs }) {
        spy.integrityNowMs.push(nowMs);
        if (over.integrityThrows) throw new Error("evaluator exploded");
        return over.integrity ?? { ok: true, faultCodes: [], reasons: [] };
      },
    },
    persistence: {
      async save() {
        spy.saveCalls++;
        return {
          ok: true,
          durablyCommitted: true,
          durableStore: "POSTGRESQL",
          snapshotId: "42",
          committedAt: "2026-08-14T00:00:00.000Z",
        };
      },
    },
    coldLoadVerifier: {
      async loadAndVerify() {
        spy.coldLoadCalls++;
        return { ok: true, reasonCode: null, loadedGenerationId: GEN_ID };
      },
    },
    authorityPromotion: {
      async promote() {
        spy.promoteCalls++;
        return { promoted: true, reasonCode: null };
      },
    },
    audit: {
      record(e) {
        spy.stages.push(`${e.stage}:${e.outcome}`);
      },
    },
  };

  return { ports, spy };
}

const run = (ports: RegistryRefreshPorts) =>
  __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

beforeEach(() => {
  __resetRegistryRefreshDiagnosticsForTests();
});

// ── T1: the generation is stamped as of its last input ───────────────────────

describe("T1 — generation timestamp derivation", () => {
  it("never stamps the generation with the run-start instant", async () => {
    const { ports, spy } = makePorts();
    await run(ports);

    expect(spy.buildNowMs).toHaveLength(1);
    // The exact defect that poisoned the store: stamping with the opening read.
    expect(spy.buildNowMs[0]).not.toBe(RUN_START);
    expect(spy.buildNowMs[0]).toBeGreaterThan(RUN_START);
  });

  it("is at least the LATEST source retrieval instant, whichever source that was", async () => {
    // Deliberately out of order: the newest evidence is not the last fetch.
    const { ports, spy } = makePorts({ retrievalOffsets: [1_000, 9_000, 3_000, 2_000, 500, 100] });
    await run(ports);

    expect(spy.buildNowMs[0]).toBeGreaterThanOrEqual(RUN_START + 9_000);
  });

  it("a clock that steps BACKWARDS mid-run cannot re-create the inversion", async () => {
    // Clock returns an instant before the retrievals it is supposed to follow.
    const { ports, spy } = makePorts({
      clockAfterStart: RUN_START - 60_000,
      retrievalOffsets: [4_000, 4_000, 4_000, 4_000, 4_000, 4_000],
    });
    await run(ports);

    // Falls back to the evidence, not the clock: the stamp still covers it.
    expect(spy.buildNowMs[0]).toBe(RUN_START + 4_000);
  });
});

// ── T2: the pre-commit gate runs BEFORE the write ────────────────────────────

describe("T2 — pre-commit integrity gate", () => {
  it("refuses without persisting when the cold-load boundary would reject", async () => {
    const { ports, spy } = makePorts({
      integrity: {
        ok: false,
        faultCodes: ["BSE_REFERENCE_EVIDENCE_INVALID"],
        reasons: ["committed BSE List-of-Scrips retrieval is later than the generation"],
      },
    });
    const result = await run(ports);

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("REFUSED");
    expect(result.stage).toBe("PRE_COMMIT_INTEGRITY");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.PRE_COMMIT_INTEGRITY_INVALID);

    // The whole point: nothing was written, so nothing must be undone.
    expect(spy.saveCalls).toBe(0);
    expect(spy.coldLoadCalls).toBe(0);
    expect(spy.promoteCalls).toBe(0);
    expect(result.durablyCommitted).toBe(false);
    expect(result.promotedToActiveAuthority).toBe(false);
  });

  it("carries the fault code and a bounded reason into owner diagnostics", async () => {
    const { ports } = makePorts({
      integrity: {
        ok: false,
        faultCodes: ["CALENDAR_COMMITMENT_UNVERIFIABLE", "AUTHORITY_STATE_STALE"],
        reasons: ["x".repeat(400), "second reason", "third", "fourth (must be dropped)"],
      },
    });
    const result = await run(ports);

    const details = result.detailsSafeForOwnerDiagnostics;
    expect(details).toContain("INTEGRITY=CALENDAR_COMMITMENT_UNVERIFIABLE");
    expect(details).toContain("INTEGRITY=AUTHORITY_STATE_STALE");
    // Bounded in BOTH directions: at most three reasons, each clipped.
    expect(details.filter((d) => !d.startsWith("INTEGRITY="))).toHaveLength(3);
    for (const d of details) expect(d.length).toBeLessThanOrEqual(120);
  });

  it("an evaluator that throws is a refusal, never a pass", async () => {
    const { ports, spy } = makePorts({ integrityThrows: true });

    // The orchestrator does not swallow port exceptions; the production
    // composition converts them to a fail-closed verdict. Either way the
    // generation must not reach the store.
    await expect(run(ports)).rejects.toThrow();
    expect(spy.saveCalls).toBe(0);
  });

  it("judges at the COMMIT clock reading, not the opening one", async () => {
    const { ports, spy } = makePorts({ clockAfterStart: RUN_START + 45_000 });
    await run(ports);

    expect(spy.integrityNowMs).toHaveLength(1);
    expect(spy.integrityNowMs[0]).toBe(RUN_START + 45_000);
  });

  it("a passing verdict lets the commit proceed exactly once", async () => {
    const { ports, spy } = makePorts();
    const result = await run(ports);

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("COMMITTED");
    expect(spy.saveCalls).toBe(1);
    expect(spy.coldLoadCalls).toBe(1);
    expect(spy.promoteCalls).toBe(1);
  });
});
