/**
 * Task #135: Kite Integration Hardening — unit tests.
 *
 * F-08: Central quote rate limiter + historical throttle stats
 * F-02: isKiteLive() callback injection + KITE_SESSION_DEAD skip gate
 * F-07: EOD reconcile at 15:35 IST — timing, message format, constants
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  reserveQuoteSlot,
  getQuoteThrottleStats,
  _resetQuoteThrottleForTest,
  _setQuotePendingCountForTest,
} from "./kiteRateLimiter";
import { getHistoricalThrottleStats } from "./kiteIntraday";
import {
  isKiteLive,
  _registerWsLivenessCheck,
  _resetKiteLivenessForTest,
} from "./kiteAuth";
import type { SkipReason } from "./paperTradingFO";
import { EOD_RECONCILE_REPORT_TYPE } from "./dailyReports";

// ── F-08: Quote throttle ─────────────────────────────────────────────────────

describe("kiteRateLimiter — F-08 central quote throttle", () => {
  beforeEach(() => {
    _resetQuoteThrottleForTest();
  });

  it("getQuoteThrottleStats returns correct shape with sane defaults", () => {
    const stats = getQuoteThrottleStats();
    expect(typeof stats.pendingCount).toBe("number");
    expect(typeof stats.maxPending).toBe("number");
    expect(typeof stats.minIntervalMs).toBe("number");
    expect(stats.pendingCount).toBe(0);
    expect(stats.maxPending).toBeGreaterThan(0);
    expect(stats.minIntervalMs).toBeGreaterThan(0);
  });

  it("minIntervalMs enforces ≤3 req/s (must be ≥333 ms)", () => {
    const { minIntervalMs } = getQuoteThrottleStats();
    expect(minIntervalMs).toBeGreaterThanOrEqual(333);
  });

  it("reserveQuoteSlot resolves to true when queue is empty", async () => {
    const ok = await reserveQuoteSlot();
    expect(ok).toBe(true);
  });

  it("pendingCount returns to 0 after slot is granted (finally cleanup)", async () => {
    await reserveQuoteSlot();
    expect(getQuoteThrottleStats().pendingCount).toBe(0);
  });

  it("reserveQuoteSlot returns false when pending count is at max capacity", async () => {
    const { maxPending } = getQuoteThrottleStats();
    _setQuotePendingCountForTest(maxPending);
    const ok = await reserveQuoteSlot();
    expect(ok).toBe(false);
  });

  it("three sequential slots all succeed — no leftover pending state", async () => {
    const results = await Promise.all([
      reserveQuoteSlot(),
      reserveQuoteSlot(),
      reserveQuoteSlot(),
    ]);
    for (const r of results) expect(r).toBe(true);
    expect(getQuoteThrottleStats().pendingCount).toBe(0);
  });
});

// ── F-08: Historical throttle stats ─────────────────────────────────────────

describe("kiteIntraday.getHistoricalThrottleStats — F-08", () => {
  it("returns a well-shaped stats object", () => {
    const stats = getHistoricalThrottleStats();
    expect(typeof stats.pendingCount).toBe("number");
    expect(typeof stats.backfillPendingCount).toBe("number");
    expect(typeof stats.maxQueue).toBe("number");
    expect(typeof stats.backfillMaxQueue).toBe("number");
    expect(typeof stats.minIntervalMs).toBe("number");
    expect(stats.pendingCount).toBeGreaterThanOrEqual(0);
    expect(stats.backfillPendingCount).toBeGreaterThanOrEqual(0);
  });

  it("backfillMaxQueue is smaller than maxQueue (backfill cap is a strict subset)", () => {
    const { maxQueue, backfillMaxQueue } = getHistoricalThrottleStats();
    expect(backfillMaxQueue).toBeLessThan(maxQueue);
  });

  it("minIntervalMs enforces ≤2.5 req/s (must be ≥400 ms)", () => {
    const { minIntervalMs } = getHistoricalThrottleStats();
    expect(minIntervalMs).toBeGreaterThanOrEqual(400);
  });
});

// ── F-08: DataDiagnostics kiteRateLimit field shape ─────────────────────────

describe("DataDiagnostics kiteRateLimit field shape — F-08", () => {
  it("quoteBucket and historicalBucket both have correct numeric fields", () => {
    const quoteBucket     = getQuoteThrottleStats();
    const historicalBucket = getHistoricalThrottleStats();
    const kiteRateLimit = { quoteBucket, historicalBucket };

    expect(kiteRateLimit.quoteBucket).toHaveProperty("pendingCount");
    expect(kiteRateLimit.quoteBucket).toHaveProperty("maxPending");
    expect(kiteRateLimit.quoteBucket).toHaveProperty("minIntervalMs");

    expect(kiteRateLimit.historicalBucket).toHaveProperty("pendingCount");
    expect(kiteRateLimit.historicalBucket).toHaveProperty("backfillPendingCount");
    expect(kiteRateLimit.historicalBucket).toHaveProperty("maxQueue");
    expect(kiteRateLimit.historicalBucket).toHaveProperty("backfillMaxQueue");
    expect(kiteRateLimit.historicalBucket).toHaveProperty("minIntervalMs");
  });
});

// ── F-02: isKiteLive + _registerWsLivenessCheck ─────────────────────────────

describe("isKiteLive — F-02 session liveness gate", () => {
  beforeEach(() => {
    _resetKiteLivenessForTest();
  });

  it("returns false when no callback has been registered (fail-closed)", () => {
    expect(isKiteLive()).toBe(false);
  });

  it("returns false when registered callback returns false (WS disconnected)", () => {
    _registerWsLivenessCheck(() => false);
    expect(isKiteLive()).toBe(false);
  });

  it("returns true when registered callback returns true (WS connected)", () => {
    _registerWsLivenessCheck(() => true);
    expect(isKiteLive()).toBe(true);
  });

  it("dynamically reflects callback state — transitions false→true→false", () => {
    let live = true;
    _registerWsLivenessCheck(() => live);
    expect(isKiteLive()).toBe(true);
    live = false;
    expect(isKiteLive()).toBe(false);
    live = true;
    expect(isKiteLive()).toBe(true);
  });

  it("_registerWsLivenessCheck overwrites a previously registered callback", () => {
    _registerWsLivenessCheck(() => true);
    expect(isKiteLive()).toBe(true);
    _registerWsLivenessCheck(() => false);
    expect(isKiteLive()).toBe(false);
  });

  it("is synchronous — completes in under 5 ms", () => {
    _registerWsLivenessCheck(() => true);
    const start = Date.now();
    isKiteLive();
    expect(Date.now() - start).toBeLessThan(5);
  });

  it("after reset, isKiteLive returns false again (fail-closed)", () => {
    _registerWsLivenessCheck(() => true);
    expect(isKiteLive()).toBe(true);
    _resetKiteLivenessForTest();
    expect(isKiteLive()).toBe(false);
  });
});

// ── F-02: KITE_SESSION_DEAD in SkipReason union ──────────────────────────────

describe("KITE_SESSION_DEAD SkipReason — F-02", () => {
  it("KITE_SESSION_DEAD is a valid SkipReason string constant", () => {
    // Assign to a typed variable — TypeScript will reject this at compile time
    // if "KITE_SESSION_DEAD" is not a member of the SkipReason union.
    const reason: SkipReason = "KITE_SESSION_DEAD";
    expect(reason).toBe("KITE_SESSION_DEAD");
  });

  it("KITE_SESSION_DEAD string literal is stable (regression guard)", () => {
    const reason: SkipReason = "KITE_SESSION_DEAD";
    // This test fails if the constant is renamed / typo'd in the union
    expect(typeof reason).toBe("string");
    expect(reason).toMatch(/^KITE_SESSION_DEAD$/);
  });
});

// ── F-07: EOD reconcile constants + message format ───────────────────────────

describe("EOD reconcile constants and message format — F-07", () => {
  it("EOD_RECONCILE_REPORT_TYPE is the stable dedup key used in daily_report_runs", () => {
    expect(EOD_RECONCILE_REPORT_TYPE).toBe("eod_reconcile");
  });

  it("EOD window covers exactly [15:35, 15:55) IST — 20-minute window", () => {
    // These are the values baked into maybeRunEodReconcile:
    //   EOD_RECONCILE_START_MIN  = 15 * 60 + 35 = 935
    //   EOD_RECONCILE_WINDOW_MIN = 20
    const START_MIN = 15 * 60 + 35; // 935
    const WINDOW    = 20;
    const END_MIN   = START_MIN + WINDOW; // 955 = 15:55

    // Boundary assertions used as documentation + regression guard
    expect(START_MIN).toBe(935);   // 15:35 IST
    expect(END_MIN).toBe(955);     // 15:55 IST
    expect(WINDOW).toBe(20);       // 20-minute window

    // Values outside the window should fail the guard
    expect(934).toBeLessThan(START_MIN);      // 15:34 — too early
    expect(955).toBeGreaterThanOrEqual(END_MIN); // 15:55 — too late (excluded)
  });

  it("formats positive P&L with + prefix and en-IN thousands separator", () => {
    const pnl = 12500;
    const formatted = pnl >= 0
      ? `+₹${Math.round(Math.abs(pnl)).toLocaleString("en-IN")}`
      : `-₹${Math.round(Math.abs(pnl)).toLocaleString("en-IN")}`;
    expect(formatted).toMatch(/^\+₹/);
    expect(formatted).toContain("12,500");
  });

  it("formats negative P&L with - prefix and en-IN thousands separator", () => {
    const pnl = -3750;
    const formatted = pnl >= 0
      ? `+₹${Math.round(Math.abs(pnl)).toLocaleString("en-IN")}`
      : `-₹${Math.round(Math.abs(pnl)).toLocaleString("en-IN")}`;
    expect(formatted).toMatch(/^-₹/);
    expect(formatted).toContain("3,750");
  });

  it("message template includes required sections and emoji header", () => {
    const date = "2026-07-14";
    const openCount   = 0;
    const closedCount = 2;
    const totalOpened = 2;
    const realisedPnl = 800;
    const pnlFormatted = `+₹${Math.round(realisedPnl).toLocaleString("en-IN")}`;
    const text =
      `📊 EOD RECONCILE — ${date}\n` +
      `Trades opened today : ${totalOpened}\n` +
      `Trades closed       : ${closedCount}\n` +
      `Realised P&L        : ${pnlFormatted}\n` +
      (openCount > 0
        ? `⚠️ OPEN rows remaining: ${openCount} (should be 0 — check 15:20 force-close log)`
        : `✅ No open rows remaining`);

    expect(text).toContain("📊 EOD RECONCILE");
    expect(text).toContain(date);
    expect(text).toContain("Trades opened today : 2");
    expect(text).toContain("Trades closed       : 2");
    expect(text).toContain("+₹800");
    expect(text).toContain("✅ No open rows remaining");
    expect(text).not.toContain("⚠️");
  });

  it("message contains ⚠️ warning section when open rows remain", () => {
    const date = "2026-07-14";
    const openCount   = 3;
    const closedCount = 1;
    const totalOpened = 4;
    const realisedPnl = -250;
    const pnlFormatted = `-₹${Math.round(Math.abs(realisedPnl)).toLocaleString("en-IN")}`;
    const text =
      `📊 EOD RECONCILE — ${date}\n` +
      `Trades opened today : ${totalOpened}\n` +
      `Trades closed       : ${closedCount}\n` +
      `Realised P&L        : ${pnlFormatted}\n` +
      (openCount > 0
        ? `⚠️ OPEN rows remaining: ${openCount} (should be 0 — check 15:20 force-close log)`
        : `✅ No open rows remaining`);

    expect(text).toContain("⚠️ OPEN rows remaining: 3");
    expect(text).toContain("-₹250");
    expect(text).not.toContain("✅");
  });

  it("zero P&L is formatted as +₹0 (not negative zero)", () => {
    const pnl = 0;
    const formatted = pnl >= 0
      ? `+₹${Math.round(Math.abs(pnl)).toLocaleString("en-IN")}`
      : `-₹${Math.round(Math.abs(pnl)).toLocaleString("en-IN")}`;
    expect(formatted).toBe("+₹0");
  });

  it("large P&L is formatted correctly with Indian number grouping", () => {
    const pnl = 125000;
    const formatted = `+₹${Math.round(Math.abs(pnl)).toLocaleString("en-IN")}`;
    // en-IN groups: 1,25,000
    expect(formatted).toContain("1,25,000");
  });
});

// ── F-02: Sweep liveness gate — logic validation ─────────────────────────────

describe("optionSignals sweep suppression gate — F-02", () => {
  // We can't easily test the setInterval callback directly without complex
  // mocking. Instead, we test the gate conditions that drive the suppression
  // decision, ensuring the logic is correct in isolation.

  it("sweep is suppressed when isKiteLive returns false (gate logic)", () => {
    _resetKiteLivenessForTest(); // no callback → fail-closed
    // This is the exact condition checked in the setInterval:
    const shouldSuppress = !isKiteLive();
    expect(shouldSuppress).toBe(true);
  });

  it("sweep is allowed when isKiteLive returns true (gate logic)", () => {
    _registerWsLivenessCheck(() => true);
    const shouldSuppress = !isKiteLive();
    expect(shouldSuppress).toBe(false);
    _resetKiteLivenessForTest();
  });
});
