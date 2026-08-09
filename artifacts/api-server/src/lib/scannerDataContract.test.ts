/**
 * ADDENDUM_33B Section 1 + Section 7 — Data contract invariant tests.
 *
 * Proves that the three scanner quality dimensions (dataState, evaluationState,
 * actionability) are INDEPENDENT and cannot overwrite each other.
 *
 * Required guarantees:
 *  1. evaluationState=AUTHORIZED requires evaluationAuthorized=true (cannot be true otherwise)
 *  2. actionability=TRADE_GRADE requires BOTH kiteOnline=true AND evaluationAuthorized=true
 *  3. Phase A (evaluationAuthorized=false) always produces NOT_ACTIONABLE regardless of dataState
 *  4. dataState=READY_LIVE does NOT imply evaluationState=AUTHORIZED (Phase A disproves it)
 *  5. Yahoo-offline (kiteOnline=false) always produces INFO_ONLY or NOT_ACTIONABLE, never TRADE_GRADE
 *  6. Phase A + fresh Kite quotes: badge must NOT render "live" (wrong) — must render "delayed"
 *
 * Test count: 35
 */
import { describe, it, expect } from "vitest";
import {
  computeScannerGrade,
  gradeToFeedStatus,
  type DataState,
  type EvaluationState,
  type Actionability,
} from "./scannerDataContract";

// ── Shared test input builders ──────────────────────────────────────────────

const BASE_ONLINE_OPEN: Parameters<typeof computeScannerGrade>[0] = {
  kiteOnline: true,
  evaluationAuthorized: true,
  marketOpen: true,
  cacheAgeMs: 30_000,            // 30s — fresh
  universeSize: 2400,
  rowCount: 2350,
  refreshMs: 60_000,
  maxAgeMs: 24 * 60 * 60 * 1000,
  generationCompletedAt: "2026-08-09T09:00:00.000Z",
};

const BASE_PHASE_A = { ...BASE_ONLINE_OPEN, evaluationAuthorized: false };
const BASE_YAHOO   = { ...BASE_ONLINE_OPEN, kiteOnline: false };
const BASE_CLOSED  = { ...BASE_ONLINE_OPEN, marketOpen: false };

// ── INVARIANT 1: evaluationState=AUTHORIZED only when authorized=true ────────

describe("INVARIANT 1: evaluationState=AUTHORIZED only when evaluationAuthorized=true", () => {
  it("Phase B (authorized=true) + Kite online + market open → AUTHORIZED", () => {
    const g = computeScannerGrade(BASE_ONLINE_OPEN);
    expect(g.evaluationState).toBe("AUTHORIZED");
  });

  it("Phase A (authorized=false) + Kite online + market open → PHASE_A_POPULATION_ONLY", () => {
    const g = computeScannerGrade(BASE_PHASE_A);
    expect(g.evaluationState).toBe("PHASE_A_POPULATION_ONLY");
    expect(g.evaluationState).not.toBe("AUTHORIZED");
  });

  it("Phase A (authorized=false) + market closed → PHASE_A_POPULATION_ONLY", () => {
    const g = computeScannerGrade({ ...BASE_PHASE_A, marketOpen: false });
    expect(g.evaluationState).toBe("PHASE_A_POPULATION_ONLY");
  });

  it("Phase A (authorized=false) + stale cache → PHASE_A_POPULATION_ONLY (not STALE_INPUT)", () => {
    // STALE_INPUT is only for Phase B — Phase A lock takes precedence
    const g = computeScannerGrade({ ...BASE_PHASE_A, cacheAgeMs: 90_000 });
    expect(g.evaluationState).toBe("PHASE_A_POPULATION_ONLY");
    expect(g.evaluationState).not.toBe("STALE_INPUT");
  });

  it("Yahoo offline (evaluationAuthorized=true but kiteOnline=false) → SOURCE_NOT_TRADE_GRADE", () => {
    const g = computeScannerGrade(BASE_YAHOO);
    expect(g.evaluationState).toBe("SOURCE_NOT_TRADE_GRADE");
    expect(g.evaluationState).not.toBe("AUTHORIZED");
  });

  it("Unavailable (no rows) → NOT_EVALUATED", () => {
    const g = computeScannerGrade({ ...BASE_ONLINE_OPEN, rowCount: 0, cacheAgeMs: 0 });
    expect(g.evaluationState).toBe("NOT_EVALUATED");
  });

  it("Stale cache (Phase B) → STALE_INPUT", () => {
    const g = computeScannerGrade({ ...BASE_ONLINE_OPEN, cacheAgeMs: 90_000 });
    expect(g.evaluationState).toBe("STALE_INPUT");
  });
});

// ── INVARIANT 2: actionability=TRADE_GRADE only when kite+authorized ─────────

describe("INVARIANT 2: actionability=TRADE_GRADE requires BOTH kiteOnline AND evaluationAuthorized", () => {
  it("Phase B + Kite + market open → TRADE_GRADE", () => {
    const g = computeScannerGrade(BASE_ONLINE_OPEN);
    expect(g.actionability).toBe("TRADE_GRADE");
  });

  it("Phase A (evaluationAuthorized=false) + Kite → NOT_ACTIONABLE (never TRADE_GRADE)", () => {
    const g = computeScannerGrade(BASE_PHASE_A);
    expect(g.actionability).toBe("NOT_ACTIONABLE");
    expect(g.actionability).not.toBe("TRADE_GRADE");
  });

  it("Yahoo (kiteOnline=false) + authorized → INFO_ONLY (never TRADE_GRADE)", () => {
    const g = computeScannerGrade(BASE_YAHOO);
    expect(g.actionability).toBe("INFO_ONLY");
    expect(g.actionability).not.toBe("TRADE_GRADE");
  });

  it("Phase B + Kite + market closed → TRADE_GRADE (EOD data is trade-grade)", () => {
    // Market closed + Kite EOD data + evaluation authorized = TRADE_GRADE for EOD signals
    const g = computeScannerGrade(BASE_CLOSED);
    expect(g.actionability).toBe("TRADE_GRADE");
  });

  it("Unavailable → NOT_ACTIONABLE", () => {
    const g = computeScannerGrade({ ...BASE_ONLINE_OPEN, rowCount: 0, cacheAgeMs: 0 });
    expect(g.actionability).toBe("NOT_ACTIONABLE");
  });

  it("Error (expired cache) → NOT_ACTIONABLE", () => {
    const g = computeScannerGrade({
      ...BASE_ONLINE_OPEN,
      cacheAgeMs: 25 * 60 * 60 * 1000, // 25 hours — past maxAgeMs
    });
    expect(g.actionability).toBe("NOT_ACTIONABLE");
  });
});

// ── INVARIANT 3: Phase A always → NOT_ACTIONABLE regardless of dataState ────

describe("INVARIANT 3: Phase A always produces NOT_ACTIONABLE", () => {
  const phaseACases: Array<{ label: string; extraInput: Partial<typeof BASE_PHASE_A> }> = [
    { label: "market open + fresh Kite", extraInput: {} },
    { label: "market closed", extraInput: { marketOpen: false } },
    { label: "stale cache (90s)", extraInput: { cacheAgeMs: 90_000 } },
    { label: "partial coverage (30%)", extraInput: { rowCount: 720 } },
    { label: "market open + very fresh (5s)", extraInput: { cacheAgeMs: 5_000 } },
  ];

  for (const { label, extraInput } of phaseACases) {
    it(`Phase A + ${label} → NOT_ACTIONABLE`, () => {
      const g = computeScannerGrade({ ...BASE_PHASE_A, ...extraInput });
      expect(g.actionability).toBe("NOT_ACTIONABLE");
    });
  }

  it("Phase A dataState can be READY_LIVE (data is NOT delayed — evaluation is locked)", () => {
    const g = computeScannerGrade(BASE_PHASE_A); // market open + Kite + fresh
    // dataState is INDEPENDENTLY determined — it CAN be READY_LIVE even in Phase A
    expect(g.dataState).toBe("READY_LIVE");
    // But actionability is NOT_ACTIONABLE
    expect(g.actionability).toBe("NOT_ACTIONABLE");
    // And evaluation is PHASE_A_POPULATION_ONLY
    expect(g.evaluationState).toBe("PHASE_A_POPULATION_ONLY");
    // This proves the three dimensions are independent: READY_LIVE + NOT_ACTIONABLE is valid
  });
});

// ── INVARIANT 4: dataState=READY_LIVE ≠ evaluationState=AUTHORIZED ─────────

describe("INVARIANT 4: dataState=READY_LIVE does NOT imply evaluationState=AUTHORIZED", () => {
  it("Phase A + fresh Kite + market open → READY_LIVE but PHASE_A_POPULATION_ONLY", () => {
    const g = computeScannerGrade(BASE_PHASE_A);
    expect(g.dataState).toBe("READY_LIVE");
    expect(g.evaluationState).toBe("PHASE_A_POPULATION_ONLY");
    // The two dimensions disagree — and that is correct and expected
  });

  it("Phase B + fresh Kite + market open → READY_LIVE AND AUTHORIZED", () => {
    const g = computeScannerGrade(BASE_ONLINE_OPEN);
    expect(g.dataState).toBe("READY_LIVE");
    expect(g.evaluationState).toBe("AUTHORIZED");
  });

  it("Phase A + market closed → READY_CLOSED but PHASE_A_POPULATION_ONLY", () => {
    const g = computeScannerGrade({ ...BASE_PHASE_A, marketOpen: false });
    expect(g.dataState).toBe("READY_CLOSED");
    expect(g.evaluationState).toBe("PHASE_A_POPULATION_ONLY");
  });
});

// ── INVARIANT 5: Yahoo (kiteOnline=false) never TRADE_GRADE ─────────────────

describe("INVARIANT 5: Yahoo fallback (kiteOnline=false) never produces TRADE_GRADE", () => {
  it("Yahoo + authorized=true + market open → INFO_ONLY (not TRADE_GRADE)", () => {
    const g = computeScannerGrade(BASE_YAHOO);
    expect(g.actionability).not.toBe("TRADE_GRADE");
  });

  it("Yahoo + authorized=false → NOT_ACTIONABLE", () => {
    const g = computeScannerGrade({ ...BASE_YAHOO, evaluationAuthorized: false });
    expect(g.actionability).toBe("NOT_ACTIONABLE");
  });

  it("Yahoo dataState is READY_STALE when market is open (data is ~15min delayed)", () => {
    const g = computeScannerGrade({ ...BASE_YAHOO, marketOpen: true });
    // Yahoo intraday data is 15min delayed — labelled READY_STALE, not READY_LIVE
    expect(g.dataState).toBe("READY_STALE");
  });
});

// ── SECTION 7: gradeToFeedStatus — badge cannot show "live" in Phase A ──────

describe("SECTION 7: gradeToFeedStatus — badge shows correct status string", () => {
  it("Phase B + Kite + market open → 'live'", () => {
    const g = computeScannerGrade(BASE_ONLINE_OPEN);
    expect(gradeToFeedStatus(g)).toBe("live");
  });

  it("Phase A + fresh Kite → NOT 'live' (evaluation locked)", () => {
    const g = computeScannerGrade(BASE_PHASE_A);
    // SECTION 7 CORE: Phase A with fresh Kite data must NOT render "live"
    expect(gradeToFeedStatus(g)).not.toBe("live");
    expect(gradeToFeedStatus(g)).toBe("delayed");
  });

  it("Phase B + Kite + market closed → 'delayed' (EOD, not intraday)", () => {
    const g = computeScannerGrade(BASE_CLOSED);
    // Market is closed, so READY_CLOSED → "delayed" even in Phase B
    expect(gradeToFeedStatus(g)).toBe("delayed");
  });

  it("Yahoo fallback → 'delayed' (info-only, data is stale)", () => {
    const g = computeScannerGrade(BASE_YAHOO);
    expect(gradeToFeedStatus(g)).toBe("delayed");
  });

  it("No cache (UNAVAILABLE) → 'stale'", () => {
    const g = computeScannerGrade({ ...BASE_ONLINE_OPEN, rowCount: 0, cacheAgeMs: 0 });
    expect(gradeToFeedStatus(g)).toBe("stale");
  });

  it("Hard-stale cache (past maxAgeMs) → 'down'", () => {
    const g = computeScannerGrade({
      ...BASE_ONLINE_OPEN,
      cacheAgeMs: 25 * 60 * 60 * 1000,
    });
    expect(gradeToFeedStatus(g)).toBe("down");
  });

  it("Partial coverage → 'delayed'", () => {
    const g = computeScannerGrade({ ...BASE_ONLINE_OPEN, rowCount: 500 }); // < 50% of 2400
    expect(gradeToFeedStatus(g)).toBe("delayed");
  });

  // ── CRITICAL: KITE TRADE-GRADE cannot appear when evaluationAuthorized=false ──
  it("KITE TRADE-GRADE impossible in Phase A: fallbackUsed must be true when NOT_ACTIONABLE", () => {
    // This simulates the scanner.tsx UnifiedGradeChip logic:
    //   fallbackUsed = actionability !== "TRADE_GRADE"
    const phaseAGrade = computeScannerGrade(BASE_PHASE_A);
    const fallbackUsed = phaseAGrade.actionability !== "TRADE_GRADE";
    // fallbackUsed=true blocks KITE TRADE-GRADE rendering in UnifiedGradeChip
    expect(fallbackUsed).toBe(true);
  });

  it("KITE TRADE-GRADE is possible only in Phase B with Kite online", () => {
    const phaseBGrade = computeScannerGrade(BASE_ONLINE_OPEN);
    const fallbackUsed = phaseBGrade.actionability !== "TRADE_GRADE";
    // fallbackUsed=false allows KITE TRADE-GRADE rendering
    expect(fallbackUsed).toBe(false);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("cacheAgeMs=null (no cache at all) → UNAVAILABLE", () => {
    const g = computeScannerGrade({ ...BASE_ONLINE_OPEN, cacheAgeMs: null, rowCount: 0 });
    expect(g.dataState).toBe("UNAVAILABLE");
    expect(g.actionability).toBe("NOT_ACTIONABLE");
  });

  it("Partial coverage (45% rows) → READY_PARTIAL, but TRADE_GRADE for covered rows", () => {
    // READY_PARTIAL means <50% universe coverage, but the rows that DID land are from Kite
    // with evaluation authorized. Those rows ARE trade-grade.
    // The partial coverage affects breadth/universe completeness, not per-row quality.
    // actionability=TRADE_GRADE means the rows present can drive signals — not that all rows exist.
    const g = computeScannerGrade({ ...BASE_ONLINE_OPEN, rowCount: 1080 }); // 45% of 2400
    expect(g.dataState).toBe("READY_PARTIAL");
    expect(g.actionability).toBe("TRADE_GRADE"); // covered rows are trade-grade
  });

  it("Grade rationale includes all three dimension labels", () => {
    const g = computeScannerGrade(BASE_ONLINE_OPEN);
    expect(g.rationale).toContain("READY_LIVE");
    expect(g.rationale).toContain("AUTHORIZED");
    expect(g.rationale).toContain("TRADE_GRADE");
  });

  it("Phase A rationale mentions evaluation authorization", () => {
    const g = computeScannerGrade(BASE_PHASE_A);
    expect(g.rationale).toContain("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=false");
  });
});
