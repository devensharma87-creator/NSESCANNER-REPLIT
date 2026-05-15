/**
 * Tests for the read-only option-snapshot analytics module (Priority 9).
 *
 * Pure-function tests over `computeAnalytics` and `computeStaleness`.
 * No DB, no IO, no clock dependency beyond explicit `Date` arguments.
 */
import { describe, it, expect } from "vitest";
import {
  computeAnalytics,
  computeStaleness,
  WIDE_SPREAD_PCT,
  DEFAULT_STALE_THRESHOLD_MINUTES,
  type AnalyticsRowInput,
} from "./optionSnapshotAnalytics";

// Minimal row builder so test fixtures stay readable.
function row(over: Partial<AnalyticsRowInput>): AnalyticsRowInput {
  return {
    strike: 0,
    optType: "CE",
    oi: null,
    oiChange: null,
    ltp: null,
    iv: null,
    bid: null,
    ask: null,
    spot: null,
    atmStrike: null,
    ...over,
  };
}

// A small, plausible NIFTY-shaped 5-strike snapshot used by several tests.
//   spot = 22 050, ATM = 22 050.
//   CE OI grows above ATM (resistance), PE OI grows below ATM (support).
const NIFTY_SAMPLE: AnalyticsRowInput[] = [
  // 21 900
  row({ strike: 21_900, optType: "CE", oi: 100_000, oiChange:  10_000, ltp: 165, iv: 14, bid: 164, ask: 166, spot: 22_050, atmStrike: 22_050 }),
  row({ strike: 21_900, optType: "PE", oi: 600_000, oiChange:  90_000, ltp:  35, iv: 18, bid:  34, ask:  36, spot: 22_050, atmStrike: 22_050 }),
  // 22 000
  row({ strike: 22_000, optType: "CE", oi: 250_000, oiChange:  20_000, ltp:  85, iv: 13, bid:  84, ask:  86, spot: 22_050, atmStrike: 22_050 }),
  row({ strike: 22_000, optType: "PE", oi: 700_000, oiChange: 110_000, ltp:  60, iv: 16, bid:  59, ask:  61, spot: 22_050, atmStrike: 22_050 }),
  // 22 050  (ATM)
  row({ strike: 22_050, optType: "CE", oi: 400_000, oiChange:  30_000, ltp:  55, iv: 12, bid:  54, ask:  56, spot: 22_050, atmStrike: 22_050 }),
  row({ strike: 22_050, optType: "PE", oi: 500_000, oiChange:  40_000, ltp:  50, iv: 12, bid:  49, ask:  51, spot: 22_050, atmStrike: 22_050 }),
  // 22 100
  row({ strike: 22_100, optType: "CE", oi: 800_000, oiChange: 150_000, ltp:  30, iv: 13, bid:  29, ask:  31, spot: 22_050, atmStrike: 22_050 }),
  row({ strike: 22_100, optType: "PE", oi: 200_000, oiChange:  15_000, ltp:  90, iv: 15, bid:  89, ask:  91, spot: 22_050, atmStrike: 22_050 }),
  // 22 200
  row({ strike: 22_200, optType: "CE", oi: 900_000, oiChange: 250_000, ltp:  10, iv: 14, bid:   9, ask:  11, spot: 22_050, atmStrike: 22_050 }),
  row({ strike: 22_200, optType: "PE", oi:  90_000, oiChange:   8_000, ltp: 145, iv: 17, bid: 144, ask: 146, spot: 22_050, atmStrike: 22_050 }),
];

describe("computeAnalytics — totals & PCR", () => {
  it("sums CE and PE OI across all strikes", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.ceTotalOi).toBe(100_000 + 250_000 + 400_000 + 800_000 + 900_000);
    expect(a.peTotalOi).toBe(600_000 + 700_000 + 500_000 + 200_000 +  90_000);
  });
  it("PCR = putOI / callOI", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.pcr).toBeCloseTo(a.peTotalOi! / a.ceTotalOi!, 6);
  });
  it("sums CE and PE OI deltas (intra-day build-up)", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.ceOiChange).toBe(10_000 + 20_000 + 30_000 + 150_000 + 250_000);
    expect(a.peOiChange).toBe(90_000 + 110_000 + 40_000 + 15_000 +  8_000);
  });
  it("PCR is null when call OI is 0", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE", oi: 0 }),
      row({ strike: 100, optType: "PE", oi: 50_000 }),
    ]);
    expect(a.pcr).toBeNull();
  });
  it("PCR is null when neither side has any OI rows", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE", oi: null }),
      row({ strike: 100, optType: "PE", oi: null }),
    ]);
    expect(a.pcr).toBeNull();
    expect(a.ceTotalOi).toBeNull();
    expect(a.peTotalOi).toBeNull();
  });
});

describe("computeAnalytics — highest-OI / highest-OI-change strike detection", () => {
  it("picks the CE strike with the largest OI", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.highestCeOi).toEqual({ strike: 22_200, oi: 900_000 });
  });
  it("picks the PE strike with the largest OI", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.highestPeOi).toEqual({ strike: 22_000, oi: 700_000 });
  });
  it("picks the CE strike with the largest positive OI delta", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.highestCeOiChange).toEqual({ strike: 22_200, oiChange: 250_000 });
  });
  it("picks the PE strike with the largest positive OI delta", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.highestPeOiChange).toEqual({ strike: 22_000, oiChange: 110_000 });
  });
  it("ignores rows with null oi / null oiChange when picking max", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE", oi: null,    oiChange: null }),
      row({ strike: 200, optType: "CE", oi: 5_000,   oiChange: 1_000 }),
    ]);
    expect(a.highestCeOi).toEqual({ strike: 200, oi: 5_000 });
    expect(a.highestCeOiChange).toEqual({ strike: 200, oiChange: 1_000 });
  });
  it("returns null when a side has no OI data at all", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE", oi: 1_000 }),
    ]);
    expect(a.highestPeOi).toBeNull();
    expect(a.highestPeOiChange).toBeNull();
  });
  it("highest-OI-change ignores negative deltas (unwinding) and returns null when no positive build-up exists", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE", oi: 1_000, oiChange: -2_000 }),
      row({ strike: 110, optType: "CE", oi: 1_000, oiChange:   -500 }),
      row({ strike: 120, optType: "CE", oi: 1_000, oiChange:      0 }),
      row({ strike: 100, optType: "PE", oi: 1_000, oiChange: -1_000 }),
      row({ strike: 110, optType: "PE", oi: 1_000, oiChange:  3_000 }),
      row({ strike: 120, optType: "PE", oi: 1_000, oiChange:    -10 }),
    ]);
    expect(a.highestCeOiChange).toBeNull();
    expect(a.highestPeOiChange).toEqual({ strike: 110, oiChange: 3_000 });
  });
});

describe("computeAnalytics — approximate max pain", () => {
  it("returns a strike present in the snapshot window", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.maxPainStrike).not.toBeNull();
    const strikesInWindow = new Set([21_900, 22_000, 22_050, 22_100, 22_200]);
    expect(strikesInWindow.has(a.maxPainStrike!)).toBe(true);
  });
  it("on a symmetric snapshot, max pain is the central strike", () => {
    // 3-strike symmetric setup — equal CE OI above center and equal PE OI below.
    const sym: AnalyticsRowInput[] = [
      row({ strike: 100, optType: "CE", oi: 500 }),
      row({ strike: 100, optType: "PE", oi: 500 }),
      row({ strike: 110, optType: "CE", oi: 500 }),
      row({ strike: 110, optType: "PE", oi: 500 }),
      row({ strike: 120, optType: "CE", oi: 500 }),
      row({ strike: 120, optType: "PE", oi: 500 }),
    ];
    const a = computeAnalytics(sym);
    expect(a.maxPainStrike).toBe(110);
  });
  it("max pain shifts toward the strike where total writer pain is minimised", () => {
    // Fixture with verified hand-calculation (CE writers ITM when S>K,
    // PE writers ITM when S<K):
    //   pain(100) = CE: 0+0+0 = 0;
    //               PE: 0 + (110-100)·5000 + (120-100)·100 = 52 000;
    //               total = 52 000
    //   pain(110) = CE: (110-100)·100 + 0 + 0 = 1 000;
    //               PE: 0 + 0 + (120-110)·100 = 1 000;
    //               total = 2 000  ← minimum
    //   pain(120) = CE: (120-100)·100 + (120-110)·100 + 0 = 3 000;
    //               PE: 0; total = 3 000
    const skew: AnalyticsRowInput[] = [
      row({ strike: 100, optType: "CE", oi:    100 }),
      row({ strike: 100, optType: "PE", oi: 10_000 }),
      row({ strike: 110, optType: "CE", oi:    100 }),
      row({ strike: 110, optType: "PE", oi:  5_000 }),
      row({ strike: 120, optType: "CE", oi:    100 }),
      row({ strike: 120, optType: "PE", oi:    100 }),
    ];
    const a = computeAnalytics(skew);
    expect(a.maxPainStrike).toBe(110);
  });
  it("returns null when only one side has OI data", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE", oi: 1_000 }),
      row({ strike: 110, optType: "CE", oi: 1_000 }),
    ]);
    expect(a.maxPainStrike).toBeNull();
  });
});

describe("computeAnalytics — ATM straddle / ATM IV", () => {
  it("uses the per-row denormalised atm_strike when present", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.atmStrike).toBe(22_050);
    expect(a.spot).toBe(22_050);
  });
  it("ATM straddle = CE_LTP + PE_LTP at ATM", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.atmStraddle).toEqual({ strike: 22_050, ce: 55, pe: 50, total: 105 });
  });
  it("ATM IV reports CE/PE legs and their mean", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.atmIv).toEqual({ ce: 12, pe: 12, mean: 12 });
  });
  it("ATM IV mean falls back to the single non-null leg", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE", ltp: 5, iv: 20, atmStrike: 100 }),
      row({ strike: 100, optType: "PE", ltp: 4, iv: null, atmStrike: 100 }),
    ]);
    expect(a.atmIv).toEqual({ ce: 20, pe: null, mean: 20 });
  });
  it("ignores bogus IV (<= 0 or >= 500)", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE", ltp: 5, iv: 0,   atmStrike: 100 }),
      row({ strike: 100, optType: "PE", ltp: 4, iv: 999, atmStrike: 100 }),
    ]);
    expect(a.atmIv).toEqual({ ce: null, pe: null, mean: null });
  });
  it("ATM straddle total is null if one leg's LTP is missing", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE", ltp: 5, atmStrike: 100 }),
      row({ strike: 100, optType: "PE", ltp: null, atmStrike: 100 }),
    ]);
    expect(a.atmStraddle).toEqual({ strike: 100, ce: 5, pe: null, total: null });
  });
  it("falls back to nearest-strike-to-spot when atm_strike denorm is missing", () => {
    const a = computeAnalytics([
      row({ strike:  90, optType: "CE", ltp: 12, spot: 102 }),
      row({ strike:  90, optType: "PE", ltp:  3, spot: 102 }),
      row({ strike: 100, optType: "CE", ltp:  6, spot: 102 }),
      row({ strike: 100, optType: "PE", ltp:  5, spot: 102 }),
      row({ strike: 110, optType: "CE", ltp:  2, spot: 102 }),
      row({ strike: 110, optType: "PE", ltp: 11, spot: 102 }),
    ]);
    expect(a.atmStrike).toBe(100);
    expect(a.atmStraddle?.total).toBe(11);
  });
  it("ATM straddle is null when no ATM context can be inferred", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE", oi: 1_000 }),
      row({ strike: 110, optType: "CE", oi: 1_000 }),
    ]);
    expect(a.atmStrike).toBeNull();
    expect(a.atmStraddle).toBeNull();
    expect(a.atmIv).toBeNull();
  });
});

describe("computeAnalytics — IV averages", () => {
  it("computes per-side and overall mean IV", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    const ce = (14 + 13 + 12 + 13 + 14) / 5;
    const pe = (18 + 16 + 12 + 15 + 17) / 5;
    expect(a.ivAverage.ce).toBeCloseTo(ce, 6);
    expect(a.ivAverage.pe).toBeCloseTo(pe, 6);
    expect(a.ivAverage.overall).toBeCloseTo((ce + pe) / 2, 6);
  });
  it("returns null when no IV data is available", () => {
    const a = computeAnalytics([row({ strike: 100, optType: "CE", oi: 1 })]);
    expect(a.ivAverage).toEqual({ ce: null, pe: null, overall: null });
  });
});

describe("computeAnalytics — bid/ask spread summary", () => {
  it("computes median spread% per side and counts wide rows", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    // Every row in NIFTY_SAMPLE has bid/ask/ltp -> 10 samples.
    expect(a.spreadSummary.sampleSize).toBe(10);
    expect(a.spreadSummary.ceMedianPct).not.toBeNull();
    expect(a.spreadSummary.peMedianPct).not.toBeNull();
    // The 22 200 CE row has spread% = (11-9)/10 *100 = 20 % -> very wide.
    expect(a.spreadSummary.widePctCount).toBeGreaterThan(0);
  });
  it("WIDE_SPREAD_PCT constant matches the documented liquidity threshold", () => {
    // Mirrors `FNO_LIQUIDITY.MAX_SPREAD_PCT` semantics — guard against drift.
    expect(WIDE_SPREAD_PCT).toBe(1.5);
  });
  it("skips rows that lack bid/ask/ltp", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE" }), // all null
      row({ strike: 110, optType: "PE", bid: 1, ask: 2, ltp: 1.5 }),
    ]);
    expect(a.spreadSummary.sampleSize).toBe(1);
  });
  it("skips inverted books (ask < bid)", () => {
    const a = computeAnalytics([
      row({ strike: 100, optType: "CE", bid: 5, ask: 4, ltp: 4.5 }),
    ]);
    expect(a.spreadSummary.sampleSize).toBe(0);
  });
});

describe("computeAnalytics — empty / sparse data handling", () => {
  it("empty input returns an all-null result", () => {
    const a = computeAnalytics([]);
    expect(a.ceTotalOi).toBeNull();
    expect(a.peTotalOi).toBeNull();
    expect(a.pcr).toBeNull();
    expect(a.highestCeOi).toBeNull();
    expect(a.highestPeOi).toBeNull();
    expect(a.maxPainStrike).toBeNull();
    expect(a.atmStrike).toBeNull();
    expect(a.atmStraddle).toBeNull();
    expect(a.atmIv).toBeNull();
    expect(a.ivAverage).toEqual({ ce: null, pe: null, overall: null });
    expect(a.spreadSummary).toEqual({ ceMedianPct: null, peMedianPct: null, widePctCount: 0, sampleSize: 0 });
    expect(a.strikeCount).toBe(0);
    expect(a.ceCount).toBe(0);
    expect(a.peCount).toBe(0);
  });
  it("counts strikes / CE / PE rows correctly", () => {
    const a = computeAnalytics(NIFTY_SAMPLE);
    expect(a.strikeCount).toBe(5);
    expect(a.ceCount).toBe(5);
    expect(a.peCount).toBe(5);
  });
});

describe("computeStaleness", () => {
  const now = new Date("2026-05-15T10:00:00Z");
  it("ageMinutes = (now - capturedAt) / 60_000", () => {
    const captured = new Date("2026-05-15T09:55:00Z");
    const s = computeStaleness(captured, now, 30);
    expect(s.ageMinutes).toBeCloseTo(5, 6);
    expect(s.isStale).toBe(false);
  });
  it("flags stale when age exceeds threshold", () => {
    const captured = new Date("2026-05-15T09:00:00Z");
    const s = computeStaleness(captured, now, 30);
    expect(s.ageMinutes).toBeCloseTo(60, 6);
    expect(s.isStale).toBe(true);
  });
  it("clamps negative ages to 0 (capturedAt in future = clock skew)", () => {
    const captured = new Date("2026-05-15T10:05:00Z");
    const s = computeStaleness(captured, now, 30);
    expect(s.ageMinutes).toBe(0);
    expect(s.isStale).toBe(false);
  });
  it("default threshold is 30 minutes", () => {
    expect(DEFAULT_STALE_THRESHOLD_MINUTES).toBe(30);
  });
});
