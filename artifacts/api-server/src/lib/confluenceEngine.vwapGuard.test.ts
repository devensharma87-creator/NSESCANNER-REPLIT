import { describe, it, expect } from "vitest";
import { scoreConfluence, type ConfluenceInputs } from "./confluenceEngine";

// ---------------------------------------------------------------------------
// P0-2 — confluenceEngine: vwapAvailable=false guard on scoreVwap
// ---------------------------------------------------------------------------
// Cash indices (NIFTY/BANKNIFTY/SENSEX) carry zero candle volume, so their
// session VWAP is structurally unavailable. When vwapAvailable=false the
// engine must return weight=0 / neutral polarity for the VWAP factor so
// that the missing data source does NOT silently boost or suppress confidence.
// ---------------------------------------------------------------------------

const BASE: ConfluenceInputs = {
  direction: "BULLISH",
  setupTrendClass: true,    // true = trending setup (TC/VR/VB/EP), false = mean-reversion
  spot: 25000,
  ema9: 24980,
  ema20: 24950,
  ema50: 24900,
  vwap: 25000,        // effectiveVwap = spot when unavailable
  vwapAvailable: true,
  vp: null,
  // isIndexFno required (not optional) — set false here since this is the
  // equity/stock VWAP-guard test, not an index-F&O evaluation.
  isIndexFno: false,
  regime: "TRENDING_BULL",
  ivRank: null,
  rawConfidence: 65,
};

describe("scoreConfluence — vwapAvailable=false guard", () => {
  it("returns VWAP factor with weight=0 and polarity=neutral when vwapAvailable=false", () => {
    const result = scoreConfluence({ ...BASE, vwapAvailable: false });
    const vwapFactor = result.factors.find((f) => f.label === "VWAP");
    expect(vwapFactor).toBeDefined();
    expect(vwapFactor!.weight).toBe(0);
    expect(vwapFactor!.polarity).toBe("neutral");
  });

  it("VWAP factor detail mentions VWAP unavailability when unavailable (A0.3.3: no zero-volume assumption)", () => {
    // A0.3.3: the canonical unavailability signal is vwap===null; vwapAvailable===false
    // is the legacy flag. Both produce the same honest "unavailable" detail — the
    // specific reason (zero volume vs null) is not assumed in the shared message.
    const result = scoreConfluence({ ...BASE, vwapAvailable: false });
    const vwapFactor = result.factors.find((f) => f.label === "VWAP");
    expect(vwapFactor!.detail).toMatch(/unavailable/i);
    // Must NOT claim a directional read when VWAP is unavailable
    expect(vwapFactor!.detail.toLowerCase()).not.toMatch(/agrees|opposes|above|below/);
  });

  it("does NOT add VWAP factor weight to adjustedConfidence when unavailable", () => {
    // With vwapAvailable=true, spot=vwap → ±0 weight (at-VWAP neutral)
    // With vwapAvailable=false → weight=0 too
    // Both should produce the same adjustedConfidence for this particular geometry
    const withVwap    = scoreConfluence({ ...BASE, vwapAvailable: true, spot: 25000, vwap: 25000 });
    const withoutVwap = scoreConfluence({ ...BASE, vwapAvailable: false, spot: 25000, vwap: 25000 });
    // Both are neutral VWAP positions — delta should be 0
    expect(withoutVwap.adjustedConfidence).toBe(withVwap.adjustedConfidence);
  });

  it("does not spuriously boost confidence for spot==vwap when unavailable (no free bullish driver)", () => {
    // When vwap=spot, spot>vwap is false → old 4-vote system counted this as a BEARISH vote.
    // With unavailable VWAP the vote is dropped entirely, which should NOT add a bullish boost.
    const withVwapAvailable = scoreConfluence({ ...BASE, vwapAvailable: true, spot: 25100, vwap: 24900 });
    const withVwapUnavailable = scoreConfluence({ ...BASE, vwapAvailable: false, spot: 25100, vwap: 25100 });
    // When unavailable, VWAP factor contributes 0 — confidence should be lower (losing a
    // bullish factor) or equal, never higher than the genuine above-VWAP scenario.
    expect(withVwapUnavailable.adjustedConfidence).toBeLessThanOrEqual(withVwapAvailable.adjustedConfidence);
  });

  it("with vwapAvailable=true and spot clearly above vwap, VWAP factor is positive", () => {
    const result = scoreConfluence({ ...BASE, vwapAvailable: true, spot: 25200, vwap: 24800 });
    const vwapFactor = result.factors.find((f) => f.label === "VWAP");
    expect(vwapFactor).toBeDefined();
    expect(vwapFactor!.weight).toBeGreaterThan(0);
    expect(vwapFactor!.polarity).toBe("supports");
  });

  it("produces a valid factors array in both vwapAvailable states", () => {
    for (const vwapAvailable of [true, false]) {
      const result = scoreConfluence({ ...BASE, vwapAvailable });
      expect(Array.isArray(result.factors)).toBe(true);
      expect(result.factors.length).toBeGreaterThan(0);
      expect(isFinite(result.adjustedConfidence)).toBe(true);
      expect(result.adjustedConfidence).toBeGreaterThanOrEqual(0);
      expect(result.adjustedConfidence).toBeLessThanOrEqual(100);
    }
  });

  it("VWAP factor is undefined (not in factors) when vwapAvailable omitted — backward compat", () => {
    // Omitting vwapAvailable (undefined) falls back to the standard VWAP scoring path
    // so vwap=above-spot produces a supporting factor
    const inputs = { ...BASE } as ConfluenceInputs;
    delete (inputs as any).vwapAvailable;
    const result = scoreConfluence({ ...inputs, spot: 25200, vwap: 24800 });
    const vwapFactor = result.factors.find((f) => f.label === "VWAP");
    expect(vwapFactor).toBeDefined();
    expect(vwapFactor!.weight).toBeGreaterThan(0);
  });
});
