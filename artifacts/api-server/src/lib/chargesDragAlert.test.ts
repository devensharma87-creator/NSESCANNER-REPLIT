/**
 * Charges-drag alert — pure math contract tests.
 *
 * Locks the invariants ops care about: alert only fires when today
 * meaningfully exceeds baseline; refuses to alert with insufficient
 * history; handles null / zero-gross gracefully; renders a useful
 * Telegram message on breach.
 */
import { describe, it, expect } from "vitest";
import {
  computeDragPct,
  evaluateDragAlert,
  renderDragAlertMessage,
  type DragObservation,
} from "./chargesDragAlert";

const D = (istDate: string, grossPnl: number, chargesTotal: number): DragObservation => ({
  istDate,
  grossPnl,
  chargesTotal,
});

describe("computeDragPct", () => {
  it("positive gross → positive %", () => {
    expect(computeDragPct(D("2026-07-15", 1000, 50))).toBeCloseTo(5, 2);
  });
  it("negative gross uses absolute value", () => {
    expect(computeDragPct(D("2026-07-15", -1000, 50))).toBeCloseTo(5, 2);
  });
  it("zero gross → null (undefined ratio)", () => {
    expect(computeDragPct(D("2026-07-15", 0, 40))).toBeNull();
  });
});

describe("evaluateDragAlert", () => {
  const stableHistory: DragObservation[] = [
    D("2026-07-04", 1000, 50),  // 5.00%
    D("2026-07-05", 1200, 62),  // 5.17%
    D("2026-07-08", 800, 42),   // 5.25%
    D("2026-07-09", 1500, 78),  // 5.20%
    D("2026-07-10", 900, 46),   // 5.11%
    D("2026-07-11", 1100, 55),  // 5.00%
    D("2026-07-14", 950, 48),   // 5.05%
  ];

  it("today within baseline → OK", () => {
    const r = evaluateDragAlert(D("2026-07-15", 1000, 51), stableHistory);
    expect(r.breach).toBe(false);
    expect(r.reason).toBe("OK");
    expect(r.todayDragPct).toBeCloseTo(5.1, 1);
    expect(r.medianPct).toBeCloseTo(5.11, 2);
    expect(r.sigmaPct).toBeGreaterThan(0);
  });

  it("today far above threshold → BREACH", () => {
    const r = evaluateDragAlert(D("2026-07-15", 1000, 180), stableHistory);
    // Today drag = 18% — clearly > 5% median + 2σ (σ ~ 0.09%)
    expect(r.breach).toBe(true);
    expect(r.reason).toBe("BREACH");
    expect(r.todayDragPct).toBeCloseTo(18, 1);
    expect(r.thresholdPct).toBeLessThan(r.todayDragPct ?? 0);
  });

  it("too few samples → skip alert, reason=TOO_FEW_SAMPLES", () => {
    const r = evaluateDragAlert(
      D("2026-07-15", 1000, 500),
      stableHistory.slice(0, 3), // only 3 samples
    );
    expect(r.breach).toBe(false);
    expect(r.reason).toBe("TOO_FEW_SAMPLES");
  });

  it("zero-gross today → skip alert, reason=TODAY_NULL", () => {
    const r = evaluateDragAlert(D("2026-07-15", 0, 40), stableHistory);
    expect(r.breach).toBe(false);
    expect(r.reason).toBe("TODAY_NULL");
    expect(r.todayDragPct).toBeNull();
  });

  it("perfectly stable history (σ=0) → skip alert, reason=SIGMA_ZERO", () => {
    const flat: DragObservation[] = Array.from({ length: 7 }, (_, i) => ({
      istDate: `2026-07-${String(i + 1).padStart(2, "0")}`,
      grossPnl: 1000,
      chargesTotal: 50, // exactly 5% every day
    }));
    const r = evaluateDragAlert(D("2026-07-15", 1000, 500), flat);
    // History drag is 5.00% flat → σ=0 → algorithm can't form threshold
    expect(r.reason).toBe("SIGMA_ZERO");
    expect(r.breach).toBe(false);
  });

  it("history entries with null drag are ignored, but the rest still form threshold", () => {
    const historyWithHoles: DragObservation[] = [
      D("2026-07-04", 1000, 50),  // 5.00
      D("2026-07-05", 0, 30),     // NULL — ignored
      D("2026-07-08", 800, 42),   // 5.25
      D("2026-07-09", 0, 20),     // NULL — ignored
      D("2026-07-10", 900, 46),   // 5.11
      D("2026-07-11", 1100, 55),  // 5.00
      D("2026-07-14", 950, 48),   // 5.05
    ];
    const r = evaluateDragAlert(D("2026-07-15", 1000, 51), historyWithHoles);
    // 5 valid history samples ≥ minSamples default (5) → alert can fire.
    // Today drag = 5.1% ≈ median → within threshold.
    expect(r.reason).toBe("OK");
    expect(r.medianPct).toBeCloseTo(5.05, 1);
  });
});

describe("renderDragAlertMessage", () => {
  it("empty string on non-breach", () => {
    const msg = renderDragAlertMessage(D("2026-07-15", 1000, 50), {
      todayDragPct: 5,
      medianPct: 5,
      sigmaPct: 0.1,
      thresholdPct: 5.2,
      breach: false,
      reason: "OK",
    });
    expect(msg).toBe("");
  });

  it("breach message contains gross + drag + threshold + causes", () => {
    const msg = renderDragAlertMessage(D("2026-07-15", 1000, 180), {
      todayDragPct: 18,
      medianPct: 5.1,
      sigmaPct: 0.09,
      thresholdPct: 5.28,
      breach: true,
      reason: "BREACH",
    });
    expect(msg).toContain("Charges-drag anomaly");
    expect(msg).toContain("2026-07-15");
    expect(msg).toContain("18.00%");
    expect(msg).toContain("5.10%");
    expect(msg).toContain("Likely causes");
  });
});
