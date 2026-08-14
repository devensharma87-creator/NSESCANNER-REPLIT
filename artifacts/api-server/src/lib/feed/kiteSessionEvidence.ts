/**
 * PHASE 0.8C — KITE SESSION EVIDENCE BOUNDARY (VALIDATOR ONLY, ZERO PROVIDER CALLS)
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
 * WHAT WOULD COUNT
 * ----------------
 * A record produced by the approved session-validation path, carrying the
 * instant the PROVIDER confirmed the session and an explicit validity
 * boundary. That record can be re-judged later. Presence cannot.
 *
 * NOTHING IN THIS FILE MAY LOG, RETURN OR EMBED A CREDENTIAL. The evidence
 * type deliberately has no field capable of carrying one.
 */

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

export const KITE_SESSION_BLOCKER = Object.freeze({
  NOT_EVALUATED: "KITE_SESSION_NOT_EVALUATED",
  INVALID: "KITE_SESSION_INVALID",
  EXPIRED: "KITE_SESSION_EXPIRED",
  PROVIDER_UNAVAILABLE: "KITE_SESSION_PROVIDER_UNAVAILABLE",
  MALFORMED_RECORD: "KITE_SESSION_VALIDATION_RECORD_MALFORMED",
  CREDENTIALS_ARE_NOT_VALIDATION: "KITE_SESSION_CREDENTIALS_PRESENT_BUT_UNVALIDATED",
});

/**
 * A record produced by the approved provider-validation path.
 *
 * Note the absence of any token, api key or user id field. This is deliberate:
 * a type that cannot hold a credential cannot leak one.
 */
export interface KiteSessionValidationRecord {
  /** Epoch ms at which the PROVIDER confirmed the session. Not local login time. */
  readonly providerConfirmedAtMs: number;
  /** Epoch ms after which the confirmation no longer speaks for the present. */
  readonly validUntilMs: number;
  /** Outcome the provider reported. */
  readonly providerOutcome: "CONFIRMED" | "REJECTED";
  /** Non-sensitive identifier of the validation path that produced this record. */
  readonly validationPathId: string;
}

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
  readonly providerConfirmedAtMs: number | null;
  /** Validity boundary, when a record exists. */
  readonly validUntilMs: number | null;
  readonly detailsSafeForOwnerDiagnostics: readonly string[];
}

function isRecordWellFormed(r: KiteSessionValidationRecord): boolean {
  if (typeof r.providerConfirmedAtMs !== "number" || !Number.isFinite(r.providerConfirmedAtMs) || r.providerConfirmedAtMs <= 0) return false;
  if (typeof r.validUntilMs !== "number" || !Number.isFinite(r.validUntilMs) || r.validUntilMs <= 0) return false;
  if (r.validUntilMs <= r.providerConfirmedAtMs) return false;
  if (r.providerOutcome !== "CONFIRMED" && r.providerOutcome !== "REJECTED") return false;
  if (typeof r.validationPathId !== "string" || r.validationPathId.length === 0) return false;
  // `validationPathId` is interpolated into owner-facing diagnostics, so it is
  // constrained to a coded identifier rather than accepted as free text. If a
  // future validation path ever derives this string from a provider response
  // or an environment value, this check is what stops that value being echoed
  // back out through the readiness endpoint.
  if (!SAFE_CODED_IDENTIFIER.test(r.validationPathId)) return false;
  return true;
}

/** Uppercase letters, digits and underscores only, bounded length. */
const SAFE_CODED_IDENTIFIER = /^[A-Z0-9_]{1,64}$/;

/**
 * Judge Kite session evidence. Performs NO network call, constructs no client
 * and reads no credential value.
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

  if (rec === null) {
    details.push("NO_PROVIDER_VALIDATION_RECORD_EXISTS");
    details.push("PHASE_0_8C_PERFORMS_NO_PROVIDER_CALL");
    return Object.freeze({
      state: "NOT_EVALUATED" as const,
      valid: false,
      blockerCode: input.credentialsConfigured
        ? KITE_SESSION_BLOCKER.CREDENTIALS_ARE_NOT_VALIDATION
        : KITE_SESSION_BLOCKER.NOT_EVALUATED,
      providerConfirmedAtMs: null,
      validUntilMs: null,
      detailsSafeForOwnerDiagnostics: Object.freeze(details),
    });
  }

  if (!isRecordWellFormed(rec)) {
    details.push("VALIDATION_RECORD_FAILED_STRUCTURAL_CHECKS");
    return Object.freeze({
      state: "NOT_EVALUATED" as const,
      valid: false,
      blockerCode: KITE_SESSION_BLOCKER.MALFORMED_RECORD,
      providerConfirmedAtMs: null,
      validUntilMs: null,
      detailsSafeForOwnerDiagnostics: Object.freeze(details),
    });
  }

  details.push(`VALIDATION_PATH=${rec.validationPathId}`);

  if (rec.providerOutcome === "REJECTED") {
    details.push("PROVIDER_REJECTED_THE_SESSION");
    return Object.freeze({
      state: "INVALID" as const,
      valid: false,
      blockerCode: KITE_SESSION_BLOCKER.INVALID,
      providerConfirmedAtMs: rec.providerConfirmedAtMs,
      validUntilMs: rec.validUntilMs,
      detailsSafeForOwnerDiagnostics: Object.freeze(details),
    });
  }

  // A confirmation stamped in the future cannot be reasoned about.
  if (rec.providerConfirmedAtMs > nowMs) {
    details.push("VALIDATION_RECORD_CONFIRMED_IN_THE_FUTURE");
    return Object.freeze({
      state: "NOT_EVALUATED" as const,
      valid: false,
      blockerCode: KITE_SESSION_BLOCKER.MALFORMED_RECORD,
      providerConfirmedAtMs: rec.providerConfirmedAtMs,
      validUntilMs: rec.validUntilMs,
      detailsSafeForOwnerDiagnostics: Object.freeze(details),
    });
  }

  if (nowMs >= rec.validUntilMs) {
    details.push("PROVIDER_CONFIRMATION_VALIDITY_BOUNDARY_PASSED");
    return Object.freeze({
      state: "EXPIRED" as const,
      valid: false,
      blockerCode: KITE_SESSION_BLOCKER.EXPIRED,
      providerConfirmedAtMs: rec.providerConfirmedAtMs,
      validUntilMs: rec.validUntilMs,
      detailsSafeForOwnerDiagnostics: Object.freeze(details),
    });
  }

  details.push("PROVIDER_CONFIRMED_AND_STILL_WITHIN_VALIDITY_BOUNDARY");
  return Object.freeze({
    state: "VALID" as const,
    valid: true,
    blockerCode: null,
    providerConfirmedAtMs: rec.providerConfirmedAtMs,
    validUntilMs: rec.validUntilMs,
    detailsSafeForOwnerDiagnostics: Object.freeze(details),
  });
}

/**
 * The production accessor for the validation record.
 *
 * Returns null unconditionally: no accepted, still-current provider validation
 * record exists in this codebase, and inventing one would be fabrication. When
 * a real validation path is built, it writes a record and this function reads
 * it — the shape is already fixed so that change touches nothing else.
 */
export function getAcceptedKiteSessionValidationRecord(): KiteSessionValidationRecord | null {
  return null;
}
