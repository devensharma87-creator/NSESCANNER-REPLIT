/**
 * paperAnalyticsFO — win-rate zero-denominator honesty.
 *
 * `foWinRate` is the single source of truth for the summary and per-setup
 * win rate. The contract under test: a bucket with no DECIDED trades
 * (wins + losses === 0) returns `null`, never a fabricated 0% / 100%, so the
 * UI can honestly render "—".
 */
import { describe, it, expect } from "vitest";

import { foWinRate } from "./paperAnalyticsFO";

describe("foWinRate — honest zero-denominator", () => {
  it("returns null when there are no decided trades", () => {
    expect(foWinRate(0, 0)).toBeNull();
  });

  it("does NOT fabricate 100% from all-scratch (0 wins, 0 losses) buckets", () => {
    // A bucket can have trades that are all scratches (pnl === 0): they count
    // as neither win nor loss, so wins+losses is 0 → null, not 100%.
    expect(foWinRate(0, 0)).toBeNull();
  });

  it("returns a 0..1 fraction rounded to 4dp for decided trades", () => {
    expect(foWinRate(1, 1)).toBe(0.5);
    expect(foWinRate(1, 0)).toBe(1);
    expect(foWinRate(0, 1)).toBe(0);
    expect(foWinRate(1, 2)).toBe(0.3333);
    expect(foWinRate(2, 1)).toBe(0.6667);
  });
});
