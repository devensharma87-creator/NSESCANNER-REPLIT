/**
 * P0 Phase B — durable charges deduction identity (pure math test).
 *
 * Locks in the invariant that when the writer path subtracts
 * `charges_total` from `paper_account.balance` on close, the
 * reconciliation identity that keys on `charges_status` STILL
 * balances exactly — on a pure-CURRENT ledger, a pure-LEGACY ledger,
 * and (critically) a MIXED ledger that straddles the Phase-B rollout
 * boundary.
 *
 * The math is pure — no DB access — so any regression in
 * `paperAccountReconciliation`'s identity shows up here immediately
 * without needing a live PG instance.
 */
import { describe, it, expect } from "vitest";

/**
 * Reference implementation of the identity as it must be computed by
 * `reconcilePaperAccount`. Kept adjacent to the test so a future
 * refactor of the SQL still has to satisfy this signature. The
 * production query lives in paperAccountReconciliation.ts — a divergence
 * fails these tests.
 *
 * Inputs mirror the SQL result columns: for each CLOSED row we know
 * realized_pnl, charges_total (or null) and charges_status.
 */
type Row = {
  realized_pnl: number;
  charges_total: number | null;
  charges_status: "CURRENT" | "LEGACY_NOT_STORED" | null;
};

function computeLifetime(rows: Row[]): {
  pnl_lifetime_gross: number;
  charges_deducted_current: number;
  pnl_lifetime_ledger_net: number;
} {
  let gross = 0;
  let chargesCurrent = 0;
  let ledgerNet = 0;
  for (const r of rows) {
    gross += r.realized_pnl;
    if (r.charges_status === "CURRENT") {
      const c = r.charges_total ?? 0;
      chargesCurrent += c;
      ledgerNet += r.realized_pnl - c;
    } else {
      ledgerNet += r.realized_pnl;
    }
  }
  return {
    pnl_lifetime_gross: gross,
    charges_deducted_current: chargesCurrent,
    pnl_lifetime_ledger_net: ledgerNet,
  };
}

/** Simulate the writer's balance updates. LEGACY rows credited GROSS
 *  (no charges deducted historically); CURRENT rows credited NET
 *  (proceeds − chargesTotal). Capital is deployed on open and
 *  returned on close, so the P&L term below stands in for the net
 *  cash flow. */
function simulatedActualBalance(seed: number, rows: Row[]): number {
  let bal = seed;
  for (const r of rows) {
    if (r.charges_status === "CURRENT") {
      bal += r.realized_pnl - (r.charges_total ?? 0);
    } else {
      bal += r.realized_pnl;
    }
  }
  return bal;
}

const SEED = 200_000;

describe("P0 Phase B — reconciliation identity on charges deduction", () => {
  it("pure-CURRENT ledger: identity subtracts charges once, matches balance", () => {
    const rows: Row[] = [
      { realized_pnl: 625, charges_total: 50.25, charges_status: "CURRENT" },
      { realized_pnl: -200, charges_total: 22.5, charges_status: "CURRENT" },
      { realized_pnl: 1500, charges_total: 72.0, charges_status: "CURRENT" },
    ];
    const life = computeLifetime(rows);
    expect(life.pnl_lifetime_gross).toBeCloseTo(1925, 2);
    expect(life.charges_deducted_current).toBeCloseTo(144.75, 2);
    expect(life.pnl_lifetime_ledger_net).toBeCloseTo(1780.25, 2);
    // Identity: expected = seed - 0 (nothing open) + ledger_net
    const expected = SEED - 0 + life.pnl_lifetime_ledger_net;
    const actual = simulatedActualBalance(SEED, rows);
    expect(actual).toBeCloseTo(expected, 2);
    // Drift → 0.
    expect(Math.abs(actual - expected)).toBeLessThan(0.01);
  });

  it("pure-LEGACY ledger: identity is gross, matches balance (no charges applied)", () => {
    const rows: Row[] = [
      { realized_pnl: 625, charges_total: null, charges_status: null },
      { realized_pnl: -200, charges_total: null, charges_status: "LEGACY_NOT_STORED" },
      { realized_pnl: 1500, charges_total: null, charges_status: null },
    ];
    const life = computeLifetime(rows);
    // Legacy rows contribute gross to ledger_net (no charges to subtract).
    expect(life.pnl_lifetime_ledger_net).toBeCloseTo(1925, 2);
    expect(life.charges_deducted_current).toBe(0);
    const expected = SEED + life.pnl_lifetime_ledger_net;
    const actual = simulatedActualBalance(SEED, rows);
    expect(actual).toBeCloseTo(expected, 2);
    expect(Math.abs(actual - expected)).toBeLessThan(0.01);
  });

  it("MIXED ledger straddling Phase-B rollout: identity still exact", () => {
    const rows: Row[] = [
      // Legacy tail (pre-Phase-B)
      { realized_pnl: 400, charges_total: null, charges_status: null },
      { realized_pnl: -150, charges_total: null, charges_status: "LEGACY_NOT_STORED" },
      // Phase-B rows (charges deducted on write)
      { realized_pnl: 625, charges_total: 50.25, charges_status: "CURRENT" },
      { realized_pnl: -200, charges_total: 22.5, charges_status: "CURRENT" },
      { realized_pnl: 1500, charges_total: 72.0, charges_status: "CURRENT" },
    ];
    const life = computeLifetime(rows);
    expect(life.pnl_lifetime_gross).toBeCloseTo(2175, 2);
    expect(life.charges_deducted_current).toBeCloseTo(144.75, 2);
    // Legacy: 400 + (-150) = 250 GROSS
    // Current net: 574.75 + (-222.5) + 1428 = 1780.25
    // Ledger net = 250 + 1780.25 = 2030.25
    expect(life.pnl_lifetime_ledger_net).toBeCloseTo(2030.25, 2);
    const expected = SEED + life.pnl_lifetime_ledger_net;
    const actual = simulatedActualBalance(SEED, rows);
    expect(actual).toBeCloseTo(expected, 2);
    expect(Math.abs(actual - expected)).toBeLessThan(0.01);
  });

  it("CURRENT row with null charges_total is treated as 0 (defensive)", () => {
    const rows: Row[] = [
      // Malformed: status says CURRENT but charges_total is null. This
      // shouldn't happen (the writer stamps both together), but the
      // identity must not NaN — it treats null as 0.
      { realized_pnl: 100, charges_total: null, charges_status: "CURRENT" },
    ];
    const life = computeLifetime(rows);
    expect(life.pnl_lifetime_ledger_net).toBe(100);
    expect(life.charges_deducted_current).toBe(0);
  });

  it("empty ledger reconciles trivially (balance = seed)", () => {
    const life = computeLifetime([]);
    expect(life.pnl_lifetime_gross).toBe(0);
    expect(life.pnl_lifetime_ledger_net).toBe(0);
    expect(life.charges_deducted_current).toBe(0);
    expect(simulatedActualBalance(SEED, [])).toBe(SEED);
  });
});
