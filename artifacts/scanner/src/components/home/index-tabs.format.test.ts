/**
 * Fake-zero guard for the Home MiniCard signed formatters (T003).
 *
 * The MiniCard previously coerced a genuinely-missing change/changePercent to
 * a fabricated "+0.00%" via `?? 0`. These pure formatters must render "—" for
 * null/undefined/NaN and only ever format a real number.
 */
import { describe, it, expect } from "vitest";
import { formatSignedPct, formatSignedNum } from "./index-tabs";

describe("formatSignedPct", () => {
  it("returns — for null/undefined/NaN (no fake +0.00%)", () => {
    expect(formatSignedPct(null)).toBe("—");
    expect(formatSignedPct(undefined)).toBe("—");
    expect(formatSignedPct(NaN)).toBe("—");
  });

  it("formats a real zero honestly (distinct from missing)", () => {
    expect(formatSignedPct(0)).toBe("+0.00%");
  });

  it("formats positive and negative values with sign", () => {
    expect(formatSignedPct(1.234)).toBe("+1.23%");
    expect(formatSignedPct(-0.5)).toBe("-0.50%");
  });
});

describe("formatSignedNum", () => {
  it("returns — for null/undefined/NaN", () => {
    expect(formatSignedNum(null)).toBe("—");
    expect(formatSignedNum(undefined)).toBe("—");
    expect(formatSignedNum(NaN)).toBe("—");
  });

  it("formats real values with sign", () => {
    expect(formatSignedNum(0)).toBe("+0.00");
    expect(formatSignedNum(12.5)).toBe("+12.50");
    expect(formatSignedNum(-3)).toBe("-3.00");
  });
});
