/**
 * tradeLifecycleParity.test.ts
 *
 * Production verification tests for the canonical trade lifecycle pipeline.
 * Verifies that Swing and F&O alert paths:
 *   1. Block test symbols (TEST_SYMBOL_BLOCKED)
 *   2. Block non-production environments (DEV_ENV_BLOCKED)
 *   3. Dispatch correctly in production with valid data
 *   4. Never send Telegram for expired/rejected/dryrun/blocked lifecycle events
 *   5. Never imply broker execution is enabled
 *   6. F&O entry and exit alerts apply the same canonical gates
 *
 * alertOwnerRaw is mocked — no real Telegram is ever touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  alertSwingOrderStaged,
  alertSwingOrderExpired,
  alertSwingOrderRejected,
  alertSwingOrderApprovedDryRun,
  alertSwingOrderBlockedByRisk,
  resetLastSwingAlertRecord,
} from "./swingAlerts";
import {
  alertFnoTradeableSignal,
  alertFnoExitSignal,
  resetFnoSignalAlertState,
  buildFnoSignalAlertText,
  buildFnoExitAlertText,
  shouldSendFnoTradeAlert,
} from "./fnoSignalAlerts";
import { alertOwnerRaw, resetAlertDedup, resetLastAlertRecord } from "./alerting";
import type { SwingOrderStagingRow } from "@workspace/db/schema";
import type { FnoTradeAlertInput, FnoExitAlertInput } from "./fnoSignalAlerts";

// ── Mock alerting globally ────────────────────────────────────────────────────

vi.mock("./alerting", () => ({
  alertOwnerRaw: vi.fn(),
  resetAlertDedup: vi.fn(),
  resetLastAlertRecord: vi.fn(),
}));

vi.mock("./tradeLifecycle/notificationLog", () => ({
  hasAlreadyDelivered: vi.fn(() => Promise.resolve(false)),
  logNotificationDelivery: vi.fn(() => Promise.resolve(undefined)),
  hashMessage: vi.fn(() => "mock-hash"),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSwingRow(overrides: Partial<SwingOrderStagingRow> = {}): SwingOrderStagingRow {
  return {
    id: "parity-order-001",
    ownerKey: "owner",
    symbol: "TATASTEEL",
    exchange: "NSE",
    tradingSymbol: "TATASTEEL",
    instrumentToken: null,
    side: "BUY",
    productType: "CNC",
    orderType: "LIMIT",
    entryPrice: 150,
    limitPrice: 150,
    stopLoss: 140,
    target1: 170,
    target2: 185,
    quantity: 100,
    capitalRequired: 15000,
    maxRisk: 1000,
    riskPercent: 0.67,
    sector: "Metals",
    setupKey: "Breakout_Swing_Long",
    signalId: null,
    dataSource: "kite",
    dataAsOf: new Date("2026-07-01T09:30:00Z"),
    status: "STAGED",
    approvalStatus: "PENDING",
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    executionMode: "live_staged_approval",
    brokerStatus: "BROKER_DISABLED",
    brokerOrderId: null,
    brokerResponseJson: null,
    eventRiskStatus: null,
    manualReviewRequired: false,
    resultDateKnown: null,
    resultDate: null,
    corporateActionRisk: null,
    candidateSnapshotJson: null as unknown as SwingOrderStagingRow["candidateSnapshotJson"],
    riskDecisionJson: null,
    recheckDecisionJson: null,
    missedOpportunityJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const NOW = new Date();

function makeFnoEntry(overrides: Partial<FnoTradeAlertInput> = {}): FnoTradeAlertInput {
  return {
    indexSymbol:    "NIFTY",
    direction:      "BULLISH",
    setupKey:       "NIFTY_BULL_RSI_BREAK",
    signalDate:     "2026-07-01",
    confidence:     72,
    entryPremium:   125,
    stopPremium:    80,
    target1Premium: 200,
    target2Premium: 280,
    lots:           10,
    lotSize:        75,
    strike:         24500,
    expiry:         "2026-07-31",
    optionType:     "CE",
    openedAt:       new Date(Date.now() - 30_000), // 30 seconds ago → fresh
    paperTradeId:   "pt-nifty-001",
    ...overrides,
  };
}

function makeFnoExit(overrides: Partial<FnoExitAlertInput> = {}): FnoExitAlertInput {
  return {
    paperTradeId:   "pt-nifty-002",
    indexSymbol:    "BANKNIFTY",
    direction:      "BEARISH",
    setupKey:       "BNF_BEAR_ENGULF",
    signalDate:     "2026-07-01",
    optionType:     "PE",
    entryPremium:   200,
    exitPremium:    140,
    stopPremium:    250,
    target1Premium: 130,
    lots:           5,
    lotSize:        30,
    realizedPnl:    -9000,
    reason:         "STOPPED",
    openedAt:       new Date(Date.now() - 2 * 60 * 60 * 1000),
    exitedAt:       NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(alertOwnerRaw).mockClear();
  vi.mocked(resetAlertDedup).mockClear();
  vi.mocked(resetLastAlertRecord).mockClear();
  resetLastSwingAlertRecord();
  resetFnoSignalAlertState();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Swing: DEV_ENV_BLOCKED ────────────────────────────────────────────────────

describe("Swing: DEV_ENV_BLOCKED (test environment)", () => {
  it("alertSwingOrderStaged does NOT dispatch in test environment (default NODE_ENV)", async () => {
    alertSwingOrderStaged(makeSwingRow());
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("alertSwingOrderStaged does NOT dispatch when NODE_ENV=development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    alertSwingOrderStaged(makeSwingRow());
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });
});

// ── Swing: TEST_SYMBOL_BLOCKED ────────────────────────────────────────────────

describe("Swing: TEST_SYMBOL_BLOCKED", () => {
  const testSymbols = ["TESTSTK", "TEST", "TESTSTOCK", "SAMPLE", "DUMMY", "FAKE", "MOCK"];
  for (const sym of testSymbols) {
    it(`blocks ${sym} even in production`, async () => {
      vi.stubEnv("NODE_ENV", "production");
      alertSwingOrderStaged(makeSwingRow({ symbol: sym }));
      await new Promise(r => setTimeout(r, 100));
      expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
    });
  }
});

// ── Swing: production dispatch ────────────────────────────────────────────────

describe("Swing: production dispatch", () => {
  it("dispatches ENTRY_READY for STAGED row with kite dataSource in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeSwingRow());
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(1);
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("SWING CASH ENTRY READY");
    expect(text).toContain("TATASTEEL");
  });

  it("dispatches ENTRY_READY for APPROVAL_REQUIRED row (ONE alert, no separate approval msg)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeSwingRow({ status: "APPROVAL_REQUIRED" }));
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(1);
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("SWING CASH ENTRY READY");
  });

  it("does NOT dispatch for yahoo dataSource (SOURCE_NOT_TRADE_GRADE)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeSwingRow({ dataSource: "yahoo" }));
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("canonical message always says broker execution DISABLED", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeSwingRow());
    await new Promise(r => setTimeout(r, 100));
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("Broker execution DISABLED");
    expect(text).not.toContain("LIVE_ENABLED");
    expect(text).not.toContain("Buy Now");
    expect(text).not.toContain("guaranteed profit");
    expect(text).not.toContain("auto order placed");
  });

  it("canonical message says manual review required", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeSwingRow());
    await new Promise(r => setTimeout(r, 100));
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("Manual review required");
  });
});

// ── Swing: lifecycle-only events suppress Telegram ───────────────────────────

describe("Swing: lifecycle-only events — NO Telegram", () => {
  it("alertSwingOrderExpired does NOT dispatch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderExpired(makeSwingRow());
    await new Promise(r => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("alertSwingOrderRejected does NOT dispatch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderRejected(makeSwingRow());
    await new Promise(r => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("alertSwingOrderApprovedDryRun does NOT dispatch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderApprovedDryRun(makeSwingRow());
    await new Promise(r => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("alertSwingOrderBlockedByRisk does NOT dispatch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderBlockedByRisk("TATASTEEL", "setup", ["HARD_BLOCK"]);
    await new Promise(r => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });
});

// ── Swing: no-throw safety ────────────────────────────────────────────────────

describe("Swing: no-throw safety", () => {
  it("all swing alert functions never throw", () => {
    const row = makeSwingRow();
    expect(() => alertSwingOrderStaged(row)).not.toThrow();
    expect(() => alertSwingOrderExpired(row)).not.toThrow();
    expect(() => alertSwingOrderRejected(row)).not.toThrow();
    expect(() => alertSwingOrderApprovedDryRun(row)).not.toThrow();
    expect(() => alertSwingOrderBlockedByRisk("X", null, [])).not.toThrow();
  });
});

// ── F&O: DEV_ENV_BLOCKED ──────────────────────────────────────────────────────

describe("F&O entry: DEV_ENV_BLOCKED", () => {
  it("alertFnoTradeableSignal does NOT dispatch in test environment", async () => {
    alertFnoTradeableSignal(makeFnoEntry());
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("alertFnoTradeableSignal does NOT dispatch when NODE_ENV=development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    alertFnoTradeableSignal(makeFnoEntry());
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });
});

// ── F&O: production dispatch ──────────────────────────────────────────────────

describe("F&O entry: production dispatch", () => {
  it("dispatches in production for fresh valid F&O trade", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoTradeableSignal(makeFnoEntry());
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(1);
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("F&O TRADEABLE SIGNAL");
    expect(text).toContain("NIFTY");
    expect(text).toContain("DISABLED");
  });

  it("message always says broker execution DISABLED", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoTradeableSignal(makeFnoEntry());
    await new Promise(r => setTimeout(r, 100));
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("Broker execution: DISABLED");
    expect(text).not.toContain("LIVE_ENABLED");
    expect(text).not.toContain("guaranteed profit");
  });

  it("stale trade (opened > 5 min ago) does NOT dispatch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const staleEntry = makeFnoEntry({ openedAt: new Date(Date.now() - 10 * 60 * 1000) });
    alertFnoTradeableSignal(staleEntry);
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("does not throw regardless of input", () => {
    expect(() => alertFnoTradeableSignal(makeFnoEntry())).not.toThrow();
  });
});

// ── F&O: TEST_SYMBOL_BLOCKED ──────────────────────────────────────────────────

describe("F&O: TEST_SYMBOL_BLOCKED", () => {
  it("blocks TEST index symbol in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoTradeableSignal(makeFnoEntry({ indexSymbol: "TESTSTK" }));
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });
});

// ── F&O exit: DEV_ENV_BLOCKED ─────────────────────────────────────────────────

describe("F&O exit: DEV_ENV_BLOCKED", () => {
  it("alertFnoExitSignal does NOT dispatch in test environment", async () => {
    alertFnoExitSignal(makeFnoExit());
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });
});

// ── F&O exit: production dispatch ─────────────────────────────────────────────

describe("F&O exit: production dispatch", () => {
  it("dispatches exit alert in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoExitSignal(makeFnoExit());
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(1);
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("STOP-LOSS TRIGGERED");
    expect(text).toContain("BANKNIFTY");
    expect(text).toContain("DISABLED");
  });

  it("EXIT_TARGET_1 produces target header", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoExitSignal(makeFnoExit({ reason: "TARGET1_HIT", realizedPnl: 6000 }));
    await new Promise(r => setTimeout(r, 100));
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("TARGET 1 HIT");
  });

  it("EXIT_TARGET_2 produces target header", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoExitSignal(makeFnoExit({ reason: "TARGET2_HIT", realizedPnl: 12000 }));
    await new Promise(r => setTimeout(r, 100));
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("TARGET 2 HIT");
  });

  it("TIME_EXIT_1520 produces time-based close header", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoExitSignal(makeFnoExit({ reason: "TIME_EXIT_1520", realizedPnl: -1000 }));
    await new Promise(r => setTimeout(r, 100));
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("TIME-BASED CLOSE");
  });

  it("exit message always says broker execution DISABLED", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoExitSignal(makeFnoExit());
    await new Promise(r => setTimeout(r, 100));
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("Broker execution: DISABLED");
    expect(text).not.toContain("LIVE_ENABLED");
  });

  it("does not throw regardless of input", () => {
    expect(() => alertFnoExitSignal(makeFnoExit())).not.toThrow();
  });
});

// ── Pure-format function tests ────────────────────────────────────────────────

describe("buildFnoSignalAlertText — pure format", () => {
  it("contains required wording", () => {
    const text = buildFnoSignalAlertText(makeFnoEntry());
    expect(text).toContain("F&O TRADEABLE SIGNAL");
    expect(text).toContain("Broker execution: DISABLED — no order placed");
    expect(text).toContain("Manual review required. This is not auto-executed.");
    expect(text).toContain("Action: Review in F&O paper trades before trading.");
  });

  it("never implies guaranteed profit or auto-executed order", () => {
    const text = buildFnoSignalAlertText(makeFnoEntry());
    expect(text).not.toMatch(/guaranteed|sure.shot|auto.order.placed|risk.free|blindly/i);
  });
});

describe("buildFnoExitAlertText — pure format", () => {
  it("STOPPED exit shows stop-loss header and paper trade ID", () => {
    const text = buildFnoExitAlertText(makeFnoExit());
    expect(text).toContain("STOP-LOSS TRIGGERED");
    expect(text).toContain("pt-nifty-002");
    expect(text).toContain("DISABLED");
  });

  it("positive P&L shows plus sign", () => {
    const text = buildFnoExitAlertText(makeFnoExit({ reason: "TARGET1_HIT", realizedPnl: 4500 }));
    expect(text).toContain("+");
    expect(text).toContain("4,500");
  });

  it("negative P&L shows loss correctly", () => {
    const text = buildFnoExitAlertText(makeFnoExit({ realizedPnl: -9000 }));
    expect(text).toContain("9,000");
  });
});

// ── shouldSendFnoTradeAlert — pure eligibility ────────────────────────────────

describe("shouldSendFnoTradeAlert — pure eligibility function", () => {
  it("returns true for a fresh valid trade", () => {
    expect(shouldSendFnoTradeAlert(makeFnoEntry())).toBe(true);
  });

  it("returns false when openedAt > 5 min ago", () => {
    const stale = makeFnoEntry({ openedAt: new Date(Date.now() - 6 * 60 * 1000) });
    expect(shouldSendFnoTradeAlert(stale)).toBe(false);
  });

  it("returns false when entryPremium <= 0", () => {
    expect(shouldSendFnoTradeAlert(makeFnoEntry({ entryPremium: 0 }))).toBe(false);
    expect(shouldSendFnoTradeAlert(makeFnoEntry({ entryPremium: -10 }))).toBe(false);
  });

  it("returns false when lots <= 0", () => {
    expect(shouldSendFnoTradeAlert(makeFnoEntry({ lots: 0 }))).toBe(false);
  });

  it("returns false when confidence <= 0", () => {
    expect(shouldSendFnoTradeAlert(makeFnoEntry({ confidence: 0 }))).toBe(false);
  });
});
