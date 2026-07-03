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
  TradeAlertEventType,
  TradeLifecycleStatus,
} from "./tradeLifecycle/types";

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

/** Maps a TradeAlertEventType (EXIT_* only) to its canonical lifecycle status. */
function exitEventTypeToLifecycleStatus(eventType: TradeAlertEventType): TradeLifecycleStatus {
  switch (eventType) {
    case "EXIT_TARGET_1":  return "EXITED_TARGET_1";
    case "EXIT_TARGET_2":  return "EXITED_TARGET_2";
    case "EXIT_STOP_LOSS": return "EXITED_STOP_LOSS";
    case "EXIT_MANUAL":    return "EXITED_MANUAL";
    default:               return "EXITED_TIME"; // EXIT_TIME
  }
}

/** Runtime environment bucket for CanonicalTradeEvent ("production"/"development"/"test"). */
function deriveFnoCanonicalEnvironment(): "production" | "development" | "test" {
  const n = process.env["NODE_ENV"];
  if (n === "production") return "production";
  if (n === "test") return "test";
  return "development";
}

function computeFnoRr(entry: number, stop: number, target: number | null): number | null {
  if (target == null) return null;
  const risk = entry - stop;
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const reward = target - entry;
  if (!Number.isFinite(reward)) return null;
  return reward / risk;
}

/**
 * Build a CanonicalTradeEvent from an F&O paper-trade close (FnoExitAlertInput).
 *
 * DATA-TRUST DESIGN (2026-07-02): an EXIT event reports a position that has
 * ALREADY been closed against a locked/committed DB premium — the real
 * "should we exit" trust enforcement happened upstream (the F&O Exit
 * Monitoring Reliability gate, before the DB commit). This report is
 * therefore stamped honestly as INFO_ONLY / canDriveSignals=false /
 * canDriveTradeAlerts=false — it is NOT a live trade-grade quote and must
 * never be mistaken for one. `source` is "manual" only for owner-initiated
 * MANUAL_OVERRIDE closes; every other close reason (STOPPED, TARGET1_HIT,
 * TARGET2_HIT, EXPIRED, TIME_EXIT_1520) is "computed_from_kite" — the close
 * premium is a locked DB value derived from a prior Kite-sourced tick, not a
 * fresh live quote.
 *
 * `instrumentToken` is null — F&O paper trades do not persist a Kite
 * instrument token, and TOKEN_MISSING is scoped to ENTRY events only (see
 * validateTradeEvent.ts), so this is safe and does not block delivery.
 * `assetType` is honestly "option" (not "index" — the underlying is an
 * index, but the traded instrument is an index option).
 */
export function buildFnoExitCanonicalEvent(input: FnoExitAlertInput): CanonicalTradeEvent {
  const eventType = closeReasonToEventType(input.reason);
  const lifecycleStatus = exitEventTypeToLifecycleStatus(eventType);
  const side: CanonicalTradeEvent["side"] = input.direction === "BULLISH" ? "CALL" : "PUT";
  const source: CanonicalTradeEvent["source"] =
    input.reason === "MANUAL_OVERRIDE" ? "manual" : "computed_from_kite";

  // stopLoss is a required, must-be-positive field on CanonicalTradeEvent, but
  // stopPremium can legitimately be null on older/edge-case paper trade rows.
  // Fall back to entryPremium (never fabricate a different number) and record
  // the fallback in `warnings` so it is never silently mistaken for a real SL.
  const warnings: string[] = [];
  let stopLoss = input.stopPremium;
  if (stopLoss == null || !Number.isFinite(stopLoss) || stopLoss <= 0) {
    stopLoss = input.entryPremium;
    warnings.push("StopLossUnavailable: stopPremium missing on this trade row, defaulted to entryPremium for display");
  }

  const quantity = input.lots * input.lotSize;
  const tradingSymbol = `${input.indexSymbol}${input.optionType ? ` ${input.optionType}` : ""}`;

  return {
    id: crypto.randomUUID(),
    domain: "FNO_INTRADAY",
    eventType,
    lifecycleStatus,
    signalId: null,
    orderId: null,
    paperTradeId: input.paperTradeId,
    symbol: input.indexSymbol,
    tradingSymbol,
    exchange: "INDEX",
    instrumentToken: null,
    assetType: "option",
    side,
    setupName: input.setupKey,
    confidence: null,
    entryPrice: input.entryPremium,
    stopLoss,
    target1: input.target1Premium ?? null,
    target2: null,
    exitPrice: input.exitPremium,
    exitReason: input.reason,
    quantity,
    capitalRequired: input.entryPremium * quantity,
    maxRisk: Math.abs(input.entryPremium - stopLoss) * quantity,
    riskPercent: null,
    riskReward: computeFnoRr(input.entryPremium, stopLoss, input.target1Premium),
    source,
    sourceStatus: "INFO_ONLY",
    sourceAsOf: input.exitedAt.toISOString(),
    canDriveSignals: false,
    canDriveTradeAlerts: false,
    brokerExecutionStatus: "DISABLED",
    paperTradeStatus: "CLOSED",
    environment: deriveFnoCanonicalEnvironment(),
    createdAt: input.openedAt.toISOString(),
    entryTime: input.openedAt.toISOString(),
    exitTime: input.exitedAt.toISOString(),
    appUrl: "/fno",
    warnings,
  };
}

const FNO_EXIT_DEST: NotificationDestination = "telegram_main";

/**
 * Fire the canonical EXIT_* alert pipeline for a closed F&O paper trade.
 *
 * Steps: validate → DB dedup → format → send → log delivery.
 * Safe-fail — never throws. All errors are caught and logged.
 */
async function dispatchFnoCanonicalExit(event: CanonicalTradeEvent, realizedPnl: number): Promise<void> {
  try {
    // 1. Canonical validation — blocks test env, test symbols, broker-live, etc.
    const validation = validateTradeEventForNotification(event, { destination: FNO_EXIT_DEST });
    if (!validation.allowed) {
      logger.info(
        { reason: validation.reason, symbol: event.symbol, paperTradeId: event.paperTradeId },
        `fnoSignalAlerts: EXIT blocked — ${validation.reason ?? "unknown"}`,
      );
      return;
    }

    // 2. DB-backed dedup — one exit alert per (domain, eventType, paperTradeId, destination).
    const isDuplicate = await hasAlreadyDelivered(
      event.domain,
      event.eventType,
      event,
      FNO_EXIT_DEST,
    );
    if (isDuplicate) {
      logger.info(
        { paperTradeId: event.paperTradeId, eventType: event.eventType },
        "fnoSignalAlerts: EXIT skipped — already delivered (DB dedup)",
      );
      return;
    }

    // 3. Canonical format — single formatter for all trade events.
    const text = formatTradeTelegramMessage(event);

    // 4. Send via existing alertOwnerRaw infrastructure.
    const dedupKey = `FNO_EXIT::${event.paperTradeId}::${event.eventType}`;
    const logMsg = `F&O exit: ${event.symbol} ${event.side} reason=${event.exitReason} pnl=${realizedPnl.toFixed(0)}`;
    alertOwnerRaw(dedupKey, logMsg, text, FNO_SIGNAL_DEDUP_MS);

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
      destination:  FNO_EXIT_DEST,
      messageHash:  hashMessage(text),
      status:       "SENT",
      errorCode:    null,
      errorMessage: null,
      sentAt:       new Date().toISOString(),
      environment:  event.environment,
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message },
      "fnoSignalAlerts: dispatchFnoCanonicalExit unexpected error (safe-fail)",
    );
  }
}

/**
 * @deprecated LEGACY — superseded by buildFnoExitCanonicalEvent + formatTradeTelegramMessage
 * (canonical Telegram migration, 2026-07-02). No longer called from the production dispatch
 * path (alertFnoExitSignal -> dispatchFnoCanonicalExit). Retained only because
 * tradeLifecycleParity.test.ts still exercises it directly as a pure formatter; do not wire
 * this back into any live send path.
 *
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
 * CANONICAL PIPELINE (2026-07-02): builds a CanonicalTradeEvent
 * (buildFnoExitCanonicalEvent) and dispatches it through the same
 * validate → DB dedup → format → send → log pipeline used by Swing Cash
 * and the F&O entry alert. See buildFnoExitCanonicalEvent's doc comment for
 * the INFO_ONLY / canDriveTradeAlerts=false data-trust rationale.
 *
 * Does NOT: place real orders, change signal logic, modify paper trade rows.
 */
export function alertFnoExitSignal(input: FnoExitAlertInput): void {
  try {
    const event = buildFnoExitCanonicalEvent(input);
    void dispatchFnoCanonicalExit(event, input.realizedPnl);
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message },
      "alertFnoExitSignal: unexpected error (safe-fail)",
    );
  }
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
 * Dedup window for the consolidated warmup-failure digest: at most one digest
 * Telegram message per IST calendar day (was: one message PER FAILING INDEX
 * every FNO_DATA_HEALTH_DEDUP_MS — see
 * docs/telegram-alert-quality-audit-2026-07-03.md, "F&O data warmup failed"
 * row). Multi-hour outages now resurface once/hour instead of once/10min/index.
 */
export const FNO_WARMUP_DIGEST_DEDUP_MS = 60 * 60 * 1000;

const FNO_WARMUP_DIGEST_IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function fnoWarmupDigestIstDay(now: number = Date.now()): string {
  return new Date(now + FNO_WARMUP_DIGEST_IST_OFFSET_MS).toISOString().slice(0, 10);
}

interface FnoWarmupFailingIndex {
  index: string;
  code: string | null;
  detail: string;
}

function buildFnoWarmupDigestText(
  alertType: FnoDataHealthAlertType,
  failing: FnoWarmupFailingIndex[],
): string {
  const title =
    alertType === "WARMUP_FAILED" ? "⚠ F&O DATA WARMUP FAILED" : "⚠ F&O DATA WARMUP PARTIAL";
  const lines = [
    title,
    "",
    `Indices affected: ${failing.length}`,
    ...failing.map((f) => `• ${f.index}: ${f.code ?? "UNKNOWN"} — ${f.detail}`),
    "",
    "Kite data did not warm up after login. F&O signals for the affected index(es)",
    "may be suppressed until data recovers. This is a data-health notice, not a signal.",
    "",
    "No paper trade created. No real order placed. Broker execution disabled.",
  ];
  return lines.join("\n");
}

/**
 * Inspect a completed warmup run and fire at most one CONSOLIDATED digest
 * alert covering every failing index (was: one alert per failing index,
 * every 10 minutes each — see docs/telegram-alert-quality-audit-2026-07-03.md).
 *
 * - Never alerts on OK or any SKIPPED_* outcome.
 * - Never alerts on SESSION_MISSING / TOKEN_MISSING — benign/expected state.
 * - Dedup key is scoped to the IST calendar day (`FNO_WARMUP_FAILED::<istDay>`),
 *   not per-index, with a 60-min window — so a multi-hour outage produces at
 *   most one digest per hour instead of a message storm per index per retry.
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
    const failing: FnoWarmupFailingIndex[] = [];
    for (const idx of result.indices) {
      if (idx.ok) continue;
      const firstFail = idx.steps.find((s) => !s.ok);
      if (!firstFail) continue;
      if (firstFail.code === "SESSION_MISSING" || firstFail.code === "TOKEN_MISSING") continue;
      failing.push({
        index: idx.index,
        code: firstFail.code,
        detail: firstFail.message ? `${firstFail.step}: ${firstFail.message}` : firstFail.step,
      });
    }
    if (failing.length === 0) return;

    const alertType: FnoDataHealthAlertType =
      result.outcome === "FAILED" ? "WARMUP_FAILED" : "WARMUP_PARTIAL";
    const dedupKey = `FNO_WARMUP_FAILED::${fnoWarmupDigestIstDay()}`;
    const logMsg = `F&O data-health digest: ${alertType} across ${failing.length} index(es) — ${failing
      .map((f) => f.index)
      .join(", ")}`;
    alertOwnerRaw(dedupKey, logMsg, buildFnoWarmupDigestText(alertType, failing), FNO_WARMUP_DIGEST_DEDUP_MS);
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message },
      "alertWarmupFailures: unexpected error (safe-fail)",
    );
  }
}
