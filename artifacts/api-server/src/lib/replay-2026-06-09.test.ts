/**
 * Structural replay of the 2026-06-09 failure modes.
 *
 * This is NOT a raw-tick replay (we have no persisted tick stream). It is a
 * structural replay: synthetic 15-min bar sequences that reproduce the two
 * observed failures and assert the new directional vetoes neutralise them.
 *
 *   Morning  — a V-shaped recovery off the session low. The engine wrongly
 *              emitted fresh PUTs; RECOVERY_MODE_VETO must demote them.
 *   Midday   — after recovering, the tape went vertical and overbought and
 *              the engine chased late CALLs; CHASE_RISK_VETO must demote
 *              them, then RELEASE the CALL after a pullback/retest.
 *
 * If FNO_SIGNAL_HYGIENE_V2 is rolled back the wiring in optionSignals.ts
 * skips these checks entirely; this test exercises the pure decision core.
 */
import { describe, expect, it } from "vitest";

import { evaluateDirectionalVetoes, type VetoInputs } from "./optionSignalVetoes";

describe("2026-06-09 structural replay", () => {
  it("MORNING recovery: a fresh PUT is demoted (recovery veto trips)", () => {
    // Spot carved a session low then bounced hard with rising RSI and an
    // EMA9/VWAP reclaim — the exact tape that mis-fired PUTs.
    const morning: VetoInputs = {
      spot: 22850,
      vwap: 22790,
      ema9: 22810,
      atr15: 60,
      rsi14: 56,
      // session low 22600; last-3 min (22720) > prior-3 min (22600)
      lows: [22700, 22650, 22600, 22720, 22780, 22820],
      highs: [22760, 22710, 22680, 22790, 22850, 22880],
      closes: [22740, 22680, 22620, 22760, 22810, 22850],
      rsiSeries: [34, 38, 41, 47, 52, 56],
    };
    const r = evaluateDirectionalVetoes(morning);
    expect(r.recovery).toBe(true);
    // The morning recovery is modest in extension, so it must NOT also be a
    // chase (that would be self-contradictory).
    expect(r.chase).toBe(false);
  });

  it("a genuine down-trend morning still allows the PUT (no false positive)", () => {
    const trendDown: VetoInputs = {
      spot: 22500,
      vwap: 22640,
      ema9: 22700,
      atr15: 60,
      rsi14: 28,
      lows: [22900, 22820, 22740, 22660, 22580, 22500],
      highs: [22960, 22880, 22800, 22720, 22640, 22560],
      closes: [22920, 22840, 22760, 22680, 22600, 22500],
      rsiSeries: [44, 40, 37, 33, 30, 28],
    };
    expect(evaluateDirectionalVetoes(trendDown).recovery).toBe(false);
  });

  it("MIDDAY extension: a late CALL is demoted (chase veto trips)", () => {
    const midday: VetoInputs = {
      spot: 23200, // ~2.5×ATR above VWAP 23050
      vwap: 23050,
      ema9: 23080,
      atr15: 60,
      rsi14: 74, // overbought
      lows: [23000, 23010], // short → recovery guard skipped
      highs: [23050, 23200],
      // vertical run: (23200 - 23050)/60 ... use closes for the run test
      closes: [23000, 23060, 23110, 23160, 23200],
      rsiSeries: [62, 66, 70, 72, 74],
    };
    const r = evaluateDirectionalVetoes(midday);
    expect(r.chase).toBe(true);
  });

  it("AFTER a pullback the same CALL is released (re-tradeable)", () => {
    const afterPullback: VetoInputs = {
      spot: 23080, // extension cooled to ~0.5×ATR
      vwap: 23050,
      ema9: 23080,
      atr15: 60,
      rsi14: 58,
      lows: [23000, 23010],
      highs: [23050, 23200],
      closes: [23000, 23060, 23110, 23160, 23080],
      rsiSeries: [62, 66, 70, 72, 58],
    };
    expect(evaluateDirectionalVetoes(afterPullback).chase).toBe(false);
  });
});
