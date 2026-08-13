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
import {
  evaluateCalendarAuthorityNow,
  verifyCalendarCommitmentIntegrity,
  type CalendarAuthorityEvaluation,
  type TradingCalendarCommitment,
} from "./exchangeCalendar";
import { evaluateStoredBseReferenceAuthorityNow } from "./bseReferencePolicy";
import type { RegistryGeneration } from "./manifestStore";

/** Scope id must match the one Phase 0.5B already reserved for this universe. */
export const AUTHORITATIVE_UNIVERSE_SCOPE_ID = "AUTHORITATIVE_NSE_BSE_INDEX_UNIVERSE";

/**
 * Single-entry memo for the current-authority verdict.
 *
 * The verdict can only change at a known instant — the next session close or
 * the next IST midnight, whichever comes first — and `evaluateCalendarAuthorityNow`
 * reports that instant as `validUntilMs`. Caching until then keeps this boundary
 * O(1) for repeated calls (a health endpoint polled per tick re-reads the memo,
 * it does not re-scan the committed sessions) while still flipping to
 * `LAST_KNOWN` the moment the boundary passes, with no restart required.
 */
let authorityMemo: {
  readonly calendarGenerationId: string;
  readonly evaluation: CalendarAuthorityEvaluation;
} | null = null;

function calendarAuthorityNow(
  commitment: TradingCalendarCommitment,
  nowMs: number,
): CalendarAuthorityEvaluation {
  const memo = authorityMemo;
  if (
    memo &&
    memo.calendarGenerationId === commitment.calendarGenerationId &&
    nowMs >= memo.evaluation.evaluatedAtMs &&
    nowMs < memo.evaluation.validUntilMs
  ) {
    return memo.evaluation;
  }
  const evaluation = evaluateCalendarAuthorityNow(commitment, nowMs);
  authorityMemo = { calendarGenerationId: commitment.calendarGenerationId, evaluation };
  return evaluation;
}

/** Test-only: drop the memo so a fresh evaluation is forced. */
export function __resetCalendarAuthorityMemo(): void {
  authorityMemo = null;
}

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
 *
 * `nowMs` is REQUIRED, not defaulted. This is the authority boundary, and
 * authority is a claim about the present: a manifest whose calendar no longer
 * covers today, or whose BSE reconciliation has been overtaken by a newer
 * completed session, is last-known data and may not supply a denominator.
 * Defaulting the clock here would let a caller silently skip that question.
 */
export function toAuthoritativeCoverageManifest(
  generation: RegistryGeneration | null | undefined,
  nowMs: number,
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

  // OWNER-APPROVED BSE REFERENCE POLICY, re-applied at the authority boundary.
  //
  // The in-process provenance check used at build time cannot survive storage,
  // so the durable binding is re-verified here instead: the recorded verdict
  // must be authorizing AND must be bound by hash to the BSE List body this
  // manifest actually carries. A verdict transplanted from another generation,
  // or edited to claim authority, fails one of the two.
  const auth = manifest.bseReferenceAuthority;
  if (!auth || auth.state !== "CURRENT_AUTHORITATIVE" || auth.mayAuthorizeNewGeneration !== true) {
    return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  }
  const bseList = manifest.sourceProvenance.find((s) => s.sourceId === "BSE_LIST_OF_SCRIPS_ACTIVE");
  if (!bseList || bseList.contentHash !== auth.listContentHash) {
    return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  }

  // PHASE 0.6A — the authoritative trading calendar, re-verified durably.
  //
  // "Latest completed session" is the anchor the whole BSE verdict hangs on, so
  // a manifest restored from storage must still carry a valid calendar whose id
  // derives from its own checksum, and the verdict's effective trading date
  // must still be the session that calendar names.
  if (verifyCalendarCommitmentIntegrity(manifest.tradingCalendar).length > 0) {
    return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  }
  if (auth.effectiveTradingDate !== manifest.tradingCalendar.latestCompletedSession.BSE) {
    return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  }

  // ...and re-asked AT THE CURRENT INSTANT. Integrity is immutable; authority
  // expires. A 2026 calendar is still perfectly intact on 2027-01-01 — it just
  // no longer describes today, so it cannot hand out an authoritative universe.
  if (calendarAuthorityNow(manifest.tradingCalendar, nowMs).state !== "CURRENT_AUTHORITATIVE") {
    return AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED;
  }

  // The BSE reference verdict expires on its own clock — the approved policy
  // binds it to a CURRENT-IST-DAY List of Scrips. The stored `state` field above
  // records what was true when the generation was built; this re-asks the same
  // question now. Without it, yesterday's universe supplies today's denominator
  // for as long as the calendar happens to still agree.
  if (
    evaluateStoredBseReferenceAuthorityNow(auth, Date.parse(manifest.generatedAt), nowMs).state !==
    "CURRENT_AUTHORITATIVE"
  ) {
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
