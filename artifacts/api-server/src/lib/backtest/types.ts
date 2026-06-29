/**
 * Backtest Lab — shared output types (mirror the OpenAPI DTOs in
 * lib/api-spec/openapi.yaml). Pure data shapes, no runtime deps.
 *
 * HONESTY CONTRACT for the whole Backtest Lab:
 *   - Mode A (REAL_REPLAY) emits ONLY trades whose option exit premium was
 *     genuinely captured by the live engine (STOPPED / TARGET hits). Signals
 *     that merely expired/went stale have NO captured option exit and are
 *     reported as such — never assigned a fabricated P&L.
 *   - Mode B (DIRECTIONAL) has NO historical option premiums. Option P&L is a
 *     clearly-LABELED delta proxy on the REAL spot move. Every modeled field is
 *     flagged via `modeled: true` + listed in dataQuality.modeledFields.
 *   - Mode D (SNAPSHOT_PREMIUM_REPLAY) prices directional trades from REAL
 *     captured option_chain_snapshot rows. Every premium is traceable to a
 *     specific captured_at row. When no real premium exists, the trade is
 *     explicitly flagged (BLACK_SCHOLES_MODELLED or UNAVAILABLE) — never
 *     silently proxied.
 *   - Nothing here ever invents option prices, IV, or OI.
 */

export type BacktestMode = "REAL_REPLAY" | "DIRECTIONAL";
export type BacktestInstrument = "NIFTY" | "BANKNIFTY" | "SENSEX" | "ALL";

// ---------------------------------------------------------------------------
// Stage 4 — Snapshot Premium Replay types
// ---------------------------------------------------------------------------

/**
 * Explicit pricing mode carried by every SNAPSHOT_PREMIUM_REPLAY trade.
 * The mode is the source of truth for what the P&L number means.
 *
 *   REAL_CAPTURED_PREMIUM  — entry AND exit both priced from a real snapshot
 *                             within REPLAY_ENTRY_TOLERANCE_MIN minutes.
 *   REAL_PARTIAL           — one leg real, the other BS-modelled or nearest.
 *   BLACK_SCHOLES_MODELLED — priced from captured IV + Black-Scholes when
 *                             LTP/mid was missing but IV was present.
 *   SYNTHETIC_DELTA_PROXY  — the existing ATM Δ≈0.5 proxy (unchanged).
 *   UNAVAILABLE            — no usable data; trade excluded from ₹ P&L.
 */
export type PricingMode =
  | "REAL_CAPTURED_PREMIUM"
  | "REAL_PARTIAL"
  | "BLACK_SCHOLES_MODELLED"
  | "SYNTHETIC_DELTA_PROXY"
  | "UNAVAILABLE";

/** Itemised F&O round-trip cost breakdown for one trade. */
export interface FnoCostBreakdown {
  /** Flat brokerage per order × 2 (entry + exit). ₹ */
  brokerage: number;
  /** STT on the exit (sell) leg: 0.05% of exit premium × qty. ₹ */
  stt: number;
  /** Exchange transaction charge on both legs (NSE rate). ₹ */
  exchangeTxn: number;
  /** SEBI charges on both legs. ₹ */
  sebiCharges: number;
  /** 18% GST on (brokerage + exchangeTxn + sebiCharges). ₹ */
  gst: number;
  /** Stamp duty on buy leg: 0.003% of entry premium × qty. ₹ */
  stampDuty: number;
  /** Bid-ask spread cost (half-spread × qty × 2) when real spread available. Null when not. ₹ */
  spreadCost: number | null;
  /** true when no real spread was available and a default half-spread was used. */
  spreadModelled: boolean;
  /** Sum of all above items. ₹ */
  total: number;
}

/** Mode-mix summary for a SNAPSHOT_PREMIUM_REPLAY run. */
export interface BacktestPricingModeMix {
  realCaptured: number;
  realPartial: number;
  bsModelled: number;
  syntheticDeltaProxy: number;
  unavailable: number;
  total: number;
  /** (realCaptured + realPartial + bsModelled) / total × 100. */
  coveragePct: number;
  /** true when coveragePct < REPLAY_MIN_COVERAGE_PCT. */
  lowCoverage: boolean;
  /** Human-readable flag string when lowCoverage=true. Null otherwise. */
  coverageFlag: string | null;
}

/** Per-underlying detail from a snapshot coverage query. */
export interface SnapshotUnderlyingCoverage {
  underlying: string;
  earliest: string | null;
  latest: string | null;
  capturedBuckets: number;
  expectedBuckets: number;
  coveragePct: number;
  expiries: string[];
  hasData: boolean;
}

export interface BacktestTradeOut {
  id: string;
  indexSymbol: string;
  setupKey: string | null;
  setupName: string | null;
  direction: string;
  optionType: string | null;
  strike: number | null;
  entryAt: string | null;
  exitAt: string | null;
  entrySpot: number | null;
  exitSpot: number | null;
  optionEntry: number | null;
  optionExit: number | null;
  optionStop: number | null;
  optionTarget1: number | null;
  optionTarget2: number | null;
  lots: number | null;
  lotSize: number | null;
  qty: number | null;
  pnl: number | null;
  exitReason: string | null;
  confidence: number | null;
  tier: string | null;
  regime: string | null;
  /** true = DIRECTIONAL delta-proxy fill; false = REAL_REPLAY real fill. */
  modeled: boolean;
  maxFavorableExcursion: number | null;
  maxAdverseExcursion: number | null;
  // ---- V2 Strategy-Research attribution (null for Official-engine trades) ----
  backtestMode?: string | null;
  strategyId?: string | null;
  strategyName?: string | null;
  strategyCategory?: string | null;
  signalSource?: string | null;
  strategyParams?: Record<string, unknown> | null;
  confirmationFilters?: string[] | null;
  strategyConfidence?: number | null;
  historicalSetupMatch?: string | null;
  passedConditions?: string[] | null;
  failedConditions?: string[] | null;
  // ---- Stage 4: Snapshot Premium Replay fields (null for other modes) ------
  pricingMode?: PricingMode | null;
  /** ISO timestamp of the snapshot used for entry, or "modelled"/"unavailable". */
  entryPremiumSource?: string | null;
  /** ISO timestamp of the snapshot used for exit, or "modelled"/"unavailable". */
  exitPremiumSource?: string | null;
  /** IV from the entry snapshot (null when not captured). */
  entryIv?: number | null;
  /** Delta from the entry snapshot (null when not captured). */
  entryDelta?: number | null;
  /** Theta from the entry snapshot (null when not captured). */
  entryTheta?: number | null;
  /** Gross P&L before F&O costs (null = UNAVAILABLE trade). */
  grossPnl?: number | null;
  /** Itemised cost breakdown (null for non-SNAPSHOT_PREMIUM_REPLAY trades). */
  costs?: FnoCostBreakdown | null;
  /** Net P&L after F&O costs (null = UNAVAILABLE trade). */
  netPnl?: number | null;
  /** true when both entry AND exit snapshots were within REPLAY_ENTRY_TOLERANCE_MIN. */
  withinTolerance?: boolean | null;
}

export interface BacktestBlockedOut {
  id: string;
  indexSymbol: string;
  setupKey: string | null;
  direction: string | null;
  decision: string | null;
  reasonCode: string | null;
  confidence: number | null;
  confluenceScore: number | null;
  regime: string | null;
  count: number;
  note: string | null;
  // ---- V2 Strategy-Research attribution (null for Official-engine blocks) ----
  strategyId?: string | null;
  strategyName?: string | null;
  signalSource?: string | null;
  failedCondition?: string | null;
  blockedRule?: string | null;
  /** FILTER | RISK | DATA — buckets the comparison's rejected/risk/data counts. */
  category?: string | null;
}

export interface BacktestEquityPoint {
  t: string;
  equity: number;
  drawdown: number | null;
}

export interface BacktestInstrumentStat {
  instrument: string;
  trades: number;
  pnl: number;
  winRate: number | null;
}

export interface BacktestSummaryOut {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  totalPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  avgTradePnl: number | null;
  expectancy: number | null;
  maxDrawdown: number;
  returnPct: number | null;
  longTrades: number;
  shortTrades: number;
  bestTradePnl: number | null;
  worstTradePnl: number | null;
  byInstrument: BacktestInstrumentStat[];
  equityCurve: BacktestEquityPoint[];
  /** Stage 4: Total gross P&L (pre-costs) — only for SNAPSHOT_PREMIUM_REPLAY. */
  totalGrossPnl?: number | null;
  /** Stage 4: Total F&O costs across all priced trades. */
  totalCosts?: number | null;
  /** Stage 4: Total net P&L (post-costs) — equals totalPnl for this mode. */
  totalNetPnl?: number | null;
}

export interface BacktestCoverageWindow {
  from: string | null;
  to: string | null;
  count: number;
}

export interface BacktestSnapshotCoverageOut {
  earliest: string | null;
  latest: string | null;
  count: number;
  underlyings: string[];
}

export interface BacktestDataQualityOut {
  mode: string;
  candleCoverage: BacktestCoverageWindow | null;
  optionDataAvailable: boolean;
  ivAvailable: boolean;
  oiAvailable: boolean;
  snapshotCoverage: BacktestSnapshotCoverageOut | null;
  modeledFields: string[];
  warnings: string[];
  notes: string[];
  /** Stage 4: Pricing mode mix — only present for SNAPSHOT_PREMIUM_REPLAY runs. */
  pricingModeMix?: BacktestPricingModeMix | null;
  /** Stage 4: Per-underlying detailed coverage — only for SNAPSHOT_PREMIUM_REPLAY. */
  underlyingCoverage?: SnapshotUnderlyingCoverage[] | null;
}

// ---------------------------------------------------------------------------
// V2 — Strategy Research catalog + comparison
// ---------------------------------------------------------------------------

export interface BacktestStrategyMetaOut {
  id: string;
  name: string;
  category: string;
  bestCondition: string;
  suitableIndices: string[];
  recommendedTimeframes: string[];
  riskLevel: string;
  description: string;
  /** Confirmation filters this strategy ignores by design (e.g. range plays ignore VWAP/EMA-trend). */
  ignoredFilters: string[];
  /**
   * Short human-readable rationale for WHY this strategy ignores the filters above
   * (e.g. "range plays ignore VWAP/EMA-trend because they trade mean-reversion, not
   * trend"). Empty string when the strategy ignores nothing.
   */
  ignoredFiltersRationale: string;
  defaultParams: Record<string, number>;
}

/** One row of the comparison table — per (strategy × index). */
export interface BacktestComparisonRowOut {
  strategyId: string;
  strategyName: string;
  indexSymbol: string;
  timeframe: string;
  /** Confirmation filters this strategy ignores by design (subset of the run's filters). */
  ignoredFilters: string[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number | null;
  grossPnl: number;
  charges: number;
  slippage: number;
  netPnl: number;
  profitFactor: number | null;
  avgR: number | null;
  maxDrawdown: number;
  bestTrade: number | null;
  worstTrade: number | null;
  avgHoldingMinutes: number | null;
  target1HitCount: number;
  target2HitCount: number;
  slHitCount: number;
  timeExitCount: number;
  rejectedSetupCount: number;
  dataBlockedCount: number;
  riskBlockedCount: number;
}

/** Per-strategy aggregate (across all selected indices) used for ranking. */
export interface BacktestStrategyAggregateOut {
  strategyId: string;
  strategyName: string;
  /** Confirmation filters this strategy ignores by design (subset of the run's filters). */
  ignoredFilters: string[];
  totalTrades: number;
  winRate: number | null;
  netPnl: number;
  profitFactor: number | null;
  maxDrawdown: number;
  avgR: number | null;
  /** Stability = mean per-trade net ÷ stdev of per-trade net (higher = steadier); null when <2 trades. */
  consistency: number | null;
  /** Executed ÷ (executed + data-blocked) — how much of the strategy's edge survived data gaps; null when no opportunities. */
  dataQuality: number | null;
  /** Multi-factor composite score (0–100), null when not enough trades to rank. */
  compositeScore: number | null;
  eligible: boolean;
}

export interface BacktestRankingCardOut {
  key: string;
  label: string;
  strategyId: string | null;
  strategyName: string | null;
  value: string | null;
  note: string | null;
}

export interface BacktestStrategyComparisonOut {
  rows: BacktestComparisonRowOut[];
  byStrategy: BacktestStrategyAggregateOut[];
  ranking: BacktestRankingCardOut[];
  notes: string[];
}
