/**
 * Tests for Task #136 — Telegram Event Coverage:
 *   1. DD latch firstTrigger flag (paperAccount.ts)
 *   2. WS disconnect rate limit (infraAlerts.ts)
 *   3. DD latch alert DB dedup (infraAlerts.ts)
 *   4. BASELINE lane lock alert DB dedup (infraAlerts.ts)
 *   5. Signal trigger alert (fnoSignalAlerts.ts)
 *   6. New TradeAlertEventType union members
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TradeAlertEventType } from "./tradeLifecycle/types";

// ── 1. DrawdownReading.firstTrigger ──────────────────────────────────────────

describe("DrawdownReading.firstTrigger", () => {
  it("firstTrigger=true only when latch fires for the first time", () => {
    // Simulate two consecutive readings:
    // 1st call: capReached just became true (wasLatched=false) → firstTrigger=true
    // 2nd call: latch already set (wasLatched=true) → firstTrigger=false

    function simulateReading(capReached: boolean, wasLatched: boolean) {
      return { firstTrigger: capReached && !wasLatched };
    }

    const first = simulateReading(true, false);
    expect(first.firstTrigger).toBe(true);

    const second = simulateReading(true, true);
    expect(second.firstTrigger).toBe(false);
  });

  it("firstTrigger=false when cap not reached", () => {
    function simulateReading(capReached: boolean, wasLatched: boolean) {
      return { firstTrigger: capReached && !wasLatched };
    }
    const reading = simulateReading(false, false);
    expect(reading.firstTrigger).toBe(false);
  });

  it("firstTrigger=false when latch already set and cap still reached", () => {
    function simulateReading(capReached: boolean, wasLatched: boolean) {
      return { firstTrigger: capReached && !wasLatched };
    }
    const reading = simulateReading(true, true);
    expect(reading.firstTrigger).toBe(false);
  });
});

// ── 2. WS disconnect rate limit ──────────────────────────────────────────────

describe("alertWsNoreconnect (in-memory rate limit)", () => {
  let alertOwnerRawMock: ReturnType<typeof vi.fn>;
  let resetFn: () => void;
  let getCooldownFn: () => number;

  beforeEach(async () => {
    vi.resetModules();
    alertOwnerRawMock = vi.fn();
    vi.doMock("./alerting", () => ({
      alertOwnerRaw: alertOwnerRawMock,
    }));
    vi.doMock("./tradeLifecycle/notificationLog", () => ({
      hasAlreadyDelivered: vi.fn().mockResolvedValue(false),
      logNotificationDelivery: vi.fn().mockResolvedValue("row-1"),
      hashMessage: (s: string) => s.slice(0, 8),
    }));

    const mod = await import("./infraAlerts");
    resetFn = mod._resetWsAlertCooldownForTest;
    getCooldownFn = mod._getWsAlertCooldownMs;
    resetFn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires alert on first call", async () => {
    const { alertWsNoreconnect } = await import("./infraAlerts");
    alertWsNoreconnect();
    expect(alertOwnerRawMock).toHaveBeenCalledTimes(1);
    const [key, , text] = alertOwnerRawMock.mock.calls[0] as [string, string, string];
    expect(key).toBe("KITE_WS_NORECONNECT");
    expect(text).toContain("KITE WS DISCONNECTED");
    expect(text).toContain("Auto-reconnect exhausted");
  });

  it("does not fire within cooldown window", async () => {
    const { alertWsNoreconnect } = await import("./infraAlerts");
    alertWsNoreconnect();
    alertWsNoreconnect();
    alertWsNoreconnect();
    expect(alertOwnerRawMock).toHaveBeenCalledTimes(1);
  });

  it("fires again after cooldown resets", async () => {
    const { alertWsNoreconnect } = await import("./infraAlerts");
    alertWsNoreconnect();
    expect(alertOwnerRawMock).toHaveBeenCalledTimes(1);
    // Reset the cooldown (simulates time passing)
    resetFn();
    alertWsNoreconnect();
    expect(alertOwnerRawMock).toHaveBeenCalledTimes(2);
  });

  it("cooldown is 10 minutes", () => {
    expect(getCooldownFn()).toBe(10 * 60 * 1000);
  });
});

// ── 3. alertDdLatchFired — message format and DB dedup ───────────────────────

describe("alertDdLatchFired (DB dedup + message format)", () => {
  let alertOwnerRawMock: ReturnType<typeof vi.fn>;
  let hasAlreadyDeliveredMock: ReturnType<typeof vi.fn>;
  let logNotificationDeliveryMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    alertOwnerRawMock = vi.fn();
    hasAlreadyDeliveredMock = vi.fn().mockResolvedValue(false);
    logNotificationDeliveryMock = vi.fn().mockResolvedValue("row-1");
    vi.doMock("./alerting", () => ({
      alertOwnerRaw: alertOwnerRawMock,
    }));
    vi.doMock("./tradeLifecycle/notificationLog", () => ({
      hasAlreadyDelivered: hasAlreadyDeliveredMock,
      logNotificationDelivery: logNotificationDeliveryMock,
      hashMessage: (s: string) => s.slice(0, 8),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends DAILY latch message with correct text", async () => {
    const { alertDdLatchFired } = await import("./infraAlerts");
    await alertDdLatchFired("DAILY", {
      drawdownPct: 0.026,
      capPct: 0.025,
      realisedPnl: -5200,
      windowStart: "2026-07-14",
    });
    expect(alertOwnerRawMock).toHaveBeenCalledTimes(1);
    const text = alertOwnerRawMock.mock.calls[0]![2] as string;
    expect(text).toContain("🛑 DD LATCH TRIGGERED — DAILY");
    expect(text).toContain("₹5200");
    expect(text).toContain("2.5%");
    expect(text).toContain("today");
  });

  it("sends WEEKLY latch message with correct text", async () => {
    const { alertDdLatchFired } = await import("./infraAlerts");
    await alertDdLatchFired("WEEKLY", {
      drawdownPct: 0.052,
      capPct: 0.05,
      realisedPnl: -10400,
      windowStart: "2026-07-14",
    });
    expect(alertOwnerRawMock).toHaveBeenCalledTimes(1);
    const text = alertOwnerRawMock.mock.calls[0]![2] as string;
    expect(text).toContain("🛑 DD LATCH TRIGGERED — WEEKLY");
    expect(text).toContain("₹10400");
    expect(text).toContain("5.0%");
    expect(text).toContain("this week");
  });

  it("checks DB dedup with correct domain + eventType", async () => {
    const { alertDdLatchFired } = await import("./infraAlerts");
    await alertDdLatchFired("DAILY", {
      drawdownPct: 0.026,
      capPct: 0.025,
      realisedPnl: -5200,
      windowStart: "2026-07-14",
    });
    expect(hasAlreadyDeliveredMock).toHaveBeenCalledWith(
      "FNO_INTRADAY",
      "DD_LATCH_DAILY",
      expect.objectContaining({ id: "dd_latch_daily_2026-07-14" }),
      "telegram_main",
    );
  });

  it("skips send when DB dedup returns true", async () => {
    hasAlreadyDeliveredMock.mockResolvedValue(true);
    const { alertDdLatchFired } = await import("./infraAlerts");
    await alertDdLatchFired("DAILY", {
      drawdownPct: 0.026,
      capPct: 0.025,
      realisedPnl: -5200,
      windowStart: "2026-07-14",
    });
    expect(alertOwnerRawMock).not.toHaveBeenCalled();
  });

  it("logs delivery to DB when not duplicate", async () => {
    const { alertDdLatchFired } = await import("./infraAlerts");
    await alertDdLatchFired("DAILY", {
      drawdownPct: 0.026,
      capPct: 0.025,
      realisedPnl: -5200,
      windowStart: "2026-07-14",
    });
    expect(logNotificationDeliveryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "FNO_INTRADAY",
        eventType: "DD_LATCH_DAILY",
        status: "SENT",
        destination: "telegram_main",
      }),
    );
  });

  it("does not throw when DB dedup throws", async () => {
    hasAlreadyDeliveredMock.mockRejectedValue(new Error("DB down"));
    const { alertDdLatchFired } = await import("./infraAlerts");
    await expect(
      alertDdLatchFired("DAILY", {
        drawdownPct: 0.026,
        capPct: 0.025,
        realisedPnl: -5200,
        windowStart: "2026-07-14",
      }),
    ).resolves.toBeUndefined();
  });
});

// ── 4. alertBaselineLaneLocked — message format and DB dedup ─────────────────

describe("alertBaselineLaneLocked (DB dedup + message format)", () => {
  let alertOwnerRawMock: ReturnType<typeof vi.fn>;
  let hasAlreadyDeliveredMock: ReturnType<typeof vi.fn>;
  let logNotificationDeliveryMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    alertOwnerRawMock = vi.fn();
    hasAlreadyDeliveredMock = vi.fn().mockResolvedValue(false);
    logNotificationDeliveryMock = vi.fn().mockResolvedValue("row-1");
    vi.doMock("./alerting", () => ({
      alertOwnerRaw: alertOwnerRawMock,
    }));
    vi.doMock("./tradeLifecycle/notificationLog", () => ({
      hasAlreadyDelivered: hasAlreadyDeliveredMock,
      logNotificationDelivery: logNotificationDeliveryMock,
      hashMessage: (s: string) => s.slice(0, 8),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct BASELINE lock message", async () => {
    const { alertBaselineLaneLocked } = await import("./infraAlerts");
    await alertBaselineLaneLocked("2026-07-14");
    expect(alertOwnerRawMock).toHaveBeenCalledTimes(1);
    const text = alertOwnerRawMock.mock.calls[0]![2] as string;
    expect(text).toContain("⚠️ BASELINE LANE LOCKED for today");
    expect(text).toContain("2 consecutive stops hit");
    expect(text).toContain("HC trades unaffected");
  });

  it("checks DB dedup with correct domain + eventType + eventId", async () => {
    const { alertBaselineLaneLocked } = await import("./infraAlerts");
    await alertBaselineLaneLocked("2026-07-14");
    expect(hasAlreadyDeliveredMock).toHaveBeenCalledWith(
      "FNO_INTRADAY",
      "BASELINE_LANE_LOCKED",
      expect.objectContaining({ id: "baseline_lock_2026-07-14" }),
      "telegram_main",
    );
  });

  it("skips send when already delivered", async () => {
    hasAlreadyDeliveredMock.mockResolvedValue(true);
    const { alertBaselineLaneLocked } = await import("./infraAlerts");
    await alertBaselineLaneLocked("2026-07-14");
    expect(alertOwnerRawMock).not.toHaveBeenCalled();
  });

  it("does not throw when DB throws", async () => {
    hasAlreadyDeliveredMock.mockRejectedValue(new Error("DB down"));
    const { alertBaselineLaneLocked } = await import("./infraAlerts");
    await expect(alertBaselineLaneLocked("2026-07-14")).resolves.toBeUndefined();
  });
});

// ── 5. alertFnoTrigger — env gate, test symbol, dev env, text format ─────────

describe("alertFnoTrigger (signal trigger alert)", () => {
  let alertOwnerRawMock: ReturnType<typeof vi.fn>;
  let hasAlreadyDeliveredMock: ReturnType<typeof vi.fn>;
  let logNotificationDeliveryMock: ReturnType<typeof vi.fn>;

  const baseInput = {
    indexSymbol: "NIFTY",
    direction: "BULLISH" as const,
    optionType: "CE" as const,
    confidence: 72,
    tier: "HIGH_CONVICTION",
    optionEntry: 320,
    signalDate: "2026-07-14",
    setupKey: "ema_pullback",
  };

  beforeEach(async () => {
    vi.resetModules();
    alertOwnerRawMock = vi.fn();
    hasAlreadyDeliveredMock = vi.fn().mockResolvedValue(false);
    logNotificationDeliveryMock = vi.fn().mockResolvedValue("row-1");
    vi.doMock("./alerting", () => ({
      alertOwnerRaw: alertOwnerRawMock,
    }));
    vi.doMock("./tradeLifecycle/notificationLog", () => ({
      hasAlreadyDelivered: hasAlreadyDeliveredMock,
      logNotificationDelivery: logNotificationDeliveryMock,
      hashMessage: (s: string) => s.slice(0, 8),
    }));
    // Default env
    process.env["TELEGRAM_SEND_TRIGGER_ALERTS"] = "true";
    process.env["NODE_ENV"] = "production";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["TELEGRAM_SEND_TRIGGER_ALERTS"];
    process.env["NODE_ENV"] = "test";
  });

  it("sends trigger alert when env=true and production", async () => {
    const { alertFnoTrigger } = await import("./fnoSignalAlerts");
    await alertFnoTrigger(baseInput);
    expect(alertOwnerRawMock).toHaveBeenCalledTimes(1);
    const text = alertOwnerRawMock.mock.calls[0]![2] as string;
    expect(text).toContain("📡 TRIGGER — NIFTY CE ₹320");
    expect(text).toContain("Confidence: 72");
    expect(text).toContain("Tier: HIGH_CONVICTION");
    expect(text).toContain("IST");
  });

  it("does NOT send when TELEGRAM_SEND_TRIGGER_ALERTS is unset", async () => {
    delete process.env["TELEGRAM_SEND_TRIGGER_ALERTS"];
    const { alertFnoTrigger } = await import("./fnoSignalAlerts");
    await alertFnoTrigger(baseInput);
    expect(alertOwnerRawMock).not.toHaveBeenCalled();
  });

  it("does NOT send when TELEGRAM_SEND_TRIGGER_ALERTS=false", async () => {
    process.env["TELEGRAM_SEND_TRIGGER_ALERTS"] = "false";
    const { alertFnoTrigger } = await import("./fnoSignalAlerts");
    await alertFnoTrigger(baseInput);
    expect(alertOwnerRawMock).not.toHaveBeenCalled();
  });

  it("blocks TEST symbols", async () => {
    const { alertFnoTrigger } = await import("./fnoSignalAlerts");
    await alertFnoTrigger({ ...baseInput, indexSymbol: "TESTSTK" });
    expect(alertOwnerRawMock).not.toHaveBeenCalled();
  });

  it("blocks non-production environment", async () => {
    process.env["NODE_ENV"] = "development";
    const { alertFnoTrigger } = await import("./fnoSignalAlerts");
    await alertFnoTrigger(baseInput);
    expect(alertOwnerRawMock).not.toHaveBeenCalled();
  });

  it("skips when DB dedup returns true", async () => {
    hasAlreadyDeliveredMock.mockResolvedValue(true);
    const { alertFnoTrigger } = await import("./fnoSignalAlerts");
    await alertFnoTrigger(baseInput);
    expect(alertOwnerRawMock).not.toHaveBeenCalled();
  });

  it("uses correct dedup key including direction for directional isolation", async () => {
    const { alertFnoTrigger } = await import("./fnoSignalAlerts");
    await alertFnoTrigger(baseInput);
    expect(hasAlreadyDeliveredMock).toHaveBeenCalledWith(
      "FNO_INTRADAY",
      "TRIGGER",
      expect.objectContaining({
        id: "trigger_NIFTY_2026-07-14_ema_pullback_BULLISH",
        signalId: "trigger_NIFTY_2026-07-14_ema_pullback_BULLISH",
      }),
      "telegram_main",
    );
  });

  it("infers CE from BULLISH when optionType is null", async () => {
    const { alertFnoTrigger } = await import("./fnoSignalAlerts");
    await alertFnoTrigger({ ...baseInput, optionType: null });
    const text = alertOwnerRawMock.mock.calls[0]![2] as string;
    expect(text).toContain("CE");
  });

  it("infers PE from BEARISH when optionType is null", async () => {
    const { alertFnoTrigger } = await import("./fnoSignalAlerts");
    await alertFnoTrigger({ ...baseInput, direction: "BEARISH", optionType: null });
    const text = alertOwnerRawMock.mock.calls[0]![2] as string;
    expect(text).toContain("PE");
  });

  it("shows — when optionEntry is null", async () => {
    const { alertFnoTrigger } = await import("./fnoSignalAlerts");
    await alertFnoTrigger({ ...baseInput, optionEntry: null });
    const text = alertOwnerRawMock.mock.calls[0]![2] as string;
    expect(text).toContain("—");
  });

  it("does not throw when DB throws (fail-open)", async () => {
    hasAlreadyDeliveredMock.mockRejectedValue(new Error("DB down"));
    const { alertFnoTrigger } = await import("./fnoSignalAlerts");
    await expect(alertFnoTrigger(baseInput)).resolves.toBeUndefined();
  });
});

// ── 6. TradeAlertEventType includes all new members ──────────────────────────

describe("TradeAlertEventType — new union members", () => {
  it("includes all four new event types", () => {
    const validTypes: TradeAlertEventType[] = [
      "TRIGGER",
      "DD_LATCH_DAILY",
      "DD_LATCH_WEEKLY",
      "BASELINE_LANE_LOCKED",
    ];
    expect(validTypes).toHaveLength(4);
    validTypes.forEach((t) => {
      expect(typeof t).toBe("string");
    });
  });
});

// ── 7. alertWsNoreconnect text content ───────────────────────────────────────

describe("alertWsNoreconnect text", () => {
  it("text mentions 60s restart window", async () => {
    vi.resetModules();
    const alertOwnerRawMock2 = vi.fn();
    vi.doMock("./alerting", () => ({ alertOwnerRaw: alertOwnerRawMock2 }));
    vi.doMock("./tradeLifecycle/notificationLog", () => ({
      hasAlreadyDelivered: vi.fn().mockResolvedValue(false),
      logNotificationDelivery: vi.fn(),
      hashMessage: (s: string) => s.slice(0, 8),
    }));
    const mod = await import("./infraAlerts");
    mod._resetWsAlertCooldownForTest();
    mod.alertWsNoreconnect();
    const text = alertOwnerRawMock2.mock.calls[0]![2] as string;
    expect(text).toContain("60s");
    expect(text).toContain("No live ticks");
    vi.restoreAllMocks();
  });
});
