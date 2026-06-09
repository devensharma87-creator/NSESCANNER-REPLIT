/**
 * Directional-veto pure-function tests (2026-06-09 hygiene fix).
 *
 * Locks in:
 *   - RECOVERY_MODE_VETO trips on a genuine multi-factor V-recovery, but
 *     NOT on a real trend-down day (so legitimate PUTs still emit).
 *   - CHASE_RISK_VETO trips on a late, extended, overbought vertical run,
 *     and UN-trips after a pullback/retest (re-tradeable, no extra state).
 *   - deriveTradeClass / isAutoTradeableSizingTier mapping (incl. flag-off
 *     rollback behaviour).
 */
import { describe, expect, it } from "vitest";

import {
  evaluateDirectionalVetoes,
  deriveTradeClass,
  isAutoTradeableSizingTier,
  type VetoInputs,
} from "./optionSignalVetoes";

describe("evaluateDirectionalVetoes — RECOVERY_MODE_VETO (blocks fresh PUT)", () => {
  it("trips on a genuine V-recovery off the intraday low", () => {
    const v: VetoInputs = {
      spot: 110,
      vwap: 104,
      ema9: 105,
      atr15: 10,
      rsi14: 55,
      // day low 96; last-3 min (99) > prior-3 min (96) → higher lows
      lows: [100, 98, 96, 99, 101, 103],
      highs: [102, 100, 99, 103, 105, 111],
      closes: [101, 99, 97, 100, 104, 110],
      // rsiNow 55 > rsiPast@offset4 (38) → rising; rsi14 55 ≥ 42 → reclaim
      rsiSeries: [35, 38, 40, 45, 50, 55],
    };
    const r = evaluateDirectionalVetoes(v);
    expect(r.recovery).toBe(true);
    expect(r.recoveryReason).toBeTruthy();
    // chase must not also fire on this modest extension (0.6×ATR)
    expect(r.chase).toBe(false);
  });

  it("does NOT trip on a real trend-down day (lower-lows, weak RSI)", () => {
    const v: VetoInputs = {
      spot: 100,
      vwap: 104,
      ema9: 106,
      atr15: 10,
      rsi14: 30,
      // continuous lower lows
      lows: [110, 108, 106, 104, 102, 100],
      highs: [112, 110, 108, 106, 104, 102],
      closes: [111, 109, 107, 105, 103, 100],
      rsiSeries: [45, 42, 40, 36, 33, 30],
    };
    const r = evaluateDirectionalVetoes(v);
    expect(r.recovery).toBe(false);
  });

  it("does NOT trip when the bounce off the low is too shallow", () => {
    const v: VetoInputs = {
      spot: 100, // only 0.4×ATR above day low 96
      vwap: 99,
      ema9: 99,
      atr15: 10,
      rsi14: 55,
      lows: [100, 98, 96, 99, 101, 99],
      highs: [102, 100, 99, 101, 102, 101],
      closes: [101, 99, 97, 100, 101, 100],
      rsiSeries: [35, 38, 40, 45, 50, 55],
    };
    const r = evaluateDirectionalVetoes(v);
    expect(r.recovery).toBe(false);
  });
});

describe("evaluateDirectionalVetoes — CHASE_RISK_VETO (blocks fresh CALL)", () => {
  const chaseTripped: VetoInputs = {
    spot: 125, // 2.5×ATR above VWAP 100
    vwap: 100,
    ema9: 118,
    atr15: 10,
    rsi14: 72, // overbought
    lows: [101, 102], // <6 → recovery guard skipped
    highs: [120, 125],
    closes: [100, 105, 110, 118, 125], // vertical = (125-100)/10 = 2.5×ATR
    rsiSeries: [55, 60, 65, 70, 72],
  };

  it("trips on a late, extended, overbought vertical run", () => {
    const r = evaluateDirectionalVetoes(chaseTripped);
    expect(r.chase).toBe(true);
    expect(r.chaseReason).toBeTruthy();
    expect(r.recovery).toBe(false);
  });

  it("UN-trips after a pullback/retest (re-tradeable, no extra state)", () => {
    const pulledBack: VetoInputs = {
      ...chaseTripped,
      spot: 108, // extension now 0.8×ATR above VWAP
      rsi14: 60, // no longer overbought
      closes: [100, 105, 110, 118, 108],
    };
    const r = evaluateDirectionalVetoes(pulledBack);
    expect(r.chase).toBe(false);
  });

  it("does NOT trip when extended but not overbought", () => {
    const r = evaluateDirectionalVetoes({ ...chaseTripped, rsi14: 64 });
    expect(r.chase).toBe(false);
  });
});

describe("veto base guards", () => {
  it("returns no vetoes when ATR is non-positive", () => {
    const r = evaluateDirectionalVetoes({
      spot: 110,
      vwap: 100,
      ema9: 105,
      atr15: 0,
      rsi14: 75,
      lows: [100, 98, 96, 99, 101, 103],
      highs: [102, 100, 99, 103, 105, 111],
      closes: [100, 105, 110, 118, 125],
      rsiSeries: [35, 38, 40, 45, 50, 55],
    });
    expect(r.recovery).toBe(false);
    expect(r.chase).toBe(false);
  });
});

describe("deriveTradeClass / isAutoTradeableSizingTier", () => {
  it("under hygiene v2 only HIGH_CONVICTION is TRADEABLE", () => {
    expect(deriveTradeClass("HIGH_CONVICTION", true)).toBe("TRADEABLE");
    expect(deriveTradeClass("BASELINE", true)).toBe("INFO_ONLY");
  });

  it("flag OFF reports TRADEABLE for both tiers (legacy lane restored)", () => {
    expect(deriveTradeClass("HIGH_CONVICTION", false)).toBe("TRADEABLE");
    expect(deriveTradeClass("BASELINE", false)).toBe("TRADEABLE");
  });

  it("a HIGH_CONVICTION signal demoted to BASELINE re-derives to INFO_ONLY", () => {
    // mirrors the post-OI tier mutation in applyOiConfirmation
    let tradeClass = deriveTradeClass("HIGH_CONVICTION", true);
    expect(tradeClass).toBe("TRADEABLE");
    const demotedTier = "BASELINE" as const;
    tradeClass = deriveTradeClass(demotedTier, true);
    expect(tradeClass).toBe("INFO_ONLY");
  });

  it("under hygiene v2 only STANDARD sizing tier is auto-tradeable", () => {
    expect(isAutoTradeableSizingTier("STANDARD", true)).toBe(true);
    expect(isAutoTradeableSizingTier("BASELINE", true)).toBe(false);
    expect(isAutoTradeableSizingTier("MICRO", true)).toBe(false);
  });

  it("flag OFF restores the legacy lane (all tiers tradeable)", () => {
    expect(isAutoTradeableSizingTier("BASELINE", false)).toBe(true);
    expect(isAutoTradeableSizingTier("MICRO", false)).toBe(true);
    expect(isAutoTradeableSizingTier("STANDARD", false)).toBe(true);
  });
});
