/**
 * Portfolio Analyser — shared types (Phase 1, read-only, client-side).
 *
 * SEBI-neutral by construction: nothing here models a buy/sell recommendation,
 * a guaranteed target, or a stop-loss. "Action views" are review-oriented,
 * factual labels; price levels are surfaced only as objective technical zones.
 */
import type { InstrumentClass } from "./symbol";

/** A single holding as supplied by the user (CSV row or manual entry). */
export interface RawHolding {
  symbol: string;
  name: string;
  exchange?: string;
  sector?: string;
  /** ISO yyyy-mm-dd, or undefined when the user omitted / supplied an invalid date. */
  purchaseDate?: string;
  qty: number;
  rate: number;
  isin?: string;
  broker?: string;
  tag?: string;
  notes?: string;
  /** Optional user-supplied fields — informational only, never rendered as advice. */
  targetPrice?: number;
  stopLoss?: number;
  dividendReceived?: number;
  realisedPnl?: number;
  /**
   * User-entered fallback price for a holding that has NO live CMP (e.g. an
   * unlisted/illiquid scrip the data providers can't quote). Book-keeping only:
   * it is used to value the holding ONLY when no live quote resolves, never
   * overrides a genuine live price, and never produces a day-change. Undefined
   * when the user has not entered one.
   */
  manualCmp?: number;
}

export interface RowError {
  /** 1-based data row number (excludes the header). */
  rowNumber: number;
  field?: string;
  message: string;
}

export interface ParseResult {
  holdings: RawHolding[];
  errors: RowError[];
  /** Symbols that appear more than once (case-insensitive). */
  duplicateSymbols: string[];
}

/**
 * Live, genuinely-fetched metrics for a symbol (derived from getStockDetail).
 * Every field is nullable: a null means the datum was not available, never a
 * fabricated placeholder.
 */
export interface LiveMetrics {
  /** True only when a live quote (CMP) was successfully fetched. */
  available: boolean;
  sector: string | null;
  cmp: number | null;
  previousClose: number | null;
  rsi14: number | null;
  /** True simple-moving-average 50/200-day (Yahoo fiftyDayAverage / twoHundredDayAverage). */
  dma50: number | null;
  dma200: number | null;
  /** Objective technical zones (NOT targets/stops). */
  supportZone: number | null;
  resistanceZone: number | null;
  trendStrength: number | null;
  /** Fundamentals — display only, NOT included in the composite score. */
  peRatio: number | null;
  pbRatio: number | null;
  roe: number | null;
  marketCapCr: number | null;
  beta: number | null;
}

/** Which endpoint ultimately supplied the live CMP (null when none did). */
export type DataSource = "stock-detail" | "chart-candles" | "etf-quote" | null;

/**
 * Precise, user-facing reason a holding could not be (fully) enriched. Replaces
 * the old generic "data unavailable" so the user knows the row was preserved
 * and exactly why a live price is missing — never implies the row was dropped.
 */
export type UnavailableReason =
  | "No instrument match"
  | "Symbol not found"
  | "CMP unavailable"
  | "Kite quote unavailable"
  | "ETF fundamentals unavailable"
  | "Awaiting data source"
  | null;

/** Resolution metadata produced by the enrichment cascade (provenance, never fabricated). */
export interface EnrichmentMeta {
  /** Exactly what the user typed/uploaded. */
  originalSymbol: string;
  /** After normalizeSymbol(). */
  normalisedSymbol: string;
  /** Symbol the instrument search resolved to, or null. */
  resolvedSymbol: string | null;
  /** What to show in the table header (resolved if present, else original). */
  displaySymbol: string;
  exchange: string | null;
  /** index | equity | global, when resolved. */
  segment: string | null;
  instrumentType: InstrumentClass;
  /** False for ETFs/funds — fundamentals are not applicable, not "missing". */
  fundamentalsApplicable: boolean;
  dataSource: DataSource;
  /** Null when fully enriched; otherwise the precise reason live price is absent. */
  reason: UnavailableReason;
}

export interface HoldingMetrics {
  invested: number;
  currentValue: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  totalReturn: number | null;
  totalReturnPct: number | null;
  /** % of total portfolio current value. Null when current value unknown. */
  weightPct: number | null;
}

export interface PortfolioSummary {
  totalInvested: number;
  totalCurrent: number | null;
  totalReturn: number | null;
  totalReturnPct: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  holdingsCount: number;
  winners: number;
  losers: number;
  /** Approximate annualised XIRR (fraction, e.g. 0.18 = 18%). Null when not computable. */
  approxXirr: number | null;
  /** Number of holdings excluded from XIRR (missing date or current value). */
  xirrExcluded: number;
  /** Holdings with a live CMP successfully resolved. */
  enrichedCount: number;
  /** Holdings preserved but without a live CMP (shown with a precise reason). */
  missingCount: number;
  /** Total invested rupees across holdings that could not be price-enriched. */
  investedNotEnriched: number;
}

export interface SectorAllocation {
  sector: string;
  invested: number;
  currentValue: number | null;
  pnl: number | null;
  /** % of total portfolio current value. */
  weightPct: number | null;
}

export type RiskSeverity = "high" | "warn" | "info";

export interface RiskFlag {
  code: string;
  severity: RiskSeverity;
  message: string;
}

/** Neutral, review-oriented labels — the only allowed verdict vocabulary. */
export type ActionView =
  | "Strong Structure"
  | "Hold with Review"
  | "Mixed / Watch"
  | "Weak Structure"
  | "Reduce Review"
  | "Exit Review"
  | "Avoid Fresh Buy";

export interface AnalyticsResult {
  /** 0-100 composite from available signals only. Null when no live data. */
  score: number | null;
  label: ActionView | null;
  /** Factual reason text backing the label. */
  reasons: string[];
  /** Signals that were unavailable and therefore excluded from the score. */
  unavailable: string[];
  /** Score components actually used. */
  componentsUsed: string[];
  riskFlags: RiskFlag[];
}

export interface CashFlow {
  date: Date;
  amount: number;
}

/** A holding joined with its live data + derived metrics + analytics (view model). */
export interface EnrichedRow {
  raw: RawHolding;
  live: LiveMetrics;
  metrics: HoldingMetrics;
  analytics: AnalyticsResult;
  /** Provenance of the enrichment (resolved symbol, data source, reason). */
  resolution: EnrichmentMeta;
  /** True while the underlying live query is still in flight. */
  loading: boolean;
  /** True when the live query errored. */
  errored: boolean;
  /**
   * The user's manual price WHEN it was actually applied (i.e. no live CMP was
   * available and a valid manual price exists). Null otherwise — including when
   * a manual price is stored but a live quote took precedence. Lets the UI
   * label the value as a manual override rather than a live quote.
   */
  manualCmp: number | null;
}
