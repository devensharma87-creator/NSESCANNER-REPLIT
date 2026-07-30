import { describe, expect, it, vi } from "vitest";
import {
  decidePremiumHardStop,
  simulateProtectionRule,
  type SimTradeInput,
} from "./fnoPremiumExitOverlay";

// Prevent pg.Pool creation: ./fnoPremiumExitOverlay imports @workspace/db
// transitively for the sweep functions. The pure decision + simulation
// functions used by these tests require no live DB — the mock prevents
// Pool construction without affecting the exported pure functions.
vi.mock("@workspace/db", () => ({}));

/**
 * F&O Premium Exit Overlay — pure decision and simulation tests.
 * No live DB required. DB sweep tests live in fnoPremiumExitOverlay.db.test.ts.
 */

function skipReasonOf(
  d: ReturnType<typeof decidePremiumHardStop>,
): string | undefined {
  return d.action === "SKIP" ? d.skipReason : undefined;
}

const NOW_MS = Date.UTC(2099, 11, 30, 6, 0, 0); // fixed clock for determinism

// ─────────────────────────────────────────────────────────────────────────
// Pure decision — decidePremiumHardStop
// ─────────────────────────────────────────────────────────────────────────

describe("decidePremiumHardStop — pure", () => {
  const base = {
    status: "OPEN",
    entryPremium: 100,
    stopPremium: 70,
    lastEvaluatedAtMs: NOW_MS,
    freshnessWindowMs: 5 * 60 * 1000,
    nowMs: NOW_MS,
  };

  it("STOP when fresh and last premium at/below stop (long CE/PE identical)", () => {
    expect(decidePremiumHardStop({ ...base, lastPremium: 70 }).action).toBe("STOP");
    expect(decidePremiumHardStop({ ...base, lastPremium: 65 }).action).toBe("STOP");
  });

  it("SKIP ABOVE_STOP when premium still above stop", () => {
    const d = decidePremiumHardStop({ ...base, lastPremium: 71 });
    expect(d.action).toBe("SKIP");
    expect(skipReasonOf(d)).toBe("ABOVE_STOP");
  });

  it("SKIP STALE_MTM when last_evaluated_at is older than the window", () => {
    const stale = { ...base, lastEvaluatedAtMs: NOW_MS - 6 * 60 * 1000, lastPremium: 60 };
    const d = decidePremiumHardStop(stale);
    expect(d.action).toBe("SKIP");
    expect(skipReasonOf(d)).toBe("STALE_MTM");
  });

  it("SKIP NOT_OPEN for a non-open row", () => {
    const d = decidePremiumHardStop({ ...base, status: "CLOSED", lastPremium: 60 });
    expect(d.action).toBe("SKIP");
    expect(skipReasonOf(d)).toBe("NOT_OPEN");
  });

  it("SKIP MISSING_* for non-finite / non-positive premiums", () => {
    expect(skipReasonOf(decidePremiumHardStop({ ...base, lastPremium: NaN }))).toMatch(/MISSING/);
    expect(skipReasonOf(decidePremiumHardStop({ ...base, entryPremium: 0, lastPremium: 0 }))).toMatch(/MISSING|INVALID/);
  });

  it("SKIP INVALID_PREMIUM_RISK when stop is not below entry", () => {
    const d = decidePremiumHardStop({ ...base, stopPremium: 110, lastPremium: 60 });
    expect(d.action).toBe("SKIP");
    expect(skipReasonOf(d)).toMatch(/INVALID/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Pure simulation — simulateProtectionRule
// ─────────────────────────────────────────────────────────────────────────

describe("simulateProtectionRule — pure what-if", () => {
  // 1R = (entry-stop)*lots*lotSize. Use lots*lotSize=50 and 30-pt risk → 1R=₹1500.
  const mk = (
    id: string,
    realizedR: number,
    mfeR: number,
    maeR: number,
  ): SimTradeInput => ({
    id,
    index: "NIFTY",
    setup: "EMA_PULLBACK",
    entryPremium: 100,
    stopPremium: 70,
    lots: 1,
    lotSize: 50,
    realizedPnl: realizedR * 1500,
    maxRunup: mfeR * 1500,
    maxDrawdown: maeR * 1500,
  });

  it("GIVEBACK rescues a winner→loser round-trip", () => {
    const agg = simulateProtectionRule([mk("a", -0.74, 1.55, -0.74)], {
      arming: { kind: "R", threshold: 1, label: "+1R" },
      mode: "GIVEBACK",
      givebackPct: 0.4,
      label: "arm +1R → giveback 40%",
    });
    expect(agg.improved).toBe(1);
    expect(agg.winnersProtected).toBe(1);
    expect(agg.perTrade[0]!.alternativeR).toBeCloseTo(0.93, 2);
  });

  it("BREAKEVEN rescues an armed round-tripper to 0R", () => {
    const agg = simulateProtectionRule([mk("a", -0.74, 1.55, -0.74)], {
      arming: { kind: "R", threshold: 1, label: "+1R" },
      mode: "BREAKEVEN",
      label: "arm +1R → breakeven",
    });
    expect(agg.improved).toBe(1);
    expect(agg.perTrade[0]!.alternativeR).toBe(0);
  });

  it("GIVEBACK does NOT damage a trend winner that never fell to the trigger", () => {
    const agg = simulateProtectionRule([mk("a", 4.56, 5.76, 0.5)], {
      arming: { kind: "R", threshold: 1, label: "+1R" },
      mode: "GIVEBACK",
      givebackPct: 0.4,
      label: "arm +1R → giveback 40%",
    });
    expect(agg.trendWinnersDamaged).toBe(0);
    expect(agg.unchanged).toBe(1);
    expect(agg.perTrade[0]!.deltaR).toBeCloseTo(0, 6);
  });

  it("never-armed trade is unchanged", () => {
    const agg = simulateProtectionRule([mk("a", -1, 0.2, -1)], {
      arming: { kind: "R", threshold: 1, label: "+1R" },
      mode: "GIVEBACK",
      givebackPct: 0.4,
      label: "arm +1R → giveback 40%",
    });
    expect(agg.armedCount).toBe(0);
    expect(agg.unchanged).toBe(1);
    expect(agg.perTrade[0]!.deltaR).toBe(0);
  });
});
