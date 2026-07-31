/**
 * notification_delivery_log — DB-backed notification idempotency and dedup.
 *
 * Prevents the same lifecycle event from being sent twice to the same
 * Telegram destination, even across process restarts or multi-worker deployments.
 *
 * Table created via raw SQL (not drizzle-kit) — consistent with daily_report_runs.
 *
 * Dedup key: domain + eventType + (orderId | signalId | paperTradeId) + destination
 *
 * Rules:
 *   – Same lifecycle event cannot be sent twice to the same channel.
 *   – Same symbol CAN alert again only with a NEW canonical event ID.
 *   – ENTRY and EXIT events are separate lifecycle points — separate dedup.
 *   – Failed sends retry (not logged as SENT until actual delivery).
 *   – messageHash change does NOT bypass lifecycle dedup.
 *
 * ABSOLUTE RULES:
 *   – No trading logic. No Kite calls. No signal changes.
 *   – CREATE TABLE IF NOT EXISTS only — never DROP or ALTER destructively.
 *   – Fail-open: if DB is unavailable, dedup is skipped (prefer missed-dedup over silent-block).
 */

import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../logger";
import type {
  CanonicalTradeEvent,
  NotificationDeliveryEntry,
  NotificationDestination,
  TradeAlertEventType,
  TradeDomain,
} from "./types";

// ── Table init ─────────────────────────────────────────────────────────────────

const TABLE_DDL = sql`
  CREATE TABLE IF NOT EXISTS notification_delivery_log (
    id              TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
    event_id        TEXT        NOT NULL,
    domain          TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    signal_id       TEXT,
    order_id        TEXT,
    paper_trade_id  TEXT,
    symbol          TEXT        NOT NULL,
    exchange        TEXT        NOT NULL,
    destination     TEXT        NOT NULL,
    message_hash    TEXT        NOT NULL,
    status          TEXT        NOT NULL,
    error_code      TEXT,
    error_message   TEXT,
    sent_at         TIMESTAMPTZ,
    environment     TEXT        NOT NULL DEFAULT 'production',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id)
  )
`;

const INDEX_DDL = sql`
  CREATE INDEX IF NOT EXISTS ndl_dedup_idx
    ON notification_delivery_log (domain, event_type, destination,
                                  COALESCE(order_id, signal_id, paper_trade_id, event_id))
`;

let tableReady = false;

/**
 * Ensure the notification_delivery_log table and index exist.
 * Safe to call multiple times — idempotent via IF NOT EXISTS.
 * Called once at server startup.
 */
export async function initNotificationLog(): Promise<void> {
  try {
    await db.execute(TABLE_DDL);
    await db.execute(INDEX_DDL);
    tableReady = true;
    logger.info("notificationLog: notification_delivery_log table ready");
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "notificationLog: failed to ensure notification_delivery_log table — dedup will be skipped",
    );
  }
}

// Self-init at module load — same pattern as dailyReports.ts
// Guard: skip in test environment (NODE_ENV=test set by vitest) to prevent
// pg.Pool connection attempts in the normal test suite (P0.1B tripwire).
if (process.env['NODE_ENV'] !== 'test') {
  void (async () => {
    try {
      await db.execute(TABLE_DDL);
      await db.execute(INDEX_DDL);
      tableReady = true;
    } catch {
      // Non-fatal; tableReady stays false → dedup skipped (fail-open)
    }
  })();
}

// ── Hash ───────────────────────────────────────────────────────────────────────

/** SHA-256 hash of the message text (first 16 hex chars). */
export function hashMessage(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ── Dedup key ─────────────────────────────────────────────────────────────────

/**
 * The dedup key for a notification delivery.
 * Uses the most specific ID available: orderId > paperTradeId > signalId > eventId.
 */
export function buildDedupKey(
  domain: TradeDomain,
  eventType: TradeAlertEventType,
  event: Pick<CanonicalTradeEvent, "orderId" | "paperTradeId" | "signalId" | "id">,
  destination: NotificationDestination,
): string {
  const specificId = event.orderId ?? event.paperTradeId ?? event.signalId ?? event.id;
  return `${domain}::${eventType}::${specificId}::${destination}`;
}

// ── Check dedup ────────────────────────────────────────────────────────────────

/**
 * Returns true if a SENT notification already exists for this dedup key.
 * Fails open (returns false) when the DB is unavailable.
 *
 * Callers should pass the result to ValidationContext.isDuplicate.
 */
export async function hasAlreadyDelivered(
  domain: TradeDomain,
  eventType: TradeAlertEventType,
  event: Pick<CanonicalTradeEvent, "orderId" | "paperTradeId" | "signalId" | "id">,
  destination: NotificationDestination,
): Promise<boolean> {
  if (!tableReady) return false;
  const specificId = event.orderId ?? event.paperTradeId ?? event.signalId ?? event.id;
  try {
    const result = await db.execute(sql`
      SELECT 1 FROM notification_delivery_log
      WHERE domain      = ${domain}
        AND event_type  = ${eventType}
        AND destination = ${destination}
        AND COALESCE(order_id, signal_id, paper_trade_id, event_id) = ${specificId}
        AND status      = 'SENT'
      LIMIT 1
    `);
    return (result.rows?.length ?? 0) > 0;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, domain, eventType, specificId },
      "notificationLog: dedup check failed (fail-open)",
    );
    return false;
  }
}

// ── Log delivery ───────────────────────────────────────────────────────────────

/**
 * Write a delivery record to notification_delivery_log.
 * Fire-and-forget safe — never throws. Returns the row id on success.
 */
export async function logNotificationDelivery(
  entry: NotificationDeliveryEntry,
): Promise<string | null> {
  if (!tableReady) return null;
  try {
    const result = await db.execute(sql`
      INSERT INTO notification_delivery_log (
        event_id, domain, event_type, signal_id, order_id, paper_trade_id,
        symbol, exchange, destination, message_hash, status,
        error_code, error_message, sent_at, environment
      ) VALUES (
        ${entry.eventId},
        ${entry.domain},
        ${entry.eventType},
        ${entry.signalId},
        ${entry.orderId},
        ${entry.paperTradeId},
        ${entry.symbol},
        ${entry.exchange},
        ${entry.destination},
        ${entry.messageHash},
        ${entry.status},
        ${entry.errorCode},
        ${entry.errorMessage},
        ${entry.sentAt ? new Date(entry.sentAt) : null},
        ${entry.environment}
      )
      RETURNING id
    `);
    return (result.rows?.[0] as { id?: string } | undefined)?.id ?? null;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, eventId: entry.eventId, domain: entry.domain },
      "notificationLog: failed to write delivery record (non-fatal)",
    );
    return null;
  }
}

/**
 * Mark an existing delivery record as FAILED (e.g. Telegram returned an error).
 * Best-effort — never throws.
 */
export async function markDeliveryFailed(
  eventId: string,
  destination: NotificationDestination,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  if (!tableReady) return;
  try {
    await db.execute(sql`
      UPDATE notification_delivery_log
      SET status        = 'FAILED',
          error_code    = ${errorCode},
          error_message = ${errorMessage}
      WHERE event_id   = ${eventId}
        AND destination = ${destination}
        AND status      = 'SENT'
    `);
  } catch {
    // Non-fatal
  }
}

// ── Convenience: full gate + log ───────────────────────────────────────────────

/**
 * Check dedup and log the result in one call.
 *
 * Returns:
 *   { shouldSend: true }  — not a duplicate, safe to send
 *   { shouldSend: false } — duplicate found, skip send
 *
 * Logs a DUPLICATE entry to notification_delivery_log when blocked.
 */
export async function gateAndLogDedup(
  event: CanonicalTradeEvent,
  destination: NotificationDestination,
  messageText: string,
): Promise<{ shouldSend: boolean }> {
  const isDuplicate = await hasAlreadyDelivered(
    event.domain,
    event.eventType,
    event,
    destination,
  );

  if (isDuplicate) {
    void logNotificationDelivery({
      eventId:      event.id,
      domain:       event.domain,
      eventType:    event.eventType,
      signalId:     event.signalId,
      orderId:      event.orderId,
      paperTradeId: event.paperTradeId,
      symbol:       event.symbol,
      exchange:     event.exchange,
      destination,
      messageHash:  hashMessage(messageText),
      status:       "DUPLICATE",
      errorCode:    "DUPLICATE_EVENT",
      errorMessage: "Already delivered — skipping",
      sentAt:       null,
      environment:  event.environment,
    });
    return { shouldSend: false };
  }

  return { shouldSend: true };
}
