import { describe, it, expect } from "vitest";
import {
  normalizeSeverity,
  rollUpSeverity,
  verdictSeverity,
  verdictLabel,
  providerLabel,
  formatAgeSec,
  numOrNa,
  pctOrNa,
  rateOrNa,
  formatExpectedMove,
  summarizeReadiness,
} from "./diagnostics-format";

describe("normalizeSeverity", () => {
  it("maps known severities, defaults unknown to unavailable", () => {
    expect(normalizeSeverity("OK")).toBe("ok");
    expect(normalizeSeverity("warn")).toBe("warn");
    expect(normalizeSeverity("FAIL")).toBe("fail");
    expect(normalizeSeverity(null)).toBe("unavailable");
    expect(normalizeSeverity("weird")).toBe("unavailable");
  });
});

describe("rollUpSeverity", () => {
  it("returns worst severity; unavailable for empty", () => {
    expect(rollUpSeverity([])).toBe("unavailable");
    expect(rollUpSeverity(["ok", "warn", "fail"])).toBe("fail");
    expect(rollUpSeverity(["ok", "warn"])).toBe("warn");
    expect(rollUpSeverity(["unavailable", "unavailable"])).toBe("unavailable");
    expect(rollUpSeverity(["ok", "unavailable"])).toBe("ok");
  });
});

describe("verdictSeverity + labels", () => {
  it("only LIVE_KITE is ok; offline is fail", () => {
    expect(verdictSeverity("LIVE_KITE")).toBe("ok");
    expect(verdictSeverity("PARTIAL")).toBe("warn");
    expect(verdictSeverity("KITE_STALE")).toBe("warn");
    expect(verdictSeverity("KITE_OFFLINE")).toBe("fail");
    expect(verdictSeverity("UNAVAILABLE")).toBe("unavailable");
    expect(verdictSeverity(null)).toBe("unavailable");
  });
  it("labels are human; unknown falls back to raw, null to n/a", () => {
    expect(verdictLabel("LIVE_KITE")).toBe("Live (Kite)");
    expect(verdictLabel(null)).toBe("n/a");
    expect(verdictLabel("FOO")).toBe("FOO");
    expect(providerLabel("KITE_WS")).toBe("Kite WebSocket");
    expect(providerLabel("YAHOO")).toBe("Yahoo (non-Kite)");
    expect(providerLabel(null)).toBe("n/a");
  });
});

describe("formatAgeSec", () => {
  it("honest n/a for null/NaN, human buckets otherwise", () => {
    expect(formatAgeSec(null)).toBe("n/a");
    expect(formatAgeSec(Number.NaN)).toBe("n/a");
    expect(formatAgeSec(-5)).toBe("just now");
    expect(formatAgeSec(5)).toBe("5s ago");
    expect(formatAgeSec(120)).toBe("2m ago");
    expect(formatAgeSec(7200)).toBe("2h ago");
  });
});

describe("numOrNa / pctOrNa / rateOrNa never fake zero", () => {
  it("returns n/a for null/NaN rather than 0", () => {
    expect(numOrNa(null)).toBe("n/a");
    expect(numOrNa(Number.NaN)).toBe("n/a");
    expect(pctOrNa(null)).toBe("n/a");
    expect(rateOrNa(null)).toBe("n/a");
    expect(numOrNa(0)).toBe("0"); // a real zero is shown
    expect(pctOrNa(1.5)).toBe("1.50%");
    expect(rateOrNa(0.6)).toBe("60.0%");
  });
});

describe("formatExpectedMove", () => {
  it("available path returns straddle/points/percent + formula", () => {
    const r = formatExpectedMove({
      atmStraddlePremium: 230,
      expectedMovePoints: 230,
      expectedMovePercent: 1,
      formulaLabel: "ATM straddle = CE + PE",
      reason: null,
    });
    expect(r.available).toBe(true);
    expect(r.straddle).toBe("230.00");
    expect(r.percent).toBe("1.00%");
    expect(r.formula).toBe("ATM straddle = CE + PE");
  });
  it("unavailable path surfaces reason and n/a (no fake straddle)", () => {
    const r = formatExpectedMove({
      atmStraddlePremium: null,
      expectedMovePoints: null,
      expectedMovePercent: null,
      formulaLabel: null,
      reason: "UNAVAILABLE",
    });
    expect(r.available).toBe(false);
    expect(r.straddle).toBe("n/a");
    expect(r.reason).toBe("UNAVAILABLE");
  });
  it("null input is handled honestly", () => {
    const r = formatExpectedMove(null);
    expect(r.available).toBe(false);
    expect(r.reason).toBe("UNAVAILABLE");
  });
});

describe("summarizeReadiness", () => {
  it("allowed message when allowed", () => {
    expect(summarizeReadiness({ signalAllowed: true })).toMatch(/allowed/i);
  });
  it("prefers FAIL reasons over warnings", () => {
    const msg = summarizeReadiness({
      signalAllowed: false,
      blockingReasons: [
        { code: "ATM_CE_OI_LOW", severity: "WARN", detail: "thin" },
        { code: "NON_KITE_OPTION_DATA", severity: "FAIL", detail: "not kite" },
      ],
    });
    expect(msg).toContain("not kite");
    expect(msg).not.toContain("thin");
  });
  it("falls back gracefully with no reasons", () => {
    expect(summarizeReadiness({ signalAllowed: false, blockingReasons: [] })).toMatch(/not allowed/i);
  });
});
