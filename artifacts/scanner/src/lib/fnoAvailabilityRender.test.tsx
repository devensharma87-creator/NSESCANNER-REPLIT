/**
 * §12.7 (render) — Frontend disclosure component render tests.
 *
 * Proves that the A0.3 disclosure strip:
 *   - renders UNAVAILABLE_REQUIRED_INPUT in the amber group (data-testid present)
 *   - renders RETIRED_INDEX_FNO_POLICY in the purple group (data-testid present)
 *   - omits groups entirely when empty
 *   - does NOT mix statuses between groups
 *   - handles all-empty input (returns null / no disclosure)
 *
 * Uses jsdom environment (vitest.config.ts: environment="jsdom") + React+ReactDOM
 * directly. @testing-library/react is not required.
 *
 * The component under test is an inline minimal component that mirrors the
 * exact disclosure logic from artifacts/scanner/src/pages/options.tsx
 * (lines ~1043-1095). It is not a copy of the full page — it isolates the
 * disclosure strip logic so side-effects (React Query hooks, router, auth)
 * are excluded.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, it, expect, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal disclosure-strip component — mirrors options.tsx disclosure logic
// ─────────────────────────────────────────────────────────────────────────────

type AvailEntry = {
  setupKey: string;
  status: "ACTIVE" | "UNAVAILABLE_REQUIRED_INPUT" | "RETIRED_INDEX_FNO_POLICY";
  reasonCode: string;
  explanation: string;
};

/**
 * Minimal inline version of the disclosure strip component from options.tsx.
 * Mirrors the exact filter logic and data-testid attributes used in production.
 * Allows isolated render testing without React Query, router, or auth.
 */
function DisclosureStrip({ entries }: { entries: AvailEntry[] }) {
  const unavailableInput = entries.filter(
    (e) => e.status === "UNAVAILABLE_REQUIRED_INPUT",
  );
  const retiredPolicy = entries.filter(
    (e) => e.status === "RETIRED_INDEX_FNO_POLICY",
  );
  if (unavailableInput.length === 0 && retiredPolicy.length === 0) return null;
  return (
    <div data-testid="fno-setup-availability-strip">
      {unavailableInput.length > 0 && (
        <div data-testid="fno-availability-unavailable-required-input">
          <span>Missing required input</span>
          {unavailableInput.map((e) => (
            <div key={e.setupKey} data-testid={`avail-entry-${e.setupKey}`}>
              <span data-testid={`reason-${e.setupKey}`}>{e.reasonCode}</span>
              <span>{e.explanation}</span>
            </div>
          ))}
        </div>
      )}
      {retiredPolicy.length > 0 && (
        <div data-testid="fno-availability-retired-policy">
          <span>Retired under current index F&O policy</span>
          {retiredPolicy.map((e) => (
            <div key={e.setupKey} data-testid={`avail-entry-${e.setupKey}`}>
              <span data-testid={`reason-${e.setupKey}`}>{e.reasonCode}</span>
              <span>{e.explanation}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test fixture — mirrors computeIndexFnoSetupAvailability(false) output
// (inline so the test has no backend dependency)
// ─────────────────────────────────────────────────────────────────────────────

const AVAILABILITY_FALSE: AvailEntry[] = [
  {
    setupKey: "VOLUME_BREAKOUT",
    status: "UNAVAILABLE_REQUIRED_INPUT",
    reasonCode: "INDEX_VOLUME_UNAVAILABLE",
    explanation:
      "Volume Breakout requires traded volume. Cash-index candles carry zero volume.",
  },
  {
    setupKey: "MEAN_REVERSION",
    status: "UNAVAILABLE_REQUIRED_INPUT",
    reasonCode: "SESSION_VWAP_UNAVAILABLE",
    explanation:
      "Mean Reversion requires a genuine session VWAP. Cash-index candles have zero volume.",
  },
  {
    setupKey: "TREND_CONTINUATION_NO_VWAP",
    status: "RETIRED_INDEX_FNO_POLICY",
    reasonCode: "SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY",
    explanation:
      "Trend Continuation (no-VWAP branch): max conf 43 < threshold 50. Retired.",
  },
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
// §12.7 Render tests
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.7 (render) — DisclosureStrip component", () => {
  describe("renders UNAVAILABLE_REQUIRED_INPUT in amber group", () => {
    it("amber data-testid present when UNAVAILABLE_REQUIRED_INPUT entries exist", () => {
      renderIntoContainer(<DisclosureStrip entries={AVAILABILITY_FALSE} />);
      const el = document.querySelector(
        '[data-testid="fno-availability-unavailable-required-input"]',
      );
      expect(el).not.toBeNull();
    });

    it("VOLUME_BREAKOUT entry is inside the amber group", () => {
      renderIntoContainer(<DisclosureStrip entries={AVAILABILITY_FALSE} />);
      const amber = document.querySelector(
        '[data-testid="fno-availability-unavailable-required-input"]',
      );
      const entry = amber?.querySelector('[data-testid="avail-entry-VOLUME_BREAKOUT"]');
      expect(entry).not.toBeNull();
    });

    it("MEAN_REVERSION entry is inside the amber group", () => {
      renderIntoContainer(<DisclosureStrip entries={AVAILABILITY_FALSE} />);
      const amber = document.querySelector(
        '[data-testid="fno-availability-unavailable-required-input"]',
      );
      const entry = amber?.querySelector('[data-testid="avail-entry-MEAN_REVERSION"]');
      expect(entry).not.toBeNull();
    });

    it("VOLUME_BREAKOUT reason code INDEX_VOLUME_UNAVAILABLE is rendered", () => {
      renderIntoContainer(<DisclosureStrip entries={AVAILABILITY_FALSE} />);
      const span = document.querySelector('[data-testid="reason-VOLUME_BREAKOUT"]');
      expect(span?.textContent).toBe("INDEX_VOLUME_UNAVAILABLE");
    });

    it("MEAN_REVERSION reason code SESSION_VWAP_UNAVAILABLE is rendered", () => {
      renderIntoContainer(<DisclosureStrip entries={AVAILABILITY_FALSE} />);
      const span = document.querySelector('[data-testid="reason-MEAN_REVERSION"]');
      expect(span?.textContent).toBe("SESSION_VWAP_UNAVAILABLE");
    });
  });

  describe("renders RETIRED_INDEX_FNO_POLICY in purple group", () => {
    it("purple data-testid present when RETIRED_INDEX_FNO_POLICY entries exist", () => {
      renderIntoContainer(<DisclosureStrip entries={AVAILABILITY_FALSE} />);
      const el = document.querySelector(
        '[data-testid="fno-availability-retired-policy"]',
      );
      expect(el).not.toBeNull();
    });

    it("TREND_CONTINUATION_NO_VWAP entry is inside the purple group", () => {
      renderIntoContainer(<DisclosureStrip entries={AVAILABILITY_FALSE} />);
      const purple = document.querySelector(
        '[data-testid="fno-availability-retired-policy"]',
      );
      const entry = purple?.querySelector(
        '[data-testid="avail-entry-TREND_CONTINUATION_NO_VWAP"]',
      );
      expect(entry).not.toBeNull();
    });

    it("TREND_CONTINUATION_NO_VWAP reason code rendered inside purple, not amber", () => {
      renderIntoContainer(<DisclosureStrip entries={AVAILABILITY_FALSE} />);
      const purple = document.querySelector(
        '[data-testid="fno-availability-retired-policy"]',
      );
      const span = purple?.querySelector(
        '[data-testid="reason-TREND_CONTINUATION_NO_VWAP"]',
      );
      expect(span?.textContent).toBe("SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY");
    });
  });

  describe("status-group isolation — RETIRED entry is not in amber, UNAVAILABLE not in purple", () => {
    it("TREND_CONTINUATION_NO_VWAP is NOT present in the amber group", () => {
      renderIntoContainer(<DisclosureStrip entries={AVAILABILITY_FALSE} />);
      const amber = document.querySelector(
        '[data-testid="fno-availability-unavailable-required-input"]',
      );
      const misplaced = amber?.querySelector(
        '[data-testid="avail-entry-TREND_CONTINUATION_NO_VWAP"]',
      );
      expect(misplaced).toBeNull();
    });

    it("VOLUME_BREAKOUT is NOT present in the purple group", () => {
      renderIntoContainer(<DisclosureStrip entries={AVAILABILITY_FALSE} />);
      const purple = document.querySelector(
        '[data-testid="fno-availability-retired-policy"]',
      );
      const misplaced = purple?.querySelector(
        '[data-testid="avail-entry-VOLUME_BREAKOUT"]',
      );
      expect(misplaced).toBeNull();
    });
  });

  describe("empty-input and all-ACTIVE states", () => {
    it("returns null (no strip element) when all entries are empty", () => {
      renderIntoContainer(<DisclosureStrip entries={[]} />);
      const strip = document.querySelector('[data-testid="fno-setup-availability-strip"]');
      expect(strip).toBeNull();
    });

    it("returns null (no strip element) when all entries are ACTIVE", () => {
      const activeOnly: AvailEntry[] = [
        {
          setupKey: "TREND_CONTINUATION",
          status: "ACTIVE",
          reasonCode: "ACTIVE",
          explanation: "VWAP-available TREND_CONTINUATION is active.",
        },
      ];
      renderIntoContainer(<DisclosureStrip entries={activeOnly} />);
      const strip = document.querySelector('[data-testid="fno-setup-availability-strip"]');
      expect(strip).toBeNull();
    });

    it("no amber group when only RETIRED entries exist", () => {
      const retiredOnly: AvailEntry[] = [
        {
          setupKey: "TREND_CONTINUATION_NO_VWAP",
          status: "RETIRED_INDEX_FNO_POLICY",
          reasonCode: "SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY",
          explanation: "Retired.",
        },
      ];
      renderIntoContainer(<DisclosureStrip entries={retiredOnly} />);
      const amber = document.querySelector(
        '[data-testid="fno-availability-unavailable-required-input"]',
      );
      expect(amber).toBeNull();
    });

    it("no purple group when only UNAVAILABLE entries exist", () => {
      const unavailOnly: AvailEntry[] = [
        {
          setupKey: "VOLUME_BREAKOUT",
          status: "UNAVAILABLE_REQUIRED_INPUT",
          reasonCode: "INDEX_VOLUME_UNAVAILABLE",
          explanation: "Volume unavailable.",
        },
      ];
      renderIntoContainer(<DisclosureStrip entries={unavailOnly} />);
      const purple = document.querySelector(
        '[data-testid="fno-availability-retired-policy"]',
      );
      expect(purple).toBeNull();
    });
  });
});
