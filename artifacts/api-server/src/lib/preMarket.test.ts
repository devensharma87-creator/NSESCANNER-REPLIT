/**
 * Tests for the pure pre-market honesty helpers.
 *
 * Core invariants:
 *  - A pre-open "indicative" price is NEVER a real opening print. When derived
 *    from the GIFT NIFTY proxy it must be flagged `synthetic`, and in all cases
 *    it must be `indicative` / `notForSignals` / `notForTradeDecisions`.
 *  - Missing inputs yield `null` + an explicit `missingReason` — never a
 *    fabricated 0 price (the old `?? 0` bug) or a flat 0% change.
 *  - ATR% is `null` when ATR(14) or price is missing — never the old hard-coded
 *    1.0 "assume 1%" fallback.
 */
import { describe, it, expect } from "vitest";
import { deriveIndicativePreview, deriveAtrPct } from "./preMarket";

describe("deriveIndicativePreview — honesty envelope", () => {
  it("always sets the indicative / not-for-signals / not-for-trade-decisions flags", () => {
    const r = deriveIndicativePreview(100, 101, 0.5, true);
    expect(r.indicative).toBe(true);
    expect(r.notForSignals).toBe(true);
    expect(r.notForTradeDecisions).toBe(true);
  });

  it("returns nulls + missingReason when there is no previous close (never a fabricated 0)", () => {
    const r = deriveIndicativePreview(null, 101, 0.5, true);
    expect(r.previousClose).toBeNull();
    expect(r.indicativePrice).toBeNull();
    expect(r.indicativeChange).toBeNull();
    expect(r.indicativeChangePercent).toBeNull();
    expect(r.synthetic).toBe(false);
    expect(r.missingReason).toBeTruthy();
  });

  it("treats a non-positive / non-finite previous close as missing", () => {
    for (const bad of [0, -10, Number.NaN]) {
      const r = deriveIndicativePreview(bad, 101, 0.5, true);
      expect(r.previousClose).toBeNull();
      expect(r.indicativePrice).toBeNull();
      expect(r.missingReason).toBeTruthy();
    }
  });

  it("flags synthetic and applies the GIFT proxy when proxy is enabled and giftPct is present", () => {
    const prev = 22000;
    const giftPct = 0.5;
    const r = deriveIndicativePreview(prev, 21950, giftPct, true);
    expect(r.synthetic).toBe(true);
    expect(r.source).toMatch(/GIFT/i);
    expect(r.indicativePrice).toBeCloseTo(prev * (1 + giftPct / 100), 6);
    expect(r.indicativeChange).toBeCloseTo(prev * (giftPct / 100), 6);
    expect(r.indicativeChangePercent).toBeCloseTo(giftPct, 6);
    expect(r.missingReason).toBeNull();
  });

  it("falls back to last price (NOT synthetic) when proxy is unavailable", () => {
    const prev = 22000;
    const last = 22100;
    const r = deriveIndicativePreview(prev, last, null, true);
    expect(r.synthetic).toBe(false);
    expect(r.indicativePrice).toBe(last);
    expect(r.indicativeChange).toBeCloseTo(last - prev, 6);
    expect(r.source).toMatch(/previous close/i);
  });

  it("does not use the proxy when useProxy is false even if giftPct is present", () => {
    const r = deriveIndicativePreview(22000, 22100, 0.5, false);
    expect(r.synthetic).toBe(false);
    expect(r.indicativePrice).toBe(22100);
  });

  it("returns a null indicative price + reason when there is a prev close but no proxy and no live price", () => {
    const r = deriveIndicativePreview(22000, null, null, true);
    expect(r.previousClose).toBe(22000);
    expect(r.indicativePrice).toBeNull();
    expect(r.indicativeChange).toBeNull();
    expect(r.indicativeChangePercent).toBeNull();
    expect(r.synthetic).toBe(false);
    expect(r.missingReason).toBeTruthy();
  });
});

describe("deriveAtrPct — no fabricated 1% fallback", () => {
  it("computes ATR as a percent of price", () => {
    expect(deriveAtrPct(20, 1000)).toBeCloseTo(2, 6);
  });

  it("returns null when ATR is missing / non-positive / non-finite", () => {
    expect(deriveAtrPct(null, 1000)).toBeNull();
    expect(deriveAtrPct(undefined, 1000)).toBeNull();
    expect(deriveAtrPct(0, 1000)).toBeNull();
    expect(deriveAtrPct(Number.NaN, 1000)).toBeNull();
  });

  it("returns null when price is missing / non-positive", () => {
    expect(deriveAtrPct(20, null)).toBeNull();
    expect(deriveAtrPct(20, 0)).toBeNull();
    expect(deriveAtrPct(20, -5)).toBeNull();
  });
});
