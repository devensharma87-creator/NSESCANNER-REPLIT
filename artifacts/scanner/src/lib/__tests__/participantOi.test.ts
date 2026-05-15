import { describe, it, expect } from "vitest";
import {
  computeSegmentNet,
  computeSegmentChange,
  formatLakh,
  formatLakhSigned,
  SEGMENT_FORMULAS,
  type ParticipantOiComponents,
} from "../participantOi";

/**
 * Builds a row with all components zeroed unless overridden. Keeps the test
 * cases focused on the segment under test without polluting unrelated legs.
 */
function row(
  partial: Partial<ParticipantOiComponents> = {},
): ParticipantOiComponents {
  return {
    futureIndexLong: 0,
    futureIndexShort: 0,
    futureStockLong: 0,
    futureStockShort: 0,
    optionIndexCallLong: 0,
    optionIndexCallShort: 0,
    optionIndexPutLong: 0,
    optionIndexPutShort: 0,
    optionStockCallLong: 0,
    optionStockCallShort: 0,
    optionStockPutLong: 0,
    optionStockPutShort: 0,
    ...partial,
  };
}

describe("computeSegmentNet — futures (Long − Short)", () => {
  it("Index Futures: positive net when long > short", () => {
    expect(
      computeSegmentNet(
        row({ futureIndexLong: 165_000, futureIndexShort: 0 }),
        "indexFut",
      ),
    ).toBe(165_000); // = 1.65L, matches Client FII Index Futures expected value
  });

  it("Index Futures: negative net when short > long", () => {
    expect(
      computeSegmentNet(
        row({ futureIndexLong: 50_000, futureIndexShort: 276_000 }),
        "indexFut",
      ),
    ).toBe(-226_000); // = -2.26L, matches FII Index Futures expected value
  });

  it("Stock Futures: positive net when long > short", () => {
    expect(
      computeSegmentNet(
        row({ futureStockLong: 2_817_000, futureStockShort: 0 }),
        "stockFut",
      ),
    ).toBe(2_817_000); // = 28.17L, matches Client Stock Futures expected value
  });

  it("Stock Futures: negative net when short > long", () => {
    expect(
      computeSegmentNet(
        row({ futureStockLong: 100_000, futureStockShort: 4_044_000 }),
        "stockFut",
      ),
    ).toBe(-3_944_000); // = -39.44L, matches DII Stock Futures expected value
  });
});

describe("computeSegmentNet — options (DIRECTIONAL formula, regression guard)", () => {
  it("Index Options: long calls only ⇒ net long (bullish)", () => {
    expect(
      computeSegmentNet(row({ optionIndexCallLong: 100_000 }), "indexOpt"),
    ).toBe(100_000);
  });

  it("Index Options: short puts only ⇒ net long (bullish)", () => {
    expect(
      computeSegmentNet(row({ optionIndexPutShort: 100_000 }), "indexOpt"),
    ).toBe(100_000);
  });

  it("Index Options: short calls only ⇒ net short (bearish)", () => {
    expect(
      computeSegmentNet(row({ optionIndexCallShort: 100_000 }), "indexOpt"),
    ).toBe(-100_000);
  });

  it("Index Options: long puts only ⇒ net short (bearish)", () => {
    expect(
      computeSegmentNet(row({ optionIndexPutLong: 100_000 }), "indexOpt"),
    ).toBe(-100_000);
  });

  it("Index Options: directional and naive formulas DIVERGE on a mixed book", () => {
    // Mixed book: heavy long calls and heavy long puts simultaneously
    // (delta-hedged straddle). Naive (CL+PL)−(CS+PS) reads strongly long;
    // directional (CL+PS)−(CS+PL) correctly reads neutral-to-flat because
    // long calls and long puts cancel directionally.
    const r = row({
      optionIndexCallLong: 500_000,
      optionIndexCallShort: 100_000,
      optionIndexPutLong: 500_000,
      optionIndexPutShort: 100_000,
    });
    const directional = computeSegmentNet(r, "indexOpt");
    // Directional: (500k + 100k) − (100k + 500k) = 0 (correctly flat)
    expect(directional).toBe(0);
    // Naive (the bug) would have produced:
    //   (500k + 500k) − (100k + 100k) = +800k (incorrectly bullish)
    // This assertion guards against any future regression to the naive form.
    const naive =
      (r.optionIndexCallLong + r.optionIndexPutLong) -
      (r.optionIndexCallShort + r.optionIndexPutShort);
    expect(naive).toBe(800_000);
    expect(directional).not.toBe(naive);
  });

  it("Stock Options: directional formula is symmetric across legs", () => {
    // Bear stance: long puts + short calls
    const bearish = computeSegmentNet(
      row({ optionStockCallShort: 200_000, optionStockPutLong: 200_000 }),
      "stockOpt",
    );
    expect(bearish).toBe(-400_000);

    // Bull stance: long calls + short puts (mirror image, opposite sign)
    const bullish = computeSegmentNet(
      row({ optionStockCallLong: 200_000, optionStockPutShort: 200_000 }),
      "stockOpt",
    );
    expect(bullish).toBe(400_000);

    expect(bearish).toBe(-bullish);
  });
});

describe("computeSegmentChange — day-over-day", () => {
  it("returns difference of nets when both sides are present", () => {
    const today = row({ futureIndexLong: 200_000, futureIndexShort: 50_000 });
    const prev = row({ futureIndexLong: 150_000, futureIndexShort: 50_000 });
    expect(computeSegmentChange(today, prev, "indexFut")).toBe(50_000);
  });

  it("returns null when previous-day data is missing (no fabricated baseline)", () => {
    const today = row({ futureIndexLong: 200_000 });
    expect(computeSegmentChange(today, undefined, "indexFut")).toBeNull();
  });

  it("returns null when current-day data is missing", () => {
    const prev = row({ futureIndexLong: 150_000 });
    expect(computeSegmentChange(undefined, prev, "indexFut")).toBeNull();
  });

  it("preserves sign on a bearish-to-bullish flip", () => {
    const today = row({ optionIndexCallLong: 500_000 });
    const prev = row({ optionIndexCallShort: 500_000 });
    // Today net = +500k (bullish), prev net = -500k (bearish), Δ = +1M
    expect(computeSegmentChange(today, prev, "indexOpt")).toBe(1_000_000);
  });
});

describe("formatLakh / formatLakhSigned", () => {
  it("renders >= 1L values with 'L' suffix and 2 decimals", () => {
    expect(formatLakh(612_000)).toBe("6.12L");
    expect(formatLakh(-612_000)).toBe("-6.12L");
    expect(formatLakh(2_817_000)).toBe("28.17L");
  });

  it("renders sub-lakh values with Indian grouping", () => {
    expect(formatLakh(27_922)).toBe("27,922");
    expect(formatLakh(-49_892)).toBe("-49,892");
  });

  it("formatLakhSigned prefixes positive values with '+'", () => {
    expect(formatLakhSigned(187)).toBe("+187");
    expect(formatLakhSigned(-49_892)).toBe("-49,892");
    expect(formatLakhSigned(86_383)).toBe("+86,383");
    expect(formatLakhSigned(0)).toBe("0");
  });

  it("returns em-dash for null / NaN / Infinity", () => {
    expect(formatLakh(null)).toBe("—");
    expect(formatLakh(undefined)).toBe("—");
    expect(formatLakh(NaN)).toBe("—");
    expect(formatLakh(Infinity)).toBe("—");
    expect(formatLakhSigned(null)).toBe("—");
  });
});

describe("SEGMENT_FORMULAS — documentation contract", () => {
  it("exposes a human-readable formula string for every segment", () => {
    expect(SEGMENT_FORMULAS.indexFut).toMatch(/Long.*Short/);
    expect(SEGMENT_FORMULAS.stockFut).toMatch(/Long.*Short/);
    // Options must explicitly reference the directional combination so the
    // tooltip / audit endpoint can never silently document the wrong math.
    expect(SEGMENT_FORMULAS.indexOpt).toContain("Call Long");
    expect(SEGMENT_FORMULAS.indexOpt).toContain("Put Short");
    expect(SEGMENT_FORMULAS.indexOpt).toContain("Call Short");
    expect(SEGMENT_FORMULAS.indexOpt).toContain("Put Long");
    expect(SEGMENT_FORMULAS.stockOpt).toContain("Call Long");
    expect(SEGMENT_FORMULAS.stockOpt).toContain("Put Short");
  });
});
