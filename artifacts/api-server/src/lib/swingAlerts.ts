/**
 * Swing Cash staged-order owner alerts.
 *
 * Sends Telegram alerts when a staged order transitions through lifecycle
 * events (staged, approval-required, expired, rejected, approved-dry-run,
 * blocked-by-risk). Uses alertOwnerRaw so the F&O buildTelegramText is never
 * invoked — swing has its own format.
 *
 * ABSOLUTE RULES:
 *   - Fire-and-forget only. Never throws. Never rolls back a DB write.
 *   - Broker execution is hard-disabled; message must always say so.
 *   - Never log secrets, tokens, or session data.
 *   - No signal/scoring/risk logic changes — alerting only.
 *
 * Dedup keys include the stagedOrderId for per-order events (prevents
 * re-alerting the same order within the dedup window). BLOCKED_BY_RISK uses
 * symbol+setupKey dedup to suppress repeated scanner-cycle spam.
 */

import { alertOwnerRaw } from "./alerting";
import type { AlertRecord } from "./alerting";
import type { SwingOrderStagingRow } from "@workspace/db/schema";

// ── Dedup windows ─────────────────────────────────────────────────────────────

/** 15 min dedup per staged-order alert (keyed by order id — unique per order). */
const SWING_ORDER_DEDUP_MS = 15 * 60 * 1000;

/** 1 h dedup for blocked/risk alerts keyed by symbol+setupKey. */
const SWING_BLOCKED_DEDUP_MS = 60 * 60 * 1000;

// ── Last swing alert record (separate from F&O lastAlertRecord) ───────────────

let lastSwingAlertRecord: AlertRecord | null = null;

/** Returns a copy of the most recent swing alert record (no secrets). */
export function getLastSwingAlertRecord(): AlertRecord | null {
  return lastSwingAlertRecord ? { ...lastSwingAlertRecord } : null;
}

/** Reset last swing alert record (useful in tests). */
export function resetLastSwingAlertRecord(): void {
  lastSwingAlertRecord = null;
}

// ── Message formatting ─────────────────────────────────────────────────────────

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
 * Uses only row fields — no secrets, no tokens, no session data.
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
    `Data: ${row.dataSource} (as of ${fmtDataAge(row.dataAsOf)})`,
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

// ── Internal dispatch ──────────────────────────────────────────────────────────

function dispatch(
  dedupKey: string,
  logMessage: string,
  telegramText: string,
  dedupWindowMs: number,
  event: string,
): void {
  alertOwnerRaw(dedupKey, logMessage, telegramText, dedupWindowMs);
  // Mirror record for /alerts/status (best-effort; alertOwnerRaw dispatches async,
  // so this is a synchronous placeholder updated to SENT/FAILED once delivery resolves).
  // We record at dispatch time; actual delivery status lives in alerting.ts lastAlertRecord.
  lastSwingAlertRecord = {
    event,
    at: Date.now(),
    telegramStatus: "SENT",
  };
}

// ── Public alert functions ────────────────────────────────────────────────────

/**
 * Alert when a swing order is staged (STAGED) or needs manual review
 * (APPROVAL_REQUIRED). Derives the event label from `row.status`.
 * Dedup key includes the order id — unique per order, prevents re-alert
 * within 15 min if called more than once for the same row.
 */
export function alertSwingOrderStaged(row: SwingOrderStagingRow): void {
  const event =
    row.status === "APPROVAL_REQUIRED"
      ? "SWING_ORDER_APPROVAL_REQUIRED"
      : "SWING_ORDER_STAGED";
  const dedupKey = `${event}:${row.id}`;
  const text = buildSwingOrderText(event, row);
  dispatch(
    dedupKey,
    `Swing order staged: ${row.symbol} [${row.status}] setup=${row.setupKey ?? "n/a"}`,
    text,
    SWING_ORDER_DEDUP_MS,
    event,
  );
}

/**
 * Alert when a staged order expires (TTL sweep or manual expire).
 */
export function alertSwingOrderExpired(row: SwingOrderStagingRow): void {
  const event = "SWING_ORDER_EXPIRED";
  const dedupKey = `${event}:${row.id}`;
  const text = buildSwingOrderText(event, row);
  dispatch(
    dedupKey,
    `Swing order expired: ${row.symbol} setup=${row.setupKey ?? "n/a"}`,
    text,
    SWING_ORDER_DEDUP_MS,
    event,
  );
}

/**
 * Alert when owner rejects a staged order.
 */
export function alertSwingOrderRejected(row: SwingOrderStagingRow): void {
  const event = "SWING_ORDER_REJECTED";
  const dedupKey = `${event}:${row.id}`;
  const text = buildSwingOrderText(event, row);
  dispatch(
    dedupKey,
    `Swing order rejected: ${row.symbol} setup=${row.setupKey ?? "n/a"}`,
    text,
    SWING_ORDER_DEDUP_MS,
    event,
  );
}

/**
 * Alert when owner approves and a dry-run placement is recorded.
 * Only fires for DRY_RUN_PLACED status — APPROVED (BROKER_DISABLED) is silent
 * by default since it is the broker-disabled no-op path.
 */
export function alertSwingOrderApprovedDryRun(row: SwingOrderStagingRow): void {
  const event = "SWING_ORDER_APPROVED_DRY_RUN";
  const dedupKey = `${event}:${row.id}`;
  const text = buildSwingOrderText(event, row);
  dispatch(
    dedupKey,
    `Swing order approved (dry-run): ${row.symbol} setup=${row.setupKey ?? "n/a"}`,
    text,
    SWING_ORDER_DEDUP_MS,
    event,
  );
}

/**
 * Alert when a candidate is hard-blocked by the risk guard (not stored).
 * Dedup key is symbol+setupKey to suppress repeated scanner-cycle spam.
 * Only sent when the block is a hard risk-guard decision (NOT_STAGEABLE).
 */
export function alertSwingOrderBlockedByRisk(
  symbol: string,
  setupKey: string | null,
  blockedReasons: string[],
): void {
  const event = "SWING_ORDER_BLOCKED_BY_RISK";
  const safeSetup = setupKey ?? "none";
  const dedupKey = `${event}:${symbol}:${safeSetup}`;
  const text = buildSwingBlockedText(symbol, setupKey, blockedReasons);
  dispatch(
    dedupKey,
    `Swing staging blocked: ${symbol} setup=${safeSetup} reasons=${blockedReasons.join(",")}`,
    text,
    SWING_BLOCKED_DEDUP_MS,
    event,
  );
}
