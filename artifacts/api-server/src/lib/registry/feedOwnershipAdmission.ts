/**
 * PHASE 0.8A — FEED OWNERSHIP ADMISSION
 *
 * Before three WebSockets may be opened, exactly one process in the entire
 * deployment must be entitled to own them. This module answers whether that
 * entitlement can be established AT ALL under the current Replit deployment
 * topology. It is read-only: it inspects declared topology, changes no
 * deployment configuration, and creates no lock of any kind.
 *
 * WHY A LOCK IS NOT AN ANSWER
 * ---------------------------
 * The provider counts concurrent sockets per API KEY, not per process. So the
 * resource being contended lives outside every coordination primitive available
 * here:
 *
 *   - a process-local mutex coordinates nothing across replicas;
 *   - a PostgreSQL advisory lock is released when its session dies, but the
 *     socket it was guarding does not close at the same instant — the provider
 *     still counts it, so a new owner acquiring the lock overshoots the 3-socket
 *     ceiling and gets refused or silently degraded;
 *   - a lease row has the same defect one step removed: lease expiry is a
 *     database event, socket teardown is a network event, and nothing forces
 *     them to agree;
 *   - leader election needs a fencing token the provider will honour. Kite has
 *     no such concept: a deposed leader's socket keeps receiving ticks.
 *
 * Under scale-to-zero the problem gains a second edge: a container may be
 * frozen rather than terminated, so the "previous" owner can resume holding a
 * socket after its successor started.
 *
 * THEREFORE: this phase records the topology and REFUSES ownership. It does not
 * invent a workaround, and it does not silently succeed on the assumption that
 * one replica is the common case.
 */

import fs from "node:fs";
import path from "node:path";

/** How the deployment can be scheduled — the only thing that decides ownership. */
export type DeploymentTopologyClass =
  /** Provably exactly one long-lived process; ownership could be structural. */
  | "STRUCTURAL_SINGLETON"
  /** The platform may run more than one instance concurrently. */
  | "MULTI_REPLICA_POSSIBLE"
  /** One instance at a time, but it may be suspended/resumed or cold-started. */
  | "SCALE_TO_ZERO_POSSIBLE"
  /** Topology could not be established from evidence. Never assumed benign. */
  | "TOPOLOGY_UNKNOWN";

export type RuntimeEnvironmentClass = "DEPLOYMENT" | "DEVELOPMENT_WORKSPACE" | "UNKNOWN";

/**
 * Observed, declared facts. Supplied by the caller so the classifier stays pure
 * and testable; nothing in here is inferred from a hostname or a timer.
 */
export interface DeploymentTopologySignals {
  /** `deploymentTarget` as declared in `.replit`, verbatim, or null if unread. */
  readonly declaredDeploymentTarget: string | null;
  /** True when this process is running as a published deployment. */
  readonly isDeployment: boolean;
  /** Declared replica/instance count when the platform exposes one. */
  readonly declaredReplicaCount: number | null;
}

export interface DeploymentTopologyAssessment {
  readonly topology: DeploymentTopologyClass;
  readonly runtimeEnvironment: RuntimeEnvironmentClass;
  readonly declaredDeploymentTarget: string | null;
  readonly multiReplicaPossible: boolean;
  readonly scaleToZeroPossible: boolean;
  /** Human-readable, non-sensitive evidence strings. No env values are echoed. */
  readonly evidence: readonly string[];
}

/**
 * Targets that may run more than one instance at once. Autoscale is the default
 * for this project and is explicitly horizontal.
 */
const MULTI_REPLICA_TARGETS: ReadonlySet<string> = new Set(["autoscale", "cloudrun"]);
/** Targets that stop entirely when idle and cold-start on demand. */
const SCALE_TO_ZERO_TARGETS: ReadonlySet<string> = new Set(["autoscale", "cloudrun", "scheduled"]);
/** Targets that are one always-on machine. */
const SINGLETON_TARGETS: ReadonlySet<string> = new Set(["vm", "gce", "reserved-vm"]);

export function classifyDeploymentTopology(
  signals: DeploymentTopologySignals,
): DeploymentTopologyAssessment {
  const target = signals.declaredDeploymentTarget?.trim().toLowerCase() ?? null;
  const evidence: string[] = [];

  const runtimeEnvironment: RuntimeEnvironmentClass = signals.isDeployment
    ? "DEPLOYMENT"
    : "DEVELOPMENT_WORKSPACE";

  if (target === null) {
    evidence.push("NO_DECLARED_DEPLOYMENT_TARGET_FOUND");
  } else {
    evidence.push(`DECLARED_DEPLOYMENT_TARGET=${target}`);
  }

  const multiReplicaPossible = target !== null && MULTI_REPLICA_TARGETS.has(target);
  const scaleToZeroPossible = target !== null && SCALE_TO_ZERO_TARGETS.has(target);

  if (signals.declaredReplicaCount !== null) {
    evidence.push(`DECLARED_REPLICA_COUNT=${signals.declaredReplicaCount}`);
  }

  // A workspace process and a published deployment can run AT THE SAME TIME
  // against the same provider key, so "I am the only process in my own
  // environment" never implies sole ownership.
  if (!signals.isDeployment) {
    evidence.push("DEVELOPMENT_WORKSPACE_MAY_RUN_CONCURRENTLY_WITH_DEPLOYMENT");
  }

  let topology: DeploymentTopologyClass;
  if (target === null) {
    topology = "TOPOLOGY_UNKNOWN";
  } else if (multiReplicaPossible || (signals.declaredReplicaCount ?? 1) > 1) {
    topology = "MULTI_REPLICA_POSSIBLE";
    evidence.push("PLATFORM_MAY_RUN_CONCURRENT_INSTANCES");
  } else if (scaleToZeroPossible) {
    topology = "SCALE_TO_ZERO_POSSIBLE";
    evidence.push("INSTANCE_MAY_BE_SUSPENDED_AND_RESUMED");
  } else if (SINGLETON_TARGETS.has(target)) {
    topology = "STRUCTURAL_SINGLETON";
    evidence.push("SINGLE_ALWAYS_ON_INSTANCE_DECLARED");
  } else {
    topology = "TOPOLOGY_UNKNOWN";
    evidence.push("DEPLOYMENT_TARGET_NOT_IN_KNOWN_TOPOLOGY_SET");
  }

  return Object.freeze({
    topology,
    runtimeEnvironment,
    declaredDeploymentTarget: target,
    multiReplicaPossible,
    scaleToZeroPossible,
    evidence: Object.freeze(evidence),
  });
}

/** Coordination primitives that were considered and are NOT sufficient here. */
export interface RejectedOwnershipMechanism {
  readonly mechanism: string;
  readonly whyInsufficient: string;
}

export const REJECTED_OWNERSHIP_MECHANISMS: readonly RejectedOwnershipMechanism[] = Object.freeze([
  Object.freeze({
    mechanism: "PROCESS_LOCAL_LOCK",
    whyInsufficient:
      "Scoped to one process. Two replicas each acquire their own copy and both believe they own the feed.",
  }),
  Object.freeze({
    mechanism: "POSTGRES_ADVISORY_LOCK",
    whyInsufficient:
      "Released on session death, but the provider socket it guarded is not closed at the same instant; the successor's sockets are counted on top of the predecessor's against the per-key ceiling.",
  }),
  Object.freeze({
    mechanism: "DB_LEASE_ROW",
    whyInsufficient:
      "Lease expiry is a database event and socket teardown is a network event; nothing forces them to coincide, so leases overlap exactly when the feed is least healthy.",
  }),
  Object.freeze({
    mechanism: "LEADER_ELECTION",
    whyInsufficient:
      "Requires a fencing token the provider honours. Kite counts sockets per API key and has no such concept, so a deposed leader keeps streaming.",
  }),
]);

export interface FeedOwnershipAdmission {
  readonly ownershipAdmitted: boolean;
  readonly singleWriterStructurallyGuaranteed: boolean;
  readonly topology: DeploymentTopologyAssessment;
  readonly blockerCode: string | null;
  readonly rejectedMechanisms: readonly RejectedOwnershipMechanism[];
  readonly rationale: string;
  /** Phase 0.8A never admits ownership; this states that explicitly. */
  readonly phase: "PHASE_0_8A_ADMISSION_ONLY";
}

/**
 * The admission record. Ownership requires a topology in which exactly one
 * writer is structurally guaranteed — not merely likely, not enforced by a lock
 * this code could take.
 */
export function evaluateFeedOwnershipAdmission(
  signals: DeploymentTopologySignals,
): FeedOwnershipAdmission {
  const topology = classifyDeploymentTopology(signals);
  const structural = topology.topology === "STRUCTURAL_SINGLETON";

  let blockerCode: string | null;
  let rationale: string;
  switch (topology.topology) {
    case "MULTI_REPLICA_POSSIBLE":
      blockerCode = "FEED_OWNERSHIP_MULTI_REPLICA_TOPOLOGY";
      rationale =
        "The platform may run concurrent instances of this service, so no process can be the sole holder of the provider's three sockets.";
      break;
    case "SCALE_TO_ZERO_POSSIBLE":
      blockerCode = "FEED_OWNERSHIP_SCALE_TO_ZERO_TOPOLOGY";
      rationale =
        "The instance may be suspended and resumed, so a predecessor's sockets can outlive the moment its successor starts.";
      break;
    case "TOPOLOGY_UNKNOWN":
      blockerCode = "FEED_OWNERSHIP_TOPOLOGY_UNKNOWN";
      rationale =
        "Deployment topology could not be established from declared evidence. Unknown topology is treated as unsafe, never as singleton.";
      break;
    case "STRUCTURAL_SINGLETON":
      // Even here Phase 0.8A does not admit: a structural singleton in the
      // deployment still coexists with the development workspace process, and
      // admitting ownership is an activation decision this phase may not take.
      blockerCode = "FEED_OWNERSHIP_ACTIVATION_NOT_AUTHORIZED_IN_PHASE_0_8A";
      rationale =
        "Topology permits a single writer, but Phase 0.8A is admission-only: ownership is recorded as available, not granted.";
      break;
  }

  return Object.freeze({
    ownershipAdmitted: false,
    singleWriterStructurallyGuaranteed: structural,
    topology,
    blockerCode,
    rejectedMechanisms: REJECTED_OWNERSHIP_MECHANISMS,
    rationale,
    phase: "PHASE_0_8A_ADMISSION_ONLY" as const,
  });
}

/**
 * PURE parser for the declared deployment target.
 *
 * Reads the `deploymentTarget = "..."` line out of a `.replit` file body. It
 * looks only inside the `[deployment]` table so that an unrelated key elsewhere
 * in the file cannot be mistaken for the topology declaration.
 */
export function parseDeclaredDeploymentTarget(replitFileBody: string): string | null {
  let inDeployment = false;
  for (const raw of replitFileBody.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inDeployment = line === "[deployment]";
      continue;
    }
    if (!inDeployment) continue;
    const m = /^deploymentTarget\s*=\s*"([^"]*)"\s*$/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/**
 * READ-ONLY inspection of the workspace `.replit` declaration.
 *
 * Walks up from this module's directory looking for `.replit`. Any failure —
 * missing file, unreadable, no declaration — returns null, which classifies as
 * TOPOLOGY_UNKNOWN. It never writes, never creates the file, and never falls
 * back to a guessed target.
 */
export function readDeclaredDeploymentTargetFromDisk(startDir: string): string | null {
  try {
    let dir = startDir;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, ".replit");
      if (fs.existsSync(candidate)) {
        return parseDeclaredDeploymentTarget(fs.readFileSync(candidate, "utf8"));
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Read topology signals from the environment WITHOUT changing anything.
 *
 * The declared deployment target lives in `.replit`, which is not exposed as an
 * environment variable, so a caller that has read it may pass it in. Nothing is
 * guessed: an absent value stays null and classifies as TOPOLOGY_UNKNOWN.
 */
export function readTopologySignals(
  env: NodeJS.ProcessEnv,
  declaredDeploymentTarget: string | null,
): DeploymentTopologySignals {
  const raw = env.REPLIT_DEPLOYMENT_REPLICAS ?? env.REPLICA_COUNT ?? null;
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return {
    declaredDeploymentTarget,
    isDeployment: env.REPLIT_DEPLOYMENT === "1",
    declaredReplicaCount: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null,
  };
}
