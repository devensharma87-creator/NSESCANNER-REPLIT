/**
 * Unit tests for fnoPaperRiskGuards.ts — pure module.
 * No DB, no network, no side effects.
 */

import { describe, it, expect } from "vitest";
import {
  computeDteCalendarDays,
  isInBadTimeWindowIST,
  evaluateFnoPaperRiskGuards,
  FNO_GUARD_CONFIG,
  type FnoPaperRiskGuardConfig,
  type FnoPaperRiskGuardInput,
  type RecentStoppedTrade,
} from "./fnoPaperRiskGuards";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const PAPER_BLOCK_CONFIG: FnoPaperRiskGuardConfig = {
  mode: "paper_block",
  disableSensexPaperAutoOpen: true,
  lowPremiumGateEnabled: true,
  minEntryPremium: { NIFTY: 250, BANKNIFTY: 500, SENSEX: 250 },
  thetaRisk: { enabled: true, maxDteCalendarDays: 5, onlyWhenPremiumBelowThreshold: true },
  sameStrikeStopCooldown: { enabled: true, minutes: 90 },
  badTimeWindowShadowOnly: { enabled: true, windowsIST: [{ from: "10:00", to: "11:00" }] },
};

const SHADOW_CONFIG: FnoPaperRiskGuardConfig = {
  ...PAPER_BLOCK_CONFIG,
  mode: "shadow",
};

function makeInput(overrides: Partial<FnoPaperRiskGuardInput> = {}): FnoPaperRiskGuardInput {
  return {
    underlying: "BANKNIFTY",
    direction: "BULLISH",
    optionType: "CALL",
    strike: 57000,
    entryPremium: 850,
    entryTime: "2026-06-10T04:30:00.000Z", // ~10:00 IST
    expiry: "2026-06-26",
    ...overrides,
  };
}

function makeStop(overrides: Partial<RecentStoppedTrade> = {}): RecentStoppedTrade {
  return {
    underlying: "NIFTY",
    direction: "BULLISH",
    optionType: "CALL",
    strike: 24050,
    exitTime: "2026-06-17T07:30:00.000Z",
    exitReason: "STOP",
    ...overrides,
  };
}

const NO_STOPS: RecentStoppedTrade[] = [];

// ---------------------------------------------------------------------------
// Tests 1–2: DTE calculation
// ---------------------------------------------------------------------------

describe("computeDteCalendarDays", () => {
  it("test 1: computes DTE correctly for known near-expiry disaster trade", () => {
    // BNF May-26 entry: 07:30 UTC = 13:00 IST, expiry May-28 (2 days away in IST)
    const dte = computeDteCalendarDays("2026-05-26T07:30:00.000Z", "2026-05-28");
    expect(dte).toBe(2);
  });

  it("test 2: computes DTE for standard far-expiry trade", () => {
    // Entry Jun-10, expiry Jun-26 → 16 calendar days
    const dte = computeDteCalendarDays("2026-06-10T04:00:00.000Z", "2026-06-26");
    expect(dte).toBe(16);
  });

  it("returns null for missing expiry", () => {
    const dte = computeDteCalendarDays("2026-06-10T04:00:00.000Z", "");
    expect(dte).toBeNull();
  });

  it("returns null for invalid entry time", () => {
    const dte = computeDteCalendarDays("not-a-date", "2026-06-26");
    expect(dte).toBeNull();
  });

  it("returns 0 for same-day expiry", () => {
    const dte = computeDteCalendarDays("2026-06-26T04:00:00.000Z", "2026-06-26");
    expect(dte).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests 3–4: Bad time window
// ---------------------------------------------------------------------------

describe("isInBadTimeWindowIST", () => {
  it("test 3: detects entry inside 10:00–11:00 IST window", () => {
    // 10:30 IST = 05:00 UTC
    const inWindow = isInBadTimeWindowIST("2026-06-10T05:00:00.000Z", [
      { from: "10:00", to: "11:00" },
    ]);
    expect(inWindow).toBe(true);
  });

  it("test 4: does not flag entry outside window (12:00 IST)", () => {
    // 12:00 IST = 06:30 UTC
    const inWindow = isInBadTimeWindowIST("2026-06-10T06:30:00.000Z", [
      { from: "10:00", to: "11:00" },
    ]);
    expect(inWindow).toBe(false);
  });

  it("returns false for empty windows array", () => {
    const inWindow = isInBadTimeWindowIST("2026-06-10T05:00:00.000Z", []);
    expect(inWindow).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests 5–6: Low premium gate
// ---------------------------------------------------------------------------

describe("evaluateFnoPaperRiskGuards — low premium", () => {
  it("test 5: blocks NIFTY entry below ₹250 threshold", () => {
    const input = makeInput({ underlying: "NIFTY", entryPremium: 163, expiry: "2026-06-26" });
    const dec = evaluateFnoPaperRiskGuards(input, NO_STOPS, PAPER_BLOCK_CONFIG);
    expect(dec.allowed).toBe(false);
    expect(dec.reasons).toContain("LOW_ENTRY_PREMIUM");
    expect(dec.severity).toBe("block");
  });

  it("test 6: allows NIFTY entry at or above ₹250 threshold", () => {
    const input = makeInput({ underlying: "NIFTY", entryPremium: 300, expiry: "2026-06-26" });
    // disable other guards to isolate
    const cfg: FnoPaperRiskGuardConfig = {
      ...PAPER_BLOCK_CONFIG,
      thetaRisk: { ...PAPER_BLOCK_CONFIG.thetaRisk, enabled: false },
      sameStrikeStopCooldown: { ...PAPER_BLOCK_CONFIG.sameStrikeStopCooldown, enabled: false },
      badTimeWindowShadowOnly: { ...PAPER_BLOCK_CONFIG.badTimeWindowShadowOnly, enabled: false },
      disableSensexPaperAutoOpen: false,
    };
    const dec = evaluateFnoPaperRiskGuards(input, NO_STOPS, cfg);
    expect(dec.reasons).not.toContain("LOW_ENTRY_PREMIUM");
  });

  it("blocks BANKNIFTY entry below ₹500 threshold", () => {
    const input = makeInput({ underlying: "BANKNIFTY", entryPremium: 141, expiry: "2026-05-28" });
    const dec = evaluateFnoPaperRiskGuards(input, NO_STOPS, PAPER_BLOCK_CONFIG);
    expect(dec.reasons).toContain("LOW_ENTRY_PREMIUM");
  });
});

// ---------------------------------------------------------------------------
// Tests 7–9: Theta risk gate
// ---------------------------------------------------------------------------

describe("evaluateFnoPaperRiskGuards — theta risk", () => {
  it("test 7: blocks near-expiry low-premium trade (BNF May-26 disaster fixture)", () => {
    // DTE=2, premium=₹141 < ₹500 BNF threshold
    const input = makeInput({
      underlying: "BANKNIFTY",
      entryPremium: 140.95,
      entryTime: "2026-05-26T07:30:00.000Z",
      expiry: "2026-05-28",
    });
    const cfg: FnoPaperRiskGuardConfig = {
      ...PAPER_BLOCK_CONFIG,
      lowPremiumGateEnabled: false, // isolate theta only
    };
    const dec = evaluateFnoPaperRiskGuards(input, NO_STOPS, cfg);
    expect(dec.reasons).toContain("NEAR_EXPIRY_THETA_RISK");
    expect(dec.allowed).toBe(false);
    expect(dec.metrics.dteCalendarDays).toBe(2);
  });

  it("test 8: does NOT block high-premium near-expiry BANKNIFTY (valid TARGET-like fixture)", () => {
    // DTE=3, premium=₹868 (above ₹500 BNF threshold) → theta guard should NOT fire
    const input = makeInput({
      underlying: "BANKNIFTY",
      entryPremium: 868,
      entryTime: "2026-06-11T04:00:00.000Z",
      expiry: "2026-06-14",
    });
    const cfg: FnoPaperRiskGuardConfig = {
      ...PAPER_BLOCK_CONFIG,
      lowPremiumGateEnabled: false,
      sameStrikeStopCooldown: { ...PAPER_BLOCK_CONFIG.sameStrikeStopCooldown, enabled: false },
      badTimeWindowShadowOnly: { ...PAPER_BLOCK_CONFIG.badTimeWindowShadowOnly, enabled: false },
      disableSensexPaperAutoOpen: false,
    };
    const dec = evaluateFnoPaperRiskGuards(input, NO_STOPS, cfg);
    expect(dec.reasons).not.toContain("NEAR_EXPIRY_THETA_RISK");
  });

  it("test 9: does NOT block high-DTE low-premium trade (theta guard only triggers ≤ 5 DTE)", () => {
    // DTE=20, premium=₹163 — DTE not violated so theta guard should NOT fire
    const input = makeInput({
      underlying: "NIFTY",
      entryPremium: 163,
      entryTime: "2026-06-10T04:00:00.000Z",
      expiry: "2026-06-30",
    });
    const cfg: FnoPaperRiskGuardConfig = {
      ...PAPER_BLOCK_CONFIG,
      lowPremiumGateEnabled: false, // isolate theta only
      sameStrikeStopCooldown: { ...PAPER_BLOCK_CONFIG.sameStrikeStopCooldown, enabled: false },
      badTimeWindowShadowOnly: { ...PAPER_BLOCK_CONFIG.badTimeWindowShadowOnly, enabled: false },
      disableSensexPaperAutoOpen: false,
    };
    const dec = evaluateFnoPaperRiskGuards(input, NO_STOPS, cfg);
    expect(dec.reasons).not.toContain("NEAR_EXPIRY_THETA_RISK");
  });
});

// ---------------------------------------------------------------------------
// Tests 10–13: Same-strike stop cooldown
// ---------------------------------------------------------------------------

describe("evaluateFnoPaperRiskGuards — same-strike cooldown", () => {
  it("test 10: blocks re-entry within 90 min of same-strike STOP (NIFTY Jun-17 fixture)", () => {
    // First entry stopped at 13:00 IST = 07:30 UTC
    // Second re-entry at 13:30 IST = 08:00 UTC = 30 min later
    const stop: RecentStoppedTrade = {
      underlying: "NIFTY",
      direction: "BULLISH",
      optionType: "CALL",
      strike: 24050,
      exitTime: "2026-06-17T07:30:00.000Z",
      exitReason: "STOP",
    };
    const input = makeInput({
      underlying: "NIFTY",
      direction: "BULLISH",
      optionType: "CALL",
      strike: 24050,
      entryPremium: 148.65,
      entryTime: "2026-06-17T08:00:00.000Z",
      expiry: "2026-06-26",
    });
    const cfg: FnoPaperRiskGuardConfig = {
      ...PAPER_BLOCK_CONFIG,
      lowPremiumGateEnabled: false,
      thetaRisk: { ...PAPER_BLOCK_CONFIG.thetaRisk, enabled: false },
      badTimeWindowShadowOnly: { ...PAPER_BLOCK_CONFIG.badTimeWindowShadowOnly, enabled: false },
      disableSensexPaperAutoOpen: false,
    };
    const dec = evaluateFnoPaperRiskGuards(input, [stop], cfg);
    expect(dec.reasons).toContain("SAME_STRIKE_DIRECTION_STOP_COOLDOWN");
    expect(dec.allowed).toBe(false);
    expect(dec.metrics.minutesSinceSameStrikeStop).toBe(30);
  });

  it("test 11: does NOT block different strike re-entry", () => {
    const stop = makeStop({ underlying: "NIFTY", strike: 24050, direction: "BULLISH" });
    // Different strike: 24100
    const input = makeInput({
      underlying: "NIFTY",
      direction: "BULLISH",
      optionType: "CALL",
      strike: 24100,
      entryTime: "2026-06-17T08:00:00.000Z",
      expiry: "2026-06-26",
    });
    const cfg: FnoPaperRiskGuardConfig = {
      ...PAPER_BLOCK_CONFIG,
      lowPremiumGateEnabled: false,
      thetaRisk: { ...PAPER_BLOCK_CONFIG.thetaRisk, enabled: false },
      badTimeWindowShadowOnly: { ...PAPER_BLOCK_CONFIG.badTimeWindowShadowOnly, enabled: false },
      disableSensexPaperAutoOpen: false,
    };
    const dec = evaluateFnoPaperRiskGuards(input, [stop], cfg);
    expect(dec.reasons).not.toContain("SAME_STRIKE_DIRECTION_STOP_COOLDOWN");
  });

  it("test 12: does NOT block opposite direction re-entry", () => {
    const stop = makeStop({ underlying: "NIFTY", direction: "BULLISH", strike: 24050, optionType: "CALL" });
    const input = makeInput({
      underlying: "NIFTY",
      direction: "BEARISH",
      optionType: "PUT",
      strike: 24050,
      entryTime: "2026-06-17T08:00:00.000Z",
      expiry: "2026-06-26",
    });
    const cfg: FnoPaperRiskGuardConfig = {
      ...PAPER_BLOCK_CONFIG,
      lowPremiumGateEnabled: false,
      thetaRisk: { ...PAPER_BLOCK_CONFIG.thetaRisk, enabled: false },
      badTimeWindowShadowOnly: { ...PAPER_BLOCK_CONFIG.badTimeWindowShadowOnly, enabled: false },
      disableSensexPaperAutoOpen: false,
    };
    const dec = evaluateFnoPaperRiskGuards(input, [stop], cfg);
    expect(dec.reasons).not.toContain("SAME_STRIKE_DIRECTION_STOP_COOLDOWN");
  });

  it("test 13: cooldown expires after 90 minutes", () => {
    // Stop at T+0, entry at T+91 min (cooldown window is 90 min)
    const stopTime = new Date("2026-06-17T07:30:00.000Z");
    const entryTime = new Date(stopTime.getTime() + 91 * 60 * 1000);
    const stop: RecentStoppedTrade = {
      underlying: "NIFTY",
      direction: "BULLISH",
      optionType: "CALL",
      strike: 24050,
      exitTime: stopTime.toISOString(),
      exitReason: "STOP",
    };
    const input = makeInput({
      underlying: "NIFTY",
      direction: "BULLISH",
      optionType: "CALL",
      strike: 24050,
      entryTime: entryTime.toISOString(),
      expiry: "2026-06-26",
    });
    const cfg: FnoPaperRiskGuardConfig = {
      ...PAPER_BLOCK_CONFIG,
      lowPremiumGateEnabled: false,
      thetaRisk: { ...PAPER_BLOCK_CONFIG.thetaRisk, enabled: false },
      badTimeWindowShadowOnly: { ...PAPER_BLOCK_CONFIG.badTimeWindowShadowOnly, enabled: false },
      disableSensexPaperAutoOpen: false,
    };
    const dec = evaluateFnoPaperRiskGuards(input, [stop], cfg);
    expect(dec.reasons).not.toContain("SAME_STRIKE_DIRECTION_STOP_COOLDOWN");
  });
});

// ---------------------------------------------------------------------------
// Tests 14–15: SENSEX disable
// ---------------------------------------------------------------------------

describe("evaluateFnoPaperRiskGuards — SENSEX disable", () => {
  it("test 14: SENSEX disable blocks only SENSEX in paper_block mode", () => {
    const sensexInput = makeInput({ underlying: "SENSEX", entryPremium: 400, expiry: "2026-06-26" });
    const cfg: FnoPaperRiskGuardConfig = {
      ...PAPER_BLOCK_CONFIG,
      lowPremiumGateEnabled: false,
      thetaRisk: { ...PAPER_BLOCK_CONFIG.thetaRisk, enabled: false },
      sameStrikeStopCooldown: { ...PAPER_BLOCK_CONFIG.sameStrikeStopCooldown, enabled: false },
      badTimeWindowShadowOnly: { ...PAPER_BLOCK_CONFIG.badTimeWindowShadowOnly, enabled: false },
      disableSensexPaperAutoOpen: true,
    };
    const dec = evaluateFnoPaperRiskGuards(sensexInput, NO_STOPS, cfg);
    expect(dec.reasons).toContain("SENSEX_DISABLED_BY_REPLAY_DIAGNOSTICS");
    expect(dec.allowed).toBe(false);
  });

  it("SENSEX disable does NOT block BANKNIFTY", () => {
    const bnfInput = makeInput({ underlying: "BANKNIFTY", entryPremium: 850, expiry: "2026-06-26" });
    const cfg: FnoPaperRiskGuardConfig = {
      ...PAPER_BLOCK_CONFIG,
      lowPremiumGateEnabled: false,
      thetaRisk: { ...PAPER_BLOCK_CONFIG.thetaRisk, enabled: false },
      sameStrikeStopCooldown: { ...PAPER_BLOCK_CONFIG.sameStrikeStopCooldown, enabled: false },
      badTimeWindowShadowOnly: { ...PAPER_BLOCK_CONFIG.badTimeWindowShadowOnly, enabled: false },
      disableSensexPaperAutoOpen: true,
    };
    const dec = evaluateFnoPaperRiskGuards(bnfInput, NO_STOPS, cfg);
    expect(dec.reasons).not.toContain("SENSEX_DISABLED_BY_REPLAY_DIAGNOSTICS");
  });
});

// ---------------------------------------------------------------------------
// Tests 15–16: Shadow mode
// ---------------------------------------------------------------------------

describe("evaluateFnoPaperRiskGuards — shadow mode", () => {
  it("test 15: shadow mode never blocks even when all guards fire", () => {
    // SENSEX, low premium, near-expiry, in bad time window — should still be allowed
    const input = makeInput({
      underlying: "SENSEX",
      entryPremium: 50,
      entryTime: "2026-06-10T05:00:00.000Z", // 10:30 IST
      expiry: "2026-06-11",
    });
    const stop = makeStop({
      underlying: "SENSEX",
      direction: "BULLISH",
      optionType: "CALL",
      strike: 57000,
      exitTime: "2026-06-10T04:30:00.000Z",
    });
    const dec = evaluateFnoPaperRiskGuards(input, [stop], SHADOW_CONFIG);
    expect(dec.allowed).toBe(true);
    // But reasons should be populated
    expect(dec.reasons.length).toBeGreaterThan(0);
  });

  it("test 16: paper_block mode blocks when hard reasons fire", () => {
    const input = makeInput({
      underlying: "NIFTY",
      entryPremium: 100,
      entryTime: "2026-06-10T05:00:00.000Z",
      expiry: "2026-06-26",
    });
    const dec = evaluateFnoPaperRiskGuards(input, NO_STOPS, PAPER_BLOCK_CONFIG);
    expect(dec.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests 17–18: Multiple reasons and edge cases
// ---------------------------------------------------------------------------

describe("evaluateFnoPaperRiskGuards — multiple reasons and edge cases", () => {
  it("test 17: multiple reasons are returned correctly", () => {
    // SENSEX, low premium, near-expiry in paper_block mode
    const input = makeInput({
      underlying: "SENSEX",
      entryPremium: 133,
      entryTime: "2026-05-27T07:30:00.000Z",
      expiry: "2026-05-28",
    });
    const dec = evaluateFnoPaperRiskGuards(input, NO_STOPS, PAPER_BLOCK_CONFIG);
    expect(dec.reasons).toContain("SENSEX_DISABLED_BY_REPLAY_DIAGNOSTICS");
    expect(dec.reasons).toContain("LOW_ENTRY_PREMIUM");
    expect(dec.reasons).toContain("NEAR_EXPIRY_THETA_RISK");
    expect(dec.reasons.length).toBeGreaterThanOrEqual(3);
    expect(dec.allowed).toBe(false);
    expect(dec.severity).toBe("block");
  });

  it("test 18: null premium fails safely (no division by zero, no crash)", () => {
    const input = makeInput({ entryPremium: null, expiry: "2026-06-26" });
    const dec = evaluateFnoPaperRiskGuards(input, NO_STOPS, PAPER_BLOCK_CONFIG);
    expect(dec).toBeDefined();
    expect(typeof dec.allowed).toBe("boolean");
    expect(dec.metrics.entryPremium).toBeNull();
    // null premium triggers LOW_ENTRY_PREMIUM for underlying with threshold
    // (BANKNIFTY threshold=500, prem=null → treated as below threshold)
    // Actually: null premium → the condition `input.entryPremium !== null` is false → G2 doesn't fire
    expect(dec.reasons).not.toContain("LOW_ENTRY_PREMIUM");
  });

  it("null expiry fails safely — no DTE-based guards fire", () => {
    const input = makeInput({ expiry: null, entryPremium: 850 });
    const dec = evaluateFnoPaperRiskGuards(input, NO_STOPS, PAPER_BLOCK_CONFIG);
    expect(dec.metrics.dteCalendarDays).toBeNull();
    expect(dec.reasons).not.toContain("NEAR_EXPIRY_THETA_RISK");
  });

  it("default FNO_GUARD_CONFIG is paper_block mode (activated 2026-06-29 after simulation acceptance)", () => {
    expect(FNO_GUARD_CONFIG.mode).toBe("paper_block");
    expect(FNO_GUARD_CONFIG.disableSensexPaperAutoOpen).toBe(true);
  });

  it("default config has correct thresholds", () => {
    expect(FNO_GUARD_CONFIG.minEntryPremium.NIFTY).toBe(250);
    expect(FNO_GUARD_CONFIG.minEntryPremium.BANKNIFTY).toBe(500);
    expect(FNO_GUARD_CONFIG.minEntryPremium.SENSEX).toBe(250);
    expect(FNO_GUARD_CONFIG.thetaRisk.maxDteCalendarDays).toBe(5);
    expect(FNO_GUARD_CONFIG.sameStrikeStopCooldown.minutes).toBe(90);
  });
});
