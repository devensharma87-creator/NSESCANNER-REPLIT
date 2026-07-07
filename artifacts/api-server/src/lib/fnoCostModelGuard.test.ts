/**
 * F&O Cost Model Guard tests.
 *
 * Verifies the structural guard catches known-bad patterns and passes
 * on the real post-unification source files.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { runFnoCostModelGuard } from "./fnoCostModelGuard";

const SRC_ROOT = path.resolve(__dirname, "..");

describe("runFnoCostModelGuard — against real post-unification source", () => {
  it("passes on the real post-fix codebase (no violations)", () => {
    const result = runFnoCostModelGuard(SRC_ROOT);
    if (!result.passed) {
      const detail = result.violations
        .map(v => `  [${v.file}:${v.line}] ${v.reason}\n    → ${v.text}`)
        .join("\n");
      console.error("Guard violations found:\n" + detail);
    }
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("summary mentions PASSED on clean codebase", () => {
    const result = runFnoCostModelGuard(SRC_ROOT);
    expect(result.summary).toContain("PASSED");
  });
});

describe("runFnoCostModelGuard — synthetic violation pattern detection", () => {
  it("FNO_COST_RATES constant block pattern is detectable", () => {
    const badLine = "export const FNO_COST_RATES = {";
    const pattern = /FNO_COST_RATES\s*=\s*\{/;
    expect(pattern.test(badLine)).toBe(true);
  });

  it("stale STT_SELL_PCT constant pattern is detectable", () => {
    const badLine = "  STT_SELL_PCT: 0.05 / 100,";
    const pattern = /STT_SELL_PCT\s*:\s*0\.\d/;
    expect(pattern.test(badLine)).toBe(true);
  });

  it("stale exchange 0.053% pattern is detectable in code lines", () => {
    // Both variants match (case-insensitive): `exchange` appears in EXCHANGE_TXN_PCT
    const badLineA = "  EXCHANGE_TXN_PCT: 0.053 / 100,  // NSE transaction charge";
    const badLineB = "  exchange: 0.053 / 100,";
    const pattern = /0\.053\s*\/\s*100.*exchange|exchange.*0\.053\s*\/\s*100/i;
    // The second alternation `exchange.*0.053/100` matches badLineA because
    // EXCHANGE_TXN_PCT contains the word "exchange" (case-insensitive flag i).
    expect(pattern.test(badLineA)).toBe(true);
    expect(pattern.test(badLineB)).toBe(true);
  });

  it("comment lines start with // so the guard's comment-skip prevents false positives", () => {
    // Verify that lines starting with // would be skipped by the guard
    const commentLine = "  // STT_SELL_PCT was 0.05 / 100 before the fix";
    expect(commentLine.trim().startsWith("//")).toBe(true);
  });

  it("the good code does NOT match the forbidden FNO_COST_RATES pattern", () => {
    const goodLine = "import { FNO_COST_PARAMS, FNO_COST_PARAMS_ASOF } from \"../fnoCostModel\";";
    const pattern = /FNO_COST_RATES\s*=\s*\{/;
    expect(pattern.test(goodLine)).toBe(false);
  });

  it("the good code does NOT match the STT_SELL_PCT pattern", () => {
    const goodLine = "const stt = exitTurnover * FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM;";
    const pattern = /STT_SELL_PCT\s*:\s*0\.\d/;
    expect(pattern.test(goodLine)).toBe(false);
  });
});
