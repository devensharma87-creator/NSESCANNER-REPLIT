/**
 * Central market-data layer — shared types & trust-tier model.
 *
 * Every quote/candle that leaves this layer carries a `DataMeta` envelope so
 * downstream code can always answer: where did this come from, how fresh is it,
 * is it allowed to power a trading/signal decision, and what (if anything) is
 * wrong with it.
 *
 * Trust tiers (the heart of the policy):
 *   - "authoritative"          — Kite Connect. The ONLY tier allowed to power
 *                                prices, signals, valuation, F&O and simulation.
 *   - "secondary_validation"   — INDstocks. Cross-checks/failover ONLY. Disabled
 *                                until the INDstocks adapter task ships.
 *   - "secondary_analytics"    — Yahoo. NEVER allowed for prices/signals/
 *                                valuation/F&O. Permitted only as clearly
 *                                labelled, delayed analytics (global assets,
 *                                India VIX fallback, portfolio benchmarks).
 */

export type TrustTier =
  | "authoritative"
  | "secondary_validation"
  | "secondary_analytics";

export type ProviderName = "kite" | "indstocks" | "yahoo" | "cache" | "none";

/**
 * Per-datum validation outcome.
 *   validated   — passed freshness + completeness checks.
 *   unvalidated — emitted without validation (e.g. analytics tier).
 *   incomplete  — missing required fields (still surfaced, flagged).
 *   stale       — older than the freshness budget.
 *   mismatch    — cross-provider disagreement (reserved for INDstocks task).
 *   unavailable — no data could be produced.
 */
export type ValidationStatus =
  | "validated"
  | "unvalidated"
  | "incomplete"
  | "stale"
  | "mismatch"
  | "unavailable";

export interface DataMeta {
  /** Upstream that produced this datum. */
  source: ProviderName;
  /** Trust tier of `source` at the moment it was produced. */
  trustTier: TrustTier;
  /** ISO timestamp of the data instant (exchange/quote/candle time). */
  asOf: string | null;
  /** ISO timestamp of when this layer fetched/computed the datum. */
  fetchedAt: string;
  /** Age of the datum in seconds (now − asOf), or null when asOf unknown. */
  freshnessSec: number | null;
  /** True when older than the freshness budget (see freshness.ts). */
  isStale: boolean;
  /** True for delayed feeds (Yahoo analytics). */
  delayed: boolean;
  /** Hard flag: this datum must never feed a signal/price/valuation decision. */
  notForSignals: boolean;
  /** Hard flag: this datum must never feed trade decisions (portfolio valuation,
   *  risk sizing, P&L, MFE/MAE, stop/target/entry calculations). Distinct from
   *  notForSignals because analytics might be used for display but still not
   *  qualify for any trade-relevant computation. */
  notForTradeDecisions: boolean;
  /** Per-datum validation outcome. */
  validationStatus: ValidationStatus;
  /** Human-readable notes (degradations, fallbacks, missing fields). */
  warnings: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// Type-level branding.
//
// `TradeableBrand` can only be attached by `guard.assertTradeable` after the
// runtime trust-tier check passes. Signal/price/valuation/F&O functions should
// accept `TrustedQuote`/`TrustedCandleSeries`, making it a compile error to
// pass analytics data into them.
// ───────────────────────────────────────────────────────────────────────────

declare const TRADEABLE_BRAND: unique symbol;
declare const ANALYTICS_BRAND: unique symbol;

export interface TradeableBrand {
  readonly [TRADEABLE_BRAND]: true;
}
export interface AnalyticsBrand {
  readonly [ANALYTICS_BRAND]: true;
}

export interface QuoteCore {
  symbol: string;
  name?: string;
  lastPrice: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  volume?: number;
}

export interface MarketQuote extends QuoteCore {
  meta: DataMeta;
}

/** A quote proven (at runtime, via the guard) safe to power trading/signals. */
export type TrustedQuote = MarketQuote & TradeableBrand;
/** A quote explicitly tagged analytics-only — banned from trading/signals. */
export type AnalyticsQuote = MarketQuote & AnalyticsBrand;

export interface Candle {
  /** ISO timestamp of the candle bucket open. */
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleSeries {
  symbol: string;
  interval: string;
  candles: Candle[];
  meta: DataMeta;
}

export type TrustedCandleSeries = CandleSeries & TradeableBrand;
export type AnalyticsCandleSeries = CandleSeries & AnalyticsBrand;

/** Single-value result wrapper for the trusted router methods. */
export interface MarketDataResult<T> {
  ok: boolean;
  data: T | null;
  meta: DataMeta;
  /** Set when !ok or partial — always a concrete reason, never silent. */
  reason?: string;
}

/** Per-symbol failure record for batch fetches. */
export interface MissingSymbol {
  symbol: string;
  reason: string;
}

/** Batch quote result — honest partial/missing reporting. */
export interface BatchQuoteResult {
  requested: string[];
  quotes: Map<string, TrustedQuote>;
  missing: MissingSymbol[];
  /** Aggregate envelope (newest asOf, stale if any row is stale). */
  meta: DataMeta;
}
