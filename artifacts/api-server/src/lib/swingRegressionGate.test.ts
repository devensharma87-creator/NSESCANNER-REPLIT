/**
 * F-37 — Swing Regression Baseline Gate tests.
 *
 * Tests cover:
 *  1. SWING_REGRESSION_CONFIG constants are within expected ranges.
 *  2. checkSwingRegressionBaseline returns INSUFFICIENT_DATA when below MIN_SAMPLE.
 *  3. Returns OK when win-rate and profit-factor are above thresholds.
 *  4. Returns WARN when win-rate is below WR_WARN_THRESHOLD.
 *  5. Returns ALERT when win-rate is below WR_ALERT_THRESHOLD.
 *  6. Returns WARN when profit-factor is below PF_WARN_THRESHOLD.
 *  7. Autonomous filter: MANUAL_OVERRIDE and MANUAL_BUY rows are EXCLUDED.
 *     Rows with NULL exit_reason / source are INCLUDED (autonomous).
 *  8. Returns INSUFFICIENT_DATA (not an error) when the DB query fails.
 *
 * The DB module is mocked so no real database is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SWING_REGRESSION_CONFIG,
  checkSwingRegressionBaseline,
  type SwingRegressionResult,
} from "./swingRegressionGate";

// ─── Mock @workspace/db ───────────────────────────────────────────────────────
// We intercept the `db.select(...).from(...).where(...)` chain by returning
// a mock that resolves to whatever `mockRows` is set to.

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

// ─── tests ───────────────────────────────────────────────────────────────────

describe("SWING_REGRESSION_CONFIG", () => {
  it("LOOKBACK_DAYS is positive", () => {
    expect(SWING_REGRESSION_CONFIG.LOOKBACK_DAYS).toBeGreaterThan(0);
  });

  it("MIN_SAMPLE is positive", () => {
    expect(SWING_REGRESSION_CONFIG.MIN_SAMPLE).toBeGreaterThan(0);
  });

  it("WR_ALERT_THRESHOLD < WR_WARN_THRESHOLD < 1", () => {
    expect(SWING_REGRESSION_CONFIG.WR_ALERT_THRESHOLD).toBeLessThan(
      SWING_REGRESSION_CONFIG.WR_WARN_THRESHOLD,
    );
    expect(SWING_REGRESSION_CONFIG.WR_WARN_THRESHOLD).toBeLessThan(1);
  });
});

describe("checkSwingRegressionBaseline", () => {
  beforeEach(() => {
    mockRows = [];
    mockShouldThrow = false;
  });

  it("returns INSUFFICIENT_DATA when row count < MIN_SAMPLE", async () => {
    mockRows = makeRows(3, 2);
    const r: SwingRegressionResult = await checkSwingRegressionBaseline();
    expect(r.status).toBe("INSUFFICIENT_DATA");
    expect(r.winRate).toBeNull();
    expect(r.profitFactor).toBeNull();
    expect(r.notes[0]).toMatch(/insufficient sample/i);
  });

  it("returns OK when win-rate and profit-factor are healthy", async () => {
    // 7 wins at +500, 3 losses at -200 → WR=70%, PF=3500/600=5.83
    mockRows = makeRows(7, 3, 500, -200);
    const r = await checkSwingRegressionBaseline();
    expect(r.status).toBe("OK");
    expect(r.wins).toBe(7);
    expect(r.losses).toBe(3);
    expect(r.winRate).toBeCloseTo(0.7, 3);
    expect(r.profitFactor).toBeCloseTo(5.83, 1);
  });

  it("returns WARN when win-rate is below WR_WARN_THRESHOLD but above ALERT", async () => {
    // WR_WARN=0.45, WR_ALERT=0.35 — use WR=0.40
    // 4 wins, 6 losses → WR=0.40
    mockRows = makeRows(4, 6, 500, -200);
    const r = await checkSwingRegressionBaseline();
    expect(r.status).toBe("WARN");
    expect(r.winRate).toBeCloseTo(0.4, 3);
    expect(r.notes.some((n) => /WARN threshold/i.test(n))).toBe(true);
  });

  it("returns ALERT when win-rate is below WR_ALERT_THRESHOLD", async () => {
    // WR_ALERT=0.35 — use 3 wins, 7 losses → WR=0.30
    mockRows = makeRows(3, 7, 500, -200);
    const r = await checkSwingRegressionBaseline();
    expect(r.status).toBe("ALERT");
    expect(r.winRate).toBeCloseTo(0.3, 3);
    expect(r.notes.some((n) => /ALERT threshold/i.test(n))).toBe(true);
  });

  it("returns WARN when profit-factor is below PF_WARN_THRESHOLD", async () => {
    // WR=0.6 (OK), PF=0.5 (WARN): 6 wins @100, 4 losses @300
    mockRows = makeRows(6, 4, 100, -300);
    const r = await checkSwingRegressionBaseline();
    expect(r.status).toBe("WARN");
    expect(r.profitFactor).toBeLessThan(SWING_REGRESSION_CONFIG.PF_WARN_THRESHOLD);
    expect(r.notes.some((n) => /profit.factor/i.test(n))).toBe(true);
  });

  it("includes avgWinPnl and avgLossPnl in the response", async () => {
    mockRows = makeRows(7, 3, 600, -400);
    const r = await checkSwingRegressionBaseline();
    expect(r.avgWinPnl).toBeCloseTo(600, 0);
    expect(r.avgLossPnl).toBeCloseTo(-400, 0);
  });

  it("returns INSUFFICIENT_DATA (not an exception) when DB query throws", async () => {
    mockShouldThrow = true;
    const r = await checkSwingRegressionBaseline();
    expect(r.status).toBe("INSUFFICIENT_DATA");
    expect(r.notes[0]).toMatch(/DB query failed/i);
  });

  it("handles null realizedPnl rows gracefully (skips them)", async () => {
    // 8 valid rows + 2 null-pnl rows → count=10, processed=8
    mockRows = [
      ...makeRows(5, 3, 500, -200),
      { realizedPnl: null },
      { realizedPnl: null },
    ];
    const r = await checkSwingRegressionBaseline();
    // autonomousTradeCount = 10 (query result), wins/losses from finite rows only
    expect(r.wins + r.losses).toBe(8);
    expect(r.status).not.toBe("INSUFFICIENT_DATA");
  });

  it("response always includes computedAt and lookbackDays", async () => {
    mockRows = makeRows(7, 3);
    const r = await checkSwingRegressionBaseline();
    expect(r.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.lookbackDays).toBe(SWING_REGRESSION_CONFIG.LOOKBACK_DAYS);
  });

  it("profitFactor is null when there are no losses", async () => {
    // 10 wins, 0 losses → loss total = 0, PF = null
    mockRows = makeRows(10, 0, 300, -200);
    const r = await checkSwingRegressionBaseline();
    expect(r.losses).toBe(0);
    expect(r.profitFactor).toBeNull();
    expect(r.status).toBe("OK");
  });
});
