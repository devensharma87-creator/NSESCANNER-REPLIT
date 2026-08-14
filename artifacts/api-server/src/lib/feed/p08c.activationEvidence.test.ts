/**
 * PHASE 0.8C — ACTIVATION READINESS EVIDENCE
 *
 * These tests exist to prove one thing above all: making the refusal PRECISE
 * did not make it WEAKER. Every path here ends in the feed refusing to
 * activate, and the client factory is never invoked.
 *
 * The interesting cases are the ones where a gate says "PASS" and is still
 * refused — expired evidence, evidence about another registry generation,
 * evidence stamped in the future, and two producers disagreeing. A boolean
 * cannot express any of those, which is why the envelope exists.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createFeedManagerForTesting,
  REQUIRED_ACTIVATION_GATE_IDS,
  FEED_RUNTIME_ACTIVATION_AUTHORIZED,
  type FeedActivationGate,
  type FeedActivationGateId,
  type StructuredActivationDecision,
} from "./feedManager";
import {
  makeFakeClientHarness,
  makePlan,
  makeAllPassDecision,
  makeAllPassGates,
  TEST_GENERATION_ID,
} from "./testing/p08bFixtures";
import {
  evidence,
  judgeEvidence,
  indexEvidence,
  judgeAllRequiredEvidence,
  EVIDENCE_BLOCKER,
  ALLOWED_SOURCE_KIND_BY_GATE,
  GENERATION_SCOPED_SOURCE_KINDS,
} from "./activationEvidence";
import {
  verifyRuntimeSingletonAttestation,
  OBSERVED_PLATFORM_ATTESTATION_KEYS,
  SINGLETON_BLOCKER,
} from "./runtimeSingletonAttestation";
import {
  evaluateKiteSessionEvidence,
  getAcceptedKiteSessionValidationRecord,
  KITE_SESSION_BLOCKER,
  APPROVED_KITE_VALIDATION_PORT_ID,
  type KiteSessionValidationRecord,
  type KiteSessionRecordState,
} from "./kiteSessionEvidence";
import {
  evaluateShutdownReadiness,
  evaluateTokenReconciliation,
  judgeTokenReconciliation,
  buildProductionActivationSnapshot,
} from "./productionFeedManager";
import {
  installShutdownLifecycle,
  createShutdownController,
  _forTesting_resetShutdownLifecycle,
  type SignalTarget,
} from "../lifecycle/gracefulShutdown";
import {
  _forTesting_clearPendingReconciliations,
  pendingReconciliationCount,
} from "../providerTokenReconciliation";

import {
  FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED,
  SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED,
} from "../candleEvaluationControl";
import {
  FNO_PAPER_V2_RUNTIME_AUTHORIZED,
  SWING_PAPER_V2_RUNTIME_AUTHORIZED,
} from "../v2PaperLocks";

import { readFileSync } from "node:fs";
import { join } from "node:path";

const NOW = 1_800_000_000_000;

/** A structurally admissible Kite validation record, for judge-only tests. */
function kiteRecord(over: {
  validatedAtMs: number;
  validUntilMs: number;
  recordState?: KiteSessionRecordState;
}): KiteSessionValidationRecord {
  return {
    provider: "KITE",
    recordState: over.recordState ?? "VALID",
    validatedAtMs: over.validatedAtMs,
    validUntilMs: over.validUntilMs,
    validationPathId: "TEST_PATH",
    provenance: {
      producedByPortId: APPROVED_KITE_VALIDATION_PORT_ID,
      adapterId: "TEST_ADAPTER",
      acceptedAtMs: over.validatedAtMs,
    },
  };
}

function fakeSignalTarget(): SignalTarget {
  return { on() { return this; }, off() { return this; } };
}

/**
 * A full evidence-carrying gate, using the source kind the gate is actually
 * permitted to come from and binding generation-scoped gates to the test
 * generation. Anything looser would opt these tests out of the very checks
 * they exist to exercise.
 */
function g(
  gateId: FeedActivationGateId,
  overrides: Partial<FeedActivationGate> = {},
): FeedActivationGate {
  const sourceKind = ALLOWED_SOURCE_KIND_BY_GATE[gateId];
  return {
    gateId,
    state: "PASS",
    reasonCode: `${gateId}_OK`,
    evaluatedAt: NOW - 1000,
    validUntil: null,
    sourceKind,
    sourceIdentity: GENERATION_SCOPED_SOURCE_KINDS.has(sourceKind) ? TEST_GENERATION_ID : null,
    detailsSafeForOwnerDiagnostics: [],
    ...overrides,
  };
}

function decisionWith(gates: FeedActivationGate[]): StructuredActivationDecision {
  const plan = makePlan([2, 2]);
  return {
    plan,
    gates,
    registryGenerationId: plan.registryGenerationId,
    subscriptionSetHash: "sub-hash-test",
    completeManifestHash: plan.completeManifestHash,
  };
}

function allPassEvidenceGates(): FeedActivationGate[] {
  return REQUIRED_ACTIVATION_GATE_IDS.map((id) => g(id));
}

/** Build a manager whose factory records every construction attempt. */
function managerFor(decision: StructuredActivationDecision) {
  const h = makeFakeClientHarness();
  const m = createFeedManagerForTesting({
    clientFactory: h.factory,
    getActivation: () => decision,
    getCurrentGenerationId: () => TEST_GENERATION_ID,
    now: () => NOW,
  });
  return { h, m };
}

describe("PHASE 0.8C — activation readiness evidence", () => {
  beforeEach(() => {
    _forTesting_resetShutdownLifecycle();
    _forTesting_clearPendingReconciliations();
  });
  afterEach(() => {
    _forTesting_resetShutdownLifecycle();
    _forTesting_clearPendingReconciliations();
  });

  // ── K1 ───────────────────────────────────────────────────────────────────
  it("K1 every gate independently blocks activation when it alone fails", async () => {
    for (const failing of REQUIRED_ACTIVATION_GATE_IDS) {
      const gates = REQUIRED_ACTIVATION_GATE_IDS.map((id) =>
        g(id, id === failing ? { state: "FAIL", reasonCode: `${id}_FAILED` } : {}),
      );
      const { h, m } = managerFor(decisionWith(gates));
      const r = await m.start();
      expect(r.started, `gate ${failing} should have blocked activation`).toBe(false);
      expect(h.callsOfKind("CONSTRUCT").length, `gate ${failing} leaked a client`).toBe(0);
    }
  });

  // ── K2 ───────────────────────────────────────────────────────────────────
  it("K2 missing evidence for any single gate refuses (absence is never a pass)", async () => {
    for (const missing of REQUIRED_ACTIVATION_GATE_IDS) {
      const gates = REQUIRED_ACTIVATION_GATE_IDS.filter((id) => id !== missing).map((id) => g(id));
      const { h, m } = managerFor(decisionWith(gates));
      const r = await m.start();
      expect(r.started, `omitting ${missing} should refuse`).toBe(false);
      expect(h.callsOfKind("CONSTRUCT").length).toBe(0);
    }
  });

  // ── K3 ───────────────────────────────────────────────────────────────────
  it("K3 an EXPIRED gate that still says PASS is refused, and names expiry as the reason", async () => {
    const gates = allPassEvidenceGates().map((gate) =>
      gate.gateId === "REGISTRY_AUTHORITY_CURRENT"
        ? { ...gate, validUntil: NOW - 1 } // boundary already passed
        : gate,
    );
    const { h, m } = managerFor(decisionWith(gates));
    const r = await m.start();
    expect(r.started).toBe(false);
    expect(r.detail).toContain("ACTIVATION_EVIDENCE_EXPIRED");
    expect(h.callsOfKind("CONSTRUCT").length).toBe(0);

    // Exactly-at-the-boundary is expired, not valid: `nowMs >= validUntil`.
    const atBoundary = allPassEvidenceGates().map((gate) =>
      gate.gateId === "REGISTRY_AUTHORITY_CURRENT" ? { ...gate, validUntil: NOW } : gate,
    );
    const second = managerFor(decisionWith(atBoundary));
    expect((await second.m.start()).started).toBe(false);
  });

  // ── K4 ───────────────────────────────────────────────────────────────────
  it("K4 contradictory duplicate evidence for one gate refuses instead of picking a winner", async () => {
    const gates = [
      ...allPassEvidenceGates(),
      g("KITE_SESSION_VALID", { state: "FAIL", reasonCode: "KITE_SESSION_INVALID" }),
    ];
    const { h, m } = managerFor(decisionWith(gates));
    const r = await m.start();
    expect(r.started).toBe(false);
    expect(r.blocker).toBe("ACTIVATION_EVIDENCE_CONTRADICTORY");
    expect(h.callsOfKind("CONSTRUCT").length).toBe(0);

    // An agreeing duplicate must not EXTEND validity: the earlier expiry wins.
    const dupGates = [
      ...allPassEvidenceGates().map((x) =>
        x.gateId === "REGISTRY_AUTHORITY_CURRENT" ? { ...x, validUntil: NOW - 1 } : x,
      ),
      g("REGISTRY_AUTHORITY_CURRENT", { validUntil: NOW + 9_999_999 }),
    ];
    const dup = managerFor(decisionWith(dupGates));
    expect((await dup.m.start()).started).toBe(false);
  });

  // ── K5 ───────────────────────────────────────────────────────────────────
  it("K5 evidence stamped in the future is refused, not treated as extra-fresh", async () => {
    const gates = allPassEvidenceGates().map((gate) =>
      gate.gateId === "SHARD_PLAN_CAPACITY_ADMITTED"
        ? { ...gate, evaluatedAt: NOW + 60_000 }
        : gate,
    );
    const { h, m } = managerFor(decisionWith(gates));
    const r = await m.start();
    expect(r.started).toBe(false);
    expect(r.detail).toContain("ACTIVATION_EVIDENCE_EVALUATED_IN_FUTURE");
    expect(h.callsOfKind("CONSTRUCT").length).toBe(0);
  });

  // ── K6 ───────────────────────────────────────────────────────────────────
  it("K6 evidence from a foreign registry generation cannot authorise this plan", async () => {
    const gates = allPassEvidenceGates().map((gate) =>
      gate.gateId === "SUBSCRIPTION_MANIFEST_ACCEPTED"
        ? {
            ...gate,
            sourceKind: "SUBSCRIPTION_MANIFEST" as const,
            sourceIdentity: "gen-SOMETHING-ELSE",
          }
        : gate,
    );
    const { h, m } = managerFor(decisionWith(gates));
    const r = await m.start();
    expect(r.started).toBe(false);
    expect(r.detail).toContain("ACTIVATION_EVIDENCE_FOREIGN_GENERATION");
    expect(h.callsOfKind("CONSTRUCT").length).toBe(0);
  });

  // ── K7 — Section C ───────────────────────────────────────────────────────
  it("K7 shutdown gate: FAIL before install, PASS once installed, FAIL while shutting down", async () => {
    // Before install.
    expect(evaluateShutdownReadiness().state).toBe("FAIL");
    expect(evaluateShutdownReadiness().reasonCode).toBe("SHUTDOWN_LIFECYCLE_NOT_INSTALLED");

    // Installed and running.
    const controller = createShutdownController({ closeHttp: async () => {} });
    installShutdownLifecycle(controller, fakeSignalTarget(), () => {});
    const installed = evaluateShutdownReadiness();
    expect(installed.state).toBe("PASS");
    expect(installed.installationState).toBe("INSTALLED");
    expect(installed.phase).toBe("RUNNING");

    // A second install attempt must not create a duplicate-listener false PASS.
    const second = installShutdownLifecycle(
      createShutdownController({ closeHttp: async () => {} }),
      fakeSignalTarget(),
      () => {},
    );
    expect(second).toBe("ALREADY_INSTALLED");
    expect(evaluateShutdownReadiness().state).toBe("PASS");
  });

  // ── K8 — Section C, boundary recheck ─────────────────────────────────────
  it("K8 a shutdown that begins after the gates pass still stops client construction", async () => {
    const h = makeFakeClientHarness();
    let shuttingDown = false;
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => decisionWith(allPassEvidenceGates()),
      getCurrentGenerationId: () => TEST_GENERATION_ID,
      now: () => NOW,
      // Flips between gate evaluation and the factory call — the exact race
      // the recheck exists for.
      preClientConstructionRecheck: () =>
        shuttingDown ? "SHUTDOWN_ALREADY_IN_PROGRESS" : null,
    });
    shuttingDown = true;
    const r = await m.start();
    expect(r.started).toBe(false);
    expect(h.callsOfKind("CONSTRUCT").length).toBe(0);
  });

  // ── K9 — Section D ───────────────────────────────────────────────────────
  it("K9 reconciliation gate: PASS at zero, FAIL at one, FAIL on a foreign generation", () => {
    expect(pendingReconciliationCount()).toBe(0);
    const clear = evaluateTokenReconciliation("gen-A", "gen-A");
    expect(clear.state).toBe("PASS");
    expect(clear.pendingCount).toBe(0);

    // Zero pending, but the plan describes a different generation than the one
    // the count was observed under.
    const foreign = evaluateTokenReconciliation("gen-A", "gen-B");
    expect(foreign.state).toBe("FAIL");
    expect(foreign.reasonCode).toBe("TOKEN_RECONCILIATION_FOREIGN_GENERATION");

    // Unknown generation cannot be bound at all.
    expect(evaluateTokenReconciliation(null, "gen-A").state).toBe("FAIL");
    expect(evaluateTokenReconciliation("gen-A", null).reasonCode).toBe(
      "TOKEN_RECONCILIATION_GENERATION_UNKNOWN",
    );

    // One pending item must refuse. Exercised through the pure judge: forcing
    // a real pending entry needs a populated registry and a live subscription
    // port, which would test the registry rather than this gate.
    const pending = judgeTokenReconciliation(1, "gen-A", "gen-A");
    expect(pending.state).toBe("FAIL");
    expect(pending.reasonCode).toBe("TOKEN_RECONCILIATION_PENDING");
    expect(pending.pendingCount).toBe(1);

    // A malformed count fails closed rather than being coerced to zero.
    expect(judgeTokenReconciliation(-1, "gen-A", "gen-A").state).toBe("FAIL");
    expect(judgeTokenReconciliation(Number.NaN, "gen-A", "gen-A").reasonCode).toBe(
      "TOKEN_RECONCILIATION_STATE_MALFORMED",
    );

    // And the real reader agrees with the real counter.
    expect(evaluateTokenReconciliation("gen-A", "gen-A").pendingCount).toBe(
      pendingReconciliationCount(),
    );
  });

  // ── K10 — Section E ──────────────────────────────────────────────────────
  it("K10 declared Reserved-VM config without observed attestation does NOT attest", () => {
    // The allowlist must stay empty until a real deployment is observed.
    expect(OBSERVED_PLATFORM_ATTESTATION_KEYS.length).toBe(0);

    const v = verifyRuntimeSingletonAttestation({
      attestationFields: {},
      isDeployment: true,
      declaredDeploymentTarget: "vm",
      observedDeploymentId: "dep-1",
      corroboratingDeploymentId: "dep-1",
      observedReplicaCount: 1,
    });
    expect(v.attested).toBe(false);
    expect(v.state).toBe("EVIDENCE_NOT_YET_OBSERVED");
    expect(v.blockerCode).toBe(SINGLETON_BLOCKER.NOT_YET_OBSERVED);
    // Config is recorded as context, explicitly marked unproven.
    expect(v.declaredDeploymentTarget).toBe("vm");
    expect(v.declaredSingletonButUnproven).toBe(true);

    // Development is never a singleton, whatever the config says.
    expect(
      verifyRuntimeSingletonAttestation({
        attestationFields: {},
        isDeployment: false,
        declaredDeploymentTarget: "vm",
        observedDeploymentId: null,
        corroboratingDeploymentId: null,
        observedReplicaCount: null,
      }).blockerCode,
    ).toBe(SINGLETON_BLOCKER.NOT_A_DEPLOYMENT);
  });

  // ── K11 — Section E, spoofing ────────────────────────────────────────────
  it("K11 user-controlled env names and non-singleton topologies are rejected", () => {
    // A convincing-looking but unrecognised field grants nothing.
    const spoofed = verifyRuntimeSingletonAttestation({
      attestationFields: {
        FEED_OWNERSHIP_SINGLETON_ATTESTED: "true",
        REPLIT_SINGLETON: "1",
        IS_ONLY_INSTANCE: "yes",
      },
      isDeployment: true,
      declaredDeploymentTarget: "vm",
      observedDeploymentId: "dep-1",
      corroboratingDeploymentId: "dep-1",
      observedReplicaCount: 1,
    });
    expect(spoofed.attested).toBe(false);
    expect(spoofed.recognisedFields).toEqual([]);
    expect(spoofed.unrecognisedFields).toContain("FEED_OWNERSHIP_SINGLETON_ATTESTED");

    // Autoscale can never be rescued by any field.
    const autoscale = verifyRuntimeSingletonAttestation({
      attestationFields: {},
      isDeployment: true,
      declaredDeploymentTarget: "autoscale",
      observedDeploymentId: "dep-1",
      corroboratingDeploymentId: "dep-1",
      observedReplicaCount: 1,
    });
    expect(autoscale.state).toBe("REJECTED_TOPOLOGY");
    expect(autoscale.blockerCode).toBe(SINGLETON_BLOCKER.MULTI_REPLICA);

    // Unknown target, replica count > 1, and conflicting ids each refuse.
    expect(
      verifyRuntimeSingletonAttestation({
        attestationFields: {}, isDeployment: true, declaredDeploymentTarget: null,
        observedDeploymentId: null, corroboratingDeploymentId: null, observedReplicaCount: null,
      }).blockerCode,
    ).toBe(SINGLETON_BLOCKER.TOPOLOGY_UNKNOWN);
    expect(
      verifyRuntimeSingletonAttestation({
        attestationFields: {}, isDeployment: true, declaredDeploymentTarget: "vm",
        observedDeploymentId: null, corroboratingDeploymentId: null, observedReplicaCount: 3,
      }).blockerCode,
    ).toBe(SINGLETON_BLOCKER.REPLICA_COUNT_NOT_ONE);
    expect(
      verifyRuntimeSingletonAttestation({
        attestationFields: {}, isDeployment: true, declaredDeploymentTarget: "vm",
        observedDeploymentId: "dep-1", corroboratingDeploymentId: "dep-2", observedReplicaCount: 1,
      }).blockerCode,
    ).toBe(SINGLETON_BLOCKER.CONFLICTING_DEPLOYMENT_ID);
  });

  // ── K12 — Section G ──────────────────────────────────────────────────────
  it("K12 Kite credentials are not session validity, and an expired validation is not valid", () => {
    // No production validation record exists — the honest state for this phase.
    expect(getAcceptedKiteSessionValidationRecord()).toBeNull();

    const credsOnly = evaluateKiteSessionEvidence({
      validationRecord: null,
      credentialsConfigured: true,
      nowMs: NOW,
    });
    expect(credsOnly.state).toBe("NOT_EVALUATED");
    expect(credsOnly.valid).toBe(false);
    expect(credsOnly.blockerCode).toBe(KITE_SESSION_BLOCKER.CREDENTIALS_ARE_NOT_VALIDATION);

    // A confirmation whose validity boundary has passed is EXPIRED, not VALID.
    const expired = evaluateKiteSessionEvidence({
      validationRecord: kiteRecord({ validatedAtMs: NOW - 10_000, validUntilMs: NOW - 1 }),
      credentialsConfigured: true,
      nowMs: NOW,
    });
    expect(expired.state).toBe("EXPIRED");
    expect(expired.valid).toBe(false);

    // An explicit provider rejection is INVALID, distinct from NOT_EVALUATED.
    expect(
      evaluateKiteSessionEvidence({
        validationRecord: kiteRecord({
          validatedAtMs: NOW - 10_000,
          validUntilMs: NOW + 10_000,
          recordState: "INVALID",
        }),
        credentialsConfigured: true,
        nowMs: NOW,
      }).state,
    ).toBe("INVALID");

    // Only a live, confirmed, unexpired record is VALID.
    expect(
      evaluateKiteSessionEvidence({
        validationRecord: kiteRecord({ validatedAtMs: NOW - 10_000, validUntilMs: NOW + 10_000 }),
        credentialsConfigured: true,
        nowMs: NOW,
      }).valid,
    ).toBe(true);
  });

  // ── K13 — Section H ──────────────────────────────────────────────────────
  it("K13 owner authorization and the compile-time lock are independent; neither implies the other", async () => {
    // Owner authorized, lock closed → refuse.
    const lockClosed = allPassEvidenceGates().map((x) =>
      x.gateId === "COMPILE_TIME_FEED_LOCK"
        ? { ...x, state: "FAIL" as const, reasonCode: "FEED_RUNTIME_ACTIVATION_NOT_AUTHORIZED" }
        : x,
    );
    const a = managerFor(decisionWith(lockClosed));
    expect((await a.m.start()).started).toBe(false);
    expect(a.h.callsOfKind("CONSTRUCT").length).toBe(0);

    // Lock open, owner NOT authorized → still refuse.
    const ownerAbsent = allPassEvidenceGates().map((x) =>
      x.gateId === "OWNER_ACTIVATION_AUTHORIZATION"
        ? { ...x, state: "FAIL" as const, reasonCode: "OWNER_ACTIVATION_AUTHORIZATION_ABSENT" }
        : x,
    );
    const b = managerFor(decisionWith(ownerAbsent));
    expect((await b.m.start()).started).toBe(false);
    expect(b.h.callsOfKind("CONSTRUCT").length).toBe(0);
  });

  // ── K14 — the real development snapshot ──────────────────────────────────
  it("K14 the REAL production snapshot refuses, and the two 0.8B placeholders are gone", () => {
    const snap = buildProductionActivationSnapshot(Date.now());
    const byId = new Map(snap.decision.gates.map((x) => [x.gateId, x]));

    // All fifteen gates present, each with a complete envelope.
    expect(snap.decision.gates.length).toBe(REQUIRED_ACTIVATION_GATE_IDS.length);
    for (const id of REQUIRED_ACTIVATION_GATE_IDS) {
      const gate = byId.get(id);
      expect(gate, `gate ${id} missing from the production snapshot`).toBeDefined();
      expect(typeof gate!.evaluatedAt).toBe("number");
      expect(typeof gate!.reasonCode).toBe("string");
      expect(gate!.reasonCode!.length).toBeGreaterThan(0);
      expect(typeof gate!.sourceKind).toBe("string");
    }

    // The two Phase 0.8B placeholders are now real, decided evidence.
    expect(byId.get("SHUTDOWN_LIFECYCLE_INSTALLED")!.state).not.toBe("NOT_EVALUATED");
    expect(byId.get("TOKEN_RECONCILIATION_CLEAR")!.state).not.toBe("NOT_EVALUATED");
    expect(byId.get("SHUTDOWN_LIFECYCLE_INSTALLED")!.sourceKind).toBe("PROCESS_RUNTIME_STATE");

    // Singleton must NOT pass in development, and Kite must stay unevaluated.
    expect(snap.singleton.attested).toBe(false);
    expect(snap.kiteSession.state).toBe("NOT_EVALUATED");

    // At least one gate refuses, so the snapshot as a whole refuses.
    expect(snap.decision.gates.some((x) => x.state !== "PASS")).toBe(true);
  });

  // ── K15 ──────────────────────────────────────────────────────────────────
  it("K15 the client factory is never called for ANY real development evidence combination", async () => {
    const real = buildProductionActivationSnapshot(Date.now()).decision;
    const h = makeFakeClientHarness();
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => real,
      getCurrentGenerationId: () => real.registryGenerationId,
    });
    const r = await m.start();
    expect(r.started).toBe(false);
    expect(h.callsOfKind("CONSTRUCT").length).toBe(0);
    expect(h.constructed.length).toBe(0);
    expect(m.diagnostics().clientsHeld).toBe(0);
    expect(m.diagnostics().unreleasedSockets).toBe(0);

    // Repeated attempts must not accumulate anything either.
    await m.start();
    await m.start();
    expect(h.callsOfKind("CONSTRUCT").length).toBe(0);
  });

  // ── K16 ──────────────────────────────────────────────────────────────────
  it("K16 evidence envelope helpers judge expiry, generation and malformation correctly", () => {
    const ok = evidence({
      gateId: "REGISTRY_AUTHORITY_CURRENT",
      state: "PASS",
      reasonCode: "OK",
      evaluatedAt: NOW - 100,
      validUntil: NOW + 100,
      sourceKind: "REGISTRY_GENERATION",
      sourceIdentity: "gen-A",
    });
    expect(judgeEvidence(ok, NOW, "gen-A").admitted).toBe(true);
    expect(judgeEvidence(ok, NOW + 101, "gen-A")).toEqual({
      admitted: false,
      blockerCode: EVIDENCE_BLOCKER.EXPIRED,
    });
    expect(judgeEvidence(ok, NOW, "gen-B")).toEqual({
      admitted: false,
      blockerCode: EVIDENCE_BLOCKER.FOREIGN_GENERATION,
    });
    expect(judgeEvidence(undefined, NOW, "gen-A")).toEqual({
      admitted: false,
      blockerCode: EVIDENCE_BLOCKER.MISSING,
    });
    expect(
      judgeEvidence({ ...ok, evaluatedAt: Number.NaN }, NOW, "gen-A").admitted,
    ).toBe(false);

    // NOT_EVALUATED is never reinterpreted as PASS.
    expect(judgeEvidence({ ...ok, state: "NOT_EVALUATED" }, NOW, "gen-A").admitted).toBe(false);

    // Contradictory duplicates are refused by the indexer.
    const bad = indexEvidence([ok, { ...ok, state: "FAIL" }]);
    expect(bad.ok).toBe(false);
  });

  // ── K17 ──────────────────────────────────────────────────────────────────
  it("K17 all five runtime locks are false and no provider/socket/DB/scheduler was introduced", () => {
    expect(FEED_RUNTIME_ACTIVATION_AUTHORIZED).toBe(false);
    expect(FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED).toBe(false);
    expect(SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED).toBe(false);
    expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);

    // Static proof that the new Phase 0.8C modules import no provider SDK, open
    // no socket, touch no database and start no timer. Read as TEXT rather than
    // imported, so the assertion cannot be satisfied by a module that merely
    // fails to execute the offending line during this test.
    //
    // Comments are stripped first: these files DISCUSS sockets and provider
    // SDKs at length, and a scan that cannot tell prose from code would either
    // fail on the documentation or force the documentation to be deleted.
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const dir = join(process.cwd(), "src/lib/feed");
    const newModules = [
      "activationEvidence.ts",
      "runtimeSingletonAttestation.ts",
      "kiteSessionEvidence.ts",
    ];
    const forbidden = [
      "kiteconnect", "KiteTicker", "new WebSocket", "axios", "node-fetch",
      "setInterval(", "setTimeout(", "drizzle", "db.insert", "db.update", "db.delete",
      "fetch(", "require(",
    ];
    for (const file of newModules) {
      const code = stripComments(readFileSync(join(dir, file), "utf8"));
      for (const needle of forbidden) {
        expect(code.includes(needle), `${file} must not reference ${needle} in code`).toBe(false);
      }
      // No imports at all beyond the one intra-feed type import.
      const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((mm) => mm[1]);
      for (const spec of imports) {
        expect(
          spec.startsWith("."),
          `${file} must not import the external package ${spec}`,
        ).toBe(true);
      }
    }
  });

  // ── K18 — Section I ──────────────────────────────────────────────────────
  it("K18 the readiness endpoint is owner-only, returns 401 anonymously, and leaks no secrets", async () => {
    const express = (await import("express")).default;
    const { default: dataHealthRouter } = await import("../../routes/dataHealth");

    const app = express();
    app.use("/api", dataHealthRouter);
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;

    try {
      // Anonymous → 401. Not 200-with-empty-body, not 403.
      const anon = await fetch(`http://127.0.0.1:${port}/api/data-health/activation-readiness`);
      expect(anon.status).toBe(401);
      const anonBody = await anon.text();
      expect(anonBody).toContain("AUTH_REQUIRED");

      // The refusal itself must not leak anything about readiness.
      expect(anonBody).not.toContain("gateId");
      expect(anonBody).not.toContain("REGISTRY");
    } finally {
      await new Promise((r) => server.close(r));
    }

    // The payload the OWNER would receive, built from the same snapshot the
    // route uses, must contain no credential or environment value. Asserted on
    // the snapshot rather than over HTTP because minting a real owner session
    // requires the shared access secret, which a test must never handle.
    const snap = buildProductionActivationSnapshot(Date.now());
    const serialized = JSON.stringify(snap);
    const forbiddenValues = [
      process.env.KITE_API_KEY,
      process.env.KITE_API_SECRET,
      process.env.KITE_TOKEN_ENC_KEY,
      process.env.APP_ACCESS_PASSWORD,
      process.env.SESSION_SECRET,
      process.env.TELEGRAM_BOT_TOKEN,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);
    for (const secret of forbiddenValues) {
      expect(serialized.includes(secret), "readiness payload leaked a secret value").toBe(false);
    }
    // And no field is named like a credential.
    expect(/access_?token|api_?secret|password|"secret"/i.test(serialized)).toBe(false);
  });
});

/**
 * These four tests exist because an independent review found that the first
 * 0.8C implementation had reopened the boundary in three places while making
 * the refusal more precise. Each test pins one of those holes shut.
 */
describe("P0.8C K19-K22 — precision must not have reopened the boundary", () => {
  it("K19: a gate cannot escape generation binding by mislabelling its source kind", () => {
    // REGISTRY_AUTHORITY_CURRENT is generation-scoped. If a producer could
    // label it a COMPILE_TIME_CONSTANT with a null identity, the
    // cross-generation check would simply not apply and evidence about a
    // retired generation would authorise a socket for the current one.
    const spoofed: FeedActivationGate = {
      gateId: "REGISTRY_AUTHORITY_CURRENT",
      state: "PASS",
      reasonCode: "REGISTRY_AUTHORITY_CURRENT_OK",
      evaluatedAt: NOW - 1000,
      validUntil: null,
      sourceKind: "COMPILE_TIME_CONSTANT",
      sourceIdentity: null,
      detailsSafeForOwnerDiagnostics: [],
    };
    const v = judgeEvidence(spoofed, NOW, TEST_GENERATION_ID);
    expect(v.admitted).toBe(false);
    expect(v.admitted ? null : v.blockerCode).toBe(
      EVIDENCE_BLOCKER.SOURCE_KIND_NOT_PERMITTED,
    );
  });

  it("K19b: every gate has a pinned source kind and the generation-scoped count holds", () => {
    for (const id of REQUIRED_ACTIVATION_GATE_IDS) {
      expect(ALLOWED_SOURCE_KIND_BY_GATE[id], `${id} has no pinned source kind`).toBeTruthy();
    }
    const scoped = REQUIRED_ACTIVATION_GATE_IDS.filter((id) =>
      GENERATION_SCOPED_SOURCE_KINDS.has(ALLOWED_SOURCE_KIND_BY_GATE[id]),
    );
    // A drop here means some gate stopped being bound to the generation it
    // describes. That is a weakening, not a refactor, and must be deliberate.
    expect(scoped.length).toBe(10);
  });

  it("K20: the aggregate reports EVERY blocker, not just the first", () => {
    const base = REQUIRED_ACTIVATION_GATE_IDS.filter(
      (id) => id !== "KITE_SESSION_VALID" && id !== "SHARD_PLAN_CAPACITY_ADMITTED",
    ).map((id) => g(id));

    const withProblems: FeedActivationGate[] = [
      ...base,
      { ...g("KITE_SESSION_VALID"), state: "FAIL", reasonCode: "SESSION_MISSING" },
      { ...g("SHARD_PLAN_CAPACITY_ADMITTED"), validUntil: NOW - 1 }, // expired
      g("REGISTRY_AUTHORITY_CURRENT"), // duplicate of an entry already in base
    ];

    const agg = judgeAllRequiredEvidence(withProblems, NOW, TEST_GENERATION_ID);
    expect(agg.admitted).toBe(false);
    const codes = agg.admitted ? [] : agg.blockingCodes;

    // Three INDEPENDENT problems, all reported together. Surfacing one at a
    // time would make an operator conclude the boundary is flaky rather than
    // that it is refusing for several distinct reasons.
    expect(codes.some((c) => c.startsWith("KITE_SESSION_VALID:"))).toBe(true);
    expect(codes.some((c) => c.startsWith("SHARD_PLAN_CAPACITY_ADMITTED:"))).toBe(true);
    expect(codes.some((c) => c.includes(EVIDENCE_BLOCKER.DUPLICATE))).toBe(true);
    expect(codes.length).toBeGreaterThanOrEqual(3);
  });

  it("K21: a reconnect re-judges activation evidence and refuses once it lapses", async () => {
    const plan = makePlan([3, 3, 3]);
    let dec: StructuredActivationDecision = makeAllPassDecision(plan);
    const h = makeFakeClientHarness();
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });

    await m.start();
    expect(h.liveCount()).toBe(3);
    m.notifyShardDisconnected(1, "dropped");

    // The Kite session lapses AFTER start() admitted the plan. A reconnect that
    // trusted the original admission would open a socket on dead evidence.
    dec = {
      ...dec,
      gates: dec.gates.map((x) =>
        x.gateId === "KITE_SESSION_VALID"
          ? { ...x, state: "FAIL" as const, reasonCode: "SESSION_EXPIRED", blockerCode: "SESSION_EXPIRED" }
          : x,
      ),
    };

    const res = await m.reconnectShard(1);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("KITE_SESSION_VALID");
    expect(h.liveCount()).toBeLessThanOrEqual(3);
    await m.close("SIGTERM");
    expect(h.liveCount()).toBe(0);
  });

  it("K22: a reconnect refuses when the registry generation has rolled", async () => {
    const plan = makePlan([3, 3, 3]);
    let dec: StructuredActivationDecision = makeAllPassDecision(plan);
    const h = makeFakeClientHarness();
    const m = createFeedManagerForTesting({
      clientFactory: h.factory,
      getActivation: () => dec,
      getCurrentGenerationId: () => TEST_GENERATION_ID,
    });

    await m.start();
    m.notifyShardDisconnected(1, "dropped");

    // A fully valid decision for a DIFFERENT generation. The evidence itself is
    // admissible, so this isolates the plan-generation check specifically: the
    // shard's tokens describe a universe that has since been retired.
    dec = {
      ...dec,
      registryGenerationId: "gen-rolled",
      gates: makeAllPassGates("gen-rolled"),
    };

    const res = await m.reconnectShard(1);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("registry generation changed");
    await m.close("SIGTERM");
    expect(h.liveCount()).toBe(0);
  });
});
