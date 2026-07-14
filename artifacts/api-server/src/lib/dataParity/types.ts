/**
 * Checkpoint 3 — Data Parity API contract types.
 *
 * Pure, side-effect-free types + a static module-applicability registry.
 * Stateless: nothing here persists to the DB. A "parity check" is a single
 * point-in-time snapshot comparing how each already-existing module currently
 * sees a symbol/index — it never fetches fresh data itself and never mutates
 * any module's state.
 *
 * ABSOLUTE RULES (mirrors the rest of the market-data layer):
 *   - Never fabricate a price/asOf. A module that cannot be read cleanly
 *     produces an explicit `status: "UNAVAILABLE"` observation.
 *   - This is diagnostic-only. It does not change, migrate, or influence any
 *     consumer's data path, trading logic, or thresholds.
 */

import type { ProviderName, TrustTier } from "../marketData/types";

/** Stable identifiers for the 13 observable modules (Infra Health is the
 *  consumer surface that renders results — it is not itself observed). */
export type DataParityModuleId =
  | "router"
  | "reportGrade"
  | "scanner"
  | "watchlist"
  | "portfolio"
  | "paperEq"
  | "swingQueue"
  | "charting"
  | "diagnostics"
  | "fno"
  | "optionChain"
  | "dailyReports"
  | "globalHealth";

export const DATA_PARITY_MODULE_LABELS: Record<DataParityModuleId, string> = {
  router: "Canonical Router",
  reportGrade: "Report-Grade Index Quotes",
  scanner: "Scanner",
  watchlist: "Watchlist",
  portfolio: "Portfolio",
  paperEq: "Paper Trading (EQ)",
  swingQueue: "Swing Queue",
  charting: "Charting",
  diagnostics: "Stock Intelligence",
  fno: "F&O Diagnostics",
  optionChain: "Option Chain Spot",
  dailyReports: "Pre/Post-Market Reports",
  globalHealth: "Global Data Health",
};

export type DataParityAssetType = "index" | "equity";

/**
 * How this observation's freshness policy should be compared against others.
 * Comparisons ACROSS classes are inherently apples-to-oranges (e.g. a
 * report-grade same-day quote vs. a 10-min trade-grade quote) so the
 * classifier caps cross-class severity — see classify.ts.
 */
export type DataParityFreshnessClass =
  | "trade_grade" // authoritative, fresh, validated (router / fno / optionChain live spot)
  | "report_grade" // looser same-day-accept policy (reportGrade, dailyReports)
  | "cache" // last-known scanner/watchlist/paperEq cache row, no freshness guarantee
  | "frozen" // price frozen at a past decision instant (swing queue staged plan)
  | "not_applicable"; // health rollups / no price concept

export type DataParityObservationKind =
  | "quote"
  | "candle_close"
  | "frozen_plan"
  | "health"
  | "not_applicable";

export type DataParityObservationStatus = "OK" | "UNAVAILABLE";

export interface DataParityObservation {
  moduleId: DataParityModuleId;
  moduleLabel: string;
  symbol: string;
  assetType: DataParityAssetType;
  status: DataParityObservationStatus;
  /** Populated only when status === "UNAVAILABLE". Never fabricated. */
  reason: string | null;
  kind: DataParityObservationKind;
  freshnessClass: DataParityFreshnessClass;
  price: number | null;
  asOf: string | null;
  freshnessSec: number | null;
  source: ProviderName | "n/a";
  trustTier: TrustTier | null;
  /** True/false when the module has an explicit trade-grade concept; null
   *  when the module has no such concept (e.g. health rollups). */
  tradeGrade: boolean | null;
  /** When this observation was captured — shared per-request across all
   *  observations produced by one /data-parity call. */
  capturedAt: string;
}

export type DataParitySeverity = "P0" | "P1" | "P2" | "INFO";

export type DataParityMismatchKind =
  | "PRICE_DIVERGENCE"
  | "STALENESS_DIVERGENCE"
  | "SOURCE_DIVERGENCE"
  | "TRADE_GRADE_DIVERGENCE"
  | "MODULE_UNAVAILABLE";

export interface DataParityMismatch {
  severity: DataParitySeverity;
  kind: DataParityMismatchKind;
  moduleA: DataParityModuleId;
  moduleB: DataParityModuleId;
  valueA: number | string | boolean | null;
  valueB: number | string | boolean | null;
  description: string;
}

export type DataParityOverallSeverity = DataParitySeverity | "OK";

export interface DataParityResult {
  symbol: string;
  assetType: DataParityAssetType;
  capturedAt: string;
  observations: DataParityObservation[];
  mismatches: DataParityMismatch[];
  overallSeverity: DataParityOverallSeverity;
}

/**
 * Module-applicability registry. Indices are never checked against
 * equity-only holding/indicator modules (Portfolio holdings, Watchlist
 * indicators, Paper EQ, Swing Queue, Stock Intelligence) and equities are
 * never checked against index-only F&O modules (F&O diagnostics is
 * NIFTY/BANKNIFTY/SENSEX-only — see `OPTION_INDICES` in optionSignals.ts).
 */
export const INDEX_MODULES: readonly DataParityModuleId[] = [
  "router",
  "reportGrade",
  "charting",
  "fno",
  "optionChain",
  "dailyReports",
  "globalHealth",
];

export const EQUITY_MODULES: readonly DataParityModuleId[] = [
  "router",
  "scanner",
  "watchlist",
  "portfolio",
  "paperEq",
  "swingQueue",
  "charting",
  "diagnostics",
  "optionChain",
  "globalHealth",
];

export function modulesFor(assetType: DataParityAssetType): readonly DataParityModuleId[] {
  return assetType === "index" ? INDEX_MODULES : EQUITY_MODULES;
}

/** The five canonical test symbols named in the Checkpoint 3 spec. */
export const DATA_PARITY_TEST_SYMBOLS: ReadonlyArray<{ symbol: string; assetType: DataParityAssetType }> = [
  { symbol: "INDUSINDBK", assetType: "equity" },
  { symbol: "RELIANCE", assetType: "equity" },
  { symbol: "NIFTY", assetType: "index" },
  { symbol: "BANKNIFTY", assetType: "index" },
  { symbol: "SENSEX", assetType: "index" },
];

/** Maps a canonical index display symbol to the Yahoo-style key used by
 *  `getIndexQuote`/`getReportGradeIndexQuotes` (REPORT_INDEX_KEYS). */
export const INDEX_KEY_MAP: Record<string, string> = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  SENSEX: "^BSESN",
};
