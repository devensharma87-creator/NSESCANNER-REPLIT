/**
 * Composite bias score — pure-function tests.
 *
 * Locks in: per-signal piecewise scoring at the methodology anchors, the
 * weighted-average → -10..+10 scaling, label-band mapping, null-input
 * exclusion (missing feeds don't drag toward neutral), and determinism.
 *
 * REPORTING ONLY — no trading-decision path consumes this module.
 */
import { describe, expect, it } from "vitest";

import {
  BIAS_WEIGHTS,
  computeCompositeBias,
  labelForScore,
  scoreCash,
  scoreFiiFutLsr,
  scoreGift,
  scorePcr,
  scoreVix,
  type CompositeBiasInput,
} from "./compositeBias";

const FULL_NEUTRAL: CompositeBiasInput = {
  giftNiftyChangePct: 0,
  fiiCashCr: 0,
  diiCashCr: 0,
  fiiFutLsrPct: 45,
  pcr: 1.0,
  vixChangePct: 0,
  macroScore: 0,
};

describe("per-signal scoring anchors", () => {
  it("GIFT clamps and interpolates", () => {
    expect(scoreGift(-1)).toBe(-3);
    expect(scoreGift(-0.5)).toBe(-3);
    expect(scoreGift(0)).toBe(0);
    expect(scoreGift(0.5)).toBe(3);
    expect(scoreGift(2)).toBe(3);
    expect(scoreGift(0.3)).toBeCloseTo(1.5, 5); // halfway 0.1→0.5
  });

  it("cash scores symmetric around zero band", () => {
    expect(scoreCash(-3000)).toBe(-3);
    expect(scoreCash(0)).toBe(0);
    expect(scoreCash(3000)).toBe(3);
    expect(scoreCash(5000)).toBe(3);
    expect(scoreCash(-1750)).toBeCloseTo(-1.5, 5); // halfway -500→-3000
  });

  it("FII fut LSR: <20% strong bear, >70% strong bull, 40-50 neutral", () => {
    expect(scoreFiiFutLsr(18)).toBe(-3);
    expect(scoreFiiFutLsr(45)).toBe(0);
    expect(scoreFiiFutLsr(70)).toBe(3);
    expect(scoreFiiFutLsr(85)).toBe(3);
  });

  it("PCR contrarian: low bearish, high bullish, 0.9-1.1 neutral", () => {
    expect(scorePcr(0.7)).toBe(-3);
    expect(scorePcr(1.0)).toBe(0);
    expect(scorePcr(1.3)).toBe(3);
    expect(scorePcr(0.94)).toBe(0); // within neutral band
  });

  it("VIX asymmetric: falling bullish, rising bearish", () => {
    expect(scoreVix(-5)).toBe(3);
    expect(scoreVix(0)).toBe(0);
    expect(scoreVix(10)).toBe(-3);
    expect(scoreVix(5)).toBeCloseTo(-1.5, 5); // halfway 0→10
  });
});

describe("labelForScore bands", () => {
  it("maps each band", () => {
    expect(labelForScore(8)).toBe("STRONGLY_BULLISH");
    expect(labelForScore(3)).toBe("MILDLY_BULLISH");
    expect(labelForScore(0)).toBe("NEUTRAL");
    expect(labelForScore(-3)).toBe("MILDLY_BEARISH");
    expect(labelForScore(-8)).toBe("STRONGLY_BEARISH");
  });

  it("boundaries are inclusive on the upper side", () => {
    expect(labelForScore(5)).toBe("STRONGLY_BULLISH");
    expect(labelForScore(2)).toBe("MILDLY_BULLISH");
    expect(labelForScore(-2)).toBe("NEUTRAL");
    expect(labelForScore(-5)).toBe("MILDLY_BEARISH");
  });
});

describe("computeCompositeBias", () => {
  it("all-neutral inputs → 0 and NEUTRAL", () => {
    const r = computeCompositeBias(FULL_NEUTRAL);
    expect(r.score).toBe(0);
    expect(r.label).toBe("NEUTRAL");
    expect(r.totalWeightUsed).toBe(9);
    expect(r.dataCompleteness).toBe(1);
  });

  it("max-bull inputs map to +10", () => {
    const r = computeCompositeBias({
      giftNiftyChangePct: 1,
      fiiCashCr: 5000,
      diiCashCr: 5000,
      fiiFutLsrPct: 90,
      pcr: 1.5,
      vixChangePct: -10,
      macroScore: 3,
    });
    expect(r.score).toBe(10);
    expect(r.label).toBe("STRONGLY_BULLISH");
  });

  it("max-bear inputs map to -10", () => {
    const r = computeCompositeBias({
      giftNiftyChangePct: -1,
      fiiCashCr: -5000,
      diiCashCr: -5000,
      fiiFutLsrPct: 10,
      pcr: 0.5,
      vixChangePct: 20,
      macroScore: -3,
    });
    expect(r.score).toBe(-10);
    expect(r.label).toBe("STRONGLY_BEARISH");
  });

  it("worked-example direction (19 May 2026): bearish tilt", () => {
    // Inputs from methodology §6. Exact magnitude differs from the doc's
    // hand-assigned -3.5 (its arithmetic is internally inconsistent); we
    // assert the SIGN and band only.
    const r = computeCompositeBias({
      giftNiftyChangePct: -0.19,
      fiiCashCr: -2457,
      diiCashCr: 3802,
      fiiFutLsrPct: 18,
      pcr: 0.94,
      vixChangePct: -4.87,
      macroScore: -1.2,
    });
    expect(r.score).toBeLessThan(0);
    expect(["MILDLY_BEARISH", "NEUTRAL"]).toContain(r.label);
  });

  it("excludes null signals from numerator AND denominator", () => {
    const r = computeCompositeBias({
      ...FULL_NEUTRAL,
      giftNiftyChangePct: null,
      fiiCashCr: null,
    });
    // Two signals dropped: weight 1.0 + 1.5 = 2.5 removed from 9.0.
    expect(r.totalWeightUsed).toBe(9 - BIAS_WEIGHTS.gift - BIAS_WEIGHTS.fiiCash);
    expect(r.dataCompleteness).toBeLessThan(1);
    const gift = r.breakdown.find(b => b.signal === "GIFT NIFTY")!;
    expect(gift.score).toBeNull();
    expect(gift.contribution).toBe(0);
  });

  it("all-null inputs → 0 score, zero completeness, never throws", () => {
    const r = computeCompositeBias({
      giftNiftyChangePct: null,
      fiiCashCr: null,
      diiCashCr: null,
      fiiFutLsrPct: null,
      pcr: null,
      vixChangePct: null,
      macroScore: null,
    });
    expect(r.score).toBe(0);
    expect(r.totalWeightUsed).toBe(0);
    expect(r.dataCompleteness).toBe(0);
    expect(r.breakdown).toHaveLength(7);
  });

  it("is deterministic", () => {
    const a = computeCompositeBias(FULL_NEUTRAL);
    const b = computeCompositeBias(FULL_NEUTRAL);
    expect(a).toEqual(b);
  });

  it("FII fut OI carries the heaviest weight", () => {
    const r = computeCompositeBias(FULL_NEUTRAL);
    const fii = r.breakdown.find(b => b.signal === "FII futures OI (LSR)")!;
    expect(fii.weight).toBe(2);
    expect(Math.max(...r.breakdown.map(b => b.weight))).toBe(2);
  });
});
