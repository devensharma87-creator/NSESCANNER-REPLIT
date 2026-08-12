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
import type { BseReferenceAuthorityResult } from "./bseReferencePolicy";
import { isPolicyIssuedAuthority } from "./bseReferencePolicy";
import type { TradingCalendarCommitment } from "./exchangeCalendar";
import { evaluateCalendarAuthorityNow, verifyCalendarCommitmentIntegrity } from "./exchangeCalendar";
import { isSourceAccepted } from "./officialSources";
import type {
  ExchangeReconciliation,
  RegistryBuildResult,
  RegistryRecord,
} from "./instrumentRegistry";

/**
 * Bump when the manifest SHAPE changes. Stored, and re-verified on load.
 *
 * 4: the trading-calendar commitment carries its enumerated sessions, so a
 *    reader can RECOMPUTE its checksum and RE-DERIVE its latest completed
 *    session instead of taking either on assertion. A schema-3 row was already
 *    persisted in development under the earlier, assertion-only shape, so the
 *    version had to move rather than the shape being widened in place — the
 *    stored row is left intact and is rejected on load by version mismatch.
 *
 * 5. The committed calendar now carries each exchange's OWN official
 *    regular-session timing document, with the normalized evidence rows needed
 *    to reproduce the session hours from the commitment alone. Schema 4 rows
 *    remain in storage as history and are rejected on load by version mismatch,
 *    exactly as schema 3 was: they claimed session hours no source in them can
 *    justify.
 */
export const MANIFEST_SCHEMA_VERSION = 5;
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

  /**
   * OWNER-APPROVED BSE reference authority for THIS generation (rule 8:
   * retrievedAt, effectiveTradingDate, source hashes and authority state are
   * preserved and exposed). Stored inside the manifest, so it is covered by
   * `manifestChecksum` and cannot be edited after the fact.
   */
  readonly bseReferenceAuthority: BseReferenceAuthorityResult;

  /**
   * PHASE 0.6A — the authoritative trading calendar this generation was decided
   * under, committed INSIDE the manifest rather than in a table of its own.
   *
   * The calendar's only consumer is registry authority, and the manifest is
   * already a checksummed, cold-loaded, last-good-preserving durable record.
   * Committing here means the manifest checksum covers the calendar, one
   * storage path is validated instead of two, and an invalid calendar can never
   * replace an accepted one because it can never reach an accepted manifest.
   */
  readonly tradingCalendar: TradingCalendarCommitment;

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
  /**
   * REQUIRED. Result of the owner-approved BSE reference policy. Not optional
   * and with no default: a caller that has not evaluated BSE authority must not
   * be able to mint an accepted manifest by simply omitting the argument.
   */
  readonly bseAuthority: BseReferenceAuthorityResult;
  /**
   * REQUIRED. The authoritative trading calendar under which BSE authority was
   * decided. Not optional and with no default, for the same reason as
   * `bseAuthority`: omitting it must not be a route to an accepted manifest.
   */
  readonly tradingCalendar: TradingCalendarCommitment;
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

  // Gate 4 — OWNER-APPROVED BSE REFERENCE POLICY (rules 1-6).
  // Only CURRENT_AUTHORITATIVE may authorize a NEW generation. A LAST_KNOWN
  // registry may be served for continuity, but rule 7 forbids it producing a
  // new universe, so it must never reach ACCEPTED here.
  //
  // The verdict is never taken on trust. `mayAuthorizeNewGeneration` is just a
  // boolean on an object, so a caller could hand-build an authorizing verdict
  // that no source ever produced. Two independent checks close that:
  //   (a) the verdict must be one this process's policy evaluator issued, and
  //   (b) it must be bound BY HASH to the BSE List body in this manifest's own
  //       provenance — otherwise a genuine verdict computed over some other
  //       body could be transplanted onto this generation.
  if (!isPolicyIssuedAuthority(input.bseAuthority)) {
    blockers.push(
      "BSE reference authority was not produced by evaluateBseReferenceAuthority and cannot be trusted",
    );
  } else if (!input.bseAuthority.mayAuthorizeNewGeneration) {
    blockers.push(
      `BSE reference authority is ${input.bseAuthority.state}, which cannot authorize a new generation: ` +
        (input.bseAuthority.reasons.join("; ") || "no reason recorded"),
    );
  } else {
    const bseList = input.sources.find((s) => s.sourceId === "BSE_LIST_OF_SCRIPS_ACTIVE");
    if (!bseList) {
      blockers.push("BSE reference authority claims authorization but no BSE List of Scrips provenance is present");
    } else if (bseList.contentHash !== input.bseAuthority.listContentHash) {
      blockers.push(
        "BSE reference authority was computed over a different BSE List of Scrips body than this manifest's provenance",
      );
    }
  }

  // Gate 5 — PHASE 0.6A AUTHORITATIVE TRADING CALENDAR.
  //
  // Session identity is the foundation the BSE policy stands on: "the latest
  // completed session" is meaningless without a calendar that can name it. So
  // the calendar is checked on its own terms first (valid, accepted official
  // sources for BOTH exchanges, id derived from its own checksum), and then
  // bound to the authority verdict — an authorizing verdict whose effective
  // trading date disagrees with the committed calendar means one of the two was
  // computed somewhere else.
  blockers.push(...verifyCalendarCommitmentIntegrity(input.tradingCalendar));

  // A NEW generation must be built against a calendar that is authoritative
  // RIGHT NOW, not merely one that was intact when it was committed. Building
  // today's registry on a calendar that stopped covering today is how an expired
  // commitment would otherwise be laundered into a fresh, accepted manifest.
  const generatedAtMs = Date.parse(input.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    blockers.push(`manifest generatedAt "${input.generatedAt}" is not a real instant`);
  } else {
    const authority = evaluateCalendarAuthorityNow(input.tradingCalendar, generatedAtMs);
    if (authority.state !== "CURRENT_AUTHORITATIVE") {
      blockers.push(
        `committed trading calendar is ${authority.state} at generation time: ${authority.reasons.join("; ")}`,
      );
    }
  }

  if (input.bseAuthority.mayAuthorizeNewGeneration) {
    const committedBse = input.tradingCalendar?.latestCompletedSession?.BSE ?? null;
    if (committedBse === null) {
      blockers.push(
        "BSE reference authority claims authorization but the committed calendar names no latest completed BSE session",
      );
    } else if (input.bseAuthority.effectiveTradingDate !== committedBse) {
      blockers.push(
        `BSE reference authority effective trading date ${input.bseAuthority.effectiveTradingDate} ` +
          `disagrees with the committed calendar's latest completed BSE session ${committedBse}`,
      );
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
    bseReferenceAuthority: input.bseAuthority,
    tradingCalendar: input.tradingCalendar,
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
