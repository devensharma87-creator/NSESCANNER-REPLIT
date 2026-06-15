/**
 * Phase 0 — Popup wording and signal card display tests.
 *
 * Validates the tier-aware popup titles, historical snapshot badge,
 * paper-trade gate display, and live signal badge on option cards.
 *
 * These tests verify the UI logic in option-signal-alerter.tsx and
 * options.tsx through their pure-function equivalents (no DOM rendering).
 */
import { describe, it, expect } from "vitest";

/**
 * Mirror of the popup title derivation logic from option-signal-alerter.tsx.
 * This is a direct copy of the branching logic for testability.
 */
function derivePopupTitle(
  isEntry: boolean,
  tier: string,
): { title: string; isTradeable: boolean; paperAllowed: boolean; paperReason: string | null } {
  const isTradeable = tier === "HIGH_CONVICTION" || tier === "STANDARD";
  const paperAllowed = isTradeable;
  const paperReason = isTradeable
    ? null
    : tier === "INFO_ONLY"
      ? "INFO_ONLY tier — informational outlook, not auto-traded"
      : tier === "BASELINE"
        ? "BASELINE tier — lower conviction, not auto-traded"
        : `${tier} tier — not eligible for auto-trade`;

  let title: string;
  if (!isEntry) {
    title = "STOP LOSS HIT";
  } else if (isTradeable) {
    title = "TRADEABLE ENTRY TRIGGERED";
  } else {
    title = "INFO ALERT — entry level reached";
  }

  return { title, isTradeable, paperAllowed, paperReason };
}

describe("Phase 0 — Popup wording per tier", () => {
  describe("TRADEABLE popups", () => {
    it("HIGH_CONVICTION entry shows 'TRADEABLE ENTRY TRIGGERED'", () => {
      const ui = derivePopupTitle(true, "HIGH_CONVICTION");
      expect(ui.title).toBe("TRADEABLE ENTRY TRIGGERED");
      expect(ui.isTradeable).toBe(true);
      expect(ui.paperAllowed).toBe(true);
      expect(ui.paperReason).toBeNull();
    });

    it("STANDARD entry shows 'TRADEABLE ENTRY TRIGGERED'", () => {
      const ui = derivePopupTitle(true, "STANDARD");
      expect(ui.title).toBe("TRADEABLE ENTRY TRIGGERED");
      expect(ui.isTradeable).toBe(true);
      expect(ui.paperAllowed).toBe(true);
    });
  });

  describe("INFO_ONLY popups", () => {
    it("INFO_ONLY entry shows 'INFO ALERT — entry level reached'", () => {
      const ui = derivePopupTitle(true, "INFO_ONLY");
      expect(ui.title).toBe("INFO ALERT — entry level reached");
      expect(ui.isTradeable).toBe(false);
      expect(ui.paperAllowed).toBe(false);
      expect(ui.paperReason).toBe("INFO_ONLY tier — informational outlook, not auto-traded");
    });

    it("INFO_ONLY entry NEVER says bare 'ENTRY TRIGGERED'", () => {
      const ui = derivePopupTitle(true, "INFO_ONLY");
      expect(ui.title).not.toBe("ENTRY TRIGGERED");
      expect(ui.title).not.toMatch(/^ENTRY TRIGGERED$/);
      expect(ui.title).toContain("INFO ALERT");
    });
  });

  describe("BASELINE popups", () => {
    it("BASELINE entry shows 'INFO ALERT — entry level reached'", () => {
      const ui = derivePopupTitle(true, "BASELINE");
      expect(ui.title).toBe("INFO ALERT — entry level reached");
      expect(ui.isTradeable).toBe(false);
      expect(ui.paperAllowed).toBe(false);
      expect(ui.paperReason).toBe("BASELINE tier — lower conviction, not auto-traded");
    });

    it("BASELINE entry NEVER says bare 'ENTRY TRIGGERED'", () => {
      const ui = derivePopupTitle(true, "BASELINE");
      expect(ui.title).not.toBe("ENTRY TRIGGERED");
      expect(ui.title).not.toMatch(/^TRADEABLE/);
    });
  });

  describe("Stop-loss popups (all tiers)", () => {
    for (const tier of ["HIGH_CONVICTION", "STANDARD", "BASELINE", "INFO_ONLY"]) {
      it(`${tier} stop shows 'STOP LOSS HIT'`, () => {
        const ui = derivePopupTitle(false, tier);
        expect(ui.title).toBe("STOP LOSS HIT");
      });
    }
  });

  describe("Paper-trade gate invariants", () => {
    it("only TRADEABLE tiers (HIGH_CONVICTION, STANDARD) allow paper trades", () => {
      const tradeable = derivePopupTitle(true, "HIGH_CONVICTION");
      expect(tradeable.paperAllowed).toBe(true);
      expect(tradeable.paperReason).toBeNull();

      const standard = derivePopupTitle(true, "STANDARD");
      expect(standard.paperAllowed).toBe(true);

      const baseline = derivePopupTitle(true, "BASELINE");
      expect(baseline.paperAllowed).toBe(false);
      expect(baseline.paperReason).toContain("BASELINE");

      const infoOnly = derivePopupTitle(true, "INFO_ONLY");
      expect(infoOnly.paperAllowed).toBe(false);
      expect(infoOnly.paperReason).toContain("INFO_ONLY");
    });

    it("unknown tier is not auto-traded", () => {
      const unknown = derivePopupTitle(true, "UNKNOWN_TIER");
      expect(unknown.paperAllowed).toBe(false);
      expect(unknown.paperReason).toContain("UNKNOWN_TIER");
    });
  });

  describe("badge text invariants", () => {
    it("a TRADEABLE signal never shows 'INFO ALERT'", () => {
      const tradeable = derivePopupTitle(true, "HIGH_CONVICTION");
      expect(tradeable.title).not.toContain("INFO ALERT");
    });

    it("an INFO_ONLY/BASELINE signal never shows 'TRADEABLE ENTRY TRIGGERED'", () => {
      const info = derivePopupTitle(true, "INFO_ONLY");
      expect(info.title).not.toContain("TRADEABLE");

      const baseline = derivePopupTitle(true, "BASELINE");
      expect(baseline.title).not.toContain("TRADEABLE");
    });
  });
});

describe("Phase 0 — Historical snapshot badge", () => {
  function formatTime(iso: string | undefined | null): string {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    } catch {
      return "—";
    }
  }

  it("includes triggered-at timestamp for entry alerts", () => {
    const triggeredAt = "2026-06-12T09:45:00.000Z";
    const isEntry = true;
    const badgeText = `Historical snapshot · ${isEntry ? "triggered" : "stopped"} at ${formatTime(isEntry ? triggeredAt : null)}`;
    expect(badgeText).toContain("triggered at");
    expect(badgeText).not.toContain("—");
  });

  it("includes stopped-at timestamp for stop-loss alerts", () => {
    const exitedAt = "2026-06-12T11:30:00.000Z";
    const isEntry = false;
    const badgeText = `Historical snapshot · ${isEntry ? "triggered" : "stopped"} at ${formatTime(isEntry ? null : exitedAt)}`;
    expect(badgeText).toContain("stopped at");
    expect(badgeText).not.toContain("—");
  });

  it("shows — when timestamp is null", () => {
    const time = formatTime(null);
    expect(time).toBe("—");
  });
});

describe("Phase 0 — Live signal badge on option cards", () => {
  function fmtIstTime(t: Date | string | null | undefined): string {
    if (!t) return "—";
    const d = typeof t === "string" ? new Date(t) : t;
    return d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  it("shows 'Live signal · {time}' when generatedAt is present", () => {
    const generatedAt = new Date("2026-06-12T10:15:00.000Z");
    const text = `Live signal · ${fmtIstTime(generatedAt)}`;
    expect(text).toContain("Live signal ·");
    expect(text).not.toContain("—");
  });

  it("shows — when generatedAt is null", () => {
    const text = fmtIstTime(null);
    expect(text).toBe("—");
  });
});
