/**
 * Unit tests for the DB-backed system alert dedup primitives.
 * Mocks @workspace/db — no real DB, no real Telegram send anywhere in this file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { empty: "" },
  ),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  claimSystemAlert,
  transitionSystemAlertState,
  getSystemAlertState,
  listRecentSystemAlertClaims,
  listSystemAlertStates,
  resetSystemAlertDedupTablesReadyForTest,
} from "./systemAlertDedup";

describe("claimSystemAlert", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    // Force ensureSystemAlertDedupTables to re-run its 2 CREATE TABLE calls
    // every test, so mockResolvedValueOnce sequencing below stays predictable
    // regardless of test execution order within this file.
    resetSystemAlertDedupTablesReadyForTest();
  });

  it("bypasses the DB entirely when windowMs is 0 (manual test isolation)", async () => {
    const claimed = await claimSystemAlert("MANUAL_TEST::x", 0, "manual");
    expect(claimed).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("claims when INSERT ... ON CONFLICT ... RETURNING returns a row", async () => {
    // CREATE TABLE calls (2x) + the claim insert
    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // create system_alert_dedup
      .mockResolvedValueOnce({ rows: [] }) // create system_alert_state
      .mockResolvedValueOnce({ rows: [{ dedup_key: "FNO_WARMUP_FAILED::2026-07-03" }] });

    const claimed = await claimSystemAlert("FNO_WARMUP_FAILED::2026-07-03", 60 * 60 * 1000, "fno_warmup");
    expect(claimed).toBe(true);
  });

  it("does NOT claim when the DO UPDATE WHERE clause excludes the row (still within window)", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }); // ON CONFLICT DO UPDATE WHERE false -> no RETURNING rows

    const claimed = await claimSystemAlert("FNO_WARMUP_FAILED::2026-07-03", 60 * 60 * 1000, "fno_warmup");
    expect(claimed).toBe(false);
  });

  it("fails OPEN (returns true) when the DB throws", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));

    const claimed = await claimSystemAlert("KITE_FINAL_WARNING::2026-07-03", 60 * 60 * 1000, "kite_readiness");
    expect(claimed).toBe(true);
  });
});

describe("transitionSystemAlertState", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    resetSystemAlertDedupTablesReadyForTest();
  });

  it("claims OK -> DEGRADED and mints an incidentId", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ incident_id: "fno_data-123-abc" }] });

    const result = await transitionSystemAlertState("fno_data", "OK", "DEGRADED");
    expect(result.claimed).toBe(true);
    expect(result.incidentId).toBe("fno_data-123-abc");
  });

  it("does not double-claim DEGRADED when already DEGRADED (CAS WHERE fails)", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }); // WHERE state='OK' excludes the already-DEGRADED row

    const result = await transitionSystemAlertState("fno_data", "OK", "DEGRADED");
    expect(result.claimed).toBe(false);
    expect(result.incidentId).toBeNull();
  });

  it("claims DEGRADED -> OK (recovery) and returns the prior incidentId", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ incident_id: "fno_data-123-abc" }] });

    const result = await transitionSystemAlertState("fno_data", "DEGRADED", "OK");
    expect(result.claimed).toBe(true);
    expect(result.incidentId).toBe("fno_data-123-abc");
  });

  it("a second real degrade cycle mints a NEW incidentId (not deduped by time)", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ incident_id: "fno_data-100-aaa" }] });
    const first = await transitionSystemAlertState("fno_data", "OK", "DEGRADED");

    mockExecute.mockResolvedValueOnce({ rows: [{ incident_id: "fno_data-200-bbb" }] });
    const second = await transitionSystemAlertState("fno_data", "OK", "DEGRADED");

    expect(first.incidentId).not.toBe(second.incidentId);
  });

  it("fails OPEN (claimed: true, incidentId: null) when the DB throws", async () => {
    mockExecute.mockRejectedValue(new Error("timeout"));
    const result = await transitionSystemAlertState("fno_data", "OK", "DEGRADED");
    expect(result.claimed).toBe(true);
    expect(result.incidentId).toBeNull();
  });
});

describe("cross-restart scenario — DB claim survives process restart", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    resetSystemAlertDedupTablesReadyForTest();
  });

  it("claimSystemAlert: DB claim prevents duplicate send after autoscale cold start (in-memory cleared)", async () => {
    // ── FIRST PROCESS BOOT ───────────────────────────────────────────────────
    // Fresh server start: in-memory lastAlerted Map is empty (not modelled here,
    // lives in alerting.ts). claimSystemAlert is the cross-process/cross-restart
    // source of truth. First call claims the dedup slot in the DB.
    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_dedup
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_state
      .mockResolvedValueOnce({ rows: [{ dedup_key: "KITE_SESSION_MISSING_PREOPEN::2026-07-14" }] }); // INSERT wins

    const firstClaim = await claimSystemAlert(
      "KITE_SESSION_MISSING_PREOPEN::2026-07-14",
      60 * 60 * 1000,
      "kite_readiness",
    );
    expect(firstClaim).toBe(true); // Telegram sent by first process

    // ── SIMULATE AUTOSCALE COLD START ────────────────────────────────────────
    // All module-level in-memory state (tablesReady, lastAlerted in alerting.ts)
    // resets when the process image is replaced. resetSystemAlertDedupTablesReadyForTest()
    // models the tablesReady latch — the key point is the DB row persists.
    resetSystemAlertDedupTablesReadyForTest();
    mockExecute.mockReset();

    // ── SECOND PROCESS BOOT (same alert, same 1-hour window) ─────────────────
    // ensureSystemAlertDedupTables re-runs (CREATE TABLE IF NOT EXISTS is idempotent).
    // The claim INSERT finds the existing row is still within the dedup window:
    // DO UPDATE WHERE sent_at < NOW() - interval evaluates to false → no RETURNING.
    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_dedup
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_state
      .mockResolvedValueOnce({ rows: [] }); // ON CONFLICT DO UPDATE WHERE false → no RETURNING row

    const secondClaim = await claimSystemAlert(
      "KITE_SESSION_MISSING_PREOPEN::2026-07-14",
      60 * 60 * 1000,
      "kite_readiness",
    );
    expect(secondClaim).toBe(false); // DB-backed dedup prevents the duplicate Telegram
  });

  it("claimSystemAlert: expired window after restart lets the alert fire again (per-day key scope)", async () => {
    // A new IST calendar day → a different dedup key → the DB claim for yesterday
    // does not suppress today's alert. This is by design: per-day keys ensure
    // the operator gets alerted each day Kite is still offline.
    resetSystemAlertDedupTablesReadyForTest();
    mockExecute.mockReset();

    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_dedup
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_state
      .mockResolvedValueOnce({ rows: [{ dedup_key: "KITE_SESSION_MISSING_PREOPEN::2026-07-15" }] }); // new day → claims

    const nextDayClaim = await claimSystemAlert(
      "KITE_SESSION_MISSING_PREOPEN::2026-07-15", // different date suffix = new key
      60 * 60 * 1000,
      "kite_readiness",
    );
    expect(nextDayClaim).toBe(true);
  });

  it("transitionSystemAlertState: CAS prevents duplicate DEGRADED alert after restart", async () => {
    // ── FIRST PROCESS ────────────────────────────────────────────────────────
    // F&O data goes down → OK→DEGRADED transition succeeds, mints incidentId.
    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_dedup
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_state
      .mockResolvedValueOnce({ rows: [{ incident_id: "fno_data-1714900000000-abc" }] }); // CAS wins

    const first = await transitionSystemAlertState("fno_data", "OK", "DEGRADED");
    expect(first.claimed).toBe(true);
    expect(first.incidentId).toBe("fno_data-1714900000000-abc");

    // ── SIMULATE RESTART ─────────────────────────────────────────────────────
    // In-memory boolean that tracked "we already sent the DEGRADED alert" is gone.
    // Without DB-backed CAS, the restarted process would send a second alert.
    resetSystemAlertDedupTablesReadyForTest();
    mockExecute.mockReset();

    // ── SECOND PROCESS: same degraded state, same family ─────────────────────
    // DB row says state='DEGRADED'. The CAS WHERE state='OK' clause fails
    // (state is already DEGRADED) → no RETURNING row.
    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_dedup
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_state
      .mockResolvedValueOnce({ rows: [] }); // WHERE state='OK' excludes DEGRADED row

    const second = await transitionSystemAlertState("fno_data", "OK", "DEGRADED");
    expect(second.claimed).toBe(false); // No duplicate DEGRADED alert after restart
    expect(second.incidentId).toBeNull();
  });

  it("transitionSystemAlertState: recovery (DEGRADED→OK) after restart correctly claims and returns incidentId", async () => {
    // Scenario: F&O data recovers. The first process that observes recovery claims it.
    // If the process restarts before alerting, a fresh process observes the same recovery
    // and must also be able to claim (the DB row is still DEGRADED) and alert.
    resetSystemAlertDedupTablesReadyForTest();
    mockExecute.mockReset();

    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_dedup
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE system_alert_state
      .mockResolvedValueOnce({ rows: [{ incident_id: "fno_data-1714900000000-abc" }] }); // recovery CAS wins

    const recovery = await transitionSystemAlertState("fno_data", "DEGRADED", "OK");
    expect(recovery.claimed).toBe(true);
    expect(recovery.incidentId).toBe("fno_data-1714900000000-abc"); // same incidentId used for FNO_DATA_RECOVERED alert key
  });

  it("fail-open on DB error ensures the alert still fires (never silently drops)", async () => {
    // DB is temporarily unreachable after restart. Both claimSystemAlert and
    // transitionSystemAlertState must fail-open (return true/claimed=true) so
    // the Telegram alert is still sent rather than silently dropped.
    resetSystemAlertDedupTablesReadyForTest();
    mockExecute.mockRejectedValue(new Error("connection refused after restart"));

    const claimResult = await claimSystemAlert("FNO_DATA_HEALTH::WARMUP_FAILED::NIFTY", 10 * 60 * 1000, "fno_warmup");
    expect(claimResult).toBe(true); // fail-open: prefer duplicate over silent drop

    mockExecute.mockRejectedValue(new Error("connection refused after restart"));
    const transResult = await transitionSystemAlertState("fno_data", "OK", "DEGRADED");
    expect(transResult.claimed).toBe(true); // fail-open
    expect(transResult.incidentId).toBeNull();
  });
});

describe("diagnostics readers", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("getSystemAlertState returns null when no row exists", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const state = await getSystemAlertState("fno_data");
    expect(state).toBeNull();
  });

  it("getSystemAlertState maps a row correctly", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ state: "OK", incident_id: null, transitioned_at: "2026-07-03T00:00:00Z" }],
    });
    const state = await getSystemAlertState("fno_data");
    expect(state).toEqual({ state: "OK", incidentId: null, transitionedAt: "2026-07-03T00:00:00Z" });
  });

  it("listRecentSystemAlertClaims maps rows and fails safe (empty array) on error", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ dedup_key: "K", family: "F", window_ms: "1000", sent_at: "2026-07-03T00:00:00Z" }],
    });
    const rows = await listRecentSystemAlertClaims();
    expect(rows).toEqual([{ dedupKey: "K", family: "F", windowMs: 1000, sentAt: "2026-07-03T00:00:00Z" }]);

    mockExecute.mockRejectedValueOnce(new Error("down"));
    const rowsOnError = await listRecentSystemAlertClaims();
    expect(rowsOnError).toEqual([]);
  });

  it("listSystemAlertStates maps rows and fails safe (empty array) on error", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ family: "fno_data", state: "OK", incident_id: null, transitioned_at: "2026-07-03T00:00:00Z" }],
    });
    const rows = await listSystemAlertStates();
    expect(rows).toEqual([
      { family: "fno_data", state: "OK", incidentId: null, transitionedAt: "2026-07-03T00:00:00Z" },
    ]);

    mockExecute.mockRejectedValueOnce(new Error("down"));
    const rowsOnError = await listSystemAlertStates();
    expect(rowsOnError).toEqual([]);
  });
});
