/**
 * FNO_DATA_RECOVERED CAS transition tests
 * (docs/telegram-alert-quality-audit-2026-07-03.md, T003).
 *
 * Verifies handleFnoDataSuppressionTransition drives the DB-backed CAS
 * state machine correctly and fires the recovery alert exactly once per
 * genuine degrade->recover incident — never zero, never duplicated, and a
 * second real flap on the same day is treated as a NEW incident (distinct
 * dedup key), not silently swallowed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const transitionSystemAlertState = vi.fn();
const alertOwner = vi.fn();

vi.mock("./systemAlertDedup", () => ({
  transitionSystemAlertState: (...args: unknown[]) => transitionSystemAlertState(...args),
}));
vi.mock("./alerting", () => ({
  alertOwner: (...args: unknown[]) => alertOwner(...args),
}));

import { handleFnoDataSuppressionTransition } from "./fnoDataRecoveryTransition";

describe("handleFnoDataSuppressionTransition", () => {
  beforeEach(() => {
    transitionSystemAlertState.mockReset();
    alertOwner.mockReset();
  });

  it("suppressed cycle: attempts OK->DEGRADED transition, never alerts", async () => {
    transitionSystemAlertState.mockResolvedValueOnce({ claimed: true, incidentId: "fno_data-1" });

    await handleFnoDataSuppressionTransition(true, ["NIFTY", "BANKNIFTY"]);

    expect(transitionSystemAlertState).toHaveBeenCalledTimes(1);
    expect(transitionSystemAlertState).toHaveBeenCalledWith("fno_data", "OK", "DEGRADED");
    expect(alertOwner).not.toHaveBeenCalled();
  });

  it("recovery: DEGRADED->OK claimed=true fires exactly one FNO_DATA_RECOVERED alert keyed by incidentId", async () => {
    transitionSystemAlertState.mockResolvedValueOnce({ claimed: true, incidentId: "fno_data-abc123" });

    await handleFnoDataSuppressionTransition(false, ["NIFTY", "BANKNIFTY", "SENSEX"]);

    expect(transitionSystemAlertState).toHaveBeenCalledWith("fno_data", "DEGRADED", "OK");
    expect(alertOwner).toHaveBeenCalledTimes(1);
    const [event, message, metadata, dedupWindowMs, dedupKey] = alertOwner.mock.calls[0]!;
    expect(event).toBe("FNO_DATA_RECOVERED");
    expect(message).toContain("restored");
    expect(message).toContain("NIFTY, BANKNIFTY, SENSEX");
    expect((metadata as { affectedIndices: string[] }).affectedIndices).toEqual([
      "NIFTY",
      "BANKNIFTY",
      "SENSEX",
    ]);
    expect(dedupWindowMs).toBe(0);
    expect(dedupKey).toBe("FNO_DATA_RECOVERED::fno_data-abc123");
  });

  it("recovery: claimed=false (another replica already won, or already OK) never alerts", async () => {
    transitionSystemAlertState.mockResolvedValueOnce({ claimed: false, incidentId: null });

    await handleFnoDataSuppressionTransition(false, ["NIFTY"]);

    expect(alertOwner).not.toHaveBeenCalled();
  });

  it("two distinct degrade->recover flaps on the same day produce two distinct incident alerts, not zero/duplicate", async () => {
    // Flap 1: degrade then recover.
    transitionSystemAlertState.mockResolvedValueOnce({ claimed: true, incidentId: "fno_data-incident-1" });
    await handleFnoDataSuppressionTransition(true, ["NIFTY"]);
    transitionSystemAlertState.mockResolvedValueOnce({ claimed: true, incidentId: "fno_data-incident-1" });
    await handleFnoDataSuppressionTransition(false, ["NIFTY"]);

    // Flap 2 (same day): a fresh degrade mints a NEW incidentId, recover fires again.
    transitionSystemAlertState.mockResolvedValueOnce({ claimed: true, incidentId: "fno_data-incident-2" });
    await handleFnoDataSuppressionTransition(true, ["NIFTY"]);
    transitionSystemAlertState.mockResolvedValueOnce({ claimed: true, incidentId: "fno_data-incident-2" });
    await handleFnoDataSuppressionTransition(false, ["NIFTY"]);

    expect(alertOwner).toHaveBeenCalledTimes(2);
    const key1 = alertOwner.mock.calls[0]![4];
    const key2 = alertOwner.mock.calls[1]![4];
    expect(key1).toBe("FNO_DATA_RECOVERED::fno_data-incident-1");
    expect(key2).toBe("FNO_DATA_RECOVERED::fno_data-incident-2");
    expect(key1).not.toBe(key2);
  });

  it("fail-open transition (incidentId null) still alerts, using a synthetic fallback dedup key", async () => {
    transitionSystemAlertState.mockResolvedValueOnce({ claimed: true, incidentId: null });

    await handleFnoDataSuppressionTransition(false, ["NIFTY"]);

    expect(alertOwner).toHaveBeenCalledTimes(1);
    const dedupKey = alertOwner.mock.calls[0]![4];
    expect(dedupKey).toBe("FNO_DATA_RECOVERED::unknown-incident");
  });

  it("suppressed-branch DB rejection is swallowed (caught), never throws or alerts", async () => {
    transitionSystemAlertState.mockRejectedValueOnce(new Error("db down"));

    await expect(handleFnoDataSuppressionTransition(true, ["NIFTY"])).resolves.toBeUndefined();
    expect(alertOwner).not.toHaveBeenCalled();
  });

  it("recovery-branch DB rejection is swallowed (caught) and does not alert", async () => {
    transitionSystemAlertState.mockRejectedValueOnce(new Error("db down"));

    await expect(handleFnoDataSuppressionTransition(false, ["NIFTY"])).resolves.toBeUndefined();
    expect(alertOwner).not.toHaveBeenCalled();
  });
});
