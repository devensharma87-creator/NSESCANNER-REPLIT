/**
 * Operational infra alerts — DD latch, BASELINE lane lock, WS disconnect.
 *
 * These are NOT trade lifecycle events (no paper trade opened/closed), so
 * they live outside fnoSignalAlerts.ts. They use the notification_delivery_log
 * for DB-backed dedup (DD latch + BASELINE lock) or in-memory rate limiting
 * (WS disconnect, per task spec).
 *
 * ABSOLUTE RULES:
 *   – No trading logic. No signal changes. No broker execution.
 *   – Fail-open on any alert path — never throws, never blocks callers.
 *   – alertOwnerRaw (default 1h in-memory dedup) + DB dedup = layered defence.
 */

import { alertOwnerRaw } from "./alerting";
import { logger } from "./logger";
import {
  hasAlreadyDelivered,
  logNotificationDelivery,
  hashMessage,
} from "./tradeLifecycle/notificationLog";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getEnv(): "production" | "development" | "test" {
  const e = process.env["NODE_ENV"];
  return e === "production" ? "production" : e === "test" ? "test" : "development";
}

// ── WS disconnect (in-memory rate limit, no DB dedup) ─────────────────────────

let lastWsAlertMs = 0;
const WS_ALERT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fire a Telegram alert when Kite WS auto-reconnect is exhausted.
 * Rate-limited to at most once per 10 minutes (in-memory).
 * Never throws — safe to call from noreconnect handler.
 */
export function alertWsNoreconnect(): void {
  const now = Date.now();
  if (now - lastWsAlertMs < WS_ALERT_COOLDOWN_MS) return;
  lastWsAlertMs = now;
  const text = [
    "⚠️ KITE WS DISCONNECTED — Auto-reconnect exhausted",
    "Scheduling restart in 60s. No live ticks during this window.",
  ].join("\n");
  alertOwnerRaw(
    "KITE_WS_NORECONNECT",
    "Kite WS noreconnect — scheduling 60s restart",
    text,
    0,
  );
}

/** Reset the in-memory WS alert cooldown (test helper). */
export function _resetWsAlertCooldownForTest(): void {
  lastWsAlertMs = 0;
}

/** Return the cooldown constant (test helper). */
export function _getWsAlertCooldownMs(): number {
  return WS_ALERT_COOLDOWN_MS;
}

// ── DD latch alert (DB dedup) ─────────────────────────────────────────────────

/**
 * Minimal shape of a DrawdownReading — avoids importing from paperAccount.ts
 * (which would create a runtime dependency chain at module load).
 */
export interface DdReadingSlice {
  drawdownPct: number;
  capPct: number;
  realisedPnl: number;
  windowStart: string;
}

/**
 * Fire a Telegram alert when the daily or weekly F&O DD cap is hit for the
 * FIRST TIME this window.  DB dedup prevents re-fires across process restarts.
 * Never throws — safe to call from the openPaperTrade path.
 */
export async function alertDdLatchFired(
  type: "DAILY" | "WEEKLY",
  reading: DdReadingSlice,
): Promise<void> {
  try {
    const eventType = type === "DAILY" ? "DD_LATCH_DAILY" as const : "DD_LATCH_WEEKLY" as const;
    const eventId = `dd_latch_${type.toLowerCase()}_${reading.windowStart}`;

    const isDuplicate = await hasAlreadyDelivered(
      "FNO_INTRADAY",
      eventType,
      { id: eventId, orderId: null, paperTradeId: null, signalId: null },
      "telegram_main",
    );
    if (isDuplicate) return;

    const lossRs = Math.abs(reading.realisedPnl);
    const latchLabel = type === "DAILY" ? "today" : "this week";
    const text = [
      `🛑 DD LATCH TRIGGERED — ${type}`,
      `Realised loss: ₹${lossRs.toFixed(0)} (cap: ${(reading.capPct * 100).toFixed(1)}%)`,
      `No new F&O opens for ${latchLabel}.`,
    ].join("\n");

    void logNotificationDelivery({
      eventId,
      domain: "FNO_INTRADAY",
      eventType,
      signalId: null,
      orderId: null,
      paperTradeId: null,
      symbol: "SYSTEM",
      exchange: "INDEX",
      destination: "telegram_main",
      messageHash: hashMessage(text),
      status: "SENT",
      errorCode: null,
      errorMessage: null,
      sentAt: new Date().toISOString(),
      environment: getEnv(),
    });

    alertOwnerRaw(eventId, `DD latch fired: ${type} ${reading.windowStart}`, text);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, type },
      "infraAlerts: alertDdLatchFired failed (non-fatal)",
    );
  }
}

// ── BASELINE lane lock alert (DB dedup) ───────────────────────────────────────

/**
 * Fire a Telegram alert when 2 consecutive BASELINE stops trigger the day-lock.
 * DB dedup (baseline_lock + istDate) prevents re-firing within the same day
 * across restarts. Never throws.
 */
export async function alertBaselineLaneLocked(istDate: string): Promise<void> {
  try {
    const eventId = `baseline_lock_${istDate}`;

    const isDuplicate = await hasAlreadyDelivered(
      "FNO_INTRADAY",
      "BASELINE_LANE_LOCKED",
      { id: eventId, orderId: null, paperTradeId: null, signalId: null },
      "telegram_main",
    );
    if (isDuplicate) return;

    const text = [
      "⚠️ BASELINE LANE LOCKED for today",
      "2 consecutive stops hit. BASELINE sub-lane closed for the day.",
      "HC trades unaffected.",
    ].join("\n");

    void logNotificationDelivery({
      eventId,
      domain: "FNO_INTRADAY",
      eventType: "BASELINE_LANE_LOCKED",
      signalId: null,
      orderId: null,
      paperTradeId: null,
      symbol: "SYSTEM",
      exchange: "INDEX",
      destination: "telegram_main",
      messageHash: hashMessage(text),
      status: "SENT",
      errorCode: null,
      errorMessage: null,
      sentAt: new Date().toISOString(),
      environment: getEnv(),
    });

    alertOwnerRaw(eventId, `BASELINE lane locked: ${istDate}`, text);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, istDate },
      "infraAlerts: alertBaselineLaneLocked failed (non-fatal)",
    );
  }
}
