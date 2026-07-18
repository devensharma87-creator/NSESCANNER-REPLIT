/**
 * F-27 — Detector cooldown tests.
 *
 * Tests cover:
 *  1. Cooldown map is empty after reset.
 *  2. A freshly-recorded detector key IS on cooldown.
 *  3. A key recorded > DETECTOR_COOLDOWN_MS ago is NOT on cooldown.
 *  4. Different (setupKey|index|direction) tuples do not share cooldown state.
 *  5. After _resetDetectorCooldownForTest(), all previous keys are gone.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  _getDetectorCooldownMs,
  _resetDetectorCooldownForTest,
  _setCooldownForTest,
  _isDetectorOnCooldownForTest,
  _recordDetectorEmitForTest,
} from "./optionSignals";

describe("Detector cooldown (F-27)", () => {
  beforeEach(() => {
    _resetDetectorCooldownForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetDetectorCooldownForTest();
  });

  it("cooldown duration is 30 minutes", () => {
    expect(_getDetectorCooldownMs()).toBe(30 * 60 * 1000);
  });

  it("fresh state — no key is on cooldown", () => {
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BULLISH")).toBe(false);
    expect(_isDetectorOnCooldownForTest("VWAP_RECLAIM", "BANKNIFTY", "BEARISH")).toBe(false);
  });

  it("after recordDetectorEmit, that key IS on cooldown", () => {
    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY", "BULLISH");
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BULLISH")).toBe(true);
  });

  it("emit for one tuple does not put a different tuple on cooldown", () => {
    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY", "BULLISH");
    // Different index — no cooldown
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "BANKNIFTY", "BULLISH")).toBe(false);
    // Different direction — no cooldown
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BEARISH")).toBe(false);
    // Different setupKey — no cooldown
    expect(_isDetectorOnCooldownForTest("VWAP_RECLAIM", "NIFTY", "BULLISH")).toBe(false);
  });

  it("cooldown expires after DETECTOR_COOLDOWN_MS has elapsed", () => {
    const cooldownMs = _getDetectorCooldownMs();
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    // Record emit at 'now'
    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY", "BULLISH");
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BULLISH")).toBe(true);

    // Advance clock past the cooldown window
    vi.setSystemTime(now + cooldownMs + 1);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BULLISH")).toBe(false);
  });

  it("cooldown is still active 1ms before expiry", () => {
    const cooldownMs = _getDetectorCooldownMs();
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY", "BULLISH");
    vi.setSystemTime(now + cooldownMs - 1);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BULLISH")).toBe(true);
  });

  it("_setCooldownForTest seeds an explicit timestamp", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const cooldownMs = _getDetectorCooldownMs();

    // Seed with a timestamp that is 31 min ago — should NOT be on cooldown
    const staleTs = now - (cooldownMs + 1 * 60 * 1000);
    _setCooldownForTest("EMA_PULLBACK|NIFTY|BULLISH", staleTs);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BULLISH")).toBe(false);

    // Seed with current timestamp — should be on cooldown
    _setCooldownForTest("EMA_PULLBACK|NIFTY|BULLISH", now);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BULLISH")).toBe(true);
  });

  it("_resetDetectorCooldownForTest clears all entries", () => {
    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY", "BULLISH");
    _recordDetectorEmitForTest("VWAP_RECLAIM", "BANKNIFTY", "BEARISH");
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BULLISH")).toBe(true);

    _resetDetectorCooldownForTest();
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BULLISH")).toBe(false);
    expect(_isDetectorOnCooldownForTest("VWAP_RECLAIM", "BANKNIFTY", "BEARISH")).toBe(false);
  });

  it("multiple emits within cooldown window keep the window active", () => {
    vi.useFakeTimers();
    const cooldownMs = _getDetectorCooldownMs();
    const start = Date.now();
    vi.setSystemTime(start);

    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY", "BULLISH");
    vi.setSystemTime(start + 5 * 60 * 1000); // 5 min later
    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY", "BULLISH"); // refreshes entry

    // 29 min after the second emit — still on cooldown
    vi.setSystemTime(start + 5 * 60 * 1000 + cooldownMs - 1);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BULLISH")).toBe(true);

    // 30 min + 1ms after the second emit — expired
    vi.setSystemTime(start + 5 * 60 * 1000 + cooldownMs + 1);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY", "BULLISH")).toBe(false);
  });
});
