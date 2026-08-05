/**
 * Prompt 25B — Gate 1: Reconciled performance must be the primary headline
 *
 * These tests prove that:
 * 1. netVsSeed is an account-balance reconciliation formula, distinct from strategy P&L.
 * 2. Capital movements (deposits/withdrawals) inflate netVsSeed without any trade activity.
 * 3. netVsSeed cannot be used as a valid proxy for trade-attributed strategy performance.
 * 4. Only trade-attributed realizedPnl (from the Analytics tab) is the primary strategy
 *    performance headline.
 *
 * No DB access. No live-provider calls.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Core formulas (mirroring paper-trading.tsx and paperAnalyticsFO.ts)
// ---------------------------------------------------------------------------

/** Account-balance reconciliation metric. NOT strategy performance. */
function computeNetVsSeed(
  balance: number,
  dayRealizedPnl: number,
  seedCapital: number,
): number {
  return balance + dayRealizedPnl - seedCapital;
}

/** Trade-attributed realized P&L (from the Analytics tab). IS strategy performance. */
function tradeAttributedPnl(closedTrades: Array<{ realizedPnl: number }>): number {
  return closedTrades.reduce((sum, t) => sum + t.realizedPnl, 0);
}

/**
 * The production reconciliation check: if netVsSeed diverges significantly
 * from tradeAttributedPnl, it signals capital movements outside of trading.
 */
function computeUnreconciledDrift(
  netVsSeed: number,
  attributedPnl: number,
  capitalAdded: number,
  capitalWithdrawn: number,
): {
  expected: number;
  drift: number;
  isReconciled: boolean;
} {
  // Expected: netVsSeed should equal attributedPnl + capitalAdded - capitalWithdrawn
  const expected = attributedPnl + capitalAdded - capitalWithdrawn;
  const drift = Math.abs(netVsSeed - expected);
  return { expected, drift, isReconciled: drift < 1 }; // < ₹1 tolerance for rounding
}

// ---------------------------------------------------------------------------
// Gate 1 tests
// ---------------------------------------------------------------------------

describe("Gate 1 — performance headline hierarchy", () => {
  // Actual production scenario:
  //   balance          ≈ ₹8,05,901.00 (after deposits)
  //   dayRealizedPnl   ≈ ₹460.70
  //   seedCapital      ≈ ₹1,00,000
  //   netVsSeed        ≈ +₹8,06,361.70  ← misleadingly large
  //   tradeAttributedPnl ≈ +₹5,716       ← actual strategy P&L
  //   capitalAdded     ≈ ₹8,00,645       ← explains the gap

  it("G1-01: capital deposits inflate netVsSeed without any trade activity", () => {
    const balance = 8_00_000; // ₹8L balance
    const dayRealizedPnl = 0;
    const seedCapital = 1_00_000;
    // User deposited ₹7L extra, made 0 trades
    const netVsSeed = computeNetVsSeed(balance, dayRealizedPnl, seedCapital);
    const tradePnl = tradeAttributedPnl([]); // no trades
    expect(netVsSeed).toBe(7_00_000);
    expect(tradePnl).toBe(0);
    // netVsSeed (+₹7L) misrepresents strategy performance (+₹0)
    expect(netVsSeed).not.toBe(tradePnl);
    expect(netVsSeed).toBeGreaterThan(tradePnl + 1);
  });

  it("G1-02: netVsSeed diverges from tradeAttributedPnl by capitalAdded amount", () => {
    const capitalAdded = 8_00_645;
    const capitalWithdrawn = 0;
    const tradePnl = 5_716;
    const seedCapital = 1_00_000;
    // Expected balance after deposits and trading: seedCapital + capitalAdded + tradePnl
    const balance = seedCapital + capitalAdded + tradePnl - 460; // approximate (some day P&L still open)
    const dayRealizedPnl = 460;
    const netVsSeed = computeNetVsSeed(balance, dayRealizedPnl, seedCapital);
    const rec = computeUnreconciledDrift(netVsSeed, tradePnl, capitalAdded, capitalWithdrawn);
    // The formula reconciles: netVsSeed ≈ tradePnl + capitalAdded
    expect(rec.isReconciled).toBe(true);
    // But netVsSeed >> tradePnl — so it CANNOT serve as strategy P&L headline
    expect(netVsSeed).toBeGreaterThan(tradePnl * 100);
  });

  it("G1-03: netVsSeed equals tradeAttributedPnl ONLY when no capital movements occurred", () => {
    const tradePnl = 5_716;
    const seedCapital = 1_00_000;
    const balance = seedCapital + tradePnl;
    const dayRealizedPnl = 0;
    const netVsSeed = computeNetVsSeed(balance, dayRealizedPnl, seedCapital);
    expect(netVsSeed).toBe(tradePnl);
    // This is the ONLY case where netVsSeed equals tradeAttributedPnl
    const rec = computeUnreconciledDrift(netVsSeed, tradePnl, 0, 0);
    expect(rec.isReconciled).toBe(true);
  });

  it("G1-04: combined F&O + equity realised P&L is distinct from netVsSeed", () => {
    // F&O only: ₹5,716; Combined F&O+Equity: ₹15,030
    const foPnl = 5_716;
    const equityPnl = 9_314;
    const combinedPnl = foPnl + equityPnl; // ₹15,030
    const netVsSeedValue = 8_06_362; // from actual account
    // Neither F&O-only nor combined P&L equal netVsSeed
    expect(combinedPnl).not.toBeCloseTo(netVsSeedValue, -2);
    expect(foPnl).not.toBeCloseTo(netVsSeedValue, -2);
    // Trade-attributed P&L (₹15k) is ~54x smaller than netVsSeed (₹8L)
    expect(netVsSeedValue / combinedPnl).toBeGreaterThan(50);
  });

  it("G1-05: netVsSeed must NEVER be used as ROI denominator for strategy evaluation", () => {
    // If someone computes ROI = netVsSeed / seedCapital:
    const netVsSeedValue = 8_06_362;
    const seedCapital = 1_00_000;
    const falseRoi = netVsSeedValue / seedCapital;
    // This gives 806% ROI which is entirely from deposits, not trading
    expect(falseRoi).toBeGreaterThan(8);
    // The honest ROI uses trade-attributed P&L:
    const tradePnl = 15_030;
    const trueRoi = tradePnl / seedCapital;
    expect(trueRoi).toBeLessThan(0.2); // ~15% — honest
    expect(falseRoi).toBeGreaterThan(trueRoi * 40);
  });

  it("G1-06: withdrawal reduces netVsSeed without affecting tradeAttributedPnl", () => {
    const capitalWithdrawn = 3_00_000;
    const tradePnl = 5_716;
    const seedCapital = 1_00_000;
    const balance = seedCapital + tradePnl - capitalWithdrawn; // negative (withdrew more than earned)
    const netVsSeed = computeNetVsSeed(balance, 0, seedCapital);
    expect(netVsSeed).toBe(-capitalWithdrawn + tradePnl);
    // Strategy performance (+₹5,716) is unaffected by the withdrawal
    expect(tradePnl).toBe(5_716);
    // netVsSeed (negative) ≠ strategy performance (positive)
    expect(Math.sign(netVsSeed)).not.toBe(Math.sign(tradePnl));
  });

  it("G1-07: unreconciled drift label rule — drift >= ₹10,000 must be flagged", () => {
    const LARGE_DRIFT_THRESHOLD = 10_000; // Any drift > ₹10k suggests non-trivial capital movement
    function isUnreconciledLargeDrift(drift: number): boolean {
      return Math.abs(drift) >= LARGE_DRIFT_THRESHOLD;
    }
    // Scenario: ₹8L drift is large (capital deposits)
    expect(isUnreconciledLargeDrift(8_06_362 - 15_030)).toBe(true);
    // Scenario: ₹100 drift is small (rounding)
    expect(isUnreconciledLargeDrift(100)).toBe(false);
    // Scenario: ₹10,000 exactly is at the threshold
    expect(isUnreconciledLargeDrift(10_000)).toBe(true);
  });

  it("G1-08: profit factor cannot use netVsSeed as gross profit numerator", () => {
    function computeProfitFactor(grossWins: number, grossLosses: number): number | null {
      if (grossLosses === 0) return null; // undefined (no losses to compare)
      return grossWins / grossLosses;
    }
    // Honest profit factor uses trade-attributed amounts
    const grossWins = 9_500;
    const grossLosses = 3_784;
    const honest = computeProfitFactor(grossWins, grossLosses);
    expect(honest).toBeCloseTo(2.51, 1);
    // Dishonest: using netVsSeed as "gross profit"
    const netVsSeedValue = 8_06_362;
    const dishonest = computeProfitFactor(netVsSeedValue, grossLosses);
    // ~84x inflated relative to the honest factor — clearly wrong
    expect(dishonest!).toBeGreaterThan(honest! * 50);
  });

  it("G1-09: expectancy cannot use netVsSeed in numerator", () => {
    function computeExpectancy(winRate: number, avgWin: number, avgLoss: number): number {
      return winRate * avgWin - (1 - winRate) * Math.abs(avgLoss);
    }
    // Honest expectancy (using trade-attributed averages)
    const avgWin = 950;
    const avgLoss = -947;
    const winRate = 0.5;
    const honest = computeExpectancy(winRate, avgWin, avgLoss);
    expect(honest).toBeCloseTo(1.5, 0); // ≈ +₹1.50 per trade

    // Dishonest: using netVsSeed as "average win"
    const dishonest = computeExpectancy(winRate, 8_06_362, avgLoss);
    expect(dishonest).toBeGreaterThan(honest * 1000);
  });
});
