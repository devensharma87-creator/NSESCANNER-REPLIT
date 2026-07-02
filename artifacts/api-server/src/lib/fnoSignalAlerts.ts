/**
 * F&O high-quality tradeable signal Telegram alerts — canonical pipeline (2026-07-02).
 *
 * alertFnoTradeableSignal: fires Telegram ONLY when the F&O engine has opened an actual
 * paper trade — all gates passed (tradeability, Kite-trusted premium, confidence, DD caps,
 * heat cap, risk guards). Alert fires from the paper-trade open path, not the raw signal emitter.
 *
 * CANONICAL SAFETY GATES added 2026-07-02 (wired through canonical pipeline):
 *   1. TEST_SYMBOL_BLOCKED — index symbol matches a test/dummy pattern
 *   2. DEV_ENV_BLOCKED — process is not in production
 *   3. DB dedup — paperTradeId already SENT to telegram_main
 *   4. In-memory dedup — same signal within FNO_SIGNAL_DEDUP_MS (existing)
 *
 * alertFnoExitSignal: fires when closePaperTradeForSignal closes a paper trade.
 * Same safety gates apply.
 *
 * ABSOLUTE RULES:
 *   – No F&O signal logic changes.
 *   – No threshold changes.
 *   – No broker execution.
 *   – No real orders.
 *   – Alert failure must NEVER crash the F&O cycle.
 */

import crypto from "crypto";
import { alertOwnerRaw } from "./alerting";
import { logger } from "./logger";
import {
  hasAlreadyDelivered,
  logNotificationDelivery,
  hashMessage,
} from "./tradeLifecycle/notificationLog";
import type { TradeAlertEventType } from "./tradeLifecycle/types";

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * New-open freshness window. An `openedAt` older than this means the row is
 * an existing trade (idempotency path) — skip the alert.
 */
export const FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS = 5 * 60 * 1000; // 5 minutes

/** Dedup window per distinct signal. */
export const FNO_SIGNAL_DEDUP_MS = 30 * 60 * 1000; // 30 minutes

// ── Canonical safety gate helpers (inline — decoupled from validateTradeEvent) ──

const FNO_TEST_SYMBOL_EXACT = new Set([
  "TESTSTK", "TEST", "SAMPLE", "DUMMY", "PLACEHOLDER", "FAKE", "MOCK",
]);

/** True when the symbol looks like a test/dummy index (belt-and-suspenders). */
function isFnoTestSymbol(symbol: string): boolean {
  const upper = symbol.trim().toUpperCase();
  return FNO_TEST_SYMBOL_EXACT.has(upper) || /^TEST/i.test(upper);
}

/** Current process environment bucket: "production" or "non-production". */
function getFnoEnvironment(): "production" | "non-production" {
  return process.env["NODE_ENV"] === "production" ? "production" : "non-production";
}

// ── Input types ───────────────────────────────────────────────────────────────

/**
 * Data required to build and gate a tradeable F&O signal alert.
 * Typed explicitly so the alert is decoupled from the paper-trade row schema.
 */
export interface FnoTradeAlertInput {
  /** "NIFTY" | "BANKNIFTY" | "SENSEX" */
  indexSymbol:   string;
  direction:     "BULLISH" | "BEARISH";
  setupKey:      string;
  /** "YYYY-MM-DD" IST-anchored signal date. */
  signalDate:    string;
  /** Rounded integer confidence score (0–100). */
  confidence:    number;
  /** Entry option premium ₹ per share. */
  entryPremium:  number;
  /** Stop-loss option premium ₹ per share, or null if unavailable. */
  stopPremium:   number | null;
  /** Target-1 option premium ₹ per share, or null if unavailable. */
  target1Premium: number | null;
  /** Target-2 option premium ₹ per share, or null if unavailable. */
  target2Premium: number | null;
  /** Number of lots opened. */
  lots:    number;
  /** Lot size (shares per lot). */
  lotSize: number;
  /** Option strike price (numeric), or null. */
  strike:     number | null;
  /** Option expiry date string (YYYY-MM-DD or exchange format), or null. */
  expiry:     string | null;
  /** "CE" | "PE", or null if unknown. */
  optionType: "CE" | "PE" | null;
  /** Timestamp the paper trade row was opened — used for freshness check. */
  openedAt: Date;
  /**
   * Paper trade DB row ID.
   * Used for cross-restart DB-backed dedup (prevents double-alert after restart).
   * Optional — dedup is skipped when absent (fail-open).
   */
  paperTradeId?: string | null;
}

/** Data required to fire an F&O paper trade exit alert. */
export interface FnoExitAlertInput {
  /** Paper trade DB row ID — dedup key. */
  paperTradeId:   string;
  /** "NIFTY" | "BANKNIFTY" | "SENSEX" */
  indexSymbol:    string;
  direction:      "BULLISH" | "BEARISH";
  setupKey:       string;
  /** "YYYY-MM-DD" IST signal date. */
  signalDate:     string;
  /** "CE" | "PE", or null. */
  optionType:     "CE" | "PE" | null;
  /** Entry premium ₹ per share. */
  entryPremium:   number;
  /** Exit premium ₹ per share. */
  exitPremium:    number;
  /** Stop-loss premium ₹ per share, or null. */
  stopPremium:    number | null;
  /** Target-1 premium ₹ per share, or null. */
  target1Premium: number | null;
  /** Number of lots. */
  lots:           number;
  /** Lot size (shares per lot). */
  lotSize:        number;
  /** Realized P&L in ₹ (signed). */
  realizedPnl:    number;
  /** CloseReason string (STOPPED | TARGET1_HIT | TARGET2_HIT | EXPIRED | MANUAL_OVERRIDE | TIME_EXIT_1520). */
  reason:         string;
  /** UTC timestamp the paper trade was opened. */
  openedAt:       Date;
  /** UTC timestamp the paper trade was closed. */
  exitedAt:       Date;
}

// ── Alert status record ───────────────────────────────────────────────────────

export interface FnoSignalAlertRecord {
  dedupKey:    string;
  indexSymbol: string;
  direction:   "BULLISH" | "BEARISH";
  confidence:  number;
  at:          number;
}

let lastFnoSignalAlertRecord: FnoSignalAlertRecord | null = null;

/**
 * Synchronous in-process dedup Map.
 * Key: dedupKey string, Value: timestamp when last dispatched.
 * Prevents two rapid back-to-back alertFnoTradeableSignal calls for the
 * same signal from both entering the async pipeline before either one stamps.
 */
const recentlyDispatchedFnoMs = new Map<string, number>();

/** Returns a copy of the most recent F&O signal alert record, or null. */
export function getLastFnoSignalAlertRecord(): FnoSignalAlertRecord | null {
  return lastFnoSignalAlertRecord ? { ...lastFnoSignalAlertRecord } : null;
}

/** Reset alert record and in-process dedup state — for tests only. */
export function resetFnoSignalAlertState(): void {
  lastFnoSignalAlertRecord = null;
  recentlyDispatchedFnoMs.clear();
}

// ── Eligibility ───────────────────────────────────────────────────────────────

/**
 * Returns true only if this paper trade open should trigger a Telegram alert.
 *
 * Pure function — no side-effects, testable in isolation.
 *
 * Fails (returns false) when any of:
 * – openedAt is more than FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS ago (existing trade,
 *   not a fresh open — prevents re-alerting on process restart)
 * – entryPremium is ≤ 0 or non-finite (missing/corrupt option-chain data)
 * – lots or lotSize is ≤ 0 or non-finite (sizing error)
 * – confidence is ≤ 0 or non-finite
 */
export function shouldSendFnoTradeAlert(
  input: FnoTradeAlertInput,
  nowMs: number = Date.now(),
): boolean {
  const openedAgo = nowMs - input.openedAt.getTime();
  if (openedAgo > FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS) return false;
  if (!Number.isFinite(input.entryPremium) || input.entryPremium <= 0) return false;
  if (!Number.isFinite(input.lots)    || input.lots    <= 0) return false;
  if (!Number.isFinite(input.lotSize) || input.lotSize <= 0) return false;
  if (!Number.isFinite(input.confidence) || input.confidence <= 0) return false;
  return true;
}

// ── Entry message formatting ──────────────────────────────────────────────────

function formatIstTime(d: Date): string {
  try {
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return d.toISOString();
  }
}

function rrLabel(entry: number, stop: number | null, target: number | null): string {
  if (stop === null || target === null || !Number.isFinite(stop) || !Number.isFinite(target)) {
    return "n/a";
  }
  const risk   = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk <= 0) return "n/a";
  return (reward / risk).toFixed(2);
}

/**
 * Builds the Telegram message text for a tradeable F&O signal alert.
 *
 * Pure function — no side-effects, safe to call in tests.
 *
 * Required wording (never change):
 *   "Broker execution: DISABLED — no order placed"
 *   "Manual review required. This is not auto-executed."
 *   "Action: Review in F&O paper trades before trading."
 *
 * Forbidden wording: guaranteed profit / sure shot / buy now /
 *   auto order placed / risk-free / blindly enter
 */
export function buildFnoSignalAlertText(
  input: FnoTradeAlertInput,
  nowMs: number = Date.now(),
): string {
  const arrow   = input.direction === "BULLISH" ? "📈" : "📉";
  const side    = input.direction === "BULLISH" ? "CALL (CE)" : "PUT (PE)";

  const strikePart  = input.strike !== null ? ` ${input.strike}` : "";
  const optTypePart = input.optionType ?? "";
  const expiryPart  = input.expiry ? ` exp ${input.expiry}` : "";
  const instrument  = `${input.indexSymbol}${strikePart} ${optTypePart}${expiryPart}`.trim();

  const rr      = rrLabel(input.entryPremium, input.stopPremium, input.target1Premium);
  const perLotRisk = Number.isFinite(input.stopPremium)
    ? Math.abs(input.entryPremium - (input.stopPremium ?? input.entryPremium)) * input.lotSize
    : 0;
  const maxRisk = (input.lots * perLotRisk).toFixed(0);

  const alertedAt = formatIstTime(new Date(nowMs));

  const lines: string[] = [
    `${arrow} F&O TRADEABLE SIGNAL`,
    "",
    `Index:      ${input.indexSymbol}`,
    `Direction:  ${side}`,
    `Instrument: ${instrument}`,
    `Signal:     TRADEABLE_SIGNAL (all gates passed)`,
    `Confidence: ${input.confidence}`,
    "",
    `Entry:    ₹${input.entryPremium.toFixed(2)}`,
    input.stopPremium    !== null ? `Stop:     ₹${input.stopPremium.toFixed(2)}`    : "Stop:     n/a",
    input.target1Premium !== null ? `Target 1: ₹${input.target1Premium.toFixed(2)}` : "Target 1: n/a",
    input.target2Premium !== null ? `Target 2: ₹${input.target2Premium.toFixed(2)}` : "Target 2: n/a",
    `R:R:      ${rr}`,
    "",
    `Lots:     ${input.lots} × ${input.lotSize} shares`,
    `Max risk: ₹${maxRisk}`,
    "",
    `Price source:   Paper trade snapshot (at open time)`,
    `Premium source: Kite trusted option-chain`,
    `Note:           Entry premium is the snapshot at open — current price may differ`,
    `Alerted at:     ${alertedAt} IST`,
    `Setup:          ${input.setupKey}`,
    "",
    `Guard status: All gates passed ✓`,
    `Broker execution: DISABLED — no order placed`,
    "",
    `⚠ Manual review required. This is not auto-executed.`,
    `Action: Review in F&O paper trades before trading.`,
  ];

  return lines.join("\n");
}

// ── Exit message formatting ───────────────────────────────────────────────────

function closeReasonToEventType(reason: string): TradeAlertEventType {
  switch (reason) {
    case "TARGET1_HIT":     return "EXIT_TARGET_1";
    case "TARGET2_HIT":     return "EXIT_TARGET_2";
    case "STOPPED":         return "EXIT_STOP_LOSS";
    case "MANUAL_OVERRIDE": return "EXIT_MANUAL";
    default:                return "EXIT_TIME"; // TIME_EXIT_1520, EXPIRED, etc.
  }
}

/**
 * Builds the Telegram message text for a closed F&O paper trade.
 * Pure function — no side-effects.
 */
export function buildFnoExitAlertText(input: FnoExitAlertInput): string {
  const eventType = closeReasonToEventType(input.reason);
  const side = input.direction === "BULLISH" ? "CALL (CE)" : "PUT (PE)";
  const optPart = input.optionType ? ` ${input.optionType}` : "";
  const instrLine = `${input.indexSymbol}${optPart}`;

  let header: string;
  switch (eventType) {
    case "EXIT_TARGET_1":  header = "\u2705 F&O EXIT \u2014 TARGET 1 HIT";        break;
    case "EXIT_TARGET_2":  header = "\u2705 F&O EXIT \u2014 TARGET 2 HIT";        break;
    case "EXIT_STOP_LOSS": header = "\uD83D\uDD34 F&O EXIT \u2014 STOP-LOSS TRIGGERED"; break;
    case "EXIT_MANUAL":    header = "\u23F9\uFE0F F&O EXIT \u2014 MANUAL CLOSE";  break;
    default:               header = "\u23F0 F&O EXIT \u2014 TIME-BASED CLOSE";    break;
  }

  const totalShares = input.lots * input.lotSize;
  const pnlSign = input.realizedPnl >= 0 ? "+" : "";
  const pnlStr = `${pnlSign}₹${Math.abs(input.realizedPnl).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const istFmt = (d: Date): string => {
    try {
      return d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit", month: "short",
        hour: "2-digit", minute: "2-digit",
        hour12: false,
      }) + " IST";
    } catch { return d.toISOString(); }
  };

  const holdMs  = input.exitedAt.getTime() - input.openedAt.getTime();
  const holdMin = Math.max(0, Math.round(holdMs / 60_000));
  const holdStr = holdMin < 60
    ? `${holdMin} min`
    : `${Math.floor(holdMin / 60)}h ${holdMin % 60}min`;

  const lines: string[] = [
    header,
    "",
    `Index:      ${input.indexSymbol}`,
    `Direction:  ${side}`,
    `Instrument: ${instrLine}`,
    `Setup:      ${input.setupKey}`,
    "",
    `Entry:    ₹${input.entryPremium.toFixed(2)}`,
    `Exit:     ₹${input.exitPremium.toFixed(2)}`,
    `Exit Reason: ${input.reason}`,
    "",
    `Lots:     ${input.lots} × ${input.lotSize} = ${totalShares} shares`,
    `Realized P&L: ${pnlStr}`,
    "",
    `Entry Time: ${istFmt(input.openedAt)}`,
    `Exit Time:  ${istFmt(input.exitedAt)}`,
    `Holding:    ${holdStr}`,
    "",
    `Broker execution: DISABLED \u2014 no order placed`,
    `Paper trade ID: ${input.paperTradeId}`,
  ];
  return lines.join("\n");
}

// ── Canonical dispatch (F&O entry) ────────────────────────────────────────────

/**
 * Async canonical dispatch pipeline for F&O entry alerts.
 *
 * Applies inline canonical safety gates (test symbol, dev env, DB dedup) then
 * dispatches via the existing alertOwnerRaw infrastructure.
 *
 * Safe-fail — never throws.
 */
async function dispatchFnoWithCanonicalGates(
  input: FnoTradeAlertInput,
  nowMs: number,
): Promise<void> {
  try {
    // Gate 1: TEST_SYMBOL_BLOCKED
    if (isFnoTestSymbol(input.indexSymbol)) {
      logger.info(
        { symbol: input.indexSymbol },
        "fnoSignalAlerts: ENTRY blocked — TEST_SYMBOL_BLOCKED",
      );
      return;
    }

    // Gate 2: DEV_ENV_BLOCKED
    if (getFnoEnvironment() !== "production") {
      logger.info(
        { env: process.env["NODE_ENV"], indexSymbol: input.indexSymbol },
        "fnoSignalAlerts: ENTRY blocked — DEV_ENV_BLOCKED (not production)",
      );
      return;
    }

    // Gate 3: DB dedup by paperTradeId (cross-restart idempotency)
    if (input.paperTradeId) {
      const isDuplicate = await hasAlreadyDelivered(
        "FNO_INTRADAY",
        "ENTRY_READY",
        {
          orderId:      null,
          paperTradeId: input.paperTradeId,
          signalId:     null,
          id:           input.paperTradeId,
        },
        "telegram_main",
      );
      if (isDuplicate) {
        logger.info(
          { paperTradeId: input.paperTradeId },
          "fnoSignalAlerts: ENTRY skipped — DB dedup (already delivered)",
        );
        return;
      }
    }

    // Gate 4 (in-memory): alertOwnerRaw's own dedup handles within FNO_SIGNAL_DEDUP_MS.
    const dedupKey = [
      "FNO_TRADEABLE_SIGNAL",
      input.signalDate,
      input.indexSymbol,
      input.direction,
      input.setupKey,
    ].join("::");

    const logMsg = `F&O tradeable signal: ${input.indexSymbol} ${input.direction} conf=${input.confidence} lots=${input.lots}`;
    const text   = buildFnoSignalAlertText(input, nowMs);
    alertOwnerRaw(dedupKey, logMsg, text, FNO_SIGNAL_DEDUP_MS);

    // Log delivery to notification_delivery_log
    if (input.paperTradeId) {
      void logNotificationDelivery({
        eventId:      crypto.randomUUID(),
        domain:       "FNO_INTRADAY",
        eventType:    "ENTRY_READY",
        signalId:     null,
        orderId:      null,
        paperTradeId: input.paperTradeId,
        symbol:       input.indexSymbol,
        exchange:     "INDEX",
        destination:  "telegram_main",
        messageHash:  hashMessage(text),
        status:       "SENT",
        errorCode:    null,
        errorMessage: null,
        sentAt:       new Date().toISOString(),
        environment:  "production",
      });
    }

    lastFnoSignalAlertRecord = {
      dedupKey,
      indexSymbol: input.indexSymbol,
      direction:   input.direction,
      confidence:  input.confidence,
      at:          nowMs,
    };
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message },
      "fnoSignalAlerts: dispatchFnoWithCanonicalGates error (safe-fail)",
    );
  }
}

// ── Public API — entry alert ──────────────────────────────────────────────────

/**
 * Fire a Telegram alert for a freshly opened F&O paper trade.
 *
 * Safe-fail — never throws. Best-effort background delivery.
 * Silently skips when:
 *   – shouldSendFnoTradeAlert() returns false (stale open, bad fields)
 *   – TEST_SYMBOL_BLOCKED or DEV_ENV_BLOCKED canonical gate fires
 *   – DB dedup finds a prior SENT record for this paperTradeId
 *   – in-memory dedup within FNO_SIGNAL_DEDUP_MS
 *   – Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing)
 *
 * Does NOT: block the F&O cycle, create paper trades, place real orders,
 *           change signal logic or thresholds, enable broker execution.
 */
export function alertFnoTradeableSignal(input: FnoTradeAlertInput): void {
  try {
    const nowMs = Date.now();
    if (!shouldSendFnoTradeAlert(input, nowMs)) return;

    // Synchronous in-process dedup: two rapid back-to-back calls for the same
    // signal are blocked here before the async pipeline is queued.
    const syncDedupKey = [
      input.signalDate, input.indexSymbol, input.direction, input.setupKey,
    ].join("::");
    const lastSentAt = recentlyDispatchedFnoMs.get(syncDedupKey);
    if (lastSentAt !== undefined && nowMs - lastSentAt < FNO_SIGNAL_DEDUP_MS) {
      logger.info(
        { indexSymbol: input.indexSymbol, direction: input.direction },
        "fnoSignalAlerts: ENTRY skipped — in-process dedup",
      );
      return;
    }
    recentlyDispatchedFnoMs.set(syncDedupKey, nowMs);

    void dispatchFnoWithCanonicalGates(input, nowMs);
  } catch (err) {
    // Never throw — alert failure must not crash the F&O cycle.
    logger.warn(
      { err: (err as Error)?.message },
      "alertFnoTradeableSignal: unexpected error (safe-fail — F&O cycle unaffected)",
    );
  }
}

// ── Public API — exit alert ───────────────────────────────────────────────────

/**
 * Fire a Telegram alert when a paper F&O trade is closed.
 *
 * Called from closePaperTradeForSignal after the transaction commits.
 * Safe-fail — never throws. Never blocks the close path.
 *
 * Applies the same canonical safety gates:
 *   – TEST_SYMBOL_BLOCKED, DEV_ENV_BLOCKED, DB dedup by paperTradeId + eventType.
 *
 * Does NOT: place real orders, change signal logic, modify paper trade rows.
 */
export function alertFnoExitSignal(input: FnoExitAlertInput): void {
  void (async () => {
    try {
      // Gate 1: TEST_SYMBOL_BLOCKED
      if (isFnoTestSymbol(input.indexSymbol)) return;

      // Gate 2: DEV_ENV_BLOCKED
      if (getFnoEnvironment() !== "production") {
        logger.info(
          { env: process.env["NODE_ENV"], paperTradeId: input.paperTradeId },
          "fnoSignalAlerts: EXIT blocked — DEV_ENV_BLOCKED (not production)",
        );
        return;
      }

      const eventType = closeReasonToEventType(input.reason);

      // Gate 3: DB dedup — one exit alert per (paperTradeId, exitType)
      const isDuplicate = await hasAlreadyDelivered(
        "FNO_INTRADAY",
        eventType,
        {
          orderId:      null,
          paperTradeId: input.paperTradeId,
          signalId:     null,
          id:           `${input.paperTradeId}::${eventType}`,
        },
        "telegram_main",
      );
      if (isDuplicate) {
        logger.info(
          { paperTradeId: input.paperTradeId, eventType },
          "fnoSignalAlerts: EXIT skipped — DB dedup",
        );
        return;
      }

      const text     = buildFnoExitAlertText(input);
      const dedupKey = `FNO_EXIT::${input.paperTradeId}::${input.reason}`;
      const logMsg   = `F&O exit: ${input.indexSymbol} ${input.direction} reason=${input.reason} pnl=${input.realizedPnl.toFixed(0)}`;
      alertOwnerRaw(dedupKey, logMsg, text, FNO_SIGNAL_DEDUP_MS);

      void logNotificationDelivery({
        eventId:      crypto.randomUUID(),
        domain:       "FNO_INTRADAY",
        eventType,
        signalId:     null,
        orderId:      null,
        paperTradeId: input.paperTradeId,
        symbol:       input.indexSymbol,
        exchange:     "INDEX",
        destination:  "telegram_main",
        messageHash:  hashMessage(text),
        status:       "SENT",
        errorCode:    null,
        errorMessage: null,
        sentAt:       new Date().toISOString(),
        environment:  "production",
      });
    } catch (err) {
      logger.warn(
        { err: (err as Error)?.message },
        "alertFnoExitSignal: unexpected error (safe-fail)",
      );
    }
  })();
}

// ── Sample alert builder (for test endpoint only) ─────────────────────────────

/**
 * Build a clearly-labeled [SAMPLE] F&O format-test message.
 * Used exclusively by the owner-only test endpoint.
 *
 * RULES (enforced here — do not relax):
 *   – Does NOT call buildFnoSignalAlertText() (which carries "Kite trusted" source label).
 *   – Does NOT say "Data source: Kite" or "trusted option-chain".
 *   – Does NOT say "F&O TRADEABLE SIGNAL" (this is a format test, not a signal).
 *   – Prices are fixed dummy values — no Kite API is called.
 *   – No paper trade is created. No real order is placed.
 */
export function buildFnoSampleAlertText(nowMs: number = Date.now()): string {
  const alertedAt = (() => {
    try {
      return new Date(nowMs).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return new Date(nowMs).toISOString();
    }
  })();

  const lines: string[] = [
    "[SAMPLE — NOT A REAL TRADE]",
    "",
    "⚠ F&O TRADE ALERT FORMAT TEST",
    "",
    "Index:      NIFTY  (sample)",
    "Direction:  CALL (CE)  (sample)",
    "Instrument: NIFTY 24500 CE  (sample strike / sample expiry)",
    "Signal:     FORMAT_TEST_ONLY — not an engine-generated signal",
    "Confidence: 72  (sample value)",
    "",
    "Entry:    ₹125.00  (sample — not a live Kite premium)",
    "Stop:     ₹80.00   (sample)",
    "Target 1: ₹200.00  (sample)",
    "Target 2: ₹280.00  (sample)",
    "R:R:      1.88  (sample)",
    "",
    "Lots:     10 × 75 shares  (sample)",
    "Max risk: ₹3,375  (sample)",
    "",
    "Price source:   SAMPLE DATA — not Kite, not live market price",
    "Market data:    NOT QUERIED — no Kite API call made",
    "Alerted at:     " + alertedAt + " IST",
    "",
    "Paper trade created: NO",
    "Real order placed:   NO",
    "Broker execution:    DISABLED — no order placed",
    "",
    "⚠ Sample prices only. Do NOT act on this message.",
    "Action: Verify format only — not a real tradeable signal.",
    "",
    "[SAMPLE — no paper trade created, no real order, broker execution disabled]",
  ];

  return lines.join("\n");
}

// ── F&O data-health (warmup-failure) alerts ────────────────────────────────────

/**
 * Dedup window for data-health alerts: 10 minutes per (alertType, index).
 */
export const FNO_DATA_HEALTH_DEDUP_MS = 10 * 60 * 1000;

export type FnoDataHealthAlertType = "WARMUP_FAILED" | "WARMUP_PARTIAL";

export interface FnoDataHealthAlertInput {
  alertType: FnoDataHealthAlertType;
  /** "NIFTY" | "BANKNIFTY" | "SENSEX" */
  index: string;
  /** Classified failure code (DataFailureCode) or null. */
  code?: string | null;
  /** Short human detail, e.g. "optionChain: Kite option chain unavailable". */
  detail?: string | null;
}

/**
 * Fire a single owner Telegram alert for an F&O data warmup failure.
 *
 * Safe-fail — never throws. Best-effort delivery via alertOwnerRaw with a
 * dedicated 10-min dedup key. Does NOT create paper trades, place orders, change
 * signal logic/thresholds, or enable broker execution.
 */
export function alertFnoDataHealth(input: FnoDataHealthAlertInput): void {
  try {
    const dedupKey = `FNO_DATA_HEALTH::${input.alertType}::${input.index}`;
    const title =
      input.alertType === "WARMUP_FAILED"
        ? "⚠ F&O DATA WARMUP FAILED"
        : "⚠ F&O DATA WARMUP PARTIAL";
    const lines = [
      title,
      "",
      `Index:  ${input.index}`,
      `Reason: ${input.code ?? "UNKNOWN"}`,
      ...(input.detail ? [`Detail: ${input.detail}`] : []),
      "",
      "Kite data did not warm up after login. F&O signals for this index may be",
      "suppressed until data recovers. This is a data-health notice, not a signal.",
      "",
      "No paper trade created. No real order placed. Broker execution disabled.",
    ];
    const logMsg = `F&O data-health alert: ${input.alertType} ${input.index} (${input.code ?? "UNKNOWN"})`;
    alertOwnerRaw(dedupKey, logMsg, lines.join("\n"), FNO_DATA_HEALTH_DEDUP_MS);
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message },
      "alertFnoDataHealth: unexpected error (safe-fail)",
    );
  }
}

/**
 * Inspect a completed warmup run and fire at most one alert per FAILED index.
 *
 * - Never alerts on OK or any SKIPPED_* outcome.
 * - Never alerts on SESSION_MISSING / TOKEN_MISSING — benign/expected state.
 */
export function alertWarmupFailures(result: {
  outcome: string;
  indices: {
    index: string;
    ok: boolean;
    steps: { step: string; ok: boolean; code: string | null; message: string | null }[];
  }[];
}): void {
  try {
    if (result.outcome === "OK" || result.outcome.startsWith("SKIPPED")) return;
    for (const idx of result.indices) {
      if (idx.ok) continue;
      const firstFail = idx.steps.find((s) => !s.ok);
      if (!firstFail) continue;
      if (firstFail.code === "SESSION_MISSING" || firstFail.code === "TOKEN_MISSING") continue;
      alertFnoDataHealth({
        alertType: result.outcome === "FAILED" ? "WARMUP_FAILED" : "WARMUP_PARTIAL",
        index: idx.index,
        code: firstFail.code,
        detail: firstFail.message ? `${firstFail.step}: ${firstFail.message}` : firstFail.step,
      });
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message },
      "alertWarmupFailures: unexpected error (safe-fail)",
    );
  }
}
