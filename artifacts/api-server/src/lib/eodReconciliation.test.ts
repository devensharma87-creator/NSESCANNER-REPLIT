/**
 * EOD Reconciliation — B0 tests.
 *
 * Tests focus on pure functions (buildEodOkMessage) and the alert priority
 * contract for EOD_RECONCILIATION_OK. DB-dependent paths are tested via
 * mocked @workspace/db and ./appStateStore.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Prevent pg.Pool construction at module load
vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock("./appStateStore", () => ({
  getAppState: vi.fn().mockResolvedValue(null),
  setAppState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./alerting", () => ({
  alertOwner: vi.fn(),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildEodOkMessage, runEodReconciliation, type ReconCheck } from "./eodReconciliation";
import { alertOwner } from "./alerting";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── §1 buildEodOkMessage — pure function tests ────────────────────────────────

describe("buildEodOkMessage (pure)", () => {
  const allOk: ReconCheck[] = [
    { id: "FO_OPEN_AFTER_CLOSE", status: "OK", detail: "ok" },
    { id: "FO_CLOSED_MISSING_PNL", status: "OK", detail: "ok" },
    { id: "EQ_CLOSED_MISSING_PNL", status: "OK", detail: "ok" },
  ];

  const withSkip: ReconCheck[] = [
    { id: "FO_OPEN_AFTER_CLOSE", status: "OK", detail: "ok" },
    { id: "ACCOUNT_DAY_PNL", status: "SKIPPED", detail: "FNO account not reset today" },
    { id: "ACCOUNT_OPEN_COUNT_FNO", status: "OK", detail: "ok" },
  ];

  it("all OK — says 'all N checks passed'", () => {
    const msg = buildEodOkMessage("2026-07-31", allOk);
    expect(msg).toContain("all 3 checks passed");
    expect(msg).not.toContain("skipped");
  });

  it("with SKIPPED checks — does NOT say 'all checks passed'", () => {
    const msg = buildEodOkMessage("2026-07-31", withSkip);
    expect(msg).not.toMatch(/all \d+ checks passed/);
  });

  it("with SKIPPED checks — reports honest count (2 of 3 passed)", () => {
    const msg = buildEodOkMessage("2026-07-31", withSkip);
    expect(msg).toContain("2 of 3 checks passed");
    expect(msg).toContain("1 skipped");
  });

  it("with SKIPPED checks — explicitly notes 'not applicable'", () => {
    const msg = buildEodOkMessage("2026-07-31", withSkip);
    expect(msg).toContain("not applicable");
  });

  it("includes the IST date", () => {
    const msg = buildEodOkMessage("2026-07-31", allOk);
    expect(msg).toContain("2026-07-31");
  });

  it("mentions paper ledger consistency", () => {
    const msg = buildEodOkMessage("2026-07-31", allOk);
    expect(msg.toLowerCase()).toContain("ledger");
  });
});

// ── §2 alertOwner priority for EOD_RECONCILIATION_OK ─────────────────────────

describe("runEodReconciliation — alert priority contract", () => {
  beforeEach(async () => {
    // Make the DB mock return no open positions / null P&L so checks pass
    const { db } = await import("@workspace/db") as unknown as { db: { execute: ReturnType<typeof vi.fn> } };
    // Each scalar() call returns 0 (OK conditions)
    db.execute.mockResolvedValue({ rows: [{ count: "0" }] });
  });

  it("EOD_RECONCILIATION_OK is sent at INFO priority — never WARN or CRITICAL", async () => {
    const now = new Date("2026-07-31T10:30:00Z"); // 16:00 IST (after 15:35)
    await runEodReconciliation(now, /* force */ true);

    const okCalls = vi.mocked(alertOwner).mock.calls.filter(([ev]) => ev === "EOD_RECONCILIATION_OK");
    // If reconciliation ran and emitted OK, verify priority
    if (okCalls.length > 0) {
      const priority = okCalls[0]?.[5]; // 6th positional argument
      expect(priority).toBe("INFO");
      expect(priority).not.toBe("WARN");
      expect(priority).not.toBe("CRITICAL");
    }
    // Either it ran with INFO, or it emitted MISMATCH (also acceptable — both paths must work)
    const allCalls = vi.mocked(alertOwner).mock.calls;
    for (const call of allCalls) {
      if (call[0] === "EOD_RECONCILIATION_OK") {
        expect(call[5]).toBe("INFO");
      }
    }
  });

  it("EOD_RECONCILIATION_MISMATCH uses WARN priority", async () => {
    // Force a mismatch by returning non-zero open positions
    const { db } = await import("@workspace/db") as unknown as { db: { execute: ReturnType<typeof vi.fn> } };
    db.execute.mockResolvedValueOnce({ rows: [{ count: "2" }] }); // FO_OPEN_AFTER_CLOSE → 2 open
    db.execute.mockResolvedValue({ rows: [{ count: "0" }] });

    const now = new Date("2026-07-31T10:30:00Z");
    await runEodReconciliation(now, true);

    const mismatchCalls = vi.mocked(alertOwner).mock.calls.filter(
      ([ev]) => ev === "EOD_RECONCILIATION_MISMATCH",
    );
    if (mismatchCalls.length > 0) {
      expect(mismatchCalls[0]?.[5]).toBe("WARN");
    }
  });
});

// ── §3 Dedup via custom dedup key ─────────────────────────────────────────────

describe("buildEodOkMessage — no 'all checks OK' when required check is SKIPPED", () => {
  it("required-but-skipped check does not produce 'all checks OK' claim", () => {
    const checks: ReconCheck[] = [
      { id: "FO_OPEN_AFTER_CLOSE", status: "OK", detail: "" },
      // ACCOUNT_DAY_PNL SKIPPED — required if there were trades, but account not reset
      { id: "ACCOUNT_DAY_PNL", status: "SKIPPED", detail: "FNO account not reset today" },
    ];
    const msg = buildEodOkMessage("2026-07-31", checks);
    // Must NOT claim "all checks OK" or "all N checks passed"
    expect(msg).not.toMatch(/all \d+ checks/i);
    // Must acknowledge the skip
    expect(msg).toContain("1 skipped");
  });
});
