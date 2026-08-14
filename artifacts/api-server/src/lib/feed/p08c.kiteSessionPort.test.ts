/**
 * PHASE 0.8C CORRECTION — KITE SESSION EVIDENCE PORT
 *
 * The port replaces a getter that was hardcoded to `null`. That stub blocked
 * activation, but it blocked it unconditionally, which means it never actually
 * exercised the question "would we believe a real validation record?" These
 * tests exercise exactly that question, without any provider ever being
 * contacted: records are submitted directly to the port, and the judge is
 * asked what it makes of them.
 *
 * The production verdict must remain NOT_EVALUATED throughout, because no
 * adapter exists to submit anything. Every accepted record here is created by
 * the test and removed again.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

import {
  acceptKiteSessionValidationRecord,
  invalidateAcceptedKiteSessionValidationRecord,
  getAcceptedKiteSessionValidationRecord,
  evaluateKiteSessionEvidence,
  __resetKiteSessionEvidenceStoreForTests,
  APPROVED_KITE_VALIDATION_PORT_ID,
  KITE_SESSION_BLOCKER,
  KITE_SESSION_REJECTION,
  type KiteSessionValidationCandidate,
  type KiteSessionRecordState,
} from "./kiteSessionEvidence";
import { buildProductionActivationSnapshot } from "./productionFeedManager";
import { judgeAllRequiredEvidence } from "./activationEvidence";

const NOW = 1_800_000_000_000;

function candidate(over: Partial<KiteSessionValidationCandidate> = {}): KiteSessionValidationCandidate {
  return {
    provider: "KITE",
    recordState: "VALID",
    validatedAtMs: NOW - 60_000,
    validUntilMs: NOW + 60_000,
    validationPathId: "KITE_PROFILE_PROBE",
    provenance: {
      producedByPortId: APPROVED_KITE_VALIDATION_PORT_ID,
      adapterId: "TEST_ADAPTER",
    },
    ...over,
  };
}

beforeEach(() => __resetKiteSessionEvidenceStoreForTests());
afterEach(() => __resetKiteSessionEvidenceStoreForTests());

describe("Phase 0.8C correction — Kite session evidence port", () => {
  // ── P1 ─────────────────────────────────────────────────────────────────────
  it("P1 an empty store is NOT_EVALUATED, and credentials alone never change that", () => {
    expect(getAcceptedKiteSessionValidationRecord()).toBeNull();

    const noCreds = evaluateKiteSessionEvidence({
      validationRecord: getAcceptedKiteSessionValidationRecord(),
      credentialsConfigured: false,
      nowMs: NOW,
    });
    expect(noCreds.state).toBe("NOT_EVALUATED");
    expect(noCreds.valid).toBe(false);
    expect(noCreds.blockerCode).toBe(KITE_SESSION_BLOCKER.NOT_EVALUATED);

    // The important half: credentials being present is reported with its own
    // code, but it is still NOT_EVALUATED. Presence is not validity.
    const withCreds = evaluateKiteSessionEvidence({
      validationRecord: getAcceptedKiteSessionValidationRecord(),
      credentialsConfigured: true,
      nowMs: NOW,
    });
    expect(withCreds.state).toBe("NOT_EVALUATED");
    expect(withCreds.valid).toBe(false);
    expect(withCreds.blockerCode).toBe(KITE_SESSION_BLOCKER.CREDENTIALS_ARE_NOT_VALIDATION);
  });

  // ── P2 ─────────────────────────────────────────────────────────────────────
  it("P2 an accepted VALID record is believed only strictly before its validity boundary", () => {
    const accept = acceptKiteSessionValidationRecord(candidate(), NOW);
    expect(accept.accepted).toBe(true);

    const rec = getAcceptedKiteSessionValidationRecord();
    expect(rec).not.toBeNull();

    const inWindow = evaluateKiteSessionEvidence({
      validationRecord: rec,
      credentialsConfigured: true,
      nowMs: NOW,
    });
    expect(inWindow.state).toBe("VALID");
    expect(inWindow.valid).toBe(true);
    expect(inWindow.blockerCode).toBeNull();

    // EXACT boundary. `validUntil` is exclusive: at the instant it names, the
    // confirmation no longer speaks for the present. An inclusive boundary
    // would keep a record alive for one more millisecond than it was granted,
    // which is the kind of off-by-one that only ever shows up in production.
    const atBoundary = evaluateKiteSessionEvidence({
      validationRecord: rec,
      credentialsConfigured: true,
      nowMs: NOW + 60_000,
    });
    expect(atBoundary.state).toBe("EXPIRED");
    expect(atBoundary.valid).toBe(false);
    expect(atBoundary.blockerCode).toBe(KITE_SESSION_BLOCKER.EXPIRED);

    // One millisecond earlier it is still good, proving the boundary is where
    // it claims to be rather than merely "somewhere near".
    expect(
      evaluateKiteSessionEvidence({
        validationRecord: rec,
        credentialsConfigured: true,
        nowMs: NOW + 59_999,
      }).valid,
    ).toBe(true);
  });

  // ── P3 ─────────────────────────────────────────────────────────────────────
  it("P3 INVALID, EXPIRED and PROVIDER_UNAVAILABLE fail closed with distinct codes", () => {
    const cases: ReadonlyArray<[KiteSessionRecordState, string, string]> = [
      ["INVALID", "INVALID", KITE_SESSION_BLOCKER.INVALID],
      ["EXPIRED", "EXPIRED", KITE_SESSION_BLOCKER.EXPIRED],
      ["PROVIDER_UNAVAILABLE", "PROVIDER_UNAVAILABLE", KITE_SESSION_BLOCKER.PROVIDER_UNAVAILABLE],
    ];
    const seen = new Set<string>();
    for (const [recordState, expectedState, expectedBlocker] of cases) {
      __resetKiteSessionEvidenceStoreForTests();
      const r = acceptKiteSessionValidationRecord(candidate({ recordState }), NOW);
      expect(r.accepted).toBe(true);
      const v = evaluateKiteSessionEvidence({
        validationRecord: getAcceptedKiteSessionValidationRecord(),
        credentialsConfigured: true,
        nowMs: NOW,
      });
      expect(v.state).toBe(expectedState);
      expect(v.valid).toBe(false);
      expect(v.blockerCode).toBe(expectedBlocker);
      seen.add(String(v.blockerCode));
    }
    // Distinctness is the point: three different failures must not collapse
    // into one code, or an operator cannot tell "provider said no" from
    // "provider was unreachable".
    expect(seen.size).toBe(3);
  });

  // ── P4 ─────────────────────────────────────────────────────────────────────
  it("P4 future-dated, inverted-interval and malformed records are refused by the port", () => {
    expect(
      acceptKiteSessionValidationRecord(candidate({ validatedAtMs: NOW + 1 }), NOW),
    ).toEqual({ accepted: false, rejectionCode: KITE_SESSION_REJECTION.FUTURE_DATED });

    // validUntil <= validatedAt describes a window that never existed.
    expect(
      acceptKiteSessionValidationRecord(
        candidate({ validatedAtMs: NOW - 1_000, validUntilMs: NOW - 1_000 }),
        NOW,
      ).accepted,
    ).toBe(false);
    expect(
      acceptKiteSessionValidationRecord(
        candidate({ validatedAtMs: NOW - 1_000, validUntilMs: NOW - 5_000 }),
        NOW,
      ).accepted,
    ).toBe(false);

    // Already past its boundary at the moment of submission.
    expect(
      acceptKiteSessionValidationRecord(
        candidate({ validatedAtMs: NOW - 10_000, validUntilMs: NOW }),
        NOW,
      ),
    ).toEqual({ accepted: false, rejectionCode: KITE_SESSION_REJECTION.ALREADY_EXPIRED });

    for (const bad of [null, undefined, 42, "record", []]) {
      expect(acceptKiteSessionValidationRecord(bad, NOW).accepted).toBe(false);
    }
    for (const badTime of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(
        acceptKiteSessionValidationRecord(candidate({ validatedAtMs: badTime }), NOW).accepted,
      ).toBe(false);
      expect(
        acceptKiteSessionValidationRecord(candidate({ validUntilMs: badTime }), NOW).accepted,
      ).toBe(false);
    }
    // A non-finite clock cannot judge anything.
    expect(acceptKiteSessionValidationRecord(candidate(), Number.NaN).accepted).toBe(false);
    expect(getAcceptedKiteSessionValidationRecord()).toBeNull();
  });

  // ── P5 ─────────────────────────────────────────────────────────────────────
  it("P5 an unapproved port id or unknown provider is refused, and refusal is distinct from malformed", () => {
    const wrongPort = acceptKiteSessionValidationRecord(
      candidate({
        provenance: { producedByPortId: "SOME_OTHER_PORT", adapterId: "TEST_ADAPTER" },
      }),
      NOW,
    );
    expect(wrongPort).toEqual({
      accepted: false,
      rejectionCode: KITE_SESSION_REJECTION.UNAPPROVED_SOURCE,
    });

    expect(
      acceptKiteSessionValidationRecord(
        candidate({ provider: "UPSTOX" as unknown as "KITE" }),
        NOW,
      ).accepted,
    ).toBe(false);

    // Provenance is mandatory, not optional metadata.
    expect(
      acceptKiteSessionValidationRecord(
        { ...candidate(), provenance: undefined } as unknown,
        NOW,
      ).accepted,
    ).toBe(false);

    // A record that reaches the JUDGE with an unapproved port — i.e. one that
    // never came through the port at all — is refused there too, so bypassing
    // acceptance buys nothing.
    const forged = {
      provider: "KITE" as const,
      recordState: "VALID" as const,
      validatedAtMs: NOW - 1_000,
      validUntilMs: NOW + 1_000,
      validationPathId: "FORGED",
      provenance: {
        producedByPortId: "NOT_THE_APPROVED_PORT",
        adapterId: "FORGED_ADAPTER",
        acceptedAtMs: NOW - 1_000,
      },
    };
    const v = evaluateKiteSessionEvidence({
      validationRecord: forged,
      credentialsConfigured: true,
      nowMs: NOW,
    });
    expect(v.valid).toBe(false);
    expect(v.blockerCode).toBe(KITE_SESSION_BLOCKER.UNAPPROVED_SOURCE);
  });

  // ── P6 ─────────────────────────────────────────────────────────────────────
  it("P6 an unsafe validationPathId or adapterId cannot enter owner diagnostics", () => {
    const unsafe = [
      "path with spaces",
      "lowercase",
      "HAS-DASH",
      "HAS.DOT",
      "<script>",
      "",
      "A".repeat(65),
    ];
    for (const validationPathId of unsafe) {
      const r = acceptKiteSessionValidationRecord(candidate({ validationPathId }), NOW);
      expect(r.accepted, `validationPathId ${JSON.stringify(validationPathId)}`).toBe(false);
    }
    for (const adapterId of unsafe) {
      expect(
        acceptKiteSessionValidationRecord(
          candidate({
            provenance: { producedByPortId: APPROVED_KITE_VALIDATION_PORT_ID, adapterId },
          }),
          NOW,
        ).accepted,
        `adapterId ${JSON.stringify(adapterId)}`,
      ).toBe(false);
    }
  });

  // ── P7 ─────────────────────────────────────────────────────────────────────
  it("P7 an unknown field is refused rather than ignored, so a token cannot ride along", () => {
    const smuggled = {
      ...candidate(),
      accessToken: "should-never-be-stored",
    };
    expect(acceptKiteSessionValidationRecord(smuggled, NOW)).toEqual({
      accepted: false,
      rejectionCode: KITE_SESSION_REJECTION.UNEXPECTED_FIELD,
    });

    const smuggledProvenance = {
      ...candidate(),
      provenance: {
        producedByPortId: APPROVED_KITE_VALIDATION_PORT_ID,
        adapterId: "TEST_ADAPTER",
        apiSecret: "should-never-be-stored",
      },
    };
    expect(acceptKiteSessionValidationRecord(smuggledProvenance, NOW).accepted).toBe(false);
    expect(getAcceptedKiteSessionValidationRecord()).toBeNull();
  });

  // ── P8 ─────────────────────────────────────────────────────────────────────
  it("P8 an older or equal-timestamp record cannot displace an accepted one without invalidation", () => {
    expect(acceptKiteSessionValidationRecord(candidate({ validatedAtMs: NOW - 1_000 }), NOW).accepted).toBe(true);

    // Out-of-order arrival: the later-completing validation is not necessarily
    // the more recent observation, so an older one must not win a race.
    expect(
      acceptKiteSessionValidationRecord(candidate({ validatedAtMs: NOW - 5_000 }), NOW),
    ).toEqual({ accepted: false, rejectionCode: KITE_SESSION_REJECTION.NOT_NEWER_THAN_ACCEPTED });

    // Equal timestamps are refused too: two records claiming the same instant
    // cannot both be right and choosing between them would be a guess.
    expect(
      acceptKiteSessionValidationRecord(
        candidate({ validatedAtMs: NOW - 1_000, validationPathId: "DIFFERENT_PATH" }),
        NOW,
      ).accepted,
    ).toBe(false);
    expect(getAcceptedKiteSessionValidationRecord()?.validationPathId).toBe("KITE_PROFILE_PROBE");

    // Strictly newer is accepted.
    expect(
      acceptKiteSessionValidationRecord(
        candidate({ validatedAtMs: NOW - 500, validationPathId: "NEWER_PATH" }),
        NOW,
      ).accepted,
    ).toBe(true);
    expect(getAcceptedKiteSessionValidationRecord()?.validationPathId).toBe("NEWER_PATH");

    // Explicit invalidation is the deliberate act that makes room for anything.
    invalidateAcceptedKiteSessionValidationRecord();
    expect(getAcceptedKiteSessionValidationRecord()).toBeNull();
    expect(
      acceptKiteSessionValidationRecord(
        candidate({ validatedAtMs: NOW - 5_000, validationPathId: "OLDER_AFTER_INVALIDATION" }),
        NOW,
      ).accepted,
    ).toBe(true);
  });

  // ── P9 ─────────────────────────────────────────────────────────────────────
  it("P9 a caller holding a reference cannot mutate stored evidence", () => {
    const submitted = candidate();
    expect(acceptKiteSessionValidationRecord(submitted, NOW).accepted).toBe(true);

    // Mutating the object that was submitted must not reach into the store.
    (submitted as { validationPathId: string }).validationPathId = "MUTATED_AFTER_SUBMIT";
    (submitted.provenance as { adapterId: string }).adapterId = "MUTATED_ADAPTER";
    expect(getAcceptedKiteSessionValidationRecord()?.validationPathId).toBe("KITE_PROFILE_PROBE");
    expect(getAcceptedKiteSessionValidationRecord()?.provenance.adapterId).toBe("TEST_ADAPTER");

    // Reads are copies: two reads are equal but not the same object, and
    // mutating one cannot affect the next reader.
    const a = getAcceptedKiteSessionValidationRecord();
    const b = getAcceptedKiteSessionValidationRecord();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a?.provenance)).toBe(true);
    expect(() => {
      (a as unknown as { validUntilMs: number }).validUntilMs = NOW + 10_000_000;
    }).toThrow();
    expect(getAcceptedKiteSessionValidationRecord()?.validUntilMs).toBe(NOW + 60_000);
  });

  // ── P10 ────────────────────────────────────────────────────────────────────
  it("P10 owner diagnostics carry coded state only — no credential-shaped content", () => {
    acceptKiteSessionValidationRecord(candidate(), NOW);
    const v = evaluateKiteSessionEvidence({
      validationRecord: getAcceptedKiteSessionValidationRecord(),
      credentialsConfigured: true,
      nowMs: NOW,
    });
    const blob = JSON.stringify(v);
    for (const forbidden of ["accessToken", "access_token", "apiKey", "api_key", "requestToken", "password", "cookie", "Bearer"]) {
      expect(blob.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // Every detail is a coded token, not free text.
    for (const d of v.detailsSafeForOwnerDiagnostics) {
      expect(d).toMatch(/^[A-Z0-9_]+(=[A-Z0-9_]+)?$/);
    }
    // The verdict exposes only state and two timestamps.
    expect(Object.keys(v).sort()).toEqual(
      ["blockerCode", "detailsSafeForOwnerDiagnostics", "state", "valid", "validUntilMs", "validatedAtMs"].sort(),
    );
  });

  // ── P11 ────────────────────────────────────────────────────────────────────
  it("P11 even a VALID Kite record does not admit activation — other blockers remain", () => {
    expect(acceptKiteSessionValidationRecord(candidate({ validatedAtMs: Date.now() - 1_000, validUntilMs: Date.now() + 3_600_000 }), Date.now()).accepted).toBe(true);

    const nowMs = Date.now();
    const snap = buildProductionActivationSnapshot(nowMs);
    const kiteGate = snap.decision.gates.find((g) => g.gateId === "KITE_SESSION_VALID");
    expect(kiteGate?.state).toBe("PASS");

    // ...and the feed is still refused, by the compile-time lock among others.
    const aggregate = judgeAllRequiredEvidence(
      snap.decision.gates,
      nowMs,
      snap.decision.registryGenerationId,
    );
    expect(aggregate.admitted).toBe(false);
    if (aggregate.admitted) throw new Error("unreachable: activation must remain refused");
    expect(
      aggregate.blockingCodes.some((c: string) => c.startsWith("COMPILE_TIME_FEED_LOCK")),
    ).toBe(true);
  });

  // ── P12 ────────────────────────────────────────────────────────────────────
  it("P12 the production snapshot reports NOT_EVALUATED when the store is empty", () => {
    __resetKiteSessionEvidenceStoreForTests();
    const snap = buildProductionActivationSnapshot(Date.now());
    const kiteGate = snap.decision.gates.find((g) => g.gateId === "KITE_SESSION_VALID");
    expect(kiteGate?.state).toBe("NOT_EVALUATED");
    expect(snap.kiteSession.valid).toBe(false);
  });

  // ── P13 ────────────────────────────────────────────────────────────────────
  it("P13 the module performs no provider, socket, database, filesystem or timer work", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/feed/kiteSessionEvidence.ts"),
      "utf8",
    );
    // Imports: there must be none at all. A module with zero imports cannot
    // reach a provider, a socket or a database however it is called.
    expect(src).not.toMatch(/^\s*import\s/m);
    for (const forbidden of [
      "KiteTicker",
      "WebSocket",
      "require(",
      "setInterval",
      "setTimeout",
      "fetch(",
      "axios",
      "drizzle",
      "readFileSync",
      "writeFileSync",
      "process.env",
      ".subscribe(",
    ]) {
      expect(src, `forbidden token ${forbidden}`).not.toContain(forbidden);
    }
  });

  // ── P14 ────────────────────────────────────────────────────────────────────
  it("P14 the test reset helper has zero production callers", () => {
    // A reset helper that production can call is a write path that bypasses
    // every rule above, so its call sites are asserted rather than assumed.
    const out = execSync(
      "grep -rn '__resetKiteSessionEvidenceStoreForTests' src --include='*.ts' || true",
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const callers = out
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .filter((l) => !l.includes("src/lib/feed/kiteSessionEvidence.ts"))
      .filter((l) => !/\.test\.ts:/.test(l));
    expect(callers, `unexpected production callers:\n${callers.join("\n")}`).toEqual([]);
  });
});
