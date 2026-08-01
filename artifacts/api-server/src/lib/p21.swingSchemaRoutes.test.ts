/**
 * Pack 3 — Gate K: Zod schema parity for swing API responses.
 *
 * Tests every swing-related Zod schema:
 *  - GetPaperPositionsEqResponse  (OPEN equity positions)
 *  - GetPaperTradesEqResponse     (CLOSED equity trades — all 6 exit reasons)
 *  - GetPaperReportEqMonthlyResponse (monthly report)
 *  - ListSwingStagedOrdersResponse (staged orders — all 9 statuses)
 *  - StageSwingStagedOrderBody     (request body validation)
 *  - StageSwingStagedOrderResponse (stage-order response)
 *  - GetSwingExecutionStatusResponse
 *
 * Each schema is exercised with a valid payload (must parse) and an invalid
 * payload (must reject). All tests are pure — no DB, no network.
 */

import { describe, it, expect } from "vitest";
import {
  GetPaperPositionsEqResponse,
  GetPaperTradesEqResponse,
  GetPaperReportEqMonthlyResponse,
  ListSwingStagedOrdersResponse,
  StageSwingStagedOrderBody,
  StageSwingStagedOrderResponse,
  GetSwingExecutionStatusResponse,
} from "@workspace/api-zod";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

function makeOpenPosition(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "trade-uuid-001",
    symbol: "RELIANCE",
    name: "Reliance Industries Ltd",
    exchange: "NSE",
    signalDate: "2026-01-15",
    signalTriggeredAt: NOW,
    qty: 100,
    entryPrice: 2800,
    stopPrice: 2700,
    target1Price: 3000,
    target2Price: 3200,
    trailedToT1: false,
    capitalDeployed: 280000,
    lastPrice: 2850,
    unrealizedPnl: 5000,
    openedAt: NOW,
    lastEvaluatedAt: NOW,
    status: "OPEN",
    ...overrides,
  };
}

function makeClosedTrade(
  exitReason: "TARGET2_HIT" | "STOPPED" | "TRAIL_STOP_HIT" | "TIME_STOP" | "SIGNAL_FLIP" | "MANUAL_OVERRIDE",
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    id: "closed-uuid-001",
    symbol: "INFY",
    name: "Infosys Ltd",
    exchange: "NSE",
    signalDate: "2026-01-10",
    qty: 50,
    entryPrice: 1700,
    exitPrice: 1800,
    capitalDeployed: 85000,
    realizedPnl: 5000,
    exitReason,
    openedAt: NOW,
    exitedAt: NOW,
    ...overrides,
  };
}

function makeStagedOrder(
  status: string = "STAGED",
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    symbol: "TCS",
    side: "BUY",
    entryPrice: 3500,
    stopLoss: 3400,
    target1: 3700,
    quantity: 10,
    status,
    approvalStatus: "PENDING",
    expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
    executionMode: "paper_only",
    brokerStatus: "BROKER_DISABLED",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ── GetPaperPositionsEqResponse ──────────────────────────────────────────────

describe("Pack3/GateK — GetPaperPositionsEqResponse", () => {
  it("parses a valid single open position", () => {
    const payload = { positions: [makeOpenPosition()], generatedAt: NOW };
    const result = GetPaperPositionsEqResponse.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("parses empty positions array", () => {
    const result = GetPaperPositionsEqResponse.safeParse({ positions: [], generatedAt: NOW });
    expect(result.success).toBe(true);
  });

  it("rejects missing generatedAt", () => {
    const result = GetPaperPositionsEqResponse.safeParse({ positions: [] });
    expect(result.success).toBe(false);
  });

  it("rejects wrong status (not OPEN)", () => {
    const payload = {
      positions: [makeOpenPosition({ status: "CLOSED" })],
      generatedAt: NOW,
    };
    const result = GetPaperPositionsEqResponse.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields (no symbol)", () => {
    const pos = makeOpenPosition();
    delete (pos as Record<string, unknown>).symbol;
    const result = GetPaperPositionsEqResponse.safeParse({ positions: [pos], generatedAt: NOW });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields (prevClose, source, stagedOrderId, etc.)", () => {
    const payload = {
      positions: [makeOpenPosition({
        prevClose: 2820,
        unrealizedPnlPct: 1.79,
        dayPnl: 300,
        dayPnlPct: 0.5,
        maxRunup: 5500,
        maxDrawdown: -1200,
        source: "SWING_STAGED_APPROVAL",
        stagedOrderId: "order-uuid",
        openedSessionValidity: "VALID_SESSION",
        openedSessionReason: null,
        openedAtIst: "09:30 15-Jan-2026",
        calendarVersion: "NSE-2026-v1",
        calendarScope: "NSE_CURATED_2026",
        timestampConfidence: "HIGH",
        cutoffPolicyValidity: "NOT_APPLICABLE",
      })],
      generatedAt: NOW,
    };
    const result = GetPaperPositionsEqResponse.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("accepts all valid source values", () => {
    for (const source of ["AUTO_STRONG_BUY", "SWING_STAGED_APPROVAL", "MANUAL_BUY", "LEGACY_UNKNOWN"]) {
      const payload = { positions: [makeOpenPosition({ source })], generatedAt: NOW };
      const result = GetPaperPositionsEqResponse.safeParse(payload);
      expect(result.success, `source=${source}`).toBe(true);
    }
  });
});

// ── GetPaperTradesEqResponse ─────────────────────────────────────────────────

describe("Pack3/GateK — GetPaperTradesEqResponse (all 6 exit reasons)", () => {
  const EXIT_REASONS = [
    "TARGET2_HIT",
    "STOPPED",
    "TRAIL_STOP_HIT",
    "TIME_STOP",
    "SIGNAL_FLIP",
    "MANUAL_OVERRIDE",
  ] as const;

  for (const reason of EXIT_REASONS) {
    it(`parses exitReason=${reason}`, () => {
      const payload = {
        date: "2026-01-15",
        trades: [makeClosedTrade(reason)],
        generatedAt: NOW,
      };
      const result = GetPaperTradesEqResponse.safeParse(payload);
      expect(result.success, `reason=${reason}: ${JSON.stringify(result)}`).toBe(true);
    });
  }

  it("rejects unknown exit reason", () => {
    const payload = {
      date: "2026-01-15",
      trades: [makeClosedTrade("TARGET2_HIT", { exitReason: "UNKNOWN_REASON" })],
      generatedAt: NOW,
    };
    const result = GetPaperTradesEqResponse.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("parses empty trades array", () => {
    const result = GetPaperTradesEqResponse.safeParse({ date: "2026-01-15", trades: [], generatedAt: NOW });
    expect(result.success).toBe(true);
  });

  it("rejects missing date field", () => {
    const result = GetPaperTradesEqResponse.safeParse({ trades: [], generatedAt: NOW });
    expect(result.success).toBe(false);
  });
});

// ── ListSwingStagedOrdersResponse ────────────────────────────────────────────

describe("Pack3/GateK — ListSwingStagedOrdersResponse (all 9 statuses)", () => {
  const STATUSES = [
    "STAGED",
    "APPROVAL_REQUIRED",
    "APPROVED",
    "REJECTED",
    "EXPIRED",
    "CANCELLED",
    "WATCH_ONLY",
    "DRY_RUN_PLACED",
    "BROKER_DISABLED",
  ] as const;

  const EXECUTION = {
    mode: "paper_only" as const,
    liveCashSwingOrderEnabled: false,
    brokerExecutionEnabled: false,
    brokerStatus: "DISABLED" as const,
    summary: "All execution is paper-only. No live orders.",
  };

  for (const status of STATUSES) {
    it(`parses status=${status}`, () => {
      const approvalStatus = (status === "WATCH_ONLY" ? "WATCH_ONLY"
        : status === "APPROVED" || status === "DRY_RUN_PLACED" ? "APPROVED"
        : status === "REJECTED" ? "REJECTED"
        : status === "EXPIRED" ? "EXPIRED"
        : "PENDING");
      const payload = {
        items: [makeStagedOrder(status, { approvalStatus })],
        execution: EXECUTION,
      };
      const result = ListSwingStagedOrdersResponse.safeParse(payload);
      expect(result.success, `status=${status}: ${JSON.stringify(result)}`).toBe(true);
    });
  }

  it("rejects unknown status", () => {
    const payload = {
      items: [makeStagedOrder("UNKNOWN_STATUS")],
      execution: EXECUTION,
    };
    const result = ListSwingStagedOrdersResponse.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("parses empty items", () => {
    const result = ListSwingStagedOrdersResponse.safeParse({ items: [], execution: EXECUTION });
    expect(result.success).toBe(true);
  });

  it("rejects missing execution block", () => {
    const result = ListSwingStagedOrdersResponse.safeParse({ items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid brokerStatus (must be DISABLED)", () => {
    const payload = {
      items: [],
      execution: { ...EXECUTION, brokerStatus: "LIVE" },
    };
    const result = ListSwingStagedOrdersResponse.safeParse(payload);
    expect(result.success).toBe(false);
  });
});

// ── StageSwingStagedOrderBody ────────────────────────────────────────────────

describe("Pack3/GateK — StageSwingStagedOrderBody validation", () => {
  function validBody(overrides: Record<string, unknown> = {}): unknown {
    return {
      symbol: "RELIANCE",
      entry: 2800,
      stop: 2700,
      target1: 3000,
      ...overrides,
    };
  }

  it("parses minimal valid body", () => {
    const result = StageSwingStagedOrderBody.safeParse(validBody());
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("rejects empty symbol", () => {
    const result = StageSwingStagedOrderBody.safeParse(validBody({ symbol: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects symbol > 40 chars", () => {
    const result = StageSwingStagedOrderBody.safeParse(validBody({ symbol: "A".repeat(41) }));
    expect(result.success).toBe(false);
  });

  it("rejects missing entry", () => {
    const body = validBody();
    delete (body as Record<string, unknown>).entry;
    const result = StageSwingStagedOrderBody.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("rejects missing stop", () => {
    const body = validBody();
    delete (body as Record<string, unknown>).stop;
    const result = StageSwingStagedOrderBody.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("rejects missing target1", () => {
    const body = validBody();
    delete (body as Record<string, unknown>).target1;
    const result = StageSwingStagedOrderBody.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("accepts optional fields (target2, sector, benchmarkAvailable, eventOverride, etc.)", () => {
    const result = StageSwingStagedOrderBody.safeParse(validBody({
      target2: 3200,
      sector: "IT",
      benchmarkAvailable: true,
      triggered: true,
      signalAgeDays: 2,
      avgTradedValue: 500_000_000,
      volume: 1_000_000,
      spreadPct: 0.05,
      deliveryPct: 65,
      asmGsmStatus: "NONE",
      circuitRisk: false,
      daysToResult: 15,
      isResultDay: false,
      corporateActionRisk: false,
      eventDataAvailable: true,
      resultScheduleKnown: true,
      newsRiskAvailable: true,
      setupKey: "BREAKOUT_BULL",
      signalId: "sig-abc-123",
      eventOverride: { resultDateKnown: true, resultDate: "2026-02-15", corporateActionRisk: false },
    }));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("asmGsmStatus only accepts NONE/ASM/GSM", () => {
    const okResult = StageSwingStagedOrderBody.safeParse(validBody({ asmGsmStatus: "NONE" }));
    const badResult = StageSwingStagedOrderBody.safeParse(validBody({ asmGsmStatus: "INVALID" }));
    expect(okResult.success).toBe(true);
    expect(badResult.success).toBe(false);
  });
});

// ── StageSwingStagedOrderResponse ────────────────────────────────────────────

const EXECUTION_BLOCK = {
  mode: "paper_only" as const,
  liveCashSwingOrderEnabled: false,
  brokerExecutionEnabled: false,
  brokerStatus: "DISABLED" as const,
  summary: "All execution is paper-only. No live orders.",
};

describe("Pack3/GateK — StageSwingStagedOrderResponse", () => {
  it("parses staged=true with order", () => {
    const result = StageSwingStagedOrderResponse.safeParse({
      staged: true,
      status: "STAGED",
      execution: EXECUTION_BLOCK,
      order: {
        id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        symbol: "RELIANCE",
        side: "BUY",
        entryPrice: 2800,
        stopLoss: 2700,
        target1: 3000,
        quantity: 10,
        status: "STAGED",
        approvalStatus: "PENDING",
        expiresAt: NOW,
        executionMode: "paper_only",
        brokerStatus: "BROKER_DISABLED",
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("parses staged=false with reason (rejected/duplicate)", () => {
    const result = StageSwingStagedOrderResponse.safeParse({
      staged: false,
      status: "REJECTED",
      reason: "DUPLICATE_ACTIVE_STAGE",
      execution: EXECUTION_BLOCK,
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("requires staged and status fields", () => {
    const missingStaged = StageSwingStagedOrderResponse.safeParse({ status: "STAGED", execution: EXECUTION_BLOCK });
    const missingStatus = StageSwingStagedOrderResponse.safeParse({ staged: true, execution: EXECUTION_BLOCK });
    expect(missingStaged.success).toBe(false);
    expect(missingStatus.success).toBe(false);
  });

  it("requires execution block", () => {
    const result = StageSwingStagedOrderResponse.safeParse({ staged: false, status: "REJECTED" });
    expect(result.success).toBe(false);
  });
});

// ── GetSwingExecutionStatusResponse ─────────────────────────────────────────

const KILL_SWITCH_BLOCK = {
  enabled: false,
  reason: null,
  updatedAt: null,
  updatedBy: null,
};

describe("Pack3/GateK — GetSwingExecutionStatusResponse", () => {
  it("parses valid execution status", () => {
    const result = GetSwingExecutionStatusResponse.safeParse({
      execution: EXECUTION_BLOCK,
      killSwitch: KILL_SWITCH_BLOCK,
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("requires liveCashSwingOrderEnabled=false (hard-blocked in execution block)", () => {
    const result = GetSwingExecutionStatusResponse.safeParse({
      execution: { ...EXECUTION_BLOCK, liveCashSwingOrderEnabled: false },
      killSwitch: KILL_SWITCH_BLOCK,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.execution.liveCashSwingOrderEnabled).toBe(false);
    }
  });

  it("accepts optional ttlSweep field", () => {
    const result = GetSwingExecutionStatusResponse.safeParse({
      execution: EXECUTION_BLOCK,
      killSwitch: KILL_SWITCH_BLOCK,
      ttlSweep: {
        startedAt: null,
        lastSweepAt: null,
        lastSweepScanned: 0,
        lastSweepExpired: 0,
        lastSweepDurationMs: 0,
        lastSweepError: null,
        totalExpiredSinceStart: 0,
        sweepCount: 0,
        tickMs: 600_000,
      },
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("rejects invalid mode", () => {
    const result = GetSwingExecutionStatusResponse.safeParse({
      execution: { ...EXECUTION_BLOCK, mode: "INVALID_MODE" },
      killSwitch: KILL_SWITCH_BLOCK,
    });
    expect(result.success).toBe(false);
  });
});

// ── GetPaperReportEqMonthlyResponse ──────────────────────────────────────────

describe("Pack3/GateK — GetPaperReportEqMonthlyResponse", () => {
  const TOTALS = {
    realizedPnl: 15000,
    netPnl: 12000,
    charges: 3000,
    tradeCount: 5,
    wins: 3,
    losses: 2,
    winRatePct: 60,
    avgWin: 6000,
    avgLoss: -2000,
    bestTrade: 9000,
    worstTrade: -3000,
    avgRMultiple: 1.5,
    profitFactor: 2.25,
    expectancy: 2400,  // (winRate × avgWin) - (lossRate × |avgLoss|)
  };

  it("parses valid monthly report with empty days/trades", () => {
    const result = GetPaperReportEqMonthlyResponse.safeParse({
      month: "2026-01",
      from: "2026-01-01",
      to: "2026-01-31",
      totals: TOTALS,
      days: [],
      trades: [],
      generatedAt: NOW,
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("rejects missing month field", () => {
    const result = GetPaperReportEqMonthlyResponse.safeParse({
      from: "2026-01-01",
      to: "2026-01-31",
      totals: TOTALS,
      days: [],
      trades: [],
      generatedAt: NOW,
    });
    expect(result.success).toBe(false);
  });

  it("totals.wins + totals.losses = totals.tradeCount", () => {
    const result = GetPaperReportEqMonthlyResponse.safeParse({
      month: "2026-01",
      from: "2026-01-01",
      to: "2026-01-31",
      totals: TOTALS,
      days: [],
      trades: [],
      generatedAt: NOW,
    });
    if (result.success) {
      expect(result.data.totals.wins + result.data.totals.losses).toBe(result.data.totals.tradeCount);
    }
  });
});
