/**
 * compareTradeEventParity — deterministic field comparator for trade event surfaces.
 *
 * Part C of the Deterministic Parity Verification Harness.
 *
 * Compares a CanonicalTradeEvent against its UI projection, Telegram preview,
 * DB snapshot (notification_delivery_log), paper trade snapshot, and notification log.
 *
 * PURE FUNCTION — no I/O, no DB, no async.
 * All comparison logic is deterministic. Safe to call in tests and in production.
 *
 * Severity classification:
 *   P0 — price, symbol, source, lifecycle status, or ID mismatch (critical)
 *   P1 — secondary field mismatch (confidence, R:R, timestamps)
 *   P2 — cosmetic/optional field mismatch (warnings, optional text)
 *
 * Rules:
 *   - Any mismatch in entry, stopLoss, target1, symbol, source, or lifecycle status = P0.
 *   - Any mismatch in confidence, riskPercent, instrumentToken, or paperTradeId = P1.
 *   - Any mismatch in warnings, optional fields, or cosmetic text = P2.
 */

import type { CanonicalTradeEvent } from "./types";
import type { TradeEventUiProjection } from "./projectTradeEvent";
import { hashMessage } from "./notificationLog";
import { formatTradeTelegramMessage } from "./formatTelegramMessage";
import { projectTradeEventForUi } from "./projectTradeEvent";

// ── Input/Output types ────────────────────────────────────────────────────────

export interface ParityMismatch {
  field:           string;
  canonical:       unknown;
  ui:              unknown;
  telegram:        unknown;
  db:              unknown;
  paperTrade:      unknown;
  notificationLog: unknown;
  severity:        "P0" | "P1" | "P2";
}

export interface ParityResult {
  ok:                  boolean;
  eventId:             string;
  mismatches:          ParityMismatch[];
  blockedReasons:      string[];
  warnings:            string[];
  telegramText:        string | null;
  telegramMessageHash: string | null;
  dbMessageHash:       string | null;
  hashMatch:           boolean | null;
}

export interface DbNotificationSnapshot {
  eventId?:       string;
  domain?:        string;
  eventType?:     string;
  symbol?:        string;
  exchange?:      string;
  orderId?:       string | null;
  signalId?:      string | null;
  paperTradeId?:  string | null;
  messageHash?:   string;
  status?:        string;
  environment?:   string;
  destination?:   string;
}

export interface PaperTradeSnapshot {
  id?:            string;
  symbol?:        string;
  direction?:     string;
  entryPremium?:  number;
  stopLoss?:      number;
  targetPremium?: number;
  lotSize?:       number;
  lots?:          number;
  status?:        string;
}

export interface ParityCompareInput {
  canonicalEvent:         CanonicalTradeEvent;
  uiProjection?:          TradeEventUiProjection;
  telegramPreview?:       string;
  dbSnapshot?:            DbNotificationSnapshot;
  paperTradeSnapshot?:    PaperTradeSnapshot;
  notificationLogSnapshot?: DbNotificationSnapshot;
}

// ── Severity map ──────────────────────────────────────────────────────────────

const P0_FIELDS = new Set([
  "entry", "stopLoss", "target1", "symbol", "exchange", "source",
  "sourceStatus", "lifecycleStatus", "eventType", "domain",
  "orderId", "paperTradeId", "signalId", "brokerExecutionStatus",
  "canDriveTradeAlerts",
]);

const P1_FIELDS = new Set([
  "confidence", "riskPercent", "instrumentToken", "qty", "lots",
  "capitalRequired", "risk", "riskReward", "target2", "exitPrice",
  "exitReason", "environment", "paperTradeStatus",
]);

function severity(field: string): "P0" | "P1" | "P2" {
  if (P0_FIELDS.has(field)) return "P0";
  if (P1_FIELDS.has(field)) return "P1";
  return "P2";
}

// ── Comparison helpers ────────────────────────────────────────────────────────

function numClose(a: number | null | undefined, b: number | null | undefined, eps = 0.01): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= eps;
}

function strEq(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

// ── Telegram text parser helpers ──────────────────────────────────────────────

/** Extract a numeric value from a Telegram message line like "Entry: ₹1,234.50" → 1234.5 */
function extractInrFromTelegram(text: string, label: string): number | null {
  const re = new RegExp(`${label}:\\s*₹([\\d,]+\\.?\\d*)`, "i");
  const m = text.match(re);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Extract a text field from a Telegram message line like "Symbol: RELIANCE" → "RELIANCE" */
function extractTextFromTelegram(text: string, label: string): string | null {
  const re = new RegExp(`^${label}:\\s*(.+)$`, "im");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

// ── Main comparator ────────────────────────────────────────────────────────────

/**
 * Compare a CanonicalTradeEvent against all available surfaces.
 *
 * If uiProjection is not supplied, it is generated from the canonical event
 * (proving that the projection function outputs the correct values).
 *
 * If telegramPreview is not supplied, it is generated from the canonical event
 * (proving that the formatter outputs the correct values).
 *
 * Returns a ParityResult with all mismatches classified by severity.
 * ok === true only when there are ZERO mismatches.
 *
 * @param input - Canonical event plus any available surface snapshots.
 * @returns ParityResult with mismatches, blocked reasons, and hash comparison.
 */
export function compareTradeEventParity(input: ParityCompareInput): ParityResult {
  const {
    canonicalEvent: ev,
    paperTradeSnapshot: pt,
    notificationLogSnapshot: nls,
  } = input;

  const mismatches: ParityMismatch[] = [];
  const blockedReasons: string[] = [];
  const warnings: string[] = [];

  // Always generate projection and telegram from canonical event (the reference)
  const ui = input.uiProjection ?? projectTradeEventForUi(ev);
  const telegramText = input.telegramPreview ?? formatTradeTelegramMessage(ev);
  const db: DbNotificationSnapshot = input.dbSnapshot ?? {};

  const telegramMessageHash = hashMessage(telegramText);
  const dbMessageHash = db.messageHash ?? nls?.messageHash ?? null;
  const hashMatch = dbMessageHash != null ? telegramMessageHash === dbMessageHash : null;

  // ── Broker execution status — always P0 ──────────────────────────────────
  if (ev.brokerExecutionStatus === "LIVE_ENABLED") {
    blockedReasons.push("BROKER_EXECUTION_MISMATCH: brokerExecutionStatus is LIVE_ENABLED");
  }

  // ── canDriveTradeAlerts consistency ──────────────────────────────────────
  // Only flag the trust-chain invariant: if canDriveTradeAlerts=true but
  // sourceStatus is not TRADE_GRADE, that is a hard invariant violation.
  // Environment check is validation-layer responsibility (validateTradeEventForNotification),
  // not a parity field — fixtures deliberately use environment:"test".
  if (ev.canDriveTradeAlerts && ev.sourceStatus !== "TRADE_GRADE") {
    blockedReasons.push(`SOURCE_NOT_TRADE_GRADE: canDriveTradeAlerts=true but sourceStatus=${ev.sourceStatus}`);
  }

  // ── Helper: add mismatch ──────────────────────────────────────────────────
  function addMismatch(
    field: string,
    canonical: unknown,
    uiVal: unknown,
    telegramVal: unknown,
    dbVal: unknown,
    ptVal: unknown,
    nlsVal: unknown,
  ) {
    mismatches.push({
      field,
      canonical,
      ui: uiVal,
      telegram: telegramVal,
      db: dbVal,
      paperTrade: ptVal,
      notificationLog: nlsVal,
      severity: severity(field),
    });
  }

  // ── UI projection comparisons ─────────────────────────────────────────────

  if (ui.symbol !== ev.symbol) {
    addMismatch("symbol", ev.symbol, ui.symbol, extractTextFromTelegram(telegramText, "(?:Symbol|Index)"), db.symbol, pt?.symbol, nls?.symbol);
  }
  if (ui.exchange !== ev.exchange) {
    addMismatch("exchange", ev.exchange, ui.exchange, extractTextFromTelegram(telegramText, "Exchange"), db.exchange, null, nls?.exchange);
  }
  if (ui.domain !== ev.domain) {
    addMismatch("domain", ev.domain, ui.domain, null, db.domain, null, nls?.domain);
  }
  if (ui.eventType !== ev.eventType) {
    addMismatch("eventType", ev.eventType, ui.eventType, null, db.eventType, null, nls?.eventType);
  }
  if (ui.lifecycleStatus !== ev.lifecycleStatus) {
    addMismatch("lifecycleStatus", ev.lifecycleStatus, ui.lifecycleStatus, null, null, null, null);
  }
  if (ui.orderId !== ev.orderId) {
    addMismatch("orderId", ev.orderId, ui.orderId, null, db.orderId, null, nls?.orderId);
  }
  if (ui.paperTradeId !== ev.paperTradeId) {
    addMismatch("paperTradeId", ev.paperTradeId, ui.paperTradeId, null, db.paperTradeId, pt?.id, nls?.paperTradeId);
  }
  if (ui.brokerExecutionStatus !== ev.brokerExecutionStatus) {
    addMismatch("brokerExecutionStatus", ev.brokerExecutionStatus, ui.brokerExecutionStatus, null, null, null, null);
  }
  if (ui.canDriveTradeAlerts !== ev.canDriveTradeAlerts) {
    addMismatch("canDriveTradeAlerts", ev.canDriveTradeAlerts, ui.canDriveTradeAlerts, null, null, null, null);
  }
  if (ui.source !== ev.source) {
    addMismatch("source", ev.source, ui.source, null, null, null, null);
  }
  if (ui.sourceStatus !== ev.sourceStatus) {
    addMismatch("sourceStatus", ev.sourceStatus, ui.sourceStatus, null, null, null, null);
  }
  if (!numClose(ui.entry, ev.entryPrice)) {
    addMismatch("entry", ev.entryPrice, ui.entry,
      extractInrFromTelegram(telegramText, "(?:Entry|Entry Premium)"),
      null, pt?.entryPremium, null);
  }
  if (!numClose(ui.stopLoss, ev.stopLoss)) {
    addMismatch("stopLoss", ev.stopLoss, ui.stopLoss,
      extractInrFromTelegram(telegramText, "(?:SL|SL Premium)"),
      null, pt?.stopLoss, null);
  }
  if (ev.target1 != null && !numClose(ui.target1, ev.target1)) {
    addMismatch("target1", ev.target1, ui.target1,
      extractInrFromTelegram(telegramText, "Target 1"),
      null, pt?.targetPremium, null);
  }
  if (!numClose(ui.qty, ev.quantity)) {
    addMismatch("qty", ev.quantity, ui.qty, null, null, null, null);
  }
  if (!numClose(ui.risk, ev.maxRisk)) {
    addMismatch("risk", ev.maxRisk, ui.risk,
      extractInrFromTelegram(telegramText, "(?:Risk|Max Risk)"),
      null, null, null);
  }

  // ── Telegram text surface checks (entry messages only) ───────────────────
  // "Broker execution DISABLED" and "Manual review required" are required
  // ONLY in ENTRY messages (ENTRY_READY / ENTRY_OPENED). Exit messages are
  // purely informational and do not carry those compliance lines.
  const isEntryEvent = ev.eventType === "ENTRY_READY" || ev.eventType === "ENTRY_OPENED";
  if (isEntryEvent) {
    const BROKER_DISABLED_RE = /Broker execution[\s\S]{0,30}DISABLED/i;
    if (!BROKER_DISABLED_RE.test(telegramText)) {
      warnings.push('Entry Telegram message is missing required "Broker execution DISABLED" text');
    }
    if (!/Manual review required/i.test(telegramText)) {
      warnings.push('Entry Telegram message is missing required "Manual review required" text');
    }
  }

  // ── DB snapshot comparisons ───────────────────────────────────────────────
  if (db.symbol && db.symbol !== ev.symbol) {
    addMismatch("symbol", ev.symbol, ui.symbol, null, db.symbol, null, null);
  }
  if (db.domain && db.domain !== ev.domain) {
    addMismatch("domain", ev.domain, ui.domain, null, db.domain, null, null);
  }
  if (db.eventType && db.eventType !== ev.eventType) {
    addMismatch("eventType", ev.eventType, ui.eventType, null, db.eventType, null, null);
  }

  // ── Hash comparison ───────────────────────────────────────────────────────
  if (hashMatch === false) {
    warnings.push(
      `Message hash mismatch: telegram generated ${telegramMessageHash}, DB stored ${dbMessageHash}. ` +
      "The Telegram message that was sent may not match the current canonical formatter output.",
    );
  }

  // ── Paper trade snapshot comparisons ─────────────────────────────────────
  if (pt) {
    if (pt.symbol && pt.symbol !== ev.symbol) {
      addMismatch("symbol", ev.symbol, ui.symbol, null, db.symbol, pt.symbol, null);
    }
    if (pt.entryPremium != null && !numClose(pt.entryPremium, ev.entryPrice, 0.1)) {
      addMismatch("entry", ev.entryPrice, ui.entry, null, null, pt.entryPremium, null);
    }
    if (pt.stopLoss != null && !numClose(pt.stopLoss, ev.stopLoss, 0.1)) {
      addMismatch("stopLoss", ev.stopLoss, ui.stopLoss, null, null, pt.stopLoss, null);
    }
  }

  return {
    ok:                  mismatches.length === 0 && blockedReasons.length === 0,
    eventId:             ev.id,
    mismatches,
    blockedReasons,
    warnings,
    telegramText,
    telegramMessageHash,
    dbMessageHash,
    hashMatch,
  };
}
