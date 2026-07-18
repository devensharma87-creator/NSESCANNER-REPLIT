/**
 * F-27 — Detector cooldown tests.
 *
 * Cooldown key = "index::setupKey" (direction-independent).
 * A BULLISH emit for NIFTY::EMA_PULLBACK also suppresses a BEARISH re-fire
 * for the same detector/index within 30 minutes.
 *
 * Tests cover:
 *  1. Cooldown duration is 30 minutes.
 *  2. Fresh state — no key is on cooldown.
 *  3. After recordDetectorEmit, that (index, setupKey) IS on cooldown.
 *  4. Direction-independent: emit for one direction suppresses the other.
 *  5. Different index → different cooldown slot (independent).
 *  6. Different setupKey → different cooldown slot (independent).
 *  7. Cooldown expires after DETECTOR_COOLDOWN_MS has elapsed.
 *  8. Cooldown is still active 1ms before expiry.
 *  9. _setCooldownForTest seeds an explicit timestamp.
 * 10. _resetDetectorCooldownForTest clears all entries.
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
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(false);
    expect(_isDetectorOnCooldownForTest("VWAP_RECLAIM", "BANKNIFTY")).toBe(false);
  });

  it("after recordDetectorEmit, that (index, setupKey) IS on cooldown", () => {
    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY");
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(true);
  });

  it("cooldown is direction-independent: emit in one direction suppresses both directions", () => {
    // Emit only once — cooldown must cover both BULLISH and BEARISH emits
    // because the key is index::setupKey with no direction component.
    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY");
    // Same detector/index is on cooldown regardless of which direction check
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(true);
    // Verify the key really doesn't encode direction by using _setCooldownForTest
    // with the actual key format and checking the helper sees it
    _resetDetectorCooldownForTest();
    _setCooldownForTest("NIFTY::EMA_PULLBACK", Date.now());
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(true);
  });

  it("different index — independent cooldown slot", () => {
    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY");
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "BANKNIFTY")).toBe(false);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "SENSEX")).toBe(false);
  });

  it("different setupKey — independent cooldown slot", () => {
    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY");
    expect(_isDetectorOnCooldownForTest("VWAP_RECLAIM", "NIFTY")).toBe(false);
    expect(_isDetectorOnCooldownForTest("OI_BUILDUP", "NIFTY")).toBe(false);
  });

  it("cooldown expires after DETECTOR_COOLDOWN_MS has elapsed", () => {
    const cooldownMs = _getDetectorCooldownMs();
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY");
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(true);

    vi.setSystemTime(now + cooldownMs + 1);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(false);
  });

  it("cooldown is still active 1ms before expiry", () => {
    const cooldownMs = _getDetectorCooldownMs();
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY");
    vi.setSystemTime(now + cooldownMs - 1);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(true);
  });

  it("_setCooldownForTest with 'index::setupKey' format seeds the entry", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const cooldownMs = _getDetectorCooldownMs();

    // Seed with a stale timestamp — should NOT be on cooldown
    _setCooldownForTest("NIFTY::EMA_PULLBACK", now - (cooldownMs + 1000));
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(false);

    // Seed with current timestamp — should be on cooldown
    _setCooldownForTest("NIFTY::EMA_PULLBACK", now);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(true);
  });

  it("_resetDetectorCooldownForTest clears all entries", () => {
    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY");
    _recordDetectorEmitForTest("VWAP_RECLAIM", "BANKNIFTY");
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(true);

    _resetDetectorCooldownForTest();
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(false);
    expect(_isDetectorOnCooldownForTest("VWAP_RECLAIM", "BANKNIFTY")).toBe(false);
  });

  it("second emit within window refreshes the expiry", () => {
    vi.useFakeTimers();
    const cooldownMs = _getDetectorCooldownMs();
    const start = Date.now();
    vi.setSystemTime(start);

    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY");
    vi.setSystemTime(start + 5 * 60 * 1000); // 5 min later
    _recordDetectorEmitForTest("EMA_PULLBACK", "NIFTY"); // refreshes entry

    // 29 min after the second emit — still on cooldown
    vi.setSystemTime(start + 5 * 60 * 1000 + cooldownMs - 1);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(true);

    // 30 min + 1ms after the second emit — expired
    vi.setSystemTime(start + 5 * 60 * 1000 + cooldownMs + 1);
    expect(_isDetectorOnCooldownForTest("EMA_PULLBACK", "NIFTY")).toBe(false);
  });
});
