/**
 * Tests for IST market-hours helpers:
 *   – getMarketStatusDetail (rich struct with marketOpen, reason, serverIst, ...)
 *   – computeMarketStatus (legacy 3-state string, kept for backward compat)
 *   – isNseHoliday
 *
 * Task D regression: an earlier evidence table incorrectly stated "2026-07-13 is Sunday".
 * These tests confirm the correct day-of-week for the dates relevant to that claim.
 */

import { describe, it, expect } from "vitest";
import { getMarketStatusDetail, computeMarketStatus, isNseHoliday } from "./marketEvents";

// ── UTC helper: build a Date at a specific IST wall-clock time ─────────────────
// IST = UTC + 5h30m → IST HH:MM = UTC HH:MM − 5:30
function istToUtc(dateStr: string, hh: number, mm: number): Date {
  // dateStr is YYYY-MM-DD in IST
  const [y, mo, d] = dateStr.split("-").map(Number) as [number, number, number];
  // Convert IST to UTC: subtract 5h30m
  const utcMs =
    Date.UTC(y, mo - 1, d, hh, mm) - 5.5 * 60 * 60 * 1000;
  return new Date(utcMs);
}

// ── Task D: weekday regression — 2026-07-13 must be MONDAY, not Sunday ──────────

describe("IST weekday regression — 2026-07-13 is MONDAY", () => {
  it("2026-07-13 10:13 IST → isTradingDay=true (weekday, not weekend)", () => {
    const d = istToUtc("2026-07-13", 10, 13);
    const s = getMarketStatusDetail(d);
    expect(s.isTradingDay).toBe(true);
    expect(s.reason).not.toBe("WEEKEND");
  });

  it("2026-07-13 10:13 IST → marketOpen=true (09:15–15:30 window)", () => {
    const d = istToUtc("2026-07-13", 10, 13);
    const s = getMarketStatusDetail(d);
    expect(s.marketOpen).toBe(true);
    expect(s.reason).toBe("OPEN");
  });

  it("2026-07-14 (Tuesday) → isTradingDay=true", () => {
    const d = istToUtc("2026-07-14", 10, 0);
    const s = getMarketStatusDetail(d);
    expect(s.isTradingDay).toBe(true);
    expect(s.reason).not.toBe("WEEKEND");
  });

  it("2026-07-12 (Sunday) → WEEKEND, marketOpen=false", () => {
    const d = istToUtc("2026-07-12", 10, 13);
    const s = getMarketStatusDetail(d);
    expect(s.isTradingDay).toBe(false);
    expect(s.marketOpen).toBe(false);
    expect(s.reason).toBe("WEEKEND");
  });

  it("2026-07-11 (Saturday) → WEEKEND, marketOpen=false", () => {
    const d = istToUtc("2026-07-11", 10, 0);
    const s = getMarketStatusDetail(d);
    expect(s.isTradingDay).toBe(false);
    expect(s.marketOpen).toBe(false);
    expect(s.reason).toBe("WEEKEND");
  });
});

// ── Pre-market report window: 08:50 IST is before market open ───────────────────

describe("pre-market scheduler window (08:50 IST)", () => {
  it("08:50 IST on Monday 2026-07-13 → BEFORE_OPEN (not OPEN, not WEEKEND)", () => {
    const d = istToUtc("2026-07-13", 8, 50);
    const s = getMarketStatusDetail(d);
    expect(s.isTradingDay).toBe(true);
    expect(s.marketOpen).toBe(false);
    expect(s.reason).toBe("BEFORE_OPEN");
  });

  it("08:50 IST is before 09:00 (pre-open boundary)", () => {
    const d = istToUtc("2026-07-13", 8, 50);
    const s = getMarketStatusDetail(d);
    expect(s.reason).toBe("BEFORE_OPEN");
  });
});

// ── Market session boundary tests ───────────────────────────────────────────────

describe("getMarketStatusDetail — IST session boundaries", () => {
  const MON = "2026-07-13";

  it("00:00 IST → BEFORE_OPEN", () => {
    const s = getMarketStatusDetail(istToUtc(MON, 0, 0));
    expect(s.reason).toBe("BEFORE_OPEN");
    expect(s.marketOpen).toBe(false);
    expect(s.isTradingDay).toBe(true);
  });

  it("09:00 IST → PRE_OPEN (starts pre-open window)", () => {
    const s = getMarketStatusDetail(istToUtc(MON, 9, 0));
    expect(s.reason).toBe("PRE_OPEN");
    expect(s.marketOpen).toBe(false);
  });

  it("09:14 IST → still PRE_OPEN", () => {
    const s = getMarketStatusDetail(istToUtc(MON, 9, 14));
    expect(s.reason).toBe("PRE_OPEN");
  });

  it("09:15 IST → OPEN (session start)", () => {
    const s = getMarketStatusDetail(istToUtc(MON, 9, 15));
    expect(s.reason).toBe("OPEN");
    expect(s.marketOpen).toBe(true);
  });

  it("15:30 IST → OPEN (session end inclusive)", () => {
    const s = getMarketStatusDetail(istToUtc(MON, 15, 30));
    expect(s.reason).toBe("OPEN");
    expect(s.marketOpen).toBe(true);
  });

  it("15:31 IST → AFTER_CLOSE", () => {
    const s = getMarketStatusDetail(istToUtc(MON, 15, 31));
    expect(s.reason).toBe("AFTER_CLOSE");
    expect(s.marketOpen).toBe(false);
  });

  it("23:59 IST → AFTER_CLOSE", () => {
    const s = getMarketStatusDetail(istToUtc(MON, 23, 59));
    expect(s.reason).toBe("AFTER_CLOSE");
    expect(s.marketOpen).toBe(false);
  });

  it("serverIst contains hours:minutes in HH:MM format", () => {
    const d = istToUtc(MON, 10, 13);
    const s = getMarketStatusDetail(d);
    expect(s.serverIst).toMatch(/^10:13\s/);
  });

  it("exchangeTimezone is always Asia/Kolkata", () => {
    const s = getMarketStatusDetail(istToUtc(MON, 10, 0));
    expect(s.exchangeTimezone).toBe("Asia/Kolkata");
  });

  it("openTimeIst=09:15, closeTimeIst=15:30", () => {
    const s = getMarketStatusDetail(istToUtc(MON, 10, 0));
    expect(s.openTimeIst).toBe("09:15");
    expect(s.closeTimeIst).toBe("15:30");
  });
});

// ── NSE holiday detection ────────────────────────────────────────────────────────

describe("getMarketStatusDetail — NSE holidays", () => {
  it("Republic Day 2026-01-26 (Monday) → HOLIDAY, not OPEN", () => {
    const d = istToUtc("2026-01-26", 10, 0);
    const s = getMarketStatusDetail(d);
    expect(s.reason).toBe("HOLIDAY");
    expect(s.marketOpen).toBe(false);
    expect(s.isTradingDay).toBe(false);
  });
});

// ── isNseHoliday standalone ──────────────────────────────────────────────────────

describe("isNseHoliday", () => {
  it("2026-01-26 is a holiday", () => {
    const d = istToUtc("2026-01-26", 12, 0);
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    expect(isNseHoliday(ist)).toBe(true);
  });

  it("2026-07-13 (Monday, not a holiday) is false", () => {
    const d = istToUtc("2026-07-13", 12, 0);
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    expect(isNseHoliday(ist)).toBe(false);
  });
});

// ── computeMarketStatus (legacy 3-state) ────────────────────────────────────────

describe("computeMarketStatus — legacy compat", () => {
  it("2026-07-13 10:13 IST → open", () => {
    const d = istToUtc("2026-07-13", 10, 13);
    expect(computeMarketStatus(d)).toBe("open");
  });

  it("2026-07-13 08:50 IST → closed (before open)", () => {
    const d = istToUtc("2026-07-13", 8, 50);
    expect(computeMarketStatus(d)).toBe("closed");
  });

  it("2026-07-13 09:07 IST → pre_open", () => {
    const d = istToUtc("2026-07-13", 9, 7);
    expect(computeMarketStatus(d)).toBe("pre_open");
  });

  it("2026-07-12 (Sunday) 10:00 IST → closed", () => {
    const d = istToUtc("2026-07-12", 10, 0);
    expect(computeMarketStatus(d)).toBe("closed");
  });
});
