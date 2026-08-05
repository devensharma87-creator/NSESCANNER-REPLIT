/**
 * Pack 7 Gate 5 — Enhanced Shadow Parity Classification Model.
 *
 * Machine-readable classification types for Upstox shadow observations.
 * These classifications are MONITORING-ONLY — they NEVER affect trading,
 * signal generation, paper trading, P&L, or broker integration.
 * Shadow provider data has no trading impact; zeroTradingImpact is always true.
 *
 * Consumers: /api/providers/shadow-parity, /api/providers/diagnostics.
 * Never used in: router.ts, fnoSignal*, swing*, paperTrade*.
 */

// ── Classification vocabulary ─────────────────────────────────────────────────

export type ParityClassification =
  /** Shadow price within PRICE_BPS_TOLERANCE of Kite price. */
  | "MATCH_WITHIN_TOLERANCE"
  /** Shadow price differs > PRICE_BPS_TOLERANCE from Kite price. */
  | "PRICE_DIVERGENCE"
  /** Shadow and Kite asOf timestamps differ > TIMESTAMP_SKEW_SEC. */
  | "TIMESTAMP_DIVERGENCE"
  /** Shadow resolved to a different instrument key than requested. */
  | "INSTRUMENT_MISMATCH"
  /** Shadow data is > STALE_PROVIDER_SEC old at evaluation time. */
  | "STALE_PROVIDER"
  /** Shadow asOf is in the future (beyond clock skew tolerance). */
  | "FUTURE_TIMESTAMP"
  /** A required field is absent from the shadow response. */
  | "FIELD_MISSING"
  /** Shadow provider returned an error or was not configured. */
  | "PROVIDER_UNAVAILABLE"
  /** Kite data missing — comparison is impossible. */
  | "NOT_COMPARABLE";

// ── Monitoring thresholds — never enforce on trading paths ────────────────────

/** All threshold values used in parity classification decisions. */
export const PARITY_THRESHOLDS = {
  /** Shadow price delta at or below this bps value → MATCH_WITHIN_TOLERANCE. */
  PRICE_BPS_TOLERANCE:    50,
  /** Absolute timestamp skew (seconds) above which → TIMESTAMP_DIVERGENCE. */
  TIMESTAMP_SKEW_SEC:     120,
  /** Shadow data older than this (seconds) at eval time → STALE_PROVIDER. */
  STALE_PROVIDER_SEC:     300,
  /** Clock skew tolerance (seconds) before future timestamps are rejected. */
  FUTURE_TOLERANCE_SEC:   5,
} as const;

// ── Parity observation ────────────────────────────────────────────────────────

export interface ParityObservation {
  /** e.g. "NSE:NIFTY" or "NSE:RELIANCE" */
  canonicalInstrument: string;
  /** Always "kite" */
  kiteSource: string;
  /** ISO timestamp of the Kite data point, or null if absent. */
  kiteAsOf: string | null;
  /** Always "upstox" */
  upstoxSource: string;
  /** ISO timestamp of the Upstox data point, or null if absent. */
  upstoxAsOf: string | null;
  /** IST ISO string when this observation was recorded. */
  observedAt: string;
  /** How long the Kite fetch took in ms, or null if not measured. */
  kiteLatencyMs: number | null;
  /** How long the Upstox fetch took in ms, or null if not measured. */
  upstoxLatencyMs: number | null;
  /** Fields present in both Kite and Upstox response. */
  comparableFields: string[];
  /** Fields present in Kite response but absent in Upstox response. */
  missingFields: string[];
  /** |kitePrice − upstoxPrice| */
  priceAbsDelta: number | null;
  /** (priceAbsDelta / kitePrice) × 10_000  — basis points */
  priceBpsDelta: number | null;
  /** |kiteAsOf − upstoxAsOf| in seconds */
  timestampSkewSec: number | null;
  /** e.g. "day", "5minute", or null for quote (non-candle) observations */
  candleInterval: string | null;
  /** OHLC absolute deltas for candle comparisons; null for quote comparisons. */
  ohlcDeltas: {
    o: number | null;
    h: number | null;
    l: number | null;
    c: number | null;
  } | null;
  /** Canonical classification for this observation. */
  classification: ParityClassification;
  /**
   * Always true — shadow data has zero trading, signalling, paper-trading,
   * P&L or broker impact. Kept as a literal type so type-checkers flag
   * any code that tries to act on shadow observations.
   */
  zeroTradingImpact: true;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

export interface ParityAggregation {
  provider: "upstox";
  domain: "quote" | "candle";
  symbol: string;
  sampleCount: number;
  matchCount: number;
  /** 0–1 fraction of samples classified MATCH_WITHIN_TOLERANCE. */
  matchRate: number;
  divergenceCount: number;
  /** 0–1 fraction of samples classified PRICE_DIVERGENCE | TIMESTAMP_DIVERGENCE. */
  divergenceRate: number;
  unavailableCount: number;
  /** Median price delta in basis points, or null if < 1 sample. */
  p50PriceDeltaBps: number | null;
  /** 95th-percentile price delta in bps, or null if < 1 sample. */
  p95PriceDeltaBps: number | null;
  /** Median timestamp skew in seconds. */
  p50TimestampSkewSec: number | null;
  /** 95th-percentile timestamp skew in seconds. */
  p95TimestampSkewSec: number | null;
  /** Median fetch latency in ms (Upstox). */
  p50LatencyMs: number | null;
  /** 95th-percentile fetch latency in ms (Upstox). */
  p95LatencyMs: number | null;
  /** Most recent classification seen, or null if no samples. */
  latestClassification: ParityClassification | null;
  /** ISO timestamp of most recent observation, or null. */
  latestAt: string | null;
}

// ── Classification function ───────────────────────────────────────────────────

/**
 * Classify a single shadow parity observation.
 *
 * Returns NOT_COMPARABLE when Kite data is absent (we have nothing to compare).
 * Returns PROVIDER_UNAVAILABLE when Upstox price is absent.
 * Returns FUTURE_TIMESTAMP when Upstox asOf > nowSec + FUTURE_TOLERANCE_SEC.
 * Returns STALE_PROVIDER when Upstox asOf < nowSec - STALE_PROVIDER_SEC.
 * Returns TIMESTAMP_DIVERGENCE when |kiteAsOfSec - upstoxAsOfSec| > TIMESTAMP_SKEW_SEC.
 * Returns FIELD_MISSING when upstoxPrice is null (explicitly missing).
 * Returns PRICE_DIVERGENCE when delta > PRICE_BPS_TOLERANCE bps.
 * Otherwise MATCH_WITHIN_TOLERANCE.
 */
export function classifyParityObservation(
  kitePrice: number | null,
  upstoxPrice: number | null,
  kiteAsOfSec: number | null,
  upstoxAsOfSec: number | null,
  nowSec: number,
): ParityClassification {
  const { PRICE_BPS_TOLERANCE, TIMESTAMP_SKEW_SEC, STALE_PROVIDER_SEC, FUTURE_TOLERANCE_SEC } = PARITY_THRESHOLDS;

  // Kite absent → no canonical baseline to compare against
  if (kitePrice === null || kitePrice === undefined || !Number.isFinite(kitePrice) || kitePrice <= 0) {
    return "NOT_COMPARABLE";
  }

  // Upstox explicitly unavailable
  if (upstoxPrice === null || upstoxPrice === undefined) {
    return "PROVIDER_UNAVAILABLE";
  }

  // Upstox returned non-finite price → treat as field missing
  if (!Number.isFinite(upstoxPrice) || upstoxPrice <= 0) {
    return "FIELD_MISSING";
  }

  // Future timestamp check
  if (upstoxAsOfSec !== null && upstoxAsOfSec > nowSec + FUTURE_TOLERANCE_SEC) {
    return "FUTURE_TIMESTAMP";
  }

  // Stale provider check
  if (upstoxAsOfSec !== null && nowSec - upstoxAsOfSec > STALE_PROVIDER_SEC) {
    return "STALE_PROVIDER";
  }

  // Timestamp skew check (both timestamps must be present)
  if (kiteAsOfSec !== null && upstoxAsOfSec !== null) {
    const skew = Math.abs(kiteAsOfSec - upstoxAsOfSec);
    if (skew > TIMESTAMP_SKEW_SEC) {
      return "TIMESTAMP_DIVERGENCE";
    }
  }

  // Price divergence check
  const absDelta = Math.abs(kitePrice - upstoxPrice);
  const bpsDelta = (absDelta / kitePrice) * 10_000;
  if (bpsDelta > PRICE_BPS_TOLERANCE) {
    return "PRICE_DIVERGENCE";
  }

  return "MATCH_WITHIN_TOLERANCE";
}

// ── Percentile utility ────────────────────────────────────────────────────────

/**
 * Compute the p-th percentile (0–100) of a pre-sorted ascending array.
 * Returns null for empty arrays.
 */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// ── Aggregation function ──────────────────────────────────────────────────────

/**
 * Aggregate a list of observations into a parity summary for one symbol.
 * Returns zero-count aggregation when the list is empty.
 */
export function aggregateObservations(
  obs: ParityObservation[],
  provider: "upstox",
  domain: "quote" | "candle",
  symbol: string,
): ParityAggregation {
  const n = obs.length;
  const latest = obs.length > 0 ? obs[obs.length - 1] : null;

  const matchCount  = obs.filter(o => o.classification === "MATCH_WITHIN_TOLERANCE").length;
  const divergenceCount = obs.filter(o =>
    o.classification === "PRICE_DIVERGENCE" || o.classification === "TIMESTAMP_DIVERGENCE"
  ).length;
  const unavailableCount = obs.filter(o =>
    o.classification === "PROVIDER_UNAVAILABLE" || o.classification === "FIELD_MISSING"
  ).length;

  const priceBpsValues = obs
    .map(o => o.priceBpsDelta)
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);

  const tsSkewValues = obs
    .map(o => o.timestampSkewSec)
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);

  const latencyValues = obs
    .map(o => o.upstoxLatencyMs)
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);

  return {
    provider,
    domain,
    symbol,
    sampleCount:         n,
    matchCount,
    matchRate:           n > 0 ? matchCount / n : 0,
    divergenceCount,
    divergenceRate:      n > 0 ? divergenceCount / n : 0,
    unavailableCount,
    p50PriceDeltaBps:    percentile(priceBpsValues, 50),
    p95PriceDeltaBps:    percentile(priceBpsValues, 95),
    p50TimestampSkewSec: percentile(tsSkewValues, 50),
    p95TimestampSkewSec: percentile(tsSkewValues, 95),
    p50LatencyMs:        percentile(latencyValues, 50),
    p95LatencyMs:        percentile(latencyValues, 95),
    latestClassification: latest?.classification ?? null,
    latestAt:             latest?.observedAt ?? null,
  };
}
