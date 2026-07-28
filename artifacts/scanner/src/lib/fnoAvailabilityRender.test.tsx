/**
 * §12.7 (render) — Frontend disclosure component render tests.
 * A0.3.2 rewrite: tests now import and render the ACTUAL production component
 * `IndexFnoSetupAvailabilityStrip` rather than an inline mirror copy.
 *
 * A0.3.2 delta requirement: "Delete fnoAvailabilityRender.test.tsx. New render
 * tests must import and render the actual production component."
 *
 * What these tests prove:
 *   - renders UNAVAILABLE_REQUIRED_INPUT in the amber group (data-testid present)
 *   - renders RETIRED_INDEX_FNO_POLICY in the purple group (data-testid present)
 *   - renders per-index rows with composite identity (indexSymbol-setupKey)
 *   - omits groups entirely when empty
 *   - does NOT mix statuses between groups
 *   - explicit degraded state when entries is undefined (no ?? [] fallback)
 *   - explicit degraded state when entries.length ≠ 9 (cardinality guard)
 *   - returns null when all entries are ACTIVE (no strip shown)
 *
 * Uses jsdom environment (vitest.config.ts: environment="jsdom") + React+ReactDOM
 * directly. @testing-library/react is not required.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { IndexFnoSetupAvailabilityStrip } from "@/components/IndexFnoSetupAvailabilityStrip";
import type { AvailabilityEntryStrip } from "@/components/IndexFnoSetupAvailabilityStrip";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures — 9-record per-index design (A0.3.2)
// ─────────────────────────────────────────────────────────────────────────────

/** Full 9-record fixture (3 indices × 3 setups) as required by A0.3.2 contract. */
const NINE_ENTRY_FIXTURE: AvailabilityEntryStrip[] = [
  // NIFTY
  { indexSymbol: "NIFTY",     setupKey: "VOLUME_BREAKOUT",         status: "UNAVAILABLE_REQUIRED_INPUT", reasonCode: "INDEX_VOLUME_UNAVAILABLE",                    explanation: "Volume Breakout requires traded volume. Cash-index candles carry zero volume." },
  { indexSymbol: "NIFTY",     setupKey: "MEAN_REVERSION",          status: "UNAVAILABLE_REQUIRED_INPUT", reasonCode: "SESSION_VWAP_UNAVAILABLE",                    explanation: "Mean Reversion requires a genuine session VWAP." },
  { indexSymbol: "NIFTY",     setupKey: "TREND_CONTINUATION_NO_VWAP", status: "RETIRED_INDEX_FNO_POLICY", reasonCode: "SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY", explanation: "Trend Continuation (no-VWAP branch) max conf 35 < threshold 50." },
  // BANKNIFTY
  { indexSymbol: "BANKNIFTY", setupKey: "VOLUME_BREAKOUT",         status: "UNAVAILABLE_REQUIRED_INPUT", reasonCode: "INDEX_VOLUME_UNAVAILABLE",                    explanation: "Volume Breakout requires traded volume. Cash-index candles carry zero volume." },
  { indexSymbol: "BANKNIFTY", setupKey: "MEAN_REVERSION",          status: "UNAVAILABLE_REQUIRED_INPUT", reasonCode: "SESSION_VWAP_UNAVAILABLE",                    explanation: "Mean Reversion requires a genuine session VWAP." },
  { indexSymbol: "BANKNIFTY", setupKey: "TREND_CONTINUATION_NO_VWAP", status: "RETIRED_INDEX_FNO_POLICY", reasonCode: "SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY", explanation: "Trend Continuation (no-VWAP branch) max conf 35 < threshold 50." },
  // SENSEX
  { indexSymbol: "SENSEX",    setupKey: "VOLUME_BREAKOUT",         status: "UNAVAILABLE_REQUIRED_INPUT", reasonCode: "INDEX_VOLUME_UNAVAILABLE",                    explanation: "Volume Breakout requires traded volume. Cash-index candles carry zero volume." },
  { indexSymbol: "SENSEX",    setupKey: "MEAN_REVERSION",          status: "UNAVAILABLE_REQUIRED_INPUT", reasonCode: "SESSION_VWAP_UNAVAILABLE",                    explanation: "Mean Reversion requires a genuine session VWAP." },
  { indexSymbol: "SENSEX",    setupKey: "TREND_CONTINUATION_NO_VWAP", status: "RETIRED_INDEX_FNO_POLICY", reasonCode: "SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY", explanation: "Trend Continuation (no-VWAP branch) max conf 35 < threshold 50." },
];

// ─────────────────────────────────────────────────────────────────────────────
// Render helpers
// ─────────────────────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null;

function renderIntoContainer(element: React.ReactElement): Document {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container!).render(element);
  });
  return document;
}

afterEach(() => {
  if (container) {
    act(() => {
      createRoot(container!).render(null as unknown as React.ReactElement);
    });
    document.body.removeChild(container);
    container = null;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §12.7 Render tests — production component (A0.3.2)
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.7 (render) A0.3.2 — IndexFnoSetupAvailabilityStrip production component", () => {

  describe("renders UNAVAILABLE_REQUIRED_INPUT in amber group (9-record input)", () => {
    it("amber data-testid present when UNAVAILABLE_REQUIRED_INPUT entries exist", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const el = document.querySelector('[data-testid="fno-availability-unavailable-required-input"]');
      expect(el).not.toBeNull();
    });

    it("NIFTY VOLUME_BREAKOUT entry is inside the amber group (composite key)", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const amber = document.querySelector('[data-testid="fno-availability-unavailable-required-input"]');
      const entry = amber?.querySelector('[data-testid="avail-entry-NIFTY-VOLUME_BREAKOUT"]');
      expect(entry).not.toBeNull();
    });

    it("BANKNIFTY VOLUME_BREAKOUT entry is inside the amber group", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const amber = document.querySelector('[data-testid="fno-availability-unavailable-required-input"]');
      const entry = amber?.querySelector('[data-testid="avail-entry-BANKNIFTY-VOLUME_BREAKOUT"]');
      expect(entry).not.toBeNull();
    });

    it("SENSEX MEAN_REVERSION entry is inside the amber group", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const amber = document.querySelector('[data-testid="fno-availability-unavailable-required-input"]');
      const entry = amber?.querySelector('[data-testid="avail-entry-SENSEX-MEAN_REVERSION"]');
      expect(entry).not.toBeNull();
    });

    it("NIFTY VOLUME_BREAKOUT reason code INDEX_VOLUME_UNAVAILABLE is rendered", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const span = document.querySelector('[data-testid="reason-NIFTY-VOLUME_BREAKOUT"]');
      expect(span?.textContent).toBe("INDEX_VOLUME_UNAVAILABLE");
    });

    it("NIFTY MEAN_REVERSION reason code SESSION_VWAP_UNAVAILABLE is rendered", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const span = document.querySelector('[data-testid="reason-NIFTY-MEAN_REVERSION"]');
      expect(span?.textContent).toBe("SESSION_VWAP_UNAVAILABLE");
    });

    it("amber group contains 6 entry rows (2 per index × 3 indices)", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const amber = document.querySelector('[data-testid="fno-availability-unavailable-required-input"]');
      // Each entry row has data-testid="avail-entry-{INDEX}-{SETUP}"
      const rows = amber?.querySelectorAll('[data-testid^="avail-entry-"]');
      expect(rows?.length).toBe(6);
    });
  });

  describe("renders RETIRED_INDEX_FNO_POLICY in purple group (9-record input)", () => {
    it("purple data-testid present when RETIRED_INDEX_FNO_POLICY entries exist", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const el = document.querySelector('[data-testid="fno-availability-retired-policy"]');
      expect(el).not.toBeNull();
    });

    it("NIFTY TREND_CONTINUATION_NO_VWAP entry is inside the purple group", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const purple = document.querySelector('[data-testid="fno-availability-retired-policy"]');
      const entry = purple?.querySelector('[data-testid="avail-entry-NIFTY-TREND_CONTINUATION_NO_VWAP"]');
      expect(entry).not.toBeNull();
    });

    it("BANKNIFTY TREND_CONTINUATION_NO_VWAP entry is inside the purple group", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const purple = document.querySelector('[data-testid="fno-availability-retired-policy"]');
      const entry = purple?.querySelector('[data-testid="avail-entry-BANKNIFTY-TREND_CONTINUATION_NO_VWAP"]');
      expect(entry).not.toBeNull();
    });

    it("purple group contains 3 entry rows (1 per index × 3 indices)", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const purple = document.querySelector('[data-testid="fno-availability-retired-policy"]');
      const rows = purple?.querySelectorAll('[data-testid^="avail-entry-"]');
      expect(rows?.length).toBe(3);
    });

    it("NIFTY TREND_CONTINUATION_NO_VWAP reason code rendered inside purple, not amber", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const purple = document.querySelector('[data-testid="fno-availability-retired-policy"]');
      const span = purple?.querySelector('[data-testid="reason-NIFTY-TREND_CONTINUATION_NO_VWAP"]');
      expect(span?.textContent).toBe("SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY");
    });
  });

  describe("status-group isolation — RETIRED not in amber, UNAVAILABLE not in purple", () => {
    it("NIFTY TREND_CONTINUATION_NO_VWAP is NOT present in the amber group", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const amber = document.querySelector('[data-testid="fno-availability-unavailable-required-input"]');
      const misplaced = amber?.querySelector('[data-testid="avail-entry-NIFTY-TREND_CONTINUATION_NO_VWAP"]');
      expect(misplaced).toBeNull();
    });

    it("NIFTY VOLUME_BREAKOUT is NOT present in the purple group", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const purple = document.querySelector('[data-testid="fno-availability-retired-policy"]');
      const misplaced = purple?.querySelector('[data-testid="avail-entry-NIFTY-VOLUME_BREAKOUT"]');
      expect(misplaced).toBeNull();
    });
  });

  describe("A0.3.2 cardinality and degraded states", () => {
    it("undefined entries → degraded state (no ?? [] fallback)", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={undefined} />);
      const degraded = document.querySelector('[data-testid="fno-setup-availability-strip-degraded"]');
      expect(degraded).not.toBeNull();
    });

    it("undefined entries → main strip is NOT shown", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={undefined} />);
      const strip = document.querySelector('[data-testid="fno-setup-availability-strip"]');
      expect(strip).toBeNull();
    });

    it("empty array (0 records) → degraded state (cardinality guard)", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={[]} />);
      const degraded = document.querySelector('[data-testid="fno-setup-availability-strip-degraded"]');
      expect(degraded).not.toBeNull();
    });

    it("3 records (old single-index design) → degraded state (cardinality guard)", () => {
      const three = NINE_ENTRY_FIXTURE.slice(0, 3);
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={three} />);
      const degraded = document.querySelector('[data-testid="fno-setup-availability-strip-degraded"]');
      expect(degraded).not.toBeNull();
    });

    it("9 records (correct) → main strip shown, no degraded state", () => {
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={NINE_ENTRY_FIXTURE} />);
      const strip = document.querySelector('[data-testid="fno-setup-availability-strip"]');
      const degraded = document.querySelector('[data-testid="fno-setup-availability-strip-degraded"]');
      expect(strip).not.toBeNull();
      expect(degraded).toBeNull();
    });

    it("all-ACTIVE entries → returns null (no strip shown)", () => {
      const allActive: AvailabilityEntryStrip[] = Array.from({ length: 9 }, (_, i) => ({
        indexSymbol: ["NIFTY", "NIFTY", "NIFTY", "BANKNIFTY", "BANKNIFTY", "BANKNIFTY", "SENSEX", "SENSEX", "SENSEX"][i] as string,
        setupKey: `ACTIVE_SETUP_${i}`,
        status: "ACTIVE" as const,
        reasonCode: "NONE",
        explanation: "This setup is active.",
      }));
      renderIntoContainer(<IndexFnoSetupAvailabilityStrip entries={allActive} />);
      const strip = document.querySelector('[data-testid="fno-setup-availability-strip"]');
      const degraded = document.querySelector('[data-testid="fno-setup-availability-strip-degraded"]');
      expect(strip).toBeNull();
      expect(degraded).toBeNull();
    });
  });
});
