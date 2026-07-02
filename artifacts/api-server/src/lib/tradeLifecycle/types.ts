/**
 * Canonical trade event types for the Indian Stock Market Scanner.
 *
 * Single source of truth for trade domain, lifecycle status, and alert event
 * types used across F&O, Swing Cash, Paper Trading, Telegram alerts, and
 * pre/post market reports.
 *
 * ABSOLUTE RULES:
 *   - No signal logic, no scoring, no thresholds here.
 *   - No broker execution. brokerExecutionStatus must always be "DISABLED" or "PAPER_ONLY".
 *   - canDriveTradeAlerts is true ONLY when sourceStatus is "TRADE_GRADE".
 *   - environment must accurately reflect the runtime environment.
 *   - All consumers must use this type — not local ad-hoc event shapes.
 */

// ── Domain ─────────────────────────────────────────────────────────────────────

export type TradeDomain = "SWING_CASH" | "FNO_INTRADAY";

// ── Lifecycle ──────────────────────────────────────────────────────────────────

export type TradeLifecycleStatus =
  | "CANDIDATE"
  | "ENTRY_READY"
  | "ENTRY_APPROVAL_REQUIRED"
  | "ENTRY_APPROVED"
  | "OPEN"
  | "REJECTED"
  | "EXPIRED_NO_ENTRY"
  | "EXITED_STOP_LOSS"
  | "EXITED_TARGET_1"
  | "EXITED_TARGET_2"
  | "EXITED_MANUAL"
  | "EXITED_TIME"
  | "CANCELLED";

// ── Alert event types (trade-channel-worthy only) ──────────────────────────────

/**
 * Trade alert event types that are permitted on the main Telegram trade channel.
 *
 * ALLOWED:
 *   ENTRY_READY   — Swing Cash: a valid entry is staged and ready for owner review
 *   ENTRY_OPENED  — F&O: a tradeable paper trade was opened (all gates passed)
 *   EXIT_*        — Any domain: position exited (stop, target, manual, time)
 *
 * NOT ALLOWED on the main trade channel (use internal diagnostics instead):
 *   - Staged order created (duplicate with ENTRY_READY)
 *   - Manual approval required as a separate message
 *   - Dry-run recorded (not a real trade open)
 *   - Order expired/rejected (informational, not actionable)
 *   - Warmup failures, session missing (system health alerts)
 *   - Baseline/info-only/watchlist signals
 *   - Test/sample/dummy events
 */
export type TradeAlertEventType =
  | "ENTRY_READY"
  | "ENTRY_OPENED"
  | "EXIT_STOP_LOSS"
  | "EXIT_TARGET_1"
  | "EXIT_TARGET_2"
  | "EXIT_MANUAL"
  | "EXIT_TIME";

// ── Canonical trade event ──────────────────────────────────────────────────────

export interface CanonicalTradeEvent {
  /** Unique event ID (UUID). Different from orderId/signalId/paperTradeId. */
  id: string;

  /** Trading domain — determines which Telegram format and which lifecycle rules apply. */
  domain: TradeDomain;

  /** Trade-channel-worthy alert event type. */
  eventType: TradeAlertEventType;

  /** Full lifecycle status at the time of event emission. */
  lifecycleStatus: TradeLifecycleStatus;

  /** Signal ID from paper_signal table, or null for Swing Cash events. */
  signalId: string | null;

  /** Staging order ID from swing_order_staging table, or null for F&O events. */
  orderId: string | null;

  /** Paper trade row ID from paper_trade_fo or paper_trade_eq, or null. */
  paperTradeId: string | null;

  /** NSE trading symbol (e.g. "RELIANCE", "NIFTY"). */
  symbol: string;

  /** Exchange-qualified trading symbol (e.g. "NSE:RELIANCE", "NFO:NIFTY26JUL25000CE"). */
  tradingSymbol: string;

  /** Exchange where the instrument is listed. */
  exchange: "NSE" | "BSE" | "NFO" | "BFO" | "INDEX";

  /** Kite instrument token, or null if unknown. */
  instrumentToken: number | null;

  /** Asset type — determines pricing and sizing semantics. */
  assetType: "equity" | "index" | "future" | "option";

  /** Side of the trade. Equity: BUY/SELL. Options: CALL/PUT. */
  side: "BUY" | "SELL" | "CALL" | "PUT";

  /** Human-readable setup/strategy name (e.g. "Breakout_Swing_Long"), or null. */
  setupName: string | null;

  /** Integer confidence score (0–100), or null if not applicable. */
  confidence: number | null;

  /** Entry price (equity share price or option premium ₹/share). */
  entryPrice: number;

  /** Stop-loss price (equity share price or option premium ₹/share). */
  stopLoss: number;

  /** Target 1 price, or null if not set. */
  target1: number | null;

  /** Target 2 price, or null if not set. */
  target2: number | null;

  /** Exit price (on exit events), or null on entry events. */
  exitPrice: number | null;

  /** Human-readable exit reason (e.g. "Target 1 Hit", "Stop-loss triggered"), or null. */
  exitReason: string | null;

  /** Quantity (shares for equity, shares = lots × lotSize for F&O). */
  quantity: number;

  /** Capital deployed (entry × quantity for equity; premium × quantity for F&O). */
  capitalRequired: number;

  /** Maximum risk (|entry − stopLoss| × quantity). */
  maxRisk: number;

  /** Risk as a percentage of paper account capital, or null if unavailable. */
  riskPercent: number | null;

  /** Reward-to-risk ratio (target1 − entry) / (entry − stopLoss), or null if unavailable. */
  riskReward: number | null;

  /**
   * Data source used for this event's prices.
   *   kite            — live Kite REST/WebSocket (trade-grade)
   *   kite_warehouse  — Kite-sourced candles from the candle warehouse
   *   computed_from_kite — derived from Kite data (e.g. synthetic premium)
   *   manual          — owner-entered price (review queue)
   *   missing         — source could not be determined
   */
  source: "kite" | "kite_warehouse" | "computed_from_kite" | "manual" | "missing";

  /**
   * Source trustworthiness status (mirrors homeMarketPulseSourceMap contract).
   *   TRADE_GRADE  — live Kite, not stale, not fallback; eligible for trade alerts
   *   INFO_ONLY    — secondary/delayed source; label but do not trade on
   *   DELAYED      — Yahoo Finance or similar; not trade-grade
   *   STALE        — source is too old; must not drive trade alerts
   *   UNAVAILABLE  — no data; omit value, do not fabricate
   *   ERROR        — fetch failed; surface diagnostic, not fabricated data
   */
  sourceStatus: "TRADE_GRADE" | "INFO_ONLY" | "DELAYED" | "STALE" | "UNAVAILABLE" | "ERROR";

  /** ISO-8601 timestamp of the data source snapshot, or null if unknown. */
  sourceAsOf: string | null;

  /**
   * True only when sourceStatus === "TRADE_GRADE" AND this signal category
   * is eligible to drive trade decisions (Kite-only, not Yahoo, not stale).
   */
  canDriveSignals: boolean;

  /**
   * True only when canDriveSignals is true AND the event type is trade-channel-worthy
   * (ENTRY_READY, ENTRY_OPENED, or EXIT_*).
   *
   * INVARIANT: canDriveTradeAlerts === true requires sourceStatus === "TRADE_GRADE".
   * Yahoo, delayed, stale, or manual sources must never set this to true.
   */
  canDriveTradeAlerts: boolean;

  /**
   * Broker execution status — must always be DISABLED or PAPER_ONLY in this system.
   * LIVE_ENABLED is included for completeness but must never appear in production.
   */
  brokerExecutionStatus: "DISABLED" | "PAPER_ONLY" | "LIVE_ENABLED";

  /** Paper trade status at the time of event emission. */
  paperTradeStatus: "NONE" | "STAGED" | "OPEN" | "CLOSED" | "DRY_RUN";

  /** Runtime environment — used by validateTradeEventForNotification to block dev/test events. */
  environment: "production" | "development" | "test";

  /** ISO-8601 timestamp of the signal/order creation. */
  createdAt: string;

  /** ISO-8601 timestamp of actual trade entry (fill time), or null if not yet entered. */
  entryTime: string | null;

  /** ISO-8601 timestamp of trade exit, or null if still open. */
  exitTime: string | null;

  /** App URL deep-link to the relevant page (e.g. "/swing-queue", "/fno"). */
  appUrl: string;

  /**
   * Non-blocking warnings about data quality, staleness, or partial failures.
   * Empty array when clean. Never null.
   */
  warnings: string[];
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Reason codes returned when validateTradeEventForNotification blocks an event.
 *
 * Each code maps to a specific block condition. The reason is written to the
 * notification_delivery_log and surfaced in diagnostics.
 */
export type ValidationBlockReason =
  | "TEST_SYMBOL_BLOCKED"        // symbol matches test/sample/dummy pattern
  | "INSTRUMENT_NOT_FOUND"       // symbol not in Kite instrument master
  | "EXCHANGE_MISSING"           // exchange field is empty or invalid
  | "TOKEN_MISSING"              // instrumentToken required but null/missing
  | "SOURCE_NOT_TRADE_GRADE"     // sourceStatus !== "TRADE_GRADE"
  | "YAHOO_NOT_ALLOWED"          // source indicates Yahoo/delayed data
  | "STALE_DATA_NOT_ALLOWED"     // sourceStatus is STALE
  | "DEV_ENV_BLOCKED"            // environment is "development" or "test" and destination is production
  | "SAMPLE_ALERT_BLOCKED"       // event originated from a test/sample endpoint
  | "MISSING_RISK_FIELDS"        // entryPrice, stopLoss, or quantity is 0/missing
  | "DUPLICATE_EVENT"            // same domain+eventType+orderId/signalId already delivered
  | "BROKER_EXECUTION_MISMATCH"; // brokerExecutionStatus is LIVE_ENABLED (never allowed)

export interface ValidationResult {
  allowed: boolean;
  reason: ValidationBlockReason | null;
  message: string | null;
}

// ── Notification delivery ─────────────────────────────────────────────────────

export type NotificationDestination = "telegram_main" | "telegram_prepost" | "internal_only";

export interface NotificationDeliveryEntry {
  eventId: string;
  domain: TradeDomain;
  eventType: TradeAlertEventType;
  signalId: string | null;
  orderId: string | null;
  paperTradeId: string | null;
  symbol: string;
  exchange: string;
  destination: NotificationDestination;
  messageHash: string;
  status: "SENT" | "BLOCKED" | "FAILED" | "DUPLICATE";
  errorCode: ValidationBlockReason | string | null;
  errorMessage: string | null;
  sentAt: string | null;
  environment: "production" | "development" | "test";
}
