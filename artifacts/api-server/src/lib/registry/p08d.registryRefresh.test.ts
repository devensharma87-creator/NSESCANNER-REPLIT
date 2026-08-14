/**
 * PHASE 0.8D — AUTHORITATIVE REGISTRY REFRESH ORCHESTRATOR
 *
 * The orchestrator contributes no domain logic, so these tests do not re-check
 * parsing, hashing or reconciliation arithmetic — those are Phase 0.6 contracts
 * with their own suites. What is tested here is ORDER and REFUSAL: that each
 * gate runs before the step it protects, that a refusal stops everything after
 * it, and that the two success shapes (real commit, duplicate no-op) differ in
 * exactly the ways that matter.
 *
 * Every port is a counting fake. A test that asserts "the builder was never
 * called" is the only way to prove a gate runs BEFORE the work it guards;
 * asserting on the returned reason code alone would pass just as happily if the
 * gate ran last and threw the result away.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createRegistryRefreshService,
  __TEST_ONLY_createAuthorizedRegistryRefreshService,
  __resetRegistryRefreshDiagnosticsForTests,
  getRegistryRefreshOperationDiagnostics,
  REQUIRED_REFRESH_SOURCE_IDS,
  REGISTRY_REFRESH_REASON,
  type RegistryRefreshPorts,
  type FetchedOfficialSource,
} from "./registryRefreshOrchestrator";
import { AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED } from "./registryRefreshControl";
import { SOURCE_URLS } from "./officialSources";
import type { RegistryGeneration } from "./manifestStore";

const GEN_ID = "REG-GEN-2026-08-14-TEST";

const generation = {
  manifest: { registryGenerationId: GEN_ID },
  records: [],
} as unknown as RegistryGeneration;

interface Spy {
  fetchCalls: string[];
  validateCalls: string[];
  calendarCalls: number;
  bseCalls: number;
  buildCalls: number;
  saveCalls: number;
  coldLoadCalls: number;
  promoteCalls: number;
  auditEvents: string[];
  clockReads: number;
}

function makePorts(
  over: Partial<{
    clockSequence: number[];
    fetch: (id: string) => Promise<FetchedOfficialSource>;
    validateAccepted: (id: string) => boolean;
    calendarOk: boolean;
    calendarValidUntilMs: number | null;
    bseAuthorized: boolean;
    bseExpiresAtMs: number | null;
    buildOk: boolean;
    remainder: Record<string, number>;
    save: () => Promise<any>;
    coldLoadOk: boolean;
    coldLoadId: string | null;
    promoted: boolean;
    onBuild?: () => Promise<void>;
  }> = {},
): { ports: RegistryRefreshPorts; spy: Spy } {
  const spy: Spy = {
    fetchCalls: [],
    validateCalls: [],
    calendarCalls: 0,
    bseCalls: 0,
    buildCalls: 0,
    saveCalls: 0,
    coldLoadCalls: 0,
    promoteCalls: 0,
    auditEvents: [],
    clockReads: 0,
  };

  const clockSequence = over.clockSequence ?? [];
  const BASE = 1_000_000;

  const ports: RegistryRefreshPorts = {
    clock: {
      nowMs() {
        const v = clockSequence[spy.clockReads] ?? clockSequence[clockSequence.length - 1] ?? BASE;
        spy.clockReads++;
        return v;
      },
    },
    sourceFetch: {
      async fetchSource({ sourceId, url }) {
        spy.fetchCalls.push(sourceId);
        if (over.fetch) return over.fetch(sourceId);
        return {
          sourceId,
          url,
          body: "row\n".repeat(5000),
          retrievedAtMs: BASE,
          contentHash: `hash-${sourceId}`,
          cacheMode: "LIVE_RETRIEVAL",
        };
      },
    },
    sourceValidation: {
      validate(source) {
        spy.validateCalls.push(source.sourceId);
        const accepted = over.validateAccepted ? over.validateAccepted(source.sourceId) : true;
        return {
          sourceId: source.sourceId,
          accepted,
          rowCount: accepted ? 5000 : 0,
          rejectionCode: accepted ? null : "BOT_BLOCKED",
        };
      },
    },
    calendar: {
      async buildAndResolveLatestCompletedSession() {
        spy.calendarCalls++;
        const ok = over.calendarOk ?? true;
        return {
          ok,
          reasonCode: ok ? null : "NO_ACCEPTED_ANNUAL_CALENDAR",
          calendarGenerationId: ok ? "CAL-1" : null,
          latestCompletedSessionDate: ok ? "2026-08-13" : null,
          calendarValidUntilMs:
            over.calendarValidUntilMs === undefined ? null : over.calendarValidUntilMs,
        };
      },
    },
    bseAuthority: {
      async evaluate() {
        spy.bseCalls++;
        const authorized = over.bseAuthorized ?? true;
        return {
          authorized,
          reasonCode: authorized ? null : "NO_CURRENT_DAY_LIST_OF_SCRIPS",
          authorityExpiresAtMs: over.bseExpiresAtMs === undefined ? null : over.bseExpiresAtMs,
        };
      },
    },
    generationBuilder: {
      async buildAndReconcile() {
        spy.buildCalls++;
        if (over.onBuild) await over.onBuild();
        const ok = over.buildOk ?? true;
        return {
          ok,
          reasonCode: ok ? null : "DUPLICATE_PROVIDER_TOKEN",
          generation: ok ? generation : null,
          unexplainedRemainderByExchange: over.remainder ?? { NSE: 0, BSE: 0 },
        };
      },
    },
    persistence: {
      async save() {
        spy.saveCalls++;
        if (over.save) return over.save();
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
        const ok = over.coldLoadOk ?? true;
        return {
          ok,
          reasonCode: ok ? null : "RECORD_SET_HASH_MISMATCH",
          loadedGenerationId:
            over.coldLoadId === undefined ? (ok ? GEN_ID : null) : over.coldLoadId,
        };
      },
    },
    authorityPromotion: {
      async promote() {
        spy.promoteCalls++;
        const promoted = over.promoted ?? true;
        return { promoted, reasonCode: promoted ? null : "CALENDAR_NO_LONGER_COVERS_TODAY" };
      },
    },
    audit: {
      record(e) {
        spy.auditEvents.push(`${e.stage}:${e.outcome}:${e.reasonCode ?? "-"}`);
      },
    },
  };

  return { ports, spy };
}

beforeEach(() => {
  __resetRegistryRefreshDiagnosticsForTests();
});

// ── R1-R3: the disabled default ─────────────────────────────────────────────

describe("R1 — the production service is disabled and costs nothing", () => {
  it("refuses at AUTHORIZATION without calling a single port", async () => {
    const { ports, spy } = makePorts();
    const result = await createRegistryRefreshService(ports).runRefreshNow();

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("REFUSED");
    expect(result.stage).toBe("AUTHORIZATION");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.NOT_AUTHORIZED);

    // The refusal must precede the clock too. If the clock is read first the
    // gate is still correct, but "no port was called" stops being provable.
    expect(spy.clockReads).toBe(0);
    expect(spy.fetchCalls).toEqual([]);
    expect(spy.calendarCalls).toBe(0);
    expect(spy.buildCalls).toBe(0);
    expect(spy.saveCalls).toBe(0);
    expect(spy.promoteCalls).toBe(0);
  });

  it("reports the authorization constant as false", () => {
    expect(AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED).toBe(false);
    expect(getRegistryRefreshOperationDiagnostics().state).toBe("DISABLED");
  });
});

describe("R2 — a full authorized run commits and promotes", () => {
  it("returns COMMITTED with promotion and retention applied", async () => {
    const { ports, spy } = makePorts();
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("COMMITTED");
    expect(result.stage).toBe("COMPLETE");
    expect(result.registryGenerationId).toBe(GEN_ID);
    expect(result.durablyCommitted).toBe(true);
    expect(result.promotedToActiveAuthority).toBe(true);
    expect(result.detailsSafeForOwnerDiagnostics).toContain("RETENTION_APPLIED=true");
    expect(result.detailsSafeForOwnerDiagnostics).toContain("COLD_LOAD_VERIFIED=true");
    expect(spy.promoteCalls).toBe(1);
  });
});

describe("R3 — every required source is retrieved exactly once", () => {
  it("fetches all six sources, one call each, at their official URLs", async () => {
    const urls: string[] = [];
    const { ports, spy } = makePorts();
    const wrapped: RegistryRefreshPorts = {
      ...ports,
      sourceFetch: {
        async fetchSource(req) {
          urls.push(req.url);
          return ports.sourceFetch.fetchSource(req);
        },
      },
    };
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(wrapped).runRefreshNow();

    expect(result.sourcesFetched).toBe(REQUIRED_REFRESH_SOURCE_IDS.length);
    expect(spy.fetchCalls).toEqual([...REQUIRED_REFRESH_SOURCE_IDS]);
    expect(new Set(spy.fetchCalls).size).toBe(spy.fetchCalls.length);
    expect(urls).toEqual(REQUIRED_REFRESH_SOURCE_IDS.map((id) => SOURCE_URLS[id]));
  });
});

// ── R4-R5: retrieval integrity ──────────────────────────────────────────────

describe("R4 — a failed retrieval stops the run", () => {
  it("refuses at SOURCE_RETRIEVAL and never builds or persists", async () => {
    const { ports, spy } = makePorts({
      fetch: async (id) => {
        if (id === "NSE_ETF_LIST") throw new Error("ECONNRESET nsearchives.nseindia.com");
        return {
          sourceId: id as never,
          url: "u",
          body: "b",
          retrievedAtMs: 1,
          contentHash: "h",
          cacheMode: "LIVE_RETRIEVAL",
        };
      },
    });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.outcome).toBe("REFUSED");
    expect(result.stage).toBe("SOURCE_RETRIEVAL");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.FETCH_FAILED);
    expect(result.sourcesFetched).toBe(2);
    expect(spy.buildCalls).toBe(0);
    expect(spy.saveCalls).toBe(0);
  });

  it("does not leak the underlying error text into owner diagnostics", async () => {
    const { ports } = makePorts({
      fetch: async () => {
        throw new Error("ECONNRESET secret-host-detail");
      },
    });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();
    const joined = result.detailsSafeForOwnerDiagnostics.join("|");
    expect(joined).not.toContain("ECONNRESET");
    expect(joined).not.toContain("secret-host-detail");
    expect(joined).toContain("SOURCE=NSE_EQUITY_L");
  });
});

describe("R5 — a substituted source is refused", () => {
  it("refuses when the adapter returns a different sourceId than requested", async () => {
    const { ports, spy } = makePorts({
      fetch: async () => ({
        sourceId: "KITE_INSTRUMENT_MASTER" as never,
        url: "u",
        body: "b",
        retrievedAtMs: 1,
        contentHash: "h",
        cacheMode: "LIVE_RETRIEVAL",
      }),
    });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("SOURCE_RETRIEVAL");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.FETCH_IDENTITY_MISMATCH);
    expect(spy.buildCalls).toBe(0);
  });

  it("refuses a source with no content hash — provenance would be unverifiable", async () => {
    const { ports } = makePorts({
      fetch: async (id) => ({
        sourceId: id as never,
        url: "u",
        body: "b",
        retrievedAtMs: 1,
        contentHash: "",
        cacheMode: "LIVE_RETRIEVAL",
      }),
    });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.FETCH_IDENTITY_MISMATCH);
  });
});

// ── R6: validation precedes classification ──────────────────────────────────

describe("R6 — completeness is validated BEFORE anything is classified", () => {
  it("refuses a bot-blocked source and never invokes the builder", async () => {
    const { ports, spy } = makePorts({
      validateAccepted: (id) => id !== "BSE_LIST_OF_SCRIPS_ACTIVE",
    });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("SOURCE_VALIDATION");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.SOURCE_REJECTED);
    expect(result.detailsSafeForOwnerDiagnostics).toContain("REJECTION=BOT_BLOCKED");
    // This is the assertion that proves ORDER rather than mere refusal.
    expect(spy.buildCalls).toBe(0);
    expect(spy.calendarCalls).toBe(0);
  });
});

// ── R7-R8: calendar and BSE authority ───────────────────────────────────────

describe("R7 — an unresolved calendar stops the run before BSE authority", () => {
  it("refuses at CALENDAR_RESOLUTION", async () => {
    const { ports, spy } = makePorts({ calendarOk: false });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("CALENDAR_RESOLUTION");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.CALENDAR_UNRESOLVED);
    expect(spy.bseCalls).toBe(0);
    expect(spy.buildCalls).toBe(0);
  });
});

describe("R8 — BSE authority refusal stops the run before the build", () => {
  it("refuses at BSE_AUTHORITY", async () => {
    const { ports, spy } = makePorts({ bseAuthorized: false });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("BSE_AUTHORITY");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.BSE_AUTHORITY_REFUSED);
    expect(result.detailsSafeForOwnerDiagnostics).toContain(
      "BSE_AUTHORITY=NO_CURRENT_DAY_LIST_OF_SCRIPS",
    );
    expect(spy.buildCalls).toBe(0);
  });
});

// ── R9-R10: build and reconciliation ────────────────────────────────────────

describe("R9 — a failed build never reaches the store", () => {
  it("refuses at GENERATION_BUILD", async () => {
    const { ports, spy } = makePorts({ buildOk: false });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("GENERATION_BUILD");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.BUILD_FAILED);
    expect(spy.saveCalls).toBe(0);
  });
});

describe("R10 — a non-zero unexplained remainder blocks the commit", () => {
  it("refuses at RECONCILIATION and names the exchange", async () => {
    const { ports, spy } = makePorts({ remainder: { NSE: 0, BSE: 7 } });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("RECONCILIATION");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.UNEXPLAINED_REMAINDER);
    expect(result.detailsSafeForOwnerDiagnostics).toContain("REMAINDER_BSE=7");
    expect(spy.saveCalls).toBe(0);
  });

  it("treats a non-finite remainder as unexplained rather than as zero", async () => {
    const { ports, spy } = makePorts({ remainder: { NSE: Number.NaN } });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("RECONCILIATION");
    expect(spy.saveCalls).toBe(0);
  });
});

// ── R11: the commit-time expiry re-check ────────────────────────────────────

describe("R11 — authority expiry is re-asked at commit time on a fresh clock", () => {
  it("refuses when the run crosses the BSE IST-midnight boundary mid-flight", async () => {
    // Opening read is before the boundary; the commit-time read is after it.
    // A run that carried its opening timestamp forward would commit here.
    const BOUNDARY = 2_000_000;
    const { ports, spy } = makePorts({
      clockSequence: [BOUNDARY - 1_000, BOUNDARY + 1_000],
      bseExpiresAtMs: BOUNDARY,
    });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("AUTHORITY_EXPIRY");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.AUTHORITY_EXPIRED_AT_COMMIT);
    expect(result.detailsSafeForOwnerDiagnostics).toContain("EXPIRED=BSE_REFERENCE_AUTHORITY");
    expect(spy.saveCalls).toBe(0);
  });

  it("refuses when the calendar validity edge is crossed mid-flight", async () => {
    const BOUNDARY = 3_000_000;
    const { ports, spy } = makePorts({
      clockSequence: [BOUNDARY - 5_000, BOUNDARY + 5_000],
      calendarValidUntilMs: BOUNDARY,
    });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.detailsSafeForOwnerDiagnostics).toContain("EXPIRED=EXCHANGE_CALENDAR");
    expect(spy.saveCalls).toBe(0);
  });

  it("commits when the same boundaries are still in the future at commit time", async () => {
    const { ports, spy } = makePorts({
      clockSequence: [1_000, 2_000],
      bseExpiresAtMs: 9_000_000,
      calendarValidUntilMs: 9_000_000,
    });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.outcome).toBe("COMMITTED");
    expect(spy.saveCalls).toBe(1);
  });
});

// ── R12-R15: persistence, duplicate, cold load, promotion ───────────────────

describe("R12 — a durable write failure blocks verification and promotion", () => {
  it("refuses at PERSISTENCE", async () => {
    const { ports, spy } = makePorts({
      save: async () => ({
        ok: false,
        durablyCommitted: false,
        reasonCode: "DB_WRITE_FAILED",
        detail: "connection terminated",
      }),
    });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("PERSISTENCE");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.PERSISTENCE_FAILED);
    expect(spy.coldLoadCalls).toBe(0);
    expect(spy.promoteCalls).toBe(0);
  });
});

describe("R13 — a duplicate is a successful no-op that changes nothing", () => {
  it("returns DUPLICATE_NO_OP, promotes nothing and applies no retention", async () => {
    const { ports, spy } = makePorts({
      save: async () => ({
        ok: true,
        durablyCommitted: false,
        skippedReason: "DUPLICATE_GENERATION_ID",
      }),
    });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("DUPLICATE_NO_OP");
    expect(result.durablyCommitted).toBe(false);
    expect(result.promotedToActiveAuthority).toBe(false);
    expect(result.detailsSafeForOwnerDiagnostics).toContain("RETENTION_APPLIED=false");
    expect(result.detailsSafeForOwnerDiagnostics).toContain("SKIPPED=DUPLICATE_GENERATION_ID");
    // A duplicate has bought no room, so it must not prune, and it has changed
    // no bytes, so there is nothing new to verify or promote.
    expect(spy.coldLoadCalls).toBe(0);
    expect(spy.promoteCalls).toBe(0);
  });

  it("is idempotent — repeated runs keep returning the same no-op", async () => {
    const { ports, spy } = makePorts({
      save: async () => ({
        ok: true,
        durablyCommitted: false,
        skippedReason: "DUPLICATE_GENERATION_ID",
      }),
    });
    const svc = __TEST_ONLY_createAuthorizedRegistryRefreshService(ports);
    const first = await svc.runRefreshNow();
    const second = await svc.runRefreshNow();

    expect(first.outcome).toBe("DUPLICATE_NO_OP");
    expect(second.outcome).toBe("DUPLICATE_NO_OP");
    expect(spy.promoteCalls).toBe(0);
  });
});

describe("R14 — cold-load verification gates promotion, not the commit", () => {
  it("refuses to promote when the generation does not read back correctly", async () => {
    const { ports, spy } = makePorts({ coldLoadOk: false });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("COLD_LOAD_VERIFICATION");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.COLD_LOAD_FAILED);
    expect(result.promotedToActiveAuthority).toBe(false);
    // Reported honestly: the row IS committed. Hiding that would make the next
    // run's duplicate no-op look inexplicable.
    expect(result.detailsSafeForOwnerDiagnostics).toContain("COMMITTED=true");
    expect(spy.promoteCalls).toBe(0);
  });

  it("refuses when cold load returns a DIFFERENT generation than the one committed", async () => {
    const { ports, spy } = makePorts({ coldLoadOk: true, coldLoadId: "SOME-OTHER-GEN" });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("COLD_LOAD_VERIFICATION");
    expect(spy.promoteCalls).toBe(0);
  });
});

describe("R15 — a refused promotion is reported, not swallowed", () => {
  it("refuses at AUTHORITY_PROMOTION", async () => {
    const { ports } = makePorts({ promoted: false });
    const result = await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(result.stage).toBe("AUTHORITY_PROMOTION");
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.PROMOTION_FAILED);
    expect(result.promotedToActiveAuthority).toBe(false);
    expect(result.detailsSafeForOwnerDiagnostics).toContain("COMMITTED=true");
  });
});

// ── R16-R18: concurrency, diagnostics, audit ────────────────────────────────

describe("R16 — overlapping refreshes are coalesced, not run twice", () => {
  it("runs the pipeline once and gives both callers the same result", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { ports, spy } = makePorts({ onBuild: () => gate });

    const svc = __TEST_ONLY_createAuthorizedRegistryRefreshService(ports);
    const a = svc.runRefreshNow();
    const b = svc.runRefreshNow();
    release();
    const [ra, rb] = await Promise.all([a, b]);

    // One pipeline, six fetches, one commit — not two of each.
    expect(spy.buildCalls).toBe(1);
    expect(spy.fetchCalls.length).toBe(REQUIRED_REFRESH_SOURCE_IDS.length);
    expect(spy.saveCalls).toBe(1);
    expect(ra.outcome).toBe("COMMITTED");
    expect(rb.outcome).toBe("COMMITTED");
    expect(rb.coalescedWithInFlight).toBe(true);
  });

  it("releases the slot after a failure so the next run is not wedged", async () => {
    let fail = true;
    const { ports } = makePorts({
      fetch: async (id) => {
        if (fail) throw new Error("transient");
        return {
          sourceId: id as never,
          url: "u",
          body: "b",
          retrievedAtMs: 1,
          contentHash: "h",
          cacheMode: "LIVE_RETRIEVAL",
        };
      },
    });
    const svc = __TEST_ONLY_createAuthorizedRegistryRefreshService(ports);

    const first = await svc.runRefreshNow();
    expect(first.outcome).toBe("REFUSED");

    fail = false;
    const second = await svc.runRefreshNow();
    // A guard that leaked its slot on the error path would report the second
    // call as coalesced with a run that already finished.
    expect(second.coalescedWithInFlight).toBe(false);
    expect(second.outcome).toBe("COMMITTED");
  });
});

describe("R17 — diagnostics describe the operation without starting it", () => {
  it("reading diagnostics calls no port", async () => {
    const { ports, spy } = makePorts();
    void ports;
    const before = getRegistryRefreshOperationDiagnostics();
    expect(before.authorized).toBe(false);
    expect(before.requiredSourceCount).toBe(6);
    expect(spy.fetchCalls).toEqual([]);
    expect(spy.clockReads).toBe(0);
  });

  it("records the last outcome after a run", async () => {
    const { ports } = makePorts({ bseAuthorized: false });
    await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    const diag = getRegistryRefreshOperationDiagnostics();
    expect(diag.lastOutcome).toBe("REFUSED");
    expect(diag.lastStage).toBe("BSE_AUTHORITY");
    expect(diag.lastReasonCode).toBe(REGISTRY_REFRESH_REASON.BSE_AUTHORITY_REFUSED);
  });
});

describe("R18 — every terminal outcome is audited exactly once", () => {
  it("emits one audit event naming the stage and outcome", async () => {
    const { ports, spy } = makePorts({ buildOk: false });
    await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();

    expect(spy.auditEvents).toEqual([
      `GENERATION_BUILD:REFUSED:${REGISTRY_REFRESH_REASON.BUILD_FAILED}`,
    ]);
  });

  it("audits a successful commit", async () => {
    const { ports, spy } = makePorts();
    await __TEST_ONLY_createAuthorizedRegistryRefreshService(ports).runRefreshNow();
    expect(spy.auditEvents).toEqual([
      `COMPLETE:COMMITTED:${REGISTRY_REFRESH_REASON.COMMITTED}`,
    ]);
  });
});
