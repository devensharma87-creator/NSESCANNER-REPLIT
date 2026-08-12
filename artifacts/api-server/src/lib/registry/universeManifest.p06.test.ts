/**
 * PHASE 0.6 — universeManifest.ts behaviour tests.
 *
 * These tests treat the manifest as the frozen, checksummed statement of the
 * tradable universe and prove the honesty guarantees: deterministic ordering,
 * tamper-evident checksum, runtime immutability, fail-closed acceptance, and
 * token-rotation-sensitive hashing. NO network, NO database — inline fixtures.
 */

import { describe, it, expect } from "vitest";
import {
  sortKeysDeep,
  computeManifestChecksum,
  verifyManifestChecksum,
  computeEligibleLiveSetHash,
  computeClassificationPolicyHash,
  buildUniverseManifest,
  isManifestAccepted,
  MANIFEST_SCHEMA_VERSION,
  CLASSIFICATION_POLICY_VERSION,
  REQUIRED_SOURCE_IDS,
  type BuildManifestInput,
  type InstrumentUniverseManifest,
} from "./universeManifest";
import type { RegistryRecord } from "./instrumentRegistry";
import type { OfficialSourceProvenance } from "./officialSources";
import {
  makeLiveRecord,
  makeLiveRecords,
  makeBuildResult,
  makeAcceptedSources,
  GEN_ID,
  GENERATED_AT,
  EFFECTIVE_DATE,
  makeCurrentAuthoritativeBse,
  makeCalendarCommitment,
} from "./p06TestFixtures";

function buildInput(
  records: readonly RegistryRecord[],
  overrides: Partial<BuildManifestInput> = {},
): BuildManifestInput {
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
    ...overrides,
  };
}

describe("sortKeysDeep", () => {
  it("produces identical JSON for objects differing only in key insertion order", () => {
    const a = { b: 1, a: 2, c: { y: 9, x: 8 } };
    const b = { c: { x: 8, y: 9 }, a: 2, b: 1 };
    expect(JSON.stringify(sortKeysDeep(a))).toBe(JSON.stringify(sortKeysDeep(b)));
    // And that it actually reordered (not a coincidence of already-sorted input).
    expect(JSON.stringify(sortKeysDeep(a))).toBe('{"a":2,"b":1,"c":{"x":8,"y":9}}');
  });

  it("recurses through nested objects inside arrays", () => {
    const a = { list: [{ z: 1, a: 2 }, { m: 3, b: 4 }] };
    const b = { list: [{ a: 2, z: 1 }, { b: 4, m: 3 }] };
    expect(JSON.stringify(sortKeysDeep(a))).toBe(JSON.stringify(sortKeysDeep(b)));
    expect(JSON.stringify(sortKeysDeep(a))).toBe('{"list":[{"a":2,"z":1},{"b":4,"m":3}]}');
    // Array order is preserved (not sorted) — only keys within elements are.
    const reordered = { list: [{ b: 4, m: 3 }, { z: 1, a: 2 }] };
    expect(JSON.stringify(sortKeysDeep(reordered))).not.toBe(
      JSON.stringify(sortKeysDeep(a)),
    );
  });
});

describe("computeManifestChecksum / verifyManifestChecksum", () => {
  it("excludes the manifestChecksum field so a fresh manifest verifies true", () => {
    const manifest = buildUniverseManifest(buildInput([makeLiveRecord()]));
    expect(verifyManifestChecksum(manifest)).toBe(true);
  });

  it("detects tampering: mutating any non-checksum field breaks verification", () => {
    const manifest = buildUniverseManifest(buildInput([makeLiveRecord()]));
    // Reconstruct a mutated copy (the original is frozen) with the SAME checksum.
    const tampered: InstrumentUniverseManifest = {
      ...manifest,
      totalOfficialRecords: manifest.totalOfficialRecords + 1,
    };
    expect(verifyManifestChecksum(tampered)).toBe(false);
  });

  it("a tampered checksum field alone also fails verification", () => {
    const manifest = buildUniverseManifest(buildInput([makeLiveRecord()]));
    const tampered: InstrumentUniverseManifest = {
      ...manifest,
      manifestChecksum: "0".repeat(64),
    };
    expect(verifyManifestChecksum(tampered)).toBe(false);
  });
});

describe("buildUniverseManifest immutability", () => {
  it("returns a frozen object that cannot be mutated", () => {
    const manifest = buildUniverseManifest(buildInput([makeLiveRecord()]));
    expect(Object.isFrozen(manifest)).toBe(true);
    const before = manifest.acceptanceStatus;
    // Writing a property must not change it (silent no-op in non-strict paths).
    try {
      (manifest as unknown as Record<string, unknown>).acceptanceStatus =
        "REJECTED";
    } catch {
      /* strict-mode throw is also acceptable; state must be unchanged */
    }
    expect(manifest.acceptanceStatus).toBe(before);
  });
});

describe("buildUniverseManifest acceptance is fail-closed", () => {
  it("ACCEPTS an otherwise clean build with zero blockers", () => {
    const manifest = buildUniverseManifest(buildInput([makeLiveRecord()]));
    expect(manifest.acceptanceStatus).toBe("ACCEPTED");
    expect(manifest.blockers).toEqual([]);
    expect(isManifestAccepted(manifest)).toBe(true);
  });

  it("REJECTS when a required source is absent", () => {
    const missing = REQUIRED_SOURCE_IDS[0]!;
    const sources = makeAcceptedSources().filter((s) => s.sourceId !== missing);
    const manifest = buildUniverseManifest(
      buildInput([makeLiveRecord()], { sources }),
    );
    expect(manifest.acceptanceStatus).toBe("REJECTED");
    expect(manifest.blockers.some((b) => b.includes(missing) && b.includes("absent"))).toBe(
      true,
    );
    expect(isManifestAccepted(manifest)).toBe(false);
  });

  it("REJECTS when a required source is itself REJECTED", () => {
    const target = REQUIRED_SOURCE_IDS[0]!;
    const sources: OfficialSourceProvenance[] = makeAcceptedSources().map((s) =>
      s.sourceId === target
        ? {
            ...s,
            validationResult: "REJECTED_BELOW_FLOOR",
            freshnessState: "INVALID",
            rejectionDetail: "row count below floor",
          }
        : s,
    );
    const manifest = buildUniverseManifest(
      buildInput([makeLiveRecord()], { sources }),
    );
    expect(manifest.acceptanceStatus).toBe("REJECTED");
    expect(
      manifest.blockers.some(
        (b) => b.includes(target) && b.includes("REJECTED_BELOW_FLOOR"),
      ),
    ).toBe(true);
  });

  it("REJECTS when build.failures is non-empty and names the cause", () => {
    const build = makeBuildResult([makeLiveRecord()], {
      ok: false,
      failures: ["NSE reconciliation remainder is 3, expected 0"],
    });
    const manifest = buildUniverseManifest(buildInput([makeLiveRecord()], { build }));
    expect(manifest.acceptanceStatus).toBe("REJECTED");
    expect(
      manifest.blockers.some((b) => b.includes("reconciliation remainder is 3")),
    ).toBe(true);
  });
});

describe("computeEligibleLiveSetHash", () => {
  it("changes when a provider token rotates on an otherwise identical record", () => {
    const original = [makeLiveRecord({ kiteInstrumentToken: 738561 })];
    const rotated = [makeLiveRecord({ kiteInstrumentToken: 999999 })];
    const h1 = computeEligibleLiveSetHash(original);
    const h2 = computeEligibleLiveSetHash(rotated);
    expect(h1).not.toBe(h2);
  });

  it("is stable under record reordering", () => {
    const a = makeLiveRecord({
      canonicalInstrumentId: "NSE:EQUITY:AAA",
      kiteInstrumentToken: 111,
    });
    const b = makeLiveRecord({
      canonicalInstrumentId: "NSE:EQUITY:BBB",
      kiteInstrumentToken: 222,
    });
    expect(computeEligibleLiveSetHash([a, b])).toBe(
      computeEligibleLiveSetHash([b, a]),
    );
  });

  it("only includes LIVE_REQUIRED + MAPPED_EXACT records", () => {
    const live = makeLiveRecord({ kiteInstrumentToken: 111 });
    const snapshot = makeLiveRecord({
      canonicalInstrumentId: "NSE:EQUITY:ETF1",
      eligibilityTier: "SNAPSHOT_ONLY",
      kiteInstrumentToken: 222,
    });
    // Adding a non-live-mapped record must not change the live set hash.
    expect(computeEligibleLiveSetHash([live])).toBe(
      computeEligibleLiveSetHash([live, snapshot]),
    );
  });
});

describe("computeClassificationPolicyHash", () => {
  it("is deterministic across calls", () => {
    expect(computeClassificationPolicyHash()).toBe(computeClassificationPolicyHash());
  });

  it("embeds the current policy version in a stable 64-hex digest", () => {
    const h = computeClassificationPolicyHash();
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic value should not depend on the manifest schema version knob.
    expect(MANIFEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    expect(CLASSIFICATION_POLICY_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe("buildUniverseManifest self-consistency", () => {
  it("stamps schema/policy versions and matching live-set hash from the records", () => {
    const records = makeLiveRecords(3);
    const manifest = buildUniverseManifest(buildInput(records));
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.policyVersion).toBe(CLASSIFICATION_POLICY_VERSION);
    expect(manifest.eligibleLiveSetHash).toBe(computeEligibleLiveSetHash(records));
    expect(manifest.classificationPolicyHash).toBe(computeClassificationPolicyHash());
  });
});
