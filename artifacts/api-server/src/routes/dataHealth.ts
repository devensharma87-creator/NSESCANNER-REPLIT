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

export default router;
