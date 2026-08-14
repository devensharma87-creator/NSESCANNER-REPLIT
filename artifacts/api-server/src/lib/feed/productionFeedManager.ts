/**
 * PHASE 0.8B/0.8C — THE PROCESS-WIDE FEED MANAGER INSTANCE
 *
 * One manager per process, constructed lazily, wired to real activation
 * evidence. This is what the shutdown hook and the owner diagnostic surface
 * talk to.
 *
 * WHY LAZY, AND WHY THAT IS NOT A STYLE CHOICE
 * --------------------------------------------
 * A module-scope `createFeedManager(...)` would run at import time in every
 * process and every test file that transitively imports this module. Even
 * though construction opens no socket, it would call the option providers'
 * closures into existence and make "did the feed foundation initialise?"
 * depend on import order rather than on an explicit decision. Building on
 * first use keeps the answer to "was a manager ever created?" honest.
 *
 * PHASE 0.8C — WHAT CHANGED
 * -------------------------
 * Phase 0.8B carried two hardcoded `NOT_EVALUATED` placeholders
 * (`SHUTDOWN_LIFECYCLE_INSTALLED`, `TOKEN_RECONCILIATION_CLEAR`). Both are now
 * wired to real process state. Every gate additionally carries a typed
 * evidence envelope — evaluation instant, validity boundary, source kind and
 * source identity — so the boundary can re-judge it at the moment of the side
 * effect instead of trusting a verdict computed earlier.
 *
 * The outcome is unchanged: the feed still refuses. The refusal is now
 * PRECISE, which is the entire point. A gate that says NOT_EVALUATED because
 * nobody looked is a very different operational fact from one that says FAIL
 * because it was looked at and found wanting.
 *
 * WHAT THIS INSTANCE CAN DO TODAY: nothing but refuse and close.
 * `FEED_RUNTIME_ACTIVATION_AUTHORIZED` is false, so `start()` returns DISABLED
 * without reading the registry, without constructing a client, and without
 * loading the provider SDK. The close hook is nonetheless real and wired —
 * so the day activation is authorised, shutdown already works.
 */

import {
  createFeedManager,
  FEED_RUNTIME_ACTIVATION_AUTHORIZED,
  type FeedManager,
  type FeedActivationGate,
  type FeedActivationGateId,
  type StructuredActivationDecision,
} from "./feedManager";
import { REFUSING_FEED_CLIENT_FACTORY } from "./feedClientPort";
import { getSubscriptionAdmissionManifestNow } from "../registry/subscriptionManifest";
import { planFeedShards, SHARD_POLICY_VERSION } from "../registry/feedShardPlan";
import { evaluateActivationGates } from "../registry/feedActivationGates";
import {
  getActiveGenerationAuthority,
  getSettledActiveGeneration,
  isRegistryRestorationSettled,
} from "../registry/manifestStore";
import {
  evaluateFeedOwnershipAdmission,
  readDeclaredDeploymentTargetFromDisk,
  readTopologySignals,
} from "../registry/feedOwnershipAdmission";
import {
  type FeedCloseHook,
  getInstalledShutdownPhase,
  getShutdownInstallationState,
  isShutdownInstalled,
} from "../lifecycle/gracefulShutdown";
import { pendingReconciliationCount } from "../providerTokenReconciliation";
import {
  collectAttestationCandidates,
  verifyRuntimeSingletonAttestation,
  type SingletonAttestationVerdict,
} from "./runtimeSingletonAttestation";
import {
  evaluateKiteSessionEvidence,
  getAcceptedKiteSessionValidationRecord,
  type KiteSessionEvidenceVerdict,
} from "./kiteSessionEvidence";
import type { EvidenceSourceKind, EvidenceState } from "./activationEvidence";

let instance: FeedManager | null = null;

type OldGateState = "PASS" | "BLOCKED" | "NOT_EVALUATED";

function mapOldGateState(state: OldGateState | undefined): EvidenceState {
  if (state === "PASS") return "PASS";
  if (state === "BLOCKED") return "FAIL";
  return "NOT_EVALUATED";
}

/** Build one fully-populated gate envelope. */
function gate(input: {
  readonly gateId: FeedActivationGateId;
  readonly state: EvidenceState;
  readonly reasonCode: string;
  readonly evaluatedAt: number;
  readonly validUntil: number | null;
  readonly sourceKind: EvidenceSourceKind;
  readonly sourceIdentity?: string | null;
  readonly details?: readonly string[];
  readonly passReasonCode?: string;
}): FeedActivationGate {
  // Callers supply `reasonCode` as the FAILURE reason, because that is the
  // interesting case and it keeps each call site to one string. On PASS that
  // string is a lie: it would render a satisfied gate as, say,
  // "SHARD_POLICY_VERSION_UNSUPPORTED" on the owner readiness endpoint —
  // stating the opposite of the verdict beside it. So the reason is derived
  // from the state here rather than echoed blindly.
  const reasonCode =
    input.state === "PASS"
      ? (input.passReasonCode ?? `${input.gateId}_SATISFIED`)
      : input.reasonCode;
  return Object.freeze({
    gateId: input.gateId,
    state: input.state,
    // `blockerCode` stays populated for a non-PASS gate so the Phase 0.8B
    // boundary message format is unchanged.
    blockerCode: input.state === "PASS" ? undefined : input.reasonCode,
    reasonCode,
    evaluatedAt: input.evaluatedAt,
    validUntil: input.validUntil,
    sourceKind: input.sourceKind,
    sourceIdentity: input.sourceIdentity ?? null,
    detailsSafeForOwnerDiagnostics: Object.freeze([...(input.details ?? [])]),
  });
}

// ── Section C: shutdown lifecycle evidence ─────────────────────────────────

export interface ShutdownReadinessEvidence {
  readonly state: EvidenceState;
  readonly reasonCode: string;
  readonly installationState: string;
  readonly phase: string | null;
  readonly details: readonly string[];
}

/**
 * Read the REAL, LIVE shutdown lifecycle state of this process.
 *
 * This is not a boolean captured when the app object was constructed. A
 * process that installed its handlers and has since begun shutting down is
 * strictly worse than one that never installed them: it is actively tearing
 * down the very machinery that would release sockets. So PASS requires both
 * "installed" AND "still running".
 *
 * There is no circular import to avoid here — `gracefulShutdown` imports only
 * `node:crypto`. Phase 0.8B's placeholder cited a cycle that does not exist.
 */
export function evaluateShutdownReadiness(): ShutdownReadinessEvidence {
  const installationState = getShutdownInstallationState();
  const installed = isShutdownInstalled();
  const phase = installed ? getInstalledShutdownPhase() : null;

  if (!installed) {
    return {
      state: "FAIL",
      reasonCode: "SHUTDOWN_LIFECYCLE_NOT_INSTALLED",
      installationState,
      phase,
      details: [
        `INSTALLATION_STATE=${installationState}`,
        "NO_SIGNAL_HANDLER_WOULD_RELEASE_SOCKETS_ON_TERMINATION",
      ],
    };
  }
  if (phase !== "RUNNING") {
    return {
      state: "FAIL",
      reasonCode: "SHUTDOWN_ALREADY_IN_PROGRESS",
      installationState,
      phase,
      details: [`SHUTDOWN_PHASE=${phase}`, "PROCESS_IS_TERMINATING_OR_TERMINATED"],
    };
  }
  return {
    state: "PASS",
    reasonCode: "SHUTDOWN_LIFECYCLE_INSTALLED_AND_RUNNING",
    installationState,
    phase,
    details: ["INSTALLATION_STATE=INSTALLED", "SHUTDOWN_PHASE=RUNNING"],
  };
}

// ── Section D: token reconciliation evidence ───────────────────────────────

export interface TokenReconciliationEvidence {
  readonly state: EvidenceState;
  readonly reasonCode: string;
  readonly pendingCount: number;
  readonly details: readonly string[];
}

/**
 * Read the REAL pending provider-token reconciliation state.
 *
 * A pending reconciliation means the registry believes an instrument's
 * provider token changed and the subscription has not yet been rebound.
 * Subscribing a shard plan built against the OLD token mapping would silently
 * stream the wrong instrument's ticks under the right instrument's identity —
 * the worst class of data fault, because nothing looks broken.
 *
 * PASS therefore requires exactly zero pending items AND that the shard plan
 * being activated was built from the same registry generation the count was
 * observed under. No scheduler and no auto-drain is added here: draining is an
 * activation-time act and this phase does not activate.
 */
export function evaluateTokenReconciliation(
  planGenerationId: string | null,
  settledGenerationId: string | null,
): TokenReconciliationEvidence {
  let pendingCount: number;
  try {
    pendingCount = pendingReconciliationCount();
  } catch {
    return {
      state: "FAIL",
      reasonCode: "TOKEN_RECONCILIATION_STATE_UNAVAILABLE",
      pendingCount: -1,
      details: ["RECONCILIATION_BOOKKEEPING_COULD_NOT_BE_READ"],
    };
  }
  return judgeTokenReconciliation(pendingCount, planGenerationId, settledGenerationId);
}

/**
 * The pure judgement, split from the reader above.
 *
 * Separated so the "one item pending" branch can be exercised directly.
 * Forcing a real pending entry requires a populated instrument registry and a
 * live subscription port, and a test that wires all that up would be proving
 * the registry works, not that this gate refuses.
 */
export function judgeTokenReconciliation(
  pendingCount: number,
  planGenerationId: string | null,
  settledGenerationId: string | null,
): TokenReconciliationEvidence {
  if (!Number.isSafeInteger(pendingCount) || pendingCount < 0) {
    return {
      state: "FAIL",
      reasonCode: "TOKEN_RECONCILIATION_STATE_MALFORMED",
      pendingCount: -1,
      details: ["RECONCILIATION_COUNT_WAS_NOT_A_NON_NEGATIVE_INTEGER"],
    };
  }
  if (pendingCount > 0) {
    return {
      state: "FAIL",
      reasonCode: "TOKEN_RECONCILIATION_PENDING",
      pendingCount,
      details: [`PENDING_COUNT=${pendingCount}`, "SUBSCRIPTION_TOKEN_MAPPING_IS_NOT_SETTLED"],
    };
  }
  // Zero pending is only meaningful for the generation it was observed under.
  if (planGenerationId === null || settledGenerationId === null) {
    return {
      state: "FAIL",
      reasonCode: "TOKEN_RECONCILIATION_GENERATION_UNKNOWN",
      pendingCount,
      details: ["CANNOT_BIND_ZERO_PENDING_TO_A_REGISTRY_GENERATION"],
    };
  }
  if (planGenerationId !== settledGenerationId) {
    return {
      state: "FAIL",
      reasonCode: "TOKEN_RECONCILIATION_FOREIGN_GENERATION",
      pendingCount,
      details: ["PLAN_GENERATION_DIFFERS_FROM_OBSERVED_RECONCILIATION_GENERATION"],
    };
  }
  return {
    state: "PASS",
    reasonCode: "TOKEN_RECONCILIATION_CLEAR",
    pendingCount: 0,
    details: ["PENDING_COUNT=0", "BOUND_TO_ACTIVE_REGISTRY_GENERATION"],
  };
}

// ── Section F: registry authority evidence ─────────────────────────────────

export interface RegistryAuthorityEvidence {
  readonly state: EvidenceState;
  readonly reasonCode: string;
  readonly authorityState: string | null;
  readonly validUntilMs: number | null;
  readonly details: readonly string[];
}

/**
 * Judge whether the active registry generation is CURRENTLY authoritative.
 *
 * Three distinct failures are deliberately NOT collapsed into one:
 *   - nothing restored yet (unsettled) — we do not know;
 *   - restored from last-known — we know, and it is not authoritative;
 *   - restored and current but expired — it WAS authoritative and no longer is.
 * Collapsing them would make an outage indistinguishable from an empty
 * registry, which is exactly the confusion the restoration contract forbids.
 *
 * `validUntilMs` is taken from the existing calendar/BSE authority evaluation.
 * No new freshness threshold is invented here.
 */
export function evaluateRegistryAuthorityEvidence(
  nowMs: number,
  planGenerationId: string | null,
  planCompleteManifestHash: string | null,
  manifestSubscriptionSetHash: string | null,
): RegistryAuthorityEvidence {
  if (!isRegistryRestorationSettled()) {
    return {
      state: "FAIL",
      reasonCode: "REGISTRY_RESTORATION_NOT_SETTLED",
      authorityState: null,
      validUntilMs: null,
      details: ["RESTORATION_HAS_NOT_COMPLETED", "ABSENCE_OF_DATA_IS_NOT_ABSENCE_OF_A_GENERATION"],
    };
  }

  const active = getActiveGenerationAuthority(nowMs);
  if (active.generation === null || active.authority === null) {
    return {
      state: "FAIL",
      reasonCode: "REGISTRY_AUTHORITY_NO_ACTIVE_GENERATION",
      authorityState: null,
      validUntilMs: null,
      details: ["NO_ACTIVE_GENERATION_IS_LOADED"],
    };
  }

  const authorityState = active.authority.state;
  const validUntilMs = active.authority.validUntilMs ?? null;

  // Generation identity must agree with the plan being activated. Authority
  // for generation A never authorises a plan built from generation B.
  const activeGenId = active.generation.manifest.registryGenerationId;
  if (planGenerationId === null || activeGenId !== planGenerationId) {
    return {
      state: "FAIL",
      reasonCode: "REGISTRY_AUTHORITY_GENERATION_MISMATCH",
      authorityState,
      validUntilMs,
      details: ["ACTIVE_GENERATION_DOES_NOT_MATCH_THE_SHARD_PLAN_GENERATION"],
    };
  }

  // Both hashes must be present, or the plan cannot be bound to the manifest
  // it claims to derive from.
  if (planCompleteManifestHash === null || manifestSubscriptionSetHash === null) {
    return {
      state: "FAIL",
      reasonCode: "REGISTRY_AUTHORITY_HASH_BINDING_ABSENT",
      authorityState,
      validUntilMs,
      details: ["SUBSCRIPTION_SET_HASH_OR_COMPLETE_MANIFEST_HASH_IS_NULL"],
    };
  }

  if (authorityState !== "CURRENT_AUTHORITATIVE" || !active.mayAuthorize) {
    return {
      state: "FAIL",
      // The single most operationally useful distinction: LAST_KNOWN is a
      // healthy-LOOKING registry that must never drive a subscription, whereas
      // STALE is one that genuinely was authoritative and has aged out.
      reasonCode:
        authorityState === "STALE"
          ? "REGISTRY_AUTHORITY_EXPIRED"
          : "REGISTRY_AUTHORITY_NOT_CURRENT",
      authorityState,
      validUntilMs,
      details: [`AUTHORITY_STATE=${authorityState}`, "RESTORED_LAST_KNOWN_IS_NEVER_AUTHORITATIVE"],
    };
  }

  // Expiry boundary re-checked at the actual instant, not at memo time.
  if (validUntilMs !== null && nowMs >= validUntilMs) {
    return {
      state: "FAIL",
      reasonCode: "REGISTRY_AUTHORITY_EXPIRED",
      authorityState,
      validUntilMs,
      details: ["AUTHORITY_VALIDITY_BOUNDARY_PASSED_AT_EVALUATION_TIME"],
    };
  }

  return {
    state: "PASS",
    reasonCode: "REGISTRY_AUTHORITY_CURRENT",
    authorityState,
    validUntilMs,
    details: ["AUTHORITY_STATE=CURRENT_AUTHORITATIVE", "GENERATION_AND_HASHES_BOUND_TO_PLAN"],
  };
}

// ── The full decision ──────────────────────────────────────────────────────

/**
 * Everything the owner readiness endpoint needs, computed once so the endpoint
 * cannot accidentally evaluate the same gate twice at two different instants.
 */
export interface ProductionActivationSnapshot {
  readonly decision: StructuredActivationDecision;
  readonly evaluatedAtMs: number;
  readonly shutdown: ShutdownReadinessEvidence;
  readonly reconciliation: TokenReconciliationEvidence;
  readonly singleton: SingletonAttestationVerdict;
  readonly authority: RegistryAuthorityEvidence;
  readonly kiteSession: KiteSessionEvidenceVerdict;
}

/**
 * Build the real structured activation decision from live evidence.
 *
 * Pure with respect to the provider: it reads the registry manifest, plans
 * shards, inspects this process's own lifecycle state and evaluates gates.
 * It contacts nothing, opens nothing and writes nothing.
 */
export function buildProductionActivationSnapshot(nowMs: number): ProductionActivationSnapshot {
  const manifest = getSubscriptionAdmissionManifestNow(nowMs);
  const plan = planFeedShards(manifest);
  const declaredTarget = readDeclaredDeploymentTargetFromDisk(process.cwd());
  const topology = readTopologySignals(process.env, declaredTarget);
  const ownership = evaluateFeedOwnershipAdmission(topology);
  const gateReport = evaluateActivationGates({ manifest, plan, ownership });

  const oldStateMap = new Map<string, OldGateState>(
    gateReport.gates.map((g) => [g.id, g.state] as [string, OldGateState]),
  );

  const settledGenerationId =
    getSettledActiveGeneration()?.manifest.registryGenerationId ?? null;

  // ── Section E: runtime singleton attestation ──
  const singleton = verifyRuntimeSingletonAttestation({
    attestationFields: collectAttestationCandidates(process.env),
    isDeployment: topology.isDeployment,
    declaredDeploymentTarget: declaredTarget,
    observedDeploymentId: null,
    corroboratingDeploymentId: null,
    observedReplicaCount: topology.declaredReplicaCount,
  });

  // ── Section C ──
  const shutdown = evaluateShutdownReadiness();

  // ── Section D ──
  const reconciliation = evaluateTokenReconciliation(
    plan.registryGenerationId,
    settledGenerationId,
  );

  // ── Section F ──
  const authority = evaluateRegistryAuthorityEvidence(
    nowMs,
    plan.registryGenerationId,
    plan.completeManifestHash,
    manifest.subscriptionSetHash,
  );

  // ── Section G ──
  const kiteSession = evaluateKiteSessionEvidence({
    validationRecord: getAcceptedKiteSessionValidationRecord(),
    // Presence only. The value is never read, logged or returned.
    credentialsConfigured:
      typeof process.env.KITE_API_KEY === "string" && process.env.KITE_API_KEY.length > 0,
    nowMs,
  });

  // SUBSCRIPTION_MANIFEST_ACCEPTED: all three subordinate gates must PASS.
  const subgates: (OldGateState | undefined)[] = [
    oldStateMap.get("CLASSIFICATION_REMAINDER_ZERO"),
    oldStateMap.get("LIVE_REQUIRED_EQUATION_BALANCES"),
    oldStateMap.get("PROVIDER_TOKEN_INVARIANTS_HOLD"),
  ];
  const anySubEvaluated = subgates.some((s) => s !== undefined);
  const allSubPass = anySubEvaluated && subgates.every((s) => s === "PASS");
  const subManifestState: EvidenceState = !anySubEvaluated
    ? "NOT_EVALUATED"
    : allSubPass
      ? "PASS"
      : "FAIL";

  const genId = plan.registryGenerationId;

  const gates: FeedActivationGate[] = [
    // 1. compile-time lock
    gate({
      gateId: "COMPILE_TIME_FEED_LOCK",
      state: FEED_RUNTIME_ACTIVATION_AUTHORIZED ? "PASS" : "FAIL",
      reasonCode: FEED_RUNTIME_ACTIVATION_AUTHORIZED
        ? "COMPILE_TIME_FEED_LOCK_OPEN"
        : "FEED_RUNTIME_ACTIVATION_NOT_AUTHORIZED",
      evaluatedAt: nowMs,
      // A constant in the shipped build cannot expire; changing it is a code change.
      validUntil: null,
      sourceKind: "COMPILE_TIME_CONSTANT",
      details: ["SOURCE=FEED_RUNTIME_ACTIVATION_AUTHORIZED"],
    }),
    // 2. owner authorization — independent of the lock above
    gate({
      gateId: "OWNER_ACTIVATION_AUTHORIZATION",
      state: mapOldGateState(oldStateMap.get("OWNER_ACTIVATION_AUTHORIZATION")),
      reasonCode: "OWNER_ACTIVATION_AUTHORIZATION_ABSENT",
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "OWNER_AUTHORIZATION",
      details: ["OWNER_AUTHORIZATION_AND_COMPILE_TIME_LOCK_ARE_INDEPENDENT"],
    }),
    // 3. registry / manifest / generation / hash consistency
    gate({
      gateId: "REGISTRY_GENERATION_ID_PRESENT",
      state: mapOldGateState(oldStateMap.get("REGISTRY_GENERATION_PRESENT")),
      reasonCode: "REGISTRY_GENERATION_ID_ABSENT",
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "REGISTRY_GENERATION",
      sourceIdentity: genId,
    }),
    gate({
      gateId: "SUBSCRIPTION_SET_HASH_PRESENT",
      state: manifest.subscriptionSetHash !== null ? "PASS" : "FAIL",
      reasonCode: "SUBSCRIPTION_SET_HASH_ABSENT",
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "SUBSCRIPTION_MANIFEST",
      sourceIdentity: genId,
    }),
    gate({
      gateId: "COMPLETE_MANIFEST_HASH_PRESENT",
      state: plan.completeManifestHash !== null ? "PASS" : "FAIL",
      reasonCode: "COMPLETE_MANIFEST_HASH_ABSENT",
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "SHARD_PLAN",
      sourceIdentity: genId,
    }),
    gate({
      gateId: "REGISTRY_SCHEMA_AND_POLICY_SUPPORTED",
      state: mapOldGateState(oldStateMap.get("SUBSCRIPTION_MANIFEST_INTEGRITY_VALID")),
      reasonCode: "REGISTRY_SCHEMA_OR_POLICY_UNSUPPORTED",
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "SUBSCRIPTION_MANIFEST",
      sourceIdentity: genId,
    }),
    gate({
      gateId: "SUBSCRIPTION_MANIFEST_ACCEPTED",
      state: subManifestState,
      reasonCode: "SUBSCRIPTION_MANIFEST_NOT_ACCEPTED",
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "SUBSCRIPTION_MANIFEST",
      sourceIdentity: genId,
      details: ["REQUIRES_REMAINDER_ZERO_AND_LIVE_EQUATION_AND_TOKEN_INVARIANTS"],
    }),
    gate({
      gateId: "SHARD_POLICY_VERSION_SUPPORTED",
      state: plan.shardPolicyVersion === SHARD_POLICY_VERSION ? "PASS" : "FAIL",
      reasonCode: "SHARD_POLICY_VERSION_UNSUPPORTED",
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "SHARD_PLAN",
      sourceIdentity: genId,
    }),
    // 4. current authority
    gate({
      gateId: "REGISTRY_RESTORATION_SETTLED",
      state: mapOldGateState(oldStateMap.get("REGISTRY_RESTORATION_SETTLED")),
      reasonCode: "REGISTRY_RESTORATION_NOT_SETTLED",
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "REGISTRY_GENERATION",
      sourceIdentity: genId,
    }),
    gate({
      gateId: "REGISTRY_AUTHORITY_CURRENT",
      state: authority.state,
      reasonCode: authority.reasonCode,
      evaluatedAt: nowMs,
      // The owner-approved calendar/BSE authority boundary. Not a new threshold.
      validUntil: authority.validUntilMs,
      sourceKind: "REGISTRY_GENERATION",
      sourceIdentity: genId,
      details: authority.details,
    }),
    // 5. runtime singleton attestation
    gate({
      gateId: "FEED_OWNERSHIP_SINGLETON_ATTESTED",
      state: singleton.attested ? "PASS" : "FAIL",
      reasonCode: singleton.blockerCode ?? "RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED",
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "PLATFORM_ATTESTATION",
      details: singleton.detailsSafeForOwnerDiagnostics,
    }),
    // 6. shutdown readiness — LIVE process state
    gate({
      gateId: "SHUTDOWN_LIFECYCLE_INSTALLED",
      state: shutdown.state,
      reasonCode: shutdown.reasonCode,
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "PROCESS_RUNTIME_STATE",
      details: shutdown.details,
    }),
    // 7. token reconciliation clearance
    gate({
      gateId: "TOKEN_RECONCILIATION_CLEAR",
      state: reconciliation.state,
      reasonCode: reconciliation.reasonCode,
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "TOKEN_RECONCILIATION_STATE",
      sourceIdentity: genId,
      details: reconciliation.details,
    }),
    // 8. Kite session validity
    gate({
      gateId: "KITE_SESSION_VALID",
      state: kiteSession.valid ? "PASS" : kiteSession.state === "NOT_EVALUATED" ? "NOT_EVALUATED" : "FAIL",
      reasonCode: kiteSession.blockerCode ?? "KITE_SESSION_NOT_EVALUATED",
      evaluatedAt: nowMs,
      validUntil: kiteSession.validUntilMs,
      sourceKind: "PROVIDER_SESSION_VALIDATION",
      details: kiteSession.detailsSafeForOwnerDiagnostics,
    }),
    // 9. deterministic shard / capacity re-proof
    gate({
      gateId: "SHARD_PLAN_CAPACITY_ADMITTED",
      state: mapOldGateState(oldStateMap.get("SHARD_PLAN_WITHIN_PROVIDER_CAPACITY")),
      reasonCode: "SHARD_PLAN_EXCEEDS_PROVIDER_CAPACITY",
      evaluatedAt: nowMs,
      validUntil: null,
      sourceKind: "SHARD_PLAN",
      sourceIdentity: genId,
    }),
  ];

  return {
    decision: {
      plan,
      gates,
      registryGenerationId: manifest.registryGenerationId,
      subscriptionSetHash: manifest.subscriptionSetHash,
      completeManifestHash: plan.completeManifestHash,
    },
    evaluatedAtMs: nowMs,
    shutdown,
    reconciliation,
    singleton,
    authority,
    kiteSession,
  };
}

/** Backwards-compatible accessor used by Phase 0.8B call sites and tests. */
export function buildProductionActivationDecision(nowMs: number): StructuredActivationDecision {
  return buildProductionActivationSnapshot(nowMs).decision;
}

export function getProductionFeedManager(): FeedManager {
  if (instance === null) {
    instance = createFeedManager({
      // The refusing factory is correct for this phase: no code path may
      // construct a provider client while the feed is disabled, and a refusal
      // is louder than a dormant handle. Swapping in the real Kite factory is
      // the explicit, separately-authorised activation change.
      clientFactory: REFUSING_FEED_CLIENT_FACTORY,
      getActivation: () => buildProductionActivationDecision(Date.now()),
      // Deliberately the CHEAP accessor, not a manifest rebuild. This runs once
      // per delivered tick batch; building a full subscription manifest there
      // would re-hash the entire registry thousands of times a second and turn
      // an identity check into the feed's bottleneck.
      getCurrentGenerationId: () =>
        getSettledActiveGeneration()?.manifest.registryGenerationId ?? null,
      // PHASE 0.8C: the last thing checked before a socket could be created.
      // Everything above was evaluated microseconds earlier; this re-reads the
      // one fact that can change during that window without any registry
      // involvement — whether this process has begun shutting down.
      preClientConstructionRecheck: () => {
        const s = evaluateShutdownReadiness();
        return s.state === "PASS" ? null : s.reasonCode;
      },
    });
  }
  return instance;
}

/**
 * The real shutdown hook, replacing Phase 0.8T's `NO_OP_FEED_CLOSE_HOOK`.
 *
 * Today it reports `closed: false` with a state-qualified detail, because the
 * manager genuinely owns nothing. That is the same OUTCOME the no-op produced,
 * reached by actually asking the component that would know — which is the
 * whole difference. When sockets do exist and cannot be released, the manager
 * throws, and the shutdown coordinator turns that into a non-zero exit.
 */
export const productionFeedCloseHook: FeedCloseHook = async (signal: string) => {
  const result = await getProductionFeedManager().close(signal);
  return { closed: result.closed, detail: result.detail };
};

/** Test-only reset. Never called by production code. */
export function _forTesting_resetProductionFeedManager(): void {
  instance = null;
}
