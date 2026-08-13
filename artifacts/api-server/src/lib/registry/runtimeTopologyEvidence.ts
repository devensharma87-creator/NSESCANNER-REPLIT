/**
 * PHASE 0.8T — RUNTIME TOPOLOGY EVIDENCE
 *
 * Phase 0.8A answered "may a single feed owner exist under the declared
 * topology?" and refused, because the declared topology was Autoscale. This
 * module answers the harder question that a Reserved VM raises:
 *
 *   the .replit file SAYS this is one always-on machine — but a source file is
 *   a statement of intent, not an observation of the running system.
 *
 * So nothing here treats `.replit` as proof. The declared target is carried
 * only as context; every authorising decision is taken from evidence the
 * RUNNING process can observe about itself, and any missing piece fails closed.
 *
 * WHAT THIS MODULE MAY NOT DO
 * ---------------------------
 *   - It may not authorise from NODE_ENV, a developer flag, a hostname, a PID,
 *     an uptime reading, a lock, a lease, a heartbeat or HTTP traffic. Each of
 *     those is either forgeable in development or true of every replica at once.
 *   - It may not authorise in boot-proof mode. Proof mode exists to run the
 *     process with its side effects suppressed; a suppressed process must never
 *     be able to claim the feed.
 *   - It may not GRANT ownership at all. Phase 0.8T prepares the contract; the
 *     evidence that satisfies it cannot exist until an actual Reserved VM
 *     deployment is running, and activation additionally needs the owner.
 *
 * Everything is pure and injectable so it can be tested without a deployment.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  classifyDeploymentTopology,
  evaluateFeedOwnershipAdmission,
  type DeploymentTopologyClass,
  type FeedOwnershipAdmission,
} from "./feedOwnershipAdmission";

/**
 * What a run command's argv can tell us. Note the deliberately narrow name of
 * the best case: an argv can show that ONE executable is started, and nothing
 * more. Whether that executable then forks children is a different question,
 * answered by the entrypoint audit below.
 */
export type RunCommandProcessTopology =
  /** One plain executable is started. NOT a promise about its children. */
  | "SINGLE_ENTRYPOINT_ARGV"
  /** More than one process, or a supervisor that can fork more. */
  | "MULTI_PROCESS"
  /** Could not be established. Never assumed to be one. */
  | "PROCESS_TOPOLOGY_UNKNOWN";

/**
 * The second half of the process-count question: does the entrypoint itself
 * spawn feed-capable children?
 *
 * This cannot be decided at runtime, so it is a build-time audit of the shipped
 * api-server runtime source (no `cluster`, no `child_process`, no
 * `worker_threads` outside test infrastructure). `p08t.topologyAdmission.test`
 * re-derives it by scanning the source tree and fails if the constant below
 * ever stops matching reality — so introducing a child process anywhere in the
 * runtime forces this to be flipped to NOT_AUDITED, which closes the gate.
 */
export type EntrypointChildProcessAudit = "NO_CHILD_PROCESS_SPAWN_VERIFIED" | "NOT_AUDITED";

export const ENTRYPOINT_CHILD_PROCESS_AUDIT: EntrypointChildProcessAudit =
  "NO_CHILD_PROCESS_SPAWN_VERIFIED";

/**
 * Where a topology claim came from.
 *
 * Environment variables are the only channel a process has for learning about
 * its own deployment — and in development the same variables can simply be
 * typed by hand. So a claim is only RUNTIME_OBSERVED when it arrives through an
 * attestation key that has been VERIFIED against a real deployment; anything
 * else is an unverified claim and cannot authorise.
 */
export type SingletonEvidenceSource =
  | "RUNTIME_OBSERVED"
  | "UNVERIFIED_RUNTIME_CLAIM"
  | "SOURCE_CONFIGURATION_ONLY"
  | "NO_EVIDENCE";

/** Provenance of the runtime topology claim. */
export type PlatformAttestationSource =
  | "VERIFIED_PLATFORM_ATTESTATION"
  | "UNVERIFIED_ENVIRONMENT_CLAIM"
  | "NO_ATTESTATION";

/**
 * Attestation keys CONFIRMED to be set by the Replit platform itself, observed
 * inside a real deployment of this application.
 *
 * Deliberately EMPTY. No deployment has been observed yet, so every candidate
 * name below is a guess, and a guess that a developer can set locally. Until an
 * actual Reserved VM deployment is inspected and its real variables recorded
 * here, `readRuntimeTopologyEvidence` can only ever produce an unverified
 * claim — which is exactly the outcome this phase must report.
 */
export const VERIFIED_PLATFORM_ATTESTATION_KEYS: readonly string[] = Object.freeze([]);

/**
 * Environment variable names that WOULD carry a runtime deployment identity if
 * the platform exposes one. They are candidates, not confirmed contracts: this
 * workspace is not a deployment, so none of them can be observed here. An
 * absent identity is reported as absent — never substituted with REPL_ID, a
 * hostname or a PID, none of which distinguish two concurrent instances.
 */
export const DEPLOYMENT_IDENTITY_ENV_CANDIDATES: readonly string[] = Object.freeze([
  "REPLIT_DEPLOYMENT_ID",
  "REPLIT_DEPLOYMENT_UUID",
  "REPLIT_DEPLOYMENT_VERSION",
]);

/** Candidate names for a runtime-reported deployment target. */
export const RUNTIME_TARGET_ENV_CANDIDATES: readonly string[] = Object.freeze([
  "REPLIT_DEPLOYMENT_TARGET",
  "REPLIT_DEPLOYMENT_TYPE",
]);

/** Candidate names for a runtime-reported replica/instance count. */
export const REPLICA_COUNT_ENV_CANDIDATES: readonly string[] = Object.freeze([
  "REPLIT_DEPLOYMENT_REPLICAS",
  "REPLICA_COUNT",
]);

/**
 * The complete evidence set. Supplied by the caller; the validator below reads
 * nothing on its own so a test can state exactly what the running system knows.
 */
export interface RuntimeTopologyEvidence {
  /** `.replit` declaration. CONTEXT ONLY — never sufficient to authorise. */
  readonly declaredDeploymentTarget: string | null;
  /** Deployment target as reported to the RUNNING process, or null. */
  readonly observedRuntimeTarget: string | null;
  /** True only when this process is a published deployment. */
  readonly isDeployment: boolean;
  /** Runtime deployment identity, or null when the platform exposes none. */
  readonly deploymentIdentity: string | null;
  /** Runtime replica count when exposed. */
  readonly observedReplicaCount: number | null;
  /** Production run command argv, when it could be read. */
  readonly runCommandArgs: readonly string[] | null;
  /** Whether the runtime claim arrived through a verified attestation key. */
  readonly attestationSource: PlatformAttestationSource;
  /** Build-time audit of whether the entrypoint spawns children. */
  readonly entrypointAudit: EntrypointChildProcessAudit;
  /** True when the process booted with side effects suppressed. */
  readonly proofMode: boolean;
  /** Non-reversible provider-key identity, or null. NEVER the key itself. */
  readonly apiKeyOwnerId: string | null;
}

export interface RuntimeTopologyAssessment {
  readonly topologyState: DeploymentTopologyClass;
  readonly singletonGuaranteed: boolean;
  readonly persistentProcessGuaranteed: boolean;
  readonly deploymentIdentityPresent: boolean;
  readonly apiKeyOwnerIdPresent: boolean;
  readonly processTopology: RunCommandProcessTopology;
  readonly entrypointAudit: EntrypointChildProcessAudit;
  readonly attestationSource: PlatformAttestationSource;
  readonly evidenceSource: SingletonEvidenceSource;
  /**
   * True only when every clause of the Phase 0.8T ownership contract holds.
   * This is "the topology would permit exactly one owner", NOT "ownership is
   * granted" — no code path in this phase grants it.
   */
  readonly ownershipContractSatisfied: boolean;
  readonly blockerCode: string | null;
  readonly evidence: readonly string[];
}

/** Targets that are one always-on machine. Mirrors the Phase 0.8A classifier. */
const SINGLETON_TARGETS: ReadonlySet<string> = new Set(["vm", "gce", "reserved-vm"]);

/**
 * Tokens that mean a run command starts, or can start, more than one process.
 * `&` backgrounds a second command; `concurrently`/`pm2`/`forever` are
 * supervisors; `cluster`/`--workers` fork children that would each open their
 * own sockets against the one provider key.
 */
const MULTI_PROCESS_TOKENS: readonly string[] = Object.freeze([
  "&",
  "&&",
  ";",
  "|",
  "pm2",
  "forever",
  "concurrently",
  "supervisor",
  "cluster",
  "--workers",
  "--instances",
  "-i",
]);

/**
 * Classify how many API/feed-owner processes an argv starts.
 *
 * Conservative by construction: anything that is not a plain single-executable
 * invocation is UNKNOWN, and UNKNOWN never authorises.
 */
export function classifyRunCommandProcessTopology(
  args: readonly string[] | null,
): RunCommandProcessTopology {
  if (args === null || args.length === 0) return "PROCESS_TOPOLOGY_UNKNOWN";
  const lowered = args.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0);
  if (lowered.length === 0) return "PROCESS_TOPOLOGY_UNKNOWN";

  // Inline code is opaque: `node -e "...fork(...)"` starts as many processes as
  // the string says, and the string is not something to parse. Refuse.
  for (const arg of lowered) {
    if (["-e", "--eval", "-p", "--print", "-r", "--require"].includes(arg)) {
      return "PROCESS_TOPOLOGY_UNKNOWN";
    }
  }

  for (const arg of lowered) {
    for (const token of MULTI_PROCESS_TOKENS) {
      // Exact-token match, or the token embedded in a shell string argument.
      if (arg === token || (arg.includes(" ") && arg.split(/\s+/).includes(token))) {
        return "MULTI_PROCESS";
      }
    }
    if (arg.includes("pm2") || arg.includes("concurrently") || arg.includes("cluster")) {
      return "MULTI_PROCESS";
    }
  }

  // A shell wrapper hides its real process count behind a string we are not
  // going to parse. Refuse rather than guess.
  const exe = path.basename(lowered[0]);
  if (exe === "sh" || exe === "bash" || exe === "zsh" || exe === "npx") {
    return "PROCESS_TOPOLOGY_UNKNOWN";
  }
  // One executable is started. Whether IT forks is the entrypoint audit's job.
  return "SINGLE_ENTRYPOINT_ARGV";
}

/**
 * PURE parser for the production run argv declared in an artifact manifest.
 *
 * Reads `args = [...]` from the `[services.production.run]` table only, so a
 * build or development command cannot be mistaken for the production process.
 */
export function parseProductionRunArgs(artifactTomlBody: string): readonly string[] | null {
  let inRunTable = false;
  for (const raw of artifactTomlBody.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inRunTable = line === "[services.production.run]";
      continue;
    }
    if (!inRunTable) continue;
    const m = /^args\s*=\s*\[(.*)\]\s*$/.exec(line);
    if (!m) continue;
    const parts = m[1]
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => /^"([^"]*)"$/.exec(p)?.[1] ?? null);
    if (parts.some((p) => p === null)) return null;
    const args = parts as string[];
    return args.length > 0 ? Object.freeze(args) : null;
  }
  return null;
}

/** READ-ONLY read of the api-server artifact manifest. Never writes. */
export function readProductionRunArgsFromDisk(startDir: string): readonly string[] | null {
  try {
    let dir = startDir;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, ".replit-artifact", "artifact.toml");
      if (fs.existsSync(candidate)) {
        return parseProductionRunArgs(fs.readFileSync(candidate, "utf8"));
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
 * Derive a stable, non-reversible identity for the provider key that would own
 * the sockets. The key itself never leaves this function: only a truncated
 * SHA-256 digest is returned, which is enough to tell "the same key" from "a
 * different key" across processes and useless to an attacker.
 */
export function deriveApiKeyOwnerId(rawApiKey: string | undefined | null): string | null {
  if (typeof rawApiKey !== "string") return null;
  const trimmed = rawApiKey.trim();
  if (trimmed.length === 0) return null;
  return `kite-${createHash("sha256").update(trimmed).digest("hex").slice(0, 12)}`;
}

/**
 * Collect evidence from the environment WITHOUT changing anything.
 *
 * Absent values stay null. Nothing is inferred from NODE_ENV, the hostname, the
 * PID or the uptime.
 */
export function readRuntimeTopologyEvidence(
  env: NodeJS.ProcessEnv,
  context: {
    readonly declaredDeploymentTarget: string | null;
    readonly runCommandArgs: readonly string[] | null;
    readonly proofMode: boolean;
  },
): RuntimeTopologyEvidence {
  const firstOf = (names: readonly string[]): string | null => {
    for (const n of names) {
      const v = env[n];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
    return null;
  };

  const rawReplicas = firstOf(REPLICA_COUNT_ENV_CANDIDATES);
  const parsedReplicas = rawReplicas === null ? Number.NaN : Number.parseInt(rawReplicas, 10);

  // Provenance of the topology claim. A candidate name that is set but has
  // never been confirmed against a real deployment is an UNVERIFIED claim: in
  // development anyone can export it, so it must not be able to authorise.
  const claimKeys = [...RUNTIME_TARGET_ENV_CANDIDATES, ...REPLICA_COUNT_ENV_CANDIDATES];
  const presentClaimKeys = claimKeys.filter((n) => {
    const v = env[n];
    return typeof v === "string" && v.trim().length > 0;
  });
  const attestationSource: PlatformAttestationSource =
    presentClaimKeys.length === 0
      ? "NO_ATTESTATION"
      : presentClaimKeys.every((n) => VERIFIED_PLATFORM_ATTESTATION_KEYS.includes(n))
        ? "VERIFIED_PLATFORM_ATTESTATION"
        : "UNVERIFIED_ENVIRONMENT_CLAIM";

  return Object.freeze({
    declaredDeploymentTarget: context.declaredDeploymentTarget,
    observedRuntimeTarget: firstOf(RUNTIME_TARGET_ENV_CANDIDATES),
    isDeployment: env["REPLIT_DEPLOYMENT"] === "1",
    deploymentIdentity: firstOf(DEPLOYMENT_IDENTITY_ENV_CANDIDATES),
    observedReplicaCount:
      Number.isSafeInteger(parsedReplicas) && parsedReplicas > 0 ? parsedReplicas : null,
    runCommandArgs: context.runCommandArgs,
    attestationSource,
    entrypointAudit: ENTRYPOINT_CHILD_PROCESS_AUDIT,
    proofMode: context.proofMode,
    apiKeyOwnerId: deriveApiKeyOwnerId(env["KITE_API_KEY"]),
  });
}

/**
 * Validate the evidence against the Phase 0.8T ownership contract.
 *
 * Blocker precedence runs from "this process must never own a feed at all"
 * outwards to "this piece of evidence is missing", so the reported blocker is
 * always the most fundamental reason rather than the last one checked.
 */
export function validateRuntimeTopologyEvidence(
  evidence: RuntimeTopologyEvidence,
): RuntimeTopologyAssessment {
  const notes: string[] = [];
  const observed = evidence.observedRuntimeTarget?.trim().toLowerCase() ?? null;
  const declared = evidence.declaredDeploymentTarget?.trim().toLowerCase() ?? null;

  if (declared !== null) notes.push(`DECLARED_TARGET_CONTEXT_ONLY=${declared}`);

  // Topology is derived from the RUNTIME target exclusively. The declared
  // target is deliberately not passed to the classifier.
  const runtimeAssessment = classifyDeploymentTopology({
    declaredDeploymentTarget: observed,
    isDeployment: evidence.isDeployment,
    declaredReplicaCount: evidence.observedReplicaCount,
  });

  const topologyState: DeploymentTopologyClass = evidence.isDeployment
    ? runtimeAssessment.topology
    : "TOPOLOGY_UNKNOWN";

  const processTopology = classifyRunCommandProcessTopology(evidence.runCommandArgs);
  notes.push(`RUN_COMMAND_PROCESS_TOPOLOGY=${processTopology}`);

  const deploymentIdentityPresent = evidence.deploymentIdentity !== null;
  const apiKeyOwnerIdPresent = evidence.apiKeyOwnerId !== null;

  const attested = evidence.attestationSource === "VERIFIED_PLATFORM_ATTESTATION";
  let evidenceSource: SingletonEvidenceSource;
  if (evidence.isDeployment && observed !== null) {
    evidenceSource = attested ? "RUNTIME_OBSERVED" : "UNVERIFIED_RUNTIME_CLAIM";
  } else if (declared !== null) {
    evidenceSource = "SOURCE_CONFIGURATION_ONLY";
  } else {
    evidenceSource = "NO_EVIDENCE";
  }
  notes.push(`SINGLETON_EVIDENCE_SOURCE=${evidenceSource}`);
  notes.push(`PLATFORM_ATTESTATION=${evidence.attestationSource}`);
  notes.push(`ENTRYPOINT_CHILD_PROCESS_AUDIT=${evidence.entrypointAudit}`);

  const entrypointAudited = evidence.entrypointAudit === "NO_CHILD_PROCESS_SPAWN_VERIFIED";

  const singletonGuaranteed =
    evidenceSource === "RUNTIME_OBSERVED" &&
    topologyState === "STRUCTURAL_SINGLETON" &&
    observed !== null &&
    SINGLETON_TARGETS.has(observed) &&
    processTopology === "SINGLE_ENTRYPOINT_ARGV" &&
    entrypointAudited;

  const persistentProcessGuaranteed =
    evidenceSource === "RUNTIME_OBSERVED" &&
    topologyState === "STRUCTURAL_SINGLETON" &&
    !runtimeAssessment.scaleToZeroPossible;

  let blockerCode: string | null = null;
  if (evidence.proofMode) {
    blockerCode = "FEED_OWNERSHIP_PROOF_MODE_NEVER_AUTHORIZES";
    notes.push("BOOT_PROOF_MODE_PROCESS_MAY_NEVER_OWN_THE_FEED");
  } else if (!evidence.isDeployment) {
    blockerCode = "RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED";
    notes.push("NOT_A_DEPLOYMENT_RUNTIME_EVIDENCE_CANNOT_EXIST_HERE");
  } else if (observed === null) {
    // The deployment is running but told us nothing about its own topology.
    // The .replit declaration cannot stand in for that.
    blockerCode = "RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED";
    notes.push("NO_RUNTIME_TOPOLOGY_SIGNAL_SOURCE_CONFIG_IS_NOT_PROOF");
  } else if (!attested) {
    // Something CLAIMS a topology, through a variable name nobody has yet seen
    // a real deployment set. In development that is one `export` away, so the
    // claim is refused no matter how well-formed it looks.
    blockerCode = "PLATFORM_ATTESTATION_CONTRACT_NOT_VERIFIED";
    notes.push("TOPOLOGY_CLAIM_FROM_UNVERIFIED_ENV_NAME_SPOOFABLE_IN_DEVELOPMENT");
  } else if (topologyState === "MULTI_REPLICA_POSSIBLE") {
    blockerCode = "FEED_OWNERSHIP_MULTI_REPLICA_TOPOLOGY";
  } else if (topologyState === "SCALE_TO_ZERO_POSSIBLE") {
    blockerCode = "FEED_OWNERSHIP_SCALE_TO_ZERO_TOPOLOGY";
  } else if (topologyState !== "STRUCTURAL_SINGLETON") {
    blockerCode = "FEED_OWNERSHIP_TOPOLOGY_UNKNOWN";
  } else if (processTopology !== "SINGLE_ENTRYPOINT_ARGV") {
    blockerCode = "FEED_OWNERSHIP_MULTI_PROCESS_RUN_COMMAND";
    notes.push("RUN_COMMAND_MAY_START_MORE_THAN_ONE_FEED_OWNER");
  } else if (!entrypointAudited) {
    // One executable was started, but nothing rules out that IT forks children.
    blockerCode = "FEED_OWNERSHIP_ENTRYPOINT_CHILD_PROCESS_NOT_AUDITED";
  } else if (!deploymentIdentityPresent) {
    blockerCode = "FEED_OWNERSHIP_DEPLOYMENT_IDENTITY_MISSING";
  } else if (!apiKeyOwnerIdPresent) {
    blockerCode = "FEED_OWNERSHIP_PROVIDER_KEY_IDENTITY_MISSING";
  }

  const ownershipContractSatisfied =
    blockerCode === null &&
    singletonGuaranteed &&
    persistentProcessGuaranteed &&
    deploymentIdentityPresent &&
    apiKeyOwnerIdPresent;

  return Object.freeze({
    topologyState,
    singletonGuaranteed,
    persistentProcessGuaranteed,
    deploymentIdentityPresent,
    apiKeyOwnerIdPresent,
    processTopology,
    entrypointAudit: evidence.entrypointAudit,
    attestationSource: evidence.attestationSource,
    evidenceSource,
    ownershipContractSatisfied,
    blockerCode,
    evidence: Object.freeze(notes),
  });
}

export interface Phase08tOwnershipAssessment {
  readonly phase: "PHASE_0_8T_TOPOLOGY_PREPARATION";
  /** Always false in this phase. Ownership is never granted here. */
  readonly ownershipAdmitted: false;
  /** True when the topology contract holds — a precondition, not a grant. */
  readonly topologyReady: boolean;
  readonly blockerCode: string | null;
  readonly runtime: RuntimeTopologyAssessment;
  /** The Phase 0.8A record, unchanged, for continuity of the earlier gates. */
  readonly declaredAdmission: FeedOwnershipAdmission;
}

/**
 * Compose the Phase 0.8A declared-topology admission with the Phase 0.8T
 * runtime-evidence contract. The result is never weaker than either input: if
 * 0.8A refuses on the declared topology, 0.8T refuses too.
 */
export function evaluatePhase08tOwnership(input: {
  readonly declaredDeploymentTarget: string | null;
  readonly evidence: RuntimeTopologyEvidence;
}): Phase08tOwnershipAssessment {
  const declaredAdmission = evaluateFeedOwnershipAdmission({
    declaredDeploymentTarget: input.declaredDeploymentTarget,
    isDeployment: input.evidence.isDeployment,
    declaredReplicaCount: input.evidence.observedReplicaCount,
  });
  const runtime = validateRuntimeTopologyEvidence(input.evidence);

  const topologyReady =
    runtime.ownershipContractSatisfied &&
    declaredAdmission.singleWriterStructurallyGuaranteed;

  let blockerCode: string | null = runtime.blockerCode;
  if (blockerCode === null && !declaredAdmission.singleWriterStructurallyGuaranteed) {
    blockerCode = "FEED_OWNERSHIP_DECLARED_TOPOLOGY_NOT_SINGLETON";
  }
  if (blockerCode === null && !topologyReady) {
    blockerCode = "RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED";
  }

  return Object.freeze({
    phase: "PHASE_0_8T_TOPOLOGY_PREPARATION" as const,
    ownershipAdmitted: false as const,
    topologyReady,
    blockerCode,
    runtime,
    declaredAdmission,
  });
}
