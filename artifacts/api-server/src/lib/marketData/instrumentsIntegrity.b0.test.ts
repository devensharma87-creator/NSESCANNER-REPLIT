/**
 * B0 instruments integrity tests — recovery path.
 *
 * Tests markInstrumentsRefreshRecovered() behaviour: alert priority, idempotency,
 * and state clearing. All DB/appState calls are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub all external dependencies before importing
vi.mock("../kiteAuth", () => ({
  forceRefreshInstruments: vi.fn(),
  exportInstrumentsCache: vi.fn().mockReturnValue(null),
  getActiveSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("../appStateStore", () => ({
  getAppState: vi.fn().mockResolvedValue(null),
  setAppState: vi.fn().mockResolvedValue(undefined),
  setAppStateIfAbsent: vi.fn().mockResolvedValue(undefined),
  deleteAppState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../alerting", () => ({
  alertOwner: vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  markInstrumentsRefreshRecovered,
  getInstrumentsIntegrityStatus,
  isInstrumentsRefreshFailedToday,
  hydrateInstrumentsFailureFlag,
} from "./instrumentsIntegrity";
import { alertOwner } from "../alerting";
import { deleteAppState } from "../appStateStore";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── markInstrumentsRefreshRecovered ──────────────────────────────────────────

describe("markInstrumentsRefreshRecovered", () => {
  it("is a no-op when there is no prior failure for the date", async () => {
    // No failure for today — failedDateCache is null by default
    await markInstrumentsRefreshRecovered("2026-07-31");
    expect(vi.mocked(alertOwner)).not.toHaveBeenCalled();
    expect(vi.mocked(deleteAppState)).not.toHaveBeenCalled();
  });

  it("emits exactly one INSTRUMENTS_REFRESH_RECOVERED alert after a failure", async () => {
    // Simulate a failure by hydrating the flag from DB
    vi.mocked(await import("../appStateStore")).getAppState.mockResolvedValueOnce("failed_no_session");
    await hydrateInstrumentsFailureFlag(new Date("2026-07-31T03:30:00Z")); // 09:00 IST

    await markInstrumentsRefreshRecovered("2026-07-31");

    const calls = vi.mocked(alertOwner).mock.calls.filter(
      ([ev]) => ev === "INSTRUMENTS_REFRESH_RECOVERED",
    );
    expect(calls).toHaveLength(1);
  });

  it("recovery alert is emitted at INFO priority", async () => {
    vi.mocked(await import("../appStateStore")).getAppState.mockResolvedValueOnce("failed_no_session");
    await hydrateInstrumentsFailureFlag(new Date("2026-07-31T03:30:00Z"));

    await markInstrumentsRefreshRecovered("2026-07-31");

    const calls = vi.mocked(alertOwner).mock.calls.filter(
      ([ev]) => ev === "INSTRUMENTS_REFRESH_RECOVERED",
    );
    expect(calls).toHaveLength(1);
    const priority = calls[0]?.[5]; // 6th positional argument
    expect(priority).toBe("INFO");
  });

  it("clears the in-memory failure state after recovery", async () => {
    vi.mocked(await import("../appStateStore")).getAppState.mockResolvedValueOnce("failed_no_session");
    await hydrateInstrumentsFailureFlag(new Date("2026-07-31T03:30:00Z"));

    // Before recovery: failed
    const before = isInstrumentsRefreshFailedToday(new Date("2026-07-31T03:30:00Z"));
    expect(before).toBe(true);

    await markInstrumentsRefreshRecovered("2026-07-31");

    // After recovery: not failed
    const after = isInstrumentsRefreshFailedToday(new Date("2026-07-31T03:30:00Z"));
    expect(after).toBe(false);
  });

  it("deletes the DB failure flag to prevent re-hydration on restart", async () => {
    vi.mocked(await import("../appStateStore")).getAppState.mockResolvedValueOnce("failed_no_session");
    await hydrateInstrumentsFailureFlag(new Date("2026-07-31T03:30:00Z"));

    await markInstrumentsRefreshRecovered("2026-07-31");

    expect(vi.mocked(deleteAppState)).toHaveBeenCalledWith(
      expect.stringContaining("instruments_refresh_failed_"),
    );
  });

  it("idempotent — second call is a no-op (already recovered)", async () => {
    vi.mocked(await import("../appStateStore")).getAppState.mockResolvedValueOnce("failed_no_session");
    await hydrateInstrumentsFailureFlag(new Date("2026-07-31T03:30:00Z"));

    await markInstrumentsRefreshRecovered("2026-07-31"); // first call → emits
    vi.clearAllMocks(); // reset to count subsequent calls
    await markInstrumentsRefreshRecovered("2026-07-31"); // second call → no-op

    expect(vi.mocked(alertOwner)).not.toHaveBeenCalled();
    expect(vi.mocked(deleteAppState)).not.toHaveBeenCalled();
  });

  it("status is updated to OK after recovery", async () => {
    vi.mocked(await import("../appStateStore")).getAppState.mockResolvedValueOnce("failed_no_session");
    await hydrateInstrumentsFailureFlag(new Date("2026-07-31T03:30:00Z"));

    await markInstrumentsRefreshRecovered("2026-07-31");

    const s = getInstrumentsIntegrityStatus();
    expect(s.lastResult).toBe("OK");
    expect(s.failedToday).toBe(false);
  });
});
