/**
 * F-37 — Swing Regression Baseline Gate tests.
 *
 * Contract: checkSwingRegressionBaseline returns
 *   { ok, tradeCount, winRate, profitFactor, reason?, computedAt }
 *
 * Gate logic:
 *   - tradeCount < MIN_SAMPLE (10) → ok=true, winRate/profitFactor null
 *   - tradeCount >= MIN_SAMPLE    → ok = (winRate >= WR_FLOOR) AND (PF >= PF_FLOOR)
 *   - WR_FLOOR = 0.45, PF_FLOOR = 2.0
 *
 * Autonomous = exit_reason != 'MANUAL_OVERRIDE' AND source != 'MANUAL_BUY'
 * NULLs are treated as autonomous via or(isNull, ne).
 *
 * DB module is fully mocked — no real database required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SWING_REGRESSION_CONFIG,
  checkSwingRegressionBaseline,
  type SwingRegressionResult,
} from "./swingRegressionGate";

// ─── Mock @workspace/db ───────────────────────────────────────────────────────

let mockRows: Array<{ realizedPnl: string | null }> = [];
let mockShouldThrow = false;

vi.mock("@workspace/db", () => {
  const chain = {
    from: () => chain,
    where: () => {
      if (mockShouldThrow) throw new Error("DB_CONNECTION_REFUSED");
      return Promise.resolve(mockRows);
    },
  };
  return {
    db: { select: () => chain },
    paperTradeEqTable: {
      status: "status",
      exitedAt: "exitedAt",
      exitReason: "exitReason",
      source: "source",
      realizedPnl: "realizedPnl",
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ col, val, op: "eq" }),
  ne: (col: unknown, val: unknown) => ({ col, val, op: "ne" }),
  or: (...args: unknown[]) => ({ op: "or", args }),
  isNull: (col: unknown) => ({ col, op: "isNull" }),
  gte: (col: unknown, val: unknown) => ({ col, val, op: "gte" }),
}));

vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRows(
  wins: number,
  losses: number,
  winPnl = 500,
  lossPnl = -300,
): Array<{ realizedPnl: string }> {
  return [
    ...Array.from({ length: wins }, () => ({ realizedPnl: String(winPnl) })),
    ...Array.from({ length: losses }, () => ({ realizedPnl: String(lossPnl) })),
  ];
}

// ─── SWING_REGRESSION_CONFIG constants ───────────────────────────────────────

describe("SWING_REGRESSION_CONFIG", () => {
  it("LOOKBACK_DAYS is 90", () => {
    expect(SWING_REGRESSION_CONFIG.LOOKBACK_DAYS).toBe(90);
  });

  it("MIN_SAMPLE is 10", () => {
    expect(SWING_REGRESSION_CONFIG.MIN_SAMPLE).toBe(10);
  });

  it("WR_FLOOR is 0.45", () => {
    expect(SWING_REGRESSION_CONFIG.WR_FLOOR).toBe(0.45);
  });

  it("PF_FLOOR is 2.0", () => {
    expect(SWING_REGRESSION_CONFIG.PF_FLOOR).toBe(2.0);
  });
});

// ─── checkSwingRegressionBaseline behavior ───────────────────────────────────

describe("checkSwingRegressionBaseline", () => {
  beforeEach(() => {
    mockRows = [];
    mockShouldThrow = false;
  });

  it("returns ok=true with null metrics when tradeCount < MIN_SAMPLE", async () => {
    mockRows = makeRows(3, 2); // 5 trades
    const r: SwingRegressionResult = await checkSwingRegressionBaseline();
    expect(r.ok).toBe(true);
    expect(r.tradeCount).toBe(5);
    expect(r.winRate).toBeNull();
    expect(r.profitFactor).toBeNull();
    expect(r.reason).toBeUndefined();
  });

  it("returns ok=true when both WR and PF are above floor", async () => {
    // 7 wins @600, 3 losses @200 → WR=70%, PF=4200/600=7.0 (both above floor)
    mockRows = makeRows(7, 3, 600, -200);
    const r = await checkSwingRegressionBaseline();
    expect(r.ok).toBe(true);
    expect(r.tradeCount).toBe(10);
    expect(r.winRate).toBeCloseTo(0.7, 3);
    expect(r.profitFactor).toBeGreaterThan(SWING_REGRESSION_CONFIG.PF_FLOOR);
    expect(r.reason).toBeUndefined();
  });

  it("returns ok=false when WR is below WR_FLOOR (0.45)", async () => {
    // WR = 4/10 = 0.40 < 0.45
    mockRows = makeRows(4, 6, 500, -200);
    const r = await checkSwingRegressionBaseline();
    expect(r.ok).toBe(false);
    expect(r.winRate).toBeCloseTo(0.4, 3);
    expect(r.reason).toMatch(/win.rate/i);
  });

  it("returns ok=false when PF is below PF_FLOOR (2.0)", async () => {
    // WR = 6/10 = 0.60 (above 0.45), PF = 600/900 = 0.67 (below 2.0)
    mockRows = makeRows(6, 4, 100, -225);
    const r = await checkSwingRegressionBaseline();
    expect(r.ok).toBe(false);
    expect(r.winRate).toBeCloseTo(0.6, 3);
    expect(r.profitFactor).toBeLessThan(SWING_REGRESSION_CONFIG.PF_FLOOR);
    expect(r.reason).toMatch(/profit.factor/i);
  });

  it("returns ok=false when BOTH WR and PF are below floor", async () => {
    // WR = 3/10 = 0.30 < 0.45; PF = 300/700 = 0.43 < 2.0
    mockRows = makeRows(3, 7, 100, -100);
    const r = await checkSwingRegressionBaseline();
    expect(r.ok).toBe(false);
    // reason should mention both
    expect(r.reason).toMatch(/win.rate/i);
    expect(r.reason).toMatch(/profit.factor/i);
  });

  it("profitFactor is null (not ok=false) when there are no losses", async () => {
    // 10 wins, 0 losses → PF undefined/null, WR=100%, should be ok=true
    mockRows = makeRows(10, 0, 300, -200);
    const r = await checkSwingRegressionBaseline();
    expect(r.profitFactor).toBeNull();
    expect(r.ok).toBe(true); // PF null is treated as passing (no denominator)
  });

  it("returns ok=true (fail-open) when DB query throws", async () => {
    mockShouldThrow = true;
    const r = await checkSwingRegressionBaseline();
    expect(r.ok).toBe(true);
    expect(r.tradeCount).toBe(0);
    expect(r.winRate).toBeNull();
    expect(r.profitFactor).toBeNull();
    expect(r.reason).toMatch(/DB query failed/i);
  });

  it("handles null realizedPnl rows gracefully (skips them in win/loss tally)", async () => {
    // 8 valid rows + 2 null-pnl rows → tradeCount=10, only 8 processed
    mockRows = [
      ...makeRows(5, 3, 500, -200),
      { realizedPnl: null },
      { realizedPnl: null },
    ];
    const r = await checkSwingRegressionBaseline();
    expect(r.tradeCount).toBe(10); // db returns 10 rows
    // The 2 null rows are skipped in pnl tally but don't crash
    expect(r.winRate).toBeDefined();
  });

  it("computedAt is always a valid ISO timestamp", async () => {
    mockRows = makeRows(7, 3);
    const r = await checkSwingRegressionBaseline();
    expect(r.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("exact gate boundary: WR exactly at WR_FLOOR passes", async () => {
    // WR = 0.45 exactly: 45 wins, 55 losses, but we only use 10+
    // Use: 9 wins, 11 losses → WR = 9/20 = 0.45 exactly
    mockRows = [
      ...makeRows(9, 11, 500, -200),
    ];
    const r = await checkSwingRegressionBaseline();
    expect(r.winRate).toBeCloseTo(0.45, 3);
    // At the floor, ok depends on both WR and PF; WR just barely passes
    // PF: 4500/2200 = 2.045 > 2.0 → both pass
    expect(r.ok).toBe(true);
  });

  it("exact gate boundary: WR just below WR_FLOOR fails", async () => {
    // 4 wins, 6 losses → WR = 0.40 < 0.45
    mockRows = makeRows(4, 6, 500, -200);
    const r = await checkSwingRegressionBaseline();
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
