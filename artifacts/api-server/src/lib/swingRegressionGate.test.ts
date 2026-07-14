/**
 * Tests for swingRegressionGate (F-37).
 *
 * Strategy:
 *  - Mock the DB call (avoid real DB in unit tests).
 *  - Verify ok/winRate/profitFactor/tradeCount for edge cases.
 *  - Verify gate is fail-open on DB error.
 *  - Verify insufficient-data path returns ok:true without applying floors.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @workspace/db before importing the module under test.
vi.mock("@workspace/db", async () => {
  return {
    db: {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    },
    paperTradeEqTable: { realizedPnl: "realized_pnl", status: "status", source: "source", openedAt: "opened_at" },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (_c: unknown, v: unknown) => v,
  gte: (_c: unknown, v: unknown) => v,
  ne: (_c: unknown, v: unknown) => v,
  isNotNull: (_c: unknown) => "isNotNull",
}));

vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { checkSwingRegressionBaseline, SWING_REGRESSION_THRESHOLDS } from "./swingRegressionGate";
import { db } from "@workspace/db";

// Helper: point the mock db chain's `where` to resolve with the given rows.
function mockRows(rows: { realizedPnl: string | null }[]) {
  const selectMock = db.select as ReturnType<typeof vi.fn>;
  selectMock.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  });
}

function mockDbError(msg: string) {
  const selectMock = db.select as ReturnType<typeof vi.fn>;
  selectMock.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockRejectedValue(new Error(msg)),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SWING_REGRESSION_THRESHOLDS", () => {
  it("exports the expected constant values", () => {
    expect(SWING_REGRESSION_THRESHOLDS.MIN_SAMPLE).toBe(10);
    expect(SWING_REGRESSION_THRESHOLDS.MIN_WIN_RATE).toBe(0.45);
    expect(SWING_REGRESSION_THRESHOLDS.MIN_PROFIT_FACTOR).toBe(2.0);
    expect(SWING_REGRESSION_THRESHOLDS.WINDOW_DAYS).toBe(90);
  });
});

describe("checkSwingRegressionBaseline", () => {
  it("returns ok=true when tradeCount < MIN_SAMPLE (insufficient data)", async () => {
    // Only 5 trades — below MIN_SAMPLE of 10.
    mockRows([
      { realizedPnl: "1000" },
      { realizedPnl: "800" },
      { realizedPnl: "-500" },
      { realizedPnl: "1200" },
      { realizedPnl: "-300" },
    ]);
    const result = await checkSwingRegressionBaseline();
    expect(result.ok).toBe(true);
    expect(result.tradeCount).toBe(5);
    expect(result.winRate).toBe(0);
    expect(result.profitFactor).toBe(0);
    expect(result.reason).toMatch(/Insufficient/);
    expect(result.windowDays).toBe(90);
    expect(result.generatedAt).toBeTruthy();
  });

  it("returns ok=true when exactly MIN_SAMPLE trades and WR/PF pass", async () => {
    // 10 trades: 6 wins (₹1000 each) + 4 losses (₹300 each)
    // WR = 0.6 >= 0.45 ✓   PF = 6000/1200 = 5.0 >= 2.0 ✓
    const rows: { realizedPnl: string }[] = [
      ...Array(6).fill({ realizedPnl: "1000" }),
      ...Array(4).fill({ realizedPnl: "-300" }),
    ];
    mockRows(rows);
    const result = await checkSwingRegressionBaseline();
    expect(result.ok).toBe(true);
    expect(result.tradeCount).toBe(10);
    expect(result.winRate).toBeCloseTo(0.6, 5);
    expect(result.profitFactor).toBeCloseTo(5.0, 3);
    expect(result.reason).toBeUndefined();
  });

  it("returns ok=false when WR is below floor", async () => {
    // 10 trades: 4 wins (₹1000) + 6 losses (₹100)
    // WR = 0.4 < 0.45 ✗   PF = 4000/600 = 6.67 >= 2.0 ✓
    const rows: { realizedPnl: string }[] = [
      ...Array(4).fill({ realizedPnl: "1000" }),
      ...Array(6).fill({ realizedPnl: "-100" }),
    ];
    mockRows(rows);
    const result = await checkSwingRegressionBaseline();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/WR/);
    expect(result.reason).not.toMatch(/PF/);
    expect(result.tradeCount).toBe(10);
  });

  it("returns ok=false when PF is below floor", async () => {
    // 10 trades: 5 wins (₹200) + 5 losses (₹200)
    // WR = 0.5 >= 0.45 ✓   PF = 1000/1000 = 1.0 < 2.0 ✗
    const rows: { realizedPnl: string }[] = [
      ...Array(5).fill({ realizedPnl: "200" }),
      ...Array(5).fill({ realizedPnl: "-200" }),
    ];
    mockRows(rows);
    const result = await checkSwingRegressionBaseline();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/PF/);
  });

  it("returns ok=false when both WR and PF are below floor", async () => {
    // 20 trades: 8 wins (₹100) + 12 losses (₹200)
    // WR = 0.4 < 0.45 ✗   PF = 800/2400 = 0.33 < 2.0 ✗
    const rows: { realizedPnl: string }[] = [
      ...Array(8).fill({ realizedPnl: "100" }),
      ...Array(12).fill({ realizedPnl: "-200" }),
    ];
    mockRows(rows);
    const result = await checkSwingRegressionBaseline();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/WR/);
    expect(result.reason).toMatch(/PF/);
    expect(result.tradeCount).toBe(20);
  });

  it("returns Infinity profitFactor when there are no losing trades", async () => {
    // 10 wins, 0 losses → PF = Infinity ≥ 2.0 → ok
    const rows: { realizedPnl: string }[] = Array(10).fill({ realizedPnl: "500" });
    mockRows(rows);
    const result = await checkSwingRegressionBaseline();
    expect(result.ok).toBe(true);
    expect(result.profitFactor).toBe(Infinity);
    expect(result.winRate).toBe(1.0);
  });

  it("skips rows with null realizedPnl", async () => {
    // 12 rows but 4 are null → only 8 rows used → tradeCount=8 < 10 → insufficient
    const rows = [
      ...Array(5).fill({ realizedPnl: "1000" }),
      ...Array(3).fill({ realizedPnl: "-200" }),
      ...Array(4).fill({ realizedPnl: null }),
    ];
    mockRows(rows);
    const result = await checkSwingRegressionBaseline();
    expect(result.tradeCount).toBe(8);
    expect(result.ok).toBe(true); // insufficient data
  });

  it("fails open and returns ok=true on DB error", async () => {
    mockDbError("connection refused");
    const result = await checkSwingRegressionBaseline();
    expect(result.ok).toBe(true);
    expect(result.tradeCount).toBe(0);
    expect(result.reason).toMatch(/DB query failed/);
    expect(result.winRate).toBe(0);
    expect(result.profitFactor).toBe(0);
    expect(result.windowDays).toBe(90);
    expect(result.generatedAt).toBeTruthy();
  });

  it("returns generatedAt as ISO string", async () => {
    mockRows([]);
    const result = await checkSwingRegressionBaseline();
    expect(() => new Date(result.generatedAt)).not.toThrow();
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("handles zero trades (empty table) as insufficient data", async () => {
    mockRows([]);
    const result = await checkSwingRegressionBaseline();
    expect(result.ok).toBe(true);
    expect(result.tradeCount).toBe(0);
    expect(result.reason).toMatch(/Insufficient/);
  });
});
