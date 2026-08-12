/**
 * PHASE 0.6 — the ONLY bridge from the instrument registry to the Phase 0.5B
 * coverage contract.
 *
 * Coverage may treat a denominator as authoritative only when a reconciled,
 * checksum-verified manifest actually exists. Everything else degrades to
 * UNIVERSE_NOT_CONFIGURED. This module is pure: no DB, no network, no clock.
 */

import {
  AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
  type UniverseManifest as CoverageUniverseManifest,
} from "../marketData/aggregateCoverage";
import {
  CLASSIFICATION_POLICY_VERSION,
  MANIFEST_SCHEMA_VERSION,
  computeClassificationPolicyHash,
  computeRecordSetHash,
  isManifestAccepted,
  verifyManifestChecksum,
} from "./universeManifest";
import type { RegistryGeneration } from "./manifestStore";

/** Scope id must match the one Phase 0.5B already reserved for this universe. */
export const AUTHORITATIVE_UNIVERSE_SCOPE_ID = "AUTHORITATIVE_NSE_BSE_INDEX_UNIVERSE";

/**
 * Map a registry generation onto the coverage denominator.
 *
 * FAIL-CLOSED. Returns the Phase 0.5B "not configured" manifest whenever the
 * generation is absent, unaccepted, checksum-invalid, has an unclosed
 * reconciliation, or contains a LIVE_REQUIRED record whose canonical identity
 * could not be minted. That last case matters: a required instrument with no
 * canonical id cannot appear in `requiredInstrumentIds`, so claiming authority
 * would silently shrink the denominator and overstate coverage.
 *
 * The required set includes LIVE_REQUIRED instruments that are NOT mapped to a
 * provider token. They are genuinely required; being unmapped makes them
 * uncovered, not unrequired. Dropping them would be the same understatement.
 */
export function toAuthoritativeCoverageManifest(
  generation: RegistryGeneration | null | undefined,
): CoverageUniverseManifest {
  if (!generation) return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;

  const { manifest, records } = generation;
  if (!isManifestAccepted(manifest)) return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  if (!verifyManifestChecksum(manifest)) return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  if (manifest.nse.remainder !== 0 || manifest.bse.remainder !== 0) {
    return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  }

  // This function is the authority boundary, so it re-applies EVERY acceptance
  // gate itself rather than assuming it was handed a generation that came
  // through the loader. A caller can construct a RegistryGeneration directly,
  // and a self-consistent manifest written under a different schema or
  // classification policy means something different from what today's coverage
  // consumers will read it as.
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  if (manifest.policyVersion !== CLASSIFICATION_POLICY_VERSION) return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  if (manifest.classificationPolicyHash !== computeClassificationPolicyHash()) {
    return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  }

  // The manifest must actually describe THESE records. Without the full-set
  // commitment, an unmapped LIVE_REQUIRED record could be deleted or demoted
  // and every other hash would still verify, shrinking the denominator while
  // this function asserted authority over it.
  if (records.length !== manifest.totalOfficialRecords + manifest.indexCount) {
    return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  }
  if (computeRecordSetHash(records) !== manifest.recordSetHash) {
    return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  }

  const requiredInstrumentIds: string[] = [];
  for (const r of records) {
    if (r.eligibilityTier !== "LIVE_REQUIRED") continue;
    if (r.canonicalInstrumentId === null) {
      // A required instrument we cannot name. Refuse the authority claim.
      return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
    }
    requiredInstrumentIds.push(r.canonicalInstrumentId);
  }

  if (requiredInstrumentIds.length === 0) return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;

  return {
    universeScopeId: AUTHORITATIVE_UNIVERSE_SCOPE_ID,
    universeGenerationId: manifest.registryGenerationId,
    universeGeneratedAt: manifest.generatedAt,
    coverageAuthority: "AUTHORITATIVE_RECONCILED_UNIVERSE",
    universeReconciliationValid: true,
    requiredInstrumentIds,
    /**
     * ZERO BY CONSTRUCTION. Phase 0.6 is explicitly prohibited from expanding
     * any live subscription, so this deployment has requested none of these
     * instruments from the provider. Reporting anything else here would invent
     * subscriptions that were never made.
     */
    subscriptionRequestedCount: 0,
  };
}
