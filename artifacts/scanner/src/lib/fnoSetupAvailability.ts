/**
 * Pure derivation helpers for the Index F&O Setup Availability UI disclosure.
 * A0.3.1 — §12.7 frontend component derivation tests.
 *
 * These functions are exported for testing. They take raw API data and return
 * view-model objects that the options.tsx disclosure strip renders from.
 * No React, no hooks — pure data transformation.
 */

/** Minimal entry type mirroring the API contract for this module. */
export interface AvailabilityEntry {
  setupKey: string;
  status: string;
  reasonCode: string;
  explanation: string;
  missingInputs: string[];
  scope: string;
  eligibleForEmission: boolean;
}

export interface SetupAvailabilityView {
  /** Setups blocked due to a required authoritative input being unavailable. */
  unavailableRequiredInput: AvailabilityEntry[];
  /** Setups disabled under current index F&O policy (strategic retirement). */
  retiredPolicy: AvailabilityEntry[];
  /** True if there is anything to show in the disclosure strip. */
  hasEntries: boolean;
  /** Total number of non-active setups disclosed. */
  totalCount: number;
  /**
   * Active setup count = total universe minus unavailable/retired count.
   * The active count excludes retired/unavailable entries — they are not
   * eligible for emission and must not be counted as "active setups".
   * This is the correct denominator for "X of Y setups active" UI labels.
   */
  activeSetupCount: number;
}

/** Total number of named setups in the index-F&O universe. */
const TOTAL_INDEX_FNO_SETUPS = 8; // TC, VR, VB, EP, MR, BASELINE, VWAP_RECLAIM, TREND_CONTINUATION

/**
 * Derives the view-model for the setup availability disclosure strip.
 *
 * Input: raw `indexFnoSetupAvailability` array from the API's setupState.
 * Output: grouped by status class, with counts for accurate "active" labelling.
 *
 * A0.3.1 invariant: UNAVAILABLE_REQUIRED_INPUT and RETIRED_INDEX_FNO_POLICY
 * are visually distinct in the UI — this function surfaces that distinction
 * in the data contract so the UI can render them differently.
 */
export function deriveSetupAvailabilityView(
  entries: AvailabilityEntry[] | undefined | null,
): SetupAvailabilityView {
  const all = entries ?? [];

  // Deduplicate by setupKey (the API contract guarantees uniqueness, but
  // protect against malformed responses that could create UI duplicates).
  const seen = new Set<string>();
  const deduped = all.filter(e => {
    if (seen.has(e.setupKey)) return false;
    seen.add(e.setupKey);
    return true;
  });

  const unavailableRequiredInput = deduped.filter(
    e => e.status === "UNAVAILABLE_REQUIRED_INPUT",
  );
  const retiredPolicy = deduped.filter(
    e => e.status === "RETIRED_INDEX_FNO_POLICY",
  );

  const totalCount = unavailableRequiredInput.length + retiredPolicy.length;
  const activeSetupCount = Math.max(0, TOTAL_INDEX_FNO_SETUPS - totalCount);

  return {
    unavailableRequiredInput,
    retiredPolicy,
    hasEntries: totalCount > 0,
    totalCount,
    activeSetupCount,
  };
}

/**
 * Returns true when the disclosed setups correctly exclude all unavailable/retired
 * entries from the "active" count. Used to verify UI labels are truthful.
 *
 * A0.3.1 §12.7 requirement: active count excludes unavailable/retired setups.
 */
export function isActiveCountTruthful(view: SetupAvailabilityView): boolean {
  return view.activeSetupCount === TOTAL_INDEX_FNO_SETUPS - view.totalCount;
}

/**
 * Returns true when there are no duplicate setupKeys across both status classes.
 * A setup cannot simultaneously be UNAVAILABLE_REQUIRED_INPUT and RETIRED_INDEX_FNO_POLICY.
 */
export function hasNoDuplicateKeys(view: SetupAvailabilityView): boolean {
  const unavailKeys = new Set(view.unavailableRequiredInput.map(e => e.setupKey));
  for (const e of view.retiredPolicy) {
    if (unavailKeys.has(e.setupKey)) return false;
  }
  return true;
}
