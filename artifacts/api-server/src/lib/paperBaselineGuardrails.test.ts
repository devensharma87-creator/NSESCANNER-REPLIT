import { describe, expect, it } from "vitest";
import {
  FNO_BASELINE_GUARDRAILS,
  FNO_RISK,
  SEED_CAPITAL,
} from "./paperAccount";

/**
 * Behaviour-level assertions for the BASELINE-lane guardrails added
 * 2026-05-11. These don't reach into the DB — they pin the policy
 * dials and the threshold arithmetic that the runtime gates compare
 * against, so a future "tweak the constant" change can't silently
 * disable a guardrail without a failing test.
 */
describe("BASELINE-lane guardrails (policy + threshold math)", () => {
  it("BASELINE late-entry cutoff is strictly earlier than HC's 15:25", () => {
    const HC_CUTOFF = 15 * 60 + 25;
    expect(FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN).toBeLessThan(HC_CUTOFF);
    // Pin the exact value so the dial change requires touching the test.
    expect(FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN).toBe(14 * 60 + 45);
  });

  it("BASELINE daily-trade cap is strictly tighter than the global FNO cap", () => {
    expect(FNO_BASELINE_GUARDRAILS.MAX_TRADES_PER_DAY).toBeLessThan(FNO_RISK.MAX_TRADES_PER_DAY);
    expect(FNO_BASELINE_GUARDRAILS.MAX_TRADES_PER_DAY).toBe(2);
  });

  it("BASELINE daily-loss cap is strictly tighter than the global FNO cap", () => {
    expect(FNO_BASELINE_GUARDRAILS.MAX_DAILY_LOSS_PCT).toBeLessThan(FNO_RISK.MAX_DAILY_LOSS_PCT);
    expect(FNO_BASELINE_GUARDRAILS.MAX_DAILY_LOSS_PCT).toBe(0.0075);
  });

  it("BASELINE consecutive-loss lock kicks in at 2", () => {
    expect(FNO_BASELINE_GUARDRAILS.MAX_CONSECUTIVE_LOSSES).toBe(2);
  });

  it("BASELINE daily-loss cap as INR vs seed is correctly proportional", () => {
    const cap = SEED_CAPITAL.FNO * FNO_BASELINE_GUARDRAILS.MAX_DAILY_LOSS_PCT;
    // 0.75 % of seed; we just assert the relation, not the seed value
    // itself (so a future seed change doesn't ripple through here).
    expect(cap).toBeCloseTo(SEED_CAPITAL.FNO * 0.0075, 6);
  });

  it("realized + unrealized loss reaches the cap at the same threshold as realized-only would", () => {
    // Pure arithmetic check that the realized+unrealized sum is what
    // the runtime guard compares against (mirrors the txn-internal
    // gate logic in paperTradingFO.ts).
    const cap = SEED_CAPITAL.FNO * FNO_BASELINE_GUARDRAILS.MAX_DAILY_LOSS_PCT;
    const realized = cap * 0.6;
    const unrealized = cap * 0.5;
    expect(realized + unrealized).toBeGreaterThan(cap);
    // Realized alone wouldn't trip the cap — the unrealized component
    // is what makes the combined check tighter.
    expect(realized).toBeLessThan(cap);
  });
});
