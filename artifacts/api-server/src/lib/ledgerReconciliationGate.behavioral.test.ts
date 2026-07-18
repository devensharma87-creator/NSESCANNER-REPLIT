/**
 * Behavioral tests for checkLedgerReconciliationGate.
 *
 * These tests import the gate function directly with a mock reconcileFn so
 * they are NOT affected by the FNO_AUTO_OPEN_C0_BLOCKED or
 * EQUITY_AUTO_OPEN_C0_BLOCKED constants. They exist specifically to prove
 * that the gate logic is correct independent of the C0 hard-block — so that
 * when C0 is lifted, this safety net is already proven and not "hidden" by
 * the C0 short-circuit.
 *
 * The four mandatory behaviors (per auditor docket):
 *   1. Drift detected  → blocked, both segments
 *   2. Reconciled      → not blocked
 *   3. Query failure   → blocked (fail-closed), both segments
 *   4. Gate callable independent of C0 const
 */
import { describe, it, expect } from "vitest";
import {
  checkLedgerReconciliationGate,
  type ReconciliationResult,
} from "./paperAccountReconciliation";

function makeResult(overrides: Partial<ReconciliationResult> & {
  reconciled: boolean;
  driftAmount: number;
}): ReconciliationResult {
  const { reconciled, driftAmount, ...rest } = overrides;
  return {
    segment: "FNO",
    istDate: "2026-07-20",
    computedAt: new Date().toISOString(),
    seedCapital: 200_000,
    actualBalance: 200_000 + driftAmount,
    recordedDayRealizedPnl: 0,
    capitalDeployedTodayOpen: 0,
    closedTodayCount: 0,
    closedTodayCapitalReturned: 0,
    closedTodayRealizedPnl: 0,
    carryOverOpenCount: 0,
    carryOverCapitalDeployed: 0,
    openMarkToMarketPnl: 0,
    expectedBalance: 200_000,
    driftAmount,
    reconciled,
    notes: reconciled ? [] : [`Drift ₹${driftAmount.toFixed(2)} exceeds tolerance`],
    chargesEstimate: {
      estimatedTotal: 0,
      estimatedToday: 0,
      estimated: true,
      schedule: "FNO_V1_2026Q1",
    },
    grossRealizedPnl: 0,
    estimatedNetRealizedPnl: 0,
    chargesActuallyDeducted: 0,
    ledgerNetRealizedPnl: 0,
    ...rest,
  };
}

describe("checkLedgerReconciliationGate — drift detection", () => {
  it("passes when ledger reconciles (zero drift)", async () => {
    const result = await checkLedgerReconciliationGate(
      "FNO",
      "2026-07-20",
      async () => makeResult({ reconciled: true, driftAmount: 0 }),
    );
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("RECONCILED");
    expect(result.driftAmount).toBe(0);
  });

  it("passes when drift is within tolerance (reconciled=true from module)", async () => {
    const result = await checkLedgerReconciliationGate(
      "FNO",
      "2026-07-20",
      async () => makeResult({ reconciled: true, driftAmount: 0.005 }),
    );
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("RECONCILED");
  });

  it("blocks FNO opens when ledger drift is detected (₹799,772.70 — current incident)", async () => {
    const INCIDENT_DRIFT = 799_772.70;
    const result = await checkLedgerReconciliationGate(
      "FNO",
      "2026-07-20",
      async () => makeResult({ reconciled: false, driftAmount: INCIDENT_DRIFT }),
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("LEDGER_RECONCILIATION_FAILED");
    expect(result.driftAmount).toBeCloseTo(INCIDENT_DRIFT, 1);
  });

  it("blocks EQUITY opens when ledger drift is detected", async () => {
    const result = await checkLedgerReconciliationGate(
      "EQUITY",
      "2026-07-20",
      async () => makeResult({
        segment: "EQUITY",
        reconciled: false,
        driftAmount: 500,
        seedCapital: 1_000_000,
        actualBalance: 1_000_500,
        expectedBalance: 1_000_000,
      }),
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("LEDGER_RECONCILIATION_FAILED");
    expect(result.driftAmount).toBeCloseTo(500, 1);
  });

  it("blocks when drift is small but reconciled=false", async () => {
    const result = await checkLedgerReconciliationGate(
      "FNO",
      "2026-07-20",
      async () => makeResult({ reconciled: false, driftAmount: 0.50 }),
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("LEDGER_RECONCILIATION_FAILED");
  });
});

describe("checkLedgerReconciliationGate — fail-closed on query errors", () => {
  it("blocks FNO opens when reconcile fn throws (fail-closed)", async () => {
    const result = await checkLedgerReconciliationGate(
      "FNO",
      "2026-07-20",
      async () => { throw new Error("DB connection refused"); },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("LEDGER_RECONCILIATION_QUERY_ERROR");
    expect(isNaN(result.driftAmount)).toBe(true);
  });

  it("blocks EQUITY opens when reconcile fn throws (fail-closed)", async () => {
    const result = await checkLedgerReconciliationGate(
      "EQUITY",
      "2026-07-20",
      async () => { throw new Error("Query timeout"); },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("LEDGER_RECONCILIATION_QUERY_ERROR");
    expect(isNaN(result.driftAmount)).toBe(true);
  });

  it("blocks on rejected promise (not just thrown errors)", async () => {
    const result = await checkLedgerReconciliationGate(
      "FNO",
      "2026-07-20",
      async () => Promise.reject(new Error("Unexpected rejection")),
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("LEDGER_RECONCILIATION_QUERY_ERROR");
  });
});

describe("checkLedgerReconciliationGate — C0 isolation (auditor requirement)", () => {
  /**
   * The C0 constants (FNO_AUTO_OPEN_C0_BLOCKED = true,
   * EQUITY_AUTO_OPEN_C0_BLOCKED = true) are module-level consts that
   * return null BEFORE the reconciliation gate is reached in production.
   *
   * These tests call checkLedgerReconciliationGate directly — bypassing C0 —
   * to prove the gate logic is independently correct. When C0 is lifted, this
   * behavioral safety net is already verified.
   */
  it("FNO gate is testable and correct independent of FNO_AUTO_OPEN_C0_BLOCKED", async () => {
    const blocked = await checkLedgerReconciliationGate(
      "FNO",
      undefined,
      async () => makeResult({ reconciled: false, driftAmount: 50_000 }),
    );
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toBe("LEDGER_RECONCILIATION_FAILED");
  });

  it("EQUITY gate is testable and correct independent of EQUITY_AUTO_OPEN_C0_BLOCKED", async () => {
    const blocked = await checkLedgerReconciliationGate(
      "EQUITY",
      undefined,
      async () => makeResult({ segment: "EQUITY", reconciled: false, driftAmount: 1_000 }),
    );
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toBe("LEDGER_RECONCILIATION_FAILED");
  });

  it("gate returns not-blocked for a clean EQUITY account (independent of C0)", async () => {
    const result = await checkLedgerReconciliationGate(
      "EQUITY",
      undefined,
      async () => makeResult({ segment: "EQUITY", reconciled: true, driftAmount: 0 }),
    );
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("RECONCILED");
  });

  it("fail-closed holds independent of C0 for FNO", async () => {
    const result = await checkLedgerReconciliationGate(
      "FNO",
      undefined,
      async () => { throw new Error("Simulated outage"); },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("LEDGER_RECONCILIATION_QUERY_ERROR");
  });

  it("fail-closed holds independent of C0 for EQUITY", async () => {
    const result = await checkLedgerReconciliationGate(
      "EQUITY",
      undefined,
      async () => { throw new Error("Simulated outage"); },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("LEDGER_RECONCILIATION_QUERY_ERROR");
  });
});
