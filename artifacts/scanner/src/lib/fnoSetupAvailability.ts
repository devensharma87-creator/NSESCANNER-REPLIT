/**
 * Pure derivation helpers for the Index F&O Setup Availability UI disclosure.
 * A0.3.1 — §12.7 frontend component derivation tests.
 * A0.3.2 — Updated for per-index 9-record design; `indexSymbol` is now required;
 *           deduplication uses the composite identity key (indexSymbol:setupKey).
 *
 * These functions are exported for testing. They take raw API data and return
 * view-model objects that the IndexFnoSetupAvailabilityStrip component renders from.
 * No React, no hooks — pure data transformation.
 */

/** Minimal entry type mirroring the API contract for this module. */
export interface AvailabilityEntry {
  /** A0.3.2 — Which cash index this record applies to. Required field. */
  indexSymbol: string;
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
   * Active setup count = total universe slots minus unavailable/retired count.
   * A0.3.2: "universe" is 6 setups × 3 indices = 18 total slots.
   * activeSetupCount = 18 − totalCount.
   *
   * For the full 9-record payload (all 3 cash indices, all 3 setups retired):
   *   totalCount = 9, activeSetupCount = 9.
   *
   * For a single-index 3-entry payload (e.g. tests using NIFTY only):
   *   totalCount = 3, activeSetupCount = 15.
   */
  activeSetupCount: number;
}

/** Total number of setup slots across all indices (6 setups × 3 indices). */
const TOTAL_FNO_SETUP_SLOTS = 18;

/**
 * Derives the view-model for the setup availability disclosure strip.
 *
 * Input: raw `indexFnoSetupAvailability` array from the API's setupState.
 * Output: grouped by status class, with counts for accurate "active" labelling.
 *
 * A0.3.1 invariant: UNAVAILABLE_REQUIRED_INPUT and RETIRED_INDEX_FNO_POLICY
 * are visually distinct in the UI — this function surfaces that distinction
 * in the data contract so the UI can render them differently.
 *
 * A0.3.2 change: deduplication uses composite key (indexSymbol:setupKey) rather
 * than setupKey alone, preserving per-index identity in the view model.
 */
export function deriveSetupAvailabilityView(
  entries: AvailabilityEntry[] | undefined | null,
): SetupAvailabilityView {
  const all = entries ?? [];

  // A0.3.2: deduplicate by composite identity key (indexSymbol:setupKey).
  // The API contract guarantees uniqueness, but protect against malformed
  // responses that could create UI duplicates within the same index.
  const seen = new Set<string>();
  const deduped = all.filter(e => {
    const key = `${e.indexSymbol}:${e.setupKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const unavailableRequiredInput = deduped.filter(
    e => e.status === "UNAVAILABLE_REQUIRED_INPUT",
  );
  const retiredPolicy = deduped.filter(
    e => e.status === "RETIRED_INDEX_FNO_POLICY",
  );

  const totalCount = unavailableRequiredInput.length + retiredPolicy.length;
  const activeSetupCount = Math.max(0, TOTAL_FNO_SETUP_SLOTS - totalCount);

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
  return view.activeSetupCount === TOTAL_FNO_SETUP_SLOTS - view.totalCount;
}

/**
 * Returns true when there are no duplicate composite keys (indexSymbol:setupKey)
 * across both status classes.
 * A setup cannot simultaneously be UNAVAILABLE_REQUIRED_INPUT and RETIRED_INDEX_FNO_POLICY.
 */
export function hasNoDuplicateKeys(view: SetupAvailabilityView): boolean {
  const unavailKeys = new Set(view.unavailableRequiredInput.map(e => `${e.indexSymbol}:${e.setupKey}`));
  for (const e of view.retiredPolicy) {
    if (unavailKeys.has(`${e.indexSymbol}:${e.setupKey}`)) return false;
  }
  return true;
}
