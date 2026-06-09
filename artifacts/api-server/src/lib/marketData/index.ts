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
  buildDataDiagnostics,
  buildSymbolDiagnostic,
  type DataDiagnostics,
  type ProviderDiagnostic,
  type ProviderState,
  type SymbolDiagnostic,
} from "./diagnostics";
