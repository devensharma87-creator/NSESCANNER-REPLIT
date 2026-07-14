/**
 * Unit tests for fnoExitMonitorHealth.ts's scheduler summary counters
 * (T004, 2026-07-02). Pure in-memory accumulator + process-local rolling
 * health snapshot — no DB, no network, no side effects beyond the
 * module-level health state (reset in beforeEach/afterEach).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  beginFnoExitMonitorCycle,
  noteFnoExitMonitorScan,
  noteFnoExitMonitorDecision,
  noteFnoExitMonitorError,
  finalizeFnoExitMonitorCycle,
  getFnoExitMonitorHealth,
  __resetFnoExitMonitorHealthForTests,
  type FnoExitTradeKey,
} from "./fnoExitMonitorHealth";
import type { FnoExitDecision } from "./fnoExitDecision";

function key(overrides: Partial<Extract<FnoExitTradeKey, { signalDate: string }>> = {}): FnoExitTradeKey {
  return {
    signalDate: "2026-07-02",
    indexSymbol: "NIFTY",
    setupKey: "SETUP1",
    direction: "BULLISH",
    ...overrides,
  };
}

function exitDecision(overrides: Partial<Extract<FnoExitDecision, { kind: "EXIT" }>> = {}): FnoExitDecision {
  return {
    kind: "EXIT",
    next: "STOPPED",
    triggered: true,
    exitReason: "STOPPED",
    settlement: "FROZEN_PREMIUM",
    tradeGrade: true,
    priorityRule: "STOP_WINS_ON_SAME_BAR_TIE",
    quoteSource: "LIVE_KITE_FULL",
    quoteAsOfMs: Date.now(),
    quoteFreshnessSec: 5,
    ...overrides,
  };
}

function holdDecision(overrides: Partial<Extract<FnoExitDecision, { kind: "HOLD" }>> = {}): FnoExitDecision {
  return {
    kind: "HOLD",
    next: "TRIGGERED",
    triggered: true,
    tradeGrade: true,
    quoteSource: "LIVE_KITE_FULL",
    quoteAsOfMs: Date.now(),
    quoteFreshnessSec: 5,
    ...overrides,
  };
}

function blockedDecision(overrides: Partial<Extract<FnoExitDecision, { kind: "BLOCKED" }>> = {}): FnoExitDecision {
  return {
    kind: "BLOCKED",
    blockedReason: "STALE_QUOTE",
    tradeGrade: false,
    wouldHaveExited: false,
    wouldHaveExitReason: null,
    quoteSource: "STALE",
    quoteAsOfMs: null,
    quoteFreshnessSec: null,
    ...overrides,
  };
}

describe("fnoExitMonitorHealth — cycle accumulator", () => {
  beforeEach(() => __resetFnoExitMonitorHealthForTests());
  afterEach(() => __resetFnoExitMonitorHealthForTests());

  it("test 1: beginFnoExitMonitorCycle starts a fully-zeroed accumulator", () => {
    const acc = beginFnoExitMonitorCycle(1_000);
    expect(acc.openTradesScanned).toBe(0);
    expect(acc.quotesFetched).toBe(0);
    expect(acc.exitedCount).toBe(0);
    expect(acc.blockedCount).toBe(0);
    expect(acc.skippedCount).toBe(0);
    expect(acc.duplicateSkippedCount).toBe(0);
    expect(acc.staleDataCount).toBe(0);
    expect(acc.kiteUnavailableCount).toBe(0);
    expect(acc.errors).toBe(0);
    expect(acc.startedAtMs).toBe(1_000);
    expect(acc.blockedByReason).toEqual({
      CONTRACT_INVALID: 0,
      KITE_UNAVAILABLE: 0,
      SOURCE_NOT_TRADE_GRADE: 0,
      STALE_QUOTE: 0,
    });
  });

  it("test 2: noteFnoExitMonitorScan increments openTradesScanned and no-ops on undefined", () => {
    const acc = beginFnoExitMonitorCycle();
    noteFnoExitMonitorScan(acc);
    noteFnoExitMonitorScan(acc);
    expect(acc.openTradesScanned).toBe(2);
    expect(() => noteFnoExitMonitorScan(undefined)).not.toThrow();
  });

  it("test 3: noteFnoExitMonitorDecision EXIT increments exitedCount + quotesFetched", () => {
    const acc = beginFnoExitMonitorCycle();
    noteFnoExitMonitorDecision(acc, key(), exitDecision());
    expect(acc.exitedCount).toBe(1);
    expect(acc.quotesFetched).toBe(1);
    expect(acc.blockedCount).toBe(0);
    expect(acc.skippedCount).toBe(0);
  });

  it("test 4: noteFnoExitMonitorDecision HOLD increments skippedCount only", () => {
    const acc = beginFnoExitMonitorCycle();
    noteFnoExitMonitorDecision(acc, key(), holdDecision());
    expect(acc.skippedCount).toBe(1);
    expect(acc.exitedCount).toBe(0);
    expect(acc.blockedCount).toBe(0);
  });

  it("test 5: noteFnoExitMonitorDecision BLOCKED increments blockedCount + blockedByReason breakdown", () => {
    const acc = beginFnoExitMonitorCycle();
    noteFnoExitMonitorDecision(acc, key({ setupKey: "S1" }), blockedDecision({ blockedReason: "STALE_QUOTE" }));
    noteFnoExitMonitorDecision(
      acc,
      key({ setupKey: "S2" }),
      blockedDecision({ blockedReason: "KITE_UNAVAILABLE" }),
    );
    expect(acc.blockedCount).toBe(2);
    expect(acc.blockedByReason.STALE_QUOTE).toBe(1);
    expect(acc.blockedByReason.KITE_UNAVAILABLE).toBe(1);
    expect(acc.staleDataCount).toBe(1);
    expect(acc.kiteUnavailableCount).toBe(1);
  });

  it("test 6: noteFnoExitMonitorDecision dedups the same trade key within a cycle", () => {
    const acc = beginFnoExitMonitorCycle();
    const k = key();
    noteFnoExitMonitorDecision(acc, k, exitDecision());
    noteFnoExitMonitorDecision(acc, k, exitDecision());
    expect(acc.exitedCount).toBe(1);
    expect(acc.duplicateSkippedCount).toBe(1);
  });

  it("test 7: noteFnoExitMonitorDecision distinguishes keys by full tuple (no false dedup)", () => {
    const acc = beginFnoExitMonitorCycle();
    noteFnoExitMonitorDecision(acc, key({ direction: "BULLISH" }), exitDecision());
    noteFnoExitMonitorDecision(acc, key({ direction: "BEARISH" }), exitDecision());
    expect(acc.exitedCount).toBe(2);
    expect(acc.duplicateSkippedCount).toBe(0);
  });

  it("test 8: noteFnoExitMonitorDecision no-ops on undefined accumulator", () => {
    expect(() => noteFnoExitMonitorDecision(undefined, key(), exitDecision())).not.toThrow();
  });

  it("test 9: noteFnoExitMonitorError increments errors and no-ops on undefined", () => {
    const acc = beginFnoExitMonitorCycle();
    noteFnoExitMonitorError(acc);
    noteFnoExitMonitorError(acc);
    expect(acc.errors).toBe(2);
    expect(() => noteFnoExitMonitorError(undefined)).not.toThrow();
  });

  it("test 10: two concurrent accumulators never cross-attribute counts", () => {
    const accA = beginFnoExitMonitorCycle();
    const accB = beginFnoExitMonitorCycle();
    noteFnoExitMonitorScan(accA, 5);
    noteFnoExitMonitorDecision(accA, key({ setupKey: "A1" }), exitDecision());
    noteFnoExitMonitorScan(accB, 3);
    noteFnoExitMonitorDecision(accB, key({ setupKey: "B1" }), blockedDecision());
    expect(accA.openTradesScanned).toBe(5);
    expect(accA.exitedCount).toBe(1);
    expect(accA.blockedCount).toBe(0);
    expect(accB.openTradesScanned).toBe(3);
    expect(accB.exitedCount).toBe(0);
    expect(accB.blockedCount).toBe(1);
  });
});

describe("fnoExitMonitorHealth — finalize + rolling health snapshot", () => {
  beforeEach(() => __resetFnoExitMonitorHealthForTests());
  afterEach(() => __resetFnoExitMonitorHealthForTests());

  it("test 11: finalizeFnoExitMonitorCycle returns stats matching the accumulator", () => {
    const acc = beginFnoExitMonitorCycle(1_000);
    noteFnoExitMonitorScan(acc, 4);
    noteFnoExitMonitorDecision(acc, key(), exitDecision());
    const stats = finalizeFnoExitMonitorCycle(acc, 6_000);
    expect(stats.openTradesScanned).toBe(4);
    expect(stats.exitedCount).toBe(1);
    expect(stats.durationMs).toBe(5_000);
    expect(stats.checkedAt).toBe(new Date(6_000).toISOString());
    expect(stats.nextRunAt).toBe(new Date(6_000 + 30_000).toISOString());
    expect(stats.errors).toBe(0);
  });

  it("test 12: finalizeFnoExitMonitorCycle rolls totals into getFnoExitMonitorHealth()", () => {
    const acc1 = beginFnoExitMonitorCycle();
    noteFnoExitMonitorDecision(acc1, key({ setupKey: "S1" }), exitDecision());
    noteFnoExitMonitorDecision(acc1, key({ setupKey: "S2" }), blockedDecision());
    finalizeFnoExitMonitorCycle(acc1);

    const acc2 = beginFnoExitMonitorCycle();
    noteFnoExitMonitorDecision(acc2, key({ setupKey: "S3" }), exitDecision());
    finalizeFnoExitMonitorCycle(acc2);

    const health = getFnoExitMonitorHealth();
    expect(health.cyclesTotal).toBe(2);
    expect(health.exitedTotal).toBe(2);
    expect(health.blockedTotal).toBe(1);
    expect(health.errorsTotal).toBe(0);
    expect(health.lastCycle?.exitedCount).toBe(1);
    expect(health.lastSuccessAt).not.toBeNull();
    expect(health.lastErrorAt).toBeNull();
  });

  it("test 13: a cycle with errors stamps lastErrorAt/lastErrorClass/lastErrorMessage but still counts as a success", () => {
    const acc = beginFnoExitMonitorCycle();
    noteFnoExitMonitorError(acc);
    noteFnoExitMonitorError(acc);
    finalizeFnoExitMonitorCycle(acc, 9_999);

    const health = getFnoExitMonitorHealth();
    expect(health.errorsTotal).toBe(2);
    expect(health.lastErrorAt).toBe(new Date(9_999).toISOString());
    expect(health.lastErrorClass).toBe("CycleError");
    expect(health.lastErrorMessage).toMatch(/2 exit-monitor/);
    // Best-effort audit stamps failing doesn't fail the cycle itself.
    expect(health.lastSuccessAt).toBe(new Date(9_999).toISOString());
  });

  it("test 14: __resetFnoExitMonitorHealthForTests clears all rolling state", () => {
    const acc = beginFnoExitMonitorCycle();
    noteFnoExitMonitorDecision(acc, key(), exitDecision());
    finalizeFnoExitMonitorCycle(acc);
    expect(getFnoExitMonitorHealth().cyclesTotal).toBe(1);

    __resetFnoExitMonitorHealthForTests();
    const health = getFnoExitMonitorHealth();
    expect(health.cyclesTotal).toBe(0);
    expect(health.exitedTotal).toBe(0);
    expect(health.blockedTotal).toBe(0);
    expect(health.errorsTotal).toBe(0);
    expect(health.lastCycle).toBeNull();
    expect(health.lastSuccessAt).toBeNull();
    expect(health.lastErrorAt).toBeNull();
    expect(health.lastErrorClass).toBeNull();
    expect(health.lastErrorMessage).toBeNull();
  });

  it("test 15: getFnoExitMonitorHealth().bootedAt is a stable ISO timestamp across calls", () => {
    const a = getFnoExitMonitorHealth().bootedAt;
    const b = getFnoExitMonitorHealth().bootedAt;
    expect(a).toBe(b);
    expect(() => new Date(a).toISOString()).not.toThrow();
  });
});
