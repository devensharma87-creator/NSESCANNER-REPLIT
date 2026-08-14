/**
 * PHASE 0.8D — KITE SESSION VALIDATION ADAPTER
 *
 * The adapter is the only legitimate producer of the Phase 0.8C evidence
 * record, so these tests care about two things above all: that it refuses in
 * every ambiguous case, and that the one path which DOES produce evidence
 * cannot be reached without the provider confirming the EXPECTED account.
 *
 * The distinction the suite works hardest on is "we could not tell" versus
 * "the session is bad". Collapsing those is the mistake that either revokes a
 * good session on a network blip or reports a dead session as merely
 * unreachable. Each gets its own outcome, its own reason code, and its own
 * effect on stored evidence.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createKiteSessionValidator,
  __TEST_ONLY_createAuthorizedKiteSessionValidator,
  __resetKiteValidationDiagnosticsForTests,
  getKiteValidationOperationDiagnostics,
  KITE_VALIDATION_REASON,
  type KiteValidationPorts,
  type KiteProfileProbeOutcome,
  type KiteSessionDescriptor,
} from "./kiteSessionValidationAdapter";
import {
  KITE_SESSION_VALIDATION_AUTHORIZED,
  APPROVED_KITE_VALIDATION_OPERATION,
} from "./kiteSessionValidationControl";
import {
  getAcceptedKiteSessionValidationRecord,
  acceptKiteSessionValidationRecord,
  __resetKiteSessionEvidenceStoreForTests,
  APPROVED_KITE_VALIDATION_PORT_ID,
} from "./kiteSessionEvidence";

const NOW = 1_760_000_000_000;
const EXPECTED_USER = "AB1234";
/** The session's own 06:00 IST boundary, as stamped at login. */
const SESSION_EXPIRY = NOW + 8 * 3600_000;

interface Spy {
  materialReads: number;
  probeCalls: number;
  audit: string[];
}

function makePorts(
  over: Partial<{
    now: number;
    descriptor: KiteSessionDescriptor | null;
    materialThrows: boolean;
    probe: KiteProfileProbeOutcome;
    probeThrows: boolean;
    onProbe: () => Promise<void>;
  }> = {},
): { ports: KiteValidationPorts; spy: Spy } {
  const spy: Spy = { materialReads: 0, probeCalls: 0, audit: [] };

  const ports: KiteValidationPorts = {
    clock: { nowMs: () => over.now ?? NOW },
    material: {
      async readSessionDescriptor() {
        spy.materialReads++;
        if (over.materialThrows) throw new Error("decrypt failed");
        return over.descriptor === undefined
          ? { expectedUserId: EXPECTED_USER, sessionExpiresAtMs: SESSION_EXPIRY }
          : over.descriptor;
      },
    },
    provider: {
      async probeProfile() {
        spy.probeCalls++;
        if (over.onProbe) await over.onProbe();
        if (over.probeThrows) throw new Error("socket hang up");
        return over.probe ?? { kind: "PROFILE", userId: EXPECTED_USER };
      },
    },
    audit: {
      record(e) {
        spy.audit.push(`${e.outcome}:${e.reasonCode}:provider=${e.providerCalled}`);
      },
    },
  };

  return { ports, spy };
}

beforeEach(() => {
  __resetKiteSessionEvidenceStoreForTests();
  __resetKiteValidationDiagnosticsForTests();
});

// ── K1: the disabled default ────────────────────────────────────────────────

describe("K1 — the production validator is disabled and reads no credential", () => {
  it("refuses without reading session material or calling the provider", async () => {
    const { ports, spy } = makePorts();
    const result = await createKiteSessionValidator(ports).validateNow();

    expect(result.outcome).toBe("NOT_EVALUATED");
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.NOT_AUTHORIZED);
    expect(result.providerCalled).toBe(false);
    expect(result.evidenceRecorded).toBe(false);
    // The refusal precedes the credential boundary: nothing was decrypted.
    expect(spy.materialReads).toBe(0);
    expect(spy.probeCalls).toBe(0);
  });

  it("declares the constant false and the approved operation as getProfile", () => {
    expect(KITE_SESSION_VALIDATION_AUTHORIZED).toBe(false);
    expect(APPROVED_KITE_VALIDATION_OPERATION).toBe("KITE_REST_GET_PROFILE");
    expect(getKiteValidationOperationDiagnostics().state).toBe("DISABLED");
  });

  it("writes no evidence, leaving the 0.8C store empty", async () => {
    const { ports } = makePorts();
    await createKiteSessionValidator(ports).validateNow();
    expect(getAcceptedKiteSessionValidationRecord()).toBeNull();
  });
});

// ── K2-K4: absent or unusable credential material ───────────────────────────

describe("K2 — absent credentials are NOT_EVALUATED, never INVALID", () => {
  it("returns CREDENTIALS_UNAVAILABLE without calling the provider", async () => {
    const { ports, spy } = makePorts({ descriptor: null });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(result.outcome).toBe("NOT_EVALUATED");
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.CREDENTIALS_UNAVAILABLE);
    // Calling a broker with no token would be a guaranteed-useless request.
    expect(spy.probeCalls).toBe(0);
    // Crucially NOT "INVALID": we have no evidence against any session.
    expect(result.outcome).not.toBe("INVALID");
  });
});

describe("K3 — a failing material read is NOT_EVALUATED", () => {
  it("does not blame the session for our own decryption failure", async () => {
    const { ports, spy } = makePorts({ materialThrows: true });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(result.outcome).toBe("NOT_EVALUATED");
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.MATERIAL_READ_FAILED);
    expect(spy.probeCalls).toBe(0);
  });
});

describe("K4 — a malformed descriptor is refused before the provider", () => {
  it("refuses a non-finite expiry", async () => {
    const { ports, spy } = makePorts({
      descriptor: { expectedUserId: EXPECTED_USER, sessionExpiresAtMs: Number.NaN },
    });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.MALFORMED_DESCRIPTOR);
    expect(spy.probeCalls).toBe(0);
  });

  it("refuses an account id that is not a coded identifier", async () => {
    const { ports } = makePorts({
      descriptor: { expectedUserId: "<script>alert(1)</script>", sessionExpiresAtMs: SESSION_EXPIRY },
    });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.MALFORMED_DESCRIPTOR);
  });
});

// ── K5: local expiry short-circuit ──────────────────────────────────────────

describe("K5 — a locally expired session is answered without a provider call", () => {
  it("returns EXPIRED and spends no request", async () => {
    const { ports, spy } = makePorts({ now: SESSION_EXPIRY + 1 });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(result.outcome).toBe("EXPIRED");
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.LOCALLY_EXPIRED);
    expect(result.providerCalled).toBe(false);
    expect(spy.probeCalls).toBe(0);
    expect(result.validUntilMs).toBe(SESSION_EXPIRY);
  });

  it("treats the boundary as exclusive — exactly at expiry is already expired", async () => {
    const { ports, spy } = makePorts({ now: SESSION_EXPIRY });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(result.outcome).toBe("EXPIRED");
    expect(spy.probeCalls).toBe(0);
  });
});

// ── K6-K7: provider rejection ───────────────────────────────────────────────

describe("K6 — a provider auth rejection is INVALID", () => {
  it("returns INVALID and records no evidence", async () => {
    const { ports } = makePorts({ probe: { kind: "AUTH_REJECTED" } });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(result.outcome).toBe("INVALID");
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.PROVIDER_REJECTED);
    expect(result.providerCalled).toBe(true);
    expect(result.evidenceRecorded).toBe(false);
    expect(getAcceptedKiteSessionValidationRecord()).toBeNull();
  });
});

describe("K7 — a rejection revokes evidence we were still holding", () => {
  it("invalidates the earlier record, because the broker now refuses that session", async () => {
    // Seed a previously-accepted record through the real port.
    const seeded = acceptKiteSessionValidationRecord(
      {
        provider: "KITE",
        recordState: "VALID",
        validatedAtMs: NOW - 60_000,
        validUntilMs: SESSION_EXPIRY,
        validationPathId: APPROVED_KITE_VALIDATION_OPERATION,
        provenance: {
          producedByPortId: APPROVED_KITE_VALIDATION_PORT_ID,
          adapterId: "KITE_SESSION_VALIDATION_ADAPTER_V1",
        },
      },
      NOW - 60_000,
    );
    expect(seeded.accepted).toBe(true);
    expect(getAcceptedKiteSessionValidationRecord()).not.toBeNull();

    const { ports } = makePorts({ probe: { kind: "AUTH_REJECTED" } });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(result.outcome).toBe("INVALID");
    expect(result.evidenceInvalidated).toBe(true);
    expect(getAcceptedKiteSessionValidationRecord()).toBeNull();
  });
});

// ── K8-K10: transport failures must not revoke ──────────────────────────────

describe("K8 — transport failures are PROVIDER_UNAVAILABLE, never INVALID", () => {
  const cases: Array<[KiteProfileProbeOutcome, string]> = [
    [{ kind: "TRANSPORT_FAILURE", classification: "TIMEOUT" }, KITE_VALIDATION_REASON.PROVIDER_TIMEOUT],
    [{ kind: "TRANSPORT_FAILURE", classification: "NETWORK" }, KITE_VALIDATION_REASON.PROVIDER_NETWORK],
    [
      { kind: "TRANSPORT_FAILURE", classification: "SERVER_ERROR" },
      KITE_VALIDATION_REASON.PROVIDER_SERVER_ERROR,
    ],
    [
      { kind: "TRANSPORT_FAILURE", classification: "RATE_LIMITED" },
      KITE_VALIDATION_REASON.PROVIDER_RATE_LIMITED,
    ],
  ];

  for (const [probe, expectedReason] of cases) {
    it(`maps ${probe.kind === "TRANSPORT_FAILURE" ? probe.classification : ""} to a distinct reason code`, async () => {
      const { ports } = makePorts({ probe });
      const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

      expect(result.outcome).toBe("PROVIDER_UNAVAILABLE");
      expect(result.reasonCode).toBe(expectedReason);
      expect(result.evidenceRecorded).toBe(false);
    });
  }
});

describe("K9 — an unreachable provider does not revoke existing evidence", () => {
  it("preserves the earlier record through a timeout", async () => {
    acceptKiteSessionValidationRecord(
      {
        provider: "KITE",
        recordState: "VALID",
        validatedAtMs: NOW - 60_000,
        validUntilMs: SESSION_EXPIRY,
        validationPathId: APPROVED_KITE_VALIDATION_OPERATION,
        provenance: {
          producedByPortId: APPROVED_KITE_VALIDATION_PORT_ID,
          adapterId: "KITE_SESSION_VALIDATION_ADAPTER_V1",
        },
      },
      NOW - 60_000,
    );

    const { ports } = makePorts({
      probe: { kind: "TRANSPORT_FAILURE", classification: "TIMEOUT" },
    });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    // A timeout is a statement about the network, not the credential. The
    // record survives — and it still carries its own expiry, so the final
    // activation gate re-judges it against the clock regardless.
    expect(result.evidenceInvalidated).toBe(false);
    expect(getAcceptedKiteSessionValidationRecord()).not.toBeNull();
  });
});

describe("K10 — a throwing provider port is PROVIDER_UNAVAILABLE", () => {
  it("does not let our own transport bug condemn the session", async () => {
    const { ports } = makePorts({ probeThrows: true });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(result.outcome).toBe("PROVIDER_UNAVAILABLE");
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.PROVIDER_THREW);
    expect(result.providerCalled).toBe(true);
  });
});

// ── K11-K12: shape and identity ─────────────────────────────────────────────

describe("K11 — a malformed provider response produces no evidence", () => {
  it("refuses a missing user id", async () => {
    const { ports } = makePorts({ probe: { kind: "PROFILE", userId: undefined } });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(result.outcome).toBe("PROVIDER_UNAVAILABLE");
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.MALFORMED_RESPONSE);
    expect(getAcceptedKiteSessionValidationRecord()).toBeNull();
  });

  it("refuses a user id that is not a coded identifier", async () => {
    const { ports } = makePorts({ probe: { kind: "PROFILE", userId: "a b/c?d" } });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.MALFORMED_RESPONSE);
  });
});

describe("K12 — a 200 for the WRONG account is a refusal, not a pass", () => {
  it("returns INVALID on account identity mismatch", async () => {
    const { ports } = makePorts({ probe: { kind: "PROFILE", userId: "ZZ9999" } });
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    // The token was real and the call succeeded. Everything downstream would
    // have been about someone else's account.
    expect(result.outcome).toBe("INVALID");
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.ACCOUNT_MISMATCH);
    expect(result.evidenceRecorded).toBe(false);
    expect(getAcceptedKiteSessionValidationRecord()).toBeNull();
  });
});

// ── K13-K14: the one success path ───────────────────────────────────────────

describe("K13 — a confirmed session produces exactly one record", () => {
  it("returns VALID and writes evidence through the 0.8C port", async () => {
    const { ports, spy } = makePorts();
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(result.outcome).toBe("VALID");
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.ACCEPTED);
    expect(result.evidenceRecorded).toBe(true);
    expect(result.validatedAtMs).toBe(NOW);
    expect(spy.probeCalls).toBe(1);

    const record = getAcceptedKiteSessionValidationRecord();
    expect(record).not.toBeNull();
    expect(record!.recordState).toBe("VALID");
    expect(record!.provenance.producedByPortId).toBe(APPROVED_KITE_VALIDATION_PORT_ID);
    expect(record!.provenance.adapterId).toBe("KITE_SESSION_VALIDATION_ADAPTER_V1");
    expect(record!.validationPathId).toBe(APPROVED_KITE_VALIDATION_OPERATION);
  });

  it("bounds validity by the SESSION's own expiry, not an invented duration", async () => {
    const { ports } = makePorts();
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    // Evidence about a session must never outlive the session it describes.
    // This is the existing 06:00-IST boundary stamped at login, threaded
    // through the descriptor — no new policy is introduced here.
    expect(result.validUntilMs).toBe(SESSION_EXPIRY);
    expect(getAcceptedKiteSessionValidationRecord()!.validUntilMs).toBe(SESSION_EXPIRY);
  });

  it("carries no credential material anywhere in the result", async () => {
    const { ports, spy } = makePorts();
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    const serialized = JSON.stringify({
      result,
      record: getAcceptedKiteSessionValidationRecord(),
      audit: spy.audit,
    });
    for (const needle of ["token", "secret", "apikey", "api_key", "password", "cookie"]) {
      expect(serialized.toLowerCase()).not.toContain(needle);
    }
    // The account id is not a secret, but it is also not needed downstream —
    // the record type has nowhere to put it.
    expect(serialized).not.toContain(EXPECTED_USER);
  });
});

describe("K14 — the evidence port remains the authority on acceptance", () => {
  it("reports EVIDENCE_REJECTED when the port refuses our record", async () => {
    // Seed a NEWER record; the port refuses anything not strictly newer.
    acceptKiteSessionValidationRecord(
      {
        provider: "KITE",
        recordState: "VALID",
        validatedAtMs: NOW + 1_000,
        validUntilMs: SESSION_EXPIRY,
        validationPathId: APPROVED_KITE_VALIDATION_OPERATION,
        provenance: {
          producedByPortId: APPROVED_KITE_VALIDATION_PORT_ID,
          adapterId: "KITE_SESSION_VALIDATION_ADAPTER_V1",
        },
      },
      NOW + 1_000,
    );

    const { ports } = makePorts();
    const result = await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(result.outcome).toBe("PROVIDER_UNAVAILABLE");
    expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.EVIDENCE_REJECTED);
    expect(result.evidenceRecorded).toBe(false);
    // The newer record is untouched — an older result never displaces it.
    expect(getAcceptedKiteSessionValidationRecord()!.validatedAtMs).toBe(NOW + 1_000);
  });
});

// ── K15-K16: concurrency and diagnostics ────────────────────────────────────

describe("K15 — concurrent validations coalesce into one provider call", () => {
  it("calls getProfile once and gives both callers the same answer", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { ports, spy } = makePorts({ onProbe: () => gate });

    const svc = __TEST_ONLY_createAuthorizedKiteSessionValidator(ports);
    const a = svc.validateNow();
    const b = svc.validateNow();
    release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(spy.probeCalls).toBe(1);
    expect(ra.outcome).toBe("VALID");
    expect(rb.outcome).toBe("VALID");
    expect(rb.coalescedWithInFlight).toBe(true);
  });

  it("releases the slot after a failure", async () => {
    let broken = true;
    const { ports } = makePorts({
      onProbe: async () => {
        if (broken) throw new Error("boom");
      },
    });
    const svc = __TEST_ONLY_createAuthorizedKiteSessionValidator(ports);

    const first = await svc.validateNow();
    expect(first.outcome).toBe("PROVIDER_UNAVAILABLE");

    broken = false;
    const second = await svc.validateNow();
    expect(second.coalescedWithInFlight).toBe(false);
    expect(second.outcome).toBe("VALID");
  });
});

describe("K16 — diagnostics describe without triggering", () => {
  it("reading diagnostics calls no port", async () => {
    const { ports, spy } = makePorts();
    void ports;
    const diag = getKiteValidationOperationDiagnostics();

    expect(diag.authorized).toBe(false);
    expect(diag.approvedOperation).toBe("KITE_REST_GET_PROFILE");
    expect(diag.evidenceCurrentlyHeld).toBe(false);
    expect(spy.materialReads).toBe(0);
    expect(spy.probeCalls).toBe(0);
  });

  it("reflects the last run and the live evidence state", async () => {
    const { ports } = makePorts();
    await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    const diag = getKiteValidationOperationDiagnostics();
    expect(diag.lastOutcome).toBe("VALID");
    expect(diag.lastValidUntilMs).toBe(SESSION_EXPIRY);
    expect(diag.evidenceCurrentlyHeld).toBe(true);
  });
});

describe("K17 — every terminal outcome is audited once, with no secret", () => {
  it("audits the outcome, reason and whether the provider was contacted", async () => {
    const { ports, spy } = makePorts({ descriptor: null });
    await __TEST_ONLY_createAuthorizedKiteSessionValidator(ports).validateNow();

    expect(spy.audit).toEqual([
      `NOT_EVALUATED:${KITE_VALIDATION_REASON.CREDENTIALS_UNAVAILABLE}:provider=false`,
    ]);
  });
});
