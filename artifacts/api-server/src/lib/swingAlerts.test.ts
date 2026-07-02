/**
 * Tests for swingAlerts.ts — Swing Cash staged-order Telegram alerts.
 *
 * POST CANONICAL-WIRING BEHAVIOR (2026-07-02):
 *   alertSwingOrderStaged → canonical ENTRY_READY pipeline (validate → dedup → format → send)
 *   alertSwingOrderExpired / Rejected / ApprovedDryRun / BlockedByRisk → logger.info ONLY, NO Telegram
 *
 * alertOwnerRaw is mocked globally — no real Telegram is ever touched.
 * Dispatch tests stub NODE_ENV="production" to exercise the full production path.
 * All pure-function format tests (buildSwingOrderText, buildSwingBlockedText) are unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildSwingOrderText,
  buildSwingBlockedText,
  alertSwingOrderStaged,
  alertSwingOrderExpired,
  alertSwingOrderRejected,
  alertSwingOrderApprovedDryRun,
  alertSwingOrderBlockedByRisk,
  getLastSwingAlertRecord,
  resetLastSwingAlertRecord,
} from "./swingAlerts";
import { alertOwnerRaw, resetAlertDedup, resetLastAlertRecord } from "./alerting";
import type { SwingOrderStagingRow } from "@workspace/db/schema";

// ── Mock alerting to prevent any real Telegram calls ─────────────────────────
// alertOwnerRaw is the only dispatch entry-point; mocking it makes tests safe
// regardless of NODE_ENV, token stubs, or network availability.

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

function makeRow(overrides: Partial<SwingOrderStagingRow> = {}): SwingOrderStagingRow {
  const base: SwingOrderStagingRow = {
    id: "test-uuid-1234",
    ownerKey: "owner",
    symbol: "RELIANCE",
    exchange: "NSE",
    tradingSymbol: "RELIANCE",
    instrumentToken: null,
    side: "BUY",
    productType: "CNC",
    orderType: "LIMIT",
    entryPrice: 2450,
    limitPrice: 2450,
    stopLoss: 2350,
    target1: 2650,
    target2: 2800,
    quantity: 10,
    capitalRequired: 24500,
    maxRisk: 1000,
    riskPercent: 0.5,
    sector: "Energy",
    setupKey: "Breakout_Swing_Long",
    signalId: null,
    dataSource: "kite",
    dataAsOf: new Date("2025-06-15T10:00:00Z"),
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
    expiredAt: null,
    expiryReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(alertOwnerRaw).mockClear();
  vi.mocked(resetAlertDedup).mockClear();
  vi.mocked(resetLastAlertRecord).mockClear();
  resetLastSwingAlertRecord(); // also clears in-process dedup map
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ── buildSwingOrderText ───────────────────────────────────────────────────────

describe("buildSwingOrderText — message format", () => {
  it("contains header, symbol, setup, prices, and broker-disabled notice", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow());
    expect(text).toContain("SWING CASH ALERT");
    expect(text).toContain("Order staged for approval");
    expect(text).toContain("RELIANCE");
    expect(text).toContain("Breakout_Swing_Long");
    expect(text).toContain("₹2,450.00");
    expect(text).toContain("₹2,350.00");
    expect(text).toContain("₹2,650.00");
    expect(text).toContain("Qty: 10");
    expect(text).toContain("Broker execution DISABLED");
    expect(text).toContain("Review in Swing Live Queue");
  });

  it("shows target2 when present", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow({ target2: 2800 }));
    expect(text).toContain("₹2,800.00");
  });

  it("omits target2 line when null", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow({ target2: null }));
    expect(text).not.toContain("Target 2");
  });

  it("shows sector", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow({ sector: "Financial Services" }));
    expect(text).toContain("Sector: Financial Services");
  });

  it("falls back to n/a for missing sector", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow({ sector: null }));
    expect(text).toContain("Sector: n/a");
  });

  it("shows APPROVAL_REQUIRED label for that event", () => {
    const text = buildSwingOrderText("SWING_ORDER_APPROVAL_REQUIRED", makeRow());
    expect(text).toContain("Manual approval required");
  });

  it("shows EXPIRED label for expired event", () => {
    const text = buildSwingOrderText("SWING_ORDER_EXPIRED", makeRow());
    expect(text).toContain("Staged order expired");
  });

  it("shows REJECTED label for rejected event", () => {
    const text = buildSwingOrderText("SWING_ORDER_REJECTED", makeRow());
    expect(text).toContain("Order rejected");
  });

  it("shows DRY_RUN label for approved dry-run event", () => {
    const text = buildSwingOrderText("SWING_ORDER_APPROVED_DRY_RUN", makeRow());
    expect(text).toContain("dry-run");
  });

  it("computes R:R correctly for clean plan", () => {
    // entry=2450, stop=2350, target1=2650 → reward=200, risk=100 → R:R=2.00
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow());
    expect(text).toContain("R:R: 2.00");
  });

  it("shows n/a R:R when risk <= 0 (stop >= entry)", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow({ stopLoss: 2500 }));
    expect(text).toContain("R:R: n/a");
  });

  it("never contains token-like secret patterns", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow());
    expect(text).not.toMatch(/bot:[a-zA-Z0-9]+/);
    expect(text).not.toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(text).not.toMatch(/SESSION_SECRET|APP_ACCESS_PASSWORD/);
  });

  it("always says broker execution disabled regardless of row.brokerStatus", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow({ brokerStatus: "DRY_RUN" }));
    expect(text).toContain("Broker execution DISABLED");
  });

  // ── Data-source honesty ──────────────────────────────────────────────────────

  it("labels data line as 'Risk eval:' not bare 'Data: kite'", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow());
    expect(text).not.toMatch(/^Data: kite$/m);
    expect(text).toContain("Risk eval:");
  });

  it("includes a note that entry is the staged limit order price", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow());
    expect(text).toContain("staged limit order price");
    expect(text).toContain("not current market price");
  });

  it("APPROVAL_REQUIRED message also carries the limit-price note", () => {
    const text = buildSwingOrderText("SWING_ORDER_APPROVAL_REQUIRED", makeRow());
    expect(text).toContain("Risk eval:");
    expect(text).toContain("staged limit order price");
  });

  it("EXPIRED message also carries the limit-price note", () => {
    const text = buildSwingOrderText("SWING_ORDER_EXPIRED", makeRow());
    expect(text).toContain("Risk eval:");
    expect(text).toContain("staged limit order price");
  });
});

// ── buildSwingBlockedText ─────────────────────────────────────────────────────

describe("buildSwingBlockedText — blocked message", () => {
  it("contains header, symbol, setup, and blocked-by reasons", () => {
    const text = buildSwingBlockedText("TATASTEEL", "Breakout_Swing_Long", ["NOT_STAGEABLE_HARD_BLOCK"]);
    expect(text).toContain("SWING CASH ALERT");
    expect(text).toContain("Staging blocked by risk guard");
    expect(text).toContain("TATASTEEL");
    expect(text).toContain("NOT_STAGEABLE_HARD_BLOCK");
    expect(text).toContain("Broker execution DISABLED");
    expect(text).toContain("not actionable by owner");
  });

  it("falls back to 'risk guard' label when reasons array is empty", () => {
    const text = buildSwingBlockedText("INFY", null, []);
    expect(text).toContain("Blocked by: risk guard");
  });
});

// ── alertSwingOrderStaged — canonical ENTRY_READY dispatch ────────────────────

describe("alertSwingOrderStaged — canonical ENTRY_READY dispatch", () => {
  it("dispatches ENTRY_READY via alertOwnerRaw in production environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeRow());
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(1);
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).toContain("SWING CASH ENTRY READY");
    expect(text).toContain("RELIANCE");
    expect(text).toContain("Broker execution DISABLED");
    expect(text).toContain("Manual review required");
  });

  it("sends ONE ENTRY_READY alert for APPROVAL_REQUIRED status (unified, no duplicate)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeRow({ status: "APPROVAL_REQUIRED" }));
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(1);
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    // Canonical format says ENTRY_READY — not a separate "Manual approval required" alert
    expect(text).toContain("SWING CASH ENTRY READY");
  });

  it("in-process dedup prevents second send for same order within window", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const row = makeRow();
    alertSwingOrderStaged(row);
    alertSwingOrderStaged(row); // same orderId → in-process dedup blocks second call
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(1);
  });

  it("fires for two different order IDs (separate dedup keys)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeRow({ id: "order-A" }));
    alertSwingOrderStaged(makeRow({ id: "order-B" }));
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(2);
  });

  it("blocks dispatch in test environment — DEV_ENV_BLOCKED (no NODE_ENV=production stub)", async () => {
    // NODE_ENV defaults to "test" in vitest — the canonical pipeline blocks this
    alertSwingOrderStaged(makeRow());
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("blocks dispatch for TESTSTK symbol even in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeRow({ symbol: "TESTSTK" }));
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("blocks dispatch when dataSource is not kite (SOURCE_NOT_TRADE_GRADE)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeRow({ dataSource: "yahoo" }));
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("does not throw when called with any row", () => {
    expect(() => alertSwingOrderStaged(makeRow())).not.toThrow();
  });

  it("does not throw when alertOwnerRaw throws internally", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(alertOwnerRaw).mockImplementationOnce(() => { throw new Error("network fail"); });
    expect(() => alertSwingOrderStaged(makeRow())).not.toThrow();
    await new Promise(r => setTimeout(r, 100));
  });

  it("canonical message never implies broker execution is live", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeRow());
    await new Promise(r => setTimeout(r, 100));
    const [, , text] = vi.mocked(alertOwnerRaw).mock.calls[0]!;
    expect(text).not.toContain("LIVE_ENABLED");
    expect(text).not.toContain("Buy Now");
    expect(text).not.toContain("guaranteed");
    expect(text).not.toContain("auto order placed");
  });

  it("updates lastSwingAlertRecord after dispatch in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderStaged(makeRow());
    await new Promise(r => setTimeout(r, 100));
    const record = getLastSwingAlertRecord();
    expect(record).not.toBeNull();
    expect(record!.event).toBe("SWING_ENTRY_READY");
    expect(record!.telegramStatus).toBe("SENT");
  });

  it("lastSwingAlertRecord is null in test environment (no dispatch)", async () => {
    // NODE_ENV=test → DEV_ENV_BLOCKED → no dispatch → no record update
    alertSwingOrderStaged(makeRow());
    await new Promise(r => setTimeout(r, 100));
    expect(getLastSwingAlertRecord()).toBeNull();
  });
});

// ── alertSwingOrderExpired — lifecycle-only, no Telegram ─────────────────────

describe("alertSwingOrderExpired — lifecycle-only, no Telegram", () => {
  it("does NOT call alertOwnerRaw in production (expired is lifecycle-only)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderExpired(makeRow());
    await new Promise(r => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("does NOT call alertOwnerRaw in test environment", async () => {
    alertSwingOrderExpired(makeRow());
    await new Promise(r => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("does not throw", () => {
    expect(() => alertSwingOrderExpired(makeRow())).not.toThrow();
  });
});

// ── alertSwingOrderRejected — lifecycle-only, no Telegram ────────────────────

describe("alertSwingOrderRejected — lifecycle-only, no Telegram", () => {
  it("does NOT call alertOwnerRaw", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderRejected(makeRow());
    await new Promise(r => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("does not throw", () => {
    expect(() => alertSwingOrderRejected(makeRow())).not.toThrow();
  });
});

// ── alertSwingOrderApprovedDryRun — lifecycle-only, no Telegram ──────────────

describe("alertSwingOrderApprovedDryRun — lifecycle-only, no Telegram", () => {
  it("does NOT call alertOwnerRaw", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderApprovedDryRun(makeRow({ status: "DRY_RUN_PLACED" }));
    await new Promise(r => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("does not throw", () => {
    expect(() => alertSwingOrderApprovedDryRun(makeRow())).not.toThrow();
  });
});

// ── alertSwingOrderBlockedByRisk — lifecycle-only, no Telegram ───────────────

describe("alertSwingOrderBlockedByRisk — lifecycle-only, no Telegram", () => {
  it("does NOT call alertOwnerRaw (blocked-by-risk is lifecycle-only, no trade channel)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderBlockedByRisk("INFY", "Breakout_Swing", ["NOT_STAGEABLE_HARD_BLOCK"]);
    await new Promise(r => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("does NOT call alertOwnerRaw for different symbols", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertSwingOrderBlockedByRisk("INFY", "Breakout", ["block"]);
    alertSwingOrderBlockedByRisk("TCS",  "Breakout", ["block"]);
    await new Promise(r => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("does not throw with any input", () => {
    expect(() => alertSwingOrderBlockedByRisk("INFY", null, [])).not.toThrow();
    expect(() => alertSwingOrderBlockedByRisk("X", "setup", ["a", "b", "c"])).not.toThrow();
  });
});

// ── Security: no secrets in any message ──────────────────────────────────────

describe("security — no secrets in pure-format messages", () => {
  it("buildSwingOrderText never contains env-like secret names", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow());
    const forbidden = [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID",
      "SESSION_SECRET",
      "APP_ACCESS_PASSWORD",
      "TRADINGVIEW_WEBHOOK_SECRET",
    ];
    for (const pattern of forbidden) {
      expect(text).not.toContain(pattern);
    }
  });

  it("buildSwingBlockedText never contains env-like secret names", () => {
    const text = buildSwingBlockedText("RELIANCE", "setup", ["block"]);
    expect(text).not.toContain("TOKEN");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("PASSWORD");
  });
});

// ── Broker execution: always disabled in pure-format messages ─────────────────

describe("broker execution always disabled in pure-format messages", () => {
  const events = [
    "SWING_ORDER_STAGED",
    "SWING_ORDER_APPROVAL_REQUIRED",
    "SWING_ORDER_EXPIRED",
    "SWING_ORDER_REJECTED",
    "SWING_ORDER_APPROVED_DRY_RUN",
  ] as const;

  for (const event of events) {
    it(`${event} message says broker execution DISABLED`, () => {
      const text = buildSwingOrderText(event, makeRow());
      expect(text).toContain("Broker execution DISABLED");
      expect(text).not.toContain("Buy Now");
      expect(text).not.toContain("guaranteed");
    });
  }

  it("buildSwingBlockedText says broker execution DISABLED", () => {
    const text = buildSwingBlockedText("X", null, []);
    expect(text).toContain("Broker execution DISABLED");
  });
});
