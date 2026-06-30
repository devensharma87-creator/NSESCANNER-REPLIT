/**
 * Tests for swingAlerts.ts — Swing Cash staged-order Telegram alerts.
 *
 * Verifies message format, dedup behaviour, fail-open delivery, and that broker
 * execution is never implied as enabled and no secrets appear in messages.
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
import { resetAlertDedup, resetLastAlertRecord } from "./alerting";
import type { SwingOrderStagingRow } from "@workspace/db/schema";

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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetAlertDedup();
  resetLastAlertRecord();
  resetLastSwingAlertRecord();
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
    // Must NOT say bare "Data: kite" — that can imply the entry price IS the Kite price
    expect(text).not.toMatch(/^Data: kite$/m);
    // Must say "Risk eval:" to clarify this is the risk-evaluation data source
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

// ── alertSwingOrderStaged ─────────────────────────────────────────────────────

describe("alertSwingOrderStaged — fires and deduplicates", () => {
  it("dispatches fetch when Telegram is configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:testtoken");
    vi.stubEnv("TELEGRAM_CHAT_ID", "999");

    alertSwingOrderStaged(makeRow());

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.text).toContain("SWING CASH ALERT");
    expect(body.text).toContain("RELIANCE");
    expect(body.text).toContain("Broker execution DISABLED");
  });

  it("dedup prevents a second send for the same order within the window", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:testtoken");
    vi.stubEnv("TELEGRAM_CHAT_ID", "999");

    const row = makeRow();
    alertSwingOrderStaged(row);
    alertSwingOrderStaged(row); // same id → same dedup key → suppressed

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fires for two different order IDs (different dedup keys)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:testtoken");
    vi.stubEnv("TELEGRAM_CHAT_ID", "999");

    alertSwingOrderStaged(makeRow({ id: "order-A" }));
    alertSwingOrderStaged(makeRow({ id: "order-B" }));

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses SWING_ORDER_APPROVAL_REQUIRED event for APPROVAL_REQUIRED status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:testtoken");
    vi.stubEnv("TELEGRAM_CHAT_ID", "999");

    alertSwingOrderStaged(makeRow({ status: "APPROVAL_REQUIRED" }));

    await new Promise(r => setTimeout(r, 50));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.text).toContain("Manual approval required");
  });

  it("does not throw when Telegram is not configured", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    expect(() => alertSwingOrderStaged(makeRow())).not.toThrow();
  });

  it("does not throw when fetch rejects (Telegram network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:testtoken");
    vi.stubEnv("TELEGRAM_CHAT_ID", "999");

    expect(() => alertSwingOrderStaged(makeRow())).not.toThrow();
    await new Promise(r => setTimeout(r, 50));
  });

  it("updates lastSwingAlertRecord after dispatch", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");

    alertSwingOrderStaged(makeRow());
    const record = getLastSwingAlertRecord();
    expect(record).not.toBeNull();
    expect(record!.event).toMatch(/^SWING_ORDER_(STAGED|APPROVAL_REQUIRED)$/);
  });
});

// ── alertSwingOrderExpired ────────────────────────────────────────────────────

describe("alertSwingOrderExpired", () => {
  it("dispatches expired event message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertSwingOrderExpired(makeRow());

    await new Promise(r => setTimeout(r, 50));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.text).toContain("expired");
    expect(body.text).toContain("Broker execution DISABLED");
  });
});

// ── alertSwingOrderRejected ───────────────────────────────────────────────────

describe("alertSwingOrderRejected", () => {
  it("dispatches rejected event message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertSwingOrderRejected(makeRow());

    await new Promise(r => setTimeout(r, 50));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.text).toContain("rejected");
    expect(body.text).toContain("Broker execution DISABLED");
  });
});

// ── alertSwingOrderApprovedDryRun ─────────────────────────────────────────────

describe("alertSwingOrderApprovedDryRun", () => {
  it("dispatches approved dry-run event message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertSwingOrderApprovedDryRun(makeRow({ status: "DRY_RUN_PLACED" }));

    await new Promise(r => setTimeout(r, 50));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.text).toContain("dry-run");
    expect(body.text).toContain("Broker execution DISABLED");
  });
});

// ── alertSwingOrderBlockedByRisk ──────────────────────────────────────────────

describe("alertSwingOrderBlockedByRisk — spam prevention", () => {
  it("dispatches blocked message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertSwingOrderBlockedByRisk("INFY", "Breakout_Swing", ["NOT_STAGEABLE_HARD_BLOCK"]);

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.text).toContain("INFY");
    expect(body.text).toContain("Broker execution DISABLED");
    expect(body.text).toContain("not actionable by owner");
  });

  it("dedup prevents repeated blocked alerts for same symbol+setup within 1h", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertSwingOrderBlockedByRisk("INFY", "Breakout_Swing", ["NOT_STAGEABLE_HARD_BLOCK"]);
    alertSwingOrderBlockedByRisk("INFY", "Breakout_Swing", ["NOT_STAGEABLE_HARD_BLOCK"]);

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fires separately for different symbols", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertSwingOrderBlockedByRisk("INFY", "Breakout", ["block"]);
    alertSwingOrderBlockedByRisk("TCS", "Breakout", ["block"]);

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── Security: no secrets in any message ──────────────────────────────────────

describe("security — no secrets in messages", () => {
  it("buildSwingOrderText never contains env-like secret names", () => {
    const text = buildSwingOrderText("SWING_ORDER_STAGED", makeRow());
    const forbiddenPatterns = [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID",
      "SESSION_SECRET",
      "APP_ACCESS_PASSWORD",
      "TRADINGVIEW_WEBHOOK_SECRET",
    ];
    for (const pattern of forbiddenPatterns) {
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

// ── Broker execution: always disabled ────────────────────────────────────────

describe("broker execution always disabled in messages", () => {
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
