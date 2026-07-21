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
 * `computeMarketStatus` is the pure gate function used inside
 * `openPaperEquityTrade`. Tests here verify it returns the expected status
 * for each real-world timestamp that was misclassified pre-fix.
 *
 * No DB access, no mocks, no side effects.
 */
import { describe, it, expect } from "vitest";
import { computeMarketStatus } from "./marketEvents";

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
