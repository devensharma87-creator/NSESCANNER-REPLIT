/**
 * Swing Cash staged-order owner alerts — canonical pipeline.
 *
 * WIRING (2026-07-02):
 *   alertSwingOrderStaged → CanonicalTradeEvent → validateTradeEventForNotification
 *   → DB dedup (gateAndLogDedup) → formatTradeTelegramMessage → alertOwnerRaw
 *
 * WHAT SENDS TO TELEGRAM (trade channel):
 *   • alertSwingOrderStaged (STAGED or APPROVAL_REQUIRED) → ONE ENTRY_READY alert
 *
 * WHAT DOES NOT SEND TO TELEGRAM:
 *   • alertSwingOrderExpired   — lifecycle-only, informational, no trade action
 *   • alertSwingOrderRejected  — lifecycle-only, informational, no trade action
 *   • alertSwingOrderApprovedDryRun — dry-run is not a real trade open
 *   • alertSwingOrderBlockedByRisk  — not trade-channel-worthy
 *
 * All blocked non-trade events are logged via logger.info for observability.
 *
 * ABSOLUTE RULES:
 *   - Fire-and-forget only. Never throws. Never rolls back a DB write.
 *   - Broker execution is hard-disabled; message always says so.
 *   - Never log secrets, tokens, or session data.
 *   - No signal/scoring/risk logic changes — alerting only.
 *   - TEST_SYMBOL_BLOCKED and DEV_ENV_BLOCKED guard all production paths.
 */

import crypto from "crypto";
import { alertOwnerRaw } from "./alerting";
import type { AlertRecord } from "./alerting";
import { logger } from "./logger";
import type { SwingOrderStagingRow } from "@workspace/db/schema";
import { validateTradeEventForNotification } from "./tradeLifecycle/validateTradeEvent";
import { formatTradeTelegramMessage } from "./tradeLifecycle/formatTelegramMessage";
import {
  hasAlreadyDelivered,
  logNotificationDelivery,
  hashMessage,
} from "./tradeLifecycle/notificationLog";
import type {
  CanonicalTradeEvent,
  NotificationDestination,
} from "./tradeLifecycle/types";

// ── Dedup windows ─────────────────────────────────────────────────────────────

/** 15 min in-memory dedup per staged-order (keyed by canonical order id). */
const SWING_ORDER_DEDUP_MS = 15 * 60 * 1000;

/**
 * In-process dedup map — tracks orderId → timestamp of last dispatch.
 * Guards against rapid duplicate calls (e.g. re-staging the same order).
 * Cleared by resetLastSwingAlertRecord() in tests / process restart.
 */
const recentlyDispatchedMs = new Map<string, number>();

// ── Destination ───────────────────────────────────────────────────────────────

const DEST: NotificationDestination = "telegram_main";

// ── Last swing alert record (separate from F&O lastAlertRecord) ───────────────

let lastSwingAlertRecord: AlertRecord | null = null;

/** Returns a copy of the most recent swing alert record (no secrets). */
export function getLastSwingAlertRecord(): AlertRecord | null {
  return lastSwingAlertRecord ? { ...lastSwingAlertRecord } : null;
}

/** Reset last swing alert record and in-process dedup map (tests / startup). */
export function resetLastSwingAlertRecord(): void {
  lastSwingAlertRecord = null;
  recentlyDispatchedMs.clear();
}

// ── Pure message formatters (kept for tests / backward compatibility) ──────────

function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function deriveRr(entry: number, stop: number, target: number): string {
  const risk = entry - stop;
  if (risk <= 0) return "n/a";
  return ((target - entry) / risk).toFixed(2);
}

function fmtDataAge(dataAsOf: Date | null): string {
  if (!dataAsOf) return "unavailable";
  try {
    return dataAsOf.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " IST";
  } catch {
    return "unavailable";
  }
}

const EVENT_LABEL: Record<string, string> = {
  SWING_ORDER_STAGED: "Order staged for approval",
  SWING_ORDER_APPROVAL_REQUIRED: "Manual approval required",
  SWING_ORDER_EXPIRED: "Staged order expired (missed opportunity)",
  SWING_ORDER_REJECTED: "Order rejected",
  SWING_ORDER_APPROVED_DRY_RUN: "Order approved \u2014 dry-run recorded",
  SWING_ORDER_BLOCKED_BY_RISK: "Staging blocked by risk guard",
};

/**
 * Build the Telegram message text for a staged-order event.
 * Pure function — kept for test coverage and backward compatibility.
 * The production alert path now uses formatTradeTelegramMessage(CanonicalTradeEvent).
 */
export function buildSwingOrderText(event: string, row: SwingOrderStagingRow): string {
  const label = EVENT_LABEL[event] ?? event;
  const rr = deriveRr(row.entryPrice, row.stopLoss, row.target1);
  const target2Line =
    row.target2 != null
      ? `Target 2: ${inr(row.target2)}`
      : null;

  const lines: string[] = [
    "\uD83D\uDCCC SWING CASH ALERT",
    "",
    `Event: ${label}`,
    `Symbol: ${row.symbol}`,
    `Setup: ${row.setupKey ?? "n/a"}`,
    `Entry: ${inr(row.entryPrice)}`,
    `SL: ${inr(row.stopLoss)}`,
    [
      `Target 1: ${inr(row.target1)}`,
      ...(target2Line ? [target2Line] : []),
    ].join("  "),
    `R:R: ${rr}  Qty: ${row.quantity}  Risk: ${row.riskPercent.toFixed(2)}%`,
    `Capital: ${inr(row.capitalRequired)}  Max Risk: ${inr(row.maxRisk)}`,
    `Sector: ${row.sector ?? "n/a"}`,
    `Risk eval: ${row.dataSource} (as of ${fmtDataAge(row.dataAsOf)})`,
    "Note: Entry is the staged limit order price — not current market price",
    "Status: Broker execution DISABLED",
    "Action: Review in Swing Live Queue",
  ];
  return lines.join("\n");
}

/**
 * Build the Telegram message for a BLOCKED_BY_RISK event (no DB row available).
 */
export function buildSwingBlockedText(
  symbol: string,
  setupKey: string | null,
  blockedReasons: string[],
): string {
  const lines: string[] = [
    "\uD83D\uDCCC SWING CASH ALERT",
    "",
    `Event: ${EVENT_LABEL["SWING_ORDER_BLOCKED_BY_RISK"]}`,
    `Symbol: ${symbol}`,
    `Setup: ${setupKey ?? "n/a"}`,
    `Blocked by: ${blockedReasons.length ? blockedReasons.join(", ") : "risk guard"}`,
    "Status: Broker execution DISABLED",
    "Note: Order not stored \u2014 not actionable by owner",
  ];
  return lines.join("\n");
}

// ── Environment detection ─────────────────────────────────────────────────────

function deriveEnvironment(): "production" | "development" | "test" {
  const n = process.env["NODE_ENV"];
  if (n === "production") return "production";
  if (n === "test") return "test";
  return "development";
}

// ── Canonical RR helper ───────────────────────────────────────────────────────

function computeRr(entry: number, stop: number, target: number): number | null {
  const risk = entry - stop;
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const reward = target - entry;
  if (!Number.isFinite(reward)) return null;
  return reward / risk;
}

// ── Canonical event builder ───────────────────────────────────────────────────

/**
 * Build a CanonicalTradeEvent from a SwingOrderStagingRow for ENTRY_READY.
 *
 * Both STAGED and APPROVAL_REQUIRED status rows produce an ENTRY_READY event —
 * one canonical alert covers both lifecycle states (owner review either way).
 */
function buildSwingCanonicalEvent(row: SwingOrderStagingRow): CanonicalTradeEvent {
  const isKite = row.dataSource === "kite";
  const source: CanonicalTradeEvent["source"] = isKite ? "kite" : "missing";
  const sourceStatus: CanonicalTradeEvent["sourceStatus"] = isKite ? "TRADE_GRADE" : "UNAVAILABLE";
  const canDriveSignals = isKite;
  const canDriveTradeAlerts = canDriveSignals;

  const lifecycleStatus: CanonicalTradeEvent["lifecycleStatus"] =
    row.status === "APPROVAL_REQUIRED" ? "ENTRY_APPROVAL_REQUIRED" : "ENTRY_READY";

  const validExchanges = new Set(["NSE", "BSE", "NFO", "BFO", "INDEX"]);
  const exchange = (validExchanges.has(row.exchange ?? "") ? row.exchange : "NSE") as
    CanonicalTradeEvent["exchange"];

  const validSides = new Set(["BUY", "SELL", "CALL", "PUT"]);
  const side = (validSides.has(row.side ?? "") ? row.side : "BUY") as
    CanonicalTradeEvent["side"];

  return {
    id: crypto.randomUUID(),
    domain: "SWING_CASH",
    eventType: "ENTRY_READY",
    lifecycleStatus,
    signalId: row.signalId ?? null,
    orderId: row.id,
    paperTradeId: null,
    symbol: row.symbol,
    tradingSymbol: row.tradingSymbol ?? row.symbol,
    exchange,
    instrumentToken: row.instrumentToken ?? null,
    assetType: "equity",
    side,
    setupName: row.setupKey ?? null,
    confidence: null,
    entryPrice: row.entryPrice,
    stopLoss: row.stopLoss,
    target1: row.target1,
    target2: row.target2 ?? null,
    exitPrice: null,
    exitReason: null,
    quantity: row.quantity,
    capitalRequired: row.capitalRequired,
    maxRisk: row.maxRisk,
    riskPercent: row.riskPercent,
    riskReward: computeRr(row.entryPrice, row.stopLoss, row.target1),
    source,
    sourceStatus,
    sourceAsOf: row.dataAsOf?.toISOString() ?? null,
    canDriveSignals,
    canDriveTradeAlerts,
    brokerExecutionStatus: "DISABLED",
    paperTradeStatus: "STAGED",
    environment: deriveEnvironment(),
    createdAt: row.createdAt.toISOString(),
    entryTime: null,
    exitTime: null,
    appUrl: "/swing-queue",
    warnings: [],
  };
}

// ── Canonical dispatch ────────────────────────────────────────────────────────

/**
 * Fire the canonical ENTRY_READY alert pipeline for a Swing Cash staged order.
 *
 * Steps: validate → DB dedup → format → send → log delivery.
 * Safe-fail — never throws. All errors are caught and logged.
 *
 * Blocked events are logged at info level with the block reason.
 * The in-memory alertOwnerRaw dedup (SWING_ORDER_DEDUP_MS) provides a fast
 * first-line defense; DB dedup provides cross-restart idempotency.
 */
async function dispatchCanonicalEntry(event: CanonicalTradeEvent): Promise<void> {
  try {
    // 1. Canonical validation — blocks test env, test symbols, stale data, etc.
    const validation = validateTradeEventForNotification(event, { destination: DEST });
    if (!validation.allowed) {
      logger.info(
        { reason: validation.reason, symbol: event.symbol, orderId: event.orderId },
        `swingAlerts: ENTRY_READY blocked — ${validation.reason ?? "unknown"}`,
      );
      return;
    }

    // 2. DB-backed lifecycle dedup — prevents duplicate cross-restart sends.
    const isDuplicate = await hasAlreadyDelivered(
      event.domain,
      event.eventType,
      event,
      DEST,
    );
    if (isDuplicate) {
      logger.info(
        { orderId: event.orderId, symbol: event.symbol },
        "swingAlerts: ENTRY_READY skipped — already delivered (DB dedup)",
      );
      return;
    }

    // 3. Canonical format — single formatter for all trade events.
    const text = formatTradeTelegramMessage(event);

    // 4. Send via existing alertOwnerRaw infrastructure.
    //    In-memory dedup key prevents re-alert within SWING_ORDER_DEDUP_MS.
    const dedupKey = `SWING_ENTRY_READY::${event.orderId}`;
    const logMsg = `SWING ENTRY_READY: ${event.symbol} [${event.lifecycleStatus}] setup=${event.setupName ?? "n/a"}`;
    alertOwnerRaw(dedupKey, logMsg, text, SWING_ORDER_DEDUP_MS);

    // 5. Log delivery to notification_delivery_log (DB idempotency record).
    void logNotificationDelivery({
      eventId:      event.id,
      domain:       event.domain,
      eventType:    event.eventType,
      signalId:     event.signalId,
      orderId:      event.orderId,
      paperTradeId: event.paperTradeId,
      symbol:       event.symbol,
      exchange:     event.exchange,
      destination:  DEST,
      messageHash:  hashMessage(text),
      status:       "SENT",
      errorCode:    null,
      errorMessage: null,
      sentAt:       new Date().toISOString(),
      environment:  event.environment,
    });

    lastSwingAlertRecord = {
      event: "SWING_ENTRY_READY",
      at:    Date.now(),
      telegramStatus: "SENT",
    };
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message },
      "swingAlerts: dispatchCanonicalEntry unexpected error (safe-fail)",
    );
  }
}

// ── Public alert functions ────────────────────────────────────────────────────

/**
 * Alert when a swing order is staged (STAGED) or needs manual review
 * (APPROVAL_REQUIRED).
 *
 * Both statuses produce ONE canonical ENTRY_READY alert — there is no
 * separate "manual approval required" message. Owner reviews either way.
 *
 * Wired through the canonical pipeline:
 *   CanonicalTradeEvent → validate → DB dedup → format → send
 *
 * Blocked in: test environment, test symbols (TESTSTK), stale/Yahoo data.
 */
export function alertSwingOrderStaged(row: SwingOrderStagingRow): void {
  const event = buildSwingCanonicalEvent(row);
  // Synchronous in-process dedup: two rapid back-to-back calls for the same
  // order are blocked here before the async pipeline is queued.  The stamp is
  // set NOW (synchronously) so a second synchronous call sees it immediately.
  const dedupId = event.orderId ?? event.id;
  const lastSentAt = recentlyDispatchedMs.get(dedupId);
  if (lastSentAt !== undefined && Date.now() - lastSentAt < SWING_ORDER_DEDUP_MS) {
    logger.info({ orderId: dedupId }, "swingAlerts: ENTRY_READY skipped — in-process dedup");
    return;
  }
  recentlyDispatchedMs.set(dedupId, Date.now());
  void dispatchCanonicalEntry(event);
}

/**
 * Called when a staged order expires (TTL sweep or manual expire).
 *
 * EXPIRED is a lifecycle status change, not a trade-channel event.
 * No Telegram alert is sent — this avoids duplicate noise for orders
 * that already received an ENTRY_READY alert when staged.
 */
export function alertSwingOrderExpired(row: SwingOrderStagingRow): void {
  logger.info(
    { symbol: row.symbol, orderId: row.id, setupKey: row.setupKey ?? null },
    "swingAlerts: order EXPIRED (lifecycle-only — no Telegram)",
  );
}

/**
 * Called when owner rejects a staged order.
 *
 * REJECTED is a lifecycle status change, not a trade-channel event.
 * No Telegram alert is sent.
 */
export function alertSwingOrderRejected(row: SwingOrderStagingRow): void {
  logger.info(
    { symbol: row.symbol, orderId: row.id },
    "swingAlerts: order REJECTED (lifecycle-only — no Telegram)",
  );
}

/**
 * Called when owner approves and a dry-run placement is recorded.
 *
 * DRY_RUN is not a real trade open — no order is placed with any broker.
 * No Telegram alert is sent. Owner already saw the ENTRY_READY alert.
 */
export function alertSwingOrderApprovedDryRun(row: SwingOrderStagingRow): void {
  logger.info(
    { symbol: row.symbol, orderId: row.id },
    "swingAlerts: order DRY_RUN (lifecycle-only — no Telegram)",
  );
}

/**
 * Called when a candidate is hard-blocked by the risk guard (not stored).
 *
 * BLOCKED_BY_RISK is not a trade-channel event. No Telegram alert is sent.
 * The block is logged for diagnostics only.
 */
export function alertSwingOrderBlockedByRisk(
  symbol: string,
  setupKey: string | null,
  blockedReasons: string[],
): void {
  logger.info(
    { symbol, setupKey, blockedReasons },
    "swingAlerts: staging BLOCKED_BY_RISK (lifecycle-only — no Telegram)",
  );
}
