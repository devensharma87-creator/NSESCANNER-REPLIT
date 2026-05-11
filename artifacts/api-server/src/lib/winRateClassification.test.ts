import { describe, expect, it } from "vitest";
import {
  classifyTradeOutcome,
  isCountedForWinRate,
  isFilledSystemTrade,
  type ExitReason,
  type TradeOutcome,
} from "./winRateClassification";

/**
 * SQL-predicate mirror (parity gate, 2026-05-11.c).
 *
 * This is a JS port of the runtime SQL filter in
 * `optionSignalGates.ts → loadSetupWinRates`:
 *
 *   WHERE status = 'CLOSED'
 *     AND opened_at >= cutoff
 *     AND exit_reason IN ('TARGET1_HIT','TARGET2_HIT','STOPPED','EXPIRED')
 *   COUNT(*) FILTER (WHERE realized_pnl <> 0) AS total   -- denominator
 *   COUNT(*) FILTER (WHERE realized_pnl > 0)  AS wins
 *
 * From those projections, a row contributes to:
 *   - the win-rate DENOMINATOR  iff exit_reason ∈ system-set AND pnl ≠ 0
 *   - the win-rate NUMERATOR    iff exit_reason ∈ system-set AND pnl > 0
 *
 * Mapped to outcomes:
 *   - in numerator                     → WIN
 *   - in denominator but not numerator → LOSS  (system-set, pnl < 0)
 *   - system-set, pnl == 0             → SCRATCH (excluded from denom)
 *   - non-system exit_reason or null   → EXCLUDE
 *
 * Any drift between this mirror and `classifyTradeOutcome()` will fail
 * the parity test below, which is the contract test the reviewer
 * insisted not stay optional.
 */
function sqlPredicateMirror(
  exitReason: ExitReason | string | null | undefined,
  realizedPnl: number,
): TradeOutcome {
  const SYSTEM = new Set([
    "TARGET1_HIT",
    "TARGET2_HIT",
    "STOPPED",
    "EXPIRED",
  ]);
  if (!exitReason || !SYSTEM.has(exitReason)) return "EXCLUDE";
  if (realizedPnl > 0) return "WIN";
  if (realizedPnl < 0) return "LOSS";
  return "SCRATCH";
}

describe("classifyTradeOutcome (2026-05-11.c 4-bucket policy)", () => {
  it("returns WIN for system exits with positive pnl", () => {
    expect(classifyTradeOutcome("TARGET1_HIT", 1500)).toBe("WIN");
    expect(classifyTradeOutcome("TARGET2_HIT", 5000)).toBe("WIN");
    expect(classifyTradeOutcome("STOPPED", 1)).toBe("WIN");
    expect(classifyTradeOutcome("EXPIRED", 320)).toBe("WIN");
  });

  it("returns LOSS for system exits with negative pnl", () => {
    expect(classifyTradeOutcome("STOPPED", -800)).toBe("LOSS");
    expect(classifyTradeOutcome("TARGET1_HIT", -50)).toBe("LOSS");
    expect(classifyTradeOutcome("EXPIRED", -150)).toBe("LOSS");
  });

  it("returns SCRATCH for system exits with zero pnl (NOT EXCLUDE)", () => {
    // Reviewer amendment: a filled flat trade is still a real sample;
    // it must surface as SCRATCH so it counts toward expectancy without
    // depressing the win rate.
    expect(classifyTradeOutcome("EXPIRED", 0)).toBe("SCRATCH");
    expect(classifyTradeOutcome("STOPPED", 0)).toBe("SCRATCH");
    expect(classifyTradeOutcome("TARGET1_HIT", 0)).toBe("SCRATCH");
  });

  it("returns EXCLUDE for MANUAL_OVERRIDE (operator-influenced)", () => {
    // Reviewer amendment: manual overrides reflect human judgment, not
    // autonomous setup performance — they must NOT contaminate the
    // setup's win-rate.
    expect(classifyTradeOutcome("MANUAL_OVERRIDE", 250)).toBe("EXCLUDE");
    expect(classifyTradeOutcome("MANUAL_OVERRIDE", -100)).toBe("EXCLUDE");
    expect(classifyTradeOutcome("MANUAL_OVERRIDE", 0)).toBe("EXCLUDE");
  });

  it("returns EXCLUDE for null / unknown exit reasons", () => {
    expect(classifyTradeOutcome(null, 100)).toBe("EXCLUDE");
    expect(classifyTradeOutcome(undefined, 100)).toBe("EXCLUDE");
    expect(classifyTradeOutcome("FOO_BAR", 100)).toBe("EXCLUDE");
    expect(classifyTradeOutcome("", 100)).toBe("EXCLUDE");
  });
});

describe("isCountedForWinRate (back-compat boolean = WIN | LOSS)", () => {
  it("true for system exits with non-zero pnl", () => {
    expect(isCountedForWinRate("TARGET1_HIT", 1500)).toBe(true);
    expect(isCountedForWinRate("STOPPED", -800)).toBe(true);
    expect(isCountedForWinRate("EXPIRED", -150)).toBe(true);
  });

  it("false for SCRATCH (zero-pnl system exit)", () => {
    expect(isCountedForWinRate("EXPIRED", 0)).toBe(false);
    expect(isCountedForWinRate("STOPPED", 0)).toBe(false);
  });

  it("false for MANUAL_OVERRIDE regardless of pnl", () => {
    expect(isCountedForWinRate("MANUAL_OVERRIDE", 250)).toBe(false);
    expect(isCountedForWinRate("MANUAL_OVERRIDE", -100)).toBe(false);
  });

  it("false for null/unknown", () => {
    expect(isCountedForWinRate(null, 1)).toBe(false);
    expect(isCountedForWinRate("FOO", 1)).toBe(false);
  });
});

describe("isFilledSystemTrade (expectancy denominator = WIN | LOSS | SCRATCH)", () => {
  it("true for any system exit including scratches", () => {
    expect(isFilledSystemTrade("TARGET1_HIT", 100)).toBe(true);
    expect(isFilledSystemTrade("STOPPED", -100)).toBe(true);
    expect(isFilledSystemTrade("EXPIRED", 0)).toBe(true);
  });

  it("false for MANUAL_OVERRIDE and unknown reasons", () => {
    expect(isFilledSystemTrade("MANUAL_OVERRIDE", 100)).toBe(false);
    expect(isFilledSystemTrade(null, 100)).toBe(false);
  });
});

describe("SQL/helper PARITY (mandatory contract test, reviewer-required)", () => {
  // Cartesian fixture: every exit_reason × representative pnl values.
  const exitReasons: Array<ExitReason | string | null> = [
    "TARGET1_HIT",
    "TARGET2_HIT",
    "STOPPED",
    "EXPIRED",
    "MANUAL_OVERRIDE",
    "UNKNOWN_FUTURE_REASON",
    null,
  ];
  const pnls = [-1000, -1, 0, 1, 1000];

  const fixtures: Array<[ExitReason | string | null, number]> = [];
  for (const r of exitReasons) for (const p of pnls) fixtures.push([r, p]);

  it.each(fixtures)(
    "helper agrees with SQL mirror for (exit=%s, pnl=%s)",
    (exitReason, pnl) => {
      expect(classifyTradeOutcome(exitReason, pnl)).toBe(
        sqlPredicateMirror(exitReason, pnl),
      );
    },
  );
});
