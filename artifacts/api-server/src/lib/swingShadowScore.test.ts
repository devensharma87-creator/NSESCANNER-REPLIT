/**
 * H10a — B1 / B3 pure shadow-scoring module tests.
 *
 * These tests lock in:
 *   - the B1 / B3 formulas (H8-locked constants),
 *   - fail-open behavior on null/missing inputs,
 *   - clamping to [0, 100],
 *   - non-mutation of the input row,
 *   - reason-code emission,
 *   - unknown warning strings ignored (no silent guessing),
 *   - the `verifyWarningCodes` helper.
 *
 * Live `score` and `action` are never recomputed or overwritten by
 * this module. None of the trading-decision paths consume it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  B3_PENALTY_CONSTANTS,
  B3_WARNING_SUBSTRINGS,
  KNOWN_NON_B3_WARNING_SUBSTRINGS,
  SHADOW_SCORE_MAX,
  SHADOW_SCORE_MIN,
  computeShadowB1,
  computeShadowB3,
  computeShadowScores,
  verifyWarningCodes,
  type ShadowReasonCode,
  type SwingScanRowForShadow,
} from "./swingShadowScore";

/* ────────────────────────────── Fixtures ────────────────────────────── */

function row(overrides: Partial<SwingScanRowForShadow> = {}): SwingScanRowForShadow {
  return {
    symbol: "TESTSYM",
    scanDate: "2026-05-28",
    liveScore: 60,
    liveAction: "WATCHLIST",
    fundamentalScore: 10,
    rsi14: 50,
    pctFrom52wHigh: -15,
    warnings: [],
    ...overrides,
  };
}

function codes(reasons: { code: ShadowReasonCode }[]): ShadowReasonCode[] {
  return reasons.map((r) => r.code);
}

/* ────────────────────────────── B1 ────────────────────────────── */

describe("computeShadowB1 — H8-locked formula", () => {
  it("subtracts the full fundamental_score from live score", () => {
    const out = computeShadowB1(row({ liveScore: 70, fundamentalScore: 12 }));
    expect(out.b1ShadowScore).toBe(58);
    expect(codes(out.reasons)).toContain("B1_FUNDAMENTAL_REMOVED");
    const fundReason = out.reasons.find((r) => r.code === "B1_FUNDAMENTAL_REMOVED")!;
    expect(fundReason.delta).toBe(-12);
    expect(out.missingFields).toEqual([]);
  });

  it("never mutates the input row", () => {
    const r = row({ liveScore: 70, fundamentalScore: 12, warnings: ["Below EMA200"] });
    const before = JSON.stringify(r);
    computeShadowB1(r);
    computeShadowScores(r);
    expect(JSON.stringify(r)).toBe(before);
  });

  it("clamps low to 0 when live - fund goes negative", () => {
    const out = computeShadowB1(row({ liveScore: 5, fundamentalScore: 20 }));
    expect(out.b1ShadowScore).toBe(SHADOW_SCORE_MIN);
    expect(codes(out.reasons)).toContain("B1_CLAMPED_LOW");
  });

  it("clamps high to 100 when live - fund exceeds 100", () => {
    const out = computeShadowB1(row({ liveScore: 110, fundamentalScore: -5 }));
    expect(out.b1ShadowScore).toBe(SHADOW_SCORE_MAX);
    expect(codes(out.reasons)).toContain("B1_CLAMPED_HIGH");
  });

  it("falls open when fundamental_score is null → B1 == liveScore, no subtraction", () => {
    const out = computeShadowB1(row({ liveScore: 70, fundamentalScore: null }));
    expect(out.b1ShadowScore).toBe(70);
    expect(codes(out.reasons)).toContain("B1_FUNDAMENTAL_MISSING_FAIL_OPEN");
    expect(out.missingFields).toContain("fundamentalScore");
  });

  it("falls open when fundamental_score is undefined", () => {
    const out = computeShadowB1(row({ liveScore: 70, fundamentalScore: undefined }));
    expect(out.b1ShadowScore).toBe(70);
    expect(codes(out.reasons)).toContain("B1_FUNDAMENTAL_MISSING_FAIL_OPEN");
  });

  it("falls open when fundamental_score is NaN-string (drizzle malformed numeric)", () => {
    const out = computeShadowB1(row({ liveScore: 70, fundamentalScore: "not-a-number" as unknown as number }));
    expect(out.b1ShadowScore).toBe(70);
    expect(codes(out.reasons)).toContain("B1_FUNDAMENTAL_MISSING_FAIL_OPEN");
  });

  it("accepts stringified numeric for fundamental_score (drizzle numeric → string)", () => {
    const out = computeShadowB1(row({ liveScore: 70, fundamentalScore: "12.50" as unknown as number }));
    expect(out.b1ShadowScore).toBe(57.5);
  });

  it("returns null with fail-open reason when live score itself is null", () => {
    const out = computeShadowB1(row({ liveScore: null, fundamentalScore: 10 }));
    expect(out.b1ShadowScore).toBeNull();
    expect(codes(out.reasons)).toContain("B1_LIVE_SCORE_MISSING_FAIL_OPEN");
    expect(out.missingFields).toContain("liveScore");
  });

  it("returns null when live score is NaN", () => {
    const out = computeShadowB1(row({ liveScore: NaN }));
    expect(out.b1ShadowScore).toBeNull();
    expect(codes(out.reasons)).toContain("B1_LIVE_SCORE_MISSING_FAIL_OPEN");
  });
});

/* ────────────────────────────── B3 ────────────────────────────── */

describe("computeShadowB3 — H8-locked penalty formula", () => {
  it("inherits B1 untouched when no penalty triggers fire", () => {
    const r = row({ rsi14: 50, pctFrom52wHigh: -20, warnings: ["Below EMA200; higher trend is weak"] });
    const out = computeShadowB3(r, 60);
    expect(out.b3ShadowScore).toBe(60);
    expect(codes(out.reasons)).toContain("B3_INHERITS_B1");
    expect(codes(out.reasons)).not.toContain("B3_RSI_HOT");
    expect(codes(out.reasons)).not.toContain("B3_WARN_EXTENDED");
    expect(codes(out.reasons)).not.toContain("B3_WARN_RSI_OVEREXTENDED");
    expect(codes(out.reasons)).not.toContain("B3_NEAR_52W_HIGH");
    expect(codes(out.reasons)).not.toContain("B3_WARN_RS_WEAK");
  });

  it("applies −8 only when RSI > 70 (strict)", () => {
    expect(computeShadowB3(row({ rsi14: 70 }), 60).b3ShadowScore).toBe(60);
    expect(computeShadowB3(row({ rsi14: 71 }), 60).b3ShadowScore).toBe(52);
    expect(computeShadowB3(row({ rsi14: 99 }), 60).b3ShadowScore).toBe(52);
  });

  it("applies −6 only when 'Price extended far above EMA20' substring present", () => {
    const out = computeShadowB3(
      row({ warnings: ["Price extended far above EMA20; wait for pullback"] }),
      60,
    );
    expect(out.b3ShadowScore).toBe(60 - B3_PENALTY_CONSTANTS.WARN_EXTENDED_PTS);
    expect(codes(out.reasons)).toContain("B3_WARN_EXTENDED");
  });

  it("applies −5 only when 'RSI overextended' substring present", () => {
    const out = computeShadowB3(row({ warnings: ["RSI overextended"] }), 60);
    expect(out.b3ShadowScore).toBe(60 - B3_PENALTY_CONSTANTS.WARN_RSI_OVEREXTENDED_PTS);
    expect(codes(out.reasons)).toContain("B3_WARN_RSI_OVEREXTENDED");
  });

  it("applies −3 only when |pctFrom52wHigh| ≤ 3 (inclusive)", () => {
    expect(computeShadowB3(row({ pctFrom52wHigh: -3 }), 60).b3ShadowScore).toBe(57);
    expect(computeShadowB3(row({ pctFrom52wHigh: 0 }), 60).b3ShadowScore).toBe(57);
    expect(computeShadowB3(row({ pctFrom52wHigh: 3 }), 60).b3ShadowScore).toBe(57);
    expect(computeShadowB3(row({ pctFrom52wHigh: -3.01 }), 60).b3ShadowScore).toBe(60);
    expect(computeShadowB3(row({ pctFrom52wHigh: 3.01 }), 60).b3ShadowScore).toBe(60);
  });

  it("applies −15 only when 'Short-term relative strength weak vs benchmark' substring present", () => {
    const out = computeShadowB3(
      row({ warnings: ["Short-term relative strength weak vs benchmark"] }),
      60,
    );
    expect(out.b3ShadowScore).toBe(60 - B3_PENALTY_CONSTANTS.RS_WEAK_PTS);
    expect(codes(out.reasons)).toContain("B3_WARN_RS_WEAK");
  });

  it("stacks all five penalties additively, then clamps to [0, 100]", () => {
    const out = computeShadowB3(
      row({
        rsi14: 80,
        pctFrom52wHigh: 1,
        warnings: [
          "Price extended far above EMA20; wait for pullback",
          "RSI overextended",
          "Short-term relative strength weak vs benchmark",
        ],
      }),
      60,
    );
    // 60 - (8 + 6 + 5 + 3) - 15 = 60 - 22 - 15 = 23
    expect(out.b3ShadowScore).toBe(23);
    expect(codes(out.reasons)).toEqual(
      expect.arrayContaining([
        "B3_INHERITS_B1",
        "B3_RSI_HOT",
        "B3_WARN_EXTENDED",
        "B3_WARN_RSI_OVEREXTENDED",
        "B3_NEAR_52W_HIGH",
        "B3_WARN_RS_WEAK",
      ]),
    );
  });

  it("clamps low when penalties exceed B1", () => {
    const out = computeShadowB3(
      row({
        rsi14: 80,
        pctFrom52wHigh: 0,
        warnings: [
          "Price extended far above EMA20; wait for pullback",
          "RSI overextended",
          "Short-term relative strength weak vs benchmark",
        ],
      }),
      10,
    );
    expect(out.b3ShadowScore).toBe(SHADOW_SCORE_MIN);
    expect(codes(out.reasons)).toContain("B3_CLAMPED_LOW");
  });

  it("clamps high when B1 exceeds 100 (shouldn't happen post-B1-clamp but defensive)", () => {
    const out = computeShadowB3(row({ rsi14: 50, pctFrom52wHigh: -10, warnings: [] }), 120);
    expect(out.b3ShadowScore).toBe(SHADOW_SCORE_MAX);
    expect(codes(out.reasons)).toContain("B3_CLAMPED_HIGH");
  });

  it("fails open when rsi14 is null", () => {
    const out = computeShadowB3(row({ rsi14: null }), 60);
    expect(codes(out.reasons)).toContain("B3_RSI_MISSING_FAIL_OPEN");
    expect(codes(out.reasons)).not.toContain("B3_RSI_HOT");
    expect(out.missingFields).toContain("rsi14");
  });

  it("fails open when pctFrom52wHigh is null", () => {
    const out = computeShadowB3(row({ pctFrom52wHigh: null }), 60);
    expect(codes(out.reasons)).toContain("B3_PCT_52W_HIGH_MISSING_FAIL_OPEN");
    expect(codes(out.reasons)).not.toContain("B3_NEAR_52W_HIGH");
    expect(out.missingFields).toContain("pctFrom52wHigh");
  });

  it("fails open when warnings is null → no warning-driven penalties", () => {
    const out = computeShadowB3(row({ warnings: null }), 60);
    expect(out.b3ShadowScore).toBe(60);
    expect(codes(out.reasons)).toContain("B3_WARNINGS_MISSING_FAIL_OPEN");
    expect(codes(out.reasons)).not.toContain("B3_WARN_EXTENDED");
    expect(codes(out.reasons)).not.toContain("B3_WARN_RSI_OVEREXTENDED");
    expect(codes(out.reasons)).not.toContain("B3_WARN_RS_WEAK");
  });

  it("fails open when warnings is not an array (jsonb corruption defense)", () => {
    const out = computeShadowB3(
      row({ warnings: { unexpected: "object" } as unknown as readonly unknown[] }),
      60,
    );
    expect(out.b3ShadowScore).toBe(60);
    expect(codes(out.reasons)).toContain("B3_WARNINGS_NOT_ARRAY_FAIL_OPEN");
  });

  it("ignores unknown warning prose without silently guessing", () => {
    const out = computeShadowB3(
      row({
        warnings: [
          "Some brand-new prose that scanner emits in the future",
          "Below EMA200; higher trend is weak",
          "ADX low; trend strength weak",
          "Liquidity low: avg traded value 12.5 lakhs",
          "R:R weak: 0.80R",
        ],
      }),
      60,
    );
    expect(out.b3ShadowScore).toBe(60);
    expect(codes(out.reasons)).not.toContain("B3_WARN_EXTENDED");
    expect(codes(out.reasons)).not.toContain("B3_WARN_RSI_OVEREXTENDED");
    expect(codes(out.reasons)).not.toContain("B3_WARN_RS_WEAK");
  });

  it("ignores non-string elements in the warnings array", () => {
    const out = computeShadowB3(
      row({ warnings: [123, null, undefined, { x: 1 }, ["nested"]] as unknown as readonly unknown[] }),
      60,
    );
    expect(out.b3ShadowScore).toBe(60);
  });
});

/* ────────────────────────────── Combined ────────────────────────────── */

describe("computeShadowScores — combined wrapper", () => {
  it("returns full result with deltas, dataQuality=OK, missingFields=[] on clean row", () => {
    const r = row({ liveScore: 70, fundamentalScore: 10, rsi14: 50, pctFrom52wHigh: -20, warnings: [] });
    const out = computeShadowScores(r);
    expect(out.symbol).toBe("TESTSYM");
    expect(out.scanDate).toBe("2026-05-28");
    expect(out.liveScore).toBe(70);
    expect(out.liveAction).toBe("WATCHLIST");
    expect(out.b1ShadowScore).toBe(60);
    expect(out.b3ShadowScore).toBe(60);
    expect(out.b1Delta).toBe(-10);
    expect(out.b3Delta).toBe(-10);
    expect(out.dataQuality).toBe("OK");
    expect(out.missingFields).toEqual([]);
  });

  it("dataQuality=PARTIAL when a B3 input is missing but live+fund are intact", () => {
    const out = computeShadowScores(row({ liveScore: 70, fundamentalScore: 10, rsi14: null }));
    expect(out.dataQuality).toBe("PARTIAL");
    expect(out.missingFields).toContain("rsi14");
    expect(out.b1ShadowScore).toBe(60);
    expect(out.b3ShadowScore).toBe(60);
  });

  it("dataQuality=INSUFFICIENT when live score is null → b1/b3 null", () => {
    const out = computeShadowScores(row({ liveScore: null }));
    expect(out.dataQuality).toBe("INSUFFICIENT");
    expect(out.b1ShadowScore).toBeNull();
    expect(out.b3ShadowScore).toBeNull();
    expect(out.b1Delta).toBeNull();
    expect(out.b3Delta).toBeNull();
    expect(out.b3Reasons).toEqual([]);
  });

  it("never throws on garbage input", () => {
    expect(() =>
      computeShadowScores({
        symbol: "X",
        scanDate: "X",
        liveScore: "garbage" as unknown as number,
        liveAction: 12345 as unknown as string,
        fundamentalScore: NaN,
        rsi14: Infinity,
        pctFrom52wHigh: -Infinity,
        warnings: "not-an-array" as unknown as readonly unknown[],
      }),
    ).not.toThrow();
  });

  it("dedupes missingFields across B1 and B3", () => {
    const out = computeShadowScores(
      row({ liveScore: 60, fundamentalScore: null, rsi14: null, pctFrom52wHigh: null, warnings: null }),
    );
    const fieldSet = new Set(out.missingFields);
    expect(fieldSet.size).toBe(out.missingFields.length);
  });
});

/* ────────────────────────────── Warning-code verification ────────────────────────────── */

describe("verifyWarningCodes — lock-in helper", () => {
  it("counts substring matches across a sample of warnings arrays", () => {
    const sample = [
      ["Price extended far above EMA20; wait for pullback", "Below EMA200; higher trend is weak"],
      ["RSI overextended"],
      ["Short-term relative strength weak vs benchmark", "RSI overextended"],
      [],
    ];
    const out = verifyWarningCodes(sample);
    expect(out.rowsInspected).toBe(4);
    expect(out.matchCounts.EXTENDED_FROM_EMA20).toBe(1);
    expect(out.matchCounts.RSI_OVEREXTENDED).toBe(2);
    expect(out.matchCounts.RS_WEAK).toBe(1);
    expect(out.allSubstringsObserved).toBe(true);
  });

  it("reports allSubstringsObserved=false when any B3 substring is absent", () => {
    const sample = [["Price extended far above EMA20"], ["RSI overextended"]];
    const out = verifyWarningCodes(sample);
    expect(out.allSubstringsObserved).toBe(false);
    expect(out.matchCounts.RS_WEAK).toBe(0);
  });

  it("surfaces unrecognized prose (not in B3 or KNOWN_NON_B3 lists)", () => {
    const sample = [
      ["Brand-new scanner warning that did not exist before"],
      ["Below EMA200; higher trend is weak"],
    ];
    const out = verifyWarningCodes(sample);
    expect(out.unrecognizedStrings).toContain(
      "Brand-new scanner warning that did not exist before",
    );
    expect(out.unrecognizedStrings).not.toContain("Below EMA200; higher trend is weak");
  });

  it("skips null / non-array entries safely", () => {
    const out = verifyWarningCodes([null, undefined, "not-an-array" as unknown as readonly unknown[]]);
    expect(out.rowsInspected).toBe(0);
    expect(out.distinctStrings).toEqual([]);
    expect(out.allSubstringsObserved).toBe(false);
  });

  it("ignores non-string elements inside arrays", () => {
    const out = verifyWarningCodes([[123, null, { x: 1 }, "RSI overextended"]]);
    expect(out.distinctStrings).toEqual(["RSI overextended"]);
    expect(out.matchCounts.RSI_OVEREXTENDED).toBe(1);
  });
});

/* ────────────────────────────── Isolation guards ────────────────────────────── */

describe("isolation — no DB / Kite / Yahoo / scheduler / route / schema dependencies", () => {
  it("source file has zero imports from DB, Kite, Yahoo, scheduler, fs, express, or drizzle", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "swingShadowScore.ts"), "utf8");
    const forbidden = [
      /from\s+["']pg["']/,
      /from\s+["']drizzle-orm/,
      /from\s+["']@workspace\/db/,
      /from\s+["']kiteconnect/,
      /from\s+["'].*kite/i,
      /from\s+["'].*yahoo/i,
      /from\s+["'].*scheduler/i,
      /from\s+["']node:fs/,
      /from\s+["']fs["']/,
      /from\s+["']express/,
      /from\s+["'].*\/db/,
    ];
    for (const pat of forbidden) {
      expect(src, `forbidden import matched ${pat}`).not.toMatch(pat);
    }
  });

  it("source file does not import swingScanner, swingScannerStore, or paperAccount", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "swingShadowScore.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\/swingScanner["']/);
    expect(src).not.toMatch(/from\s+["']\.\/swingScannerStore["']/);
    expect(src).not.toMatch(/from\s+["']\.\/paperAccount["']/);
  });

  it("module exports H8-locked penalty constants (cannot be re-tuned from caller)", () => {
    expect(B3_PENALTY_CONSTANTS.RSI_GT_70_PTS).toBe(8);
    expect(B3_PENALTY_CONSTANTS.WARN_EXTENDED_PTS).toBe(6);
    expect(B3_PENALTY_CONSTANTS.WARN_RSI_OVEREXTENDED_PTS).toBe(5);
    expect(B3_PENALTY_CONSTANTS.NEAR_52W_HIGH_PTS).toBe(3);
    expect(B3_PENALTY_CONSTANTS.NEAR_52W_HIGH_THRESHOLD_PCT).toBe(3);
    expect(B3_PENALTY_CONSTANTS.RS_WEAK_PTS).toBe(15);
    expect(B3_PENALTY_CONSTANTS.RSI_HOT_THRESHOLD).toBe(70);
    expect(() => {
      (B3_PENALTY_CONSTANTS as unknown as Record<string, number>).RSI_GT_70_PTS = 99;
    }).toThrow();
  });

  it("exposes the three exact B3 warning substrings (locked to scanner prose)", () => {
    expect(B3_WARNING_SUBSTRINGS.EXTENDED_FROM_EMA20).toBe("Price extended far above EMA20");
    expect(B3_WARNING_SUBSTRINGS.RSI_OVEREXTENDED).toBe("RSI overextended");
    expect(B3_WARNING_SUBSTRINGS.RS_WEAK).toBe("Short-term relative strength weak vs benchmark");
  });

  it("KNOWN_NON_B3_WARNING_SUBSTRINGS covers the 10 non-B3 prose strings emitted by swingScanner.ts", () => {
    expect(KNOWN_NON_B3_WARNING_SUBSTRINGS).toHaveLength(10);
  });
});
