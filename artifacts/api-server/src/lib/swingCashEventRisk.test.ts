/**
 * Unit tests for swingCashEventRisk.ts (Part H) — pure module.
 */

import { describe, it, expect } from "vitest";
import { evaluateSwingCashEventRisk } from "./swingCashEventRisk";
import { DEFAULT_SWING_CASH_CONFIG } from "./swingCashRiskGuards";
import type { SwingCashEventRiskInput } from "./swingCashTypes";

const CFG = DEFAULT_SWING_CASH_CONFIG.eventRisk;

function make(overrides: Partial<SwingCashEventRiskInput> = {}): SwingCashEventRiskInput {
  return {
    daysToResult: 30,
    isResultDay: false,
    corporateActionRisk: false,
    eventDataAvailable: true,
    resultScheduleKnown: true,
    newsRiskAvailable: true,
    ...overrides,
  };
}

describe("evaluateSwingCashEventRisk", () => {
  it("clears when no event risk in window", () => {
    const r = evaluateSwingCashEventRisk(make(), CFG);
    expect(r.classification).toBe("EVENT_CLEAR");
    expect(r.clear).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it("blocks on result day", () => {
    const r = evaluateSwingCashEventRisk(make({ isResultDay: true }), CFG);
    expect(r.classification).toBe("RESULT_DAY");
    expect(r.blocked).toBe(true);
  });

  it("blocks when result is within the window", () => {
    const r = evaluateSwingCashEventRisk(make({ daysToResult: 2 }), CFG);
    expect(r.classification).toBe("RESULT_WITHIN_3_DAYS");
    expect(r.blocked).toBe(true);
  });

  it("blocks on corporate-action risk", () => {
    const r = evaluateSwingCashEventRisk(make({ corporateActionRisk: true }), CFG);
    expect(r.classification).toBe("CORPORATE_ACTION_RISK");
    expect(r.blocked).toBe(true);
  });

  it("requires review (never assumes clear) when event data unavailable", () => {
    const r = evaluateSwingCashEventRisk(make({ eventDataAvailable: false }), CFG);
    expect(r.classification).toBe("EVENT_DATA_UNAVAILABLE_REVIEW_REQUIRED");
    expect(r.reviewRequired).toBe(true);
    expect(r.clear).toBe(false);
  });

  it("flags review when news-risk feed unavailable", () => {
    const r = evaluateSwingCashEventRisk(make({ newsRiskAvailable: false }), CFG);
    expect(r.classification).toBe("NEWS_RISK_UNAVAILABLE");
    expect(r.reviewRequired).toBe(true);
  });

  it("never assumes clear when corporate-action status is unavailable", () => {
    const r = evaluateSwingCashEventRisk(make({ corporateActionRisk: null }), CFG);
    expect(r.classification).toBe("CORPORATE_ACTION_UNAVAILABLE_REVIEW_REQUIRED");
    expect(r.reviewRequired).toBe(true);
    expect(r.clear).toBe(false);
  });

  it("requires review when the result schedule is not explicitly confirmed", () => {
    const r = evaluateSwingCashEventRisk(make({ resultScheduleKnown: false }), CFG);
    expect(r.classification).toBe("RESULT_DATE_UNKNOWN_REVIEW_REQUIRED");
    expect(r.reviewRequired).toBe(true);
    expect(r.clear).toBe(false);
  });

  it("never reads a null daysToResult as 'no result' when schedule is unconfirmed", () => {
    const r = evaluateSwingCashEventRisk(
      make({ daysToResult: null, resultScheduleKnown: false }),
      CFG,
    );
    expect(r.classification).toBe("RESULT_DATE_UNKNOWN_REVIEW_REQUIRED");
    expect(r.clear).toBe(false);
  });

  it("never reads a non-finite (NaN) daysToResult as clear, even with schedule known", () => {
    const r = evaluateSwingCashEventRisk(
      make({ daysToResult: NaN, resultScheduleKnown: true }),
      CFG,
    );
    expect(r.classification).toBe("RESULT_DATE_UNKNOWN_REVIEW_REQUIRED");
    expect(r.clear).toBe(false);
    expect(r.reviewRequired).toBe(true);
  });
});
