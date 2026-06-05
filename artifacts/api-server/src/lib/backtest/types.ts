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
 *   - Nothing here ever invents option prices, IV, or OI.
 */

export type BacktestMode = "REAL_REPLAY" | "DIRECTIONAL";
export type BacktestInstrument = "NIFTY" | "BANKNIFTY" | "SENSEX" | "ALL";

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
}
