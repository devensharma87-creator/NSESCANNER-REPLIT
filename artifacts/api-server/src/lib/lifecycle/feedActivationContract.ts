/**
 * PHASE 0.8T — FEED ACTIVATION STATE MACHINE
 *
 * The Reserved VM preparation (Phase 0.8T) showed that steady-state uniqueness
 * does not mean handover uniqueness: when Replit publishes a new deployment, the
 * new process starts BEFORE the old one receives SIGTERM. If both automatically
 * open Kite WebSockets, the same API key could briefly own six connections.
 *
 * This module answers "may THIS process activate the feed right now?" with an
 * explicit, fail-closed state machine. The answer is always NO in Phase 0.8T,
 * and the state machine makes that impossible to circumvent accidentally.
 *
 * WHAT THIS MODULE MUST NOT DO
 * ----------------------------
 *   - Open a socket, subscribe to anything, or import any Kite module.
 *   - Produce state ACTIVE. ACTIVE is defined in the type but never reachable
 *     by any code path in this phase.
 *   - Auto-progress through states. Every transition except the initial default
 *     requires explicit, typed evidence from outside.
 *   - Accept DB locks, advisory locks, leases or heartbeats as proof that the
 *     previous process's sockets are closed. Those confirm DB connectivity, not
 *     socket closure.
 *   - Accept a deployment ID alone as proof the old deployment is gone. Presence
 *     of a new identity says nothing about when the old one terminated.
 *   - Write to the database, schedule anything, or change process state.
 */

import type { ShutdownPhase } from "./gracefulShutdown.js";

// ---------------------------------------------------------------------------
// State machine types
// ---------------------------------------------------------------------------

/**
 * All possible activation states.
 *
 * ACTIVE is listed for completeness but MUST be unreachable in Phase 0.8T.
 * Every code path returns `Exclude<FeedActivationState, "ACTIVE">`.
 */
export type FeedActivationState =
  /** Process just started; feed is off. All paths begin here. */
  | "DISABLED_BY_DEFAULT"
  /** The topology claim has not been confirmed by runtime attestation yet. */
  | "TOPOLOGY_EVIDENCE_PENDING"
  /** Topology is confirmed; the deployment handover is not yet cleared. */
  | "HANDOVER_CLEARANCE_PENDING"
  /** Handover cleared; owner has not yet authorised activation. */
  | "OWNER_AUTHORIZATION_PENDING"
  /**
   * Owner has authorised and all preconditions hold; the feed MAY be opened
   * if the phase permits it. In Phase 0.8T, this is as far as the machine
   * goes — ACTIVE is not reachable.
   */
  | "READY_FOR_OWNER_ACTIVATION"
  /** Defined only. Unreachable in Phase 0.8T by construction. */
  | "ACTIVE"
  /** A shutdown signal has arrived; no new activation is possible. */
  | "SHUTTING_DOWN"
  /** A precondition was violated; the process may not activate this session. */
  | "REFUSED";

// ---------------------------------------------------------------------------
// Blocker codes
// ---------------------------------------------------------------------------

export type FeedActivationBlockerCode =
  | "FEED_DISABLED_BY_DEFAULT"
  | "FEED_NOT_DISABLED_AT_BOOT"
  | "SHUTDOWN_NOT_INSTALLED"
  | "RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED"
  | "DEPLOYMENT_HANDOVER_NOT_CLEARED"
  | "PREVIOUS_DEPLOYMENT_IDENTITY_NOT_CONFIRMED_INACTIVE"
  | "OWNER_FEED_ACTIVATION_NOT_AUTHORIZED"
  | "PROOF_MODE_CANNOT_ACTIVATE_FEED"
  | "TOPOLOGY_NOT_STRUCTURAL_SINGLETON"
  | "PROCESS_SHUTTING_DOWN";

// ---------------------------------------------------------------------------
// Confirmation sources
// ---------------------------------------------------------------------------

/**
 * The ONLY confirmation sources accepted as evidence that the previous
 * deployment's sockets are closed. Anything not in this set — including
 * DB leases, advisory locks, heartbeats, and elapsed time — is rejected.
 *
 * For a first deployment there is no previous process to confirm; the
 * `previousDeploymentId === null` branch bypasses the source check entirely.
 */
const VALID_CONFIRMATION_SOURCES: ReadonlySet<string> = new Set([
  "OWNER_MANUAL_VERIFICATION",
  "OWNER_CONFIRMED_VIA_DIAGNOSTICS",
]);

// ---------------------------------------------------------------------------
// Hardcoded Phase 0.8T boot default
// ---------------------------------------------------------------------------

/**
 * The feed is ALWAYS disabled at boot in Phase 0.8T.
 *
 * This is not a runtime decision — it is a compile-time constant. Any code
 * that attempts to set this to `false` is introducing a regression that the
 * test suite will catch via the `feedDisabledAtBoot` check below.
 *
 * Typed as `boolean` (not `true`) so the test can assert `=== true` without
 * a type narrowing no-op.
 */
export const FEED_ACTIVATION_DISABLED_AT_BOOT: boolean = true;

// ---------------------------------------------------------------------------
// Handover evidence
// ---------------------------------------------------------------------------

/**
 * Everything this process knows about its position in a deployment handover.
 *
 * Fields are read-only; the contract is a snapshot, not a live view.
 * `previousDeploymentConfirmedInactive` requires EXPLICIT evidence — it must
 * never be inferred from elapsed time, the presence of a new deployment ID,
 * or DB connectivity alone.
 */
export interface DeploymentHandoverEvidence {
  /** Runtime deployment identity for THIS process, or null. */
  readonly currentDeploymentId: string | null;
  /**
   * Runtime deployment identity of the PREDECESSOR, if known.
   * Null on a first deployment (no predecessor to worry about).
   */
  readonly previousDeploymentId: string | null;
  /** Unique boot identity (randomUUID) for THIS incarnation. */
  readonly currentBootId: string;
  /** OS process ID. */
  readonly currentProcessId: number;
  /** ISO-8601 time this process started (or evidence was collected). */
  readonly currentStartedAt: string;
  /**
   * Whether topology attestation has been confirmed against a real deployment.
   * Mirrors `attestationSource === "VERIFIED_PLATFORM_ATTESTATION"`.
   */
  readonly topologyAttested: boolean;
  /**
   * Whether the PREVIOUS deployment has been explicitly confirmed no longer
   * running. MUST be `false` at boot — it can only be set to `true` by an
   * owner action after verifying the old process is gone.
   */
  readonly previousDeploymentConfirmedInactive: boolean;
  /**
   * Where the confirmation came from. Must be in VALID_CONFIRMATION_SOURCES
   * to count. DB leases, advisory locks and heartbeats are explicitly refused.
   */
  readonly confirmationSource: string | null;
  /**
   * The confirmation must be bound to THIS deployment — confirmations produced
   * for a different deployment or boot cannot be replayed here.
   */
  readonly confirmationBoundToDeploymentId: string | null;
  readonly confirmationBoundToBootId: string | null;
  /** ISO-8601 timestamp at which the confirmation was recorded. */
  readonly confirmedAt: string | null;
  /**
   * Whether the feed was disabled when this process booted.
   * ALWAYS `FEED_ACTIVATION_DISABLED_AT_BOOT` (i.e. `true`) in Phase 0.8T.
   */
  readonly feedDisabledAtBoot: boolean;
  /**
   * Whether the owner has explicitly authorised feed activation for THIS
   * boot+deployment pair. ALWAYS `false` at boot in Phase 0.8T.
   */
  readonly activationAuthorized: boolean;
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export interface FeedActivationAssessment {
  /** The current state. ACTIVE is never returned. */
  readonly state: Exclude<FeedActivationState, "ACTIVE">;
  readonly blockerCode: FeedActivationBlockerCode | null;
  /** Whether this process booted with feed disabled. */
  readonly feedDisabledAtBoot: boolean;
  /** Whether all handover preconditions are met. */
  readonly handoverCleared: boolean;
  /** Whether the owner has supplied an authorisation token for this boot. */
  readonly ownerAuthorizationPresent: boolean;
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// Core evaluation — pure, no side effects
// ---------------------------------------------------------------------------

function isHandoverCleared(h: DeploymentHandoverEvidence): boolean {
  if (h.currentDeploymentId === null) return false;
  // No previous deployment: first deployment, vacuously cleared.
  if (h.previousDeploymentId === null) return true;
  // Previous deployment exists: require explicit, bound, valid confirmation.
  if (!h.previousDeploymentConfirmedInactive) return false;
  if (h.confirmationSource === null || !VALID_CONFIRMATION_SOURCES.has(h.confirmationSource))
    return false;
  if (h.confirmationBoundToDeploymentId !== h.currentDeploymentId) return false;
  if (h.confirmationBoundToBootId !== h.currentBootId) return false;
  return true;
}

/**
 * Evaluate the current feed activation state.
 *
 * Pure: reads only the supplied evidence; writes nothing; allocates only the
 * result object. The return type explicitly excludes ACTIVE — calling code
 * cannot receive that value from this function.
 *
 * @param handover        Deployment handover evidence for this boot.
 * @param topologyReady   True when Phase 0.8T topology contract is satisfied.
 * @param shutdownPhase   Current phase of the shutdown coordinator.
 * @param proofMode       True when booted with side-effects suppressed.
 * @param shutdownInstalled  True when the shutdown coordinator has been
 *                        installed at boot via installShutdownLifecycle().
 *                        Feed activation is refused when this is false: a feed
 *                        opened without a shutdown handler cannot be closed on
 *                        SIGTERM/SIGINT, which is the exact overlap hazard this
 *                        phase exists to prevent.
 */
export function evaluateFeedActivationState(
  handover: DeploymentHandoverEvidence,
  topologyReady: boolean,
  shutdownPhase: ShutdownPhase,
  proofMode: boolean,
  shutdownInstalled: boolean,
): FeedActivationAssessment {
  const notes: string[] = [];

  // ── Lifecycle prerequisite: shutdown coordinator must be installed ────────
  // Checked first — before proof mode, before topology. A feed opened without
  // a shutdown handler cannot be cleaned up on SIGTERM/SIGINT.

  if (!shutdownInstalled) {
    notes.push("SHUTDOWN_COORDINATOR_NOT_INSTALLED");
    return result("REFUSED", "SHUTDOWN_NOT_INSTALLED", handover, false, notes);
  }
  notes.push("SHUTDOWN_COORDINATOR_INSTALLED");

  // ── Absolute blockers ────────────────────────────────────────────────────

  if (proofMode) {
    notes.push("PROOF_MODE_PREVENTS_FEED_ACTIVATION");
    return result("REFUSED", "PROOF_MODE_CANNOT_ACTIVATE_FEED", handover, false, notes);
  }

  if (shutdownPhase === "SHUTTING_DOWN" || shutdownPhase === "COMPLETE") {
    notes.push(`PROCESS_PHASE=${shutdownPhase}`);
    return result("SHUTTING_DOWN", "PROCESS_SHUTTING_DOWN", handover, false, notes);
  }

  // ── Feed-disabled-at-boot regression guard ───────────────────────────────

  if (!handover.feedDisabledAtBoot) {
    notes.push("FEED_WAS_NOT_DISABLED_AT_BOOT_REGRESSION_DETECTED");
    return result("REFUSED", "FEED_NOT_DISABLED_AT_BOOT", handover, false, notes);
  }
  notes.push("FEED_DISABLED_AT_BOOT=true");

  // ── Topology ─────────────────────────────────────────────────────────────

  if (!topologyReady) {
    notes.push("TOPOLOGY_CONTRACT_NOT_YET_SATISFIED");
    return result(
      "TOPOLOGY_EVIDENCE_PENDING",
      "RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED",
      handover,
      false,
      notes,
    );
  }
  notes.push("TOPOLOGY_CONTRACT_SATISFIED");

  // ── Deployment handover ───────────────────────────────────────────────────

  const handoverCleared = isHandoverCleared(handover);

  if (handover.currentDeploymentId === null) {
    notes.push("CURRENT_DEPLOYMENT_ID_ABSENT");
    return result(
      "HANDOVER_CLEARANCE_PENDING",
      "DEPLOYMENT_HANDOVER_NOT_CLEARED",
      handover,
      false,
      notes,
    );
  }

  if (handover.previousDeploymentId !== null && !handover.previousDeploymentConfirmedInactive) {
    notes.push("PREVIOUS_DEPLOYMENT_ID_PRESENT_NOT_YET_CONFIRMED_INACTIVE");
    return result(
      "HANDOVER_CLEARANCE_PENDING",
      "PREVIOUS_DEPLOYMENT_IDENTITY_NOT_CONFIRMED_INACTIVE",
      handover,
      false,
      notes,
    );
  }

  if (!handoverCleared) {
    // Covers: invalid source, wrong deployment binding, wrong boot binding.
    notes.push("HANDOVER_CONFIRMATION_INVALID_OR_BOUND_TO_WRONG_IDENTITY");
    return result(
      "HANDOVER_CLEARANCE_PENDING",
      "DEPLOYMENT_HANDOVER_NOT_CLEARED",
      handover,
      false,
      notes,
    );
  }
  notes.push("HANDOVER_CLEARED");

  // ── Owner authorisation ───────────────────────────────────────────────────

  if (!handover.activationAuthorized) {
    notes.push("OWNER_HAS_NOT_AUTHORIZED_FEED_ACTIVATION");
    return result(
      "OWNER_AUTHORIZATION_PENDING",
      "OWNER_FEED_ACTIVATION_NOT_AUTHORIZED",
      handover,
      true,
      notes,
    );
  }
  notes.push("OWNER_AUTHORIZATION_PRESENT");

  // ── Phase 0.8T ceiling: ACTIVE is unreachable ─────────────────────────────
  // All preconditions are met. We cannot go further because Phase 0.8T does
  // not implement feed opening. The owner can observe this state and act
  // in Phase 0.8B when socket construction is authorised.

  notes.push("PHASE_0_8T_CEILING_REACHED_ACTIVE_UNREACHABLE");
  return result("READY_FOR_OWNER_ACTIVATION", null, handover, true, notes);
}

function result(
  state: Exclude<FeedActivationState, "ACTIVE">,
  blockerCode: FeedActivationBlockerCode | null,
  handover: DeploymentHandoverEvidence,
  handoverCleared: boolean,
  notes: string[],
): FeedActivationAssessment {
  return Object.freeze({
    state,
    blockerCode,
    feedDisabledAtBoot: handover.feedDisabledAtBoot,
    handoverCleared,
    ownerAuthorizationPresent: handover.activationAuthorized,
    notes: Object.freeze([...notes]),
  });
}

// ---------------------------------------------------------------------------
// Boot evidence builder
// ---------------------------------------------------------------------------

import { DEPLOYMENT_IDENTITY_ENV_CANDIDATES } from "../registry/runtimeTopologyEvidence.js";

/**
 * Collect handover evidence at process start.
 *
 * ALWAYS sets `feedDisabledAtBoot = FEED_ACTIVATION_DISABLED_AT_BOOT` (true)
 * and `activationAuthorized = false`. These are not environment decisions.
 *
 * Previous-deployment identity is unknown at boot (the platform does not
 * supply a "previous deployment ID" env var). Setting
 * `previousDeploymentConfirmedInactive = false` forces the handover gate to
 * require explicit owner action before any activation can be attempted.
 */
export function buildBootHandoverEvidence(
  env: NodeJS.ProcessEnv,
  bootId: string,
  topologyAttested: boolean,
): DeploymentHandoverEvidence {
  const firstOf = (names: readonly string[]): string | null => {
    for (const n of names) {
      const v = env[n];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
    return null;
  };

  return Object.freeze({
    currentDeploymentId: firstOf(DEPLOYMENT_IDENTITY_ENV_CANDIDATES),
    // The platform does not expose the previous deployment identity to the new
    // process. We cannot confirm it is gone until the owner checks.
    previousDeploymentId: null,
    currentBootId: bootId,
    currentProcessId: process.pid,
    currentStartedAt: new Date().toISOString(),
    topologyAttested,
    previousDeploymentConfirmedInactive: false,
    confirmationSource: null,
    confirmationBoundToDeploymentId: null,
    confirmationBoundToBootId: null,
    confirmedAt: null,
    feedDisabledAtBoot: FEED_ACTIVATION_DISABLED_AT_BOOT,
    activationAuthorized: false,
  });
}
