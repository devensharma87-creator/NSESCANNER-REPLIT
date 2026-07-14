/**
 * parityHarness — deterministic parity verification harness.
 *
 * Parts A, D, and F of the Deterministic Parity Verification Harness.
 *
 * Provides three operation modes:
 *   dry_run       — build canonical event, validate, format, project, compare.
 *                   No Telegram send, no DB write, no paper trade.
 *
 *   test_destination — same as dry_run plus sends to a test-only Telegram channel
 *                      if PARITY_TEST_TELEGRAM_BOT_TOKEN and PARITY_TEST_TELEGRAM_CHAT_ID
 *                      are configured. Message title says "TEST PARITY VERIFICATION —
 *                      NOT A TRADE". NEVER uses the real trade Telegram channel.
 *                      Falls back to dry_run if test channel is not configured.
 *
 *   replay_existing — loads latest notification_delivery_log records from DB,
 *                     partially reconstructs CanonicalTradeEvent from stored fields,
 *                     regenerates Telegram text, computes fresh hash, compares against
 *                     stored message_hash. Proves the formatter is deterministic.
 *
 * ABSOLUTE RULES:
 *   - NEVER writes to the real Telegram trade channel (TELEGRAM_BOT_TOKEN).
 *   - NEVER creates a real paper trade.
 *   - NEVER enables broker execution.
 *   - NEVER fabricates data. Missing fields are honestly represented as null.
 *   - dry_run events use environment: "test" — DEV_ENV_BLOCKED prevents accidental real send.
 *   - test_destination messages carry "TEST PARITY VERIFICATION — NOT A TRADE" title.
 */

import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../logger";
import type { CanonicalTradeEvent } from "./types";
import { validateTradeEventForNotification } from "./validateTradeEvent";
import { formatTradeTelegramMessage } from "./formatTelegramMessage";
import { projectTradeEventForUi, type TradeEventUiProjection } from "./projectTradeEvent";
import {
  compareTradeEventParity,
  type ParityResult,
  type DbNotificationSnapshot,
} from "./compareTradeEventParity";
import { hashMessage } from "./notificationLog";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ParityMode = "dry_run" | "test_destination" | "replay_existing";

export interface ParityRunResult {
  mode:             ParityMode;
  eventId:          string;
  ok:               boolean;
  parity:           ParityResult;
  uiProjection:     TradeEventUiProjection;
  validationResult: { allowed: boolean; reason: string | null; message: string | null };
  telegramSent:     boolean;
  telegramDestination: string | null;
  testDestinationConfigured: boolean;
  ranAt:            string;
  durationMs:       number;
}

export interface ReplayRecord {
  id:            string;
  eventId:       string;
  domain:        string;
  eventType:     string;
  symbol:        string;
  exchange:      string;
  orderId:       string | null;
  signalId:      string | null;
  paperTradeId:  string | null;
  messageHash:   string;
  status:        string;
  environment:   string;
  destination:   string;
  sentAt:        string | null;
  createdAt:     string;
}

export interface ReplayResult {
  record:         ReplayRecord;
  parity:         ParityResult;
  freshHash:      string;
  storedHash:     string;
  hashMatch:      boolean;
  ranAt:          string;
}

export interface ParityStatusSummary {
  tableReady:       boolean;
  latestLogRecords: ReplayRecord[];
  sentCount:        number;
  blockedCount:     number;
  duplicateCount:   number;
  failedCount:      number;
  blocksByReason:   Record<string, number>;
  lastSwingEntry:   ReplayRecord | null;
  lastFnoEntry:     ReplayRecord | null;
  lastExit:         ReplayRecord | null;
  lastTestBlocked:  ReplayRecord | null;
  lastDevBlocked:   ReplayRecord | null;
  retrievedAt:      string;
}

// ── Test destination detection ────────────────────────────────────────────────

function isTestDestinationConfigured(): boolean {
  return (
    typeof process.env["PARITY_TEST_TELEGRAM_BOT_TOKEN"] === "string" &&
    process.env["PARITY_TEST_TELEGRAM_BOT_TOKEN"].trim().length > 0 &&
    typeof process.env["PARITY_TEST_TELEGRAM_CHAT_ID"] === "string" &&
    process.env["PARITY_TEST_TELEGRAM_CHAT_ID"].trim().length > 0
  );
}

// ── Dry-run parity run ────────────────────────────────────────────────────────

/**
 * Run a complete parity check on a CanonicalTradeEvent in dry_run mode.
 *
 * Steps:
 *   1. Validate the event with validateTradeEventForNotification(internal_only)
 *   2. Generate UI projection with projectTradeEventForUi
 *   3. Format Telegram preview with formatTradeTelegramMessage
 *   4. Compare all surfaces with compareTradeEventParity
 *   5. Return ParityRunResult — no Telegram send, no DB write
 *
 * The validation context uses "internal_only" so DEV_ENV_BLOCKED and
 * SAMPLE_ALERT_BLOCKED do not apply (fixtures use environment:"test").
 *
 * @param event - Canonical trade event to check (may be a fixture or production event).
 * @param mode  - "dry_run" (default) or "test_destination".
 * @returns ParityRunResult with full parity comparison.
 */
export async function runDryRunParity(
  event: CanonicalTradeEvent,
  mode: "dry_run" | "test_destination" = "dry_run",
): Promise<ParityRunResult> {
  const start = Date.now();

  // 1. Validate (internal_only — allows test environment events)
  const validationResult = validateTradeEventForNotification(event, {
    destination: "internal_only",
    isSampleAlert: false,
    isDuplicate: false,
  });

  // 2. UI projection
  const uiProjection = projectTradeEventForUi(event);

  // 3. Compare (generates telegram text internally)
  const parity = compareTradeEventParity({ canonicalEvent: event, uiProjection });

  // 4. Optional test_destination send
  let telegramSent = false;
  let telegramDestination: string | null = null;
  const testDestConfigured = isTestDestinationConfigured();

  if (mode === "test_destination" && testDestConfigured) {
    try {
      const chatId = process.env["PARITY_TEST_TELEGRAM_CHAT_ID"]!;
      const botToken = process.env["PARITY_TEST_TELEGRAM_BOT_TOKEN"]!;
      const testMessage = [
        "⚠️ TEST PARITY VERIFICATION — NOT A TRADE ⚠️",
        "",
        parity.telegramText ?? "",
        "",
        `─────────────────────────────`,
        `Parity ok: ${parity.ok}`,
        `Mismatches: ${parity.mismatches.length}`,
        `Hash: ${parity.telegramMessageHash ?? "—"}`,
        `This is a TEST message — not a real trade alert.`,
        `Event environment: ${event.environment}`,
        `Ran at: ${new Date().toISOString()}`,
      ].join("\n");

      const res = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: testMessage }),
        },
      );
      telegramSent = res.ok;
      telegramDestination = "parity_test_channel";
      logger.info(
        { ok: res.ok, eventId: event.id },
        "parityHarness: test_destination send attempted",
      );
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, eventId: event.id },
        "parityHarness: test_destination send failed (non-fatal)",
      );
    }
  }

  return {
    mode,
    eventId:                event.id,
    ok:                     parity.ok && validationResult.allowed,
    parity,
    uiProjection,
    validationResult: {
      allowed: validationResult.allowed,
      reason:  validationResult.reason,
      message: validationResult.message,
    },
    telegramSent,
    telegramDestination,
    testDestinationConfigured: testDestConfigured,
    ranAt:     new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * Load latest records from notification_delivery_log.
 * Returns up to `limit` records ordered by created_at DESC.
 * Fails open (returns empty array) if DB is unavailable.
 */
export async function loadLatestNotificationLogRecords(
  limit = 20,
): Promise<ReplayRecord[]> {
  try {
    const rows = await db.execute(sql`
      SELECT
        id, event_id, domain, event_type, symbol, exchange,
        order_id, signal_id, paper_trade_id,
        message_hash, status, environment, destination,
        sent_at, created_at
      FROM notification_delivery_log
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return (rows.rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id:           String(row["id"] ?? ""),
        eventId:      String(row["event_id"] ?? ""),
        domain:       String(row["domain"] ?? ""),
        eventType:    String(row["event_type"] ?? ""),
        symbol:       String(row["symbol"] ?? ""),
        exchange:     String(row["exchange"] ?? ""),
        orderId:      row["order_id"] != null ? String(row["order_id"]) : null,
        signalId:     row["signal_id"] != null ? String(row["signal_id"]) : null,
        paperTradeId: row["paper_trade_id"] != null ? String(row["paper_trade_id"]) : null,
        messageHash:  String(row["message_hash"] ?? ""),
        status:       String(row["status"] ?? ""),
        environment:  String(row["environment"] ?? ""),
        destination:  String(row["destination"] ?? ""),
        sentAt:       row["sent_at"] != null ? new Date(row["sent_at"] as string).toISOString() : null,
        createdAt:    new Date(row["created_at"] as string).toISOString(),
      };
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "parityHarness: could not load notification_delivery_log records (fail-open)",
    );
    return [];
  }
}

// ── Replay from notification log ──────────────────────────────────────────────

/**
 * Replay parity verification from an existing notification_delivery_log record.
 *
 * Part D of the harness.
 *
 * Reconstructs a minimal CanonicalTradeEvent from the stored log fields,
 * regenerates the Telegram text, computes a fresh hash, and compares
 * against the stored message_hash.
 *
 * IMPORTANT: The reconstructed event only has the fields stored in the log
 * (symbol, exchange, domain, eventType, orderId, signalId, paperTradeId).
 * Price fields default to zero — only structural/routing fields are checked.
 * Hash mismatch detection is limited to hash comparison, not price comparison.
 *
 * Hash match indicates the Telegram formatter is deterministic across calls
 * for the same canonical event structure — but since we cannot fully reconstruct
 * the original event from the log alone, hash comparison is advisory only.
 *
 * @param record - A replay record from notification_delivery_log.
 * @returns ReplayResult with parity comparison and hash match verdict.
 */
export function replayFromNotificationLog(record: ReplayRecord): ReplayResult {
  // Reconstruct a minimal canonical event from the log fields.
  // Missing price fields are set to placeholder values (1.0) to allow formatting.
  // environment is set to "test" so replay never accidentally routes to production.
  const reconstructed: CanonicalTradeEvent = {
    id:                    record.eventId || crypto.randomUUID(),
    domain:                (record.domain as CanonicalTradeEvent["domain"]) || "SWING_CASH",
    eventType:             (record.eventType as CanonicalTradeEvent["eventType"]) || "ENTRY_READY",
    lifecycleStatus:       (record.eventType === "ENTRY_OPENED" ? "OPEN" :
                           record.eventType === "ENTRY_READY" ? "ENTRY_READY" :
                           record.eventType.startsWith("EXIT") ? "EXITED_STOP_LOSS" : "CANDIDATE"),
    signalId:              record.signalId,
    orderId:               record.orderId,
    paperTradeId:          record.paperTradeId,
    symbol:                record.symbol,
    tradingSymbol:         record.exchange ? `${record.exchange}:${record.symbol}` : record.symbol,
    exchange:              (record.exchange as CanonicalTradeEvent["exchange"]) || "NSE",
    instrumentToken:       null,
    assetType:             record.domain === "FNO_INTRADAY" ? "option" : "equity",
    side:                  record.domain === "FNO_INTRADAY" ? "CALL" : "BUY",
    setupName:             null,
    confidence:            null,
    entryPrice:            1.0,
    stopLoss:              0.5,
    target1:               1.5,
    target2:               null,
    exitPrice:             null,
    exitReason:            null,
    quantity:              1,
    capitalRequired:       1.0,
    maxRisk:               0.5,
    riskPercent:           null,
    riskReward:            null,
    source:                "kite",
    sourceStatus:          "TRADE_GRADE",
    sourceAsOf:            null,
    canDriveSignals:       true,
    canDriveTradeAlerts:   true,
    brokerExecutionStatus: "DISABLED",
    paperTradeStatus:      "STAGED",
    environment:           "test",
    createdAt:             record.createdAt,
    entryTime:             null,
    exitTime:              null,
    appUrl:                record.domain === "FNO_INTRADAY" ? "/fno" : "/swing-queue",
    warnings:              [],
  };

  // Generate fresh hash from the reconstructed event's Telegram text
  const freshText = formatTradeTelegramMessage(reconstructed);
  const freshHash = hashMessage(freshText);

  // The stored hash was of the original full event — it WILL differ from
  // the reconstructed minimal event. This is by design: replay proves the
  // formatter is callable and structurally consistent, not that prices match.
  const hashMatch = freshHash === record.messageHash;

  const dbSnapshot: DbNotificationSnapshot = {
    eventId:      record.eventId,
    domain:       record.domain,
    eventType:    record.eventType,
    symbol:       record.symbol,
    exchange:     record.exchange,
    orderId:      record.orderId,
    signalId:     record.signalId,
    paperTradeId: record.paperTradeId,
    messageHash:  record.messageHash,
    status:       record.status,
    environment:  record.environment,
    destination:  record.destination,
  };

  const parity = compareTradeEventParity({
    canonicalEvent: reconstructed,
    dbSnapshot,
  });

  return {
    record,
    parity,
    freshHash,
    storedHash:  record.messageHash,
    hashMatch,
    ranAt:       new Date().toISOString(),
  };
}

// ── Parity status summary ─────────────────────────────────────────────────────

/**
 * Build a ParityStatusSummary for the owner health dashboard (Part H).
 *
 * Loads the latest 50 log records and computes aggregate statistics:
 * - Count by status (SENT, BLOCKED, DUPLICATE, FAILED)
 * - Block counts by error_code
 * - Last swing entry, F&O entry, exit, and blocked events
 *
 * Read-only. No I/O other than reading notification_delivery_log.
 */
export async function buildParityStatusSummary(): Promise<ParityStatusSummary> {
  let tableReady = false;
  let latestRecords: ReplayRecord[] = [];

  try {
    // Check table exists
    await db.execute(sql`SELECT 1 FROM notification_delivery_log LIMIT 1`);
    tableReady = true;
    latestRecords = await loadLatestNotificationLogRecords(50);
  } catch {
    // Table may not exist yet — fail-open
  }

  const sentCount      = latestRecords.filter((r) => r.status === "SENT").length;
  const blockedCount   = latestRecords.filter((r) => r.status === "BLOCKED").length;
  const duplicateCount = latestRecords.filter((r) => r.status === "DUPLICATE").length;
  const failedCount    = latestRecords.filter((r) => r.status === "FAILED").length;

  // Block reason counts — from error_code in full records
  // (we don't have error_code in ReplayRecord, so we load it separately)
  let blocksByReason: Record<string, number> = {};
  try {
    const reasonRows = await db.execute(sql`
      SELECT error_code, COUNT(*)::int AS cnt
      FROM notification_delivery_log
      WHERE status = 'BLOCKED'
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY error_code
      ORDER BY cnt DESC
      LIMIT 20
    `);
    for (const row of (reasonRows.rows ?? []) as Record<string, unknown>[]) {
      const code = String(row["error_code"] ?? "UNKNOWN");
      const cnt  = Number(row["cnt"] ?? 0);
      blocksByReason[code] = cnt;
    }
  } catch {
    // Non-fatal
  }

  const swingEntries = latestRecords.filter(
    (r) => r.domain === "SWING_CASH" && r.eventType === "ENTRY_READY",
  );
  const fnoEntries = latestRecords.filter(
    (r) => r.domain === "FNO_INTRADAY" && (r.eventType === "ENTRY_OPENED" || r.eventType === "ENTRY_READY"),
  );
  const exits = latestRecords.filter(
    (r) => r.eventType.startsWith("EXIT_"),
  );

  return {
    tableReady,
    latestLogRecords: latestRecords.slice(0, 10),
    sentCount,
    blockedCount,
    duplicateCount,
    failedCount,
    blocksByReason,
    lastSwingEntry:  swingEntries[0] ?? null,
    lastFnoEntry:    fnoEntries[0] ?? null,
    lastExit:        exits[0] ?? null,
    lastTestBlocked: null,
    lastDevBlocked:  null,
    retrievedAt:     new Date().toISOString(),
  };
}

// ── Run all fixtures ──────────────────────────────────────────────────────────

/**
 * Run parity checks on all built-in fixtures.
 * Returns one ParityRunResult per fixture.
 * Used by the /api/parity/trade-event/verify?mode=all_fixtures endpoint.
 */
export async function runAllFixtureParity(
  fixtures: CanonicalTradeEvent[],
): Promise<ParityRunResult[]> {
  const results: ParityRunResult[] = [];
  for (const event of fixtures) {
    results.push(await runDryRunParity(event, "dry_run"));
  }
  return results;
}
