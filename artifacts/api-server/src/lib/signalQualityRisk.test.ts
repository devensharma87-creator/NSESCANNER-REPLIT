/**
 * Tests for Signal Quality & Risk Framework (Task #137)
 *
 * F-32: EVENT_BLACKOUT_DATES + isEventBlackoutDay() in paperAccount.ts
 * F-27: Detector cooldown helpers in optionSignals.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import { EVENT_BLACKOUT_DATES, isEventBlackoutDay } from "./paperAccount";
import {
  _resetDetectorCooldownForTest,
  _getDetectorCooldownMs,
} from "./optionSignals";

// ── F-32: Event blackout gate ────────────────────────────────────────────────

describe("EVENT_BLACKOUT_DATES", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(EVENT_BLACKOUT_DATES)).toBe(true);
    expect(EVENT_BLACKOUT_DATES.length).toBeGreaterThan(0);
  });

  it("each entry has a date and a label string", () => {
    for (const entry of EVENT_BLACKOUT_DATES) {
      expect(typeof entry.date).toBe("string");
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("contains expected Union Budget and RBI MPC dates", () => {
    const dates = EVENT_BLACKOUT_DATES.map((e) => e.date);
    // Union Budget 2026
    expect(dates).toContain("2026-02-01");
    // Union Budget 2027
    expect(dates).toContain("2027-02-01");
    // At least one RBI MPC date for 2026 (not the budget)
    const rbiDates2026 = EVENT_BLACKOUT_DATES.filter(
      (e) => e.date.startsWith("2026") && e.date !== "2026-02-01"
    );
    expect(rbiDates2026.length).toBeGreaterThan(0);
  });

  it("all dates match YYYY-MM-DD format", () => {
    const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
    for (const { date } of EVENT_BLACKOUT_DATES) {
      expect(date).toMatch(isoPattern);
    }
  });

  it("has no duplicate dates", () => {
    const dates = EVENT_BLACKOUT_DATES.map((e) => e.date);
    const unique = new Set(dates);
    expect(unique.size).toBe(dates.length);
  });
});

describe("isEventBlackoutDay", () => {
  it("returns blocked=true for a known blackout date", () => {
    const result = isEventBlackoutDay("2026-02-01");
    expect(result.blocked).toBe(true);
    expect(result.label).toBeTruthy();
    expect(result.label).toContain("Budget");
  });

  it("returns blocked=false for a normal trading day", () => {
    // A random non-blackout date
    const result = isEventBlackoutDay("2026-01-15");
    expect(result.blocked).toBe(false);
    // label is optional/undefined when not blocked
    expect(result.label ?? "").toBe("");
  });

  it("returns blocked=false for an empty string", () => {
    const result = isEventBlackoutDay("");
    expect(result.blocked).toBe(false);
  });

  it("returns blocked=false for a date not in the list", () => {
    const result = isEventBlackoutDay("2025-12-25");
    expect(result.blocked).toBe(false);
  });

  it("returns blocked=true for each date in the list", () => {
    for (const { date } of EVENT_BLACKOUT_DATES) {
      const result = isEventBlackoutDay(date);
      expect(result.blocked).toBe(true);
    }
  });

  it("result has a descriptive label for every blocked date", () => {
    for (const { date } of EVENT_BLACKOUT_DATES) {
      const { label } = isEventBlackoutDay(date);
      expect(label?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

// ── F-27: Detector cooldown helpers ─────────────────────────────────────────

describe("_getDetectorCooldownMs", () => {
  it("returns 30 minutes in milliseconds", () => {
    expect(_getDetectorCooldownMs()).toBe(30 * 60 * 1000);
  });
});

describe("_resetDetectorCooldownForTest", () => {
  beforeEach(() => {
    _resetDetectorCooldownForTest();
  });

  it("resets without throwing", () => {
    expect(() => _resetDetectorCooldownForTest()).not.toThrow();
  });

  it("is callable multiple times without error", () => {
    _resetDetectorCooldownForTest();
    _resetDetectorCooldownForTest();
    expect(true).toBe(true); // just verifying no throw
  });
});
