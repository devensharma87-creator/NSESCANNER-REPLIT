/**
 * Data-health routes:
 *
 * GET /api/data-health/market   — PUBLIC, MarketDataHealth (session + feed + market)
 * GET /api/data-health/global   — PUBLIC, GlobalDataHealth (unified global contract)
 * GET /api/data-health/backbone — OWNER-ONLY, BackboneReport (per-module readiness)
 *
 * SAFETY (all routes):
 *   - No secrets, API keys, access tokens, chat IDs, or user PII.
 *   - No trading mutations.
 *   - Reads existing in-process state only (no new DB or network calls beyond
 *     what getKiteReadiness() / getActiveSession() already do in the chain).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type IRouter } from "express";
import { buildMarketDataHealth } from "../lib/marketDataHealth";
import { buildBackboneReport } from "../lib/backboneHealth";
import { buildGlobalDataHealth } from "../lib/globalDataHealth";
import { requireOwnerStrict } from "../lib/userAuth";
import {
  getActiveGenerationAuthority,
  getRegistryRestorationDiagnostics,
} from "../lib/registry/manifestStore";
import {
  getBootCapabilities,
  getSuppressedBootSideEffects,
  isDataFoundationBootProofMode,
} from "../lib/bootCapabilities";
import { getSubscriptionAdmissionManifestNow } from "../lib/registry/subscriptionManifest";
import { planFeedShards } from "../lib/registry/feedShardPlan";
import {
  evaluateFeedOwnershipAdmission,
  readDeclaredDeploymentTargetFromDisk,
  readTopologySignals,
} from "../lib/registry/feedOwnershipAdmission";
import { evaluateActivationGates } from "../lib/registry/feedActivationGates";
import {
  buildProductionActivationSnapshot,
  getProductionFeedManager,
} from "../lib/feed/productionFeedManager";
import { FEED_RUNTIME_ACTIVATION_AUTHORIZED } from "../lib/feed/feedManager";
import { judgeAllRequiredEvidence } from "../lib/feed/activationEvidence";
import {
  FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED,
  SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED,
} from "../lib/candleEvaluationControl";
import {
  FNO_PAPER_V2_RUNTIME_AUTHORIZED,
  SWING_PAPER_V2_RUNTIME_AUTHORIZED,
} from "../lib/v2PaperLocks";
import { admitShardPlan } from "../lib/feed/shardPlanInvariants";
import {
  buildFeedCoverageLedger,
  observationStateForManager,
} from "../lib/feed/feedCoverageLedger";
import {
  evaluatePhase08tOwnership,
  readProductionRunArgsFromDisk,
  readRuntimeTopologyEvidence,
} from "../lib/registry/runtimeTopologyEvidence";
import {
  describeShutdownReadiness,
  getBootId,
  getInstalledShutdownPhase,
  isShutdownInstalled,
} from "../lib/lifecycle/gracefulShutdown";
import {
  buildBootHandoverEvidence,
  evaluateFeedActivationState,
  FEED_ACTIVATION_DISABLED_AT_BOOT,
} from "../lib/lifecycle/feedActivationContract";

const router: IRouter = Router();

router.get("/data-health/market", async (req, res) => {
  try {
    const health = await buildMarketDataHealth();
    res.json(health);
  } catch (err) {
    req.log.error({ err }, "data-health/market failed");
    res.status(500).json({ error: "health check failed" });
  }
});

/**
 * GET /api/data-health/global — PUBLIC unified GlobalDataHealth contract.
 *
 * Single endpoint covering session, feed, market session, and per-module
 * readiness. Safe for public access — no secrets, no tokens, no API keys,
 * no user PII. Boolean `accessTokenPresent` instead of the raw token.
 *
 * Consumed by:
 *   - GlobalStatusBanner (DATA_DEGRADED chip)
 *   - Infra Health page — GlobalHealthSection
 */
router.get("/data-health/global", async (req, res) => {
  try {
    const health = await buildGlobalDataHealth();
    res.json(health);
  } catch (err) {
    req.log.error({ err }, "data-health/global failed");
    res.status(500).json({ error: "global health check failed" });
  }
});

/**
 * GET /api/data-health/backbone — OWNER-ONLY unified backbone health roll-up.
 *
 * Per-module data readiness ("given what F&O / swing / option-chain / … each
 * REQUIRE, is their data actually trade-grade right now?"), composed from
 * existing in-process state only (no new network). No secrets, no mutations.
 */
router.get("/data-health/backbone", requireOwnerStrict, async (req, res) => {
  try {
    const report = await buildBackboneReport();
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "data-health/backbone failed");
    res.status(500).json({ error: "backbone health check failed" });
  }
});

/**
 * GET /api/data-health/registry — OWNER-ONLY instrument-registry boot state.
 *
 * PHASE 0.7B. Reports what the boot-time restoration actually concluded:
 * whether it has settled, which durable layer answered, the generation identity
 * and record count that were verified, whether that generation may speak for
 * NOW (integrity and current authority are separate facts), and the machine
 * readable blocker code when it may not.
 *
 * Pure in-memory read — no DB query, no provider call, no mutation. Carries no
 * manifest payload, no record contents and no credentials.
 */
router.get("/data-health/registry", requireOwnerStrict, (req, res) => {
  try {
    const restoration = getRegistryRestorationDiagnostics();
    const { authority, mayAuthorize } = getActiveGenerationAuthority();
    res.json({
      restoration,
      // Boot-mode evidence: which capabilities this process booted with and
      // which start-up side effects it declined. Names only — no credentials,
      // no provider state, no payloads.
      bootMode: {
        dataFoundationBootProof: isDataFoundationBootProofMode(),
        capabilities: getBootCapabilities(),
        suppressedSideEffects: getSuppressedBootSideEffects(),
      },
      // Re-evaluated at read time; it expires at a calendar boundary, not on a
      // timer, so this is deliberately not the same fact as `restoration.state`.
      currentAuthority: {
        state: authority?.state ?? null,
        mayAuthorize,
        reasons: authority?.reasons ?? [],
        evaluatedAt: authority ? new Date(authority.evaluatedAtMs).toISOString() : null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "data-health/registry failed");
    res.status(500).json({ error: "registry health check failed" });
  }
});

/**
 * GET /api/data-health/subscription-admission — OWNER-ONLY, PHASE 0.8A.
 *
 * The admission layer that must exist before any live feed socket is opened:
 * which instruments the reconciled universe would admit, whether that universe
 * may speak for the present instant, how the admitted set would shard across
 * the provider's three sockets, whether a single feed owner can be established
 * at all under this deployment topology, and the full activation gate list.
 *
 * SAFETY. Metadata only. No API keys, no access tokens, no credentials, no
 * environment values, no raw provider responses, and NO instrument/token
 * payload — only counts, classifications, hashes and per-shard summaries. It
 * opens no socket, contacts no provider, writes nothing, and mutates no state.
 */
router.get("/data-health/subscription-admission", requireOwnerStrict, (req, res) => {
  try {
    const nowMs = Date.now();
    const manifest = getSubscriptionAdmissionManifestNow(nowMs);
    const plan = planFeedShards(manifest);
    const ownership = evaluateFeedOwnershipAdmission(
      readTopologySignals(process.env, readDeclaredDeploymentTargetFromDisk(process.cwd())),
    );
    const gates = evaluateActivationGates({ manifest, plan, ownership });

    res.json({
      phase: "PHASE_0_8A",
      evaluatedAt: manifest.evaluatedAt,
      manifest: {
        state: manifest.state,
        activationAuthorized: manifest.activationAuthorized,
        policyVersion: manifest.policyVersion,
        registryGenerationId: manifest.registryGenerationId,
        registryGeneratedAt: manifest.registryGeneratedAt,
        schemaVersion: manifest.schemaVersion,
        manifestPolicyVersion: manifest.manifestPolicyVersion,
        authorityState: manifest.authorityState,
        authorityReasons: manifest.authorityReasons,
        totalRecords: manifest.totalRecords,
        classificationCounts: manifest.classificationCounts,
        remainder: manifest.remainder,
        liveRequired: manifest.liveRequired,
        admittedCount: manifest.admitted.length,
        subscriptionSetHash: manifest.subscriptionSetHash,
        blockers: manifest.blockers,
        blockerCode: manifest.blockerCode,
      },
      shardPlan: {
        state: plan.state,
        blockerCode: plan.blockerCode,
        capacity: plan.capacity,
        maxSockets: plan.maxSockets,
        maxTokensPerSocket: plan.maxTokensPerSocket,
        totalTokens: plan.totalTokens,
        headroom: plan.headroom,
        completeManifestHash: plan.completeManifestHash,
        activationAuthorized: plan.activationAuthorized,
        shards: plan.shards.map((s) => ({
          shardId: s.shardId,
          priorityClass: s.priorityClass,
          count: s.count,
          shardHash: s.shardHash,
        })),
      },
      feedOwnership: {
        ownershipAdmitted: ownership.ownershipAdmitted,
        singleWriterStructurallyGuaranteed: ownership.singleWriterStructurallyGuaranteed,
        blockerCode: ownership.blockerCode,
        rationale: ownership.rationale,
        phase: ownership.phase,
        topology: ownership.topology,
        rejectedMechanisms: ownership.rejectedMechanisms,
      },
      activationGates: gates,
    });
  } catch (err) {
    req.log.error({ err }, "data-health/subscription-admission failed");
    res.status(500).json({ error: "subscription admission check failed" });
  }
});

/**
 * GET /api/data-health/topology — OWNER-ONLY, PHASE 0.8T.
 *
 * Deployment topology as the RUNNING process can observe it, and what that
 * means for a future single feed owner. It exists so the owner can tell, after
 * a Reserved VM publish, whether the runtime evidence the ownership contract
 * demands actually appeared — rather than inferring it from `.replit`.
 *
 * SAFETY. Metadata only: no API keys, no access tokens, no credentials, no
 * environment values, no billing or account identifiers. The provider-key
 * identity is a truncated one-way digest, never the key. Nothing is opened,
 * written, scheduled or activated by this route, and the public health surface
 * is untouched — anonymous callers get 401 from requireOwnerStrict.
 */
router.get("/data-health/topology", requireOwnerStrict, (req, res) => {
  try {
    // Walk up from THIS module's location: in production the process cwd is the
    // repository root, where the api-server artifact manifest is not visible.
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const declaredDeploymentTarget = readDeclaredDeploymentTargetFromDisk(moduleDir);
    const runCommandArgs = readProductionRunArgsFromDisk(moduleDir);
    const proofMode = isDataFoundationBootProofMode();

    const bootId = getBootId();
    const evidence = readRuntimeTopologyEvidence(process.env, {
      declaredDeploymentTarget,
      runCommandArgs,
      proofMode,
    });
    const assessment = evaluatePhase08tOwnership({ declaredDeploymentTarget, evidence });

    // Feed activation state — evaluated against the boot-time handover evidence
    // and the current shutdown phase. Safe metadata only: no API keys, no env
    // values, no credentials.
    const handover = buildBootHandoverEvidence(
      process.env,
      bootId,
      evidence.attestationSource === "VERIFIED_PLATFORM_ATTESTATION",
    );
    const shutdownPhase = getInstalledShutdownPhase();
    const activation = evaluateFeedActivationState(
      handover,
      assessment.topologyReady,
      shutdownPhase,
      proofMode,
      isShutdownInstalled(),
    );

    res.json({
      phase: "PHASE_0_8T",
      configuredDeploymentTarget: declaredDeploymentTarget,
      configuredRunCommand: runCommandArgs,
      runtime: {
        isDeployment: evidence.isDeployment,
        observedRuntimeTarget: evidence.observedRuntimeTarget,
        observedReplicaCount: evidence.observedReplicaCount,
        deploymentIdentityPresent: assessment.runtime.deploymentIdentityPresent,
        apiKeyOwnerId: evidence.apiKeyOwnerId,
        processId: process.pid,
        bootId,
        proofMode,
      },
      topology: {
        topologyState: assessment.runtime.topologyState,
        singletonEvidenceSource: assessment.runtime.evidenceSource,
        platformAttestation: assessment.runtime.attestationSource,
        entrypointChildProcessAudit: assessment.runtime.entrypointAudit,
        singletonGuaranteed: assessment.runtime.singletonGuaranteed,
        persistentProcessGuaranteed: assessment.runtime.persistentProcessGuaranteed,
        processTopology: assessment.runtime.processTopology,
        // The platform does not expose the deployment's CPU/RAM class to the
        // process, so this is reported as unavailable rather than guessed.
        resourceClass: null,
        evidence: assessment.runtime.evidence,
      },
      feedOwnership: {
        phase: assessment.phase,
        ownershipAdmitted: assessment.ownershipAdmitted,
        topologyReady: assessment.topologyReady,
        blockerCode: assessment.blockerCode,
        declaredTopology: assessment.declaredAdmission.topology.topology,
        declaredBlockerCode: assessment.declaredAdmission.blockerCode,
      },
      // Feed activation state machine — never exposes raw env values.
      feedActivation: {
        state: activation.state,
        blockerCode: activation.blockerCode,
        feedDisabledAtBoot: activation.feedDisabledAtBoot,
        feedDisabledConstant: FEED_ACTIVATION_DISABLED_AT_BOOT,
        handoverCleared: activation.handoverCleared,
        ownerAuthorizationPresent: activation.ownerAuthorizationPresent,
        currentDeploymentIdPresent: handover.currentDeploymentId !== null,
        previousDeploymentIdPresent: handover.previousDeploymentId !== null,
        previousDeploymentConfirmedInactive: handover.previousDeploymentConfirmedInactive,
        activationAuthorized: handover.activationAuthorized,
        notes: activation.notes,
      },
      // Deployment handover metadata — no credentials, no env values.
      handover: {
        currentBootId: handover.currentBootId,
        currentProcessId: handover.currentProcessId,
        currentStartedAt: handover.currentStartedAt,
        topologyAttested: handover.topologyAttested,
        feedDisabledAtBoot: handover.feedDisabledAtBoot,
        activationAuthorized: handover.activationAuthorized,
        currentDeploymentIdPresent: handover.currentDeploymentId !== null,
        previousDeploymentIdPresent: handover.previousDeploymentId !== null,
        previousDeploymentConfirmedInactive: handover.previousDeploymentConfirmedInactive,
        confirmationSource: handover.confirmationSource,
        confirmedAt: handover.confirmedAt,
      },
      shutdown: {
        ...describeShutdownReadiness(),
        currentPhase: shutdownPhase,
      },
    });
  } catch (err) {
    req.log.error({ err }, "data-health/topology failed");
    res.status(500).json({ error: "topology check failed" });
  }
});

/**
 * GET /api/data-health/activation-readiness — OWNER-ONLY, PHASE 0.8C.
 *
 * The single place to answer "why will the feed not activate?" without
 * guessing. Every one of the fifteen gates is reported with its own state, a
 * stable blocker code, the instant it was evaluated, the instant it stops
 * speaking for the present, and the identity of the source it came from.
 *
 * WHY ONE ENDPOINT AND NOT FIFTEEN FIELDS SPREAD ACROSS ROUTES
 * ------------------------------------------------------------
 * Gates are only meaningful together and only meaningful at ONE instant. Two
 * routes evaluated a second apart can disagree — one sees authority valid, the
 * next sees it expired — and an operator reconciling them by hand will
 * reasonably conclude the system is flaky rather than that it refused
 * correctly. So the whole set is computed from a single snapshot taken once
 * per request.
 *
 * THIS ROUTE CANNOT ACTIVATE ANYTHING. It is a GET behind `requireOwnerStrict`
 * with no mutation path: it flips no lock, grants no authorization, refreshes
 * no registry generation, starts no scheduler, opens no socket and performs no
 * provider call. Reading it is not an act of authorization.
 *
 * WHAT IT DELIBERATELY DOES NOT RETURN
 * ------------------------------------
 * No credentials, tokens, session material, environment values, raw provider
 * payloads or instrument identities. Only coded states, counts, hashes and
 * timestamps. `detailsSafeForOwnerDiagnostics` is a curated allowlist of coded
 * strings assembled by the evidence producers — never interpolated user input
 * and never a raw error message.
 */
router.get("/data-health/activation-readiness", requireOwnerStrict, (req, res) => {
  try {
    const nowMs = Date.now();
    const snap = buildProductionActivationSnapshot(nowMs);
    const diag = getProductionFeedManager().diagnostics();

    const gates = snap.decision.gates.map((g) => ({
      gateId: g.gateId,
      state: g.state,
      blockerCode: g.state === "PASS" ? null : (g.reasonCode ?? g.blockerCode ?? g.gateId),
      evaluatedAt: g.evaluatedAt ?? null,
      validUntil: g.validUntil ?? null,
      // Present so an operator can see WHY a gate has no expiry, rather than
      // having to infer it from a null.
      expirySemantics:
        g.validUntil === null || g.validUntil === undefined
          ? "NO_TIME_BASED_AUTHORITY_POSSIBLE"
          : nowMs >= g.validUntil
            ? "EXPIRED"
            : "WITHIN_VALIDITY_BOUNDARY",
      sourceKind: g.sourceKind ?? "NOT_AVAILABLE",
      sourceIdentity: g.sourceIdentity ?? null,
      details: g.detailsSafeForOwnerDiagnostics ?? [],
    }));

    // Derive blockers with the SAME aggregate judgment the manager uses at the
    // side-effect boundary — not from gate state alone. A gate can read PASS
    // and still be refused because it expired, was stamped in the future, or
    // describes another generation. Reporting only `state !== "PASS"` would
    // show an operator zero blockers while the feed refuses to start, which is
    // precisely the confusion this endpoint exists to eliminate.
    const aggregate = judgeAllRequiredEvidence(
      snap.decision.gates,
      nowMs,
      snap.decision.registryGenerationId,
    );
    const blockingCodes = aggregate.admitted ? [] : [...aggregate.blockingCodes];
    const blockingGateIds = gates.filter((g) => g.state !== "PASS").map((g) => g.gateId);

    // Cross-generation / hash agreement, reported explicitly rather than being
    // folded into a single gate, because a mismatch here means the gates above
    // were each evaluated correctly but about DIFFERENT things.
    const plan = snap.decision.plan;
    const generationIds = new Set(
      gates.map((g) => g.sourceIdentity).filter((v): v is string => typeof v === "string"),
    );
    const consistency = {
      decisionGenerationId: snap.decision.registryGenerationId,
      planGenerationId: plan.registryGenerationId,
      generationIdsAgree:
        snap.decision.registryGenerationId === plan.registryGenerationId &&
        generationIds.size <= 1,
      distinctEvidenceGenerationCount: generationIds.size,
      subscriptionSetHashPresent: snap.decision.subscriptionSetHash !== null,
      completeManifestHashPresent: snap.decision.completeManifestHash !== null,
      completeManifestHashAgreesWithPlan:
        snap.decision.completeManifestHash === plan.completeManifestHash,
    };

    res.json({
      phase: "PHASE_0_8C_ACTIVATION_READINESS",
      evaluatedAtMs: snap.evaluatedAtMs,
      // The whole point of the surface. Never computed from a cached boolean.
      overall: "REFUSED",
      /** Gates whose own state is not PASS. */
      blockingGateIds,
      /**
       * The authoritative refusal list: `GATE_ID:REASON`, including gates that
       * SAY pass but are inadmissible. Always a superset of blockingGateIds.
       */
      blockingCodes,
      evidenceAdmittedByBoundary: aggregate.admitted,
      gates,
      consistency,
      shutdown: {
        state: snap.shutdown.state,
        blockerCode: snap.shutdown.reasonCode,
        installationState: snap.shutdown.installationState,
        phase: snap.shutdown.phase,
      },
      tokenReconciliation: {
        state: snap.reconciliation.state,
        blockerCode: snap.reconciliation.reasonCode,
        pendingCount: snap.reconciliation.pendingCount,
      },
      runtimeSingleton: {
        state: snap.singleton.state,
        attested: snap.singleton.attested,
        blockerCode: snap.singleton.blockerCode,
        // Repository intent, shown as context so it is never mistaken for proof.
        declaredDeploymentTarget: snap.singleton.declaredDeploymentTarget,
        declaredSingletonButUnproven: snap.singleton.declaredSingletonButUnproven,
        recognisedAttestationFields: snap.singleton.recognisedFields,
        unrecognisedAttestationFields: snap.singleton.unrecognisedFields,
      },
      registryAuthority: {
        state: snap.authority.state,
        blockerCode: snap.authority.reasonCode,
        authorityState: snap.authority.authorityState,
        validUntilMs: snap.authority.validUntilMs,
      },
      kiteSession: {
        state: snap.kiteSession.state,
        blockerCode: snap.kiteSession.blockerCode,
        providerConfirmedAtMs: snap.kiteSession.providerConfirmedAtMs,
        validUntilMs: snap.kiteSession.validUntilMs,
      },
      feedManager: {
        state: diag.state,
        blocker: diag.blocker,
        clientsHeld: diag.clientsHeld,
        unreleasedSockets: diag.unreleasedSockets,
        maxSockets: diag.maxSockets,
        acceptedTickCount: diag.acceptedTickCount,
        rejectedTickCount: diag.rejectedTickCount,
        startAttempts: diag.startAttempts,
      },
      locks: {
        FEED_RUNTIME_ACTIVATION_AUTHORIZED,
        FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED,
        SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED,
        FNO_PAPER_V2_RUNTIME_AUTHORIZED,
        SWING_PAPER_V2_RUNTIME_AUTHORIZED,
      },
    });
  } catch (err) {
    req.log.error({ err }, "data-health/activation-readiness failed");
    res.status(500).json({ error: "activation readiness check failed" });
  }
});

/**
 * GET /api/data-health/feed-foundation — OWNER-ONLY, PHASE 0.8B.
 *
 * The state of the three-shard feed manager: whether it holds any socket,
 * which shards it would hold, whether the plan it would act on still satisfies
 * its invariants, and how much of the committed universe is actually covered.
 *
 * WHAT THIS ROUTE DELIBERATELY DOES NOT RETURN
 * --------------------------------------------
 * No instrument identities, no provider tokens, no credentials, no session
 * material, no raw provider payloads, and no raw error strings. Only coded
 * blockers, counts and hashes. An owner diagnostic that echoes a provider error
 * verbatim is an exfiltration path the moment a provider starts quoting request
 * parameters back in its messages, so failures are reported as CODES and the
 * detail text stays in the server log.
 *
 * COVERAGE IS EXPECTED TO READ ZERO HERE
 * --------------------------------------
 * While activation is unauthorised the manager owns nothing, so
 * `observationState` reads DISABLED and every expected instrument is counted
 * MISSING. That is the correct reading, not a defect: attributing the live
 * store's existing quotes to a feed that never opened a socket would fabricate
 * evidence of a running feed.
 *
 * Reads in-process state only. Opens no socket, contacts no provider, writes
 * nothing, and cannot activate anything.
 */
router.get("/data-health/feed-foundation", requireOwnerStrict, (req, res) => {
  try {
    const nowMs = Date.now();
    const manifest = getSubscriptionAdmissionManifestNow(nowMs);
    const plan = planFeedShards(manifest);
    const ownership = evaluateFeedOwnershipAdmission(
      readTopologySignals(process.env, readDeclaredDeploymentTargetFromDisk(process.cwd())),
    );
    const gates = evaluateActivationGates({ manifest, plan, ownership });

    const manager = getProductionFeedManager();
    const diag = manager.diagnostics();
    const admission = admitShardPlan(plan);

    const coverage = buildFeedCoverageLedger({
      plan,
      observationState: observationStateForManager(diag.state),
      nowMs,
      freshnessWindowMs: 60_000,
      registryGenerationId: manifest.registryGenerationId,
      // Never consulted while the feed is not OBSERVED; supplied so the
      // function has no reason to reach into the live store itself.
      lookupLastTickMs: () => null,
      lostShardIds: manager.lostShardIds(),
    });

    res.json({
      phase: "PHASE_0_8B",
      evaluatedAt: new Date(nowMs).toISOString(),
      feedManager: {
        state: diag.state,
        blocker: diag.blocker,
        activationAuthorizedConstant: diag.activationAuthorizedConstant,
        maxSockets: diag.maxSockets,
        clientsHeld: diag.clientsHeld,
        // Non-zero means this process opened provider sockets it could not
        // release. It is surfaced because the provider may still be counting
        // them against the per-key ceiling.
        unreleasedSockets: diag.unreleasedSockets,
        // Distinguishes "the provider agreed" from "we sent the request".
        subscriptionConfirmation: diag.subscriptionConfirmation,
        lostShardIds: diag.lostShardIds,
        acceptedTickCount: diag.acceptedTickCount,
        rejectedTickCount: diag.rejectedTickCount,
        startAttempts: diag.startAttempts,
        planGenerationId: diag.planGenerationId,
        shardSlots: diag.shards.map((s) => ({
          shardId: s.shardId,
          held: s.held,
          clientState: s.clientState,
          lost: s.lost,
          expectedTokens: s.expectedTokens,
        })),
      },
      shardPlanAdmission: {
        admitted: admission.admitted,
        blockers: admission.blockers,
        observedTotalTokens: admission.observedTotalTokens,
        observedShardCount: admission.observedShardCount,
      },
      coverage: {
        observationState: coverage.observationState,
        freshnessWindowMs: coverage.freshnessWindowMs,
        expected: coverage.expected,
        fresh: coverage.fresh,
        stale: coverage.stale,
        missing: coverage.missing,
        identityEquationHolds: coverage.identityEquationHolds,
        shardSumEquationHolds: coverage.shardSumEquationHolds,
        equationsHold: coverage.equationsHold,
        shards: coverage.shards.map((s) => ({
          shardId: s.shardId,
          expected: s.expected,
          fresh: s.fresh,
          stale: s.stale,
          missing: s.missing,
          equationHolds: s.equationHolds,
        })),
      },
      activation: {
        gatesPass: gates.allGatesPass,
        blockingGateIds: gates.blockingGateIds,
      },
    });
  } catch (err) {
    req.log.error({ err }, "data-health/feed-foundation failed");
    res.status(500).json({ error: "feed foundation check failed" });
  }
});

export default router;
