/**
 * PHASE 0.8C — KITE SESSION EVIDENCE PORT (VALIDATOR + STORE, ZERO PROVIDER CALLS)
 *
 * This module decides whether a Kite session may be BELIEVED valid. It never
 * finds out. Contacting the provider is an activation-time act, and this phase
 * is forbidden from performing it, so the honest output here is
 * `KITE_SESSION_NOT_EVALUATED` — not an optimistic guess derived from the
 * presence of stored credentials.
 *
 * WHY CREDENTIALS ARE NOT EVIDENCE
 * --------------------------------
 * An access token string proves that a login happened at some point. It does
 * not prove the token still works: Kite tokens expire daily at a fixed time,
 * are invalidated by a re-login elsewhere, and can be revoked server-side
 * without any local signal. A token that "looks fine" and a token that was
 * revoked ten seconds ago are byte-identical locally. Treating presence as
 * validity is exactly the substitution this codebase forbids everywhere else.
 *
 * WHY A PORT AND NOT A PERMANENTLY-NULL GETTER
 * --------------------------------------------
 * A getter hardcoded to `null` blocks activation, but it blocks it for the
 * wrong reason: not "no valid session was proven" but "no session can ever be
 * proven". That is not a finished boundary, it is an absent one, and the
 * missing half would have to be designed under time pressure on the day
 * activation is actually wanted. So the acceptance path exists and is fully
 * specified HERE, while the thing that would call it — the provider validation
 * adapter — does not exist and is not called. The store is empty because
 * nothing has legitimately filled it, which is a fact about the world rather
 * than a property of the code.
 *
 * WHAT THIS MODULE MAY NOT DO
 * ---------------------------
 * No network call, no provider client, no socket, no database, no timer, no
 * filesystem. The store is in-process only and deliberately does NOT survive a
 * restart: a durable store would let a validation performed under one process
 * and one set of credentials speak for a later process that may have neither,
 * and making that safe is a separate authorized design.
 *
 * NOTHING IN THIS FILE MAY LOG, RETURN OR EMBED A CREDENTIAL. The record type
 * has no field capable of carrying one, and unknown fields are refused rather
 * than copied, so a caller cannot smuggle a token through in a stray property.
 */

/** Uppercase letters, digits and underscores only, bounded length. */
const SAFE_CODED_IDENTIFIER = /^[A-Z0-9_]{1,64}$/;

/**
 * The only port identity whose records may be believed.
 *
 * A record is not trustworthy because it is well-shaped — anything can be
 * well-shaped. It is trustworthy because the approved validation path produced
 * it. This constant is what "approved" means, and it is compile-time fixed so
 * no request body, environment variable or config file can widen it.
 */
export const APPROVED_KITE_VALIDATION_PORT_ID = "KITE_SESSION_VALIDATION_PORT_V1" as const;

/** The provider is fixed by the contract, not chosen per record. */
export const KITE_SESSION_EVIDENCE_PROVIDER = "KITE" as const;

export type KiteSessionEvidenceState =
  /** Provider confirmed the session and the confirmation has not expired. */
  | "VALID"
  /** Provider explicitly rejected the session. */
  | "INVALID"
  /** A previously valid confirmation exists but its validity boundary passed. */
  | "EXPIRED"
  /** No validation was performed. The correct state for this phase. */
  | "NOT_EVALUATED"
  /** Validation was attempted and the provider could not be reached. */
  | "PROVIDER_UNAVAILABLE";

/**
 * What the validation adapter reported. Distinct from the evidence state
 * above: `EXPIRED` here means the adapter itself judged the session expired,
 * whereas an evidence state of `EXPIRED` can also arise from a `VALID` record
 * whose validity boundary has since passed. Collapsing the two would lose the
 * difference between "the provider told us it was expired" and "we stopped
 * believing a confirmation that was true when it was made".
 */
export type KiteSessionRecordState = "VALID" | "INVALID" | "EXPIRED" | "PROVIDER_UNAVAILABLE";

const RECORD_STATES: readonly KiteSessionRecordState[] = Object.freeze([
  "VALID",
  "INVALID",
  "EXPIRED",
  "PROVIDER_UNAVAILABLE",
]);

export const KITE_SESSION_BLOCKER = Object.freeze({
  NOT_EVALUATED: "KITE_SESSION_NOT_EVALUATED",
  INVALID: "KITE_SESSION_INVALID",
  EXPIRED: "KITE_SESSION_EXPIRED",
  PROVIDER_UNAVAILABLE: "KITE_SESSION_PROVIDER_UNAVAILABLE",
  MALFORMED_RECORD: "KITE_SESSION_VALIDATION_RECORD_MALFORMED",
  FUTURE_DATED_RECORD: "KITE_SESSION_VALIDATION_RECORD_FUTURE_DATED",
  UNAPPROVED_SOURCE: "KITE_SESSION_VALIDATION_RECORD_UNAPPROVED_SOURCE",
  CREDENTIALS_ARE_NOT_VALIDATION: "KITE_SESSION_CREDENTIALS_PRESENT_BUT_UNVALIDATED",
});

/** Rejection codes returned by the acceptance path. Stable and distinct. */
export const KITE_SESSION_REJECTION = Object.freeze({
  MALFORMED: "KITE_SESSION_RECORD_MALFORMED",
  UNEXPECTED_FIELD: "KITE_SESSION_RECORD_UNEXPECTED_FIELD",
  UNAPPROVED_SOURCE: "KITE_SESSION_RECORD_UNAPPROVED_SOURCE",
  UNSAFE_VALIDATION_PATH_ID: "KITE_SESSION_RECORD_UNSAFE_VALIDATION_PATH_ID",
  FUTURE_DATED: "KITE_SESSION_RECORD_FUTURE_DATED",
  ALREADY_EXPIRED: "KITE_SESSION_RECORD_ALREADY_EXPIRED",
  NOT_NEWER_THAN_ACCEPTED: "KITE_SESSION_RECORD_NOT_NEWER_THAN_ACCEPTED",
});

/**
 * Proof of WHERE a record came from.
 *
 * `acceptedAtMs` is stamped by the port, never supplied by the caller: a
 * caller-supplied acceptance time would let the producer of a record also
 * describe how it was received, which is not provenance, it is assertion.
 */
export interface KiteSessionValidationProvenance {
  readonly producedByPortId: string;
  /** Coded identity of the validation adapter. Never a URL, host or payload. */
  readonly adapterId: string;
  /** Stamped by the port at acceptance. */
  readonly acceptedAtMs: number;
}

/**
 * A record produced by the approved provider-validation path.
 *
 * Note the absence of any token, api key, request token, cookie, user id or
 * raw-response field. This is deliberate: a type that cannot hold a credential
 * cannot leak one. An optional account fingerprint is NOT included — no
 * non-secret stable fingerprint is currently produced anywhere in this
 * codebase, and inventing one here would mean deriving it from credential
 * material, which is precisely what this boundary exists to prevent.
 */
export interface KiteSessionValidationRecord {
  readonly provider: typeof KITE_SESSION_EVIDENCE_PROVIDER;
  readonly recordState: KiteSessionRecordState;
  /** Epoch ms at which the PROVIDER confirmed the session. Not local login time. */
  readonly validatedAtMs: number;
  /** Epoch ms after which the confirmation no longer speaks for the present. */
  readonly validUntilMs: number;
  /** Non-sensitive identifier of the validation path that produced this record. */
  readonly validationPathId: string;
  readonly provenance: KiteSessionValidationProvenance;
}

/** What an adapter submits. `provenance.acceptedAtMs` is added by the port. */
export interface KiteSessionValidationCandidate {
  readonly provider: typeof KITE_SESSION_EVIDENCE_PROVIDER;
  readonly recordState: KiteSessionRecordState;
  readonly validatedAtMs: number;
  readonly validUntilMs: number;
  readonly validationPathId: string;
  readonly provenance: {
    readonly producedByPortId: string;
    readonly adapterId: string;
  };
}

export type KiteSessionAcceptResult =
  | { readonly accepted: true; readonly record: KiteSessionValidationRecord }
  | { readonly accepted: false; readonly rejectionCode: string };

// ── the store ────────────────────────────────────────────────────────────────
// Module-scope, in-process, non-durable. No timer keeps it alive and nothing
// reads or writes it at import time.

let acceptedRecord: KiteSessionValidationRecord | null = null;

const CANDIDATE_KEYS = Object.freeze([
  "provider",
  "recordState",
  "validatedAtMs",
  "validUntilMs",
  "validationPathId",
  "provenance",
]);
const PROVENANCE_KEYS = Object.freeze(["producedByPortId", "adapterId"]);

function isPositiveFinite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function hasExactlyKeys(o: object, allowed: readonly string[]): boolean {
  const keys = Object.keys(o);
  if (keys.length !== allowed.length) return false;
  return allowed.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

/**
 * Structural judgment of a candidate, independent of the store and the clock.
 * Returns null when the candidate is acceptable in shape.
 */
function judgeCandidateShape(candidate: unknown): string | null {
  if (typeof candidate !== "object" || candidate === null) return KITE_SESSION_REJECTION.MALFORMED;

  // Refuse unknown fields rather than ignoring them. Ignoring is not safe: an
  // ignored `accessToken` property would still be present on the object the
  // caller holds, and any future change that copies the record wholesale
  // instead of field-by-field would start carrying it.
  if (!hasExactlyKeys(candidate, CANDIDATE_KEYS)) return KITE_SESSION_REJECTION.UNEXPECTED_FIELD;

  const c = candidate as Record<string, unknown>;
  if (c["provider"] !== KITE_SESSION_EVIDENCE_PROVIDER) return KITE_SESSION_REJECTION.MALFORMED;
  if (!RECORD_STATES.includes(c["recordState"] as KiteSessionRecordState)) {
    return KITE_SESSION_REJECTION.MALFORMED;
  }
  if (!isPositiveFinite(c["validatedAtMs"])) return KITE_SESSION_REJECTION.MALFORMED;
  if (!isPositiveFinite(c["validUntilMs"])) return KITE_SESSION_REJECTION.MALFORMED;
  if ((c["validUntilMs"] as number) <= (c["validatedAtMs"] as number)) {
    return KITE_SESSION_REJECTION.MALFORMED;
  }
  if (typeof c["validationPathId"] !== "string") return KITE_SESSION_REJECTION.MALFORMED;
  // `validationPathId` is interpolated into owner-facing diagnostics, so it is
  // constrained to a coded identifier rather than accepted as free text. If a
  // future validation path ever derives this string from a provider response
  // or an environment value, this check is what stops that value being echoed
  // back out through the readiness endpoint.
  if (!SAFE_CODED_IDENTIFIER.test(c["validationPathId"])) {
    return KITE_SESSION_REJECTION.UNSAFE_VALIDATION_PATH_ID;
  }

  const prov = c["provenance"];
  if (typeof prov !== "object" || prov === null) return KITE_SESSION_REJECTION.MALFORMED;
  if (!hasExactlyKeys(prov, PROVENANCE_KEYS)) return KITE_SESSION_REJECTION.UNEXPECTED_FIELD;
  const p = prov as Record<string, unknown>;
  if (typeof p["adapterId"] !== "string" || !SAFE_CODED_IDENTIFIER.test(p["adapterId"])) {
    return KITE_SESSION_REJECTION.MALFORMED;
  }
  if (p["producedByPortId"] !== APPROVED_KITE_VALIDATION_PORT_ID) {
    return KITE_SESSION_REJECTION.UNAPPROVED_SOURCE;
  }
  return null;
}

/** Build the stored object field-by-field from primitives we have validated. */
function materialise(c: KiteSessionValidationCandidate, acceptedAtMs: number): KiteSessionValidationRecord {
  return Object.freeze({
    provider: KITE_SESSION_EVIDENCE_PROVIDER,
    recordState: c.recordState,
    validatedAtMs: c.validatedAtMs,
    validUntilMs: c.validUntilMs,
    validationPathId: c.validationPathId,
    provenance: Object.freeze({
      producedByPortId: APPROVED_KITE_VALIDATION_PORT_ID,
      adapterId: c.provenance.adapterId,
      acceptedAtMs,
    }),
  });
}

/**
 * Submit a validation record. THE ONLY WRITE PATH.
 *
 * No environment variable, config file or HTTP route may reach this: it is a
 * typed in-process function, and the readiness endpoint that reports the
 * resulting state is a GET with no body handling. A record can therefore only
 * appear if compiled code in this repository deliberately put it there.
 */
export function acceptKiteSessionValidationRecord(
  candidate: unknown,
  nowMs: number,
): KiteSessionAcceptResult {
  if (!isPositiveFinite(nowMs)) {
    return Object.freeze({ accepted: false as const, rejectionCode: KITE_SESSION_REJECTION.MALFORMED });
  }
  const shapeProblem = judgeCandidateShape(candidate);
  if (shapeProblem !== null) {
    return Object.freeze({ accepted: false as const, rejectionCode: shapeProblem });
  }
  const c = candidate as KiteSessionValidationCandidate;

  if (c.validatedAtMs > nowMs) {
    return Object.freeze({ accepted: false as const, rejectionCode: KITE_SESSION_REJECTION.FUTURE_DATED });
  }
  if (nowMs >= c.validUntilMs) {
    return Object.freeze({ accepted: false as const, rejectionCode: KITE_SESSION_REJECTION.ALREADY_EXPIRED });
  }

  // An older record must not silently displace a newer one. Out-of-order
  // arrival is the normal case for concurrent validations, and the later-
  // completing call is not necessarily the more recent observation. Equal
  // timestamps are refused too: two different records claiming the same
  // validation instant cannot both be right, and picking one is a guess.
  // Replacing a newer record with an older one requires explicit invalidation,
  // which is a deliberate act rather than a race outcome.
  if (acceptedRecord !== null && c.validatedAtMs <= acceptedRecord.validatedAtMs) {
    return Object.freeze({
      accepted: false as const,
      rejectionCode: KITE_SESSION_REJECTION.NOT_NEWER_THAN_ACCEPTED,
    });
  }

  acceptedRecord = materialise(c, nowMs);
  return Object.freeze({ accepted: true as const, record: acceptedRecord });
}

/**
 * Explicitly drop the accepted record. The only way to clear or to make room
 * for a record that is not strictly newer.
 */
export function invalidateAcceptedKiteSessionValidationRecord(): void {
  acceptedRecord = null;
}

/**
 * The production accessor for the validation record.
 *
 * Returns a fresh frozen copy so a caller that retains the result cannot
 * mutate stored evidence, and a caller that mutates its own copy cannot affect
 * the next reader.
 *
 * In this phase it returns null in practice, because no approved adapter
 * exists to submit anything — the emptiness is a fact about the deployment,
 * not a hardcoded refusal.
 */
export function getAcceptedKiteSessionValidationRecord(): KiteSessionValidationRecord | null {
  if (acceptedRecord === null) return null;
  return materialise(
    {
      provider: acceptedRecord.provider,
      recordState: acceptedRecord.recordState,
      validatedAtMs: acceptedRecord.validatedAtMs,
      validUntilMs: acceptedRecord.validUntilMs,
      validationPathId: acceptedRecord.validationPathId,
      provenance: {
        producedByPortId: acceptedRecord.provenance.producedByPortId,
        adapterId: acceptedRecord.provenance.adapterId,
      },
    },
    acceptedRecord.provenance.acceptedAtMs,
  );
}

/**
 * TEST-ONLY store reset. Must have zero production callers; a test asserts it.
 * Named so that a production call site is obvious in review.
 */
export function __resetKiteSessionEvidenceStoreForTests(): void {
  acceptedRecord = null;
}

// ── the judge ────────────────────────────────────────────────────────────────

export interface KiteSessionEvidenceInput {
  /**
   * The approved validation record, when one exists. Null when no provider
   * validation has ever been recorded — which is the current reality.
   */
  readonly validationRecord: KiteSessionValidationRecord | null;
  /**
   * Whether Kite credentials are configured. Recorded ONLY so diagnostics can
   * state plainly that credentials exist and are nonetheless not evidence.
   * Never influences the verdict toward VALID.
   */
  readonly credentialsConfigured: boolean;
  readonly nowMs: number;
}

export interface KiteSessionEvidenceVerdict {
  readonly state: KiteSessionEvidenceState;
  readonly valid: boolean;
  readonly blockerCode: string | null;
  /** Epoch ms the provider confirmed, when a record exists. */
  readonly validatedAtMs: number | null;
  /** Validity boundary, when a record exists. */
  readonly validUntilMs: number | null;
  readonly detailsSafeForOwnerDiagnostics: readonly string[];
}

function verdict(
  state: KiteSessionEvidenceState,
  blockerCode: string | null,
  validatedAtMs: number | null,
  validUntilMs: number | null,
  details: readonly string[],
): KiteSessionEvidenceVerdict {
  return Object.freeze({
    state,
    valid: state === "VALID",
    blockerCode,
    validatedAtMs,
    validUntilMs,
    detailsSafeForOwnerDiagnostics: Object.freeze([...details]),
  });
}

/**
 * Judge Kite session evidence. Performs NO network call, constructs no client
 * and reads no credential value.
 *
 * Re-judges structure, provenance AND expiry every time rather than trusting
 * that acceptance already checked them. Acceptance happened at some earlier
 * instant; only this call knows what time it is now, and a record that was
 * admissible when stored can be expired by the time the feed boundary asks.
 */
export function evaluateKiteSessionEvidence(
  input: KiteSessionEvidenceInput,
): KiteSessionEvidenceVerdict {
  const details: string[] = [];
  const { validationRecord: rec, nowMs } = input;

  if (input.credentialsConfigured) {
    details.push("KITE_CREDENTIALS_CONFIGURED");
    details.push("CREDENTIAL_PRESENCE_IS_NOT_SESSION_VALIDITY");
  } else {
    details.push("KITE_CREDENTIALS_NOT_CONFIGURED");
  }

  if (!isPositiveFinite(nowMs)) {
    details.push("EVALUATION_CLOCK_UNUSABLE");
    return verdict("NOT_EVALUATED", KITE_SESSION_BLOCKER.MALFORMED_RECORD, null, null, details);
  }

  if (rec === null) {
    details.push("NO_PROVIDER_VALIDATION_RECORD_EXISTS");
    details.push("PHASE_0_8C_PERFORMS_NO_PROVIDER_CALL");
    return verdict(
      "NOT_EVALUATED",
      // Credentials being present is reported with its own code so the owner
      // sees "configured but unproven" rather than "nothing here", but it is
      // still NOT_EVALUATED and still not PASS.
      input.credentialsConfigured
        ? KITE_SESSION_BLOCKER.CREDENTIALS_ARE_NOT_VALIDATION
        : KITE_SESSION_BLOCKER.NOT_EVALUATED,
      null,
      null,
      details,
    );
  }

  // Re-derive the candidate shape from the stored record. A record that no
  // longer satisfies the contract — because the contract tightened, or because
  // it was constructed by something other than the port — is not believed.
  const shapeProblem = judgeCandidateShape({
    provider: rec.provider,
    recordState: rec.recordState,
    validatedAtMs: rec.validatedAtMs,
    validUntilMs: rec.validUntilMs,
    validationPathId: rec.validationPathId,
    provenance: {
      producedByPortId: rec.provenance?.producedByPortId,
      adapterId: rec.provenance?.adapterId,
    },
  });
  if (shapeProblem === KITE_SESSION_REJECTION.UNAPPROVED_SOURCE) {
    details.push("VALIDATION_RECORD_NOT_FROM_APPROVED_PORT");
    return verdict("NOT_EVALUATED", KITE_SESSION_BLOCKER.UNAPPROVED_SOURCE, null, null, details);
  }
  if (shapeProblem !== null) {
    details.push("VALIDATION_RECORD_FAILED_STRUCTURAL_CHECKS");
    return verdict("NOT_EVALUATED", KITE_SESSION_BLOCKER.MALFORMED_RECORD, null, null, details);
  }
  if (!isPositiveFinite(rec.provenance.acceptedAtMs)) {
    details.push("VALIDATION_RECORD_PROVENANCE_INCOMPLETE");
    return verdict("NOT_EVALUATED", KITE_SESSION_BLOCKER.MALFORMED_RECORD, null, null, details);
  }

  details.push(`VALIDATION_PATH=${rec.validationPathId}`);
  details.push(`VALIDATION_ADAPTER=${rec.provenance.adapterId}`);

  if (rec.recordState === "INVALID") {
    details.push("PROVIDER_REJECTED_THE_SESSION");
    return verdict("INVALID", KITE_SESSION_BLOCKER.INVALID, rec.validatedAtMs, rec.validUntilMs, details);
  }
  if (rec.recordState === "PROVIDER_UNAVAILABLE") {
    details.push("PROVIDER_COULD_NOT_BE_REACHED_DURING_VALIDATION");
    return verdict(
      "PROVIDER_UNAVAILABLE",
      KITE_SESSION_BLOCKER.PROVIDER_UNAVAILABLE,
      rec.validatedAtMs,
      rec.validUntilMs,
      details,
    );
  }
  if (rec.recordState === "EXPIRED") {
    details.push("ADAPTER_REPORTED_THE_SESSION_ALREADY_EXPIRED");
    return verdict("EXPIRED", KITE_SESSION_BLOCKER.EXPIRED, rec.validatedAtMs, rec.validUntilMs, details);
  }

  // recordState === "VALID" from here.

  // A confirmation stamped in the future cannot be reasoned about.
  if (rec.validatedAtMs > nowMs) {
    details.push("VALIDATION_RECORD_CONFIRMED_IN_THE_FUTURE");
    return verdict(
      "NOT_EVALUATED",
      KITE_SESSION_BLOCKER.FUTURE_DATED_RECORD,
      rec.validatedAtMs,
      rec.validUntilMs,
      details,
    );
  }

  // THE BOUNDARY EXPIRY CHECK. Evaluated against the caller's `nowMs`, which at
  // the activation boundary is the boundary instant — so a record that was
  // valid when a snapshot was taken cannot still read PASS when it is used.
  if (nowMs >= rec.validUntilMs) {
    details.push("PROVIDER_CONFIRMATION_VALIDITY_BOUNDARY_PASSED");
    return verdict("EXPIRED", KITE_SESSION_BLOCKER.EXPIRED, rec.validatedAtMs, rec.validUntilMs, details);
  }

  details.push("PROVIDER_CONFIRMED_AND_STILL_WITHIN_VALIDITY_BOUNDARY");
  return verdict("VALID", null, rec.validatedAtMs, rec.validUntilMs, details);
}
