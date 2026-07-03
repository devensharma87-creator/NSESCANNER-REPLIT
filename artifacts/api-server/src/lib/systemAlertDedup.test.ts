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
