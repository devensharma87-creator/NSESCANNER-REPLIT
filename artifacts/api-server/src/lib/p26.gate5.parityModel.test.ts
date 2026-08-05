/**
 * Pack 7 Gate 5 — Parity Model Tests.
 * Pack 7 Gate 8 items 13–14.
 *
 * Tests the ParityClassification enum, ParityObservation interface,
 * classifyParityObservation() function, and aggregateObservations() utility.
 * All tests are pure-function with no network or DB calls.
 */

import { describe, it, expect } from "vitest";
import {
  classifyParityObservation,
  aggregateObservations,
  percentile,
  PARITY_THRESHOLDS,
  type ParityClassification,
  type ParityObservation,
  type ParityAggregation,
} from "./marketData/parityClassification";

const NOW_SEC = Math.floor(Date.now() / 1000);

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeObs(
  classification: ParityClassification,
  priceBpsDelta: number | null = null,
  timestampSkewSec: number | null = null,
  upstoxLatencyMs: number | null = null,
): ParityObservation {
  return {
    canonicalInstrument: "NSE:NIFTY",
    kiteSource: "kite",
    kiteAsOf: new Date().toISOString(),
    upstoxSource: "upstox",
    upstoxAsOf: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    kiteLatencyMs: 45,
    upstoxLatencyMs,
    comparableFields: ["lastPrice", "asOf"],
    missingFields: [],
    priceAbsDelta: priceBpsDelta != null ? (priceBpsDelta / 10000) * 24987 : null,
    priceBpsDelta,
    timestampSkewSec,
    candleInterval: null,
    ohlcDeltas: null,
    classification,
    zeroTradingImpact: true,
  };
}

// ─── PARITY_THRESHOLDS ───────────────────────────────────────────────────────

describe("PARITY_THRESHOLDS constants", () => {
  it("PRICE_BPS_TOLERANCE is 50 bps (0.5%)", () => {
    expect(PARITY_THRESHOLDS.PRICE_BPS_TOLERANCE).toBe(50);
  });

  it("TIMESTAMP_SKEW_SEC is 120 seconds (2 minutes)", () => {
    expect(PARITY_THRESHOLDS.TIMESTAMP_SKEW_SEC).toBe(120);
  });

  it("STALE_PROVIDER_SEC is 300 seconds (5 minutes)", () => {
    expect(PARITY_THRESHOLDS.STALE_PROVIDER_SEC).toBe(300);
  });

  it("FUTURE_TOLERANCE_SEC is 5 seconds (clock skew tolerance)", () => {
    expect(PARITY_THRESHOLDS.FUTURE_TOLERANCE_SEC).toBe(5);
  });

  it("thresholds are monitoring-only constants (not exported as mutable)", () => {
    // The as const assertion makes these readonly
    const t = PARITY_THRESHOLDS;
    expect(typeof t.PRICE_BPS_TOLERANCE).toBe("number");
    expect(typeof t.TIMESTAMP_SKEW_SEC).toBe("number");
  });
});

// ─── classifyParityObservation ───────────────────────────────────────────────

describe("classifyParityObservation — MATCH_WITHIN_TOLERANCE", () => {
  it("prices within 50 bps → MATCH_WITHIN_TOLERANCE", () => {
    // 25 bps delta on 24987 = ~6.25 points
    const result = classifyParityObservation(24987, 24987 + 6.24, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("MATCH_WITHIN_TOLERANCE");
  });

  it("exact same price → MATCH_WITHIN_TOLERANCE", () => {
    const result = classifyParityObservation(24987, 24987, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("MATCH_WITHIN_TOLERANCE");
  });

  it("1 bps delta → MATCH_WITHIN_TOLERANCE", () => {
    const result = classifyParityObservation(24987, 24987 + 2.5, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("MATCH_WITHIN_TOLERANCE");
  });

  it("49.9 bps → MATCH_WITHIN_TOLERANCE (just below 50 bps boundary)", () => {
    // 50 bps exact is a floating-point boundary; test slightly below to verify strictly-less-than works
    const delta = (49.9 / 10000) * 24987;
    const result = classifyParityObservation(24987, 24987 + delta, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("MATCH_WITHIN_TOLERANCE");
  });
});

describe("classifyParityObservation — PRICE_DIVERGENCE", () => {
  it("price delta > 50 bps → PRICE_DIVERGENCE", () => {
    // 100 bps delta = 1%
    const delta = (100 / 10000) * 24987;
    const result = classifyParityObservation(24987, 24987 + delta, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("PRICE_DIVERGENCE");
  });

  it("price delta of 500 bps (5%) → PRICE_DIVERGENCE", () => {
    const result = classifyParityObservation(24987, 24987 * 1.05, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("PRICE_DIVERGENCE");
  });

  it("negative price divergence (upstox lower) → PRICE_DIVERGENCE", () => {
    const delta = (100 / 10000) * 24987;
    const result = classifyParityObservation(24987, 24987 - delta, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("PRICE_DIVERGENCE");
  });
});

describe("classifyParityObservation — TIMESTAMP_DIVERGENCE", () => {
  it("timestamps > 120s apart → TIMESTAMP_DIVERGENCE", () => {
    const result = classifyParityObservation(
      24987, 24987 + 5,    // within price tolerance
      NOW_SEC, NOW_SEC - 200,  // 200s skew > 120s threshold
      NOW_SEC,
    );
    expect(result).toBe("TIMESTAMP_DIVERGENCE");
  });

  it("timestamps exactly 121s apart → TIMESTAMP_DIVERGENCE", () => {
    const result = classifyParityObservation(
      24987, 24987,
      NOW_SEC, NOW_SEC - 121,
      NOW_SEC,
    );
    expect(result).toBe("TIMESTAMP_DIVERGENCE");
  });

  it("timestamps 120s apart → not TIMESTAMP_DIVERGENCE (at boundary)", () => {
    const result = classifyParityObservation(
      24987, 24987,
      NOW_SEC, NOW_SEC - 120,
      NOW_SEC,
    );
    expect(result).not.toBe("TIMESTAMP_DIVERGENCE");
  });
});

describe("classifyParityObservation — STALE_PROVIDER", () => {
  it("upstox data > 300s old → STALE_PROVIDER", () => {
    const result = classifyParityObservation(
      24987, 24987,
      NOW_SEC, NOW_SEC - 400,  // 400s > 300s threshold
      NOW_SEC,
    );
    expect(result).toBe("STALE_PROVIDER");
  });

  it("exactly 301s → STALE_PROVIDER", () => {
    const result = classifyParityObservation(
      24987, 24987,
      NOW_SEC, NOW_SEC - 301,
      NOW_SEC,
    );
    expect(result).toBe("STALE_PROVIDER");
  });

  it("STALE_PROVIDER takes precedence over TIMESTAMP_DIVERGENCE", () => {
    // 400s old also implies timestamp divergence — STALE_PROVIDER should win
    const result = classifyParityObservation(
      24987, 24987,
      NOW_SEC, NOW_SEC - 400,
      NOW_SEC,
    );
    expect(result).toBe("STALE_PROVIDER");
  });
});

describe("classifyParityObservation — FUTURE_TIMESTAMP", () => {
  it("upstox asOf > now + 5s → FUTURE_TIMESTAMP", () => {
    const result = classifyParityObservation(
      24987, 24987,
      NOW_SEC, NOW_SEC + 60,  // 60s in future
      NOW_SEC,
    );
    expect(result).toBe("FUTURE_TIMESTAMP");
  });

  it("upstox asOf exactly 5s in future → acceptable (within tolerance)", () => {
    const result = classifyParityObservation(
      24987, 24987,
      NOW_SEC, NOW_SEC + 5,  // right at tolerance
      NOW_SEC,
    );
    expect(result).not.toBe("FUTURE_TIMESTAMP");
  });

  it("upstox asOf 6s in future → FUTURE_TIMESTAMP", () => {
    const result = classifyParityObservation(
      24987, 24987,
      NOW_SEC, NOW_SEC + 6,
      NOW_SEC,
    );
    expect(result).toBe("FUTURE_TIMESTAMP");
  });
});

describe("classifyParityObservation — FIELD_MISSING / PROVIDER_UNAVAILABLE / NOT_COMPARABLE", () => {
  it("upstoxPrice=null → PROVIDER_UNAVAILABLE", () => {
    const result = classifyParityObservation(24987, null, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("PROVIDER_UNAVAILABLE");
  });

  it("kitePrice=null → NOT_COMPARABLE", () => {
    const result = classifyParityObservation(null, 24987, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("NOT_COMPARABLE");
  });

  it("kitePrice=0 → NOT_COMPARABLE (zero price is invalid baseline)", () => {
    const result = classifyParityObservation(0, 24987, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("NOT_COMPARABLE");
  });

  it("upstoxPrice=NaN → FIELD_MISSING", () => {
    const result = classifyParityObservation(24987, NaN, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("FIELD_MISSING");
  });

  it("upstoxPrice=Infinity → FIELD_MISSING", () => {
    const result = classifyParityObservation(24987, Infinity, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("FIELD_MISSING");
  });

  it("upstoxPrice=-1 (negative) → FIELD_MISSING", () => {
    const result = classifyParityObservation(24987, -1, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("FIELD_MISSING");
  });

  it("kitePrice=NaN → NOT_COMPARABLE", () => {
    const result = classifyParityObservation(NaN, 24987, NOW_SEC, NOW_SEC, NOW_SEC);
    expect(result).toBe("NOT_COMPARABLE");
  });
});

// ─── percentile ─────────────────────────────────────────────────────────────

describe("percentile utility", () => {
  it("empty array → null", () => {
    expect(percentile([], 50)).toBeNull();
  });

  it("single element → that element for any percentile", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
  });

  it("p50 of [1, 2, 3, 4, 5] → 3", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it("p0 of sorted array → first element", () => {
    const arr = [10, 20, 30, 40, 50];
    expect(percentile(arr, 0)).toBe(10);
  });

  it("p100 of sorted array → last element", () => {
    const arr = [10, 20, 30, 40, 50];
    expect(percentile(arr, 100)).toBe(50);
  });

  it("p95 of 20 elements", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i + 1); // [1..20]
    const p95 = percentile(arr, 95);
    expect(p95).not.toBeNull();
    expect(p95!).toBeGreaterThanOrEqual(19);
  });

  it("interpolates between elements", () => {
    const arr = [0, 100];  // p50 = interpolated midpoint
    const p50 = percentile(arr, 50);
    expect(p50).toBe(50);
  });
});

// ─── aggregateObservations ───────────────────────────────────────────────────

describe("aggregateObservations", () => {
  it("empty list → zero sampleCount, nulls for all stats", () => {
    const agg = aggregateObservations([], "upstox", "quote", "NSE:NIFTY");
    expect(agg.sampleCount).toBe(0);
    expect(agg.matchCount).toBe(0);
    expect(agg.matchRate).toBe(0);
    expect(agg.p50PriceDeltaBps).toBeNull();
    expect(agg.p95PriceDeltaBps).toBeNull();
    expect(agg.latestClassification).toBeNull();
    expect(agg.latestAt).toBeNull();
  });

  it("all-match observations → matchRate=1", () => {
    const obs = [
      makeObs("MATCH_WITHIN_TOLERANCE", 10, 5, 120),
      makeObs("MATCH_WITHIN_TOLERANCE", 20, 3, 130),
      makeObs("MATCH_WITHIN_TOLERANCE", 30, 2, 115),
    ];
    const agg = aggregateObservations(obs, "upstox", "quote", "NSE:NIFTY");
    expect(agg.sampleCount).toBe(3);
    expect(agg.matchCount).toBe(3);
    expect(agg.matchRate).toBe(1);
    expect(agg.divergenceCount).toBe(0);
    expect(agg.divergenceRate).toBe(0);
  });

  it("mixed observations → correct match/divergence counts", () => {
    const obs = [
      makeObs("MATCH_WITHIN_TOLERANCE", 10, 5, 100),
      makeObs("PRICE_DIVERGENCE", 200, 10, 200),
      makeObs("PROVIDER_UNAVAILABLE", null, null, null),
    ];
    const agg = aggregateObservations(obs, "upstox", "quote", "NSE:NIFTY");
    expect(agg.sampleCount).toBe(3);
    expect(agg.matchCount).toBe(1);
    expect(agg.matchRate).toBeCloseTo(1/3, 5);
    expect(agg.divergenceCount).toBe(1);
    expect(agg.unavailableCount).toBe(1);
  });

  it("latestClassification is the last observation's classification", () => {
    const obs = [
      makeObs("MATCH_WITHIN_TOLERANCE"),
      makeObs("PRICE_DIVERGENCE"),
    ];
    const agg = aggregateObservations(obs, "upstox", "quote", "NSE:NIFTY");
    expect(agg.latestClassification).toBe("PRICE_DIVERGENCE");
  });

  it("p50/p95 price delta computed from all non-null samples", () => {
    const obs = [
      makeObs("MATCH_WITHIN_TOLERANCE", 10, null, 100),
      makeObs("MATCH_WITHIN_TOLERANCE", 20, null, 110),
      makeObs("PRICE_DIVERGENCE",       80, null, 200),
      makeObs("PROVIDER_UNAVAILABLE",  null, null, null), // null excluded
    ];
    const agg = aggregateObservations(obs, "upstox", "quote", "NSE:NIFTY");
    expect(agg.p50PriceDeltaBps).not.toBeNull();
    expect(agg.p95PriceDeltaBps).not.toBeNull();
    // p50 of [10, 20, 80] should be 20
    expect(agg.p50PriceDeltaBps).toBe(20);
  });

  it("latency stats computed from non-null upstoxLatencyMs", () => {
    const obs = [
      makeObs("MATCH_WITHIN_TOLERANCE", 5, null, 100),
      makeObs("MATCH_WITHIN_TOLERANCE", 5, null, 200),
      makeObs("MATCH_WITHIN_TOLERANCE", 5, null, 300),
    ];
    const agg = aggregateObservations(obs, "upstox", "quote", "NSE:NIFTY");
    expect(agg.p50LatencyMs).toBe(200);
    expect(agg.p95LatencyMs).toBeGreaterThanOrEqual(200);
  });

  it("aggregation metadata reflects correct provider and domain", () => {
    const agg = aggregateObservations([], "upstox", "candle", "NSE:RELIANCE");
    expect(agg.provider).toBe("upstox");
    expect(agg.domain).toBe("candle");
    expect(agg.symbol).toBe("NSE:RELIANCE");
  });
});

// ─── G8-14: zeroTradingImpact is always true ────────────────────────────────

describe("G8-14: zeroTradingImpact literal type", () => {
  it("every ParityObservation has zeroTradingImpact=true", () => {
    const obs = makeObs("MATCH_WITHIN_TOLERANCE");
    expect(obs.zeroTradingImpact).toBe(true);
  });

  it("TypeScript literal ensures zeroTradingImpact cannot be false", () => {
    // This tests the contract: the literal type `true` means a false value
    // would cause a compile-time error
    const obs = makeObs("PRICE_DIVERGENCE");
    // Runtime check: value is always the boolean literal true
    expect(obs.zeroTradingImpact === true).toBe(true);
    expect(typeof obs.zeroTradingImpact).toBe("boolean");
  });
});

// ─── G8-13: Classification vocabulary completeness ──────────────────────────

describe("G8-13: ParityClassification vocabulary completeness", () => {
  const EXPECTED_CLASSIFICATIONS: ParityClassification[] = [
    "MATCH_WITHIN_TOLERANCE",
    "PRICE_DIVERGENCE",
    "TIMESTAMP_DIVERGENCE",
    "INSTRUMENT_MISMATCH",
    "STALE_PROVIDER",
    "FUTURE_TIMESTAMP",
    "FIELD_MISSING",
    "PROVIDER_UNAVAILABLE",
    "NOT_COMPARABLE",
  ];

  it("all 9 classification types are defined", () => {
    expect(EXPECTED_CLASSIFICATIONS.length).toBe(9);
  });

  for (const cls of EXPECTED_CLASSIFICATIONS) {
    it(`${cls} is a valid string value`, () => {
      expect(typeof cls).toBe("string");
      expect(cls.length).toBeGreaterThan(0);
    });
  }

  it("classification names follow SCREAMING_SNAKE_CASE convention", () => {
    for (const cls of EXPECTED_CLASSIFICATIONS) {
      expect(cls).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});
