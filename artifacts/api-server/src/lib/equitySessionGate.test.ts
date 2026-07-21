/**
 * Pure unit tests for the equity paper-trade market-session gate.
 *
 * All timestamps are derived from confirmed production forensics:
 *   - GRASIM/EXIDEIND/TITAN opened 2026-07-09 23:41:35 IST  (after-hours)
 *   - DLF opened 2026-07-18 16:00:28 IST                    (Saturday)
 *   - ADANIGREEN opened 2026-07-14 19:02:54 IST             (after-hours)
 *   - ASIANPAINT/GRASIM opened 2026-05-14 06:13:32 IST      (before session)
 *   - GMRINFRA opened 2026-05-31 15:38:22 IST               (Sunday + after close)
 *   - MARUTI opened 2026-06-30 14:56:17 IST                 (valid)
 *   - DELHIVERY opened 2026-07-01 14:55:01 IST              (valid)
 *   - ABB opened 2026-06-29 15:12:03 IST                    (valid, near close)
 *
 * Section 1: `computeMarketStatus` legacy gate (pre-P0.2 reference tests).
 * Section 2: P0.2 focused corrections — structured reason codes, MANUAL-bypass
 *            removal, ABB validity confirmation, positions augmentation contract.
 *
 * No DB access, no mocks, no side effects.
 */
import { describe, it, expect } from "vitest";
import { computeMarketStatus } from "./marketEvents";
import {
  computeEquitySessionAdmission,
  classifyStoredTimestamp,
  CALENDAR_VERSION,
} from "./sessionAdmission";

/** Convert an IST wall-clock string to a UTC Date (IST = UTC+05:30). */
function istToUtc(istDatetimeStr: string): Date {
  return new Date(`${istDatetimeStr.replace(" ", "T")}+05:30`);
}

describe("computeMarketStatus — equity session gate", () => {
  // ── Invalid: after-hours (post 15:30 IST on a weekday) ─────────────────
  it("returns closed for 2026-07-09 23:41:35 IST (Thu after-hours — GRASIM/EXIDEIND/TITAN cluster)", () => {
    expect(computeMarketStatus(istToUtc("2026-07-09 23:41:35"))).toBe("closed");
  });

  it("returns closed for 2026-07-14 19:02:54 IST (Tue after-hours — ADANIGREEN)", () => {
    expect(computeMarketStatus(istToUtc("2026-07-14 19:02:54"))).toBe("closed");
  });

  it("returns closed for 2026-06-16 21:25:33 IST (Tue after-hours — PHOENIXLTD)", () => {
    expect(computeMarketStatus(istToUtc("2026-06-16 21:25:33"))).toBe("closed");
  });

  it("returns closed for 2026-06-29 17:05:28 IST (Mon after-hours — TORNTPHARM)", () => {
    expect(computeMarketStatus(istToUtc("2026-06-29 17:05:28"))).toBe("closed");
  });

  it("returns closed for 2026-07-03 21:32:00 IST (Fri after-hours — INDUSINDBK)", () => {
    expect(computeMarketStatus(istToUtc("2026-07-03 21:32:00"))).toBe("closed");
  });

  it("returns closed for 2026-05-15 19:34:00 IST (Fri after-hours — GRASIM/JSWSTEEL)", () => {
    expect(computeMarketStatus(istToUtc("2026-05-15 19:34:00"))).toBe("closed");
  });

  // ── Invalid: before session (pre 09:15 IST on a weekday) ───────────────
  it("returns closed for 2026-05-14 06:13:32 IST (Thu pre-session — ASIANPAINT/GRASIM)", () => {
    expect(computeMarketStatus(istToUtc("2026-05-14 06:13:32"))).toBe("closed");
  });

  it("returns closed for 2026-05-19 07:28:07 IST (Tue pre-session — MANAPPURAM)", () => {
    expect(computeMarketStatus(istToUtc("2026-05-19 07:28:07"))).toBe("closed");
  });

  // ── Invalid: weekend ────────────────────────────────────────────────────
  it("returns closed for 2026-07-18 16:00:28 IST (Saturday — DLF)", () => {
    expect(computeMarketStatus(istToUtc("2026-07-18 16:00:28"))).toBe("closed");
  });

  it("returns closed for 2026-05-31 15:38:22 IST (Sunday — GMRINFRA)", () => {
    expect(computeMarketStatus(istToUtc("2026-05-31 15:38:22"))).toBe("closed");
  });

  // ── Valid: within session (09:15–15:30 IST Mon–Fri) ────────────────────
  it("returns open for 2026-06-30 14:56:17 IST (Tue valid — MARUTI)", () => {
    expect(computeMarketStatus(istToUtc("2026-06-30 14:56:17"))).toBe("open");
  });

  it("returns open for 2026-07-01 14:55:01 IST (Wed valid — DELHIVERY)", () => {
    expect(computeMarketStatus(istToUtc("2026-07-01 14:55:01"))).toBe("open");
  });

  it("returns open for 2026-06-29 15:12:03 IST (Mon valid near close — ABB)", () => {
    expect(computeMarketStatus(istToUtc("2026-06-29 15:12:03"))).toBe("open");
  });

  it("returns open for 2026-05-13 12:49:18 IST (Wed valid — BERGEPAINT/ASIANPAINT)", () => {
    expect(computeMarketStatus(istToUtc("2026-05-13 12:49:18"))).toBe("open");
  });

  // ── Boundary: pre-open (09:00–09:15 IST) ───────────────────────────────
  it("returns pre_open for 09:00 IST on a weekday", () => {
    expect(computeMarketStatus(istToUtc("2026-07-07 09:00:00"))).toBe("pre_open");
  });

  it("returns pre_open for 09:14 IST on a weekday", () => {
    expect(computeMarketStatus(istToUtc("2026-07-07 09:14:59"))).toBe("pre_open");
  });

  // ── Boundary: session open at exactly 09:15 ─────────────────────────────
  it("returns open at exactly 09:15:00 IST on a weekday", () => {
    expect(computeMarketStatus(istToUtc("2026-07-07 09:15:00"))).toBe("open");
  });

  // ── Boundary: session close at exactly 15:30 ────────────────────────────
  it("returns open at exactly 15:30:00 IST on a weekday", () => {
    expect(computeMarketStatus(istToUtc("2026-07-07 15:30:00"))).toBe("open");
  });

  it("returns closed at 15:31 IST on a weekday", () => {
    expect(computeMarketStatus(istToUtc("2026-07-07 15:31:00"))).toBe("closed");
  });

  // ── Weekend edges ────────────────────────────────────────────────────────
  it("returns closed at midday on Saturday (DOW=6)", () => {
    expect(computeMarketStatus(istToUtc("2026-07-11 12:00:00"))).toBe("closed");
  });

  it("returns closed at midday on Sunday (DOW=0)", () => {
    expect(computeMarketStatus(istToUtc("2026-07-12 12:00:00"))).toBe("closed");
  });

  // ── Monday after the Saturday invalid open ───────────────────────────────
  it("returns open at 11:30 IST on the Monday after the Sat DLF open (2026-07-20)", () => {
    expect(computeMarketStatus(istToUtc("2026-07-20 11:30:00"))).toBe("open");
  });

  // ── Before market opens (before 09:00 IST) ──────────────────────────────
  it("returns closed before 09:00 IST on a weekday", () => {
    expect(computeMarketStatus(istToUtc("2026-07-07 08:59:59"))).toBe("closed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: P0.2 focused corrections (2026-07-21)
// ─────────────────────────────────────────────────────────────────────────────

describe("P0.2 corrections — computeEquitySessionAdmission structured reason codes", () => {
  // ── P0.2-correction-1: MANUAL bypass removed ────────────────────────────
  it("rejects a Saturday MANUAL open (DLF pattern) — no source-based bypass", () => {
    const r = computeEquitySessionAdmission(istToUtc("2026-07-18 16:00:28"));
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe("MARKET_CLOSED_WEEKEND");
      expect(r.openedSessionValidity).toBe("OFF_SESSION");
    }
  });

  it("rejects an after-hours MANUAL open (GRASIM/EXIDEIND/TITAN pattern)", () => {
    const r = computeEquitySessionAdmission(istToUtc("2026-07-09 23:41:35"));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("AFTER_MARKET_SESSION");
  });

  it("rejects a before-session MANUAL open (ASIANPAINT/GRASIM pattern)", () => {
    const r = computeEquitySessionAdmission(istToUtc("2026-05-14 06:13:32"));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("BEFORE_MARKET_SESSION");
  });

  // ── ABB 2026-06-29 15:12 IST → confirmed VALID (not a false positive) ───
  it("ABB 2026-06-29 15:12:03 IST → VALID_SESSION (was a legitimate open)", () => {
    const r = computeEquitySessionAdmission(istToUtc("2026-06-29 15:12:03"));
    expect(r.allowed).toBe(true);
    expect(r.openedSessionValidity).toBe("VALID_SESSION");
    expect(r.calendarVersion).toBe(CALENDAR_VERSION);
    expect(r.timestampConfidence).toBe("HIGH");
  });

  // ── Structured reason field on every rejection ───────────────────────────
  it("reason field present on after-hours rejection (AFTER_MARKET_SESSION)", () => {
    const r = computeEquitySessionAdmission(istToUtc("2026-07-14 19:02:54"));
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toMatch(/^(AFTER_MARKET_SESSION|MARKET_CLOSED_WEEKEND|MARKET_CLOSED_HOLIDAY|BEFORE_MARKET_SESSION|SPECIAL_SESSION_NOT_AUTHORIZED|INVALID_SERVER_TIMESTAMP|CALENDAR_UNAVAILABLE|TRADE_ADMISSION_CONTEXT_INCOMPLETE|ENTRY_CUTOFF_PASSED)$/);
      expect(typeof r.detail).toBe("string");
      expect(r.detail.length).toBeGreaterThan(10);
    }
  });

  // ── pre-open returns SPECIAL_SESSION_NOT_AUTHORIZED (not BEFORE_SESSION) ─
  it("09:08 IST pre-open → SPECIAL_SESSION_NOT_AUTHORIZED (distinct from BEFORE_MARKET_SESSION)", () => {
    const r = computeEquitySessionAdmission(istToUtc("2026-07-07 09:08:00"));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("SPECIAL_SESSION_NOT_AUTHORIZED");
  });

  // ── calendarVersion carried on both allowed and rejected results ─────────
  it("calendarVersion is set on an allowed result", () => {
    const r = computeEquitySessionAdmission(istToUtc("2026-07-07 12:00:00"));
    expect(r.calendarVersion).toBe(CALENDAR_VERSION);
  });

  it("calendarVersion is set on a rejected result", () => {
    const r = computeEquitySessionAdmission(istToUtc("2026-07-18 16:00:28"));
    expect(r.calendarVersion).toBe(CALENDAR_VERSION);
  });
});

describe("P0.2 corrections — classifyStoredTimestamp (positions augmentation contract)", () => {
  // ── 5 forensic invalid production positions ──────────────────────────────
  it("GRASIM/EXIDEIND/TITAN 2026-07-09T18:11:35Z → OFF_SESSION / AFTER_MARKET_SESSION", () => {
    const r = classifyStoredTimestamp("2026-07-09T18:11:35.000Z");
    expect(r.openedSessionValidity).toBe("OFF_SESSION");
    expect(r.openedSessionReason).toBe("AFTER_MARKET_SESSION");
    expect(r.openedAtIst).not.toBeNull();
    expect(r.timestampConfidence).toBe("HIGH");
  });

  it("DLF 2026-07-18T10:30:28Z → OFF_SESSION / MARKET_CLOSED_WEEKEND", () => {
    const r = classifyStoredTimestamp("2026-07-18T10:30:28.000Z");
    expect(r.openedSessionValidity).toBe("OFF_SESSION");
    expect(r.openedSessionReason).toBe("MARKET_CLOSED_WEEKEND");
  });

  it("ADANIGREEN 2026-07-14T13:32:54Z → OFF_SESSION / AFTER_MARKET_SESSION", () => {
    const r = classifyStoredTimestamp("2026-07-14T13:32:54.000Z");
    expect(r.openedSessionValidity).toBe("OFF_SESSION");
    expect(r.openedSessionReason).toBe("AFTER_MARKET_SESSION");
  });

  it("ASIANPAINT 2026-05-14T00:43:32Z → OFF_SESSION / BEFORE_MARKET_SESSION", () => {
    const r = classifyStoredTimestamp("2026-05-14T00:43:32.000Z");
    expect(r.openedSessionValidity).toBe("OFF_SESSION");
    expect(r.openedSessionReason).toBe("BEFORE_MARKET_SESSION");
  });

  it("GMRINFRA 2026-05-31T10:08:22Z (15:38 IST Sun) → OFF_SESSION / MARKET_CLOSED_WEEKEND", () => {
    const r = classifyStoredTimestamp("2026-05-31T10:08:22.000Z");
    expect(r.openedSessionValidity).toBe("OFF_SESSION");
    expect(r.openedSessionReason).toBe("MARKET_CLOSED_WEEKEND");
  });

  // ── ABB is VALID_SESSION, not a false positive ───────────────────────────
  it("ABB 2026-06-29T09:42:03Z (15:12 IST Mon) → VALID_SESSION", () => {
    const r = classifyStoredTimestamp("2026-06-29T09:42:03.000Z");
    expect(r.openedSessionValidity).toBe("VALID_SESSION");
    expect(r.openedSessionReason).toBeNull();
    expect(r.calendarVersion).toBe(CALENDAR_VERSION);
  });

  // ── null / invalid inputs ────────────────────────────────────────────────
  it("null → TIMESTAMP_AMBIGUOUS / INVALID_SERVER_TIMESTAMP", () => {
    const r = classifyStoredTimestamp(null);
    expect(r.openedSessionValidity).toBe("TIMESTAMP_AMBIGUOUS");
    expect(r.openedSessionReason).toBe("INVALID_SERVER_TIMESTAMP");
    expect(r.openedAtIst).toBeNull();
    expect(r.timestampConfidence).toBe("LOW");
  });

  it("undefined → TIMESTAMP_AMBIGUOUS", () => {
    const r = classifyStoredTimestamp(undefined);
    expect(r.openedSessionValidity).toBe("TIMESTAMP_AMBIGUOUS");
  });

  it("invalid ISO → TIMESTAMP_AMBIGUOUS", () => {
    const r = classifyStoredTimestamp("not-a-date");
    expect(r.openedSessionValidity).toBe("TIMESTAMP_AMBIGUOUS");
    expect(r.openedSessionReason).toBe("INVALID_SERVER_TIMESTAMP");
  });
});
