import { describe, it, expect } from "vitest";
import { runDirectional, buildDirectionalDataQuality, type Candle } from "./directional";

/**
 * Build a multi-day 15-min series. `dayShape(dayIdx, bar)` returns the close for
 * each bar; OHLC are derived around it. Timestamps are IST wall clock encoded in
 * UTC fields (matching candleSource), 25 bars/day from 09:15.
 */
function series(days: number, dayShape: (day: number, bar: number, prev: number) => number): Candle[] {
  const out: Candle[] = [];
  let prev = 24000;
  for (let d = 0; d < days; d++) {
    for (let b = 0; b < 25; b++) {
      const c = dayShape(d, b, prev);
      const o = prev;
      const h = Math.max(o, c) + 3;
      const l = Math.min(o, c) - 3;
      // 2024-06-03 is a Monday; +d days, 09:15 + 15·b minutes.
      const base = Date.UTC(2024, 5, 3 + d, 9, 15, 0) + b * 15 * 60 * 1000;
      out.push({ t: new Date(base), o, h, l, c });
      prev = c;
    }
  }
  return out;
}

describe("runDirectional (Mode B)", () => {
  it("returns [] when there are fewer than warmup bars", () => {
    const few = series(1, (_d, _b, prev) => prev + 1).slice(0, 10);
    expect(
      runDirectional(few, { indexSymbol: "NIFTY", lotSize: 75, startingCapital: 1_000_000, riskPerTradePct: 1 }),
    ).toHaveLength(0);
  });

  // Sawtooth uptrend: 3 bars up +10, 2 bars down −8 (net rising) keeps RSI in
  // the bullish entry band [50,72] instead of saturating near 100.
  const uptrend = (d: number, b: number, prev: number) =>
    prev + (((d * 25 + b) % 5) < 3 ? 10 : -8);

  it("produces ONLY modeled trades with real spots and NO fabricated option premiums", () => {
    const candles = series(16, uptrend);
    const trades = runDirectional(candles, {
      indexSymbol: "NIFTY",
      lotSize: 75,
      startingCapital: 1_000_000,
      riskPerTradePct: 1,
    });
    expect(trades.length).toBeGreaterThan(0);
    for (const t of trades) {
      expect(t.modeled).toBe(true); // every Mode-B fill is flagged modeled
      expect(t.optionEntry).toBeNull(); // no historical premium fabricated
      expect(t.optionExit).toBeNull();
      expect(typeof t.entrySpot).toBe("number"); // real spot
      expect(typeof t.exitSpot).toBe("number");
      expect(t.lotSize).toBe(75);
      expect(t.qty).toBe(75 * (t.lots ?? 0));
    }
    // In a clean uptrend the long-CALL delta proxy should net positive.
    const total = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    expect(total).toBeGreaterThan(0);
  });

  it("never holds overnight — every exit is on the same IST day as its entry", () => {
    const candles = series(16, uptrend);
    const trades = runDirectional(candles, {
      indexSymbol: "NIFTY",
      lotSize: 75,
      startingCapital: 1_000_000,
      riskPerTradePct: 1,
    });
    for (const t of trades) {
      const e = new Date(t.entryAt!);
      const x = new Date(t.exitAt!);
      expect(e.getUTCFullYear()).toBe(x.getUTCFullYear());
      expect(e.getUTCMonth()).toBe(x.getUTCMonth());
      expect(e.getUTCDate()).toBe(x.getUTCDate());
    }
  });
});

describe("buildDirectionalDataQuality", () => {
  it('surfaces "Historical option data unavailable" for missing instruments and lists modeled fields', () => {
    const dq = buildDirectionalDataQuality({
      coverage: null,
      tradeCount: 0,
      missingInstruments: ["BANKNIFTY"],
    });
    expect(dq.mode).toBe("DIRECTIONAL");
    expect(dq.optionDataAvailable).toBe(false);
    expect(dq.warnings.some((w) => /Historical option data unavailable/.test(w))).toBe(true);
    expect(dq.modeledFields.some((m) => /delta proxy/.test(m))).toBe(true);
    expect(dq.modeledFields.some((m) => /session-mean/.test(m))).toBe(true);
  });
});
