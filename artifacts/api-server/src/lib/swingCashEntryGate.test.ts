/**
 * Unit tests for swingCashEntryGate.ts (Part C) — pure module.
 */

import { describe, it, expect } from "vitest";
import { evaluateSwingCashEntry } from "./swingCashEntryGate";
import { DEFAULT_SWING_CASH_CONFIG } from "./swingCashRiskGuards";
import type { SwingCashEntryInput } from "./swingCashTypes";

const CFG = DEFAULT_SWING_CASH_CONFIG.entry;

function make(overrides: Partial<SwingCashEntryInput> = {}): SwingCashEntryInput {
  return {
    entry: 100,
    stop: 95,
    target1: 115,
    ltp: 101,
    atr: 4,
    signalAgeDays: 0,
    triggered: true,
    ...overrides,
  };
}

describe("evaluateSwingCashEntry", () => {
  it("accepts a fresh, triggered, un-chased entry as VALID_NOW", () => {
    const r = evaluateSwingCashEntry(make(), CFG);
    expect(r.classification).toBe("ENTRY_VALID_NOW");
    expect(r.validForStaging).toBe(true);
  });

  it("flags a chased entry (beyond ATR buffer)", () => {
    const r = evaluateSwingCashEntry(make({ ltp: 103 }), CFG);
    expect(r.classification).toBe("ENTRY_ALREADY_CHASED");
    expect(r.validForStaging).toBe(false);
  });

  it("flags deteriorated remaining R:R", () => {
    const r = evaluateSwingCashEntry(make({ target1: 108, ltp: 102, atr: 20 }), CFG);
    expect(r.classification).toBe("ENTRY_RR_TOO_LOW");
  });

  it("flags LTP too close to target", () => {
    const r = evaluateSwingCashEntry(make({ ltp: 114.5 }), CFG);
    expect(r.classification).toBe("ENTRY_TOO_CLOSE_TO_TARGET");
  });

  it("flags LTP too close to stop", () => {
    const r = evaluateSwingCashEntry(make({ ltp: 95.5 }), CFG);
    expect(r.classification).toBe("ENTRY_TOO_CLOSE_TO_STOP");
  });

  it("flags a stale signal by age", () => {
    const r = evaluateSwingCashEntry(make({ signalAgeDays: 5 }), CFG);
    expect(r.classification).toBe("ENTRY_STALE");
  });

  it("returns WAITING_FOR_TRIGGER when valid but not triggered", () => {
    const r = evaluateSwingCashEntry(make({ triggered: false }), CFG);
    expect(r.classification).toBe("ENTRY_WAITING_FOR_TRIGGER");
    expect(r.watchOnly).toBe(true);
  });

  it("rejects numerically invalid plans", () => {
    const r = evaluateSwingCashEntry(make({ stop: 105 }), CFG);
    expect(r.classification).toBe("ENTRY_INVALID_DATA");
  });

  it("requires review when freshness cannot be verified (no age, no validity window)", () => {
    const r = evaluateSwingCashEntry(
      make({ signalAgeDays: null, validityExpiryMs: null, nowMs: null }),
      CFG,
    );
    expect(r.classification).toBe("ENTRY_REVIEW_REQUIRED");
    expect(r.validForStaging).toBe(false);
  });

  it("treats a non-finite (NaN) signal age as unverifiable freshness → review", () => {
    const r = evaluateSwingCashEntry(make({ signalAgeDays: NaN }), CFG);
    expect(r.classification).toBe("ENTRY_REVIEW_REQUIRED");
    expect(r.validForStaging).toBe(false);
  });

  it("never treats an OMITTED trigger state as triggered → review", () => {
    const r = evaluateSwingCashEntry(make({ triggered: undefined }), CFG);
    expect(r.classification).toBe("ENTRY_REVIEW_REQUIRED");
    expect(r.validForStaging).toBe(false);
  });
});
