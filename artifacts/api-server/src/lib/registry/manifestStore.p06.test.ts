/**
 * PHASE 0.6 — manifestStore.ts PRE-COMMIT / LOAD gate tests.
 *
 * We test ONLY the pure, non-DB exports: validateGenerationForCommit and
 * acceptLoadedGeneration. The database module is mocked at module scope so no
 * real connection is ever established, and the DB-touching functions
 * (saveRegistryGeneration / loadLatestAcceptedGeneration) are NOT exercised.
 */

import { describe, it, expect, vi } from "vitest";

// Mock the DB module so importing manifestStore does not open a connection.
vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn(), transaction: vi.fn() },
}));

import {
  validateGenerationForCommit,
  acceptLoadedGeneration,
  MIN_RECORDS_FOR_COMMIT,
  type RegistryGeneration,
} from "./manifestStore";
import {
  buildUniverseManifest,
  computeManifestChecksum,
  type BuildManifestInput,
  type InstrumentUniverseManifest,
} from "./universeManifest";
import { REQUIRED_SOURCE_IDS } from "./universeManifest";
import type { RegistryRecord } from "./instrumentRegistry";
import {
  makeLiveRecords,
  makeBuildResult,
  makeAcceptedSources,
  GEN_ID,
  GENERATED_AT,
  EFFECTIVE_DATE,
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
    ...overrides,
  };
}

/** A valid generation at or above the durability floor. */
function makeValidGeneration(): RegistryGeneration {
  const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT);
  const manifest = buildUniverseManifest(buildInput(records));
  return { manifest, records };
}

/** Rebuild a manifest with one non-checksum field mutated (checksum stale). */
function tamperManifest(
  m: InstrumentUniverseManifest,
  patch: Partial<InstrumentUniverseManifest>,
): InstrumentUniverseManifest {
  return { ...m, ...patch };
}

describe("validateGenerationForCommit", () => {
  it("returns an empty array for a valid generation at the floor", () => {
    const gen = makeValidGeneration();
    expect(gen.records.length).toBe(MIN_RECORDS_FOR_COMMIT);
    expect(gen.manifest.acceptanceStatus).toBe("ACCEPTED");
    expect(validateGenerationForCommit(gen)).toEqual([]);
  });

  it("rejects a REJECTED manifest", () => {
    const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT);
    // Drop a required source -> manifest becomes REJECTED.
    const sources = makeAcceptedSources().filter(
      (s) => s.sourceId !== REQUIRED_SOURCE_IDS[0]!,
    );
    const manifest = buildUniverseManifest(buildInput(records, { sources }));
    expect(manifest.acceptanceStatus).toBe("REJECTED");
    const failures = validateGenerationForCommit({ manifest, records });
    expect(failures.some((f) => f.includes("acceptanceStatus is REJECTED"))).toBe(true);
  });

  it("rejects a tampered checksum", () => {
    const gen = makeValidGeneration();
    const manifest = tamperManifest(gen.manifest, {
      totalOfficialRecords: gen.manifest.totalOfficialRecords + 7,
    });
    const failures = validateGenerationForCommit({ manifest, records: gen.records });
    expect(failures.some((f) => f.includes("checksum does not match"))).toBe(true);
  });

  it("rejects a record count below MIN_RECORDS_FOR_COMMIT", () => {
    const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT - 1);
    const manifest = buildUniverseManifest(buildInput(records));
    const failures = validateGenerationForCommit({ manifest, records });
    expect(
      failures.some(
        (f) =>
          f.includes(`record count ${records.length}`) &&
          f.includes(`below the durability floor ${MIN_RECORDS_FOR_COMMIT}`),
      ),
    ).toBe(true);
  });

  it("rejects records whose eligible-live hash disagrees with the manifest", () => {
    const gen = makeValidGeneration();
    // Rotate a token on one record so the recomputed live-set hash diverges,
    // while leaving the manifest (and its checksum) untouched.
    const mutated = [...gen.records];
    mutated[0] = { ...mutated[0]!, kiteInstrumentToken: 424242 };
    const failures = validateGenerationForCommit({
      manifest: gen.manifest,
      records: mutated,
    });
    expect(
      failures.some((f) => f.includes("eligibleLiveSetHash does not match")),
    ).toBe(true);
  });

  it("rejects records carrying a foreign registryGenerationId", () => {
    // Build a coherent generation whose records all carry a DIFFERENT gen id
    // than the manifest, but whose live-set hash still matches (hash ignores
    // the generation id).
    const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT, "some-other-gen");
    const manifest = buildUniverseManifest(buildInput(records));
    // manifest.registryGenerationId is GEN_ID; records carry "some-other-gen".
    expect(manifest.registryGenerationId).toBe(GEN_ID);
    const failures = validateGenerationForCommit({ manifest, records });
    expect(
      failures.some((f) => f.includes("foreign registryGenerationId")),
    ).toBe(true);
  });
});

describe("acceptLoadedGeneration", () => {
  it("returns the generation unchanged when everything is valid", () => {
    const gen = makeValidGeneration();
    const accepted = acceptLoadedGeneration(gen, "L2_POSTGRESQL");
    expect(accepted).toBe(gen);
  });

  it("returns null on a schema-version mismatch", () => {
    const gen = makeValidGeneration();
    // Bump schemaVersion. Recompute the checksum so ONLY the version check fails.
    const withoutChecksum = {
      ...gen.manifest,
      schemaVersion: gen.manifest.schemaVersion + 1,
    };
    const manifest: InstrumentUniverseManifest = {
      ...withoutChecksum,
      manifestChecksum: computeManifestChecksum(withoutChecksum),
    };
    expect(acceptLoadedGeneration({ manifest, records: gen.records }, "L1_DISK")).toBeNull();
  });

  it("returns null on a policy-version mismatch", () => {
    const gen = makeValidGeneration();
    const withoutChecksum = {
      ...gen.manifest,
      policyVersion: gen.manifest.policyVersion + 1,
    };
    const manifest: InstrumentUniverseManifest = {
      ...withoutChecksum,
      manifestChecksum: computeManifestChecksum(withoutChecksum),
    };
    expect(
      acceptLoadedGeneration({ manifest, records: gen.records }, "L2_POSTGRESQL"),
    ).toBeNull();
  });

  it("returns null on a REJECTED manifest", () => {
    const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT);
    const sources = makeAcceptedSources().filter(
      (s) => s.sourceId !== REQUIRED_SOURCE_IDS[0]!,
    );
    const manifest = buildUniverseManifest(buildInput(records, { sources }));
    expect(manifest.acceptanceStatus).toBe("REJECTED");
    // Its checksum is internally valid; rejection is on acceptance status.
    expect(acceptLoadedGeneration({ manifest, records }, "L2_POSTGRESQL")).toBeNull();
  });

  it("returns null on a checksum mismatch", () => {
    const gen = makeValidGeneration();
    const manifest = tamperManifest(gen.manifest, {
      totalOfficialRecords: gen.manifest.totalOfficialRecords + 1,
    });
    expect(acceptLoadedGeneration({ manifest, records: gen.records }, "L1_DISK")).toBeNull();
  });
});
