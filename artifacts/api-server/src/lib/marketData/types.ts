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

export type ProviderName = "kite" | "indstocks" | "upstox" | "indianapi" | "yahoo" | "nse" | "cache" | "none";

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
  /**
   * B1.1-C1: True when the provider timestamp is materially in the future
   * (beyond CLOCK_SKEW_TOLERANCE_SEC in freshness.ts). Such data must never
   * power trade decisions, paper admission, contract selection, or exit
   * confirmation — it is unverified regardless of source tier.
   * Absent (undefined) when not a future-timestamp situation.
   */
  isFutureTimestamp?: boolean;
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

// ───────────────────────────────────────────────────────────────────────────
// MarketDataPoint<T> — the unified backbone envelope (Task #131).
//
// Every data fetch that flows through the backbone can be wrapped in a single
// typed envelope that answers, in one place: what is it, where did it come
// from, how fresh is it, may it drive a signal, may it drive a trade alert,
// was a fallback used, and — when degraded — the exact error + recovery action.
//
// This is ADDITIVE. It does not replace DataMeta / MarketDataResult; the
// `pointFromMeta()` adapter bridges the existing envelope into this contract so
// modules can adopt it incrementally without a big-bang migration.
// ───────────────────────────────────────────────────────────────────────────

/** Broad asset class of a backbone datum. */
export type AssetType =
  | "index"
  | "equity"
  | "option_chain"
  | "flow" // FII / DII / participant OI
  | "macro" // India VIX, GIFT Nifty, global cues
  | "news";

/**
 * Honest, human-facing trust status of a datum. Distinct from
 * `ValidationStatus` (per-datum validation outcome) — this is the roll-up used
 * for display and for the requirement engine's accept/reject decision.
 *   TRADE_GRADE  — authoritative (Kite), fresh, complete. May drive signals.
 *   DELAYED      — usable but delayed (Yahoo analytics). Never trade-grade.
 *   INFO_ONLY    — reference/secondary only. Never trade-grade.
 *   COMPUTED     — derived from other data (e.g. breadth, ratios).
 *   STALE        — present but older than its freshness budget.
 *   UNAVAILABLE  — no data could be produced.
 */
export type SourceStatus =
  | "TRADE_GRADE"
  | "DELAYED"
  | "INFO_ONLY"
  | "COMPUTED"
  | "STALE"
  | "UNAVAILABLE";

export interface MarketDataPoint<T> {
  /** Stable identity, e.g. "quote:NIFTY", "candle:BANKNIFTY:15minute", "optionchain:NIFTY". */
  key: string;
  assetType: AssetType;
  symbol: string;
  /** Exchange segment (NSE / BSE / NFO / BFO) or null when not applicable. */
  exchange: string | null;
  /** The payload. Null whenever the datum is UNAVAILABLE. */
  value: T | null;
  /** Upstream provider that produced this datum. */
  source: ProviderName;
  /** Roll-up trust status (see SourceStatus). */
  sourceStatus: SourceStatus;
  /** ISO instant of the datum (exchange/quote/candle time), or null. */
  asOf: string | null;
  /** Age in seconds (now − asOf), or null when asOf unknown. */
  freshnessSec: number | null;
  /** True ONLY when this datum may power a signal/price/valuation decision. */
  canDriveSignals: boolean;
  /** True ONLY when this datum may power a trade alert. */
  canDriveTradeAlerts: boolean;
  /** True when a fallback/secondary source was used to produce this datum. */
  fallbackUsed: boolean;
  /** Machine code when degraded/unavailable — never silent. */
  errorCode: string | null;
  /** Human-readable degradation/error message. */
  errorMessage: string | null;
  /** Operator next-step, e.g. "Reconnect Zerodha", "Wait for market open". */
  recoveryAction: string | null;
}

// ── Concrete payload shapes for the aliases ────────────────────────────────
// Quote/candle reuse the existing rich layer types. The remaining three are
// light contract shapes (full detail lives in the owning modules).

/** Minimal option-chain payload (full chain shape lives in lib/optionChain). */
export interface OptionChainValue {
  underlying: string;
  expiry: string | null;
  spot: number | null;
  /** Number of strike rows present. */
  rowCount: number;
}

/** FII / DII / participant flow payload. */
export interface FlowValue {
  label: string;
  /** Net value in the source's native unit; null when not available. */
  netValue: number | null;
  unit: string;
}

/** Macro payload (India VIX, GIFT Nifty, global cues). */
export interface MacroValue {
  label: string;
  value: number | null;
  unit: string | null;
}

/** News/headline payload. */
export interface NewsValue {
  headline: string;
  publishedAt: string | null;
  url: string | null;
}

/** The six concrete backbone envelopes. */
export type QuoteResult = MarketDataPoint<MarketQuote>;
export type CandleResult = MarketDataPoint<CandleSeries>;
export type OptionChainResult = MarketDataPoint<OptionChainValue>;
export type FlowResult = MarketDataPoint<FlowValue>;
export type MacroResult = MarketDataPoint<MacroValue>;
export type NewsResult = MarketDataPoint<NewsValue>;

// ── Adapter: DataMeta → MarketDataPoint ────────────────────────────────────

/**
 * Roll a `DataMeta` envelope into the display-facing `SourceStatus`.
 * Pure. `hasValue=false` always collapses to UNAVAILABLE.
 */
export function sourceStatusFromMeta(meta: DataMeta, hasValue: boolean): SourceStatus {
  if (!hasValue || meta.validationStatus === "unavailable") return "UNAVAILABLE";
  if (meta.trustTier === "authoritative") {
    if (meta.validationStatus === "stale" || meta.isStale) return "STALE";
    if (meta.validationStatus === "incomplete") return "INFO_ONLY";
    if (meta.validationStatus === "validated") return "TRADE_GRADE";
    return "INFO_ONLY";
  }
  if (meta.trustTier === "secondary_analytics") return "DELAYED";
  // secondary_validation (INDstocks) — cross-check/failover only, never trade-grade.
  return "INFO_ONLY";
}

export interface PointFromMetaInput<T> {
  key: string;
  assetType: AssetType;
  symbol: string;
  exchange?: string | null;
  value: T | null;
  meta: DataMeta;
  /** Set when the layer produced this datum via a fallback/secondary provider. */
  fallbackUsed?: boolean;
  /** Machine error code (overrides derivation when set). */
  errorCode?: string | null;
  errorMessage?: string | null;
  recoveryAction?: string | null;
}

/**
 * Bridge the existing `DataMeta` envelope into a `MarketDataPoint<T>`.
 * Pure. The trade-drivability flags follow the layer's trust model exactly:
 * only fresh, validated, authoritative data with a present value may drive
 * signals; trade alerts additionally require `!notForTradeDecisions`.
 */
export function pointFromMeta<T>(input: PointFromMetaInput<T>): MarketDataPoint<T> {
  const { meta } = input;
  const hasValue = input.value != null;
  const sourceStatus = sourceStatusFromMeta(meta, hasValue);

  const canDriveSignals =
    hasValue &&
    meta.trustTier === "authoritative" &&
    !meta.notForSignals &&
    !meta.isStale &&
    meta.validationStatus === "validated";

  const canDriveTradeAlerts = canDriveSignals && !meta.notForTradeDecisions;

  const errorCode =
    input.errorCode ??
    (sourceStatus === "UNAVAILABLE"
      ? "UNAVAILABLE"
      : sourceStatus === "STALE"
        ? "STALE"
        : null);

  const errorMessage =
    input.errorMessage ??
    (meta.warnings.length > 0 && sourceStatus !== "TRADE_GRADE"
      ? meta.warnings[meta.warnings.length - 1] ?? null
      : null);

  return {
    key: input.key,
    assetType: input.assetType,
    symbol: input.symbol,
    exchange: input.exchange ?? null,
    value: input.value,
    source: meta.source,
    sourceStatus,
    asOf: meta.asOf,
    freshnessSec: meta.freshnessSec,
    canDriveSignals,
    canDriveTradeAlerts,
    fallbackUsed: input.fallbackUsed ?? false,
    errorCode,
    errorMessage,
    recoveryAction: input.recoveryAction ?? null,
  };
}
