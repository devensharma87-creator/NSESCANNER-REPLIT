/**
 * Canonical universe for the Global Multi-Asset Scanner (Phase 1).
 *
 * Each entry maps a stable scanner symbol (used in URLs / DB keys / the
 * watchlist) to the symbol the underlying data source actually uses, plus
 * the timeframes the source can be queried for with REAL data (we never
 * fabricate a timeframe the provider doesn't return).
 *
 * Sources:
 *  - binance   — https://api.binance.com (spot pairs vs USDT)
 *  - yahoo     — yahoo-finance2 (commodity continuous-futures, e.g. GC=F)
 *  - yahoo-fx  — yahoo-finance2 (FX, e.g. EURUSD=X). Yahoo intraday FX is
 *                delayed/snapshot; we surface this caveat in `notes`.
 */

export type GlobalAssetClass = "crypto" | "commodity" | "forex";
export type GlobalDataSource = "binance" | "yahoo" | "yahoo-fx";
export type GlobalTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface GlobalInstrumentDef {
  symbol: string;
  displayName: string;
  assetClass: GlobalAssetClass;
  source: GlobalDataSource;
  sourceSymbol: string;
  currency?: string;
  notes?: string;
  supportedTimeframes: GlobalTimeframe[];
}

const ALL_CRYPTO_TFS: GlobalTimeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
// Yahoo commodity continuous futures support these intervals reliably; we
// expose the intraday set for the day, and `1d` for daily history.
const COMMODITY_TFS: GlobalTimeframe[] = ["5m", "15m", "1h", "1d"];
// Yahoo forex is delayed/snapshot intraday — only `1d` is reliably backed.
const FOREX_TFS: GlobalTimeframe[] = ["1h", "1d"];

export const CRYPTO: GlobalInstrumentDef[] = [
  { symbol: "BTCUSDT",  displayName: "Bitcoin",            assetClass: "crypto", source: "binance", sourceSymbol: "BTCUSDT",  currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "ETHUSDT",  displayName: "Ethereum",           assetClass: "crypto", source: "binance", sourceSymbol: "ETHUSDT",  currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "BNBUSDT",  displayName: "BNB",                assetClass: "crypto", source: "binance", sourceSymbol: "BNBUSDT",  currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "SOLUSDT",  displayName: "Solana",             assetClass: "crypto", source: "binance", sourceSymbol: "SOLUSDT",  currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "XRPUSDT",  displayName: "XRP",                assetClass: "crypto", source: "binance", sourceSymbol: "XRPUSDT",  currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "ADAUSDT",  displayName: "Cardano",            assetClass: "crypto", source: "binance", sourceSymbol: "ADAUSDT",  currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "DOGEUSDT", displayName: "Dogecoin",           assetClass: "crypto", source: "binance", sourceSymbol: "DOGEUSDT", currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "AVAXUSDT", displayName: "Avalanche",          assetClass: "crypto", source: "binance", sourceSymbol: "AVAXUSDT", currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "DOTUSDT",  displayName: "Polkadot",           assetClass: "crypto", source: "binance", sourceSymbol: "DOTUSDT",  currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "LINKUSDT", displayName: "Chainlink",          assetClass: "crypto", source: "binance", sourceSymbol: "LINKUSDT", currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "MATICUSDT",displayName: "Polygon",            assetClass: "crypto", source: "binance", sourceSymbol: "MATICUSDT",currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "LTCUSDT",  displayName: "Litecoin",           assetClass: "crypto", source: "binance", sourceSymbol: "LTCUSDT",  currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "BCHUSDT",  displayName: "Bitcoin Cash",       assetClass: "crypto", source: "binance", sourceSymbol: "BCHUSDT",  currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "TRXUSDT",  displayName: "TRON",               assetClass: "crypto", source: "binance", sourceSymbol: "TRXUSDT",  currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
  { symbol: "TONUSDT",  displayName: "Toncoin",            assetClass: "crypto", source: "binance", sourceSymbol: "TONUSDT",  currency: "USDT", supportedTimeframes: ALL_CRYPTO_TFS },
];

export const COMMODITIES: GlobalInstrumentDef[] = [
  { symbol: "GOLD",      displayName: "Gold",         assetClass: "commodity", source: "yahoo", sourceSymbol: "GC=F", currency: "USD/oz",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "SILVER",    displayName: "Silver",       assetClass: "commodity", source: "yahoo", sourceSymbol: "SI=F", currency: "USD/oz",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "WTI",       displayName: "WTI Crude",    assetClass: "commodity", source: "yahoo", sourceSymbol: "CL=F", currency: "USD/bbl",  supportedTimeframes: COMMODITY_TFS },
  { symbol: "BRENT",     displayName: "Brent Crude",  assetClass: "commodity", source: "yahoo", sourceSymbol: "BZ=F", currency: "USD/bbl",  supportedTimeframes: COMMODITY_TFS },
  { symbol: "NATGAS",    displayName: "Natural Gas",  assetClass: "commodity", source: "yahoo", sourceSymbol: "NG=F", currency: "USD/MMBtu",supportedTimeframes: COMMODITY_TFS },
  { symbol: "COPPER",    displayName: "Copper",       assetClass: "commodity", source: "yahoo", sourceSymbol: "HG=F", currency: "USD/lb",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "PLATINUM",  displayName: "Platinum",     assetClass: "commodity", source: "yahoo", sourceSymbol: "PL=F", currency: "USD/oz",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "PALLADIUM", displayName: "Palladium",    assetClass: "commodity", source: "yahoo", sourceSymbol: "PA=F", currency: "USD/oz",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "WHEAT",     displayName: "Wheat",        assetClass: "commodity", source: "yahoo", sourceSymbol: "ZW=F", currency: "USD/bu",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "CORN",      displayName: "Corn",         assetClass: "commodity", source: "yahoo", sourceSymbol: "ZC=F", currency: "USD/bu",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "SOYBEAN",   displayName: "Soybean",      assetClass: "commodity", source: "yahoo", sourceSymbol: "ZS=F", currency: "USD/bu",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "COFFEE",    displayName: "Coffee",       assetClass: "commodity", source: "yahoo", sourceSymbol: "KC=F", currency: "USc/lb",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "COTTON",    displayName: "Cotton",       assetClass: "commodity", source: "yahoo", sourceSymbol: "CT=F", currency: "USc/lb",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "SUGAR",     displayName: "Sugar",        assetClass: "commodity", source: "yahoo", sourceSymbol: "SB=F", currency: "USc/lb",   supportedTimeframes: COMMODITY_TFS },
];

const FX_NOTE = "Yahoo intraday FX is delayed / snapshot-grade; true real-time forex requires a paid feed (Phase 2).";

export const FOREX: GlobalInstrumentDef[] = [
  { symbol: "EURUSD", displayName: "EUR / USD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURUSD=X", currency: "USD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "GBPUSD", displayName: "GBP / USD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "GBPUSD=X", currency: "USD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDJPY", displayName: "USD / JPY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "JPY=X",    currency: "JPY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDCHF", displayName: "USD / CHF", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "CHF=X",    currency: "CHF", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "AUDUSD", displayName: "AUD / USD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "AUDUSD=X", currency: "USD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "NZDUSD", displayName: "NZD / USD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "NZDUSD=X", currency: "USD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDCAD", displayName: "USD / CAD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "CAD=X",    currency: "CAD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "EURGBP", displayName: "EUR / GBP", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURGBP=X", currency: "GBP", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "EURJPY", displayName: "EUR / JPY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURJPY=X", currency: "JPY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "GBPJPY", displayName: "GBP / JPY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "GBPJPY=X", currency: "JPY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "AUDJPY", displayName: "AUD / JPY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "AUDJPY=X", currency: "JPY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDINR", displayName: "USD / INR", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "INR=X",    currency: "INR", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "EURINR", displayName: "EUR / INR", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURINR=X", currency: "INR", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "GBPINR", displayName: "GBP / INR", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "GBPINR=X", currency: "INR", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "JPYINR", displayName: "JPY / INR", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "JPYINR=X", currency: "INR", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
];

export const UNIVERSE: GlobalInstrumentDef[] = [
  ...CRYPTO,
  ...COMMODITIES,
  ...FOREX,
];

const BY_SYMBOL = new Map(UNIVERSE.map(i => [i.symbol, i] as const));

export function findInstrument(symbol: string): GlobalInstrumentDef | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase());
}

export function listByAssetClass(cls: GlobalAssetClass): GlobalInstrumentDef[] {
  return UNIVERSE.filter(i => i.assetClass === cls);
}

/** Per-source freshness budget (seconds). Older than this → row is "stale". */
export const SOURCE_FRESHNESS_S: Record<GlobalDataSource, number> = {
  binance: 60,    // we poll every ~30s; >60s old → flag
  yahoo: 300,     // commodity quotes via yahoo refresh on a 60s cadence
  "yahoo-fx": 600,
};
