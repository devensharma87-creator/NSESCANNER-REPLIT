/**
 * Unit tests for the tradeLifecycle canonical event system.
 *
 * Covers:
 *   – validateTradeEventForNotification: all 12 block reason codes
 *   – formatTradeTelegramMessage: entry/exit formats for SWING_CASH and FNO_INTRADAY
 *   – hashMessage: deterministic hashing
 *   – buildDedupKey: correct key construction
 */

import { describe, it, expect } from "vitest";
import { validateTradeEventForNotification } from "./validateTradeEvent";
import { formatTradeTelegramMessage } from "./formatTelegramMessage";
import { hashMessage, buildDedupKey } from "./notificationLog";
import type { CanonicalTradeEvent } from "./types";

// ── Test fixtures ──────────────────────────────────────────────────────────────

function makeSwingEntry(overrides: Partial<CanonicalTradeEvent> = {}): CanonicalTradeEvent {
  return {
    id:                    "evt-001",
    domain:                "SWING_CASH",
    eventType:             "ENTRY_READY",
    lifecycleStatus:       "ENTRY_READY",
    signalId:              null,
    orderId:               "ord-001",
    paperTradeId:          null,
    symbol:                "RELIANCE",
    tradingSymbol:         "NSE:RELIANCE",
    exchange:              "NSE",
    instrumentToken:       738561,
    assetType:             "equity",
    side:                  "BUY",
    setupName:             "Breakout_Pullback",
    confidence:            null,
    entryPrice:            1400.00,
    stopLoss:              1344.00,
    target1:               1512.00,
    target2:               1568.00,
    exitPrice:             null,
    exitReason:            null,
    quantity:              3,
    capitalRequired:       4200.00,
    maxRisk:               168.00,
    riskPercent:           0.168,
    riskReward:            2.00,
    source:                "kite",
    sourceStatus:          "TRADE_GRADE",
    sourceAsOf:            "2026-07-02T09:03:00.000Z",
    canDriveSignals:       true,
    canDriveTradeAlerts:   true,
    brokerExecutionStatus: "DISABLED",
    paperTradeStatus:      "STAGED",
    environment:           "production",
    createdAt:             "2026-07-02T09:03:00.000Z",
    entryTime:             null,
    exitTime:              null,
    appUrl:                "/swing-queue",
    warnings:              [],
    ...overrides,
  };
}

function makeFnoEntry(overrides: Partial<CanonicalTradeEvent> = {}): CanonicalTradeEvent {
  return {
    id:                    "evt-002",
    domain:                "FNO_INTRADAY",
    eventType:             "ENTRY_OPENED",
    lifecycleStatus:       "OPEN",
    signalId:              "sig-001",
    orderId:               null,
    paperTradeId:          "pt-001",
    symbol:                "NIFTY",
    tradingSymbol:         "NFO:NIFTY26JUL25000CE",
    exchange:              "NFO",
    instrumentToken:       11374850,
    assetType:             "option",
    side:                  "CALL",
    setupName:             "VOL_BREAKOUT",
    confidence:            72,
    entryPrice:            250.00,
    stopLoss:              175.00,
    target1:               375.00,
    target2:               450.00,
    exitPrice:             null,
    exitReason:            null,
    quantity:              750,
    capitalRequired:       187500.00,
    maxRisk:               56250.00,
    riskPercent:           0.5625,
    riskReward:            1.67,
    source:                "kite",
    sourceStatus:          "TRADE_GRADE",
    sourceAsOf:            "2026-07-02T09:05:00.000Z",
    canDriveSignals:       true,
    canDriveTradeAlerts:   true,
    brokerExecutionStatus: "PAPER_ONLY",
    paperTradeStatus:      "OPEN",
    environment:           "production",
    createdAt:             "2026-07-02T09:05:00.000Z",
    entryTime:             "2026-07-02T09:05:00.000Z",
    exitTime:              null,
    appUrl:                "/fno",
    warnings:              [],
    ...overrides,
  };
}

// ── validateTradeEventForNotification ─────────────────────────────────────────

describe("validateTradeEventForNotification", () => {

  it("allows a clean production swing entry", () => {
    const result = validateTradeEventForNotification(makeSwingEntry());
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("allows a clean production F&O entry", () => {
    const result = validateTradeEventForNotification(makeFnoEntry());
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("blocks BROKER_EXECUTION_MISMATCH when LIVE_ENABLED", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry({ brokerExecutionStatus: "LIVE_ENABLED" }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("BROKER_EXECUTION_MISMATCH");
  });

  it("blocks TEST_SYMBOL_BLOCKED for TESTSTK", () => {
    const result = validateTradeEventForNotification(makeSwingEntry({ symbol: "TESTSTK" }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TEST_SYMBOL_BLOCKED");
  });

  it("blocks TEST_SYMBOL_BLOCKED for TEST (exact match)", () => {
    const result = validateTradeEventForNotification(makeSwingEntry({ symbol: "TEST" }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TEST_SYMBOL_BLOCKED");
  });

  it("blocks TEST_SYMBOL_BLOCKED for TESTSTOCK (prefix match)", () => {
    const result = validateTradeEventForNotification(makeSwingEntry({ symbol: "TESTSTOCK" }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TEST_SYMBOL_BLOCKED");
  });

  it("blocks TEST_SYMBOL_BLOCKED for SAMPLE (exact match)", () => {
    const result = validateTradeEventForNotification(makeSwingEntry({ symbol: "SAMPLE" }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TEST_SYMBOL_BLOCKED");
  });

  it("blocks TEST_SYMBOL_BLOCKED for DUMMY (exact match)", () => {
    const result = validateTradeEventForNotification(makeSwingEntry({ symbol: "DUMMY" }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TEST_SYMBOL_BLOCKED");
  });

  it("does NOT block valid symbols like TATAMOTORS (not a test symbol)", () => {
    const result = validateTradeEventForNotification(makeSwingEntry({ symbol: "TATAMOTORS" }));
    expect(result.allowed).toBe(true);
  });

  it("blocks SAMPLE_ALERT_BLOCKED when isSampleAlert=true to telegram_main", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry(),
      { destination: "telegram_main", isSampleAlert: true },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("SAMPLE_ALERT_BLOCKED");
  });

  it("allows sample alert to internal_only destination", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry(),
      { destination: "internal_only", isSampleAlert: true },
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks DEV_ENV_BLOCKED when environment=development and destination=telegram_main", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry({ environment: "development" }),
      { destination: "telegram_main" },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("DEV_ENV_BLOCKED");
  });

  it("blocks DEV_ENV_BLOCKED when environment=test and destination=telegram_main", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry({ environment: "test" }),
      { destination: "telegram_main" },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("DEV_ENV_BLOCKED");
  });

  it("allows development event to internal_only", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry({ environment: "development" }),
      { destination: "internal_only" },
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks EXCHANGE_MISSING when exchange is empty", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry({ exchange: "" as "NSE" }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("EXCHANGE_MISSING");
  });

  it("blocks MISSING_RISK_FIELDS when entryPrice is 0", () => {
    const result = validateTradeEventForNotification(makeSwingEntry({ entryPrice: 0 }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("MISSING_RISK_FIELDS");
  });

  it("blocks MISSING_RISK_FIELDS when stopLoss is NaN", () => {
    const result = validateTradeEventForNotification(makeSwingEntry({ stopLoss: NaN }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("MISSING_RISK_FIELDS");
  });

  it("blocks MISSING_RISK_FIELDS when quantity is 0", () => {
    const result = validateTradeEventForNotification(makeSwingEntry({ quantity: 0 }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("MISSING_RISK_FIELDS");
  });

  it("blocks STALE_DATA_NOT_ALLOWED when sourceStatus=STALE", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry({ sourceStatus: "STALE", canDriveSignals: false, canDriveTradeAlerts: false }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("STALE_DATA_NOT_ALLOWED");
  });

  it("blocks YAHOO_NOT_ALLOWED when sourceStatus=DELAYED", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry({ sourceStatus: "DELAYED", canDriveSignals: false, canDriveTradeAlerts: false }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("YAHOO_NOT_ALLOWED");
  });

  it("blocks SOURCE_NOT_TRADE_GRADE when sourceStatus=INFO_ONLY", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry({ sourceStatus: "INFO_ONLY", canDriveSignals: false, canDriveTradeAlerts: false }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("SOURCE_NOT_TRADE_GRADE");
  });

  it("blocks SOURCE_NOT_TRADE_GRADE when canDriveTradeAlerts=false", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry({ canDriveTradeAlerts: false }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("SOURCE_NOT_TRADE_GRADE");
  });

  it("blocks TOKEN_MISSING for F&O option with null token", () => {
    const result = validateTradeEventForNotification(
      makeFnoEntry({ instrumentToken: null }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TOKEN_MISSING");
  });

  it("does NOT block TOKEN_MISSING for equity with null token", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry({ instrumentToken: null }),
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks DUPLICATE_EVENT when isDuplicate=true", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry(),
      { isDuplicate: true },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("DUPLICATE_EVENT");
  });

  it("blocks INSTRUMENT_NOT_FOUND when source=missing", () => {
    const result = validateTradeEventForNotification(
      makeSwingEntry({ source: "missing" }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("INSTRUMENT_NOT_FOUND");
  });

});

// ── formatTradeTelegramMessage ─────────────────────────────────────────────────

describe("formatTradeTelegramMessage", () => {

  it("swing entry: starts with SWING CASH ENTRY READY emoji header", () => {
    const text = formatTradeTelegramMessage(makeSwingEntry());
    expect(text).toContain("SWING CASH ENTRY READY");
    expect(text).toContain("RELIANCE");
    expect(text).toContain("NSE");
  });

  it("swing entry: includes all required price fields", () => {
    const text = formatTradeTelegramMessage(makeSwingEntry());
    expect(text).toContain("Entry: ₹1,400.00");
    expect(text).toContain("SL: ₹1,344.00");
    expect(text).toContain("Target 1: ₹1,512.00");
    expect(text).toContain("Target 2: ₹1,568.00");
    expect(text).toContain("Qty: 3");
  });

  it("swing entry: includes broker execution disabled statement", () => {
    const text = formatTradeTelegramMessage(makeSwingEntry());
    expect(text).toContain("Broker execution DISABLED");
    expect(text).toContain("Manual review required. This is not auto-executed.");
  });

  it("swing entry: includes ID", () => {
    const text = formatTradeTelegramMessage(makeSwingEntry());
    expect(text).toContain("ord-001");
  });

  it("swing entry: includes source and data-as-of", () => {
    const text = formatTradeTelegramMessage(makeSwingEntry());
    expect(text).toContain("Kite / Trade-grade");
    expect(text).toContain("Data as of:");
  });

  it("swing exit TARGET_1: correct exit header", () => {
    const event = makeSwingEntry({
      eventType:       "EXIT_TARGET_1",
      lifecycleStatus: "EXITED_TARGET_1",
      exitPrice:       1512.00,
      exitReason:      "Target 1 Hit",
      entryTime:       "2026-07-02T08:03:00.000Z",
      exitTime:        "2026-07-02T09:42:00.000Z",
      paperTradeStatus: "CLOSED",
    });
    const text = formatTradeTelegramMessage(event);
    expect(text).toContain("TARGET 1 HIT");
    expect(text).toContain("Exit: ₹1,512.00");
    expect(text).toContain("P&L:");
  });

  it("swing exit STOP_LOSS: correct exit header", () => {
    const event = makeSwingEntry({
      eventType:       "EXIT_STOP_LOSS",
      lifecycleStatus: "EXITED_STOP_LOSS",
      exitPrice:       1344.00,
      exitReason:      "Stop-loss triggered",
      entryTime:       "2026-07-02T08:03:00.000Z",
      exitTime:        "2026-07-02T08:45:00.000Z",
      paperTradeStatus: "CLOSED",
    });
    const text = formatTradeTelegramMessage(event);
    expect(text).toContain("STOP-LOSS TRIGGERED");
  });

  it("fno entry: starts with F&O TRADEABLE SIGNAL", () => {
    const text = formatTradeTelegramMessage(makeFnoEntry());
    expect(text).toContain("F&O TRADEABLE SIGNAL");
    expect(text).toContain("NIFTY");
  });

  it("fno entry: includes premium prices", () => {
    const text = formatTradeTelegramMessage(makeFnoEntry());
    expect(text).toContain("₹250.00");
    expect(text).toContain("₹175.00");
  });

  it("fno entry: includes broker disabled statement", () => {
    const text = formatTradeTelegramMessage(makeFnoEntry());
    expect(text).toContain("Broker execution: DISABLED");
    expect(text).toContain("Manual review required. This is not auto-executed.");
  });

  it("fno entry: does NOT contain 'n/a' for non-null fields", () => {
    const text = formatTradeTelegramMessage(makeFnoEntry());
    expect(text).not.toContain("n/a");
  });

  it("fno exit TARGET_2: correct exit header", () => {
    const event = makeFnoEntry({
      eventType:       "EXIT_TARGET_2",
      lifecycleStatus: "EXITED_TARGET_2",
      exitPrice:       450.00,
      exitReason:      "Target 2 Hit",
      exitTime:        "2026-07-02T13:00:00.000Z",
      paperTradeStatus: "CLOSED",
    });
    const text = formatTradeTelegramMessage(event);
    expect(text).toContain("TARGET 2 HIT");
  });

  it("shows — for null target2", () => {
    const event = makeSwingEntry({ target2: null });
    const text = formatTradeTelegramMessage(event);
    expect(text).not.toContain("Target 2: ₹");
  });

  it("includes warnings when present", () => {
    const event = makeSwingEntry({ warnings: ["DataAgeWarning: 45s old"] });
    const text = formatTradeTelegramMessage(event);
    expect(text).toContain("DataAgeWarning: 45s old");
  });

});

// ── hashMessage ────────────────────────────────────────────────────────────────

describe("hashMessage", () => {
  it("produces a 16-char hex string", () => {
    const h = hashMessage("hello world");
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic", () => {
    const h1 = hashMessage("test message");
    const h2 = hashMessage("test message");
    expect(h1).toBe(h2);
  });

  it("differs for different inputs", () => {
    expect(hashMessage("msg1")).not.toBe(hashMessage("msg2"));
  });
});

// ── buildDedupKey ──────────────────────────────────────────────────────────────

describe("buildDedupKey", () => {
  it("prefers orderId over paperTradeId", () => {
    const key = buildDedupKey(
      "SWING_CASH",
      "ENTRY_READY",
      { orderId: "ord-1", paperTradeId: "pt-1", signalId: null, id: "evt-1" },
      "telegram_main",
    );
    expect(key).toContain("ord-1");
    expect(key).not.toContain("pt-1");
  });

  it("falls back to paperTradeId when orderId is null", () => {
    const key = buildDedupKey(
      "FNO_INTRADAY",
      "ENTRY_OPENED",
      { orderId: null, paperTradeId: "pt-1", signalId: "sig-1", id: "evt-1" },
      "telegram_main",
    );
    expect(key).toContain("pt-1");
  });

  it("falls back to id when all others are null", () => {
    const key = buildDedupKey(
      "SWING_CASH",
      "ENTRY_READY",
      { orderId: null, paperTradeId: null, signalId: null, id: "evt-999" },
      "telegram_main",
    );
    expect(key).toContain("evt-999");
  });

  it("includes domain, eventType, and destination", () => {
    const key = buildDedupKey(
      "SWING_CASH",
      "EXIT_STOP_LOSS",
      { orderId: "ord-2", paperTradeId: null, signalId: null, id: "evt-2" },
      "telegram_main",
    );
    expect(key).toContain("SWING_CASH");
    expect(key).toContain("EXIT_STOP_LOSS");
    expect(key).toContain("telegram_main");
  });
});
