/**
 * Canonical universe for the Global Multi-Asset Scanner.
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
 *
 * Sizing target (Phase-1 expansion): ~80 crypto, ~30 commodities, ~30 FX
 * pairs. The background refresher (see `dataLayer.ts`) chunks Binance
 * tickers into batches of 40 and runs Yahoo calls through a bounded
 * worker pool so the larger universe still fits inside per-source rate
 * budgets.
 */

export type GlobalAssetClass = "crypto" | "commodity" | "forex" | "equity" | "index";
export type GlobalDataSource =
  | "binance"
  | "yahoo"
  | "yahoo-fx"
  | "yahoo-equity"
  | "yahoo-index";
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
// Yahoo equities expose intraday from 1m-1h; we mirror the commodity set so
// the UI gets a consistent intraday/swing toolkit.
const EQUITY_TFS: GlobalTimeframe[] = ["5m", "15m", "1h", "1d"];
// Indices on Yahoo expose the same intraday set as equities but liquidity
// gaps make 1m/5m noisy outside cash hours; we keep the swing-friendly set.
const INDEX_TFS: GlobalTimeframe[] = ["15m", "1h", "1d"];

/**
 * Compact helper for crypto rows — every entry has identical shape (Binance
 * spot vs USDT, all timeframes), so a tuple of [symbol, displayName] keeps
 * the (now ~80-row) list readable at a glance.
 */
const CRYPTO_DEFS: ReadonlyArray<readonly [string, string]> = [
  // ── Top-15 majors (Phase-1 baseline) ────────────────────────────
  ["BTCUSDT",   "Bitcoin"],
  ["ETHUSDT",   "Ethereum"],
  ["BNBUSDT",   "BNB"],
  ["SOLUSDT",   "Solana"],
  ["XRPUSDT",   "XRP"],
  ["ADAUSDT",   "Cardano"],
  ["DOGEUSDT",  "Dogecoin"],
  ["AVAXUSDT",  "Avalanche"],
  ["DOTUSDT",   "Polkadot"],
  ["LINKUSDT",  "Chainlink"],
  ["MATICUSDT", "Polygon"],
  ["LTCUSDT",   "Litecoin"],
  ["BCHUSDT",   "Bitcoin Cash"],
  ["TRXUSDT",   "TRON"],
  ["TONUSDT",   "Toncoin"],
  // ── L1 / L2 / blue-chip alts ────────────────────────────────────
  ["ATOMUSDT",  "Cosmos"],
  ["NEARUSDT",  "NEAR Protocol"],
  ["ALGOUSDT",  "Algorand"],
  ["ICPUSDT",   "Internet Computer"],
  ["FILUSDT",   "Filecoin"],
  ["APTUSDT",   "Aptos"],
  ["ARBUSDT",   "Arbitrum"],
  ["OPUSDT",    "Optimism"],
  ["INJUSDT",   "Injective"],
  ["SUIUSDT",   "Sui"],
  ["IMXUSDT",   "Immutable"],
  ["HBARUSDT",  "Hedera"],
  ["EGLDUSDT",  "MultiversX"],
  ["VETUSDT",   "VeChain"],
  ["XLMUSDT",   "Stellar"],
  ["EOSUSDT",   "EOS"],
  ["XTZUSDT",   "Tezos"],
  ["NEOUSDT",   "Neo"],
  ["KAVAUSDT",  "Kava"],
  ["FTMUSDT",   "Fantom"],
  ["MINAUSDT",  "Mina"],
  ["ROSEUSDT",  "Oasis Network"],
  ["ONEUSDT",   "Harmony"],
  ["QTUMUSDT",  "Qtum"],
  ["IOTAUSDT",  "IOTA"],
  ["WAVESUSDT", "Waves"],
  ["CELOUSDT",  "Celo"],
  ["IOTXUSDT",  "IoTeX"],
  ["STXUSDT",   "Stacks"],
  // ── DeFi blue-chips ─────────────────────────────────────────────
  ["UNIUSDT",   "Uniswap"],
  ["AAVEUSDT",  "Aave"],
  ["MKRUSDT",   "Maker"],
  ["LDOUSDT",   "Lido DAO"],
  ["COMPUSDT",  "Compound"],
  ["SNXUSDT",   "Synthetix"],
  ["CRVUSDT",   "Curve DAO"],
  ["SUSHIUSDT", "SushiSwap"],
  ["1INCHUSDT", "1inch"],
  ["YFIUSDT",   "yearn.finance"],
  ["DYDXUSDT",  "dYdX"],
  ["RUNEUSDT",  "THORChain"],
  ["BANDUSDT",  "Band Protocol"],
  ["GRTUSDT",   "The Graph"],
  // ── Gaming / metaverse / NFT ────────────────────────────────────
  ["SANDUSDT",  "The Sandbox"],
  ["MANAUSDT",  "Decentraland"],
  ["AXSUSDT",   "Axie Infinity"],
  ["GALAUSDT",  "Gala"],
  ["CHZUSDT",   "Chiliz"],
  ["ENJUSDT",   "Enjin"],
  ["FLOWUSDT",  "Flow"],
  ["APEUSDT",   "ApeCoin"],
  ["GMTUSDT",   "STEPN"],
  // ── Privacy / payments ──────────────────────────────────────────
  ["ETCUSDT",   "Ethereum Classic"],
  ["ZECUSDT",   "Zcash"],
  ["DASHUSDT",  "Dash"],
  ["BATUSDT",   "Basic Attention"],
  ["ZILUSDT",   "Zilliqa"],
  ["ANKRUSDT",  "Ankr"],
  ["KSMUSDT",   "Kusama"],
  // ── Meme / 2024-25 cohort ───────────────────────────────────────
  ["SHIBUSDT",  "Shiba Inu"],
  ["PEPEUSDT",  "Pepe"],
  ["FLOKIUSDT", "Floki"],
  ["WIFUSDT",   "dogwifhat"],
  ["BONKUSDT",  "Bonk"],
  ["JUPUSDT",   "Jupiter"],
  ["JTOUSDT",   "Jito"],
  ["TIAUSDT",   "Celestia"],
  ["SEIUSDT",   "Sei"],
  ["PYTHUSDT",  "Pyth Network"],
  ["WLDUSDT",   "Worldcoin"],
  ["ORDIUSDT",  "ORDI"],
  ["BLURUSDT",  "Blur"],
  ["MASKUSDT",  "Mask Network"],
  ["JASMYUSDT", "JasmyCoin"],
  ["ENSUSDT",   "Ethereum Name Service"],
  ["LRCUSDT",   "Loopring"],
] as const;

export const CRYPTO: GlobalInstrumentDef[] = CRYPTO_DEFS.map(([sym, name]) => ({
  symbol: sym,
  displayName: name,
  assetClass: "crypto",
  source: "binance",
  sourceSymbol: sym,
  currency: "USDT",
  supportedTimeframes: ALL_CRYPTO_TFS,
}));

export const COMMODITIES: GlobalInstrumentDef[] = [
  // ── Precious metals ─────────────────────────────────────────────
  { symbol: "GOLD",      displayName: "Gold",         assetClass: "commodity", source: "yahoo", sourceSymbol: "GC=F",  currency: "USD/oz",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "SILVER",    displayName: "Silver",       assetClass: "commodity", source: "yahoo", sourceSymbol: "SI=F",  currency: "USD/oz",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "PLATINUM",  displayName: "Platinum",     assetClass: "commodity", source: "yahoo", sourceSymbol: "PL=F",  currency: "USD/oz",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "PALLADIUM", displayName: "Palladium",    assetClass: "commodity", source: "yahoo", sourceSymbol: "PA=F",  currency: "USD/oz",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "MGOLD",     displayName: "Micro Gold",   assetClass: "commodity", source: "yahoo", sourceSymbol: "MGC=F", currency: "USD/oz",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "MSILVER",   displayName: "Mini Silver",  assetClass: "commodity", source: "yahoo", sourceSymbol: "SIL=F", currency: "USD/oz",   supportedTimeframes: COMMODITY_TFS },
  // ── Industrial metals ───────────────────────────────────────────
  { symbol: "COPPER",    displayName: "Copper",       assetClass: "commodity", source: "yahoo", sourceSymbol: "HG=F",  currency: "USD/lb",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "STEEL",     displayName: "Steel HRC",    assetClass: "commodity", source: "yahoo", sourceSymbol: "HRC=F", currency: "USD/ton",  supportedTimeframes: COMMODITY_TFS },
  // ── Energy ──────────────────────────────────────────────────────
  { symbol: "WTI",       displayName: "WTI Crude",    assetClass: "commodity", source: "yahoo", sourceSymbol: "CL=F",  currency: "USD/bbl",  supportedTimeframes: COMMODITY_TFS },
  { symbol: "BRENT",     displayName: "Brent Crude",  assetClass: "commodity", source: "yahoo", sourceSymbol: "BZ=F",  currency: "USD/bbl",  supportedTimeframes: COMMODITY_TFS },
  { symbol: "NATGAS",    displayName: "Natural Gas",  assetClass: "commodity", source: "yahoo", sourceSymbol: "NG=F",  currency: "USD/MMBtu",supportedTimeframes: COMMODITY_TFS },
  { symbol: "HEATOIL",   displayName: "Heating Oil",  assetClass: "commodity", source: "yahoo", sourceSymbol: "HO=F",  currency: "USD/gal",  supportedTimeframes: COMMODITY_TFS },
  { symbol: "GASOLINE",  displayName: "RBOB Gasoline",assetClass: "commodity", source: "yahoo", sourceSymbol: "RB=F",  currency: "USD/gal",  supportedTimeframes: COMMODITY_TFS },
  // ── Grains / oilseeds ───────────────────────────────────────────
  { symbol: "WHEAT",     displayName: "Wheat",        assetClass: "commodity", source: "yahoo", sourceSymbol: "ZW=F",  currency: "USc/bu",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "CORN",      displayName: "Corn",         assetClass: "commodity", source: "yahoo", sourceSymbol: "ZC=F",  currency: "USc/bu",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "SOYBEAN",   displayName: "Soybean",      assetClass: "commodity", source: "yahoo", sourceSymbol: "ZS=F",  currency: "USc/bu",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "SOYOIL",    displayName: "Soybean Oil",  assetClass: "commodity", source: "yahoo", sourceSymbol: "ZL=F",  currency: "USc/lb",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "SOYMEAL",   displayName: "Soybean Meal", assetClass: "commodity", source: "yahoo", sourceSymbol: "ZM=F",  currency: "USD/ton",  supportedTimeframes: COMMODITY_TFS },
  { symbol: "OATS",      displayName: "Oats",         assetClass: "commodity", source: "yahoo", sourceSymbol: "ZO=F",  currency: "USc/bu",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "RICE",      displayName: "Rough Rice",   assetClass: "commodity", source: "yahoo", sourceSymbol: "ZR=F",  currency: "USD/cwt",  supportedTimeframes: COMMODITY_TFS },
  { symbol: "KCWHEAT",   displayName: "KC HRW Wheat", assetClass: "commodity", source: "yahoo", sourceSymbol: "KE=F",  currency: "USc/bu",   supportedTimeframes: COMMODITY_TFS },
  // ── Livestock ───────────────────────────────────────────────────
  { symbol: "CATTLE",    displayName: "Live Cattle",  assetClass: "commodity", source: "yahoo", sourceSymbol: "LE=F",  currency: "USc/lb",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "HOGS",      displayName: "Lean Hogs",    assetClass: "commodity", source: "yahoo", sourceSymbol: "HE=F",  currency: "USc/lb",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "FCATTLE",   displayName: "Feeder Cattle",assetClass: "commodity", source: "yahoo", sourceSymbol: "GF=F",  currency: "USc/lb",   supportedTimeframes: COMMODITY_TFS },
  // ── Softs ───────────────────────────────────────────────────────
  { symbol: "COFFEE",    displayName: "Coffee",       assetClass: "commodity", source: "yahoo", sourceSymbol: "KC=F",  currency: "USc/lb",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "COTTON",    displayName: "Cotton",       assetClass: "commodity", source: "yahoo", sourceSymbol: "CT=F",  currency: "USc/lb",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "SUGAR",     displayName: "Sugar",        assetClass: "commodity", source: "yahoo", sourceSymbol: "SB=F",  currency: "USc/lb",   supportedTimeframes: COMMODITY_TFS },
  { symbol: "COCOA",     displayName: "Cocoa",        assetClass: "commodity", source: "yahoo", sourceSymbol: "CC=F",  currency: "USD/ton",  supportedTimeframes: COMMODITY_TFS },
  { symbol: "OJ",        displayName: "Orange Juice", assetClass: "commodity", source: "yahoo", sourceSymbol: "OJ=F",  currency: "USc/lb",   supportedTimeframes: COMMODITY_TFS },
  // ── Other ───────────────────────────────────────────────────────
  { symbol: "LUMBER",    displayName: "Lumber",       assetClass: "commodity", source: "yahoo", sourceSymbol: "LBR=F", currency: "USD/Mbf",  supportedTimeframes: COMMODITY_TFS },
];

const FX_NOTE = "Yahoo intraday FX is delayed / snapshot-grade; true real-time forex requires a paid feed (Phase 2).";

export const FOREX: GlobalInstrumentDef[] = [
  // ── G10 majors ──────────────────────────────────────────────────
  { symbol: "EURUSD", displayName: "EUR / USD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURUSD=X", currency: "USD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "GBPUSD", displayName: "GBP / USD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "GBPUSD=X", currency: "USD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDJPY", displayName: "USD / JPY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "JPY=X",    currency: "JPY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDCHF", displayName: "USD / CHF", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "CHF=X",    currency: "CHF", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "AUDUSD", displayName: "AUD / USD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "AUDUSD=X", currency: "USD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "NZDUSD", displayName: "NZD / USD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "NZDUSD=X", currency: "USD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDCAD", displayName: "USD / CAD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "CAD=X",    currency: "CAD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  // ── EUR crosses ─────────────────────────────────────────────────
  { symbol: "EURGBP", displayName: "EUR / GBP", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURGBP=X", currency: "GBP", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "EURJPY", displayName: "EUR / JPY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURJPY=X", currency: "JPY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "EURCHF", displayName: "EUR / CHF", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURCHF=X", currency: "CHF", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "EURAUD", displayName: "EUR / AUD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURAUD=X", currency: "AUD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "EURCAD", displayName: "EUR / CAD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURCAD=X", currency: "CAD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "EURNZD", displayName: "EUR / NZD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURNZD=X", currency: "NZD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  // ── GBP / JPY / commodity crosses ───────────────────────────────
  { symbol: "GBPJPY", displayName: "GBP / JPY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "GBPJPY=X", currency: "JPY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "AUDJPY", displayName: "AUD / JPY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "AUDJPY=X", currency: "JPY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "NZDJPY", displayName: "NZD / JPY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "NZDJPY=X", currency: "JPY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "CHFJPY", displayName: "CHF / JPY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "CHFJPY=X", currency: "JPY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "CADJPY", displayName: "CAD / JPY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "CADJPY=X", currency: "JPY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "GBPCHF", displayName: "GBP / CHF", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "GBPCHF=X", currency: "CHF", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "AUDCAD", displayName: "AUD / CAD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "AUDCAD=X", currency: "CAD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "AUDNZD", displayName: "AUD / NZD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "AUDNZD=X", currency: "NZD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  // ── Scandi / exotic majors ──────────────────────────────────────
  { symbol: "USDNOK", displayName: "USD / NOK", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "NOK=X",    currency: "NOK", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDSEK", displayName: "USD / SEK", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "SEK=X",    currency: "SEK", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDDKK", displayName: "USD / DKK", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "DKK=X",    currency: "DKK", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  // ── Asia / EM ───────────────────────────────────────────────────
  { symbol: "USDSGD", displayName: "USD / SGD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "SGD=X",    currency: "SGD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDHKD", displayName: "USD / HKD", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "HKD=X",    currency: "HKD", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDCNH", displayName: "USD / CNH", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "CNH=X",    currency: "CNH", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDMXN", displayName: "USD / MXN", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "MXN=X",    currency: "MXN", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDZAR", displayName: "USD / ZAR", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "ZAR=X",    currency: "ZAR", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDTRY", displayName: "USD / TRY", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "TRY=X",    currency: "TRY", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "USDPLN", displayName: "USD / PLN", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "PLN=X",    currency: "PLN", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  // ── INR cluster (carry-over from Phase 1) ───────────────────────
  { symbol: "USDINR", displayName: "USD / INR", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "INR=X",    currency: "INR", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "EURINR", displayName: "EUR / INR", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "EURINR=X", currency: "INR", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "GBPINR", displayName: "GBP / INR", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "GBPINR=X", currency: "INR", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
  { symbol: "JPYINR", displayName: "JPY / INR", assetClass: "forex", source: "yahoo-fx", sourceSymbol: "JPYINR=X", currency: "INR", notes: FX_NOTE, supportedTimeframes: FOREX_TFS },
];

// ── Global equities (Phase 2) ───────────────────────────────────────
//
// Scanner symbols are URL-friendly ASCII (no `.` or `-`) so they can be
// safely embedded in routes like `/i/:symbol`. For non-US listings we use
// the Yahoo suffix as an underscore-joined tag (e.g. `ASML_AS`) which keeps
// the canonical scanner symbol stable across UI/DB/watchlist while letting
// the Yahoo adapter use the native `ASML.AS`.
const EQ_NOTE_NON_US =
  "Yahoo non-US equity quote may be delayed up to 15 minutes during local market hours.";

interface EqDef {
  scannerSym: string;
  yahooSym: string;
  name: string;
  ccy: string;
  notes?: string;
}

const EQUITY_DEFS: ReadonlyArray<EqDef> = [
  // ── US large caps (mega + sector leaders) ───────────────────────
  { scannerSym: "AAPL",  yahooSym: "AAPL",  name: "Apple",            ccy: "USD" },
  { scannerSym: "MSFT",  yahooSym: "MSFT",  name: "Microsoft",        ccy: "USD" },
  { scannerSym: "GOOGL", yahooSym: "GOOGL", name: "Alphabet (A)",     ccy: "USD" },
  { scannerSym: "AMZN",  yahooSym: "AMZN",  name: "Amazon",           ccy: "USD" },
  { scannerSym: "META",  yahooSym: "META",  name: "Meta Platforms",   ccy: "USD" },
  { scannerSym: "NVDA",  yahooSym: "NVDA",  name: "NVIDIA",           ccy: "USD" },
  { scannerSym: "TSLA",  yahooSym: "TSLA",  name: "Tesla",            ccy: "USD" },
  { scannerSym: "AVGO",  yahooSym: "AVGO",  name: "Broadcom",         ccy: "USD" },
  { scannerSym: "AMD",   yahooSym: "AMD",   name: "AMD",              ccy: "USD" },
  { scannerSym: "ORCL",  yahooSym: "ORCL",  name: "Oracle",           ccy: "USD" },
  { scannerSym: "ADBE",  yahooSym: "ADBE",  name: "Adobe",            ccy: "USD" },
  { scannerSym: "CRM",   yahooSym: "CRM",   name: "Salesforce",       ccy: "USD" },
  { scannerSym: "NFLX",  yahooSym: "NFLX",  name: "Netflix",          ccy: "USD" },
  { scannerSym: "INTC",  yahooSym: "INTC",  name: "Intel",            ccy: "USD" },
  { scannerSym: "CSCO",  yahooSym: "CSCO",  name: "Cisco",            ccy: "USD" },
  { scannerSym: "JPM",   yahooSym: "JPM",   name: "JPMorgan Chase",   ccy: "USD" },
  { scannerSym: "BAC",   yahooSym: "BAC",   name: "Bank of America",  ccy: "USD" },
  { scannerSym: "V",     yahooSym: "V",     name: "Visa",             ccy: "USD" },
  { scannerSym: "MA",    yahooSym: "MA",    name: "Mastercard",       ccy: "USD" },
  { scannerSym: "WMT",   yahooSym: "WMT",   name: "Walmart",          ccy: "USD" },
  { scannerSym: "HD",    yahooSym: "HD",    name: "Home Depot",       ccy: "USD" },
  { scannerSym: "COST",  yahooSym: "COST",  name: "Costco",           ccy: "USD" },
  { scannerSym: "PG",    yahooSym: "PG",    name: "Procter & Gamble", ccy: "USD" },
  { scannerSym: "KO",    yahooSym: "KO",    name: "Coca-Cola",        ccy: "USD" },
  { scannerSym: "PEP",   yahooSym: "PEP",   name: "PepsiCo",          ccy: "USD" },
  { scannerSym: "MCD",   yahooSym: "MCD",   name: "McDonald's",       ccy: "USD" },
  { scannerSym: "NKE",   yahooSym: "NKE",   name: "Nike",             ccy: "USD" },
  { scannerSym: "DIS",   yahooSym: "DIS",   name: "Walt Disney",      ccy: "USD" },
  { scannerSym: "JNJ",   yahooSym: "JNJ",   name: "Johnson & Johnson",ccy: "USD" },
  { scannerSym: "MRK",   yahooSym: "MRK",   name: "Merck",            ccy: "USD" },
  { scannerSym: "LLY",   yahooSym: "LLY",   name: "Eli Lilly",        ccy: "USD" },
  { scannerSym: "ABBV",  yahooSym: "ABBV",  name: "AbbVie",           ccy: "USD" },
  { scannerSym: "XOM",   yahooSym: "XOM",   name: "Exxon Mobil",      ccy: "USD" },
  { scannerSym: "CVX",   yahooSym: "CVX",   name: "Chevron",          ccy: "USD" },
  // ── EU large caps ───────────────────────────────────────────────
  { scannerSym: "ASML_AS",   yahooSym: "ASML.AS",   name: "ASML Holding",          ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "SAP_DE",    yahooSym: "SAP.DE",    name: "SAP",                   ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "SIE_DE",    yahooSym: "SIE.DE",    name: "Siemens",               ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "BAS_DE",    yahooSym: "BAS.DE",    name: "BASF",                  ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "MC_PA",     yahooSym: "MC.PA",     name: "LVMH",                  ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "OR_PA",     yahooSym: "OR.PA",     name: "L'Oréal",               ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "NESN_SW",   yahooSym: "NESN.SW",   name: "Nestlé",                ccy: "CHF", notes: EQ_NOTE_NON_US },
  { scannerSym: "NOVN_SW",   yahooSym: "NOVN.SW",   name: "Novartis",              ccy: "CHF", notes: EQ_NOTE_NON_US },
  { scannerSym: "ROG_SW",    yahooSym: "ROG.SW",    name: "Roche",                 ccy: "CHF", notes: EQ_NOTE_NON_US },
  { scannerSym: "AZN_L",     yahooSym: "AZN.L",     name: "AstraZeneca",           ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "SHEL_L",    yahooSym: "SHEL.L",    name: "Shell",                 ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "HSBA_L",    yahooSym: "HSBA.L",    name: "HSBC Holdings",         ccy: "GBP", notes: EQ_NOTE_NON_US },
  // ── Japan large caps ────────────────────────────────────────────
  { scannerSym: "TYO_7203", yahooSym: "7203.T", name: "Toyota Motor",         ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_6758", yahooSym: "6758.T", name: "Sony Group",           ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_9984", yahooSym: "9984.T", name: "SoftBank Group",       ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_8306", yahooSym: "8306.T", name: "Mitsubishi UFJ FG",    ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_6861", yahooSym: "6861.T", name: "Keyence",              ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_7974", yahooSym: "7974.T", name: "Nintendo",             ccy: "JPY", notes: EQ_NOTE_NON_US },
];

export const EQUITIES: GlobalInstrumentDef[] = EQUITY_DEFS.map((d) => ({
  symbol: d.scannerSym,
  displayName: d.name,
  assetClass: "equity",
  source: "yahoo-equity",
  sourceSymbol: d.yahooSym,
  currency: d.ccy,
  notes: d.notes,
  supportedTimeframes: EQUITY_TFS,
}));

// ── Global indices (Phase 2) ────────────────────────────────────────
//
// Scanner symbols mirror common-press names (SPX, NDX, DAX, N225, …) so
// they're stable in URLs and recognisable in the watchlist; the Yahoo
// `^…` form is preserved on `sourceSymbol` for the adapter.
const IDX_NOTE = "Index quotes follow the underlying cash session; outside session hours the value is the last close.";

interface IdxDef {
  scannerSym: string;
  yahooSym: string;
  name: string;
  ccy: string;
}

const INDEX_DEFS: ReadonlyArray<IdxDef> = [
  // ── US ──────────────────────────────────────────────────────────
  { scannerSym: "SPX",    yahooSym: "^GSPC",     name: "S&P 500",          ccy: "USD" },
  { scannerSym: "NDX",    yahooSym: "^NDX",      name: "Nasdaq 100",       ccy: "USD" },
  { scannerSym: "DJI",    yahooSym: "^DJI",      name: "Dow Jones IA",     ccy: "USD" },
  { scannerSym: "RUT",    yahooSym: "^RUT",      name: "Russell 2000",     ccy: "USD" },
  { scannerSym: "VIX",    yahooSym: "^VIX",      name: "CBOE VIX",         ccy: "USD" },
  // ── Europe ──────────────────────────────────────────────────────
  { scannerSym: "DAX",    yahooSym: "^GDAXI",    name: "DAX 40",           ccy: "EUR" },
  { scannerSym: "FTSE",   yahooSym: "^FTSE",     name: "FTSE 100",         ccy: "GBP" },
  { scannerSym: "CAC",    yahooSym: "^FCHI",     name: "CAC 40",           ccy: "EUR" },
  { scannerSym: "SX5E",   yahooSym: "^STOXX50E", name: "Euro Stoxx 50",    ccy: "EUR" },
  { scannerSym: "IBEX",   yahooSym: "^IBEX",     name: "IBEX 35",          ccy: "EUR" },
  // ── Asia ────────────────────────────────────────────────────────
  { scannerSym: "N225",   yahooSym: "^N225",     name: "Nikkei 225",       ccy: "JPY" },
  { scannerSym: "HSI",    yahooSym: "^HSI",      name: "Hang Seng",        ccy: "HKD" },
  { scannerSym: "SSEC",   yahooSym: "000001.SS", name: "SSE Composite",    ccy: "CNY" },
  { scannerSym: "AXJO",   yahooSym: "^AXJO",     name: "S&P/ASX 200",      ccy: "AUD" },
  { scannerSym: "KOSPI",  yahooSym: "^KS11",     name: "KOSPI Composite",  ccy: "KRW" },
];

export const INDICES: GlobalInstrumentDef[] = INDEX_DEFS.map((d) => ({
  symbol: d.scannerSym,
  displayName: d.name,
  assetClass: "index",
  source: "yahoo-index",
  sourceSymbol: d.yahooSym,
  currency: d.ccy,
  notes: IDX_NOTE,
  supportedTimeframes: INDEX_TFS,
}));

export const UNIVERSE: GlobalInstrumentDef[] = [
  ...CRYPTO,
  ...COMMODITIES,
  ...FOREX,
  ...EQUITIES,
  ...INDICES,
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
  binance: 60,            // pump every 30s; >60s old → flag
  yahoo: 300,             // commodity quotes pump every 60s
  "yahoo-fx": 600,        // forex quotes pump every 90s
  "yahoo-equity": 300,    // equities pump every 90s; session-bound but we still heartbeat
  "yahoo-index": 300,     // indices pump every 90s; cash-session drives liveness
};
