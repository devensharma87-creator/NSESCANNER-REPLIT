import { describe, expect, it } from "vitest";
import { isCountedForWinRate } from "./winRateClassification";

describe("isCountedForWinRate (2026-05-11.b denominator policy)", () => {
  it("counts TARGET1_HIT / TARGET2_HIT / STOPPED regardless of pnl", () => {
    expect(isCountedForWinRate("TARGET1_HIT", 1500)).toBe(true);
    expect(isCountedForWinRate("TARGET2_HIT", 5000)).toBe(true);
    expect(isCountedForWinRate("STOPPED", -800)).toBe(true);
    // STOPPED at break-even is rare but still a real exit:
    expect(isCountedForWinRate("STOPPED", 0)).toBe(true);
  });

  it("counts MANUAL_OVERRIDE (owner intentionally closed)", () => {
    expect(isCountedForWinRate("MANUAL_OVERRIDE", 250)).toBe(true);
    expect(isCountedForWinRate("MANUAL_OVERRIDE", -100)).toBe(true);
    // A filled trade exiting flat manually IS a real trade sample.
    expect(isCountedForWinRate("MANUAL_OVERRIDE", 0)).toBe(true);
  });

  it("counts EXPIRED only when pnl != 0 (filtering EOD-sweep rescues)", () => {
    expect(isCountedForWinRate("EXPIRED", 320)).toBe(true);
    expect(isCountedForWinRate("EXPIRED", -150)).toBe(true);
    // The exact case the fix targets — flat EXPIRED is a non-event:
    expect(isCountedForWinRate("EXPIRED", 0)).toBe(false);
  });

  it("ignores null / unknown exit reasons", () => {
    expect(isCountedForWinRate(null, 100)).toBe(false);
    expect(isCountedForWinRate(undefined, 100)).toBe(false);
    expect(isCountedForWinRate("FOO_BAR", 100)).toBe(false);
    expect(isCountedForWinRate("", 100)).toBe(false);
  });
});
