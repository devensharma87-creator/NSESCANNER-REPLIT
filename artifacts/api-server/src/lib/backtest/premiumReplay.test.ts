/**
 * premiumReplay.ts — Unit tests.
 *
 * All tests are PURE — no database. Mock SnapshotFetcher / ExpiryFetcher
 * implementations return seeded row objects directly. The "one rule" property
 * is enforced: UNAVAILABLE trades always have null P&L; real-captured premiums
 * must equal the seeded LTP exactly; no number is fabricated.
 */

import { describe, it, expect } from "vitest";
import {
  resolvePremiumFromRow,
  assignPricingMode,
  computeFnoCosts,
  computeRunCoverage,
  priceTradeFromSnapshots,
  bsOptionPrice,
  FNO_COST_RATES,
  REPLAY_ENTRY_TOLERANCE_MIN,
  REPLAY_MIN_COVERAGE_PCT,
  type SnapshotRow,
  type SnapshotFetcher,
  type ExpiryFetcher,
} from "./premiumReplay";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    ltp: 120,
    bid: 118,
    ask: 122,
    spread: 4,
    iv: 14.5,
    delta: 0.48,
    theta: -0.9,
    spot: 24350,
    capturedAt: new Date("2024-11-14T04:30:00.000Z"), // 10:00 IST
    ...overrides,
  };
}

function makeExpiryFetcher(expiry: string | null = "2024-11-14"): ExpiryFetcher {
  return async () => expiry;
}

function makeSnapshotFetcher(
  rows: Record<"entry" | "exit", SnapshotRow | null>,
): SnapshotFetcher {
  let callCount = 0;
  return async () => {
    const k = callCount === 0 ? "entry" : "exit";
    callCount++;
    return rows[k];
  };
}

const SAMPLE_TRADE = {
  id: "test-id-1",
  indexSymbol: "NIFTY",
  optionType: "CALL",
  strike: 24350,
  entryAt: "2024-11-14T04:30:00.000Z",
  exitAt: "2024-11-14T06:45:00.000Z",
  lots: 1,
  lotSize: 25,
  qty: 25,
  entrySpot: 24350,
};

// ---------------------------------------------------------------------------
// 1. BS option pricer sanity checks
// ---------------------------------------------------------------------------
describe("bsOptionPrice", () => {
  it("returns intrinsic value when T=0", () => {
    expect(bsOptionPrice(24000, 24000, 0, 0.065, 0.15, true)).toBe(0);
    expect(bsOptionPrice(24000, 23900, 0, 0.065, 0.15, true)).toBe(100);
  });

  it("returns positive call price for ATM", () => {
    const price = bsOptionPrice(24000, 24000, 7 / 365, 0.065, 0.15, true);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(24000); // sanity upper bound
  });

  it("put-call parity holds approximately", () => {
    const S = 24000;
    const K = 24000;
    const T = 7 / 365;
    const r = 0.065;
    const sigma = 0.15;
    const call = bsOptionPrice(S, K, T, r, sigma, true);
    const put = bsOptionPrice(S, K, T, r, sigma, false);
    const parity = call - put - (S - K * Math.exp(-r * T));
    expect(Math.abs(parity)).toBeLessThan(0.01); // tolerance 1 paisa
  });

  it("returns 0 for zero/negative inputs", () => {
    expect(bsOptionPrice(0, 24000, 7 / 365, 0.065, 0.15, true)).toBe(0);
    expect(bsOptionPrice(24000, 0, 7 / 365, 0.065, 0.15, true)).toBe(24000); // intrinsic
    expect(bsOptionPrice(24000, 24000, 7 / 365, 0.065, 0, true)).toBe(0); // zero vol
  });
});

// ---------------------------------------------------------------------------
// 2. resolvePremiumFromRow — priority: LTP > mid > BS
// ---------------------------------------------------------------------------
describe("resolvePremiumFromRow", () => {
  it("uses LTP when present", () => {
    const row = makeRow({ ltp: 120, bid: 115, ask: 125 });
    const leg = resolvePremiumFromRow(row, "2024-11-14", 24350, true);
    expect(leg).not.toBeNull();
    expect(leg!.source).toBe("ltp");
    expect(leg!.premium).toBe(120);
    expect(leg!.spread).toBe(10); // ask - bid
  });

  it("uses mid when LTP is null", () => {
    const row = makeRow({ ltp: null, bid: 118, ask: 122 });
    const leg = resolvePremiumFromRow(row, "2024-11-14", 24350, true);
    expect(leg).not.toBeNull();
    expect(leg!.source).toBe("mid");
    expect(leg!.premium).toBe(120); // (118+122)/2
  });

  it("uses BS from IV when LTP and bid/ask are null", () => {
    const row = makeRow({
      ltp: null,
      bid: null,
      ask: null,
      spread: null,
      iv: 14.5,
      spot: 24350,
    });
    const leg = resolvePremiumFromRow(row, "2024-11-21", 24350, true);
    expect(leg).not.toBeNull();
    expect(leg!.source).toBe("bs");
    expect(leg!.premium).toBeGreaterThan(0);
    expect(leg!.spread).toBeNull(); // no real spread when using BS
  });

  it("returns null when no premium data at all", () => {
    const row = makeRow({
      ltp: null,
      bid: null,
      ask: null,
      spread: null,
      iv: null,
      spot: null,
    });
    const leg = resolvePremiumFromRow(row, "2024-11-14", 24350, true);
    expect(leg).toBeNull();
  });

  it("ignores LTP=0 (non-positive)", () => {
    const row = makeRow({ ltp: 0, bid: 118, ask: 122 });
    const leg = resolvePremiumFromRow(row, "2024-11-14", 24350, true);
    expect(leg!.source).toBe("mid"); // LTP=0 → falls through to mid
  });
});

// ---------------------------------------------------------------------------
// 3. assignPricingMode
// ---------------------------------------------------------------------------
describe("assignPricingMode", () => {
  const realLeg = resolvePremiumFromRow(makeRow({ ltp: 120 }), "2024-11-14", 24350, true)!;
  const bsLeg = resolvePremiumFromRow(makeRow({ ltp: null, bid: null, ask: null, spread: null }), "2024-11-14", 24350, true);
  const bsLegFromIv = resolvePremiumFromRow(makeRow({ ltp: null, bid: null, ask: null, spread: null, iv: 14.5, spot: 24350 }), "2024-11-21", 24350, true)!;

  it("both real → REAL_CAPTURED_PREMIUM", () => {
    expect(assignPricingMode(realLeg, realLeg)).toBe("REAL_CAPTURED_PREMIUM");
  });

  it("one real + one BS → REAL_PARTIAL", () => {
    expect(assignPricingMode(realLeg, bsLegFromIv)).toBe("REAL_PARTIAL");
    expect(assignPricingMode(bsLegFromIv, realLeg)).toBe("REAL_PARTIAL");
  });

  it("both BS → BLACK_SCHOLES_MODELLED", () => {
    expect(assignPricingMode(bsLegFromIv, bsLegFromIv)).toBe("BLACK_SCHOLES_MODELLED");
  });

  it("either null → UNAVAILABLE", () => {
    expect(assignPricingMode(null, realLeg)).toBe("UNAVAILABLE");
    expect(assignPricingMode(realLeg, null)).toBe("UNAVAILABLE");
    expect(assignPricingMode(null, null)).toBe("UNAVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// 4. computeFnoCosts — cost model arithmetic
// ---------------------------------------------------------------------------
describe("computeFnoCosts", () => {
  it("computes correct round-trip costs for a typical NIFTY trade", () => {
    const entryPremium = 120;
    const exitPremium = 150;
    const qty = 25; // 1 lot NIFTY
    const costs = computeFnoCosts(entryPremium, exitPremium, qty, 4, 4);

    // Brokerage: ₹40 (₹20 × 2)
    expect(costs.brokerage).toBe(40);

    // STT on sell side: 0.05% × exitPremium × qty = 0.0005 × 150 × 25 = 1.875
    expect(costs.stt).toBeCloseTo(1.88, 1);

    // Exchange txn on both: 0.053% × (120+150) × 25 = 0.00053 × 6750 = 3.5775
    expect(costs.exchangeTxn).toBeCloseTo(3.58, 1);

    // SEBI: tiny
    expect(costs.sebiCharges).toBeGreaterThan(0);
    expect(costs.sebiCharges).toBeLessThan(0.01);

    // Stamp duty: 0.003% × entry × qty = 0.00003 × 120 × 25 = 0.09
    expect(costs.stampDuty).toBeCloseTo(0.09, 2);

    // Spread cost = (4/2 + 4/2) × 25 = 100
    expect(costs.spreadCost).toBe(100);
    expect(costs.spreadModelled).toBe(false);

    // GST: 18% on (40 + 3.58 + ~0.007) ≈ 7.9
    expect(costs.gst).toBeGreaterThan(7);
    expect(costs.gst).toBeLessThan(9);

    // Total > 0
    expect(costs.total).toBeGreaterThan(0);
  });

  it("uses default half-spread when no real spread", () => {
    const costs = computeFnoCosts(120, 150, 25, null, null);
    expect(costs.spreadModelled).toBe(true);
    // Default: 0.5% of entry + 0.5% of exit = (0.6 + 0.75) × 25 = 33.75
    expect(costs.spreadCost).toBeCloseTo(33.75, 1);
  });

  it("total = sum of all items", () => {
    const costs = computeFnoCosts(120, 150, 25, 4, 4);
    const manual =
      costs.brokerage + costs.stt + costs.exchangeTxn + costs.sebiCharges +
      costs.gst + costs.stampDuty + (costs.spreadCost ?? 0);
    expect(Math.abs(costs.total - manual)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// 5. priceTradeFromSnapshots — integration over injected fetchers
// ---------------------------------------------------------------------------
describe("priceTradeFromSnapshots", () => {
  it("returns REAL_CAPTURED_PREMIUM when both legs have real LTP within tolerance", async () => {
    const entryLtp = 120;
    const exitLtp = 148;
    const expiryFetcher = makeExpiryFetcher("2024-11-14");
    const snapshotFetcher = makeSnapshotFetcher({
      entry: makeRow({ ltp: entryLtp }),
      exit: makeRow({ ltp: exitLtp, capturedAt: new Date("2024-11-14T06:45:00.000Z") }),
    });

    const result = await priceTradeFromSnapshots(SAMPLE_TRADE, expiryFetcher, snapshotFetcher);

    expect(result.pricingMode).toBe("REAL_CAPTURED_PREMIUM");
    // Anti-fabrication: premiums must match the seeded LTP exactly
    expect(result.optionEntry).toBe(entryLtp);
    expect(result.optionExit).toBe(exitLtp);
    expect(result.grossPnl).toBeCloseTo((exitLtp - entryLtp) * 25, 2);
    expect(result.netPnl).not.toBeNull();
    expect(result.netPnl!).toBeLessThan(result.grossPnl!); // costs reduce P&L
    expect(result.withinTolerance).toBe(true);
    expect(result.entryPremiumSource).not.toBe("unavailable");
    expect(result.entryPremiumSource).not.toBe("modelled");
  });

  it("returns REAL_PARTIAL when entry is real and exit is BS", async () => {
    const expiryFetcher = makeExpiryFetcher("2024-11-21");
    const snapshotFetcher = makeSnapshotFetcher({
      entry: makeRow({ ltp: 120 }),
      exit: makeRow({ ltp: null, bid: null, ask: null, spread: null, iv: 14.5, spot: 24350 }),
    });
    const result = await priceTradeFromSnapshots(SAMPLE_TRADE, expiryFetcher, snapshotFetcher);
    expect(result.pricingMode).toBe("REAL_PARTIAL");
    expect(result.entryPremiumSource).not.toBe("modelled");
    expect(result.exitPremiumSource).toBe("modelled");
    expect(result.grossPnl).not.toBeNull();
  });

  it("returns BLACK_SCHOLES_MODELLED when both legs are priced from IV", async () => {
    const bsRow = makeRow({ ltp: null, bid: null, ask: null, spread: null, iv: 14.5, spot: 24350 });
    const expiryFetcher = makeExpiryFetcher("2024-11-21");
    const snapshotFetcher = makeSnapshotFetcher({ entry: bsRow, exit: bsRow });
    const result = await priceTradeFromSnapshots(SAMPLE_TRADE, expiryFetcher, snapshotFetcher);
    expect(result.pricingMode).toBe("BLACK_SCHOLES_MODELLED");
    expect(result.entryPremiumSource).toBe("modelled");
    expect(result.exitPremiumSource).toBe("modelled");
  });

  it("returns UNAVAILABLE with null P&L when no snapshot data exists — anti-fabrication", async () => {
    const expiryFetcher = makeExpiryFetcher("2024-11-14");
    const snapshotFetcher = makeSnapshotFetcher({ entry: null, exit: null });

    const result = await priceTradeFromSnapshots(SAMPLE_TRADE, expiryFetcher, snapshotFetcher);

    expect(result.pricingMode).toBe("UNAVAILABLE");
    // Anti-fabrication: null premiums and null P&L
    expect(result.optionEntry).toBeNull();
    expect(result.optionExit).toBeNull();
    expect(result.grossPnl).toBeNull();
    expect(result.netPnl).toBeNull();
    expect(result.costs).toBeNull();
    expect(result.withinTolerance).toBe(false);
    expect(result.entryPremiumSource).toBe("unavailable");
    expect(result.exitPremiumSource).toBe("unavailable");
  });

  it("returns UNAVAILABLE when no expiry can be resolved — anti-fabrication", async () => {
    const expiryFetcher = makeExpiryFetcher(null); // no expiry found
    const snapshotFetcher = makeSnapshotFetcher({ entry: makeRow(), exit: makeRow() });

    const result = await priceTradeFromSnapshots(SAMPLE_TRADE, expiryFetcher, snapshotFetcher);

    expect(result.pricingMode).toBe("UNAVAILABLE");
    expect(result.grossPnl).toBeNull();
    expect(result.netPnl).toBeNull();
  });

  it("returns UNAVAILABLE when trade has null qty — anti-fabrication", async () => {
    const expiryFetcher = makeExpiryFetcher("2024-11-14");
    const snapshotFetcher = makeSnapshotFetcher({ entry: makeRow(), exit: makeRow() });

    const result = await priceTradeFromSnapshots(
      { ...SAMPLE_TRADE, qty: null },
      expiryFetcher,
      snapshotFetcher,
    );

    expect(result.pricingMode).toBe("UNAVAILABLE");
    expect(result.grossPnl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. computeRunCoverage — coverage gate
// ---------------------------------------------------------------------------
describe("computeRunCoverage", () => {
  it("flags LOW COVERAGE when fewer than 60% of trades can be priced", () => {
    const results = [
      ...Array(30).fill({ pricingMode: "REAL_CAPTURED_PREMIUM" }),
      ...Array(70).fill({ pricingMode: "UNAVAILABLE" }),
    ] as Array<{ pricingMode: Parameters<typeof computeRunCoverage>[0][0]["pricingMode"] }>;

    const mix = computeRunCoverage(results);
    expect(mix.total).toBe(100);
    expect(mix.realCaptured).toBe(30);
    expect(mix.unavailable).toBe(70);
    expect(mix.coveragePct).toBe(30);
    expect(mix.lowCoverage).toBe(true);
    expect(mix.coverageFlag).not.toBeNull();
  });

  it("does NOT flag LOW COVERAGE when >= 60% priced", () => {
    const results = [
      ...Array(70).fill({ pricingMode: "REAL_CAPTURED_PREMIUM" }),
      ...Array(30).fill({ pricingMode: "UNAVAILABLE" }),
    ] as Array<{ pricingMode: Parameters<typeof computeRunCoverage>[0][0]["pricingMode"] }>;

    const mix = computeRunCoverage(results);
    expect(mix.coveragePct).toBe(70);
    expect(mix.lowCoverage).toBe(false);
    expect(mix.coverageFlag).toBeNull();
  });

  it("handles empty input gracefully", () => {
    const mix = computeRunCoverage([]);
    expect(mix.total).toBe(0);
    expect(mix.coveragePct).toBe(0);
    expect(mix.lowCoverage).toBe(false);
  });

  it("BS_MODELLED and REAL_PARTIAL are counted as priced (not UNAVAILABLE)", () => {
    const results = [
      { pricingMode: "BLACK_SCHOLES_MODELLED" as const },
      { pricingMode: "REAL_PARTIAL" as const },
      { pricingMode: "UNAVAILABLE" as const },
    ];
    const mix = computeRunCoverage(results);
    expect(mix.bsModelled).toBe(1);
    expect(mix.realPartial).toBe(1);
    expect(mix.unavailable).toBe(1);
    // coveragePct = 2/3 × 100 ≈ 66.7 → NOT low
    expect(mix.coveragePct).toBeGreaterThan(60);
    expect(mix.lowCoverage).toBe(false);
  });

  it("REPLAY constants have correct values", () => {
    expect(REPLAY_ENTRY_TOLERANCE_MIN).toBe(5);
    expect(REPLAY_MIN_COVERAGE_PCT).toBe(60);
  });

  it("cost rate constants are present and positive", () => {
    expect(FNO_COST_RATES.BROKERAGE_PER_ORDER).toBeGreaterThan(0);
    expect(FNO_COST_RATES.STT_SELL_PCT).toBeGreaterThan(0);
    expect(FNO_COST_RATES.EXCHANGE_TXN_PCT).toBeGreaterThan(0);
    expect(FNO_COST_RATES.SEBI_CHARGE_PCT).toBeGreaterThan(0);
    expect(FNO_COST_RATES.GST_PCT).toBeGreaterThan(0);
    expect(FNO_COST_RATES.STAMP_DUTY_PCT).toBeGreaterThan(0);
  });
});
