/**
 * Central market-data layer — public barrel.
 *
 * Trusted consumers (scanner, watchlist, signals, valuation, F&O) should import
 * the router + guard from here. Analytics consumers (global assets, VIX
 * fallback, portfolio benchmarks) use `analyticsYahoo`. Nothing else should
 * import the raw Kite/Yahoo modules for trusted data.
 */

export * from "./types";
export {
  getPolicy,
  isTierTradeable,
  type MarketDataPolicy,
  type ProviderPolicy,
  type ProviderRole,
} from "./policy";
export { computeFreshness, type Freshness } from "./freshness";
export { TtlCache, type CacheEntry } from "./caches";
export {
  validateQuotePair,
  VALIDATION_TOLERANCES,
  type ValidationResult,
  type CrossVerdict,
  type FieldComparison,
} from "./sourceValidation";
export {
  getValidationStats,
  recordValidation,
  recordFailover,
  istDate,
  type ValidationDayStats,
} from "./validationStats";
export {
  getVerifiedIndstocksScrip,
  getMapSyncStats,
  getMappingCountsLive,
  refreshMappings,
  evaluateRow,
  type ResolveResult,
  type MapSyncStats,
} from "./instrumentMapStore";
export {
  matchInstrument,
  normaliseExpiry,
  type KiteInstrumentRef,
  type MatchResult,
} from "./instrumentMapMatch";
export {
  parseInstrumentCsv,
  scripCodeFor,
  scripSegmentPrefix,
  indexEquityBySymbol,
  type IndstocksInstrument,
  type IndstocksSource,
} from "./indstocksInstruments";
export {
  createIndstocksClient,
  resolveIndstocksConfig,
  IndstocksError,
  type IndstocksClient,
  type IndstocksConfig,
} from "./indstocksClient";
export {
  getIndstocksToken,
  setIndstocksToken,
  clearIndstocksToken,
  getIndstocksTokenStatus,
  type IndstocksTokenStatus,
  type IndstocksTokenSource,
} from "./indstocksTokenStore";
export {
  assertTradeable,
  assertTradeableCandles,
  isTradeableMeta,
  tryTradeable,
  TrustTierViolation,
} from "./guard";
export { buildMeta, unavailableMeta, isQuoteComplete } from "./validator";

import * as router from "./router";
import * as analyticsYahoo from "./analyticsYahoo";
import * as diagnostics from "./diagnostics";
import * as kiteProvider from "./kiteProvider";
import * as indstocksProvider from "./indstocksProvider";

export { router, analyticsYahoo, diagnostics, kiteProvider, indstocksProvider };

export {
  getEquityQuote,
  getEquityQuotes,
  getEquityCandles,
  getLtp,
  getIndexQuotes,
  getIndexQuote,
  getOptionChain,
  evaluateOptionChain,
  validateAgainstIndstocks,
  getEquityQuoteResolved,
  isIndstocksEnabled,
  type CrossValidation,
  type ResolvedQuote,
  type TrustedOptionChain,
  type OptionChainEvaluation,
} from "./router";

export {
  candleProvenanceFromMeta,
  candleIngestProvenance,
  sourcePriority,
  SOURCE_PRIORITY,
  UNKNOWN_SOURCE_PRIORITY,
  type CandleProvenance,
  type ProvenanceExtra,
} from "./provenance";

export {
  buildDataDiagnostics,
  buildSymbolDiagnostic,
  type DataDiagnostics,
  type ProviderDiagnostic,
  type ProviderState,
  type SymbolDiagnostic,
} from "./diagnostics";
