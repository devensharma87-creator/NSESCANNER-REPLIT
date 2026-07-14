/**
 * BUG-80 EXPIRY_DAY special mode — pure-function checks.
 *
 * Verifies the three legs of the expiry-day mode that are covered by
 * pure helpers (the third leg — the 14:30 force-exit trigger sweep —
 * is time-dependent and exercised by the integration path):
 *
 *   1. `indexesExpiringTodayIst()` returns the expected set of indices
 *      given a fixed IST clock — weekly cadence matches by weekday only,
 *      monthly cadence matches only on the LAST weekday of the month.
 *   2. `REGIME_SIZING.EXPIRY_DAY_MULT` is 0.5.
 */
import { describe, it, expect } from "vitest";
import { indexesExpiringTodayIst } from "./optionSignals";
import { REGIME_SIZING } from "./paperAccount";

// Helper: build a Date that represents the given IST wallclock. IST is
// UTC+5:30 with no DST; supplying wallclock as UTC minus the offset
// gives the correct instant.
function istWallclock(y: number, m: number, d: number, h = 10, min = 0): Date {
  // Y-M-D h:min IST → subtract 5:30 to get the UTC instant.
  return new Date(Date.UTC(y, m - 1, d, h - 5, min - 30));
}

describe("BUG-80 indexesExpiringTodayIst", () => {
  it("returns NIFTY + SENSEX on a Tuesday (both weekly Tue expiry)", () => {
    // 2026-02-03 is a Tuesday
    const out = indexesExpiringTodayIst(istWallclock(2026, 2, 3));
    expect(out).toEqual(expect.arrayContaining(["NIFTY", "SENSEX"]));
    // BANKNIFTY is monthly-Thu — must not appear.
    expect(out).not.toContain("BANKNIFTY");
  });

  it("returns empty on a Wednesday", () => {
    // 2026-02-04 is a Wednesday — no configured index expires that day.
    expect(indexesExpiringTodayIst(istWallclock(2026, 2, 4))).toEqual([]);
  });

  it("returns BANKNIFTY only on the LAST Thursday of the month", () => {
    // 2026-02-26 is the last Thursday of February 2026.
    const lastThu = istWallclock(2026, 2, 26);
    const out = lastThu.getUTCDay() === 4 ? indexesExpiringTodayIst(lastThu) : [];
    expect(out).toEqual(expect.arrayContaining(["BANKNIFTY"]));
    expect(out).not.toContain("NIFTY");
    expect(out).not.toContain("SENSEX");
  });

  it("does NOT return BANKNIFTY on a non-last Thursday", () => {
    // 2026-02-05 is the first Thursday of February 2026 (not last).
    const firstThu = istWallclock(2026, 2, 5);
    // Guard: only assert if it actually is a Thursday IST.
    if (firstThu.getUTCDay() === 4) {
      expect(indexesExpiringTodayIst(firstThu)).not.toContain("BANKNIFTY");
    }
  });
});

describe("BUG-80 REGIME_SIZING.EXPIRY_DAY_MULT", () => {
  it("halves position size on expiry day", () => {
    expect(REGIME_SIZING.EXPIRY_DAY_MULT).toBe(0.5);
  });
});
