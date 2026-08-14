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

import { createFeedManager, type FeedManager, type FeedActivationDecision } from "./feedManager";
import { REFUSING_FEED_CLIENT_FACTORY } from "./feedClientPort";
import { getSubscriptionAdmissionManifestNow } from "../registry/subscriptionManifest";
import { planFeedShards } from "../registry/feedShardPlan";
import { evaluateActivationGates } from "../registry/feedActivationGates";
import { getSettledActiveGeneration } from "../registry/manifestStore";
import {
  evaluateFeedOwnershipAdmission,
  readDeclaredDeploymentTargetFromDisk,
  readTopologySignals,
} from "../registry/feedOwnershipAdmission";
import type { FeedCloseHook } from "../lifecycle/gracefulShutdown";

let instance: FeedManager | null = null;

/**
 * Build the real activation decision from Phase 0.8A evidence.
 *
 * Pure with respect to the provider: it reads the registry manifest, plans
 * shards and evaluates gates. It contacts nothing.
 */
export function buildProductionActivationDecision(nowMs: number): FeedActivationDecision {
  const manifest = getSubscriptionAdmissionManifestNow(nowMs);
  const plan = planFeedShards(manifest);
  const ownership = evaluateFeedOwnershipAdmission(
    readTopologySignals(process.env, readDeclaredDeploymentTargetFromDisk(process.cwd())),
  );
  const gates = evaluateActivationGates({ manifest, plan, ownership });
  return {
    plan,
    gatesPass: gates.allGatesPass,
    blockingGateIds: gates.blockingGateIds,
    registryGenerationId: manifest.registryGenerationId,
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
