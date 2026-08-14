/**
 * PHASE 0.8B — THE PROCESS-WIDE FEED MANAGER INSTANCE
 *
 * One manager per process, constructed lazily, wired to the real Phase 0.8A
 * activation evidence. This is what the shutdown hook and the owner diagnostic
 * surface talk to.
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
  type StructuredActivationDecision,
} from "./feedManager";
import { REFUSING_FEED_CLIENT_FACTORY } from "./feedClientPort";
import { getSubscriptionAdmissionManifestNow } from "../registry/subscriptionManifest";
import { planFeedShards, SHARD_POLICY_VERSION } from "../registry/feedShardPlan";
import { evaluateActivationGates } from "../registry/feedActivationGates";
import { getSettledActiveGeneration } from "../registry/manifestStore";
import {
  evaluateFeedOwnershipAdmission,
  readDeclaredDeploymentTargetFromDisk,
  readTopologySignals,
} from "../registry/feedOwnershipAdmission";
import type { FeedCloseHook } from "../lifecycle/gracefulShutdown";

let instance: FeedManager | null = null;

type OldGateState = "PASS" | "BLOCKED" | "NOT_EVALUATED";

function mapOldGateState(state: OldGateState | undefined): "PASS" | "FAIL" | "NOT_EVALUATED" {
  if (state === "PASS") return "PASS";
  if (state === "BLOCKED") return "FAIL";
  return "NOT_EVALUATED";
}

/**
 * Build the real structured activation decision from Phase 0.8A evidence.
 *
 * Pure with respect to the provider: it reads the registry manifest, plans
 * shards and evaluates gates. It contacts nothing.
 *
 * Gate mapping strategy: the 11 Phase 0.8A gate IDs are bridged to the 15
 * canonical FeedActivationGateId values required by StructuredActivationDecision.
 * Gates not evaluated in Phase 0.8A are reported as NOT_EVALUATED — honest
 * because they were not checked, not defaulted to PASS.
 *
 * Note: since FEED_RUNTIME_ACTIVATION_AUTHORIZED is false, start() in
 * createFeedManager refuses before calling getActivation(). This function
 * is constructed but only executed when the caller explicitly requests it
 * (e.g. owner diagnostics). The TypeScript types must still compile.
 */
export function buildProductionActivationDecision(nowMs: number): StructuredActivationDecision {
  const manifest = getSubscriptionAdmissionManifestNow(nowMs);
  const plan = planFeedShards(manifest);
  const ownership = evaluateFeedOwnershipAdmission(
    readTopologySignals(process.env, readDeclaredDeploymentTargetFromDisk(process.cwd())),
  );
  const gateReport = evaluateActivationGates({ manifest, plan, ownership });

  // Build a lookup from Phase 0.8A gate IDs to their state.
  const oldStateMap = new Map<string, OldGateState>(
    gateReport.gates.map((g) => [g.id, g.state] as [string, OldGateState]),
  );

  // SUBSCRIPTION_MANIFEST_ACCEPTED: all three subordinate gates must PASS.
  const subgates: OldGateState[] = [
    oldStateMap.get("CLASSIFICATION_REMAINDER_ZERO") as OldGateState,
    oldStateMap.get("LIVE_REQUIRED_EQUATION_BALANCES") as OldGateState,
    oldStateMap.get("PROVIDER_TOKEN_INVARIANTS_HOLD") as OldGateState,
  ];
  const anySubEvaluated = subgates.some((s) => s !== undefined);
  const allSubPass = anySubEvaluated && subgates.every((s) => s === "PASS");
  const subManifestState: "PASS" | "FAIL" | "NOT_EVALUATED" = !anySubEvaluated
    ? "NOT_EVALUATED"
    : allSubPass
      ? "PASS"
      : "FAIL";

  const gates: FeedActivationGate[] = [
    {
      gateId: "REGISTRY_RESTORATION_SETTLED",
      state: mapOldGateState(oldStateMap.get("REGISTRY_RESTORATION_SETTLED") as OldGateState),
    },
    {
      gateId: "REGISTRY_AUTHORITY_CURRENT",
      state: mapOldGateState(oldStateMap.get("REGISTRY_AUTHORITY_CURRENT") as OldGateState),
    },
    {
      gateId: "REGISTRY_SCHEMA_AND_POLICY_SUPPORTED",
      state: mapOldGateState(
        oldStateMap.get("SUBSCRIPTION_MANIFEST_INTEGRITY_VALID") as OldGateState,
      ),
    },
    { gateId: "SUBSCRIPTION_MANIFEST_ACCEPTED", state: subManifestState },
    {
      gateId: "REGISTRY_GENERATION_ID_PRESENT",
      state: mapOldGateState(oldStateMap.get("REGISTRY_GENERATION_PRESENT") as OldGateState),
    },
    {
      gateId: "SUBSCRIPTION_SET_HASH_PRESENT",
      state: manifest.subscriptionSetHash !== null ? "PASS" : "FAIL",
    },
    {
      gateId: "COMPLETE_MANIFEST_HASH_PRESENT",
      state: plan.completeManifestHash !== null ? "PASS" : "FAIL",
    },
    {
      gateId: "SHARD_POLICY_VERSION_SUPPORTED",
      state: plan.shardPolicyVersion === SHARD_POLICY_VERSION ? "PASS" : "FAIL",
    },
    {
      gateId: "SHARD_PLAN_CAPACITY_ADMITTED",
      state: mapOldGateState(
        oldStateMap.get("SHARD_PLAN_WITHIN_PROVIDER_CAPACITY") as OldGateState,
      ),
    },
    {
      gateId: "FEED_OWNERSHIP_SINGLETON_ATTESTED",
      state: mapOldGateState(
        oldStateMap.get("FEED_OWNERSHIP_SINGLE_WRITER_ADMITTED") as OldGateState,
      ),
    },
    {
      // Verified structurally by the wiring of productionFeedCloseHook into
      // createShutdownController in index.ts. Cannot be re-verified from here
      // without creating a circular import. NOT_EVALUATED is honest.
      gateId: "SHUTDOWN_LIFECYCLE_INSTALLED",
      state: "NOT_EVALUATED" as const,
    },
    {
      gateId: "KITE_SESSION_VALID",
      state: mapOldGateState(oldStateMap.get("KITE_SESSION_VALID") as OldGateState),
    },
    {
      // Not evaluated in Phase 0.8A; Phase 0.8B scope does not include this check.
      gateId: "TOKEN_RECONCILIATION_CLEAR",
      state: "NOT_EVALUATED" as const,
    },
    {
      gateId: "OWNER_ACTIVATION_AUTHORIZATION",
      state: mapOldGateState(oldStateMap.get("OWNER_ACTIVATION_AUTHORIZATION") as OldGateState),
    },
    {
      gateId: "COMPILE_TIME_FEED_LOCK",
      state: FEED_RUNTIME_ACTIVATION_AUTHORIZED ? "PASS" : "FAIL",
    },
  ];

  return {
    plan,
    gates,
    registryGenerationId: manifest.registryGenerationId,
    subscriptionSetHash: manifest.subscriptionSetHash,
    completeManifestHash: plan.completeManifestHash,
  };
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
