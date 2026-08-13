/**
 * PHASE 0.8A — SUBSCRIPTION ADMISSION MANIFEST (16 targeted tests)
 *
 * Exercises the REAL production builder against generations produced by the
 * REAL universe-manifest builder and the accepted Phase 0.6 fixtures. No
 * re-implementation of the rules under test, no relaxed gate, no mocked hash.
 */

import { describe, it, expect } from "vitest";

import {
  ALL_SUBSCRIPTION_CLASSIFICATIONS,
  SUBSCRIPTION_MANIFEST_INVALID_BLOCKER,
  buildSubscriptionAdmissionManifest,
  classifyRecord,
  computeSubscriptionSetHash,
  isExchangeQualifiedMapping,
  isUsableProviderToken,
} from "./subscriptionManifest";
import {
  buildUniverseManifest,
  computeManifestChecksum,
  REQUIRED_SOURCE_IDS,
  type BuildManifestInput,
  type InstrumentUniverseManifest,
} from "./universeManifest";
import { MIN_RECORDS_FOR_COMMIT, type RegistryGeneration } from "./manifestStore";
import type { RegistryRecord } from "./instrumentRegistry";
import {
  makeLiveRecord,
  makeLiveRecords,
  makeBuildResult,
  makeAcceptedSources,
  makeCurrentAuthoritativeBse,
  makeCalendarCommitment,
  GEN_ID,
  GENERATED_AT,
  EFFECTIVE_DATE,
} from "./p06TestFixtures";

/** 2026-08-12T09:30Z — IST 15:00 Wednesday, the instant the fixtures were built. */
const BUILD_MS = Date.parse(GENERATED_AT);
/**
 * Ten minutes later — IST 15:10, still inside the same IST day AND still before
 * the 15:30 close, so neither expiry clock has ticked over yet.
 */
const SAME_DAY_MS = BUILD_MS + 600_000;
/** The next IST day: the stored BSE List has expired even though bytes are intact. */
const NEXT_DAY_MS = BUILD_MS + 86_400_000;

function buildInput(records: readonly RegistryRecord[]): BuildManifestInput {
  return {
    build: makeBuildResult(records),
    sources: makeAcceptedSources(),
    manifestVersion: 1,
    registryGenerationId: GEN_ID,
    generatedAt: GENERATED_AT,
    effectiveDate: EFFECTIVE_DATE,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
    bseAuthority: makeCurrentAuthoritativeBse(),
    tradingCalendar: makeCalendarCommitment(),
  };
}

/** A real, intact Schema-5 generation built through the production builder. */
function makeGeneration(records: readonly RegistryRecord[]): RegistryGeneration {
  return { manifest: buildUniverseManifest(buildInput(records)), records: [...records] };
}

function validGeneration(): RegistryGeneration {
  return makeGeneration(makeLiveRecords(MIN_RECORDS_FOR_COMMIT));
}

function admit(generation: RegistryGeneration, nowMs: number) {
  return buildSubscriptionAdmissionManifest({ generation, nowMs, restorationSettled: true });
}

describe("P08A M1-M10 — classification is total, exclusive and evidence-based", () => {
  it("M1 every record lands in exactly one bucket and the remainder is zero", () => {
    const mixed: RegistryRecord[] = [
      ...makeLiveRecords(4),
      makeLiveRecord({ tradingSymbol: "NULLID", canonicalInstrumentId: null, kiteInstrumentToken: 11 }),
      makeLiveRecord({ tradingSymbol: "CONFL", conflictStatus: "DUPLICATE_PROVIDER_TOKEN", kiteInstrumentToken: 12 }),
      makeLiveRecord({ tradingSymbol: "SUSP", listingStatus: "SUSPENDED", kiteInstrumentToken: 13 }),
      makeLiveRecord({
        tradingSymbol: "NCD",
        eligibilityTier: "EXCLUDED_NON_STOCK",
        securityClass: "CORPORATE_DEBT",
        kiteInstrumentToken: 14,
      }),
      makeLiveRecord({ tradingSymbol: "SNAP", eligibilityTier: "SNAPSHOT_ONLY", kiteInstrumentToken: 15 }),
      makeLiveRecord({
        tradingSymbol: "UNK",
        eligibilityTier: "UNRESOLVED",
        securityClass: "UNRESOLVED",
        kiteInstrumentToken: 16,
      }),
      makeLiveRecord({ tradingSymbol: "NOTOK", kiteInstrumentToken: null, mappingStatus: "UNMAPPED_NO_PROVIDER_RECORD" }),
    ];
    const seen = mixed.map(classifyRecord);
    // Exactly one bucket each, and every bucket is a member of the closed set.
    expect(seen).toHaveLength(mixed.length);
    for (const c of seen) expect(ALL_SUBSCRIPTION_CLASSIFICATIONS).toContain(c);
    const counted = ALL_SUBSCRIPTION_CLASSIFICATIONS.reduce(
      (n, k) => n + seen.filter((c) => c === k).length,
      0,
    );
    expect(counted).toBe(mixed.length);
  });

  it("M2 a live token must be a positive safe integer", () => {
    expect(isUsableProviderToken(738561)).toBe(true);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, null, "738561", undefined]) {
      expect(isUsableProviderToken(bad)).toBe(false);
    }
    expect(classifyRecord(makeLiveRecord({ kiteInstrumentToken: 0 }))).toBe("LIVE_UNMAPPED");
    expect(classifyRecord(makeLiveRecord({ kiteInstrumentToken: -5 }))).toBe("LIVE_UNMAPPED");
    expect(classifyRecord(makeLiveRecord({ kiteInstrumentToken: 1.5 }))).toBe("LIVE_UNMAPPED");
  });

  it("M3 a token that is not exchange-qualified never becomes LIVE_MAPPED", () => {
    const crossExchange = makeLiveRecord({ exchange: "NSE", kiteExchange: "BSE" });
    expect(isExchangeQualifiedMapping(crossExchange)).toBe(false);
    expect(classifyRecord(crossExchange)).toBe("LIVE_UNMAPPED");
    expect(classifyRecord(makeLiveRecord({ kiteExchange: null }))).toBe("LIVE_UNMAPPED");
    // Case and padding are normalised, not treated as a different exchange.
    expect(classifyRecord(makeLiveRecord({ kiteExchange: " nse " }))).toBe("LIVE_MAPPED");
  });

  it("M4 IDENTITY_INVALID outranks every other verdict", () => {
    expect(classifyRecord(makeLiveRecord({ canonicalInstrumentId: null }))).toBe("IDENTITY_INVALID");
    expect(classifyRecord(makeLiveRecord({ canonicalInstrumentId: "   " }))).toBe("IDENTITY_INVALID");
    // Even with a token conflict AND a dead listing, the unnameable record is
    // reported as unnameable — the most fundamental defect wins.
    expect(
      classifyRecord(
        makeLiveRecord({
          canonicalInstrumentId: null,
          conflictStatus: "DUPLICATE_PROVIDER_TOKEN",
          listingStatus: "DELISTED",
        }),
      ),
    ).toBe("IDENTITY_INVALID");
  });

  it("M5 a disputed provider mapping is never downgraded into a benign bucket", () => {
    expect(classifyRecord(makeLiveRecord({ conflictStatus: "DUPLICATE_PROVIDER_TOKEN" }))).toBe(
      "PROVIDER_TOKEN_CONFLICT",
    );
    expect(classifyRecord(makeLiveRecord({ conflictStatus: "AMBIGUOUS_PROVIDER_MATCH" }))).toBe(
      "PROVIDER_TOKEN_CONFLICT",
    );
    expect(classifyRecord(makeLiveRecord({ mappingStatus: "REJECTED_DUPLICATE_TOKEN" }))).toBe(
      "PROVIDER_TOKEN_CONFLICT",
    );
    expect(classifyRecord(makeLiveRecord({ mappingStatus: "REJECTED_AMBIGUOUS_MATCH" }))).toBe(
      "PROVIDER_TOKEN_CONFLICT",
    );
  });

  it("M6 an undetermined class, and an active-but-unsupported record, are explicit", () => {
    expect(classifyRecord(makeLiveRecord({ securityClass: "UNRESOLVED" }))).toBe("UNSUPPORTED_SECURITY_CLASS");
    expect(classifyRecord(makeLiveRecord({ eligibilityTier: "UNRESOLVED" }))).toBe(
      "UNSUPPORTED_SECURITY_CLASS",
    );
    expect(
      classifyRecord(makeLiveRecord({ eligibilityTier: "UNAVAILABLE", listingStatus: "ACTIVE" })),
    ).toBe("UNSUPPORTED_SECURITY_CLASS");
  });

  it("M7 anything the exchange does not list as ACTIVE is LISTING_NOT_ACTIVE", () => {
    for (const status of ["SUSPENDED", "DELISTED", "UNKNOWN"] as const) {
      expect(classifyRecord(makeLiveRecord({ listingStatus: status }))).toBe("LISTING_NOT_ACTIVE");
    }
    // Defensive: a LIVE_REQUIRED tier can never launder a dead listing into a
    // live subscription slot.
    expect(
      classifyRecord(makeLiveRecord({ eligibilityTier: "LIVE_REQUIRED", listingStatus: "SUSPENDED" })),
    ).toBe("LISTING_NOT_ACTIVE");
  });

  it("M8 officially non-stock instruments are EXCLUDED on their recorded class", () => {
    expect(
      classifyRecord(
        makeLiveRecord({ eligibilityTier: "EXCLUDED_NON_STOCK", securityClass: "GOVERNMENT_SECURITY" }),
      ),
    ).toBe("EXCLUDED");
    expect(
      classifyRecord(makeLiveRecord({ eligibilityTier: "EXCLUDED_NON_STOCK", securityClass: "ETF_OR_FUND" })),
    ).toBe("EXCLUDED");
    // The exclusion follows the tier the registry recorded, not the symbol text.
    expect(
      classifyRecord(makeLiveRecord({ tradingSymbol: "NIFTYBEES", eligibilityTier: "LIVE_REQUIRED" })),
    ).toBe("LIVE_MAPPED");
  });

  it("M9 the snapshot tier keeps its own bucket and never enters the live set", () => {
    expect(classifyRecord(makeLiveRecord({ eligibilityTier: "SNAPSHOT_ONLY" }))).toBe("SNAPSHOT_ONLY");
    const m = admit(
      makeGeneration([
        ...makeLiveRecords(MIN_RECORDS_FOR_COMMIT),
        makeLiveRecord({
          tradingSymbol: "SNAPONLY",
          canonicalInstrumentId: "NSE:EQUITY:SNAPONLY",
          eligibilityTier: "SNAPSHOT_ONLY",
          kiteInstrumentToken: 77,
        }),
      ]),
      SAME_DAY_MS,
    );
    expect(m.classificationCounts.SNAPSHOT_ONLY).toBe(1);
    expect(m.admitted.some((a) => a.canonicalInstrumentId === "NSE:EQUITY:SNAPONLY")).toBe(false);
    expect(m.liveRequired.total).toBe(MIN_RECORDS_FOR_COMMIT);
  });

  it("M10 the LIVE_REQUIRED equation balances across every diversion", () => {
    const records: RegistryRecord[] = [
      ...makeLiveRecords(MIN_RECORDS_FOR_COMMIT),
      makeLiveRecord({ tradingSymbol: "NOTOKEN", canonicalInstrumentId: "NSE:EQUITY:NOTOKEN", kiteInstrumentToken: null, kiteExchange: null, mappingStatus: "UNMAPPED_NO_PROVIDER_RECORD" }),
      makeLiveRecord({ tradingSymbol: "NOID", canonicalInstrumentId: null, kiteInstrumentToken: 91 }),
      makeLiveRecord({ tradingSymbol: "DUP", canonicalInstrumentId: "NSE:EQUITY:DUP", conflictStatus: "DUPLICATE_PROVIDER_TOKEN", kiteInstrumentToken: 92 }),
      makeLiveRecord({ tradingSymbol: "DEAD", canonicalInstrumentId: "NSE:EQUITY:DEAD", listingStatus: "DELISTED", kiteInstrumentToken: 93 }),
    ];
    const m = admit(makeGeneration(records), SAME_DAY_MS);
    expect(m.state).toBe("ACTIVATABLE_CURRENT");
    expect(m.liveRequired.total).toBe(MIN_RECORDS_FOR_COMMIT + 4);
    expect(m.liveRequired.mapped).toBe(MIN_RECORDS_FOR_COMMIT);
    expect(m.liveRequired.unmapped).toBe(1);
    expect(m.liveRequired.divertedIdentityInvalid).toBe(1);
    expect(m.liveRequired.divertedTokenConflict).toBe(1);
    expect(m.liveRequired.divertedListingNotActive).toBe(1);
    expect(m.liveRequired.balances).toBe(true);
    // And the buckets still cover every record with nothing left over.
    const sum = ALL_SUBSCRIPTION_CLASSIFICATIONS.reduce((n, k) => n + m.classificationCounts[k], 0);
    expect(sum).toBe(m.totalRecords);
    expect(m.remainder).toBe(0);
  });
});

describe("P08A M11-M16 — two outputs, fail-closed integrity, stable commitment", () => {
  it("M11 an intact 12-Aug generation read on 13-Aug is a CANDIDATE, never activatable", () => {
    const m = admit(validGeneration(), NEXT_DAY_MS);
    expect(m.state).toBe("CANDIDATE_LAST_KNOWN");
    expect(m.activationAuthorized).toBe(false);
    expect(m.authorityState).toBe("LAST_KNOWN");
    expect(m.blockers).toContain("REGISTRY_AUTHORITY_NOT_CURRENT");
    // It is a candidate, not a ruin: the set is still fully classified.
    expect(m.admitted.length).toBe(MIN_RECORDS_FOR_COMMIT);
    expect(m.blockerCode).toBeNull();
  });

  it("M12 the same generation inside its own IST day is ACTIVATABLE_CURRENT", () => {
    const m = admit(validGeneration(), SAME_DAY_MS);
    expect(m.state).toBe("ACTIVATABLE_CURRENT");
    expect(m.activationAuthorized).toBe(true);
    expect(m.authorityState).toBe("CURRENT_AUTHORITATIVE");
    expect(m.blockers).toEqual([]);
  });

  it("M13 an unsettled restoration is unanswered, not an empty universe", () => {
    const m = buildSubscriptionAdmissionManifest({
      generation: validGeneration(),
      nowMs: SAME_DAY_MS,
      restorationSettled: false,
    });
    expect(m.state).toBe("UNAVAILABLE");
    expect(m.activationAuthorized).toBe(false);
    expect(m.blockers).toEqual(["REGISTRY_RESTORATION_NOT_SETTLED"]);
    expect(m.admitted).toEqual([]);
    expect(m.subscriptionSetHash).toBeNull();
    // "Not settled" is not a structural defect, so it is not the invalid blocker.
    expect(m.blockerCode).toBeNull();

    const absent = buildSubscriptionAdmissionManifest({
      generation: null,
      nowMs: SAME_DAY_MS,
      restorationSettled: true,
    });
    expect(absent.state).toBe("UNAVAILABLE");
    expect(absent.blockers).toEqual(["REGISTRY_NOT_CONFIGURED"]);
  });

  it("M14 tampered payloads fail closed with the reserved blocker string", () => {
    const base = validGeneration();

    // (a) checksum tampering: one field edited, checksum left alone.
    const edited: InstrumentUniverseManifest = {
      ...base.manifest,
      totalOfficialRecords: base.manifest.totalOfficialRecords + 1,
    };
    const a = admit({ manifest: edited, records: base.records }, SAME_DAY_MS);
    expect(a.state).toBe("UNAVAILABLE");
    expect(a.blockerCode).toBe(SUBSCRIPTION_MANIFEST_INVALID_BLOCKER);
    expect(a.blockers).toContain("MANIFEST_CHECKSUM_MISMATCH");
    expect(a.admitted).toEqual([]);

    // (b) a self-consistent manifest written under a schema this code does not
    // speak: checksum recomputed, so only the version gate can catch it.
    const { manifestChecksum: _drop, ...rest } = base.manifest;
    const wrongSchema = { ...rest, schemaVersion: 4 } as Omit<InstrumentUniverseManifest, "manifestChecksum">;
    const b = admit(
      {
        manifest: { ...wrongSchema, manifestChecksum: computeManifestChecksum(wrongSchema) },
        records: base.records,
      },
      SAME_DAY_MS,
    );
    expect(b.blockers).toContain("SCHEMA_VERSION_UNSUPPORTED");
    expect(b.blockerCode).toBe(SUBSCRIPTION_MANIFEST_INVALID_BLOCKER);

    // (c) a record silently removed after the manifest was committed.
    const c = admit({ manifest: base.manifest, records: base.records.slice(1) }, SAME_DAY_MS);
    expect(c.blockers).toEqual(
      expect.arrayContaining(["RECORD_COUNT_MISMATCH", "RECORD_SET_HASH_MISMATCH"]),
    );
    expect(c.admitted).toEqual([]);

    // (d) the eligible-live commitment swapped for one describing another set,
    // with the checksum recomputed so only re-derivation can catch it.
    const swappedLive = {
      ...rest,
      eligibleLiveSetHash: "0".repeat(base.manifest.eligibleLiveSetHash.length),
    } as Omit<InstrumentUniverseManifest, "manifestChecksum">;
    const d = admit(
      {
        manifest: { ...swappedLive, manifestChecksum: computeManifestChecksum(swappedLive) },
        records: base.records,
      },
      SAME_DAY_MS,
    );
    expect(d.blockers).toContain("ELIGIBLE_LIVE_SET_HASH_MISMATCH");
    expect(d.activationAuthorized).toBe(false);
    expect(d.admitted).toEqual([]);

    // (e) records spliced in from a different generation.
    const foreign = base.records.map((r, i) =>
      i === 0 ? { ...r, registryGenerationId: "P06-someothergeneration" } : r,
    );
    expect(admit({ manifest: base.manifest, records: foreign }, SAME_DAY_MS).blockers).toContain(
      "FOREIGN_REGISTRY_GENERATION_ID_IN_RECORDS",
    );

    // (f) a self-consistent but truncated universe is below the durability
    // floor and may not speak for the market.
    const short = admit(makeGeneration(makeLiveRecords(MIN_RECORDS_FOR_COMMIT - 1)), SAME_DAY_MS);
    expect(short.blockers).toContain("RECORD_COUNT_BELOW_DURABILITY_FLOOR");
    expect(short.state).toBe("UNAVAILABLE");
    expect(short.blockerCode).toBe(SUBSCRIPTION_MANIFEST_INVALID_BLOCKER);
  });

  it("M15 two identities claiming one provider token invalidate the manifest, not one row", () => {
    const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT);
    const collided = records.map((r, i) =>
      i === 1 ? { ...r, kiteInstrumentToken: records[0].kiteInstrumentToken } : r,
    );
    const m = admit(makeGeneration(collided), SAME_DAY_MS);
    expect(m.state).toBe("UNAVAILABLE");
    expect(m.blockerCode).toBe(SUBSCRIPTION_MANIFEST_INVALID_BLOCKER);
    expect(m.blockers).toContain("DUPLICATE_PROVIDER_TOKEN_IN_ADMITTED_SET");
    // Emphatically NOT deduplicated into a 999-instrument "working" set.
    expect(m.admitted).toEqual([]);
    expect(m.subscriptionSetHash).toBeNull();
  });

  it("M16 the subscription-set commitment is stable, ordered and count-bound", () => {
    const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT);
    const forward = admit(makeGeneration(records), SAME_DAY_MS);
    const reversed = admit(makeGeneration([...records].reverse()), SAME_DAY_MS);
    expect(reversed.subscriptionSetHash).toBe(forward.subscriptionSetHash);
    expect(reversed.admitted.map((a) => a.canonicalInstrumentId)).toEqual(
      forward.admitted.map((a) => a.canonicalInstrumentId),
    );

    // One token changed → a different commitment.
    const moved = records.map((r, i) => (i === 5 ? { ...r, kiteInstrumentToken: 9_999_999 } : r));
    expect(admit(makeGeneration(moved), SAME_DAY_MS).subscriptionSetHash).not.toBe(
      forward.subscriptionSetHash,
    );

    // A truncated set can never collide with the full one: the count is in the
    // preimage, not merely implied by the body.
    expect(computeSubscriptionSetHash(forward.admitted.slice(0, 999))).not.toBe(
      forward.subscriptionSetHash,
    );
  });
});
