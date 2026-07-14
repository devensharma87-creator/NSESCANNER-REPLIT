/**
 * Swing CASH Live-Readiness — shared type & config contract (Phase 1, pure).
 *
 * Single source of truth for the swing-cash risk/validation pack. Contains ONLY
 * type/interface declarations and classification unions — no runtime logic, no
 * imports from the leaf modules (so there are no import cycles).
 *
 * ABSOLUTE RULES (enforced by the modules that consume these types):
 *   - Swing CASH / equity ONLY. Never touches F&O engine/risk/scoring/option-chain/
 *     capital-ledger/F&O paper.
 *   - No live broker orders. Live execution stays hard-disabled by default.
 *   - No Yahoo / delayed data is ever "trade-grade".
 *   - Missing data is labelled (UNAVAILABLE / REVIEW_REQUIRED), never fabricated.
 */

// ===========================================================================
// Modes
// ===========================================================================

export type SwingCashMode =
  | "paper_only"
  | "live_dry_run"
  | "live_staged_approval"
  | "live_auto_small_size";

export type SwingCashSeverity = "info" | "warn" | "block";

// ===========================================================================
// Part B — Data trust
// ===========================================================================

export type SwingCashDataSource =
  | "kite"
  | "licensed"
  | "yahoo"
  | "indstocks"
  | "unknown";

export type SwingCashDataClassification =
  | "TRADE_GRADE_KITE"
  | "TRADE_GRADE_LICENSED"
  | "INFO_ONLY_YAHOO"
  | "STALE"
  | "UNAVAILABLE"
  | "UNTRUSTED";

export interface SwingCashDataTrustConfig {
  /** Max age of the latest daily candle before it is STALE (ms). */
  dailyMaxAgeMs: number;
  /** Max age of the latest LTP/intraday quote before it is STALE (ms). */
  ltpMaxAgeMs: number;
  /** Sources accepted as trade-grade. Default: kite + licensed only. */
  tradeGradeSources: SwingCashDataSource[];
  /** Require benchmark data for full auto-execution (else REVIEW_REQUIRED). */
  requireBenchmark: boolean;
  /** Require sector classification for full auto-execution (else REVIEW_REQUIRED). */
  requireSector: boolean;
}

export interface SwingCashDataInput {
  symbol: string;
  dataSource: SwingCashDataSource | string | null;
  ltp: number | null;
  ohlc: { open: number; high: number; low: number; close: number } | null;
  dailyCandleAsOfMs: number | null;
  ltpAsOfMs: number | null;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  benchmarkAvailable?: boolean;
  sectorAvailable?: boolean;
  nowMs: number;
}

export interface SwingCashDataTrustResult {
  classification: SwingCashDataClassification;
  /** True only for fresh, complete TRADE_GRADE_KITE / TRADE_GRADE_LICENSED data. */
  trustedForTrade: boolean;
  /** True when data is trade-grade but missing benchmark/sector → needs manual review. */
  reviewRequired: boolean;
  stale: boolean;
  fallbackUsed: boolean;
  missingFields: string[];
  reasons: string[];
  metrics: {
    dailyAgeSec: number | null;
    ltpAgeSec: number | null;
    dailyStale: boolean;
    ltpStale: boolean;
  };
}

// ===========================================================================
// Part C — Entry validity / freshness
// ===========================================================================

export type SwingCashEntryClassification =
  | "ENTRY_VALID_NOW"
  | "ENTRY_WAITING_FOR_TRIGGER"
  | "ENTRY_ALREADY_CHASED"
  | "ENTRY_STALE"
  | "ENTRY_TOO_CLOSE_TO_TARGET"
  | "ENTRY_TOO_CLOSE_TO_STOP"
  | "ENTRY_RR_TOO_LOW"
  | "ENTRY_INVALID_DATA"
  | "ENTRY_REVIEW_REQUIRED";

export interface SwingCashEntryConfig {
  /** Signal older than this (calendar days) → ENTRY_STALE. */
  maxSignalAgeDays: number;
  /** LTP above entry by more than this × ATR → ENTRY_ALREADY_CHASED. */
  maxChaseAtrMultiple: number;
  /** Fallback chase threshold as % of entry when ATR is unavailable. */
  maxChasePctOfEntry: number;
  /** LTP within this % of target1 → ENTRY_TOO_CLOSE_TO_TARGET. */
  minDistToTargetPct: number;
  /** LTP within this % above stop → ENTRY_TOO_CLOSE_TO_STOP. */
  minDistToStopPct: number;
  /** Remaining R:R (from current LTP) below this → ENTRY_RR_TOO_LOW. */
  minRR: number;
}

export interface SwingCashEntryInput {
  entry: number;
  stop: number;
  target1: number;
  ltp: number;
  atr: number | null;
  entryZoneLow?: number | null;
  entryZoneHigh?: number | null;
  signalAgeDays?: number | null;
  validityExpiryMs?: number | null;
  nowMs?: number | null;
  /** Whether the intraday trigger has already fired (price entered the zone). */
  triggered?: boolean;
}

export interface SwingCashEntryResult {
  classification: SwingCashEntryClassification;
  /** True only for ENTRY_VALID_NOW (safe to stage). */
  validForStaging: boolean;
  /** True for ENTRY_WAITING_FOR_TRIGGER (watch queue, valid but not yet triggered). */
  watchOnly: boolean;
  reasons: string[];
  metrics: {
    pctFromEntry: number | null;
    pctToTarget1: number | null;
    pctAboveStop: number | null;
    atrDistance: number | null;
    rrNow: number | null;
    signalAgeDays: number | null;
  };
}

// ===========================================================================
// Part F — Liquidity / execution
// ===========================================================================

export type SwingCashLiquidityClassification =
  | "LIQUIDITY_OK"
  | "LOW_TRADED_VALUE"
  | "LOW_VOLUME"
  | "HIGH_SPREAD"
  | "CIRCUIT_RISK"
  | "ASM_GSM_RISK"
  | "ASM_GSM_UNAVAILABLE_REVIEW_REQUIRED"
  | "LIQUIDITY_DATA_UNAVAILABLE";

export interface SwingCashLiquidityConfig {
  /** Minimum average daily traded value (₹). */
  minAvgTradedValue: number;
  /** Minimum average daily volume (shares). */
  minVolume: number;
  /** Maximum acceptable bid/ask spread (%). */
  maxSpreadPct: number;
  /** Warn (not block) when delivery % is below this. */
  minDeliveryPct: number;
  /** Block when the symbol is under ASM/GSM surveillance (when known). */
  blockOnAsmGsm: boolean;
  /** Block when circuit risk is flagged (when known). */
  blockOnCircuit: boolean;
}

export interface SwingCashLiquidityInput {
  avgTradedValue: number | null;
  volume: number | null;
  spreadPct: number | null;
  deliveryPct: number | null;
  /** null = surveillance status unavailable → review required (never fabricated). */
  asmGsmStatus: "NONE" | "ASM" | "GSM" | null;
  /** null = circuit data unavailable. */
  circuitRisk: boolean | null;
}

export interface SwingCashLiquidityResult {
  classification: SwingCashLiquidityClassification;
  tradeable: boolean;
  reviewRequired: boolean;
  warnings: string[];
  reasons: string[];
  metrics: {
    avgTradedValue: number | null;
    spreadPct: number | null;
    deliveryPct: number | null;
  };
}

// ===========================================================================
// Part H — Event / result / corporate-action risk
// ===========================================================================

export type SwingCashEventClassification =
  | "EVENT_CLEAR"
  | "RESULT_DAY"
  | "RESULT_WITHIN_3_DAYS"
  | "CORPORATE_ACTION_RISK"
  | "CORPORATE_ACTION_UNAVAILABLE_REVIEW_REQUIRED"
  | "RESULT_DATE_UNKNOWN_REVIEW_REQUIRED"
  | "NEWS_RISK_UNAVAILABLE"
  | "EVENT_DATA_UNAVAILABLE_REVIEW_REQUIRED";

export interface SwingCashEventRiskConfig {
  /** Block/warn when days-to-result ≤ this (excludes result day itself). */
  resultWithinDaysBlock: number;
  /** Block fresh entry on result day. */
  blockOnResultDay: boolean;
  /** Block on major corporate-action uncertainty. */
  blockOnCorporateAction: boolean;
  /** When event data is unavailable, require manual approval for live mode. */
  requireApprovalWhenUnavailable: boolean;
}

export interface SwingCashEventRiskInput {
  /** Calendar days to next result; null = unknown. */
  daysToResult: number | null;
  isResultDay?: boolean;
  /** null = corporate-action data unavailable. */
  corporateActionRisk?: boolean | null;
  eventDataAvailable: boolean;
  /**
   * Explicit affirmation that this symbol's result/earnings schedule is KNOWN
   * and complete (so daysToResult/isResultDay are authoritative). Anything other
   * than `true` (false/undefined) means the result window cannot be proven clear
   * → REVIEW_REQUIRED. Never inferred from a null daysToResult.
   */
  resultScheduleKnown?: boolean;
  newsRiskAvailable: boolean;
}

export interface SwingCashEventRiskResult {
  classification: SwingCashEventClassification;
  clear: boolean;
  blocked: boolean;
  reviewRequired: boolean;
  reasons: string[];
}

// ===========================================================================
// Part G — Sector / single-stock exposure
// ===========================================================================

export interface SwingCashExposureConfig {
  maxSectorExposurePct: number;
  maxSingleStockExposurePct: number;
  blockDuplicate: boolean;
  blockConsecutiveDaySameStock: boolean;
  /** Warn when open positions in the same sector reach this count. */
  sectorCrowdedWarnCount: number;
}

export interface SwingCashExposureInput {
  symbol: string;
  sector: string | null;
  proposedPositionValue: number;
  totalSwingCapital: number;
  /** ₹ already deployed in this sector across open positions. */
  currentSectorExposureValue: number;
  /** ₹ already deployed in this exact symbol across open positions. */
  currentSingleStockExposureValue: number;
  openPositionSymbols: string[];
  sectorOpenCount: number;
  /** Last IST date (YYYY-MM-DD) an entry was opened for this symbol; null if none. */
  lastEntryDateForSymbolIst?: string | null;
  /** Today's IST date (YYYY-MM-DD). */
  todayIst: string;
}

export interface SwingCashExposureResult {
  allowed: boolean;
  /** True when a numeric input/config was non-finite/negative so caps could not
   *  be computed — fail-closed hard block, never a silent pass. */
  inputInvalid: boolean;
  reasons: string[];
  warnings: string[];
  metrics: {
    sectorExposureAfterPct: number;
    singleStockExposureAfterPct: number;
    duplicate: boolean;
    consecutiveDay: boolean;
  };
}

// ===========================================================================
// Part E — Risk-based position sizing
// ===========================================================================

export type SwingCashSizingReason =
  | "SIZING_INPUT_INVALID"
  | "RISK_PER_SHARE_INVALID"
  | "INSUFFICIENT_CASH"
  | "POSITION_TOO_SMALL"
  | "QTY_LT_1";

export interface SwingCashSizingConfig {
  /** Risk per trade as % of total swing capital. */
  riskPerTradePct: number;
  /** Absolute ₹ cap on risk per trade. */
  maxRiskPerTrade: number;
  /** Max position value as % of total swing capital. */
  maxPositionValuePct: number;
  /** Keep this % of available cash unused (reserve). */
  reserveCashPct: number;
  /** Pad entry by this % when checking affordability (slippage buffer). */
  slippageBufferPct: number;
  /** Extra max-loss buffer for overnight gap risk (% of entry). */
  gapBufferPct: number;
  /** Minimum position value (₹) worth trading; below → POSITION_TOO_SMALL. */
  minPositionValue: number;
  /** Tradeable lot (1 for cash equity). */
  lotSize: number;
}

export interface SwingCashSizingInput {
  entry: number;
  stop: number;
  totalSwingCapital: number;
  availableCash: number;
}

export interface SwingCashSizingResult {
  allowed: boolean;
  reason: SwingCashSizingReason | null;
  qty: number;
  capitalRequired: number;
  riskPerShare: number;
  maxLoss: number;
  maxLossWithGap: number;
  riskPct: number;
  positionValuePct: number;
  detail: string;
  workings: {
    riskAmount: number;
    qtyByRisk: number;
    qtyByValue: number;
    qtyByCash: number;
    maxPositionValue: number;
    deployableCash: number;
  };
}

// ===========================================================================
// Part N — Cost / slippage model (cash delivery)
// ===========================================================================

export interface SwingCashCostConfig {
  /** Flat brokerage per order (₹). Delivery is often 0 on discount brokers. */
  brokeragePerOrder: number;
  /** Brokerage as % of turnover (0 for zero-brokerage delivery). */
  brokeragePct: number;
  /** STT % applied per side for delivery (buy + sell). */
  sttPct: number;
  /** Exchange transaction charge % of turnover (per side). */
  exchangeTxnPct: number;
  /** SEBI turnover charge % (per side). */
  sebiPct: number;
  /** Stamp duty % on buy turnover. */
  stampDutyPctBuy: number;
  /** GST % on (brokerage + exchange txn + SEBI). */
  gstPct: number;
  /** Flat DP charge per sell (₹). */
  dpChargePerSell: number;
  /** Assumed slippage % per side. */
  slippagePct: number;
  /** Gap-risk buffer % (informational, surfaced for transparency). */
  gapBufferPct: number;
}

export interface SwingCashCostInput {
  entry: number;
  target: number;
  stop: number;
  qty: number;
  minRR: number;
}

export interface SwingCashCostResult {
  grossTargetProfit: number;
  estimatedCharges: number;
  estimatedSlippage: number;
  netTargetProfit: number;
  grossRisk: number;
  expectedRGross: number;
  expectedRAfterCost: number;
  passesMinRR: boolean;
  breakdown: {
    brokerage: number;
    stt: number;
    exchangeTxn: number;
    sebi: number;
    stampDuty: number;
    gst: number;
    dpCharge: number;
  };
}

// ===========================================================================
// Part D — Composed decision
// ===========================================================================

export type SwingCashBlockReason =
  | "DATA_NOT_TRADE_GRADE"
  | "DATA_STALE"
  | "DATA_UNAVAILABLE"
  | "ENTRY_NOT_VALID_NOW"
  | "ENTRY_CHASED"
  | "ENTRY_STALE"
  | "ENTRY_TOO_CLOSE_TO_TARGET"
  | "ENTRY_TOO_CLOSE_TO_STOP"
  | "ENTRY_RR_TOO_LOW"
  | "ENTRY_INVALID_DATA"
  | "LOW_LIQUIDITY"
  | "ASM_GSM_RISK"
  | "CIRCUIT_RISK"
  | "EVENT_RISK_RESULT_DAY"
  | "EVENT_RISK_RESULT_SOON"
  | "EVENT_RISK_CORPORATE_ACTION"
  | "SECTOR_EXPOSURE_EXCEEDED"
  | "SINGLE_STOCK_EXPOSURE_EXCEEDED"
  | "EXPOSURE_INPUT_INVALID"
  | "DUPLICATE_POSITION"
  | "CONSECUTIVE_DAY_STACKING"
  | "MAX_OPEN_POSITIONS"
  | "MAX_DAILY_ENTRIES"
  | "MAX_WEEKLY_ENTRIES"
  | "PORTFOLIO_STATE_INVALID"
  | "INSUFFICIENT_CASH"
  | "POSITION_TOO_SMALL"
  | "SIZING_INPUT_INVALID"
  | "RISK_PER_SHARE_INVALID"
  | "MAX_RISK_PER_TRADE_EXCEEDED"
  | "RR_AFTER_COST_TOO_LOW";

export interface SwingCashRiskConfig {
  mode: SwingCashMode;
  minRR: number;
  /** Live capital is capped to this % of total swing capital; sizing + exposure
   *  use the live-capital base (NOT the full book) so live readiness starts small. */
  liveCapitalCapPct: number;
  maxOpenPositions: number;
  maxDailyEntries: number;
  maxWeeklyEntries: number;
  requireManualApproval: boolean;
  blockIfKiteOffline: boolean;
  blockIfDataStale: boolean;
  blockOnEventRisk: boolean;
  blockOnLowLiquidity: boolean;
  blockOnWeakRR: boolean;
  dataTrust: SwingCashDataTrustConfig;
  entry: SwingCashEntryConfig;
  liquidity: SwingCashLiquidityConfig;
  eventRisk: SwingCashEventRiskConfig;
  exposure: SwingCashExposureConfig;
  sizing: SwingCashSizingConfig;
  cost: SwingCashCostConfig;
}

export interface SwingCashCandidate {
  symbol: string;
  sector: string | null;
  // Immutable swing plan (from existing scanner — never recomputed here).
  entry: number;
  stop: number;
  target1: number;
  target2: number | null;
  atr: number | null;
  ltp: number;
  rr: number | null;
  // Data trust inputs.
  dataSource: SwingCashDataSource | string | null;
  ohlc: { open: number; high: number; low: number; close: number } | null;
  dailyCandleAsOfMs: number | null;
  ltpAsOfMs: number | null;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  benchmarkAvailable?: boolean;
  sectorAvailable?: boolean;
  // Entry freshness inputs.
  entryZoneLow?: number | null;
  entryZoneHigh?: number | null;
  signalAgeDays?: number | null;
  validityExpiryMs?: number | null;
  triggered?: boolean;
  // Liquidity inputs.
  avgTradedValue?: number | null;
  volume?: number | null;
  spreadPct?: number | null;
  deliveryPct?: number | null;
  asmGsmStatus?: "NONE" | "ASM" | "GSM" | null;
  circuitRisk?: boolean | null;
  // Event inputs.
  daysToResult?: number | null;
  isResultDay?: boolean;
  corporateActionRisk?: boolean | null;
  eventDataAvailable?: boolean;
  /** Explicit affirmation the result schedule is known; otherwise → review. */
  resultScheduleKnown?: boolean;
  newsRiskAvailable?: boolean;
  nowMs: number;
}

export interface SwingCashPortfolioState {
  totalSwingCapital: number;
  availableCash: number;
  openPositionSymbols: string[];
  /** ₹ deployed per sector across open positions. */
  sectorExposureValueBySector: Record<string, number>;
  /** ₹ deployed per symbol across open positions. */
  singleStockExposureValueBySymbol: Record<string, number>;
  /** Open-position count per sector. */
  sectorOpenCountBySector: Record<string, number>;
  /** Last IST entry date per symbol (YYYY-MM-DD). */
  lastEntryDateBySymbolIst?: Record<string, string>;
  todayIst: string;
  dailyEntriesUsed: number;
  weeklyEntriesUsed: number;
  openPositionsCount: number;
}

export interface SwingCashRiskDecision {
  /** True only when every hard gate passes. In paper/dry-run modes this never
   *  results in a live order — it only signals stage-ability. */
  allowed: boolean;
  mode: SwingCashMode;
  severity: SwingCashSeverity;
  /** True when something needs manual owner review before live action. */
  reviewRequired: boolean;
  /** Hard-block reasons only. */
  reasons: SwingCashBlockReason[];
  warnings: string[];
  explanation: string[];
  metrics: {
    qty: number;
    capitalRequired: number;
    maxLoss: number;
    maxLossWithGap: number;
    riskPct: number;
    positionValuePct: number;
    rr: number | null;
    rrAfterCost: number | null;
    netTargetProfit: number | null;
    sectorExposureAfterPct: number | null;
    singleStockExposureAfterPct: number | null;
    stopDistancePct: number | null;
    dataClassification: SwingCashDataClassification;
    entryClassification: SwingCashEntryClassification;
    liquidityClassification: SwingCashLiquidityClassification;
    eventClassification: SwingCashEventClassification;
  };
  gates: {
    dataTrust: SwingCashDataTrustResult;
    entry: SwingCashEntryResult;
    liquidity: SwingCashLiquidityResult;
    eventRisk: SwingCashEventRiskResult;
    exposure: SwingCashExposureResult;
    sizing: SwingCashSizingResult;
    cost: SwingCashCostResult;
  };
}
