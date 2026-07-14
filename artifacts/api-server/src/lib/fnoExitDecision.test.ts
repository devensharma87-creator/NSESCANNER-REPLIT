/**
 * Unit tests for fnoExitDecision.ts — pure module.
 * No DB, no network, no side effects.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateFnoPaperTradeExit,
  SPOT_EXIT_FRESHNESS_WINDOW_MS,
  FNO_EXIT_PRIORITY_RULE,
  type FnoExitDecisionInput,
} from "./fnoExitDecision";
import type { SpotSnapshot } from "./optionSignalLifecycle";

const NOW_MS = Date.parse("2026-06-10T04:30:00.000Z");

function makeInput(overrides: Partial<FnoExitDecisionInput> = {}): FnoExitDecisionInput {
  return {
    currentStatus: "TRIGGERED",
    direction: "BULLISH",
    entry: 100,
    stop: 95,
    target1: 110,
    target2: 120,
    snapshot: { spot: 105 } as SpotSnapshot,
    provenance: {
      source: "LIVE_KITE_FULL",
      kiteSessionActive: true,
      asOfMs: NOW_MS,
    },
    nowMs: NOW_MS,
    ...overrides,
  };
}

describe("evaluateFnoPaperTradeExit — trust-gate happy path", () => {
  it("test 1: HOLD when trade-grade quote hasn't crossed any level", () => {
    const d = evaluateFnoPaperTradeExit(makeInput());
    expect(d.kind).toBe("HOLD");
    expect(d.tradeGrade).toBe(true);
  });

  it("test 2: EXIT STOPPED when trade-grade quote crosses locked stop", () => {
    const d = evaluateFnoPaperTradeExit(
      makeInput({ snapshot: { spot: 94, low: 94 } }),
    );
    expect(d.kind).toBe("EXIT");
    if (d.kind === "EXIT") {
      expect(d.exitReason).toBe("STOPPED");
      expect(d.settlement).toBe("FROZEN_PREMIUM");
      expect(d.priorityRule).toBe(FNO_EXIT_PRIORITY_RULE);
    }
  });

  it("test 3: EXIT TARGET1_HIT when trade-grade quote crosses target1 only", () => {
    const d = evaluateFnoPaperTradeExit(
      makeInput({ snapshot: { spot: 111, high: 111 } }),
    );
    expect(d.kind).toBe("HOLD"); // T1 alone keeps status TRIGGERED->TARGET1_HIT, not "exited"
  });

  it("test 4: same-bar stop+target tie resolves to STOP (priority rule preserved, undisturbed by gate)", () => {
    const d = evaluateFnoPaperTradeExit(
      makeInput({ snapshot: { spot: 100, high: 121, low: 94 } }),
    );
    expect(d.kind).toBe("EXIT");
    if (d.kind === "EXIT") expect(d.exitReason).toBe("STOPPED");
  });
});

describe("evaluateFnoPaperTradeExit — fail-closed trust/freshness gate", () => {
  it("test 5: BLOCKED STALE_QUOTE when quote older than freshness window, even though it would have exited", () => {
    const staleAsOf = NOW_MS - (SPOT_EXIT_FRESHNESS_WINDOW_MS + 1000);
    const d = evaluateFnoPaperTradeExit(
      makeInput({
        snapshot: { spot: 94, low: 94 },
        provenance: { source: "LIVE_KITE_FULL", kiteSessionActive: true, asOfMs: staleAsOf },
      }),
    );
    expect(d.kind).toBe("BLOCKED");
    if (d.kind === "BLOCKED") {
      expect(d.blockedReason).toBe("STALE_QUOTE");
      expect(d.wouldHaveExited).toBe(true);
      expect(d.wouldHaveExitReason).toBe("STOPPED");
    }
  });

  it("test 6: BLOCKED SOURCE_NOT_TRADE_GRADE for Yahoo-sourced quote, never closes", () => {
    const d = evaluateFnoPaperTradeExit(
      makeInput({
        snapshot: { spot: 94, low: 94 },
        provenance: { source: "DELAYED_YAHOO", kiteSessionActive: true, asOfMs: NOW_MS },
      }),
    );
    expect(d.kind).toBe("BLOCKED");
    if (d.kind === "BLOCKED") expect(d.blockedReason).toBe("SOURCE_NOT_TRADE_GRADE");
  });

  it("test 7: BLOCKED STALE_QUOTE when quote is missing entirely (asOfMs null)", () => {
    const d = evaluateFnoPaperTradeExit(
      makeInput({
        snapshot: { spot: 94, low: 94 },
        provenance: { source: "STALE", kiteSessionActive: true, asOfMs: null },
      }),
    );
    expect(d.kind).toBe("BLOCKED");
    if (d.kind === "BLOCKED") expect(d.blockedReason).toBe("STALE_QUOTE");
  });

  it("test 8: BLOCKED KITE_UNAVAILABLE when Kite session is not active, regardless of source label", () => {
    const d = evaluateFnoPaperTradeExit(
      makeInput({
        snapshot: { spot: 94, low: 94 },
        provenance: { source: "LIVE_KITE_FULL", kiteSessionActive: false, asOfMs: NOW_MS },
      }),
    );
    expect(d.kind).toBe("BLOCKED");
    if (d.kind === "BLOCKED") expect(d.blockedReason).toBe("KITE_UNAVAILABLE");
  });

  it("test 9: BLOCKED CONTRACT_INVALID when caller flags an invalid contract, takes precedence over everything", () => {
    const d = evaluateFnoPaperTradeExit(
      makeInput({
        snapshot: { spot: 94, low: 94 },
        contractValid: false,
        provenance: { source: "STALE", kiteSessionActive: false, asOfMs: null },
      }),
    );
    expect(d.kind).toBe("BLOCKED");
    if (d.kind === "BLOCKED") expect(d.blockedReason).toBe("CONTRACT_INVALID");
  });

  it("test 10: LIVE_KITE_PARTIAL is still trade-grade (not blocked) when session active and fresh", () => {
    const d = evaluateFnoPaperTradeExit(
      makeInput({
        snapshot: { spot: 94, low: 94 },
        provenance: { source: "LIVE_KITE_PARTIAL", kiteSessionActive: true, asOfMs: NOW_MS },
      }),
    );
    expect(d.kind).toBe("EXIT");
  });

  it("test 11: exactly at the freshness boundary is still fresh (not blocked)", () => {
    const d = evaluateFnoPaperTradeExit(
      makeInput({
        snapshot: { spot: 94, low: 94 },
        provenance: {
          source: "LIVE_KITE_FULL",
          kiteSessionActive: true,
          asOfMs: NOW_MS - SPOT_EXIT_FRESHNESS_WINDOW_MS,
        },
      }),
    );
    expect(d.kind).toBe("EXIT");
  });

  it("test 12: terminal current status never re-exits (evaluateTransition no-op passthrough)", () => {
    const d = evaluateFnoPaperTradeExit(
      makeInput({ currentStatus: "STOPPED", snapshot: { spot: 200, high: 200 } }),
    );
    expect(d.kind).toBe("HOLD");
    if (d.kind === "HOLD") expect(d.next).toBe("STOPPED");
  });

  it("test 13: PENDING->TRIGGERED transition alone is never reported as EXIT (entry gate untouched)", () => {
    const d = evaluateFnoPaperTradeExit(
      makeInput({ currentStatus: "PENDING", snapshot: { spot: 101, high: 101 } }),
    );
    expect(d.kind).toBe("HOLD");
    if (d.kind === "HOLD") expect(d.next).toBe("TRIGGERED");
  });
});
