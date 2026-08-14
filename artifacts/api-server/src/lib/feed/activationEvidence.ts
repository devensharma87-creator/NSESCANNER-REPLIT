/**
 * PHASE 0.8C — THE TYPED ACTIVATION EVIDENCE ENVELOPE
 *
 * One provider-neutral shape for every activation gate evaluation, so that a
 * gate can never be reduced to a bare boolean on its way to the side-effect
 * boundary.
 *
 * WHY AN ENVELOPE AND NOT A BOOLEAN
 * ---------------------------------
 * A boolean answers "did it pass?" but not the three questions that decide
 * whether the answer may still be believed at the instant of the side effect:
 *   - WHEN was it evaluated?           (`evaluatedAt`)
 *   - HOW LONG does it speak for?      (`validUntil`)
 *   - WHAT generation is it about?     (`sourceIdentity`)
 * Without those, a verdict computed for a different registry generation, or
 * one that expired ten minutes ago, is indistinguishable from a fresh PASS.
 *
 * `validUntil === null` is NOT "never expires by accident". It is an explicit
 * claim that no time-based authority can exist for this gate — true for a
 * compile-time constant, false for anything sourced from an exchange calendar
 * or a provider session. Every field is REQUIRED: an omitted field is a
 * producer that did not decide, and a boundary cannot distinguish "did not
 * decide" from "decided yes" unless the type forbids the former.
 *
 * WHY THIS MODULE OWNS THE GATE IDS
 * ---------------------------------
 * `feedManager.ts` imports its gate contract FROM here rather than the other
 * way round, so exactly one implementation judges evidence. An earlier
 * revision had the manager re-implement these rules inline; the two copies
 * disagreed about omitted fields and non-finite timestamps, and the copy that
 * actually guarded the socket was the weaker one. A duplicated safety rule is
 * a safety rule with a silent exception.
 *
 * NO NEW FRESHNESS THRESHOLDS
 * ---------------------------
 * This module invents no expiry policy. Each evidence producer supplies the
 * `validUntil` its own owner-approved policy already computes (the registry
 * calendar/BSE authority boundary being the canonical example). Where no such
 * policy exists, the producer must fail closed with a stable blocker rather
 * than pick a number.
 */

/**
 * Stable identifiers for every gate the manager must see PASS before creating
 * a single socket. These are checked by the manager itself — never trusted
 * from a caller-supplied summary boolean.
 */
export type FeedActivationGateId =
  | "REGISTRY_RESTORATION_SETTLED"
  | "REGISTRY_AUTHORITY_CURRENT"
  | "REGISTRY_SCHEMA_AND_POLICY_SUPPORTED"
  | "SUBSCRIPTION_MANIFEST_ACCEPTED"
  | "REGISTRY_GENERATION_ID_PRESENT"
  | "SUBSCRIPTION_SET_HASH_PRESENT"
  | "COMPLETE_MANIFEST_HASH_PRESENT"
  | "SHARD_POLICY_VERSION_SUPPORTED"
  | "SHARD_PLAN_CAPACITY_ADMITTED"
  | "FEED_OWNERSHIP_SINGLETON_ATTESTED"
  | "SHUTDOWN_LIFECYCLE_INSTALLED"
  | "KITE_SESSION_VALID"
  | "TOKEN_RECONCILIATION_CLEAR"
  | "OWNER_ACTIVATION_AUTHORIZATION"
  | "COMPILE_TIME_FEED_LOCK";

/**
 * Every gate the manager requires. A gate missing from the supplied array is
 * treated as NOT_EVALUATED (same as FAIL — never counts as passing).
 *
 * ORDERING IS THE PHASE 0.8C BOUNDARY CONTRACT, not cosmetic. Cheapest and
 * most absolute refusals come first so the FIRST reported blocker is the most
 * fundamental one:
 *   1. compile-time lock          2. owner authorization
 *   3. registry/manifest/hash     4. current authority
 *   5. runtime singleton          6. shutdown readiness
 *   7. token reconciliation       8. Kite session
 *   9. shard/capacity re-proof
 *
 * IMPORTANT: this order does NOT gate evaluation — every gate in the set is
 * evaluated and ALL failures are collected before the boundary returns, so no
 * gate can be skipped by an earlier one passing. The plan re-proof
 * (`admitShardPlan`) runs after the entire set, and the client factory after
 * that. Treating the array order as an evaluation-order security control would
 * be a misreading; it orders REPORTING.
 */
export const REQUIRED_ACTIVATION_GATE_IDS: readonly FeedActivationGateId[] = [
  // 1. compile-time lock
  "COMPILE_TIME_FEED_LOCK",
  // 2. owner authorization
  "OWNER_ACTIVATION_AUTHORIZATION",
  // 3. registry / manifest / generation / hash consistency
  "REGISTRY_GENERATION_ID_PRESENT",
  "SUBSCRIPTION_SET_HASH_PRESENT",
  "COMPLETE_MANIFEST_HASH_PRESENT",
  "REGISTRY_SCHEMA_AND_POLICY_SUPPORTED",
  "SUBSCRIPTION_MANIFEST_ACCEPTED",
  "SHARD_POLICY_VERSION_SUPPORTED",
  // 4. current authority
  "REGISTRY_RESTORATION_SETTLED",
  "REGISTRY_AUTHORITY_CURRENT",
  // 5. runtime singleton attestation
  "FEED_OWNERSHIP_SINGLETON_ATTESTED",
  // 6. shutdown readiness
  "SHUTDOWN_LIFECYCLE_INSTALLED",
  // 7. token reconciliation clearance
  "TOKEN_RECONCILIATION_CLEAR",
  // 8. Kite session validity
  "KITE_SESSION_VALID",
  // 9. deterministic shard / capacity re-proof
  "SHARD_PLAN_CAPACITY_ADMITTED",
] as const;

/**
 * Where a piece of evidence came from. Deliberately coarse: this is for owner
 * diagnostics, not for dispatch, and a fine-grained taxonomy would tempt
 * consumers into branching on the source instead of on the state.
 */
export type EvidenceSourceKind =
  /** A `const` in the shipped build. Cannot expire; changing it is a code change. */
  | "COMPILE_TIME_CONSTANT"
  /** Live state of this OS process (e.g. installed signal listeners). */
  | "PROCESS_RUNTIME_STATE"
  /** A committed, integrity-verified registry generation. */
  | "REGISTRY_GENERATION"
  /** The deterministic shard plan derived from a subscription manifest. */
  | "SHARD_PLAN"
  /** The subscription admission manifest. */
  | "SUBSCRIPTION_MANIFEST"
  /** In-memory reconciliation bookkeeping for provider-token rebinds. */
  | "TOKEN_RECONCILIATION_STATE"
  /** Platform-supplied deployment attestation. Never user-controlled. */
  | "PLATFORM_ATTESTATION"
  /** A recorded provider-session validation result. Never a credential. */
  | "PROVIDER_SESSION_VALIDATION"
  /** An explicit owner runtime authorization record. */
  | "OWNER_AUTHORIZATION";

/** Every source kind that is legal in an envelope. */
export const EVIDENCE_SOURCE_KINDS: ReadonlySet<string> = new Set<EvidenceSourceKind>([
  "COMPILE_TIME_CONSTANT",
  "PROCESS_RUNTIME_STATE",
  "REGISTRY_GENERATION",
  "SHARD_PLAN",
  "SUBSCRIPTION_MANIFEST",
  "TOKEN_RECONCILIATION_STATE",
  "PLATFORM_ATTESTATION",
  "PROVIDER_SESSION_VALIDATION",
  "OWNER_AUTHORIZATION",
]);

/**
 * Source kinds whose `sourceIdentity` MUST carry a registry generation id.
 * For these, a null identity is malformed rather than "not applicable" —
 * otherwise omitting the identity would silently skip the cross-generation
 * check, which is the exact bypass the check exists to close.
 */
export const GENERATION_SCOPED_SOURCE_KINDS: ReadonlySet<string> = new Set<EvidenceSourceKind>([
  "REGISTRY_GENERATION",
  "SUBSCRIPTION_MANIFEST",
  "SHARD_PLAN",
  "TOKEN_RECONCILIATION_STATE",
]);

/**
 * The ONE source kind each gate is permitted to come from.
 *
 * Without this, `GENERATION_SCOPED_SOURCE_KINDS` is decorative: a producer
 * could label `REGISTRY_AUTHORITY_CURRENT` as a `COMPILE_TIME_CONSTANT` with a
 * null identity, and the cross-generation check would simply not apply. The
 * gate would then pass on evidence from any generation at all. Binding gate
 * identity to source kind is what makes the generation check unavoidable —
 * ten of these fifteen gates resolve to a generation-scoped kind and therefore
 * MUST carry the activating generation's identity.
 *
 * Exactly one permitted kind per gate, deliberately: a list of alternatives is
 * a place for a future bypass to hide.
 */
export const ALLOWED_SOURCE_KIND_BY_GATE: Readonly<
  Record<FeedActivationGateId, EvidenceSourceKind>
> = Object.freeze({
  COMPILE_TIME_FEED_LOCK: "COMPILE_TIME_CONSTANT",
  OWNER_ACTIVATION_AUTHORIZATION: "OWNER_AUTHORIZATION",
  REGISTRY_GENERATION_ID_PRESENT: "REGISTRY_GENERATION",
  SUBSCRIPTION_SET_HASH_PRESENT: "SUBSCRIPTION_MANIFEST",
  COMPLETE_MANIFEST_HASH_PRESENT: "SHARD_PLAN",
  REGISTRY_SCHEMA_AND_POLICY_SUPPORTED: "SUBSCRIPTION_MANIFEST",
  SUBSCRIPTION_MANIFEST_ACCEPTED: "SUBSCRIPTION_MANIFEST",
  SHARD_POLICY_VERSION_SUPPORTED: "SHARD_PLAN",
  REGISTRY_RESTORATION_SETTLED: "REGISTRY_GENERATION",
  REGISTRY_AUTHORITY_CURRENT: "REGISTRY_GENERATION",
  FEED_OWNERSHIP_SINGLETON_ATTESTED: "PLATFORM_ATTESTATION",
  SHUTDOWN_LIFECYCLE_INSTALLED: "PROCESS_RUNTIME_STATE",
  TOKEN_RECONCILIATION_CLEAR: "TOKEN_RECONCILIATION_STATE",
  KITE_SESSION_VALID: "PROVIDER_SESSION_VALIDATION",
  SHARD_PLAN_CAPACITY_ADMITTED: "SHARD_PLAN",
} as const);

export type EvidenceState = "PASS" | "FAIL" | "NOT_EVALUATED";

/**
 * One gate's evaluation, complete enough to be re-judged later by a consumer
 * that did not perform it. EVERY field is required.
 */
export interface ActivationEvidence {
  readonly gateId: FeedActivationGateId;
  readonly state: EvidenceState;
  /** Stable, machine-readable. Never a free-text sentence, never interpolated. */
  readonly reasonCode: string;
  /** Epoch ms at which this evaluation was performed. Must be finite and > 0. */
  readonly evaluatedAt: number;
  /**
   * Epoch ms after which this evidence no longer speaks for the present, or
   * explicit `null` when no time-based authority can exist for this gate.
   * `undefined` is NOT permitted — see the module header.
   */
  readonly validUntil: number | null;
  readonly sourceKind: EvidenceSourceKind;
  /**
   * Generation id / plan hash / attestation id this evidence is about, so a
   * consumer can refuse to combine evidence across generations. Null is legal
   * ONLY for source kinds that are not generation-scoped.
   */
  readonly sourceIdentity: string | null;
  /**
   * Owner-diagnostic detail. MUST NOT contain credentials, tokens, raw provider
   * payloads, environment values or instrument lists.
   */
  readonly detailsSafeForOwnerDiagnostics: readonly string[];
  /** Optional legacy alias for `reasonCode`, retained for existing consumers. */
  readonly blockerCode?: string;
}

/** Stable blocker codes emitted by the envelope validator itself. */
export const EVIDENCE_BLOCKER = Object.freeze({
  MISSING: "ACTIVATION_EVIDENCE_MISSING",
  MALFORMED: "ACTIVATION_EVIDENCE_MALFORMED",
  EXPIRED: "ACTIVATION_EVIDENCE_EXPIRED",
  NOT_YET_VALID: "ACTIVATION_EVIDENCE_EVALUATED_IN_FUTURE",
  CONTRADICTORY: "ACTIVATION_EVIDENCE_CONTRADICTORY",
  DUPLICATE: "ACTIVATION_EVIDENCE_DUPLICATE_ENTRY",
  FOREIGN_GENERATION: "ACTIVATION_EVIDENCE_FOREIGN_GENERATION",
  IDENTITY_MISSING: "ACTIVATION_EVIDENCE_GENERATION_IDENTITY_MISSING",
  SOURCE_KIND_NOT_PERMITTED: "ACTIVATION_EVIDENCE_SOURCE_KIND_NOT_PERMITTED_FOR_GATE",
  BAD_CLOCK: "ACTIVATION_EVIDENCE_EVALUATION_CLOCK_INVALID",
  NOT_EVALUATED: "ACTIVATION_EVIDENCE_NOT_EVALUATED",
  FAILED: "ACTIVATION_EVIDENCE_FAILED",
});

/**
 * Build an envelope. Kept as a function so every producer gets the same shape
 * and no call site can forget a field.
 */
export function evidence(input: {
  readonly gateId: FeedActivationGateId;
  readonly state: EvidenceState;
  readonly reasonCode: string;
  readonly evaluatedAt: number;
  readonly validUntil: number | null;
  readonly sourceKind: EvidenceSourceKind;
  readonly sourceIdentity?: string | null;
  readonly details?: readonly string[];
}): ActivationEvidence {
  return Object.freeze({
    gateId: input.gateId,
    state: input.state,
    reasonCode: input.reasonCode,
    // `blockerCode` mirrors the reason for non-PASS gates so existing
    // consumers that read it keep working.
    blockerCode: input.state === "PASS" ? undefined : input.reasonCode,
    evaluatedAt: input.evaluatedAt,
    validUntil: input.validUntil,
    sourceKind: input.sourceKind,
    sourceIdentity: input.sourceIdentity ?? null,
    detailsSafeForOwnerDiagnostics: Object.freeze([...(input.details ?? [])]),
  });
}

/**
 * Is this object structurally a usable envelope?
 *
 * Strict on purpose. `undefined` for any field, a non-finite timestamp, an
 * unknown source kind, or a generation-scoped source without an identity are
 * all malformed — each one would otherwise slip past a later check.
 */
export function isWellFormedEvidence(e: unknown): e is ActivationEvidence {
  if (e === null || typeof e !== "object") return false;
  const v = e as Partial<ActivationEvidence>;
  if (typeof v.gateId !== "string" || v.gateId.length === 0) return false;
  if (v.state !== "PASS" && v.state !== "FAIL" && v.state !== "NOT_EVALUATED") return false;
  if (typeof v.reasonCode !== "string" || v.reasonCode.length === 0) return false;
  if (typeof v.evaluatedAt !== "number" || !Number.isFinite(v.evaluatedAt) || v.evaluatedAt <= 0) {
    return false;
  }
  // `undefined` is rejected here — only a number or an explicit null.
  if (v.validUntil === undefined) return false;
  if (v.validUntil !== null && (typeof v.validUntil !== "number" || !Number.isFinite(v.validUntil))) {
    return false;
  }
  if (typeof v.sourceKind !== "string" || !EVIDENCE_SOURCE_KINDS.has(v.sourceKind)) return false;
  if (v.sourceIdentity !== null && typeof v.sourceIdentity !== "string") return false;
  // A generation-scoped source with no identity cannot be cross-checked.
  if (GENERATION_SCOPED_SOURCE_KINDS.has(v.sourceKind) && v.sourceIdentity === null) return false;
  if (!Array.isArray(v.detailsSafeForOwnerDiagnostics)) return false;
  return true;
}

export type EvidenceVerdict =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly blockerCode: string };

/**
 * Judge ONE envelope at a specific instant, for a specific generation.
 *
 * This is the whole point of the phase: the evaluation that produced the
 * evidence happened earlier, and this function decides whether it may still
 * be acted upon NOW.
 */
export function judgeEvidence(
  e: ActivationEvidence | undefined,
  nowMs: number,
  expectedGenerationId: string | null,
): EvidenceVerdict {
  // A boundary that cannot read its own clock must refuse; every temporal
  // comparison below would otherwise silently evaluate to false.
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs) || nowMs <= 0) {
    return { admitted: false, blockerCode: EVIDENCE_BLOCKER.BAD_CLOCK };
  }
  if (e === undefined) return { admitted: false, blockerCode: EVIDENCE_BLOCKER.MISSING };
  if (!isWellFormedEvidence(e)) return { admitted: false, blockerCode: EVIDENCE_BLOCKER.MALFORMED };

  // Evidence stamped in the future is not "very fresh" — it is a clock or a
  // fabrication problem, and either way it cannot be reasoned about.
  if (e.evaluatedAt > nowMs) {
    return { admitted: false, blockerCode: EVIDENCE_BLOCKER.NOT_YET_VALID };
  }

  // Expiry is checked BEFORE state, so an expired PASS is never reported as a
  // pass-with-a-caveat. It is simply not evidence any more.
  if (e.validUntil !== null && nowMs >= e.validUntil) {
    return { admitted: false, blockerCode: EVIDENCE_BLOCKER.EXPIRED };
  }

  // A gate may only be satisfied by the source it is actually derived from.
  // Checked BEFORE the generation binding below, because mislabelling the
  // source kind is precisely how that binding would be evaded.
  if (ALLOWED_SOURCE_KIND_BY_GATE[e.gateId] !== e.sourceKind) {
    return { admitted: false, blockerCode: EVIDENCE_BLOCKER.SOURCE_KIND_NOT_PERMITTED };
  }

  // Evidence about generation A may not authorise action on generation B, even
  // when both say PASS.
  if (GENERATION_SCOPED_SOURCE_KINDS.has(e.sourceKind)) {
    if (e.sourceIdentity === null) {
      return { admitted: false, blockerCode: EVIDENCE_BLOCKER.IDENTITY_MISSING };
    }
    if (expectedGenerationId === null) {
      return { admitted: false, blockerCode: EVIDENCE_BLOCKER.IDENTITY_MISSING };
    }
    if (e.sourceIdentity !== expectedGenerationId) {
      return { admitted: false, blockerCode: EVIDENCE_BLOCKER.FOREIGN_GENERATION };
    }
  }

  if (e.state === "NOT_EVALUATED") {
    return { admitted: false, blockerCode: e.reasonCode || EVIDENCE_BLOCKER.NOT_EVALUATED };
  }
  if (e.state !== "PASS") {
    return { admitted: false, blockerCode: e.reasonCode || EVIDENCE_BLOCKER.FAILED };
  }
  return { admitted: true };
}

export interface EvidenceIndexResult {
  /** True only when every entry was well-formed and unique. */
  readonly ok: boolean;
  /** Well-formed, unique entries. Populated even when `ok` is false. */
  readonly byGate: ReadonlyMap<string, ActivationEvidence>;
  /** Every structural problem found, as `GATE_ID:REASON`. Never truncated. */
  readonly problems: readonly string[];
}

/**
 * Index an evidence array by gateId, refusing ANY duplicate.
 *
 * An earlier revision tried to merge agreeing duplicates by narrowing the
 * expiry. That was subtly wrong: two entries can agree on `state` while
 * disagreeing on generation, source kind or evaluation time, and merging on
 * state alone let the FIRST entry's binding win while a second, foreign-
 * generation entry was silently discarded. There is no legitimate reason for
 * one producer set to emit a gate twice, so the safe rule is the simple one —
 * a duplicate is a refusal, not a merge problem.
 */
export function indexEvidence(list: readonly ActivationEvidence[]): EvidenceIndexResult {
  const byGate = new Map<string, ActivationEvidence>();
  const problems: string[] = [];
  for (const e of list) {
    const gateId = String((e as { gateId?: string })?.gateId ?? "UNKNOWN");
    if (!isWellFormedEvidence(e)) {
      problems.push(`${gateId}:${EVIDENCE_BLOCKER.MALFORMED}`);
      continue;
    }
    const prior = byGate.get(e.gateId);
    if (prior !== undefined) {
      // Distinguish "said two different things" from "said the same thing
      // twice": the first is a producer conflict, the second a wiring bug.
      problems.push(
        `${e.gateId}:${
          prior.state === e.state ? EVIDENCE_BLOCKER.DUPLICATE : EVIDENCE_BLOCKER.CONTRADICTORY
        }`,
      );
      // The duplicate is NOT merged and NOT allowed to replace the first
      // entry. Whichever way a merge resolved, it would let a second producer
      // influence a verdict the first already gave.
      continue;
    }
    byGate.set(e.gateId, e);
  }
  return { ok: problems.length === 0, byGate, problems };
}

export type AggregateEvidenceVerdict =
  | { readonly admitted: true }
  | {
      readonly admitted: false;
      /** Stable, in REQUIRED_ACTIVATION_GATE_IDS order. */
      readonly blockingCodes: readonly string[];
      /** True when the whole set was rejected structurally, not gate-by-gate. */
      readonly structural: boolean;
    };

/**
 * Judge the COMPLETE required gate set at one instant.
 *
 * This is the single function that guards the side effect. Every gate in
 * `REQUIRED_ACTIVATION_GATE_IDS` is judged and all failures are collected —
 * an earlier gate passing never causes a later one to be skipped.
 */
export function judgeAllRequiredEvidence(
  list: readonly ActivationEvidence[],
  nowMs: number,
  expectedGenerationId: string | null,
): AggregateEvidenceVerdict {
  const indexed = indexEvidence(list);

  // Every required gate is judged even when the input was structurally bad, so
  // an operator sees the COMPLETE refusal list rather than only the first
  // problem. Reporting one blocker at a time turns diagnosis into a queue of
  // round trips, and each round trip is a chance to conclude the boundary is
  // flaky rather than that it is refusing for several independent reasons.
  const blockingCodes: string[] = [...indexed.problems];
  for (const id of REQUIRED_ACTIVATION_GATE_IDS) {
    const verdict = judgeEvidence(indexed.byGate.get(id), nowMs, expectedGenerationId);
    if (!verdict.admitted) blockingCodes.push(`${id}:${verdict.blockerCode}`);
  }
  if (blockingCodes.length > 0) {
    return { admitted: false, blockingCodes, structural: !indexed.ok };
  }
  return { admitted: true };
}
