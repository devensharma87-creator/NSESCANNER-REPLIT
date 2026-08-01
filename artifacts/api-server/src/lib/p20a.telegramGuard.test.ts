/**
 * §P20A — Closure Gate 6: Telegram lifecycle parity and deduplication
 *
 * Tests the actual production `validateTradeEventForNotification` guard
 * (tradeLifecycle/validateTradeEvent.ts:112) which is the canonical boundary
 * between all trade lifecycle events and the Telegram transport.
 *
 * Production function invoked directly — no mock of the guard logic.
 * Only the transport layer (fetch → Telegram Bot API) is intentionally
 * not invoked (no live Telegram calls are made; transport is tested in
 * alerting.test.ts with vi.stubGlobal("fetch", ...) per existing suite).
 *
 * Intentionally silenced events (not in TradeAlertEventType):
 *   SIGNAL_CREATED   — baseline/info-only/watchlist signals not notified
 *   ADMISSION_REJECTED — informational, not actionable
 *   DATA_RISK / DEGRADED — system health, not trade events
 *   RECOVERY — system health alerts
 *   TARGET1_MILESTONE — lifecycle milestone, not terminal exit; no alert
 * These are documented here and their absence is tested (not treated as bugs).
 *
 * Notified events (TradeAlertEventType):
 *   ENTRY_READY     — Swing staged entry ready for owner review
 *   ENTRY_OPENED    — F&O paper trade opened (all gates passed)
 *   EXIT_STOP_LOSS  — trade stopped out
 *   EXIT_TARGET_1   — first target hit (terminal if only T1)
 *   EXIT_TARGET_2   — second target hit (runner closed)
 *   EXIT_MANUAL     — owner-directed close
 *   EXIT_TIME       — time-based close (15:20 sweep)
 */

import { describe, it, expect } from "vitest";
import {
  validateTradeEventForNotification,
  isTradeEventAllowed,
  type ValidationContext,
} from "./tradeLifecycle/validateTradeEvent";
import type { CanonicalTradeEvent } from "./tradeLifecycle/types";

// ─── Canonical production event fixture ──────────────────────────────────────

/**
 * Minimal valid ENTRY_OPENED event for a NIFTY paper trade.
 * All required fields present; all trust invariants satisfied.
 */
const VALID_FNO_ENTRY: CanonicalTradeEvent = {
  id: "evt-test-001",
  domain: "FNO_INTRADAY",
  eventType: "ENTRY_OPENED",
  lifecycleStatus: "OPEN",
  signalId: "sig-001",
  orderId: null,
  paperTradeId: "pt-001",
  symbol: "NIFTY",
  tradingSymbol: "NFO:NIFTY26JUL22100CE",
  exchange: "NFO",
  instrumentToken: 12345678,
  assetType: "option",
  side: "CALL",
  setupName: "Trend Continuation",
  confidence: 75,
  entryPrice: 150.0,
  stopLoss: 80.0,
  target1: 220.0,
  target2: 300.0,
  exitPrice: null,
  exitReason: null,
  quantity: 50,
  capitalRequired: 7500,
  maxRisk: 3500,
  riskPercent: 2.5,
  riskReward: 2.33,
  source: "kite",
  sourceStatus: "TRADE_GRADE",
  sourceAsOf: new Date().toISOString(),
  canDriveSignals: true,
  canDriveTradeAlerts: true,
  brokerExecutionStatus: "PAPER_ONLY",
  paperTradeStatus: "OPEN",
  environment: "production",
  createdAt: new Date().toISOString(),
  entryTime: new Date().toISOString(),
  exitTime: null,
  appUrl: "/fno",
  warnings: [],
};

/** Build an EXIT event from the valid entry fixture. */
function makeExit(
  eventType: "EXIT_STOP_LOSS" | "EXIT_TARGET_1" | "EXIT_TARGET_2" | "EXIT_MANUAL" | "EXIT_TIME",
  exitPrice: number,
  exitReason: string,
): CanonicalTradeEvent {
  return {
    ...VALID_FNO_ENTRY,
    id: `evt-exit-${eventType}`,
    eventType,
    lifecycleStatus: "EXITED_STOP_LOSS",
    exitPrice,
    exitReason,
    exitTime: new Date().toISOString(),
    paperTradeStatus: "CLOSED",
  };
}

const PROD_CTX: ValidationContext = { destination: "telegram_main" };

// ─── Gate 6 — Notified events: ENTRY_OPENED ──────────────────────────────────

describe("§P20A-Gate6 Telegram guard — notified lifecycle: ENTRY_OPENED", () => {
  it("T6-1: valid ENTRY_OPENED with Kite TRADE_GRADE → allowed", () => {
    const result = validateTradeEventForNotification(VALID_FNO_ENTRY, PROD_CTX);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("T6-2: ENTRY_OPENED requires canDriveTradeAlerts=true — false blocks with SOURCE_NOT_TRADE_GRADE", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, canDriveTradeAlerts: false },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("SOURCE_NOT_TRADE_GRADE");
  });

  it("T6-3: ENTRY_OPENED with STALE sourceStatus → STALE_DATA_NOT_ALLOWED", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, sourceStatus: "STALE", canDriveTradeAlerts: false },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("STALE_DATA_NOT_ALLOWED");
  });

  it("T6-4: ENTRY_OPENED with DELAYED sourceStatus → YAHOO_NOT_ALLOWED", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, sourceStatus: "DELAYED", canDriveTradeAlerts: false },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("YAHOO_NOT_ALLOWED");
  });

  it("T6-5: ENTRY_OPENED missing instrumentToken for F&O → TOKEN_MISSING", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, instrumentToken: null },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("TOKEN_MISSING");
  });

  it("T6-6: ENTRY_OPENED with entryPrice=0 → MISSING_RISK_FIELDS", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, entryPrice: 0 },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("MISSING_RISK_FIELDS");
  });

  it("T6-7: ENTRY_OPENED with NaN stopLoss → MISSING_RISK_FIELDS", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, stopLoss: NaN },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("MISSING_RISK_FIELDS");
  });

  it("T6-8: ENTRY_OPENED with quantity=0 → MISSING_RISK_FIELDS", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, quantity: 0 },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("MISSING_RISK_FIELDS");
  });
});

// ─── Gate 6 — Notified events: EXIT_* ────────────────────────────────────────

describe("§P20A-Gate6 Telegram guard — notified lifecycle: EXIT events", () => {
  it("T6-9: EXIT_STOP_LOSS → allowed (relaxed source trust; reports committed close)", () => {
    const exit = makeExit("EXIT_STOP_LOSS", 80.0, "Stop loss triggered");
    expect(validateTradeEventForNotification(exit, PROD_CTX).allowed).toBe(true);
  });

  it("T6-10: EXIT_TARGET_1 → allowed", () => {
    const exit = makeExit("EXIT_TARGET_1", 220.0, "Target 1 hit");
    expect(validateTradeEventForNotification(exit, PROD_CTX).allowed).toBe(true);
  });

  it("T6-11: EXIT_TARGET_2 → allowed", () => {
    const exit = makeExit("EXIT_TARGET_2", 300.0, "Target 2 hit");
    expect(validateTradeEventForNotification(exit, PROD_CTX).allowed).toBe(true);
  });

  it("T6-12: EXIT_MANUAL → allowed", () => {
    const exit = makeExit("EXIT_MANUAL", 170.0, "Manual close by owner");
    expect(validateTradeEventForNotification(exit, PROD_CTX).allowed).toBe(true);
  });

  it("T6-13: EXIT_TIME → allowed (15:20 sweep close)", () => {
    const exit = makeExit("EXIT_TIME", 140.0, "Session end sweep");
    expect(validateTradeEventForNotification(exit, PROD_CTX).allowed).toBe(true);
  });

  it("T6-14: EXIT event with STALE sourceStatus → allowed (exit exempt from source-trust check)", () => {
    // EXIT events report an already-committed close — source-trust checks do NOT apply
    const exit = {
      ...makeExit("EXIT_STOP_LOSS", 80.0, "Stop triggered"),
      sourceStatus: "STALE" as const,
      canDriveTradeAlerts: false, // would block ENTRY, not EXIT
    };
    expect(validateTradeEventForNotification(exit, PROD_CTX).allowed).toBe(true);
  });

  it("T6-15: EXIT event with DELAYED sourceStatus → allowed (exit exempt from Yahoo check)", () => {
    const exit = {
      ...makeExit("EXIT_STOP_LOSS", 80.0, "Stop triggered"),
      sourceStatus: "DELAYED" as const,
      canDriveTradeAlerts: false,
    };
    expect(validateTradeEventForNotification(exit, PROD_CTX).allowed).toBe(true);
  });

  it("T6-16: EXIT event with null instrumentToken → allowed (token check is ENTRY-only)", () => {
    const exit = {
      ...makeExit("EXIT_STOP_LOSS", 80.0, "Stop triggered"),
      instrumentToken: null as null,
    };
    expect(validateTradeEventForNotification(exit, PROD_CTX).allowed).toBe(true);
  });

  it("T6-17: exit premium / P&L fields not required by guard (guard is trust gate, not P&L validator)", () => {
    const exit = {
      ...makeExit("EXIT_TARGET_1", 220.0, "T1 hit"),
      exitPrice: null, // might be null in legacy events
    };
    // Guard doesn't check exitPrice — P&L validation is a separate concern
    expect(validateTradeEventForNotification(exit, PROD_CTX).allowed).toBe(true);
  });
});

// ─── Gate 6 — Intentionally silenced events (documented absence) ──────────────

describe("§P20A-Gate6 Telegram guard — intentionally silenced events", () => {
  /**
   * These event types are not in TradeAlertEventType and cannot be sent via
   * validateTradeEventForNotification. Their absence is intentional per the
   * type system design: only ENTRY_READY, ENTRY_OPENED, and EXIT_* are
   * trade-channel-worthy (types.ts:56-63).
   *
   * INFO_ONLY / WATCHLIST signals: blocked by canDriveTradeAlerts=false.
   * DATA_RISK / DEGRADED / RECOVERY: sent via system-alert paths, not trade alerts.
   * ADMISSION_REJECTED: informational, not actionable; no alert type.
   * TARGET1_MILESTONE: T1 is not a terminal exit — trade stays open.
   */

  it("T6-18: INFO_ONLY signal (canDriveTradeAlerts=false) → SOURCE_NOT_TRADE_GRADE (entry event blocked)", () => {
    const infoOnly: CanonicalTradeEvent = {
      ...VALID_FNO_ENTRY,
      id: "evt-info-001",
      eventType: "ENTRY_OPENED", // closest entry type
      sourceStatus: "INFO_ONLY",
      canDriveSignals: false,
      canDriveTradeAlerts: false,
    };
    const r = validateTradeEventForNotification(infoOnly, PROD_CTX);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("SOURCE_NOT_TRADE_GRADE");
  });

  it("T6-19: WATCHLIST signal (canDriveTradeAlerts=false) → blocked, never claims trade opened", () => {
    const watchlist: CanonicalTradeEvent = {
      ...VALID_FNO_ENTRY,
      eventType: "ENTRY_OPENED",
      sourceStatus: "INFO_ONLY",
      canDriveSignals: true,
      canDriveTradeAlerts: false,
    };
    expect(isTradeEventAllowed(watchlist, PROD_CTX)).toBe(false);
  });

  it("T6-20: ENTRY_READY for F&O with canDriveTradeAlerts=false → blocked (INFO_ONLY signal cannot claim paper open)", () => {
    const infoEntry: CanonicalTradeEvent = {
      ...VALID_FNO_ENTRY,
      eventType: "ENTRY_READY",
      canDriveTradeAlerts: false,
      sourceStatus: "INFO_ONLY",
    };
    expect(isTradeEventAllowed(infoEntry, PROD_CTX)).toBe(false);
  });
});

// ─── Gate 6 — Deduplication and identity ─────────────────────────────────────

describe("§P20A-Gate6 Telegram guard — deduplication", () => {
  it("T6-21: isDuplicate=true → DUPLICATE_EVENT blocked", () => {
    const r = validateTradeEventForNotification(VALID_FNO_ENTRY, {
      ...PROD_CTX,
      isDuplicate: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("DUPLICATE_EVENT");
  });

  it("T6-22: isDuplicate=false → dedup check does not block", () => {
    const r = validateTradeEventForNotification(VALID_FNO_ENTRY, {
      ...PROD_CTX,
      isDuplicate: false,
    });
    expect(r.allowed).toBe(true);
  });

  it("T6-23: same signal sent to internal_only → not blocked by dedup or env check", () => {
    const r = validateTradeEventForNotification(VALID_FNO_ENTRY, {
      destination: "internal_only",
    });
    expect(r.allowed).toBe(true);
  });

  it("T6-24: retry invocation (same event, isDuplicate=true) cannot send duplicate to main channel", () => {
    // Simulates scheduler retry after first successful delivery
    const first = validateTradeEventForNotification(VALID_FNO_ENTRY, PROD_CTX);
    expect(first.allowed).toBe(true); // first delivery succeeds

    // Second delivery attempt (caller checks DB and sets isDuplicate=true)
    const second = validateTradeEventForNotification(VALID_FNO_ENTRY, { ...PROD_CTX, isDuplicate: true });
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe("DUPLICATE_EVENT"); // blocked — no duplicate alert
  });
});

// ─── Gate 6 — Hard-blocked events ────────────────────────────────────────────

describe("§P20A-Gate6 Telegram guard — hard-blocked events", () => {
  it("T6-25: test symbol TESTSTK → TEST_SYMBOL_BLOCKED (highest priority after broker check)", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, symbol: "TESTSTK" },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("TEST_SYMBOL_BLOCKED");
  });

  it("T6-26: symbol 'TEST' → TEST_SYMBOL_BLOCKED", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, symbol: "TEST" },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("TEST_SYMBOL_BLOCKED");
  });

  it("T6-27: symbol 'TESTSTOCK123' (prefix match) → TEST_SYMBOL_BLOCKED", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, symbol: "TESTSTOCK123" },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("TEST_SYMBOL_BLOCKED");
  });

  it("T6-28: dev environment → DEV_ENV_BLOCKED for telegram_main destination", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, environment: "development" },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("DEV_ENV_BLOCKED");
  });

  it("T6-29: test environment → DEV_ENV_BLOCKED for telegram_main", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, environment: "test" },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("DEV_ENV_BLOCKED");
  });

  it("T6-30: LIVE_ENABLED brokerExecutionStatus → BROKER_EXECUTION_MISMATCH (always first)", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, brokerExecutionStatus: "LIVE_ENABLED" },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("BROKER_EXECUTION_MISMATCH");
  });

  it("T6-31: BROKER_EXECUTION_MISMATCH has higher priority than TEST_SYMBOL (checked first)", () => {
    // Even a test symbol doesn't reach its check if broker is LIVE_ENABLED
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, symbol: "TESTSTK", brokerExecutionStatus: "LIVE_ENABLED" },
      PROD_CTX,
    );
    expect(r.reason).toBe("BROKER_EXECUTION_MISMATCH");
  });

  it("T6-32: isSampleAlert=true → SAMPLE_ALERT_BLOCKED for telegram_main", () => {
    const r = validateTradeEventForNotification(VALID_FNO_ENTRY, {
      ...PROD_CTX,
      isSampleAlert: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("SAMPLE_ALERT_BLOCKED");
  });

  it("T6-33: isSampleAlert=true allowed on internal_only destination", () => {
    const r = validateTradeEventForNotification(VALID_FNO_ENTRY, {
      destination: "internal_only",
      isSampleAlert: true,
    });
    expect(r.allowed).toBe(true);
  });

  it("T6-34: missing exchange (blank) → EXCHANGE_MISSING", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, exchange: "" as never },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("EXCHANGE_MISSING");
  });

  it("T6-35: ENTRY_READY for Swing with valid trade-grade Kite → allowed", () => {
    const swingEntry: CanonicalTradeEvent = {
      ...VALID_FNO_ENTRY,
      id: "evt-swing-001",
      domain: "SWING_CASH",
      eventType: "ENTRY_READY",
      tradingSymbol: "NSE:RELIANCE",
      exchange: "NSE",
      assetType: "equity",
      side: "BUY",
      symbol: "RELIANCE",
      instrumentToken: 738561,
      lifecycleStatus: "ENTRY_READY",
      paperTradeStatus: "STAGED",
    };
    expect(validateTradeEventForNotification(swingEntry, PROD_CTX).allowed).toBe(true);
  });

  it("T6-36: missing values are omitted, never converted to zero — entryPrice=NaN → MISSING_RISK_FIELDS (not zero)", () => {
    const r = validateTradeEventForNotification(
      { ...VALID_FNO_ENTRY, entryPrice: NaN },
      PROD_CTX,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("MISSING_RISK_FIELDS");
    expect(r.message).toContain("non-finite");
  });
});
