/**
 * §12.7 — Frontend component derivation tests
 * Phase A0.3.1 — Index F&O Setup Availability UI disclosure
 *
 * Tests the pure deriveSetupAvailabilityView() function that drives the
 * options.tsx disclosure strip. This is the §12.7 "frontend component test"
 * evidence: it pins that:
 *   1. UNAVAILABLE_REQUIRED_INPUT and RETIRED_INDEX_FNO_POLICY are separated
 *      into distinct groups (visual distinction guaranteed at the data level).
 *   2. No duplicates appear in the disclosure.
 *   3. Active setup count correctly excludes unavailable/retired entries.
 *   4. An empty/null input produces no disclosure entries.
 *   5. The view truthfully reflects API data — no hard-coded assumptions.
 *   6. Status classes are not conflated (amber vs. purple distinction preserved).
 *
 * Pattern: pure derivation function + vitest — no React, no DOM rendering.
 * This follows the established pattern in global-status-banner.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  deriveSetupAvailabilityView,
  isActiveCountTruthful,
  hasNoDuplicateKeys,
  type AvailabilityEntry,
} from "./fnoSetupAvailability";

// ─── fixtures ────────────────────────────────────────────────────────────────

// A0.3.2: makeEntry now requires indexSymbol — defaults to "NIFTY" for single-index tests.
function makeEntry(
  setupKey: string,
  status: "UNAVAILABLE_REQUIRED_INPUT" | "RETIRED_INDEX_FNO_POLICY",
  reasonCode: string,
  indexSymbol: string = "NIFTY",
): AvailabilityEntry {
  return {
    indexSymbol,
    setupKey,
    status,
    reasonCode,
    explanation: `Explanation for ${setupKey}: this setup is unavailable in the index-F&O lane.`,
    missingInputs: ["sessionVwap"],
    scope: "INDEX_FNO",
    eligibleForEmission: false,
  };
}

// A0.3.2: Representative 3-entry payload from a single index (NIFTY).
// With the per-index design, the full payload is 9 records (3×3), but
// deriveSetupAvailabilityView works on any subset (no cardinality constraint at this layer).
const THREE_ENTRY_PAYLOAD: AvailabilityEntry[] = [
  makeEntry("VOLUME_BREAKOUT",            "UNAVAILABLE_REQUIRED_INPUT", "INDEX_VOLUME_UNAVAILABLE",                    "NIFTY"),
  makeEntry("MEAN_REVERSION",             "UNAVAILABLE_REQUIRED_INPUT", "SESSION_VWAP_UNAVAILABLE",                    "NIFTY"),
  makeEntry("TREND_CONTINUATION_NO_VWAP", "RETIRED_INDEX_FNO_POLICY",  "SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY", "NIFTY"),
];

// A0.3.2: 2-entry payload (NIFTY only, TREND_CONTINUATION_NO_VWAP not included).
const TWO_ENTRY_PAYLOAD: AvailabilityEntry[] = [
  makeEntry("VOLUME_BREAKOUT", "UNAVAILABLE_REQUIRED_INPUT", "INDEX_VOLUME_UNAVAILABLE", "NIFTY"),
  makeEntry("MEAN_REVERSION",  "UNAVAILABLE_REQUIRED_INPUT", "SESSION_VWAP_UNAVAILABLE", "NIFTY"),
];

// ─────────────────────────────────────────────────────────────────────────────
// §12.7.1 — Status-class separation (amber vs. purple visual distinction)
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.7.1 Status-class separation (UNAVAILABLE vs RETIRED)", () => {
  const view = deriveSetupAvailabilityView(THREE_ENTRY_PAYLOAD);

  it("VOLUME_BREAKOUT appears in unavailableRequiredInput (amber group)", () => {
    const e = view.unavailableRequiredInput.find(x => x.setupKey === "VOLUME_BREAKOUT");
    expect(e).toBeDefined();
  });

  it("MEAN_REVERSION appears in unavailableRequiredInput (amber group)", () => {
    const e = view.unavailableRequiredInput.find(x => x.setupKey === "MEAN_REVERSION");
    expect(e).toBeDefined();
  });

  it("TREND_CONTINUATION_NO_VWAP appears in retiredPolicy (purple group)", () => {
    const e = view.retiredPolicy.find(x => x.setupKey === "TREND_CONTINUATION_NO_VWAP");
    expect(e).toBeDefined();
  });

  it("VOLUME_BREAKOUT does NOT appear in retiredPolicy", () => {
    const e = view.retiredPolicy.find(x => x.setupKey === "VOLUME_BREAKOUT");
    expect(e).toBeUndefined();
  });

  it("MEAN_REVERSION does NOT appear in retiredPolicy", () => {
    const e = view.retiredPolicy.find(x => x.setupKey === "MEAN_REVERSION");
    expect(e).toBeUndefined();
  });

  it("TREND_CONTINUATION_NO_VWAP does NOT appear in unavailableRequiredInput", () => {
    const e = view.unavailableRequiredInput.find(x => x.setupKey === "TREND_CONTINUATION_NO_VWAP");
    expect(e).toBeUndefined();
  });

  it("unavailableRequiredInput has exactly 2 entries (VB + MR)", () => {
    expect(view.unavailableRequiredInput).toHaveLength(2);
  });

  it("retiredPolicy has exactly 1 entry (TC_NO_VWAP)", () => {
    expect(view.retiredPolicy).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12.7.2 — Active count excludes unavailable/retired entries
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.7.2 Active count truthfulness (active count excludes unavailable)", () => {
  it("isActiveCountTruthful returns true for the 3-entry payload", () => {
    const view = deriveSetupAvailabilityView(THREE_ENTRY_PAYLOAD);
    expect(isActiveCountTruthful(view)).toBe(true);
  });

  it("isActiveCountTruthful returns true for the 2-entry payload", () => {
    const view = deriveSetupAvailabilityView(TWO_ENTRY_PAYLOAD);
    expect(isActiveCountTruthful(view)).toBe(true);
  });

  it("active count is less with 3 unavailable entries than with 2", () => {
    const view3 = deriveSetupAvailabilityView(THREE_ENTRY_PAYLOAD);
    const view2 = deriveSetupAvailabilityView(TWO_ENTRY_PAYLOAD);
    expect(view3.activeSetupCount).toBeLessThan(view2.activeSetupCount);
  });

  it("totalCount equals sum of both groups", () => {
    const view = deriveSetupAvailabilityView(THREE_ENTRY_PAYLOAD);
    expect(view.totalCount).toBe(
      view.unavailableRequiredInput.length + view.retiredPolicy.length,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12.7.3 — No duplicates across the two groups
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.7.3 No duplicates", () => {
  it("hasNoDuplicateKeys returns true for the 3-entry payload", () => {
    const view = deriveSetupAvailabilityView(THREE_ENTRY_PAYLOAD);
    expect(hasNoDuplicateKeys(view)).toBe(true);
  });

  it("duplicate setupKey in input is deduplicated in output", () => {
    const withDuplicate = [
      ...THREE_ENTRY_PAYLOAD,
      makeEntry("VOLUME_BREAKOUT", "UNAVAILABLE_REQUIRED_INPUT", "INDEX_VOLUME_UNAVAILABLE"),
    ];
    const view = deriveSetupAvailabilityView(withDuplicate);
    // Despite 4 inputs, only 3 unique keys
    expect(view.totalCount).toBe(3);
    const vbCount = view.unavailableRequiredInput.filter(x => x.setupKey === "VOLUME_BREAKOUT").length;
    expect(vbCount).toBe(1);
  });

  it("no setupKey appears in both groups simultaneously", () => {
    const view = deriveSetupAvailabilityView(THREE_ENTRY_PAYLOAD);
    const unavailKeys = new Set(view.unavailableRequiredInput.map(e => e.setupKey));
    for (const e of view.retiredPolicy) {
      expect(unavailKeys.has(e.setupKey)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12.7.4 — Empty / null / undefined input
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.7.4 Empty / null / undefined input", () => {
  it("null input → hasEntries=false, no groups, totalCount=0", () => {
    const view = deriveSetupAvailabilityView(null);
    expect(view.hasEntries).toBe(false);
    expect(view.unavailableRequiredInput).toHaveLength(0);
    expect(view.retiredPolicy).toHaveLength(0);
    expect(view.totalCount).toBe(0);
  });

  it("undefined input → hasEntries=false", () => {
    const view = deriveSetupAvailabilityView(undefined);
    expect(view.hasEntries).toBe(false);
  });

  it("empty array → hasEntries=false", () => {
    const view = deriveSetupAvailabilityView([]);
    expect(view.hasEntries).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12.7.5 — Truthful rendering from API data (no hard-coded assumptions)
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.7.5 Truthful rendering from API data", () => {
  it("hasEntries=true when there are non-empty groups", () => {
    const view = deriveSetupAvailabilityView(THREE_ENTRY_PAYLOAD);
    expect(view.hasEntries).toBe(true);
  });

  it("explanations pass through unmodified from API data", () => {
    const view = deriveSetupAvailabilityView(THREE_ENTRY_PAYLOAD);
    const vb = view.unavailableRequiredInput.find(e => e.setupKey === "VOLUME_BREAKOUT")!;
    const expected = THREE_ENTRY_PAYLOAD.find(e => e.setupKey === "VOLUME_BREAKOUT")!;
    expect(vb.explanation).toBe(expected.explanation);
    expect(vb.reasonCode).toBe(expected.reasonCode);
  });

  it("status-class separation is determined by entry.status, not by setupKey name", () => {
    // A hypothetical new setup with RETIRED_INDEX_FNO_POLICY status should go
    // to retiredPolicy regardless of its setupKey name.
    const hypothetical = makeEntry("EMA_PULLBACK", "RETIRED_INDEX_FNO_POLICY", "SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY");
    const view = deriveSetupAvailabilityView([hypothetical]);
    expect(view.retiredPolicy.find(e => e.setupKey === "EMA_PULLBACK")).toBeDefined();
    expect(view.unavailableRequiredInput.find(e => e.setupKey === "EMA_PULLBACK")).toBeUndefined();
  });

  it("ACTIVE status entries are excluded from both groups (not shown in strip)", () => {
    // The disclosure strip only shows non-ACTIVE entries.
    const active: AvailabilityEntry = {
      setupKey: "TREND_CONTINUATION",
      status: "ACTIVE",
      reasonCode: "NONE",
      explanation: "This setup is active.",
      missingInputs: [],
      scope: "INDEX_FNO",
      eligibleForEmission: false, // even active entries have this in the type
    };
    const view = deriveSetupAvailabilityView([active, ...TWO_ENTRY_PAYLOAD]);
    // ACTIVE entry must not appear in either group
    const activeInUnavail = view.unavailableRequiredInput.find(e => e.setupKey === "TREND_CONTINUATION");
    const activeInRetired  = view.retiredPolicy.find(e => e.setupKey === "TREND_CONTINUATION");
    // Note: deriveSetupAvailabilityView includes ALL entries — the UI component
    // is responsible for filtering ACTIVE entries. But here we verify the two
    // groups only contain their target status class.
    if (activeInUnavail) {
      expect(activeInUnavail.status).toBe("UNAVAILABLE_REQUIRED_INPUT");
    }
    if (activeInRetired) {
      expect(activeInRetired.status).toBe("RETIRED_INDEX_FNO_POLICY");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12.7.6 — TREND_CONTINUATION_NO_VWAP is the canonical setupKey (A0.3.1 rename)
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.7.6 TREND_CONTINUATION_NO_VWAP as canonical setupKey", () => {
  it("TREND_CONTINUATION_NO_VWAP is routed to retiredPolicy (not amber group)", () => {
    const view = deriveSetupAvailabilityView(THREE_ENTRY_PAYLOAD);
    expect(view.retiredPolicy.find(e => e.setupKey === "TREND_CONTINUATION_NO_VWAP")).toBeDefined();
    expect(view.unavailableRequiredInput.find(e => e.setupKey === "TREND_CONTINUATION_NO_VWAP")).toBeUndefined();
  });

  it("TREND_CONTINUATION (without _NO_VWAP suffix) is NOT present when vwapAvailable=false", () => {
    // The old key name must not appear — all references must use the new canonical key.
    const view = deriveSetupAvailabilityView(THREE_ENTRY_PAYLOAD);
    const allKeys = [
      ...view.unavailableRequiredInput,
      ...view.retiredPolicy,
    ].map(e => e.setupKey);
    expect(allKeys).not.toContain("TREND_CONTINUATION");
  });
});
