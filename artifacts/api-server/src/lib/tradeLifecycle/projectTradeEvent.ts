/**
 * projectTradeEventForUi — canonical UI projection for trade events.
 *
 * Part B of the Deterministic Parity Verification Harness.
 *
 * Single source of truth for what UI cards should display.
 * Both this projection and the Telegram formatter read from the same
 * CanonicalTradeEvent, so comparing their outputs proves field parity.
 *
 * PURE FUNCTION — no I/O, no side-effects, no async.
 *
 * Rules:
 *   - Telegram formatter reads CanonicalTradeEvent → produces text
 *   - UI projection reads CanonicalTradeEvent → produces structured object
 *   - compareTradeEventParity() compares both against canonical values
 *   - No calculation is duplicated: all values come from CanonicalTradeEvent
 */

import type { CanonicalTradeEvent } from "./types";

// ── UI Projection type ────────────────────────────────────────────────────────

export interface TradeEventUiProjection {
  eventId:              string;
  domain:               string;
  lifecycleStatus:      string;
  eventType:            string;

  signalId:             string | null;
  orderId:              string | null;
  paperTradeId:         string | null;

  symbol:               string;
  tradingSymbol:        string;
  exchange:             string;
  instrumentToken:      number | null;

  underlying:           string | null;
  contract:             string | null;
  strike:               number | null;
  optionType:           "CE" | "PE" | null;

  entry:                number;
  stopLoss:             number;
  target1:              number | null;
  target2:              number | null;
  exitPrice:            number | null;
  exitReason:           string | null;

  qty:                  number;
  lots:                 number | null;
  risk:                 number;
  riskPercent:          number | null;
  capitalRequired:      number;
  riskReward:           number | null;

  confidence:           number | null;
  source:               string;
  sourceStatus:         string;
  sourceAsOf:           string | null;
  canDriveSignals:      boolean;
  canDriveTradeAlerts:  boolean;

  brokerExecutionStatus: string;
  paperTradeStatus:      string;
  environment:           string;

  createdAt:            string;
  entryTime:            string | null;
  exitTime:             string | null;

  warnings:             string[];
}

// ── Known F&O lot sizes (for lots calculation in projection) ──────────────────

const FNO_LOT_SIZES: Readonly<Record<string, number>> = {
  NIFTY:      75,
  BANKNIFTY:  30,
  SENSEX:     20,
  FINNIFTY:   65,
  MIDCPNIFTY: 120,
};

// ── Parse helpers (pure, no throw) ────────────────────────────────────────────

/**
 * Parse numeric strike from a trading symbol.
 * e.g. "NFO:NIFTY26JUL25000CE" → 25000
 * e.g. "NIFTY26JUL25000CE"     → 25000
 */
function parseStrike(tradingSymbol: string): number | null {
  const m = tradingSymbol.match(/(\d{4,6})(CE|PE)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parse option type from a trading symbol.
 * Returns "CE" | "PE" | null.
 */
function parseOptionType(tradingSymbol: string): "CE" | "PE" | null {
  if (/CE$/i.test(tradingSymbol)) return "CE";
  if (/PE$/i.test(tradingSymbol)) return "PE";
  return null;
}

/**
 * Calculate number of lots from qty and symbol's lot size.
 * Returns null if lot size is unknown or qty is not a clean multiple.
 */
function parseLots(symbol: string, qty: number): number | null {
  const lotSize = FNO_LOT_SIZES[symbol.toUpperCase()];
  if (!lotSize || !Number.isFinite(qty) || qty <= 0) return null;
  const lots = qty / lotSize;
  return Number.isInteger(lots) ? lots : null;
}

// ── Projection ─────────────────────────────────────────────────────────────────

/**
 * Project a CanonicalTradeEvent into the shape UI trade cards should display.
 *
 * Pure function — accepts one CanonicalTradeEvent, returns one TradeEventUiProjection.
 * No computation is duplicated: all values come directly from the canonical event.
 *
 * The Telegram formatter reads the same CanonicalTradeEvent.
 * compareTradeEventParity() validates both surfaces agree with canonical values.
 *
 * @param event - The canonical trade event to project.
 * @returns Structured UI projection ready for display comparison.
 */
export function projectTradeEventForUi(event: CanonicalTradeEvent): TradeEventUiProjection {
  const isFno = event.domain === "FNO_INTRADAY";

  return {
    eventId:              event.id,
    domain:               event.domain,
    lifecycleStatus:      event.lifecycleStatus,
    eventType:            event.eventType,

    signalId:             event.signalId,
    orderId:              event.orderId,
    paperTradeId:         event.paperTradeId,

    symbol:               event.symbol,
    tradingSymbol:        event.tradingSymbol,
    exchange:             event.exchange,
    instrumentToken:      event.instrumentToken,

    underlying:           isFno ? event.symbol : null,
    contract:             isFno ? event.tradingSymbol : null,
    strike:               isFno ? parseStrike(event.tradingSymbol) : null,
    optionType:           isFno ? parseOptionType(event.tradingSymbol) : null,

    entry:                event.entryPrice,
    stopLoss:             event.stopLoss,
    target1:              event.target1,
    target2:              event.target2,
    exitPrice:            event.exitPrice,
    exitReason:           event.exitReason,

    qty:                  event.quantity,
    lots:                 isFno ? parseLots(event.symbol, event.quantity) : null,
    risk:                 event.maxRisk,
    riskPercent:          event.riskPercent,
    capitalRequired:      event.capitalRequired,
    riskReward:           event.riskReward,

    confidence:           event.confidence,
    source:               event.source,
    sourceStatus:         event.sourceStatus,
    sourceAsOf:           event.sourceAsOf,
    canDriveSignals:      event.canDriveSignals,
    canDriveTradeAlerts:  event.canDriveTradeAlerts,

    brokerExecutionStatus: event.brokerExecutionStatus,
    paperTradeStatus:      event.paperTradeStatus,
    environment:           event.environment,

    createdAt:            event.createdAt,
    entryTime:            event.entryTime,
    exitTime:             event.exitTime,

    warnings:             event.warnings,
  };
}
