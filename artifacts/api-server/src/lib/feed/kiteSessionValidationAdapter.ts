/**
 * KITE SESSION VALIDATION ADAPTER — PHASE 0.8D
 *
 * Phase 0.8C built the evidence PORT — the thing that decides whether a
 * validation record is believable — and deliberately left it empty, because
 * nothing existed that could legitimately produce a record. This module is that
 * producer: the one path by which a real, provider-confirmed Kite session
 * becomes activation evidence.
 *
 * It is disabled in this phase. `KITE_SESSION_VALIDATION_AUTHORIZED` is false,
 * so no credential is read and no request is issued. The adapter exists,
 * compiles and is fully tested against an injected fake provider port; it has
 * simply never been allowed to run against the real broker.
 *
 * WHAT COUNTS AS PROOF.
 *
 * A token that exists is not a session. A request that returns 200 is not a
 * session either, if it returned someone else's account. Proof here means: the
 * broker accepted this access token AND the account it resolved to is the
 * account we expect. Both halves are required, and the second is the one that
 * is easy to forget.
 *
 * WHAT MUST NEVER LEAVE THIS MODULE.
 *
 * No access token, API key, API secret, request token, cookie or raw provider
 * response may appear in a return value, an audit record, a log line or owner
 * diagnostics. The ports are shaped so that these values never enter this file
 * in the first place: the material port hands over a non-secret descriptor, and
 * the provider port hands over a classified outcome carrying at most an account
 * id. There is nothing here to leak.
 */

import {
  KITE_SESSION_VALIDATION_AUTHORIZED,
  KITE_SESSION_VALIDATION_AUTHORIZATION_ID,
  APPROVED_KITE_VALIDATION_OPERATION,
} from "./kiteSessionValidationControl";
import {
  acceptKiteSessionValidationRecord,
  invalidateAcceptedKiteSessionValidationRecord,
  getAcceptedKiteSessionValidationRecord,
  APPROVED_KITE_VALIDATION_PORT_ID,
  type KiteSessionRecordState,
} from "./kiteSessionEvidence";
import { SingleFlightGuard } from "../operationalSingleFlight";

// ── ports ────────────────────────────────────────────────────────────────────

/** Trusted clock. Injected so expiry boundaries are reproducible in tests. */
export interface ValidationClockPort {
  nowMs(): number;
}

/**
 * Non-secret description of the session material currently held.
 *
 * This is what the existing secret boundary (`kiteAuth` + `kiteCrypto`) is
 * willing to say ABOUT a session without handing over the session. The token
 * itself stays behind that boundary and is used only by the provider port.
 */
export interface KiteSessionDescriptor {
  /**
   * The account this session is expected to belong to. Compared against the
   * account the provider actually resolves the token to.
   */
  readonly expectedUserId: string;
  /**
   * When the stored session stops being usable, in epoch ms.
   *
   * This is NOT invented here. Kite access tokens expire at 06:00 IST the
   * following day — documented in the installed SDK typings and already
   * implemented at login, which stamps this boundary onto the stored session.
   * Validation evidence therefore inherits the session's own boundary and can
   * never outlive the thing it describes.
   */
  readonly sessionExpiresAtMs: number;
}

export interface KiteSessionMaterialPort {
  /** Returns null when no session is stored. Never returns the token. */
  readSessionDescriptor(): Promise<KiteSessionDescriptor | null>;
}

/**
 * The result of the one approved authenticated REST call.
 *
 * The port classifies transport-level failures, because distinguishing an
 * authentication rejection from a timeout requires SDK-specific error
 * knowledge that belongs next to the SDK, not in this orchestration. What the
 * port must NOT do is decide whether the session is valid — that judgment,
 * including the account-identity check, happens here.
 */
export type KiteProfileProbeOutcome =
  | { readonly kind: "PROFILE"; readonly userId: unknown }
  | { readonly kind: "AUTH_REJECTED" }
  | {
      readonly kind: "TRANSPORT_FAILURE";
      readonly classification: "TIMEOUT" | "NETWORK" | "SERVER_ERROR" | "RATE_LIMITED";
    };

export interface KiteProfileValidationPort {
  /** Performs `KiteConnect.getProfile()` exactly once. */
  probeProfile(): Promise<KiteProfileProbeOutcome>;
}

/** Structured, secret-free audit sink. */
export interface ValidationAuditPort {
  record(event: KiteValidationAuditEvent): void;
}

export interface KiteValidationAuditEvent {
  readonly operation: typeof APPROVED_KITE_VALIDATION_OPERATION;
  readonly outcome: KiteValidationOutcome;
  readonly reasonCode: string;
  readonly atMs: number;
  readonly providerCalled: boolean;
}

export interface KiteValidationPorts {
  readonly clock: ValidationClockPort;
  readonly material: KiteSessionMaterialPort;
  readonly provider: KiteProfileValidationPort;
  readonly audit: ValidationAuditPort;
}

// ── result contract ──────────────────────────────────────────────────────────

export type KiteValidationOutcome =
  | "VALID"
  | "INVALID"
  | "PROVIDER_UNAVAILABLE"
  | "EXPIRED"
  | "NOT_EVALUATED";

export const KITE_VALIDATION_REASON = Object.freeze({
  NOT_AUTHORIZED: "KITE_SESSION_VALIDATION_NOT_AUTHORIZED",
  CREDENTIALS_UNAVAILABLE: "CREDENTIALS_UNAVAILABLE",
  MATERIAL_READ_FAILED: "SESSION_MATERIAL_READ_FAILED",
  MALFORMED_DESCRIPTOR: "MALFORMED_SESSION_DESCRIPTOR",
  LOCALLY_EXPIRED: "SESSION_LOCALLY_EXPIRED",
  PROVIDER_REJECTED: "PROVIDER_REJECTED_ACCESS_TOKEN",
  ACCOUNT_MISMATCH: "PROVIDER_ACCOUNT_IDENTITY_MISMATCH",
  MALFORMED_RESPONSE: "MALFORMED_PROVIDER_RESPONSE",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_NETWORK: "PROVIDER_NETWORK_FAILURE",
  PROVIDER_SERVER_ERROR: "PROVIDER_SERVER_ERROR",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  PROVIDER_THREW: "PROVIDER_PORT_THREW",
  EVIDENCE_REJECTED: "EVIDENCE_PORT_REJECTED_RECORD",
  ACCEPTED: "PROVIDER_CONFIRMED_EXPECTED_ACCOUNT",
} as const);

export interface KiteValidationResult {
  readonly outcome: KiteValidationOutcome;
  readonly reasonCode: string;
  /** True only when a record was written through the Phase 0.8C port. */
  readonly evidenceRecorded: boolean;
  /** True only when an earlier record was explicitly revoked by this run. */
  readonly evidenceInvalidated: boolean;
  /** Whether the provider was actually contacted. */
  readonly providerCalled: boolean;
  readonly validatedAtMs: number | null;
  readonly validUntilMs: number | null;
  readonly coalescedWithInFlight: boolean;
  readonly detailsSafeForOwnerDiagnostics: readonly string[];
}

// ── diagnostics state (module scope, read-only for callers) ──────────────────

export type KiteValidationRunState = "DISABLED" | "READY" | "RUNNING";

let _lastResult: KiteValidationResult | null = null;
let _lastRunAtMs: number | null = null;
const _guard = new SingleFlightGuard<KiteValidationResult>();

/**
 * Owner diagnostics. Pure read — describing an operation must never be a way to
 * start it, or a diagnostics page becomes a trigger.
 */
export function getKiteValidationOperationDiagnostics(): {
  readonly state: KiteValidationRunState;
  readonly authorized: boolean;
  readonly approvedOperation: string;
  readonly lastRunAtMs: number | null;
  readonly lastOutcome: KiteValidationOutcome | null;
  readonly lastReasonCode: string | null;
  readonly lastValidatedAtMs: number | null;
  readonly lastValidUntilMs: number | null;
  readonly evidenceCurrentlyHeld: boolean;
} {
  const running = _guard.state === "RUNNING";
  return Object.freeze({
    state: running ? "RUNNING" : KITE_SESSION_VALIDATION_AUTHORIZED ? "READY" : "DISABLED",
    authorized: KITE_SESSION_VALIDATION_AUTHORIZED,
    approvedOperation: APPROVED_KITE_VALIDATION_OPERATION,
    lastRunAtMs: _lastRunAtMs,
    lastOutcome: _lastResult?.outcome ?? null,
    lastReasonCode: _lastResult?.reasonCode ?? null,
    lastValidatedAtMs: _lastResult?.validatedAtMs ?? null,
    lastValidUntilMs: _lastResult?.validUntilMs ?? null,
    // Derived from the port, not from our own last result: the record can
    // expire or be invalidated between runs.
    evidenceCurrentlyHeld: getAcceptedKiteSessionValidationRecord() !== null,
  });
}

/** Test-only. Never called by production code. */
export function __resetKiteValidationDiagnosticsForTests(): void {
  _lastResult = null;
  _lastRunAtMs = null;
  _guard.__resetForTests();
}

// ── the adapter ──────────────────────────────────────────────────────────────

const SAFE_USER_ID = /^[A-Za-z0-9_-]{1,32}$/;

function result(
  outcome: KiteValidationOutcome,
  reasonCode: string,
  over: Partial<KiteValidationResult> = {},
): KiteValidationResult {
  return Object.freeze({
    outcome,
    reasonCode,
    evidenceRecorded: false,
    evidenceInvalidated: false,
    providerCalled: false,
    validatedAtMs: null,
    validUntilMs: null,
    coalescedWithInFlight: false,
    detailsSafeForOwnerDiagnostics: Object.freeze([`OPERATION=${APPROVED_KITE_VALIDATION_OPERATION}`]),
    ...over,
  });
}

export interface KiteSessionValidator {
  validateNow(): Promise<KiteValidationResult>;
}

function createValidator(ports: KiteValidationPorts, authorized: boolean): KiteSessionValidator {
  return {
    async validateNow(): Promise<KiteValidationResult> {
      // ── GATE 1: authorization, before ANY port is touched ────────────────
      //
      // Checked before the clock, before credential material and before the
      // provider. A refusal that first reads the token has already defeated the
      // point of the lock, even if it never sends the request.
      if (!authorized) {
        const refusal = result("NOT_EVALUATED", KITE_VALIDATION_REASON.NOT_AUTHORIZED, {
          detailsSafeForOwnerDiagnostics: Object.freeze([
            `AUTHORIZATION=${KITE_SESSION_VALIDATION_AUTHORIZATION_ID}`,
            "AUTHORIZED=false",
            "PROVIDER_CALLED=false",
          ]),
        });
        _lastResult = refusal;
        return refusal;
      }

      const nowMs = ports.clock.nowMs();
      _lastRunAtMs = nowMs;

      const outcome = await _guard.run(nowMs, () => runOnce(ports, nowMs));
      const finalResult = outcome.coalesced
        ? Object.freeze({ ...outcome.result, coalescedWithInFlight: true })
        : outcome.result;
      _lastResult = finalResult;
      return finalResult;
    },
  };
}

async function runOnce(
  ports: KiteValidationPorts,
  nowMs: number,
): Promise<KiteValidationResult> {
  const audit = (r: KiteValidationResult): KiteValidationResult => {
    ports.audit.record({
      operation: APPROVED_KITE_VALIDATION_OPERATION,
      outcome: r.outcome,
      reasonCode: r.reasonCode,
      atMs: nowMs,
      providerCalled: r.providerCalled,
    });
    return r;
  };

  // ── GATE 2: is there anything to validate? ──────────────────────────────
  //
  // Absent credentials are NOT_EVALUATED, never INVALID. Claiming a session is
  // invalid because we never had one would be a false accusation against a
  // token that may be perfectly good — and it would look identical to a real
  // provider rejection in every downstream report.
  let descriptor: KiteSessionDescriptor | null;
  try {
    descriptor = await ports.material.readSessionDescriptor();
  } catch {
    return audit(result("NOT_EVALUATED", KITE_VALIDATION_REASON.MATERIAL_READ_FAILED));
  }
  if (descriptor === null) {
    return audit(result("NOT_EVALUATED", KITE_VALIDATION_REASON.CREDENTIALS_UNAVAILABLE));
  }
  if (
    typeof descriptor.expectedUserId !== "string" ||
    !SAFE_USER_ID.test(descriptor.expectedUserId) ||
    typeof descriptor.sessionExpiresAtMs !== "number" ||
    !Number.isFinite(descriptor.sessionExpiresAtMs) ||
    descriptor.sessionExpiresAtMs <= 0
  ) {
    return audit(result("NOT_EVALUATED", KITE_VALIDATION_REASON.MALFORMED_DESCRIPTOR));
  }

  // ── GATE 3: locally expired — answered WITHOUT a provider call ──────────
  //
  // If the stored session is already past its own 06:00 IST boundary, the
  // broker's answer is knowable in advance and spending a request on it would
  // be pure waste. The boundary is exclusive, matching the evidence port.
  if (nowMs >= descriptor.sessionExpiresAtMs) {
    return audit(
      result("EXPIRED", KITE_VALIDATION_REASON.LOCALLY_EXPIRED, {
        validUntilMs: descriptor.sessionExpiresAtMs,
      }),
    );
  }

  // ── GATE 4: the single approved provider call ───────────────────────────
  let probe: KiteProfileProbeOutcome;
  try {
    probe = await ports.provider.probeProfile();
  } catch {
    // A throwing port tells us nothing about the token. Treating it as INVALID
    // would revoke a good session because of our own transport bug.
    return audit(
      result("PROVIDER_UNAVAILABLE", KITE_VALIDATION_REASON.PROVIDER_THREW, {
        providerCalled: true,
      }),
    );
  }

  if (probe.kind === "TRANSPORT_FAILURE") {
    const reason =
      probe.classification === "TIMEOUT"
        ? KITE_VALIDATION_REASON.PROVIDER_TIMEOUT
        : probe.classification === "NETWORK"
          ? KITE_VALIDATION_REASON.PROVIDER_NETWORK
          : probe.classification === "RATE_LIMITED"
            ? KITE_VALIDATION_REASON.PROVIDER_RATE_LIMITED
            : KITE_VALIDATION_REASON.PROVIDER_SERVER_ERROR;
    // NOT INVALID. A timeout, a 5xx or a rate limit is a statement about the
    // connection, not about the credential.
    return audit(
      result("PROVIDER_UNAVAILABLE", reason, { providerCalled: true }),
    );
  }

  if (probe.kind === "AUTH_REJECTED") {
    // Positive evidence AGAINST the session. Any record we are still holding
    // describes a session the broker has now refused, so it is revoked here
    // rather than left to age out on its own boundary.
    const held = getAcceptedKiteSessionValidationRecord() !== null;
    if (held) invalidateAcceptedKiteSessionValidationRecord();
    return audit(
      result("INVALID", KITE_VALIDATION_REASON.PROVIDER_REJECTED, {
        providerCalled: true,
        evidenceInvalidated: held,
      }),
    );
  }

  // ── GATE 5: response shape ───────────────────────────────────────────────
  const userId = probe.userId;
  if (typeof userId !== "string" || !SAFE_USER_ID.test(userId)) {
    return audit(
      result("PROVIDER_UNAVAILABLE", KITE_VALIDATION_REASON.MALFORMED_RESPONSE, {
        providerCalled: true,
      }),
    );
  }

  // ── GATE 6: expected account identity ────────────────────────────────────
  //
  // A 200 that resolves to a DIFFERENT account is the most dangerous possible
  // success: the token is real, the call worked, and everything downstream
  // would be about the wrong account. This is a refusal, not a pass.
  if (userId !== descriptor.expectedUserId) {
    const held = getAcceptedKiteSessionValidationRecord() !== null;
    if (held) invalidateAcceptedKiteSessionValidationRecord();
    return audit(
      result("INVALID", KITE_VALIDATION_REASON.ACCOUNT_MISMATCH, {
        providerCalled: true,
        evidenceInvalidated: held,
      }),
    );
  }

  // ── GATE 7: write exactly one record through the Phase 0.8C port ─────────
  //
  // Validity is bounded by the SESSION's own expiry, never by a duration
  // invented here. Evidence about a session cannot outlive the session.
  const recordState: KiteSessionRecordState = "VALID";
  const accept = acceptKiteSessionValidationRecord(
    {
      provider: "KITE",
      recordState,
      validatedAtMs: nowMs,
      validUntilMs: descriptor.sessionExpiresAtMs,
      validationPathId: APPROVED_KITE_VALIDATION_OPERATION,
      provenance: {
        producedByPortId: APPROVED_KITE_VALIDATION_PORT_ID,
        adapterId: "KITE_SESSION_VALIDATION_ADAPTER_V1",
      },
    },
    nowMs,
  );

  if (!accept.accepted) {
    // The port refused our own record — most often because newer evidence
    // already exists. We do not retry, do not overwrite and do not pretend
    // this run produced evidence.
    return audit(
      result("PROVIDER_UNAVAILABLE", KITE_VALIDATION_REASON.EVIDENCE_REJECTED, {
        providerCalled: true,
        detailsSafeForOwnerDiagnostics: Object.freeze([
          `OPERATION=${APPROVED_KITE_VALIDATION_OPERATION}`,
          `EVIDENCE_REJECTION=${accept.rejectionCode}`,
        ]),
      }),
    );
  }

  return audit(
    result("VALID", KITE_VALIDATION_REASON.ACCEPTED, {
      providerCalled: true,
      evidenceRecorded: true,
      validatedAtMs: nowMs,
      validUntilMs: descriptor.sessionExpiresAtMs,
    }),
  );
}

/**
 * The production validator. Reads the compile-time authorization, which is
 * false, so this refuses before touching any port.
 */
export function createKiteSessionValidator(ports: KiteValidationPorts): KiteSessionValidator {
  return createValidator(ports, KITE_SESSION_VALIDATION_AUTHORIZED);
}

/**
 * TEST-ONLY authorization override. Zero production callers — asserted by
 * `p08d.guards.test.ts`, which greps the source tree rather than trusting this
 * comment. It exists because the disabled path cannot exercise gates 2-7.
 */
export function __TEST_ONLY_createAuthorizedKiteSessionValidator(
  ports: KiteValidationPorts,
): KiteSessionValidator {
  return createValidator(ports, true);
}
