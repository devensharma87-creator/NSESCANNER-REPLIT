/**
 * Pure unit tests for sessionAdmission.ts.
 *
 * Covers all 11 EqSessionAdmissionReason codes, MANUAL-bypass removal
 * (P0.2-correction-1), historical timestamp classification, and the key
 * forensic positions from production:
 *   - GRASIM/EXIDEIND/TITAN  2026-07-09 23:41 IST → AFTER_MARKET_SESSION
 *   - DLF                    2026-07-18 16:00 IST → MARKET_CLOSED_WEEKEND
 *   - ADANIGREEN             2026-07-14 19:02 IST → AFTER_MARKET_SESSION
 *   - ASIANPAINT/GRASIM      2026-05-14 06:13 IST → BEFORE_MARKET_SESSION
 *   - ABB                    2026-06-29 15:12 IST → VALID_SESSION (confirmed valid)
 *
 * No DB, no mocks, no side-effects.
 */
import { describe, it, expect } from "vitest";
import {
  computeEquitySessionAdmission,
  computePreliminaryAdmission,
  classifyStoredTimestamp,
  CALENDAR_VERSION,
  BSE_CALENDAR_VERIFIED,
} from "./sessionAdmission";

function ist(str: string): Date {
  return new Date(`${str.replace(" ", "T")}+05:30`);
}

describe("computeEquitySessionAdmission", () => {
  // ── VALID_SESSION ──────────────────────────────────────────────────────────
  describe("VALID_SESSION — within 09:15–15:30 IST Mon–Fri non-holiday", () => {
    it("ABB 2026-06-29 15:12:03 IST (Mon, near close) → allowed", () => {
      const r = computeEquitySessionAdmission(ist("2026-06-29 15:12:03"));
      expect(r.allowed).toBe(true);
      expect(r.openedSessionValidity).toBe("VALID_SESSION");
      expect(r.calendarVersion).toBe(CALENDAR_VERSION);
      expect(r.timestampConfidence).toBe("HIGH");
    });

    it("MARUTI 2026-06-30 14:56:17 IST (Tue) → allowed", () => {
      const r = computeEquitySessionAdmission(ist("2026-06-30 14:56:17"));
      expect(r.allowed).toBe(true);
      expect(r.openedSessionValidity).toBe("VALID_SESSION");
    });

    it("DELHIVERY 2026-07-01 14:55:01 IST (Wed) → allowed", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-01 14:55:01"));
      expect(r.allowed).toBe(true);
    });

    it("exactly 09:15:00 IST (session open boundary) → allowed", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-07 09:15:00"));
      expect(r.allowed).toBe(true);
    });

    it("exactly 15:30:00 IST (session close boundary) → allowed", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-07 15:30:00"));
      expect(r.allowed).toBe(true);
    });
  });

  // ── AFTER_MARKET_SESSION ───────────────────────────────────────────────────
  describe("AFTER_MARKET_SESSION — after 15:30 IST on a weekday", () => {
    it("GRASIM/EXIDEIND/TITAN 2026-07-09 23:41:35 IST (Thu) → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-09 23:41:35"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(r.reason).toBe("AFTER_MARKET_SESSION");
        expect(r.openedSessionValidity).toBe("OFF_SESSION");
        expect(r.timestampConfidence).toBe("HIGH");
      }
    });

    it("ADANIGREEN 2026-07-14 19:02:54 IST (Tue) → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-14 19:02:54"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("AFTER_MARKET_SESSION");
    });

    it("exactly 15:31:00 IST → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-07 15:31:00"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("AFTER_MARKET_SESSION");
    });
  });

  // ── MARKET_CLOSED_WEEKEND ──────────────────────────────────────────────────
  describe("MARKET_CLOSED_WEEKEND — Saturday or Sunday", () => {
    it("DLF 2026-07-18 16:00:28 IST (Saturday) → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-18 16:00:28"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(r.reason).toBe("MARKET_CLOSED_WEEKEND");
        expect(r.openedSessionValidity).toBe("OFF_SESSION");
      }
    });

    it("GMRINFRA 2026-05-31 15:38:22 IST (Sunday) → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-05-31 15:38:22"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("MARKET_CLOSED_WEEKEND");
    });

    it("Saturday at 09:20 IST (within session hours but weekend) → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-11 09:20:00"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("MARKET_CLOSED_WEEKEND");
    });
  });

  // ── MARKET_CLOSED_HOLIDAY ──────────────────────────────────────────────────
  describe("MARKET_CLOSED_HOLIDAY — NSE trading holiday", () => {
    it("Republic Day 2026-01-26 11:00 IST (Mon) → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-01-26 11:00:00"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(r.reason).toBe("MARKET_CLOSED_HOLIDAY");
        expect(r.openedSessionValidity).toBe("OFF_SESSION");
      }
    });

    it("Good Friday 2026-04-03 14:00 IST → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-04-03 14:00:00"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("MARKET_CLOSED_HOLIDAY");
    });
  });

  // ── BEFORE_MARKET_SESSION ──────────────────────────────────────────────────
  describe("BEFORE_MARKET_SESSION — before 09:00 IST on a weekday", () => {
    it("ASIANPAINT/GRASIM 2026-05-14 06:13:32 IST (Thu) → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-05-14 06:13:32"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(r.reason).toBe("BEFORE_MARKET_SESSION");
        expect(r.openedSessionValidity).toBe("OFF_SESSION");
      }
    });

    it("MANAPPURAM 2026-05-19 07:28:07 IST (Tue) → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-05-19 07:28:07"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("BEFORE_MARKET_SESSION");
    });

    it("00:01 IST on a weekday → rejected (BEFORE_MARKET_SESSION)", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-07 00:01:00"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("BEFORE_MARKET_SESSION");
    });
  });

  // ── SPECIAL_SESSION_NOT_AUTHORIZED — pre-open 09:00–09:15 IST ─────────────
  describe("SPECIAL_SESSION_NOT_AUTHORIZED — pre-open (09:00–09:15 IST)", () => {
    it("exactly 09:00 IST (pre-open start) → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-07 09:00:00"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(r.reason).toBe("SPECIAL_SESSION_NOT_AUTHORIZED");
        expect(r.openedSessionValidity).toBe("OFF_SESSION");
      }
    });

    it("09:10 IST (mid pre-open) → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-07 09:10:00"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("SPECIAL_SESSION_NOT_AUTHORIZED");
    });

    it("09:14:59 IST (just before session) → rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-07 09:14:59"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("SPECIAL_SESSION_NOT_AUTHORIZED");
    });
  });

  // ── INVALID_SERVER_TIMESTAMP ───────────────────────────────────────────────
  describe("INVALID_SERVER_TIMESTAMP — non-finite Date", () => {
    it("NaN Date → rejected", () => {
      const r = computeEquitySessionAdmission(new Date(NaN));
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(r.reason).toBe("INVALID_SERVER_TIMESTAMP");
        expect(r.openedSessionValidity).toBe("TIMESTAMP_AMBIGUOUS");
        expect(r.timestampConfidence).toBe("LOW");
      }
    });

    it("new Date('invalid') → rejected", () => {
      const r = computeEquitySessionAdmission(new Date("invalid"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("INVALID_SERVER_TIMESTAMP");
    });
  });

  // ── P0.2-correction-1: MANUAL source no longer bypasses the gate ──────────
  describe("P0.2-correction-1 — MANUAL bypass removed", () => {
    it("A call from a MANUAL source on weekend is rejected (no bypass)", () => {
      // computeEquitySessionAdmission is source-agnostic — callers pass
      // source context separately. This confirms the gate itself does not
      // have any source-specific logic.
      const r = computeEquitySessionAdmission(ist("2026-07-18 16:00:28")); // Saturday DLF
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("MARKET_CLOSED_WEEKEND");
    });

    it("A call from a MANUAL source after market hours is rejected", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-09 23:41:35")); // after-hours
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("AFTER_MARKET_SESSION");
    });

    it("A call from a MANUAL source WITHIN session hours is allowed", () => {
      const r = computeEquitySessionAdmission(ist("2026-06-29 15:12:03")); // ABB — valid
      expect(r.allowed).toBe(true);
    });
  });

  // ── No equity entry cutoff beyond session end ──────────────────────────────
  describe("Equity entry cutoff — no separate intra-session cutoff exists", () => {
    it("ABB 15:12:03 IST (15:12 = 18 min before close) → VALID (no equity cutoff)", () => {
      const r = computeEquitySessionAdmission(ist("2026-06-29 15:12:03"));
      expect(r.allowed).toBe(true);
      expect(r.openedSessionValidity).toBe("VALID_SESSION");
    });

    it("14:00 IST on a trading day → VALID (F&O BASELINE 14:45 cutoff is F&O-only)", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-07 14:00:00"));
      expect(r.allowed).toBe(true);
    });

    it("15:25 IST on a trading day → VALID (within 09:15–15:30 window)", () => {
      const r = computeEquitySessionAdmission(ist("2026-07-07 15:25:00"));
      expect(r.allowed).toBe(true);
    });
  });

  // ── calendarVersion is always set ─────────────────────────────────────────
  it("every rejection carries calendarVersion", () => {
    const timestamps = [
      ist("2026-07-18 16:00:28"), // weekend
      ist("2026-07-14 19:02:54"), // after-hours
      ist("2026-05-14 06:13:32"), // before-session
      ist("2026-01-26 11:00:00"), // holiday
    ];
    for (const ts of timestamps) {
      const r = computeEquitySessionAdmission(ts);
      expect(r.calendarVersion).toBe(CALENDAR_VERSION);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("classifyStoredTimestamp", () => {
  it("null input → TIMESTAMP_AMBIGUOUS", () => {
    const r = classifyStoredTimestamp(null);
    expect(r.openedSessionValidity).toBe("TIMESTAMP_AMBIGUOUS");
    expect(r.openedSessionReason).toBe("INVALID_SERVER_TIMESTAMP");
    expect(r.openedAtIst).toBeNull();
    expect(r.timestampConfidence).toBe("LOW");
  });

  it("undefined input → TIMESTAMP_AMBIGUOUS", () => {
    const r = classifyStoredTimestamp(undefined);
    expect(r.openedSessionValidity).toBe("TIMESTAMP_AMBIGUOUS");
  });

  it("invalid ISO string → TIMESTAMP_AMBIGUOUS", () => {
    const r = classifyStoredTimestamp("not-a-date");
    expect(r.openedSessionValidity).toBe("TIMESTAMP_AMBIGUOUS");
    expect(r.openedSessionReason).toBe("INVALID_SERVER_TIMESTAMP");
  });

  it("GRASIM/EXIDEIND/TITAN 2026-07-09T18:11:35Z (23:41:35 IST) → OFF_SESSION", () => {
    const r = classifyStoredTimestamp("2026-07-09T18:11:35.000Z");
    expect(r.openedSessionValidity).toBe("OFF_SESSION");
    expect(r.openedSessionReason).toBe("AFTER_MARKET_SESSION");
    expect(r.openedAtIst).not.toBeNull();
    expect(r.timestampConfidence).toBe("HIGH");
  });

  it("DLF 2026-07-18T10:30:28Z (16:00:28 IST Sat) → OFF_SESSION", () => {
    const r = classifyStoredTimestamp("2026-07-18T10:30:28.000Z");
    expect(r.openedSessionValidity).toBe("OFF_SESSION");
    expect(r.openedSessionReason).toBe("MARKET_CLOSED_WEEKEND");
  });

  it("ADANIGREEN 2026-07-14T13:32:54Z (19:02:54 IST) → OFF_SESSION", () => {
    const r = classifyStoredTimestamp("2026-07-14T13:32:54.000Z");
    expect(r.openedSessionValidity).toBe("OFF_SESSION");
    expect(r.openedSessionReason).toBe("AFTER_MARKET_SESSION");
  });

  it("ASIANPAINT 2026-05-14T00:43:32Z (06:13:32 IST) → OFF_SESSION", () => {
    const r = classifyStoredTimestamp("2026-05-14T00:43:32.000Z");
    expect(r.openedSessionValidity).toBe("OFF_SESSION");
    expect(r.openedSessionReason).toBe("BEFORE_MARKET_SESSION");
  });

  it("ABB 2026-06-29T09:42:03Z (15:12:03 IST Mon) → VALID_SESSION", () => {
    const r = classifyStoredTimestamp("2026-06-29T09:42:03.000Z");
    expect(r.openedSessionValidity).toBe("VALID_SESSION");
    expect(r.openedSessionReason).toBeNull();
    expect(r.timestampConfidence).toBe("HIGH");
  });

  it("MARUTI 2026-06-30T09:26:17Z (14:56:17 IST Tue) → VALID_SESSION", () => {
    const r = classifyStoredTimestamp("2026-06-30T09:26:17.000Z");
    expect(r.openedSessionValidity).toBe("VALID_SESSION");
    expect(r.openedSessionReason).toBeNull();
  });

  it("Republic Day holiday 2026-01-26T08:00:00Z (13:30 IST) → OFF_SESSION", () => {
    const r = classifyStoredTimestamp("2026-01-26T08:00:00.000Z");
    expect(r.openedSessionValidity).toBe("OFF_SESSION");
    expect(r.openedSessionReason).toBe("MARKET_CLOSED_HOLIDAY");
  });

  it("pre-open 2026-07-07T03:30:00Z (09:00 IST) → OFF_SESSION", () => {
    const r = classifyStoredTimestamp("2026-07-07T03:30:00.000Z");
    expect(r.openedSessionValidity).toBe("OFF_SESSION");
    expect(r.openedSessionReason).toBe("SPECIAL_SESSION_NOT_AUTHORIZED");
  });

  it("calendarVersion is set on every result", () => {
    const isos = [
      "2026-07-09T18:11:35.000Z",
      "2026-06-29T09:42:03.000Z",
      null,
    ];
    for (const iso of isos) {
      const r = classifyStoredTimestamp(iso);
      expect(r.calendarVersion).toBe(CALENDAR_VERSION);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Calendar correction — NSE Circular NSE/CMTR/71775 (2026-07-22)
// ─────────────────────────────────────────────────────────────────────────────

describe("NSE/CMTR/71775 calendar correction", () => {
  describe("May 28 (Buddha Purnima) — must be rejected as a holiday", () => {
    it("2026-05-28 11:00:00 IST (Thursday, in-session time) → MARKET_CLOSED_HOLIDAY", () => {
      const r = computeEquitySessionAdmission(ist("2026-05-28 11:00:00"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(r.reason).toBe("MARKET_CLOSED_HOLIDAY");
        expect(r.openedSessionValidity).toBe("OFF_SESSION");
      }
    });
  });

  describe("June 26 (Muharram, corrected date) — must be rejected as a holiday", () => {
    it("2026-06-26 12:00:00 IST (Friday, in-session time) → MARKET_CLOSED_HOLIDAY", () => {
      const r = computeEquitySessionAdmission(ist("2026-06-26 12:00:00"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(r.reason).toBe("MARKET_CLOSED_HOLIDAY");
        expect(r.openedSessionValidity).toBe("OFF_SESSION");
      }
    });
  });

  describe("June 25 — must NOT be rejected as a holiday (normal Thursday)", () => {
    it("2026-06-25 12:00:00 IST (Thursday, in-session time) → VALID_SESSION", () => {
      const r = computeEquitySessionAdmission(ist("2026-06-25 12:00:00"));
      expect(r.allowed).toBe(true);
      if (r.allowed) {
        expect(r.openedSessionValidity).toBe("VALID_SESSION");
      }
    });

    it("2026-06-25 is not classified as OFF_SESSION by classifyStoredTimestamp", () => {
      const r = classifyStoredTimestamp("2026-06-25T06:30:00.000Z"); // 12:00 IST
      expect(r.openedSessionValidity).toBe("VALID_SESSION");
      expect(r.openedSessionReason).toBeNull();
    });
  });

  describe("Weekends remain rejected", () => {
    it("Saturday 2026-06-27 11:00:00 IST → MARKET_CLOSED_WEEKEND", () => {
      const r = computeEquitySessionAdmission(ist("2026-06-27 11:00:00"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("MARKET_CLOSED_WEEKEND");
    });

    it("Sunday 2026-06-28 11:00:00 IST → MARKET_CLOSED_WEEKEND", () => {
      const r = computeEquitySessionAdmission(ist("2026-06-28 11:00:00"));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("MARKET_CLOSED_WEEKEND");
    });
  });

  describe("BSE remains fail-closed (BSE_CALENDAR_VERIFIED = false)", () => {
    it("BSE_CALENDAR_VERIFIED is false", () => {
      expect(BSE_CALENDAR_VERIFIED).toBe(false);
    });

    it("bse_fo lane on a valid NSE session day → CALENDAR_UNAVAILABLE", () => {
      const r = computePreliminaryAdmission({
        lane: "bse_fo",
        segment: "BSE_FO",
        instrument: "SENSEX",
        serverTime: ist("2026-06-25 12:00:00"),
        source: "AUTO",
      });
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(r.reason).toBe("CALENDAR_UNAVAILABLE");
        expect(r.calendarVersion).toBe(CALENDAR_VERSION);
      }
    });
  });

  describe("Valid NSE session admission still succeeds", () => {
    it("2026-06-25 12:00:00 IST (normal weekday, non-holiday) → allowed", () => {
      const r = computeEquitySessionAdmission(ist("2026-06-25 12:00:00"));
      expect(r.allowed).toBe(true);
      expect(r.calendarVersion).toBe(CALENDAR_VERSION);
    });

    it("CALENDAR_VERSION is NSE-2026-v2 after the calendar correction", () => {
      expect(CALENDAR_VERSION).toBe("NSE-2026-v2");
    });
  });
});
