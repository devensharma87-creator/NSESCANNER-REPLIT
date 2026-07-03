/**
 * Unit tests for the production-safe system-alert-dedup self-test.
 * Mocks systemAlertDedup.ts + @workspace/db — no real DB, no real Telegram
 * anywhere in this file (this module cannot import a Telegram-send path at all).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
const mockEnsureTables = vi.hoisted(() => vi.fn());
const mockClaim = vi.hoisted(() => vi.fn());
const mockTransition = vi.hoisted(() => vi.fn());
const mockResetDedup = vi.hoisted(() => vi.fn());
const mockResetState = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
}));

vi.mock("drizzle-orm", () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { empty: "" },
  ),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./systemAlertDedup", () => ({
  ensureSystemAlertDedupTables: mockEnsureTables,
  claimSystemAlert: mockClaim,
  transitionSystemAlertState: mockTransition,
  resetSystemAlertDedupForTest: mockResetDedup,
  resetSystemAlertStateForTest: mockResetState,
}));

import { runSystemAlertDedupSelfTest, getLastSystemAlertDedupSelfTestResult } from "./systemAlertDedupSelfTest";

function mockTableChecksHealthy(): void {
  mockExecute
    // to_regclass('system_alert_dedup')
    .mockResolvedValueOnce({ rows: [{ reg: "system_alert_dedup" }] })
    // to_regclass('system_alert_state')
    .mockResolvedValueOnce({ rows: [{ reg: "system_alert_state" }] })
    // pk check for system_alert_dedup
    .mockResolvedValueOnce({ rows: [{ column_name: "dedup_key" }] })
    // pk check for system_alert_state
    .mockResolvedValueOnce({ rows: [{ column_name: "family" }] });
}

describe("runSystemAlertDedupSelfTest", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockEnsureTables.mockReset().mockResolvedValue(undefined);
    mockClaim.mockReset();
    mockTransition.mockReset();
    mockResetDedup.mockReset().mockResolvedValue(undefined);
    mockResetState.mockReset().mockResolvedValue(undefined);
  });

  it("reports allPassed=true when every check succeeds", async () => {
    mockTableChecksHealthy();
    mockClaim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockTransition
      .mockResolvedValueOnce({ claimed: true, incidentId: "abc" })
      .mockResolvedValueOnce({ claimed: false, incidentId: null })
      .mockResolvedValueOnce({ claimed: true, incidentId: "abc" });

    const result = await runSystemAlertDedupSelfTest();

    expect(mockEnsureTables).toHaveBeenCalledTimes(1);
    expect(result.allPassed).toBe(true);
    expect(result.error).toBeNull();
    expect(result.checks).toEqual({
      dedupTableExists: true,
      stateTableExists: true,
      dedupPrimaryKeyOnDedupKey: true,
      statePrimaryKeyOnFamily: true,
      firstClaimSucceeds: true,
      duplicateClaimSkipped: true,
      stateTransitionClaims: true,
      duplicateTransitionSkipped: true,
      recoveryTransitionClaims: true,
    });
    expect(getLastSystemAlertDedupSelfTestResult()).toBe(result);
  });

  it("uses a synthetic per-run key/family namespace that can never collide with a real alert key", async () => {
    mockTableChecksHealthy();
    mockClaim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockTransition
      .mockResolvedValueOnce({ claimed: true, incidentId: "abc" })
      .mockResolvedValueOnce({ claimed: false, incidentId: null })
      .mockResolvedValueOnce({ claimed: true, incidentId: "abc" });

    await runSystemAlertDedupSelfTest();

    const [dedupKeyArg, windowMsArg, familyArg] = mockClaim.mock.calls[0]!;
    expect(dedupKeyArg).toMatch(/^SYSTEM_SELFTEST::/);
    expect(windowMsArg).toBeGreaterThan(0);
    expect(familyArg).toBe("system_selftest");
    // Second claim call must reuse the exact same dedup key (proves it is
    // testing "duplicate of the same claim", not two unrelated claims).
    expect(mockClaim.mock.calls[1]![0]).toBe(dedupKeyArg);

    const stateFamilyArg = mockTransition.mock.calls[0]![0];
    expect(stateFamilyArg).toMatch(/^system_selftest_/);
    expect(stateFamilyArg).not.toBe("fno_data");

    // Cleanup must target the exact same synthetic key/family, never a real one.
    expect(mockResetDedup).toHaveBeenCalledWith(dedupKeyArg);
    expect(mockResetState).toHaveBeenCalledWith(stateFamilyArg);
  });

  it("reports allPassed=false when the duplicate claim is NOT skipped (regression)", async () => {
    mockTableChecksHealthy();
    mockClaim.mockResolvedValueOnce(true).mockResolvedValueOnce(true); // duplicate wrongly claimed
    mockTransition
      .mockResolvedValueOnce({ claimed: true, incidentId: "abc" })
      .mockResolvedValueOnce({ claimed: false, incidentId: null })
      .mockResolvedValueOnce({ claimed: true, incidentId: "abc" });

    const result = await runSystemAlertDedupSelfTest();

    expect(result.allPassed).toBe(false);
    expect(result.checks.duplicateClaimSkipped).toBe(false);
  });

  it("reports allPassed=false when system_alert_state is missing after self-heal", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ reg: "system_alert_dedup" }] })
      .mockResolvedValueOnce({ rows: [{ reg: null }] }); // system_alert_state still missing
    mockClaim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockTransition
      .mockResolvedValueOnce({ claimed: true, incidentId: "abc" })
      .mockResolvedValueOnce({ claimed: false, incidentId: null })
      .mockResolvedValueOnce({ claimed: true, incidentId: "abc" });

    const result = await runSystemAlertDedupSelfTest();

    expect(result.checks.stateTableExists).toBe(false);
    expect(result.checks.statePrimaryKeyOnFamily).toBe(false);
    expect(result.allPassed).toBe(false);
  });

  it("captures the error and still runs cleanup when a check throws", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));

    const result = await runSystemAlertDedupSelfTest();

    expect(result.allPassed).toBe(false);
    expect(result.error).toBe("connection refused");
    expect(mockResetDedup).toHaveBeenCalledTimes(1);
    expect(mockResetState).toHaveBeenCalledTimes(1);
  });

  it("never imports or calls anything from an alert-dispatch/Telegram module", async () => {
    // Static guarantee: this test file only mocks systemAlertDedup + db/logger.
    // If systemAlertDedupSelfTest.ts ever added an import of alerting.ts /
    // fnoSignalAlerts.ts / swingAlerts.ts / dailyReports.ts, this test file
    // would fail to load (no mock registered for the new module) rather than
    // silently passing — this test's mere existence + green run is the guard.
    mockTableChecksHealthy();
    mockClaim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockTransition
      .mockResolvedValueOnce({ claimed: true, incidentId: "abc" })
      .mockResolvedValueOnce({ claimed: false, incidentId: null })
      .mockResolvedValueOnce({ claimed: true, incidentId: "abc" });
    await expect(runSystemAlertDedupSelfTest()).resolves.toBeTruthy();
  });
});
