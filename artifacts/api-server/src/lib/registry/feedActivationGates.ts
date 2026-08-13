/**
 * PHASE 0.8A — THE ACTIVATION GATE LIST
 *
 * One ordered, explicit list of every condition that must hold before a live
 * feed may be opened. Nothing implicit, nothing inferred from a green badge.
 *
 * Three states only:
 *   PASS          — verified true at the supplied instant, from real evidence.
 *   BLOCKED       — verified false, or unverifiable, which is the same thing.
 *   NOT_EVALUATED — deliberately out of scope for this phase, and therefore
 *                   NEVER counted as passing.
 *
 * The Kite session is the canonical NOT_EVALUATED case: this phase is forbidden
 * from touching the provider, so it reports that fact by name rather than
 * guessing from a cached session row.
 */

import type { SubscriptionAdmissionManifest } from "./subscriptionManifest";
import type { FeedShardPlan } from "./feedShardPlan";
import type { FeedOwnershipAdmission } from "./feedOwnershipAdmission";

export type ActivationGateState = "PASS" | "BLOCKED" | "NOT_EVALUATED";

export interface ActivationGate {
  readonly id: string;
  readonly state: ActivationGateState;
  readonly detail: string;
}

export interface ActivationGateReport {
  readonly gates: readonly ActivationGate[];
  /** True only when EVERY gate is PASS. NOT_EVALUATED never satisfies this. */
  readonly allGatesPass: boolean;
  readonly activationAuthorized: boolean;
  readonly blockingGateIds: readonly string[];
}

export const KITE_SESSION_GATE_STATE = "KITE_SESSION_NOT_EVALUATED_IN_PHASE_0_8A";

export function evaluateActivationGates(input: {
  readonly manifest: SubscriptionAdmissionManifest;
  readonly plan: FeedShardPlan;
  readonly ownership: FeedOwnershipAdmission;
}): ActivationGateReport {
  const { manifest, plan, ownership } = input;
  const g = (id: string, ok: boolean, pass: string, blocked: string): ActivationGate =>
    Object.freeze({ id, state: ok ? ("PASS" as const) : ("BLOCKED" as const), detail: ok ? pass : blocked });

  const integrityValid = manifest.blockerCode === null && manifest.state !== "UNAVAILABLE";

  const gates: ActivationGate[] = [
    g(
      "REGISTRY_RESTORATION_SETTLED",
      !manifest.blockers.includes("REGISTRY_RESTORATION_NOT_SETTLED"),
      "boot restoration reached a terminal state",
      "boot restoration has not settled; the universe is unanswered, not empty",
    ),
    g(
      "REGISTRY_GENERATION_PRESENT",
      manifest.registryGenerationId !== null,
      "a durable registry generation is installed",
      "no registry generation is installed",
    ),
    g(
      "SUBSCRIPTION_MANIFEST_INTEGRITY_VALID",
      integrityValid,
      "schema, policy, checksums and record-set commitment all verify",
      manifest.blockers.join(", ") || "manifest integrity could not be established",
    ),
    g(
      "CLASSIFICATION_REMAINDER_ZERO",
      integrityValid && manifest.remainder === 0,
      "every record falls in exactly one classification",
      "classification left a remainder",
    ),
    g(
      "LIVE_REQUIRED_EQUATION_BALANCES",
      integrityValid && manifest.liveRequired.balances,
      "LIVE_REQUIRED total equals mapped + unmapped + diverted",
      "the LIVE_REQUIRED equation does not balance",
    ),
    g(
      "PROVIDER_TOKEN_INVARIANTS_HOLD",
      integrityValid && manifest.admitted.length > 0,
      "every admitted instrument holds a unique, positive, exchange-qualified token",
      "token invariants failed or nothing was admitted",
    ),
    g(
      "REGISTRY_AUTHORITY_CURRENT",
      manifest.state === "ACTIVATABLE_CURRENT",
      "the generation's calendar and BSE reference both still speak for now",
      `authority is ${manifest.authorityState ?? "unknown"}; a candidate universe may not activate`,
    ),
    g(
      "SHARD_PLAN_WITHIN_PROVIDER_CAPACITY",
      plan.state === "PLANNED",
      `planned ${plan.totalTokens} tokens across ${plan.shards.length} socket(s)`,
      plan.blockerCode ?? "no shard plan could be produced",
    ),
    g(
      "FEED_OWNERSHIP_SINGLE_WRITER_ADMITTED",
      ownership.ownershipAdmitted,
      "exactly one writer is structurally guaranteed and admitted",
      ownership.blockerCode ?? "feed ownership is not established",
    ),
    Object.freeze({
      id: "KITE_SESSION_VALID",
      state: "NOT_EVALUATED" as const,
      detail: KITE_SESSION_GATE_STATE,
    }),
    Object.freeze({
      id: "OWNER_ACTIVATION_AUTHORIZATION",
      state: "NOT_EVALUATED" as const,
      detail: "activation requires an explicit owner authorization that Phase 0.8A does not request",
    }),
  ];

  const allGatesPass = gates.every((x) => x.state === "PASS");
  return Object.freeze({
    gates: Object.freeze(gates),
    allGatesPass,
    activationAuthorized: allGatesPass,
    blockingGateIds: Object.freeze(gates.filter((x) => x.state !== "PASS").map((x) => x.id)),
  });
}
