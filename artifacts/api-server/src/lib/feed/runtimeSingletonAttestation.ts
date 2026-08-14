/**
 * PHASE 0.8C — RUNTIME SINGLETON ATTESTATION VERIFIER
 *
 * Kite counts WebSocket connections per API key. Two processes that each
 * believe they own the feed do not fail loudly — they quietly consume each
 * other's socket budget until subscriptions start getting refused. So the
 * question this module answers is not "am I probably alone?" but "can the
 * PLATFORM prove that exactly one long-lived process exists?".
 *
 * WHY THE ALLOWLIST IS EMPTY
 * --------------------------
 * A verifier that accepts field names guessed from documentation is not a
 * verifier; the first time a guessed name is absent, the code either fails
 * closed for the wrong reason or — far worse — treats some other variable as
 * the attestation. The allowlist is therefore populated ONLY from fields
 * actually observed in a real published Reserved VM deployment. Until that
 * observation happens, this gate cannot pass, and that is the honest answer,
 * not a limitation to be worked around.
 *
 * DECLARED CONFIGURATION IS NOT OBSERVED TOPOLOGY
 * -----------------------------------------------
 * `deploymentTarget = "vm"` in `.replit` is a statement of intent held in the
 * repository. It says what the next publish WOULD create. It says nothing
 * about what is running now — the same repository, unpublished, runs in a
 * development workspace alongside any previously published Autoscale
 * deployment. Config is therefore recorded as context and never as proof.
 *
 * WHAT IS EXPLICITLY NOT PROOF
 * ----------------------------
 * A process-local lock, a Postgres advisory lock, a lease row and a leader
 * election are all rejected upstream in `feedOwnershipAdmission.ts`. None of
 * them can fence a socket that a provider is still counting. This module does
 * not re-litigate that; it simply never consults them.
 */

/**
 * Platform attestation fields that may be trusted, established by observing a
 * real Reserved VM deployment.
 *
 * INTENTIONALLY EMPTY. Adding a name here is a factual claim that the field
 * was seen in a genuine published Reserved VM run and is platform-controlled
 * (not settable by application code or by a user-defined secret).
 */
export const OBSERVED_PLATFORM_ATTESTATION_KEYS: readonly string[] = Object.freeze([]);

/** Deployment targets that can never be a structural singleton. */
const NON_SINGLETON_TARGETS: ReadonlySet<string> = new Set([
  "autoscale",
  "cloudrun",
  "scheduled",
  "static",
]);

/** Deployment targets that describe one always-on machine. */
const SINGLETON_TARGETS: ReadonlySet<string> = new Set(["vm", "gce", "reserved-vm"]);

export type SingletonAttestationState =
  /** A real platform attestation was verified. Only this may activate. */
  | "ATTESTED_SINGLE_PROCESS"
  /** No platform attestation field is known yet. The current, honest state. */
  | "EVIDENCE_NOT_YET_OBSERVED"
  /** Attestation was present but describes a topology that cannot be singleton. */
  | "REJECTED_TOPOLOGY"
  /** Attestation was present but malformed, conflicting or user-controlled. */
  | "REJECTED_UNTRUSTWORTHY";

export const SINGLETON_BLOCKER = Object.freeze({
  NOT_YET_OBSERVED: "RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED",
  NOT_A_DEPLOYMENT: "RUNTIME_SINGLETON_NOT_A_DEPLOYMENT",
  MULTI_REPLICA: "RUNTIME_SINGLETON_MULTI_REPLICA_TOPOLOGY",
  SCALE_TO_ZERO: "RUNTIME_SINGLETON_SCALE_TO_ZERO_TOPOLOGY",
  TOPOLOGY_UNKNOWN: "RUNTIME_SINGLETON_TOPOLOGY_UNKNOWN",
  CONFLICTING_DEPLOYMENT_ID: "RUNTIME_SINGLETON_CONFLICTING_DEPLOYMENT_ID",
  UNRECOGNISED_FIELD: "RUNTIME_SINGLETON_UNRECOGNISED_ATTESTATION_FIELD",
  REPLICA_COUNT_NOT_ONE: "RUNTIME_SINGLETON_REPLICA_COUNT_NOT_ONE",
});

/**
 * Raw, caller-supplied attestation input. Passed in rather than read from
 * `process.env` here so the verifier stays pure and a test can present a
 * spoofed shape without mutating the real environment.
 */
export interface SingletonAttestationInput {
  /**
   * Candidate platform attestation fields, already narrowed to names the
   * caller believes are platform-provided. Values are NEVER echoed into
   * diagnostics — only key names are, and only after allowlisting.
   */
  readonly attestationFields: Readonly<Record<string, string | undefined>>;
  /** True when this process is running as a published deployment. */
  readonly isDeployment: boolean;
  /** `deploymentTarget` declared in `.replit`. Repository config, not runtime truth. */
  readonly declaredDeploymentTarget: string | null;
  /** Deployment id as reported by the platform, when available. */
  readonly observedDeploymentId: string | null;
  /** A second deployment id sighting, to detect a rescheduled/parallel instance. */
  readonly corroboratingDeploymentId: string | null;
  /** Replica/instance count when the platform exposes one. */
  readonly observedReplicaCount: number | null;
}

export interface SingletonAttestationVerdict {
  readonly state: SingletonAttestationState;
  readonly attested: boolean;
  readonly blockerCode: string | null;
  /** Allowlisted attestation KEY NAMES that were present. Never values. */
  readonly recognisedFields: readonly string[];
  /** Present-but-not-allowlisted key names, so drift is visible. */
  readonly unrecognisedFields: readonly string[];
  /** Repository-declared intent, recorded as context only. */
  readonly declaredDeploymentTarget: string | null;
  /** True when config declares a singleton target but nothing observed proves it. */
  readonly declaredSingletonButUnproven: boolean;
  readonly detailsSafeForOwnerDiagnostics: readonly string[];
}

function verdict(
  state: SingletonAttestationState,
  blockerCode: string | null,
  input: SingletonAttestationInput,
  recognised: readonly string[],
  unrecognised: readonly string[],
  details: readonly string[],
): SingletonAttestationVerdict {
  const target = input.declaredDeploymentTarget?.trim().toLowerCase() ?? null;
  return Object.freeze({
    state,
    attested: state === "ATTESTED_SINGLE_PROCESS",
    blockerCode,
    recognisedFields: Object.freeze([...recognised]),
    unrecognisedFields: Object.freeze([...unrecognised]),
    declaredDeploymentTarget: target,
    declaredSingletonButUnproven:
      target !== null && SINGLETON_TARGETS.has(target) && state !== "ATTESTED_SINGLE_PROCESS",
    detailsSafeForOwnerDiagnostics: Object.freeze([...details]),
  });
}

/**
 * Verify runtime singleton ownership from platform attestation.
 *
 * Order matters: topology disqualifiers are checked BEFORE the allowlist, so
 * an Autoscale deployment is reported as a topology rejection rather than as
 * "we have not observed the field names yet" — the latter would imply that
 * finding the right field could make Autoscale acceptable. It cannot.
 */
export function verifyRuntimeSingletonAttestation(
  input: SingletonAttestationInput,
): SingletonAttestationVerdict {
  const details: string[] = [];
  const target = input.declaredDeploymentTarget?.trim().toLowerCase() ?? null;

  const presentKeys = Object.keys(input.attestationFields)
    .filter((k) => input.attestationFields[k] !== undefined && input.attestationFields[k] !== "")
    .sort();
  const recognised = presentKeys.filter((k) => OBSERVED_PLATFORM_ATTESTATION_KEYS.includes(k));
  const unrecognised = presentKeys.filter((k) => !OBSERVED_PLATFORM_ATTESTATION_KEYS.includes(k));

  if (target !== null) details.push(`DECLARED_DEPLOYMENT_TARGET=${target}`);
  else details.push("NO_DECLARED_DEPLOYMENT_TARGET");

  // 1. A development workspace can run concurrently with a published
  //    deployment against the same API key. Being alone in the workspace is
  //    not being alone on the key.
  if (!input.isDeployment) {
    details.push("PROCESS_IS_NOT_A_PUBLISHED_DEPLOYMENT");
    details.push("DEVELOPMENT_WORKSPACE_MAY_RUN_CONCURRENTLY_WITH_DEPLOYMENT");
    return verdict("EVIDENCE_NOT_YET_OBSERVED", SINGLETON_BLOCKER.NOT_A_DEPLOYMENT, input, recognised, unrecognised, details);
  }

  // 2. Topology disqualifiers — no attestation field can rescue these.
  if (target !== null && NON_SINGLETON_TARGETS.has(target)) {
    const scaleToZeroOnly = target === "scheduled";
    details.push("PLATFORM_MAY_RUN_CONCURRENT_OR_SUSPENDED_INSTANCES");
    return verdict(
      "REJECTED_TOPOLOGY",
      scaleToZeroOnly ? SINGLETON_BLOCKER.SCALE_TO_ZERO : SINGLETON_BLOCKER.MULTI_REPLICA,
      input, recognised, unrecognised, details,
    );
  }
  if (target === null || !SINGLETON_TARGETS.has(target)) {
    details.push("DEPLOYMENT_TARGET_NOT_IN_KNOWN_SINGLETON_SET");
    return verdict("REJECTED_TOPOLOGY", SINGLETON_BLOCKER.TOPOLOGY_UNKNOWN, input, recognised, unrecognised, details);
  }

  // 3. An explicit replica count above one contradicts the target outright.
  if (input.observedReplicaCount !== null && input.observedReplicaCount !== 1) {
    details.push("OBSERVED_REPLICA_COUNT_IS_NOT_ONE");
    return verdict("REJECTED_TOPOLOGY", SINGLETON_BLOCKER.REPLICA_COUNT_NOT_ONE, input, recognised, unrecognised, details);
  }

  // 4. Two different deployment ids means a second instance is live or the
  //    instance was rescheduled mid-read. Either way, not a singleton.
  if (
    input.observedDeploymentId !== null &&
    input.corroboratingDeploymentId !== null &&
    input.observedDeploymentId !== input.corroboratingDeploymentId
  ) {
    details.push("DEPLOYMENT_ID_DISAGREED_BETWEEN_OBSERVATIONS");
    return verdict("REJECTED_UNTRUSTWORTHY", SINGLETON_BLOCKER.CONFLICTING_DEPLOYMENT_ID, input, recognised, unrecognised, details);
  }

  // 5. The allowlist. Empty today, so this is where every real Reserved VM
  //    run currently stops — by design, not by oversight.
  if (OBSERVED_PLATFORM_ATTESTATION_KEYS.length === 0) {
    details.push("PLATFORM_ATTESTATION_ALLOWLIST_IS_EMPTY");
    details.push("REQUIRES_OBSERVATION_FROM_A_REAL_RESERVED_VM_DEPLOYMENT");
    if (unrecognised.length > 0) details.push("UNRECOGNISED_CANDIDATE_FIELDS_PRESENT_BUT_NOT_TRUSTED");
    return verdict("EVIDENCE_NOT_YET_OBSERVED", SINGLETON_BLOCKER.NOT_YET_OBSERVED, input, recognised, unrecognised, details);
  }

  // 6. Every allowlisted field must actually be present.
  const missing = OBSERVED_PLATFORM_ATTESTATION_KEYS.filter((k) => !presentKeys.includes(k));
  if (missing.length > 0) {
    details.push("REQUIRED_ATTESTATION_FIELDS_ABSENT");
    return verdict("EVIDENCE_NOT_YET_OBSERVED", SINGLETON_BLOCKER.NOT_YET_OBSERVED, input, recognised, unrecognised, details);
  }

  details.push("PLATFORM_ATTESTATION_VERIFIED_SINGLE_PROCESS");
  return verdict("ATTESTED_SINGLE_PROCESS", null, input, recognised, unrecognised, details);
}

/**
 * Collect candidate attestation fields from an environment bag.
 *
 * Returns KEY NAMES mapped to values for the verifier's own use; callers must
 * never place the result into diagnostics. Only keys the platform itself sets
 * are considered — a user-defined secret with a convincing name is not
 * attestation, which is why the allowlist is compared by exact name.
 */
export function collectAttestationCandidates(
  env: NodeJS.ProcessEnv,
): Readonly<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  for (const key of OBSERVED_PLATFORM_ATTESTATION_KEYS) {
    if (env[key] !== undefined) out[key] = env[key];
  }
  return Object.freeze(out);
}
