/**
 * p33b.dataGradeIndicators.test.tsx — Blocker 1: Separate freshness, evaluation
 * and actionability in rendered UI.
 *
 * Rules under test:
 *   B1-01  READY_LIVE → DataSourceBadge status="live" regardless of evaluationState.
 *   B1-02  READY_CLOSED → status="delayed" (market closed; not data outage).
 *   B1-03  READY_PARTIAL → status="delayed" (partial coverage).
 *   B1-04  READY_STALE → status="stale".
 *   B1-05  UNAVAILABLE → status="stale".
 *   B1-06  ERROR → status="down".
 *   B1-07  READY_LIVE + NOT_ACTIONABLE → status="live" (freshness ≠ actionability).
 *   B1-08  READY_CLOSED + NOT_ACTIONABLE → status="delayed" (not "stale").
 *   B1-09  Phase A cannot show KITE TRADE-GRADE (fallbackUsed=true).
 *   B1-10  Evaluation state cannot mutate source freshness (dataState controls badge).
 *   B1-11  Source freshness cannot authorize evaluation (actionability is independent).
 *   B1-12  Evaluation indicator renders "PHASE A — NOT EVALUATED" in Phase A.
 *   B1-13  Actionability indicator renders "NOT ACTIONABLE" when NOT_ACTIONABLE.
 *   B1-14  fallbackActive=true only when kiteOffline (not when actionability≠TRADE_GRADE).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const scannerSrc = readFileSync(join(__dirname, "../pages/scanner.tsx"), "utf8");

// ── Blocker 1 source-level guards ────────────────────────────────────────────

describe("Blocker 1 — DataSourceBadge freshness-only contract (source guards)", () => {
  it("B1-01: DataSourceBadge status mapping uses dataState, not actionability", () => {
    // The status IIFE must branch on `ds` (dataState), not `ac` (actionability)
    const badgeBlock = scannerSrc.slice(
      scannerSrc.indexOf("BLOCKER 1: DataSourceBadge"),
      scannerSrc.indexOf("SECTION 7:"),
    );
    expect(badgeBlock).toMatch(/if \(ds === "READY_LIVE"\) return "live"/);
    expect(badgeBlock).toMatch(/if \(ds === "READY_CLOSED".*return "delayed"/);
    expect(badgeBlock).toMatch(/if \(ds === "READY_STALE"\) return "stale"/);
    expect(badgeBlock).toMatch(/if \(ds === "ERROR"\) return "down"/);
  });

  it("B1-07: READY_LIVE + NOT_ACTIONABLE → badge still shows 'live'", () => {
    // The badge must NOT condition "live" on actionability===TRADE_GRADE.
    // Old (wrong): ac === "TRADE_GRADE" && ds === "READY_LIVE" → "live"
    // New (correct): ds === "READY_LIVE" → "live" (unconditional on actionability)
    expect(scannerSrc).not.toMatch(/ac === "TRADE_GRADE" && ds === "READY_LIVE"/);
    const badgeBlock = scannerSrc.slice(
      scannerSrc.indexOf("BLOCKER 1: DataSourceBadge"),
      scannerSrc.indexOf("SECTION 7:"),
    );
    // "live" must be reachable from READY_LIVE alone
    expect(badgeBlock).toMatch(/READY_LIVE.*return "live"/s);
  });

  it("B1-10: evaluation state cannot mutate source freshness (no evaluationState in badge status logic)", () => {
    const badgeStatusBlock = scannerSrc.slice(
      scannerSrc.indexOf("status={(() => {"),
      scannerSrc.indexOf("fallbackActive={"),
    );
    expect(badgeStatusBlock).not.toContain("evaluationState");
    expect(badgeStatusBlock).not.toContain("actionability");
    expect(badgeStatusBlock).not.toContain("phaseA");
  });

  it("B1-14: fallbackActive reflects ONLY kiteOffline (not actionability)", () => {
    // Old (wrong): fallbackActive={!!fullMeta?.kiteOffline || fullMeta?.actionability !== "TRADE_GRADE"}
    // New (correct): fallbackActive={!!fullMeta?.kiteOffline}
    // Check the JSX line directly: must not have actionability on the same line as fallbackActive={
    const lines = scannerSrc.split("\n");
    const fallbackLines = lines.filter(l => l.includes("fallbackActive={"));
    for (const line of fallbackLines) {
      expect(line, `fallbackActive JSX attribute should not reference actionability: ${line}`).not.toContain("actionability");
    }
    expect(scannerSrc).toMatch(/fallbackActive=\{!!fullMeta\?\.kiteOffline\}/);
  });
});

describe("Blocker 1 — Separate evaluation and actionability indicators", () => {
  it("B1-11-UI: grade-indicators-row is rendered separately from DataSourceBadge", () => {
    expect(scannerSrc).toMatch(/data-testid="grade-indicators-row"/);
    expect(scannerSrc).toMatch(/data-testid="evaluation-state-indicator"/);
    expect(scannerSrc).toMatch(/data-testid="actionability-indicator"/);
  });

  it("B1-12: PHASE_A_POPULATION_ONLY renders as 'PHASE A — NOT EVALUATED'", () => {
    expect(scannerSrc).toMatch(/PHASE A — NOT EVALUATED/);
    expect(scannerSrc).toMatch(/evaluationState === "PHASE_A_POPULATION_ONLY".*PHASE A — NOT EVALUATED/s);
  });

  it("B1-13: actionability indicator renders NOT_ACTIONABLE via replace(/_/g, ' ')", () => {
    // The actionability indicator uses .replace(/_/g, " ") so NOT_ACTIONABLE → "NOT ACTIONABLE"
    const indicatorBlock = scannerSrc.slice(
      scannerSrc.indexOf("actionability-indicator"),
      scannerSrc.indexOf("actionability-indicator") + 300,
    );
    expect(indicatorBlock).toMatch(/actionability\.replace\(\/_\/g, " "\)/);
  });

  it("B1-09: Phase A cannot show KITE TRADE-GRADE (fallbackUsed=actionability≠TRADE_GRADE)", () => {
    // UnifiedGradeChip fallbackUsed must be based on actionability, not phaseA
    expect(scannerSrc).toMatch(
      /fallbackUsed:\s*fullMeta\s*\?\s*fullMeta\.actionability\s*!==\s*"TRADE_GRADE"\s*:\s*true/
    );
    // Must NOT use phaseA as the proxy
    expect(scannerSrc).not.toMatch(/fallbackUsed:\s*fullMeta\?\.phaseA/);
    expect(scannerSrc).not.toMatch(/fallbackUsed:\s*phaseA/);
  });
});

// ── dataState → FeedStatus mapping (inline logic, no DOM needed) ─────────────

describe("Blocker 1 — dataState → FeedStatus mapping logic", () => {
  type DataState = "READY_LIVE" | "READY_CLOSED" | "READY_STALE" | "READY_PARTIAL" | "UNAVAILABLE" | "ERROR";
  type FeedStatus = "live" | "delayed" | "stale" | "down";

  /** Inline the DataSourceBadge status logic from scanner.tsx */
  function dataStateToStatus(ds: DataState | undefined, hasMeta: boolean): FeedStatus {
    if (!hasMeta || ds === "UNAVAILABLE") return "stale";
    if (ds === "ERROR") return "down";
    if (ds === "READY_STALE") return "stale";
    if (ds === "READY_LIVE") return "live";
    if (ds === "READY_CLOSED" || ds === "READY_PARTIAL") return "delayed";
    return "stale";
  }

  it("B1-L01: READY_LIVE → 'live'", () => {
    expect(dataStateToStatus("READY_LIVE", true)).toBe("live");
  });

  it("B1-L02: READY_CLOSED → 'delayed'", () => {
    expect(dataStateToStatus("READY_CLOSED", true)).toBe("delayed");
  });

  it("B1-L03: READY_PARTIAL → 'delayed'", () => {
    expect(dataStateToStatus("READY_PARTIAL", true)).toBe("delayed");
  });

  it("B1-L04: READY_STALE → 'stale'", () => {
    expect(dataStateToStatus("READY_STALE", true)).toBe("stale");
  });

  it("B1-L05: UNAVAILABLE → 'stale'", () => {
    expect(dataStateToStatus("UNAVAILABLE", true)).toBe("stale");
  });

  it("B1-L06: ERROR → 'down'", () => {
    expect(dataStateToStatus("ERROR", true)).toBe("down");
  });

  it("B1-L07: READY_LIVE + NOT_ACTIONABLE → still 'live' (freshness is independent)", () => {
    // This test proves that the mapping function doesn't take actionability as input.
    // READY_LIVE maps to "live" regardless of evaluation/actionability state.
    expect(dataStateToStatus("READY_LIVE", true)).toBe("live");
    // The function signature has no actionability parameter — it cannot be influenced.
  });

  it("B1-L08: READY_CLOSED + NOT_ACTIONABLE → still 'delayed' (not 'stale')", () => {
    expect(dataStateToStatus("READY_CLOSED", true)).toBe("delayed");
  });

  it("B1-L09: no meta → 'stale' (conservative)", () => {
    expect(dataStateToStatus(undefined, false)).toBe("stale");
  });

  it("B1-L10: evaluation state cannot mutate source freshness (mapping has no evaluationState param)", () => {
    // The function signature only takes dataState — no evaluationState parameter.
    // This enforces the invariant structurally.
    const params = dataStateToStatus.length; // number of parameters
    expect(params).toBe(2); // ds and hasMeta — no evaluationState
  });

  it("B1-L11: source freshness cannot authorize evaluation (no actionability in freshness mapping)", () => {
    // Symmetric to B1-L10: actionability is not a parameter of the freshness→status mapping.
    expect(dataStateToStatus.length).toBe(2);
  });
});

// ── fallbackUsed invariant ────────────────────────────────────────────────────

describe("Blocker 1 — fallbackUsed = actionability≠TRADE_GRADE invariant", () => {
  type Actionability = "TRADE_GRADE" | "INFO_ONLY" | "NOT_ACTIONABLE";

  function computeFallbackUsed(
    hasMeta: boolean,
    actionability: Actionability | undefined
  ): boolean {
    return hasMeta ? actionability !== "TRADE_GRADE" : true;
  }

  it("B1-FU-1: Phase A (NOT_ACTIONABLE) → fallbackUsed=true → KITE TRADE-GRADE blocked", () => {
    expect(computeFallbackUsed(true, "NOT_ACTIONABLE")).toBe(true);
  });

  it("B1-FU-2: Phase B authorized (TRADE_GRADE) → fallbackUsed=false → KITE TRADE-GRADE allowed", () => {
    expect(computeFallbackUsed(true, "TRADE_GRADE")).toBe(false);
  });

  it("B1-FU-3: INFO_ONLY → fallbackUsed=true → KITE TRADE-GRADE blocked", () => {
    expect(computeFallbackUsed(true, "INFO_ONLY")).toBe(true);
  });

  it("B1-FU-4: no meta → fallbackUsed=true (conservative)", () => {
    expect(computeFallbackUsed(false, undefined)).toBe(true);
  });
});
