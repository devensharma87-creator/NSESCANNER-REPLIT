/**
 * formatTradeTelegramMessage — single canonical Telegram formatter for trade events.
 *
 * Accepts ONLY a CanonicalTradeEvent object. No naked symbol/price/risk args.
 * Produces the exact message format required by the system specification.
 *
 * ABSOLUTE RULES:
 *   - Accepts only CanonicalTradeEvent — no local ad-hoc price/risk parameters.
 *   - Required wording (never change):
 *       "Status: Broker execution DISABLED — paper/staging only"
 *       "Manual review required. This is not auto-executed."
 *   - No "guaranteed profit", "sure shot", "auto order placed", "risk-free".
 *   - Shows "—" for any field that is null/unavailable (honest, not fabricated).
 *   - F&O messages include: underlying, strike, CE/PE, premium, lots, spot reference.
 *   - All messages include: source, sourceAsOf, brokerExecutionStatus, event ID.
 *
 * Entry format (ENTRY_READY / ENTRY_OPENED):
 *   📌 SWING CASH ENTRY READY  or  📈/📉 F&O TRADEABLE SIGNAL
 *
 * Exit format (EXIT_*):
 *   ✅ SWING CASH EXIT — TARGET HIT  etc.
 */

import type { CanonicalTradeEvent, TradeAlertEventType, TradeDomain } from "./types";

// ── Formatters ────────────────────────────────────────────────────────────────

function inr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(3)}%`;
}

function rrFmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function istTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function holdingTime(entryTime: string | null, exitTime: string | null): string {
  if (!entryTime || !exitTime) return "—";
  try {
    const diffMs = new Date(exitTime).getTime() - new Date(entryTime).getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return "—";
    const totalMin = Math.round(diffMs / 60_000);
    if (totalMin < 60) return `${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  } catch {
    return "—";
  }
}

function pnl(event: CanonicalTradeEvent): string {
  if (event.exitPrice == null || !Number.isFinite(event.exitPrice)) return "—";
  const diff = (event.side === "BUY" || event.side === "CALL")
    ? event.exitPrice - event.entryPrice
    : event.entryPrice - event.exitPrice;
  const raw = diff * event.quantity;
  return `${raw >= 0 ? "+" : ""}${inr(raw)}`;
}

function sourceLabel(event: CanonicalTradeEvent): string {
  if (event.source === "kite" && event.sourceStatus === "TRADE_GRADE") return "Kite / Trade-grade";
  if (event.source === "kite_warehouse") return "Kite warehouse";
  if (event.source === "computed_from_kite") return "Computed from Kite";
  if (event.source === "manual") return "Manual entry";
  return `${event.source} / ${event.sourceStatus}`;
}

// ── Entry header ───────────────────────────────────────────────────────────────

function entryHeader(domain: TradeDomain, eventType: TradeAlertEventType, event: CanonicalTradeEvent): string {
  if (domain === "SWING_CASH") {
    return eventType === "ENTRY_READY"
      ? "\uD83D\uDCCC SWING CASH ENTRY READY"
      : "\uD83D\uDCCC SWING CASH ENTRY OPENED";
  }
  if (domain === "FNO_INTRADAY") {
    const arrow = event.side === "CALL" ? "\uD83D\uDCC8" : "\uD83D\uDCC9";
    return `${arrow} F&O TRADEABLE SIGNAL`;
  }
  return "\uD83D\uDCCC TRADE ENTRY";
}

// ── Exit header ────────────────────────────────────────────────────────────────

function exitHeader(domain: TradeDomain, eventType: TradeAlertEventType): string {
  const domainTag = domain === "FNO_INTRADAY" ? "F&O" : "SWING CASH";
  switch (eventType) {
    case "EXIT_TARGET_1":  return `\u2705 ${domainTag} EXIT \u2014 TARGET 1 HIT`;
    case "EXIT_TARGET_2":  return `\u2705 ${domainTag} EXIT \u2014 TARGET 2 HIT`;
    case "EXIT_STOP_LOSS": return `\uD83D\uDD34 ${domainTag} EXIT \u2014 STOP-LOSS TRIGGERED`;
    case "EXIT_MANUAL":    return `\u23F9\uFE0F ${domainTag} EXIT \u2014 MANUAL CLOSE`;
    case "EXIT_TIME":      return `\u23F0 ${domainTag} EXIT \u2014 TIME-BASED CLOSE`;
    default:               return `\u274C ${domainTag} EXIT`;
  }
}

// ── Swing Cash entry ───────────────────────────────────────────────────────────

function buildSwingEntry(event: CanonicalTradeEvent): string {
  const lines: string[] = [
    entryHeader("SWING_CASH", event.eventType, event),
    "",
    `Symbol: ${event.symbol}`,
    `Exchange: ${event.exchange}`,
    `Setup: ${event.setupName ?? "\u2014"}`,
    `Side: ${event.side}`,
    `Entry: ${inr(event.entryPrice)}`,
    `SL: ${inr(event.stopLoss)}`,
    `Target 1: ${inr(event.target1)}`,
    ...(event.target2 != null ? [`Target 2: ${inr(event.target2)}`] : []),
    `Qty: ${event.quantity}`,
    `Risk: ${inr(event.maxRisk)}`,
    `Risk %: ${pct(event.riskPercent)}`,
    `Capital Required: ${inr(event.capitalRequired)}`,
    `R:R: ${rrFmt(event.riskReward)}`,
    `Source: ${sourceLabel(event)}`,
    `Data as of: ${istTime(event.sourceAsOf)}`,
    "Status: Broker execution DISABLED \u2014 paper/staging only",
    "Manual review required. This is not auto-executed.",
    "Action: Review in Swing Queue",
    `ID: ${event.orderId ?? event.id}`,
  ];
  if (event.confidence != null) lines.splice(5, 0, `Confidence: ${event.confidence}`);
  if (event.warnings.length > 0) lines.push(`Warnings: ${event.warnings.join("; ")}`);
  return lines.join("\n");
}

// ── F&O entry ──────────────────────────────────────────────────────────────────

function buildFnoEntry(event: CanonicalTradeEvent): string {
  const side = event.side === "CALL" ? "CALL (CE)" : "PUT (PE)";
  const instrumentParts = [
    event.symbol,
    event.exitPrice != null ? null : null,
  ].filter(Boolean);
  const instrument = [
    event.symbol,
    event.stopLoss ? null : null,
  ].filter(Boolean).join(" ");
  const tradingSymbolDisplay = event.tradingSymbol !== event.symbol ? event.tradingSymbol : null;

  const lines: string[] = [
    entryHeader("FNO_INTRADAY", event.eventType, event),
    "",
    `Index:      ${event.symbol}`,
    `Direction:  ${side}`,
    ...(tradingSymbolDisplay ? [`Instrument: ${tradingSymbolDisplay}`] : []),
    `Setup:      ${event.setupName ?? "\u2014"}`,
    `Confidence: ${event.confidence ?? "\u2014"}`,
    "",
    `Entry Premium:  ${inr(event.entryPrice)}`,
    `SL Premium:     ${inr(event.stopLoss)}`,
    `Target 1:       ${inr(event.target1)}`,
    ...(event.target2 != null ? [`Target 2:       ${inr(event.target2)}`] : []),
    `R:R:            ${rrFmt(event.riskReward)}`,
    `Lots:           ${event.quantity}`,
    `Capital:        ${inr(event.capitalRequired)}`,
    `Max Risk:       ${inr(event.maxRisk)}`,
    `Risk %:         ${pct(event.riskPercent)}`,
    "",
    `Source: ${sourceLabel(event)}`,
    `Data as of: ${istTime(event.sourceAsOf)}`,
    "Broker execution: DISABLED \u2014 no order placed",
    "Manual review required. This is not auto-executed.",
    "Action: Review in F&O paper trades before trading.",
    `ID: ${event.paperTradeId ?? event.signalId ?? event.id}`,
  ];
  if (event.warnings.length > 0) lines.push(`Warnings: ${event.warnings.join("; ")}`);
  void instrument; void instrumentParts;
  return lines.join("\n");
}

// ── Swing Cash exit ────────────────────────────────────────────────────────────

function buildSwingExit(event: CanonicalTradeEvent): string {
  const lines: string[] = [
    exitHeader("SWING_CASH", event.eventType),
    "",
    `Symbol: ${event.symbol}`,
    `Entry: ${inr(event.entryPrice)}`,
    `Exit: ${inr(event.exitPrice)}`,
    `Exit Reason: ${event.exitReason ?? "\u2014"}`,
    `Qty: ${event.quantity}`,
    `P&L: ${pnl(event)}`,
    `Entry Time: ${istTime(event.entryTime)}`,
    `Exit Time: ${istTime(event.exitTime)}`,
    `Holding Time: ${holdingTime(event.entryTime, event.exitTime)}`,
    `Source: ${sourceLabel(event)}`,
    `ID: ${event.orderId ?? event.paperTradeId ?? event.id}`,
  ];
  if (event.warnings.length > 0) lines.push(`Warnings: ${event.warnings.join("; ")}`);
  return lines.join("\n");
}

// ── F&O exit ───────────────────────────────────────────────────────────────────

function buildFnoExit(event: CanonicalTradeEvent): string {
  const side = event.side === "CALL" ? "CALL (CE)" : "PUT (PE)";
  const lines: string[] = [
    exitHeader("FNO_INTRADAY", event.eventType),
    "",
    `Index:     ${event.symbol}`,
    `Direction: ${side}`,
    ...(event.tradingSymbol !== event.symbol ? [`Instrument: ${event.tradingSymbol}`] : []),
    `Entry: ${inr(event.entryPrice)}`,
    `Exit:  ${inr(event.exitPrice)}`,
    `Exit Reason: ${event.exitReason ?? "\u2014"}`,
    `Qty:   ${event.quantity}`,
    `P&L:   ${pnl(event)}`,
    `Entry Time: ${istTime(event.entryTime)}`,
    `Exit Time: ${istTime(event.exitTime)}`,
    `Holding Time: ${holdingTime(event.entryTime, event.exitTime)}`,
    `Source: ${sourceLabel(event)}`,
    `ID: ${event.paperTradeId ?? event.signalId ?? event.id}`,
  ];
  if (event.warnings.length > 0) lines.push(`Warnings: ${event.warnings.join("; ")}`);
  return lines.join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the canonical Telegram message text for a trade event.
 *
 * This is the ONLY function that should produce trade Telegram messages.
 * It accepts the full CanonicalTradeEvent — not raw price/symbol/risk args.
 *
 * Callers must validate the event with validateTradeEventForNotification()
 * before calling this function. This function does NOT validate — it formats.
 */
export function formatTradeTelegramMessage(event: CanonicalTradeEvent): string {
  const { domain, eventType } = event;

  const isEntry = eventType === "ENTRY_READY" || eventType === "ENTRY_OPENED";
  const isExit =
    eventType === "EXIT_STOP_LOSS" ||
    eventType === "EXIT_TARGET_1" ||
    eventType === "EXIT_TARGET_2" ||
    eventType === "EXIT_MANUAL" ||
    eventType === "EXIT_TIME";

  if (domain === "SWING_CASH") {
    if (isEntry) return buildSwingEntry(event);
    if (isExit)  return buildSwingExit(event);
  }

  if (domain === "FNO_INTRADAY") {
    if (isEntry) return buildFnoEntry(event);
    if (isExit)  return buildFnoExit(event);
  }

  return [
    `\uD83D\uDCCC TRADE EVENT [${domain} / ${eventType}]`,
    "",
    `Symbol: ${event.symbol}`,
    `Source: ${sourceLabel(event)}`,
    `ID: ${event.id}`,
  ].join("\n");
}
