import { describe, it, expect } from "vitest";
import { countTradingDays } from "./fnoTradingDays";

function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day);
}

describe("countTradingDays — Mon–Fri only, no holiday list", () => {
  it("same day → 0", () => {
    expect(countTradingDays(d(2024, 1, 15), d(2024, 1, 15))).toBe(0);
  });

  it("inverted range → 0", () => {
    expect(countTradingDays(d(2024, 1, 20), d(2024, 1, 15))).toBe(0);
  });

  it("Mon → Tue = 1", () => {
    // 2024-01-15 Mon → 2024-01-16 Tue
    expect(countTradingDays(d(2024, 1, 15), d(2024, 1, 16))).toBe(1);
  });

  it("Mon → Fri same week = 4 (Tue+Wed+Thu+Fri)", () => {
    // 2024-01-15 Mon → 2024-01-19 Fri
    expect(countTradingDays(d(2024, 1, 15), d(2024, 1, 19))).toBe(4);
  });

  it("Mon → Mon next week = 5 (Tue–Fri + Mon)", () => {
    // 2024-01-15 Mon → 2024-01-22 Mon
    expect(countTradingDays(d(2024, 1, 15), d(2024, 1, 22))).toBe(5);
  });

  it("Fri → Sat = 0 (Sat does not count)", () => {
    // 2024-01-19 Fri → 2024-01-20 Sat
    expect(countTradingDays(d(2024, 1, 19), d(2024, 1, 20))).toBe(0);
  });

  it("Fri → Sun = 0 (Sun does not count)", () => {
    // 2024-01-19 Fri → 2024-01-21 Sun
    expect(countTradingDays(d(2024, 1, 19), d(2024, 1, 21))).toBe(0);
  });

  it("Fri → Mon = 1 (skips Sat+Sun)", () => {
    // 2024-01-19 Fri → 2024-01-22 Mon
    expect(countTradingDays(d(2024, 1, 19), d(2024, 1, 22))).toBe(1);
  });

  it("Sat → Mon = 1 (only Mon counted)", () => {
    // 2024-01-20 Sat → 2024-01-22 Mon
    expect(countTradingDays(d(2024, 1, 20), d(2024, 1, 22))).toBe(1);
  });

  it("Sun → Mon = 1", () => {
    // 2024-01-21 Sun → 2024-01-22 Mon
    expect(countTradingDays(d(2024, 1, 21), d(2024, 1, 22))).toBe(1);
  });

  it("two full weeks Mon → Mon = 10", () => {
    // 2024-01-15 Mon → 2024-01-29 Mon = 10
    expect(countTradingDays(d(2024, 1, 15), d(2024, 1, 29))).toBe(10);
  });

  it("three calendar days spanning a weekend Thu → Mon = 2 (Thu→Fri=1, Mon=1)", () => {
    // 2024-01-18 Thu → 2024-01-22 Mon
    expect(countTradingDays(d(2024, 1, 18), d(2024, 1, 22))).toBe(2);
  });

  it("month boundary: Jan 31 Wed → Feb 5 Mon 2025 = 3 (Thu+Fri+Mon)", () => {
    // 2025-01-31 Fri → 2025-02-05 Wed
    // Fri → Mon=1, Tue=2, Wed=3
    expect(countTradingDays(d(2025, 1, 31), d(2025, 2, 5))).toBe(3);
  });

  it("year boundary: Dec 31 Tue → Jan 3 Fri 2024/2025 = 3 (Wed+Thu+Fri)", () => {
    // 2024-12-31 Tue → 2025-01-03 Fri; to-date is inclusive → Wed+Thu+Fri
    expect(countTradingDays(d(2024, 12, 31), d(2025, 1, 3))).toBe(3);
  });
});
