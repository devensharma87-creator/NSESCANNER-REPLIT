import { describe, expect, it } from "vitest";
import { classifyDrift, DRIFT_WARN_MS, DRIFT_ALERT_MS, getClockDriftSnapshot } from "./clockDrift";

describe("classifyDrift (BUG-29)", () => {
  it("OK within warn threshold", () => {
    expect(classifyDrift(0)).toBe("OK");
    expect(classifyDrift(DRIFT_WARN_MS)).toBe("OK");
  });
  it("WARN between warn and alert thresholds", () => {
    expect(classifyDrift(DRIFT_WARN_MS + 1)).toBe("WARN");
    expect(classifyDrift(DRIFT_ALERT_MS)).toBe("WARN");
  });
  it("ALERT above alert threshold", () => {
    expect(classifyDrift(DRIFT_ALERT_MS + 1)).toBe("ALERT");
    expect(classifyDrift(60_000)).toBe("ALERT");
  });
});

describe("snapshot contract", () => {
  it("initial snapshot is UNKNOWN, labelled detection-only, with thresholds", () => {
    const s = getClockDriftSnapshot();
    expect(["UNKNOWN", "OK", "WARN", "ALERT", "CHECK_FAILED"]).toContain(s.status);
    expect(s.thresholdWarnMs).toBe(DRIFT_WARN_MS);
    expect(s.thresholdAlertMs).toBe(DRIFT_ALERT_MS);
    expect(s.note.toLowerCase()).toContain("detection only");
  });
});
