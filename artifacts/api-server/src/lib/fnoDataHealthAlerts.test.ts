/**
 * Tests for the F&O data-health (warmup-failure) alert helpers (Task #131).
 *
 * These are NEW warmup-failure alerts only — they must never fire on a clean or
 * skipped warmup, and must never alert on a benign missing/expired session
 * (that path is owned elsewhere). alertOwnerRaw is mocked so we assert routing +
 * dedup key + window without touching Telegram.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./alerting", () => ({
  alertOwnerRaw: vi.fn(),
}));

import {
  alertFnoDataHealth,
  alertWarmupFailures,
  FNO_DATA_HEALTH_DEDUP_MS,
} from "./fnoSignalAlerts";
import { alertOwnerRaw } from "./alerting";

const mockAlert = vi.mocked(alertOwnerRaw);

beforeEach(() => {
  mockAlert.mockReset();
});

describe("alertFnoDataHealth", () => {
  it("fires a WARMUP_FAILED alert with a scoped dedup key and 10-min window", () => {
    alertFnoDataHealth({ alertType: "WARMUP_FAILED", index: "NIFTY", code: "EXCHANGE_ERROR" });
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [dedupKey, , text, windowMs] = mockAlert.mock.calls[0]!;
    expect(dedupKey).toBe("FNO_DATA_HEALTH::WARMUP_FAILED::NIFTY");
    expect(windowMs).toBe(FNO_DATA_HEALTH_DEDUP_MS);
    expect(text).toMatch(/WARMUP FAILED/);
    expect(text).toMatch(/NIFTY/);
    expect(text).toMatch(/EXCHANGE_ERROR/);
  });

  it("fires a WARMUP_PARTIAL alert with its own dedup key", () => {
    alertFnoDataHealth({ alertType: "WARMUP_PARTIAL", index: "BANKNIFTY", code: "THROTTLED" });
    const [dedupKey, , text] = mockAlert.mock.calls[0]!;
    expect(dedupKey).toBe("FNO_DATA_HEALTH::WARMUP_PARTIAL::BANKNIFTY");
    expect(text).toMatch(/WARMUP PARTIAL/);
  });

  it("includes a detail line when provided and omits it otherwise", () => {
    alertFnoDataHealth({ alertType: "WARMUP_FAILED", index: "NIFTY", code: "X", detail: "optionChain: boom" });
    expect(mockAlert.mock.calls[0]![2]).toMatch(/Detail: optionChain: boom/);

    mockAlert.mockReset();
    alertFnoDataHealth({ alertType: "WARMUP_FAILED", index: "NIFTY", code: "X" });
    expect(mockAlert.mock.calls[0]![2]).not.toMatch(/Detail:/);
  });

  it("is safe-fail — never throws even if delivery throws", () => {
    mockAlert.mockImplementationOnce(() => {
      throw new Error("telegram down");
    });
    expect(() => alertFnoDataHealth({ alertType: "WARMUP_FAILED", index: "NIFTY" })).not.toThrow();
  });
});

describe("alertWarmupFailures", () => {
  const step = (s: string, ok: boolean, code: string | null = null) => ({ step: s, ok, code, message: null });

  it("does NOT alert on an OK outcome", () => {
    alertWarmupFailures({
      outcome: "OK",
      indices: [{ index: "NIFTY", ok: true, steps: [step("quote", true)] }],
    });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("does NOT alert on any SKIPPED_* outcome", () => {
    alertWarmupFailures({ outcome: "SKIPPED_NO_SESSION", indices: [] });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("does NOT alert when the only failure is a benign missing/expired session", () => {
    alertWarmupFailures({
      outcome: "FAILED",
      indices: [
        { index: "NIFTY", ok: false, steps: [step("quote", false, "SESSION_MISSING")] },
        { index: "BANKNIFTY", ok: false, steps: [step("quote", false, "TOKEN_MISSING")] },
      ],
    });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("fires ONE WARMUP_PARTIAL alert for the single failed index", () => {
    alertWarmupFailures({
      outcome: "PARTIAL",
      indices: [
        { index: "NIFTY", ok: false, steps: [step("intradayBars", false, "THROTTLED")] },
        { index: "BANKNIFTY", ok: true, steps: [step("intradayBars", true)] },
      ],
    });
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0]![0]).toBe("FNO_DATA_HEALTH::WARMUP_PARTIAL::NIFTY");
  });

  it("fires one WARMUP_FAILED alert per failed index on a FAILED outcome", () => {
    alertWarmupFailures({
      outcome: "FAILED",
      indices: [
        { index: "NIFTY", ok: false, steps: [step("optionChain", false, "EXCHANGE_ERROR")] },
        { index: "SENSEX", ok: false, steps: [step("optionChain", false, "EXCHANGE_ERROR")] },
      ],
    });
    expect(mockAlert).toHaveBeenCalledTimes(2);
    const keys = mockAlert.mock.calls.map((c) => c[0]);
    expect(keys).toContain("FNO_DATA_HEALTH::WARMUP_FAILED::NIFTY");
    expect(keys).toContain("FNO_DATA_HEALTH::WARMUP_FAILED::SENSEX");
  });
});

describe("alertWarmupFailures — recovery and dedup (2026-07-02 readiness cleanup)", () => {
  const step = (s: string, ok: boolean, code: string | null = null) => ({ step: s, ok, code, message: null });

  it("RECOVERY: successful warmup after a partial fires NO failure alerts (dedup expires naturally)", () => {
    // Simulate the sequence: SENSEX timeout at boot → recovery warmup all OK.
    alertWarmupFailures({
      outcome: "PARTIAL",
      indices: [
        { index: "NIFTY",     ok: true,  steps: [step("dailyBars", true)] },
        { index: "BANKNIFTY", ok: true,  steps: [step("dailyBars", true)] },
        { index: "SENSEX",    ok: false, steps: [step("dailyBars", false, "UNKNOWN")] },
      ],
    });
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0]![0]).toBe("FNO_DATA_HEALTH::WARMUP_PARTIAL::SENSEX");

    mockAlert.mockReset();

    // Recovery warmup: all OK — must fire NO alerts.
    alertWarmupFailures({
      outcome: "OK",
      indices: [
        { index: "NIFTY",     ok: true, steps: [step("dailyBars", true)] },
        { index: "BANKNIFTY", ok: true, steps: [step("dailyBars", true)] },
        { index: "SENSEX",    ok: true, steps: [step("dailyBars", true)] },
      ],
    });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("dedup: NIFTY/BANKNIFTY success in same run as SENSEX failure → only SENSEX alert fires", () => {
    alertWarmupFailures({
      outcome: "PARTIAL",
      indices: [
        { index: "NIFTY",     ok: true,  steps: [step("dailyBars", true)] },
        { index: "BANKNIFTY", ok: true,  steps: [step("dailyBars", true)] },
        { index: "SENSEX",    ok: false, steps: [step("dailyBars", false, "UNKNOWN")] },
      ],
    });
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [key] = mockAlert.mock.calls[0]!;
    expect(key).toBe("FNO_DATA_HEALTH::WARMUP_PARTIAL::SENSEX");
    // NIFTY and BANKNIFTY must NOT have fired alerts.
    const allKeys = mockAlert.mock.calls.map((c) => c[0]);
    expect(allKeys).not.toContain("FNO_DATA_HEALTH::WARMUP_PARTIAL::NIFTY");
    expect(allKeys).not.toContain("FNO_DATA_HEALTH::WARMUP_PARTIAL::BANKNIFTY");
  });

  it("dedup key is per-index and per-alertType (separate keys for PARTIAL vs FAILED)", () => {
    alertFnoDataHealth({ alertType: "WARMUP_PARTIAL", index: "SENSEX", code: "UNKNOWN" });
    alertFnoDataHealth({ alertType: "WARMUP_FAILED",  index: "SENSEX", code: "UNKNOWN" });
    expect(mockAlert).toHaveBeenCalledTimes(2);
    const keys = mockAlert.mock.calls.map((c) => c[0]);
    expect(keys[0]).toBe("FNO_DATA_HEALTH::WARMUP_PARTIAL::SENSEX");
    expect(keys[1]).toBe("FNO_DATA_HEALTH::WARMUP_FAILED::SENSEX");
  });

  it("dedup window is FNO_DATA_HEALTH_DEDUP_MS (10 min) — not the 30-min signal dedup", () => {
    alertFnoDataHealth({ alertType: "WARMUP_PARTIAL", index: "NIFTY", code: "THROTTLED" });
    const windowMs = mockAlert.mock.calls[0]![3];
    expect(windowMs).toBe(FNO_DATA_HEALTH_DEDUP_MS);
    expect(windowMs).toBe(10 * 60 * 1000);
    expect(windowMs).not.toBe(30 * 60 * 1000); // not the signal dedup window
  });

  it("subsequent identical failure within dedup window passes the same key (upstream dedup suppresses)", () => {
    // alertOwnerRaw is the dedup gatekeeper — we just verify the same key is sent
    // both times so the upstream can correctly suppress the duplicate.
    alertFnoDataHealth({ alertType: "WARMUP_PARTIAL", index: "BANKNIFTY", code: "UNKNOWN" });
    alertFnoDataHealth({ alertType: "WARMUP_PARTIAL", index: "BANKNIFTY", code: "UNKNOWN" });
    expect(mockAlert).toHaveBeenCalledTimes(2);
    expect(mockAlert.mock.calls[0]![0]).toBe("FNO_DATA_HEALTH::WARMUP_PARTIAL::BANKNIFTY");
    expect(mockAlert.mock.calls[1]![0]).toBe("FNO_DATA_HEALTH::WARMUP_PARTIAL::BANKNIFTY");
  });
});
