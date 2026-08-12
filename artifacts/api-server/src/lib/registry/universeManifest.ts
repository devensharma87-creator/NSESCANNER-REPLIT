/**
 * PHASE 0.6 — VERSIONED, IMMUTABLE UNIVERSE MANIFEST
 *
 * A manifest is the frozen, checksummed statement of what the tradable universe
 * WAS at one generation. It is never edited in place: a change produces a new
 * generation with a new version, so any stored coverage number can always be
 * re-derived from the exact manifest that produced it.
 *
 * ACCEPTANCE IS FAIL-CLOSED. A manifest that fails any gate is retained as
 * REJECTED evidence and must not replace the previous accepted manifest. A
 * partial or failed generation never becomes the active universe.
 */

import { createHash } from "node:crypto";
import {
  ALL_ELIGIBILITY_TIERS,
  ALL_SECURITY_CLASSES,
  assignEligibilityTier,
  type EligibilityTier,
  type RegistryListingStatus,
} from "./securityClassification";
import type { OfficialSourceProvenance, ReferenceFreshnessState } from "./officialSources";
import { isSourceAccepted } from "./officialSources";
import type {
  ExchangeReconciliation,
  RegistryBuildResult,
  RegistryRecord,
} from "./instrumentRegistry";

/** Bump when the manifest SHAPE changes. Stored, and re-verified on load. */
export const MANIFEST_SCHEMA_VERSION = 2;
/** Bump when the CLASSIFICATION or TIER policy changes meaning. */
export const CLASSIFICATION_POLICY_VERSION = 1;

export type ManifestAcceptanceStatus = "ACCEPTED" | "REJECTED";

export interface TierCounts {
  readonly LIVE_REQUIRED: number;
  readonly SNAPSHOT_ONLY: number;
  readonly UNAVAILABLE: number;
  readonly EXCLUDED_NON_STOCK: number;
  readonly UNRESOLVED: number;
}

export interface InstrumentUniverseManifest {
  readonly manifestVersion: number;
  readonly registryGenerationId: string;
  readonly generatedAt: string;
  readonly effectiveDate: string;
  readonly schemaVersion: number;
  readonly policyVersion: number;

  readonly sourceProvenance: readonly OfficialSourceProvenance[];
  readonly referenceFreshness: readonly {
    readonly sourceId: string;
    readonly freshnessState: ReferenceFreshnessState;
  }[];

  readonly nse: ExchangeReconciliation;
  readonly bse: ExchangeReconciliation;
  readonly tierCounts: TierCounts;
  readonly indexCount: number;
  readonly totalOfficialRecords: number;
  readonly unmappedLiveCount: number;
  readonly unresolvedCount: number;
  readonly ambiguousMappingCount: number;

  /** Hash of the LIVE_REQUIRED set actually mapped to a provider token. */
  readonly eligibleLiveSetHash: string;
  /**
   * Commitment over the ENTIRE record set, not just the mapped-live subset.
   *
   * `eligibleLiveSetHash` deliberately covers only mapped LIVE_REQUIRED rows,
   * so on its own it cannot detect the most dangerous tampering there is: an
   * UNMAPPED LIVE_REQUIRED record being removed or demoted to a non-live tier.
   * That record is part of the coverage denominator precisely BECAUSE it is
   * required but unobtainable, so losing it silently shrinks the denominator
   * and overstates coverage while every other hash still verifies.
   */
  readonly recordSetHash: string;
  /** Fingerprint of the classification + tier policy that produced this. */
  readonly classificationPolicyHash: string;
  /** Hash over the whole manifest with this field removed. */
  readonly manifestChecksum: string;

  readonly acceptanceStatus: ManifestAcceptanceStatus;
  readonly blockers: readonly string[];
}

/** Deterministic key ordering so the checksum is stable across runs. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeysDeep(src[k]);
    return out;
  }
  return value;
}

/**
 * Canonical checksum. The manifest's own checksum field is REMOVED before
 * hashing, so a stored manifest can be re-verified by recomputing the hash of
 * everything except the hash itself.
 */
export function computeManifestChecksum(manifest: Omit<InstrumentUniverseManifest, "manifestChecksum">): string {
  const { ...rest } = manifest as Record<string, unknown>;
  delete rest.manifestChecksum;
  return createHash("sha256").update(JSON.stringify(sortKeysDeep(rest)), "utf8").digest("hex");
}

export function verifyManifestChecksum(manifest: InstrumentUniverseManifest): boolean {
  return computeManifestChecksum(manifest) === manifest.manifestChecksum;
}

/**
 * Fingerprint of the tier policy: every (class, listing status) pair is
 * evaluated and hashed. Any change in classification meaning changes this hash,
 * so a coverage number computed under an old policy can never be silently
 * compared against a new one.
 */
export function computeClassificationPolicyHash(): string {
  const statuses: RegistryListingStatus[] = ["ACTIVE", "SUSPENDED", "DELISTED", "UNKNOWN"];
  const lines: string[] = [`policyVersion=${CLASSIFICATION_POLICY_VERSION}`];
  for (const securityClass of ALL_SECURITY_CLASSES) {
    for (const listingStatus of statuses) {
      lines.push(`${securityClass}|${listingStatus}=${assignEligibilityTier({ securityClass, listingStatus }).tier}`);
    }
  }
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

/**
 * Hash of the live subscription set. Includes the provider token, so a token
 * rotation that silently re-points an instrument changes the hash.
 */
export function computeEligibleLiveSetHash(records: readonly RegistryRecord[]): string {
  const entries = records
    .filter((r) => r.eligibilityTier === "LIVE_REQUIRED" && r.mappingStatus === "MAPPED_EXACT")
    .map((r) => `${r.canonicalInstrumentId ?? "NULL"}|${r.kiteInstrumentToken ?? "NULL"}`)
    .sort();
  return createHash("sha256").update(entries.join("\n"), "utf8").digest("hex");
}

/**
 * Commitment over EVERY record, in every tier, mapped or not.
 *
 * Each field included here is one a consumer relies on when deciding whether an
 * instrument belongs in a denominator. A change to any of them must invalidate
 * the generation rather than quietly alter what "the universe" means.
 */
export function computeRecordSetHash(records: readonly RegistryRecord[]): string {
  const entries = records
    .map((r) =>
      [
        r.authoritativeSecurityId,
        r.canonicalInstrumentId ?? "NULL",
        r.exchange,
        r.segment,
        r.securityClass,
        r.listingStatus,
        r.eligibilityTier,
        r.mappingStatus,
        r.kiteInstrumentToken ?? "NULL",
      ].join("|"),
    )
    .sort();
  return createHash("sha256")
    .update(`count=${records.length}\n${entries.join("\n")}`, "utf8")
    .digest("hex");
}

function tallyTiers(records: readonly RegistryRecord[]): TierCounts {
  const counts: Record<EligibilityTier, number> = {
    LIVE_REQUIRED: 0,
    SNAPSHOT_ONLY: 0,
    UNAVAILABLE: 0,
    EXCLUDED_NON_STOCK: 0,
    UNRESOLVED: 0,
  };
  for (const r of records) counts[r.eligibilityTier]++;
  return counts;
}

export interface BuildManifestInput {
  readonly build: RegistryBuildResult;
  readonly sources: readonly OfficialSourceProvenance[];
  readonly manifestVersion: number;
  readonly registryGenerationId: string;
  readonly generatedAt: string;
  readonly effectiveDate: string;
  /** Sources that MUST be ACCEPTED for the manifest to be accepted. */
  readonly requiredSourceIds: readonly string[];
}

export const REQUIRED_SOURCE_IDS: readonly string[] = [
  "NSE_EQUITY_L",
  "NSE_SME_EQUITY_L",
  "NSE_ETF_LIST",
  "BSE_LIST_OF_SCRIPS_ACTIVE",
  "BSE_LIST_OF_SCRIPS_SUSPENDED",
  "KITE_INSTRUMENT_MASTER",
];

export function buildUniverseManifest(input: BuildManifestInput): InstrumentUniverseManifest {
  const { build, sources, manifestVersion, registryGenerationId, generatedAt, effectiveDate } = input;
  const all = [...build.records, ...build.indexRecords];

  const blockers: string[] = [];

  // Gate 1 — every required source validated.
  for (const id of input.requiredSourceIds) {
    const p = sources.find((s) => s.sourceId === id);
    if (!p) {
      blockers.push(`required source ${id} is absent from this generation`);
    } else if (!isSourceAccepted(p)) {
      blockers.push(`required source ${id} is ${p.validationResult}: ${p.rejectionDetail ?? "no detail"}`);
    }
  }

  // Gate 2 — reconciliation closed on both exchanges.
  blockers.push(...build.failures);

  // Gate 3 — no record may sit outside the closed tier set.
  for (const r of all) {
    if (!ALL_ELIGIBILITY_TIERS.includes(r.eligibilityTier)) {
      blockers.push(`${r.authoritativeSecurityId} has tier outside the closed set`);
    }
  }

  const tierCounts = tallyTiers(all);
  const unmappedLiveCount = build.nse.unmappedLive + build.bse.unmappedLive;
  const unresolvedCount = all.filter((r) => r.eligibilityTier === "UNRESOLVED").length;
  const ambiguousMappingCount = build.nse.ambiguousMappingCount + build.bse.ambiguousMappingCount;

  const withoutChecksum: Omit<InstrumentUniverseManifest, "manifestChecksum"> = {
    manifestVersion,
    registryGenerationId,
    generatedAt,
    effectiveDate,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    policyVersion: CLASSIFICATION_POLICY_VERSION,
    sourceProvenance: [...sources].sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1)),
    referenceFreshness: [...sources]
      .map((s) => ({ sourceId: s.sourceId, freshnessState: s.freshnessState }))
      .sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1)),
    nse: build.nse,
    bse: build.bse,
    tierCounts,
    indexCount: build.indexRecords.length,
    totalOfficialRecords: build.records.length,
    unmappedLiveCount,
    unresolvedCount,
    ambiguousMappingCount,
    eligibleLiveSetHash: computeEligibleLiveSetHash(all),
    recordSetHash: computeRecordSetHash(all),
    classificationPolicyHash: computeClassificationPolicyHash(),
    acceptanceStatus: blockers.length === 0 ? "ACCEPTED" : "REJECTED",
    blockers: [...blockers].sort(),
  };

  const manifest: InstrumentUniverseManifest = {
    ...withoutChecksum,
    manifestChecksum: computeManifestChecksum(withoutChecksum),
  };
  // Immutable by contract AND at runtime.
  return Object.freeze(manifest);
}

export function isManifestAccepted(m: InstrumentUniverseManifest): boolean {
  return m.acceptanceStatus === "ACCEPTED" && m.blockers.length === 0;
}
