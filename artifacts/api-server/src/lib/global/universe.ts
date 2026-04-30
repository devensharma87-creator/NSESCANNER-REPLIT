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
 * Phase-2 sizing (actuals): 91 crypto, 30 commodities, 35 FX pairs,
 * 206 equities (US sector leaders + EU/UK/CH/JP/HK majors + Indian
 * ADRs) and 30 indices (developed + EM benchmarks; NIFTY, SENSEX,
 * BVSP, MXX, IMOEX, TWII included). The background refresher (see
 * `dataLayer.ts`) chunks Binance tickers into batches of 40 and runs
 * Yahoo calls through a bounded worker pool with staggered cycle
 * starts so the larger universe still fits inside per-source rate
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

/**
 * Exchange codes used for market-session badges. Equity / index instruments
 * carry one of these so the dashboard can show "Open" / "Closed (next open
 * in 3h)" badges and suppress stale styling outside trading hours.
 *
 * Hours for each code live in `artifacts/global/src/lib/marketSessions.ts`.
 * Add a code here AND a session entry there; otherwise the badge silently
 * falls back to "no badge" for unknown codes.
 */
export type GlobalExchange =
  // Task-specified primaries
  | "NYSE" | "LSE" | "XETR" | "EPA" | "SWX" | "TSE" | "HKEX" | "SSE" | "ASX" | "KRX"
  // Additional venues required to cover the rest of the equity/index universe
  | "AMS" | "BME" | "BIT" | "STO" | "TWSE" | "SGX" | "MYX" | "IDX" | "NZX"
  | "NSE" | "B3" | "BMV" | "MOEX";

export interface GlobalInstrumentDef {
  symbol: string;
  displayName: string;
  assetClass: GlobalAssetClass;
  source: GlobalDataSource;
  sourceSymbol: string;
  currency?: string;
  notes?: string;
  supportedTimeframes: GlobalTimeframe[];
  /**
   * Exchange code for equity / index instruments. Used by the dashboard
   * to derive a market-session badge (Open / Closed / Pre / Post). Crypto,
   * commodity continuous futures, and FX rows leave this undefined since
   * those markets are effectively 24×7 and don't carry a session badge.
   */
  exchange?: GlobalExchange;
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

/**
 * Helper for the Yahoo-suffix → exchange-code mapping. Centralised so the
 * tag is derived from the Yahoo symbol the adapter already uses, instead of
 * hand-typing a code on every row (which would drift). Returns NYSE for
 * suffix-less US tickers (the only suffix-less case in our universe).
 */
function exchangeForYahooSym(yahooSym: string): GlobalExchange {
  const dot = yahooSym.lastIndexOf(".");
  if (dot < 0) return "NYSE"; // US-listed (NYSE/NASDAQ share session hours)
  switch (yahooSym.slice(dot + 1)) {
    case "DE": return "XETR"; // Frankfurt / Xetra
    case "AS": return "AMS";  // Euronext Amsterdam
    case "PA": return "EPA";  // Euronext Paris
    case "SW": return "SWX";  // SIX Swiss
    case "L":  return "LSE";  // London
    case "T":  return "TSE";  // Tokyo
    case "HK": return "HKEX"; // Hong Kong
    case "MI": return "BIT";  // Borsa Italiana
    case "MC": return "BME";  // BME Madrid
    case "ST": return "STO";  // Nasdaq Stockholm
    case "SS": return "SSE";  // Shanghai
    case "TW": return "TWSE"; // Taiwan
    case "SI": return "SGX";  // Singapore
    case "KS": return "KRX";  // KRX (Korea)
    case "AX": return "ASX";  // Australian Securities Exchange
    case "BO": return "NSE";  // BSE — share NSE session hours
    case "NS": return "NSE";  // NSE India
    case "SA": return "B3";   // B3 Brasil
    case "MX": return "BMV";  // Bolsa Mexicana
    case "ME": return "MOEX"; // MOEX Russia
    default:   return "NYSE"; // unknown suffix → reasonable fallback
  }
}

const EQUITY_DEFS: ReadonlyArray<EqDef> = [
  // ── US mega caps (FAANG+) ───────────────────────────────────────
  { scannerSym: "AAPL",  yahooSym: "AAPL",  name: "Apple",            ccy: "USD" },
  { scannerSym: "MSFT",  yahooSym: "MSFT",  name: "Microsoft",        ccy: "USD" },
  { scannerSym: "GOOGL", yahooSym: "GOOGL", name: "Alphabet (A)",     ccy: "USD" },
  { scannerSym: "GOOG",  yahooSym: "GOOG",  name: "Alphabet (C)",     ccy: "USD" },
  { scannerSym: "AMZN",  yahooSym: "AMZN",  name: "Amazon",           ccy: "USD" },
  { scannerSym: "META",  yahooSym: "META",  name: "Meta Platforms",   ccy: "USD" },
  { scannerSym: "NVDA",  yahooSym: "NVDA",  name: "NVIDIA",           ccy: "USD" },
  { scannerSym: "TSLA",  yahooSym: "TSLA",  name: "Tesla",            ccy: "USD" },
  { scannerSym: "BRKB",  yahooSym: "BRK-B", name: "Berkshire Hathaway B", ccy: "USD" },
  // ── US sector leaders — Tech / Semis / Software ────────────────
  { scannerSym: "AVGO",  yahooSym: "AVGO",  name: "Broadcom",         ccy: "USD" },
  { scannerSym: "AMD",   yahooSym: "AMD",   name: "AMD",              ccy: "USD" },
  { scannerSym: "ORCL",  yahooSym: "ORCL",  name: "Oracle",           ccy: "USD" },
  { scannerSym: "ADBE",  yahooSym: "ADBE",  name: "Adobe",            ccy: "USD" },
  { scannerSym: "CRM",   yahooSym: "CRM",   name: "Salesforce",       ccy: "USD" },
  { scannerSym: "NFLX",  yahooSym: "NFLX",  name: "Netflix",          ccy: "USD" },
  { scannerSym: "INTC",  yahooSym: "INTC",  name: "Intel",            ccy: "USD" },
  { scannerSym: "CSCO",  yahooSym: "CSCO",  name: "Cisco",            ccy: "USD" },
  { scannerSym: "QCOM",  yahooSym: "QCOM",  name: "Qualcomm",         ccy: "USD" },
  { scannerSym: "TXN",   yahooSym: "TXN",   name: "Texas Instruments",ccy: "USD" },
  { scannerSym: "IBM",   yahooSym: "IBM",   name: "IBM",              ccy: "USD" },
  { scannerSym: "NOW",   yahooSym: "NOW",   name: "ServiceNow",       ccy: "USD" },
  { scannerSym: "INTU",  yahooSym: "INTU",  name: "Intuit",           ccy: "USD" },
  { scannerSym: "AMAT",  yahooSym: "AMAT",  name: "Applied Materials",ccy: "USD" },
  { scannerSym: "MU",    yahooSym: "MU",    name: "Micron Technology",ccy: "USD" },
  { scannerSym: "LRCX",  yahooSym: "LRCX",  name: "Lam Research",     ccy: "USD" },
  { scannerSym: "KLAC",  yahooSym: "KLAC",  name: "KLA Corp",         ccy: "USD" },
  { scannerSym: "SNPS",  yahooSym: "SNPS",  name: "Synopsys",         ccy: "USD" },
  { scannerSym: "CDNS",  yahooSym: "CDNS",  name: "Cadence Design",   ccy: "USD" },
  { scannerSym: "PANW",  yahooSym: "PANW",  name: "Palo Alto Networks",ccy: "USD" },
  { scannerSym: "ANET",  yahooSym: "ANET",  name: "Arista Networks",  ccy: "USD" },
  // ── US — Communications / Media ────────────────────────────────
  { scannerSym: "TMUS",  yahooSym: "TMUS",  name: "T-Mobile US",      ccy: "USD" },
  { scannerSym: "VZ",    yahooSym: "VZ",    name: "Verizon",          ccy: "USD" },
  { scannerSym: "T",     yahooSym: "T",     name: "AT&T",             ccy: "USD" },
  { scannerSym: "CMCSA", yahooSym: "CMCSA", name: "Comcast",          ccy: "USD" },
  // ── US — Financials ────────────────────────────────────────────
  { scannerSym: "JPM",   yahooSym: "JPM",   name: "JPMorgan Chase",   ccy: "USD" },
  { scannerSym: "BAC",   yahooSym: "BAC",   name: "Bank of America",  ccy: "USD" },
  { scannerSym: "WFC",   yahooSym: "WFC",   name: "Wells Fargo",      ccy: "USD" },
  { scannerSym: "C",     yahooSym: "C",     name: "Citigroup",        ccy: "USD" },
  { scannerSym: "GS",    yahooSym: "GS",    name: "Goldman Sachs",    ccy: "USD" },
  { scannerSym: "MS",    yahooSym: "MS",    name: "Morgan Stanley",   ccy: "USD" },
  { scannerSym: "BLK",   yahooSym: "BLK",   name: "BlackRock",        ccy: "USD" },
  { scannerSym: "AXP",   yahooSym: "AXP",   name: "American Express", ccy: "USD" },
  { scannerSym: "SCHW",  yahooSym: "SCHW",  name: "Charles Schwab",   ccy: "USD" },
  { scannerSym: "BX",    yahooSym: "BX",    name: "Blackstone",       ccy: "USD" },
  { scannerSym: "SPGI",  yahooSym: "SPGI",  name: "S&P Global",       ccy: "USD" },
  { scannerSym: "CB",    yahooSym: "CB",    name: "Chubb",            ccy: "USD" },
  { scannerSym: "PGR",   yahooSym: "PGR",   name: "Progressive",      ccy: "USD" },
  { scannerSym: "V",     yahooSym: "V",     name: "Visa",             ccy: "USD" },
  { scannerSym: "MA",    yahooSym: "MA",    name: "Mastercard",       ccy: "USD" },
  // ── US — Consumer Discretionary / Staples ──────────────────────
  { scannerSym: "WMT",   yahooSym: "WMT",   name: "Walmart",          ccy: "USD" },
  { scannerSym: "HD",    yahooSym: "HD",    name: "Home Depot",       ccy: "USD" },
  { scannerSym: "LOW",   yahooSym: "LOW",   name: "Lowe's",           ccy: "USD" },
  { scannerSym: "COST",  yahooSym: "COST",  name: "Costco",           ccy: "USD" },
  { scannerSym: "TGT",   yahooSym: "TGT",   name: "Target",           ccy: "USD" },
  { scannerSym: "SBUX",  yahooSym: "SBUX",  name: "Starbucks",        ccy: "USD" },
  { scannerSym: "BKNG",  yahooSym: "BKNG",  name: "Booking Holdings", ccy: "USD" },
  { scannerSym: "ABNB",  yahooSym: "ABNB",  name: "Airbnb",           ccy: "USD" },
  { scannerSym: "UBER",  yahooSym: "UBER",  name: "Uber",             ccy: "USD" },
  { scannerSym: "GM",    yahooSym: "GM",    name: "General Motors",   ccy: "USD" },
  { scannerSym: "F",     yahooSym: "F",     name: "Ford",             ccy: "USD" },
  { scannerSym: "PG",    yahooSym: "PG",    name: "Procter & Gamble", ccy: "USD" },
  { scannerSym: "KO",    yahooSym: "KO",    name: "Coca-Cola",        ccy: "USD" },
  { scannerSym: "PEP",   yahooSym: "PEP",   name: "PepsiCo",          ccy: "USD" },
  { scannerSym: "MCD",   yahooSym: "MCD",   name: "McDonald's",       ccy: "USD" },
  { scannerSym: "NKE",   yahooSym: "NKE",   name: "Nike",             ccy: "USD" },
  { scannerSym: "DIS",   yahooSym: "DIS",   name: "Walt Disney",      ccy: "USD" },
  { scannerSym: "PM",    yahooSym: "PM",    name: "Philip Morris",    ccy: "USD" },
  { scannerSym: "MO",    yahooSym: "MO",    name: "Altria",           ccy: "USD" },
  { scannerSym: "MDLZ",  yahooSym: "MDLZ",  name: "Mondelez",         ccy: "USD" },
  { scannerSym: "CL",    yahooSym: "CL",    name: "Colgate-Palmolive",ccy: "USD" },
  { scannerSym: "KMB",   yahooSym: "KMB",   name: "Kimberly-Clark",   ccy: "USD" },
  { scannerSym: "GIS",   yahooSym: "GIS",   name: "General Mills",    ccy: "USD" },
  { scannerSym: "EL",    yahooSym: "EL",    name: "Estée Lauder",     ccy: "USD" },
  // ── US — Healthcare ────────────────────────────────────────────
  { scannerSym: "JNJ",   yahooSym: "JNJ",   name: "Johnson & Johnson",ccy: "USD" },
  { scannerSym: "MRK",   yahooSym: "MRK",   name: "Merck",            ccy: "USD" },
  { scannerSym: "LLY",   yahooSym: "LLY",   name: "Eli Lilly",        ccy: "USD" },
  { scannerSym: "ABBV",  yahooSym: "ABBV",  name: "AbbVie",           ccy: "USD" },
  { scannerSym: "UNH",   yahooSym: "UNH",   name: "UnitedHealth",     ccy: "USD" },
  { scannerSym: "PFE",   yahooSym: "PFE",   name: "Pfizer",           ccy: "USD" },
  { scannerSym: "TMO",   yahooSym: "TMO",   name: "Thermo Fisher",    ccy: "USD" },
  { scannerSym: "ABT",   yahooSym: "ABT",   name: "Abbott Labs",      ccy: "USD" },
  { scannerSym: "DHR",   yahooSym: "DHR",   name: "Danaher",          ccy: "USD" },
  { scannerSym: "BMY",   yahooSym: "BMY",   name: "Bristol-Myers",    ccy: "USD" },
  { scannerSym: "AMGN",  yahooSym: "AMGN",  name: "Amgen",            ccy: "USD" },
  { scannerSym: "CVS",   yahooSym: "CVS",   name: "CVS Health",       ccy: "USD" },
  { scannerSym: "MDT",   yahooSym: "MDT",   name: "Medtronic",        ccy: "USD" },
  { scannerSym: "GILD",  yahooSym: "GILD",  name: "Gilead Sciences",  ccy: "USD" },
  { scannerSym: "ISRG",  yahooSym: "ISRG",  name: "Intuitive Surgical",ccy: "USD" },
  { scannerSym: "VRTX",  yahooSym: "VRTX",  name: "Vertex Pharma",    ccy: "USD" },
  { scannerSym: "REGN",  yahooSym: "REGN",  name: "Regeneron",        ccy: "USD" },
  // ── US — Industrials / Energy / Materials / Utilities / REITs ──
  { scannerSym: "BA",    yahooSym: "BA",    name: "Boeing",           ccy: "USD" },
  { scannerSym: "CAT",   yahooSym: "CAT",   name: "Caterpillar",      ccy: "USD" },
  { scannerSym: "HON",   yahooSym: "HON",   name: "Honeywell",        ccy: "USD" },
  { scannerSym: "GE",    yahooSym: "GE",    name: "GE Aerospace",     ccy: "USD" },
  { scannerSym: "RTX",   yahooSym: "RTX",   name: "RTX Corp",         ccy: "USD" },
  { scannerSym: "LMT",   yahooSym: "LMT",   name: "Lockheed Martin",  ccy: "USD" },
  { scannerSym: "UNP",   yahooSym: "UNP",   name: "Union Pacific",    ccy: "USD" },
  { scannerSym: "UPS",   yahooSym: "UPS",   name: "UPS",              ccy: "USD" },
  { scannerSym: "FDX",   yahooSym: "FDX",   name: "FedEx",            ccy: "USD" },
  { scannerSym: "DE",    yahooSym: "DE",    name: "Deere & Co",       ccy: "USD" },
  { scannerSym: "MMM",   yahooSym: "MMM",   name: "3M",               ccy: "USD" },
  { scannerSym: "XOM",   yahooSym: "XOM",   name: "Exxon Mobil",      ccy: "USD" },
  { scannerSym: "CVX",   yahooSym: "CVX",   name: "Chevron",          ccy: "USD" },
  { scannerSym: "COP",   yahooSym: "COP",   name: "ConocoPhillips",   ccy: "USD" },
  { scannerSym: "SLB",   yahooSym: "SLB",   name: "Schlumberger",     ccy: "USD" },
  { scannerSym: "EOG",   yahooSym: "EOG",   name: "EOG Resources",    ccy: "USD" },
  { scannerSym: "MPC",   yahooSym: "MPC",   name: "Marathon Petroleum",ccy: "USD" },
  { scannerSym: "PSX",   yahooSym: "PSX",   name: "Phillips 66",      ccy: "USD" },
  { scannerSym: "OXY",   yahooSym: "OXY",   name: "Occidental Petroleum",ccy: "USD" },
  { scannerSym: "LIN",   yahooSym: "LIN",   name: "Linde",            ccy: "USD" },
  { scannerSym: "FCX",   yahooSym: "FCX",   name: "Freeport-McMoRan", ccy: "USD" },
  { scannerSym: "NEM",   yahooSym: "NEM",   name: "Newmont",          ccy: "USD" },
  { scannerSym: "AMT",   yahooSym: "AMT",   name: "American Tower",   ccy: "USD" },
  { scannerSym: "PLD",   yahooSym: "PLD",   name: "Prologis",         ccy: "USD" },
  { scannerSym: "EQIX",  yahooSym: "EQIX",  name: "Equinix",          ccy: "USD" },
  { scannerSym: "NEE",   yahooSym: "NEE",   name: "NextEra Energy",   ccy: "USD" },
  { scannerSym: "DUK",   yahooSym: "DUK",   name: "Duke Energy",      ccy: "USD" },
  { scannerSym: "SO",    yahooSym: "SO",    name: "Southern Company", ccy: "USD" },
  // ── Indian ADRs (US-listed) ────────────────────────────────────
  { scannerSym: "INFY",  yahooSym: "INFY",  name: "Infosys (ADR)",    ccy: "USD" },
  { scannerSym: "WIT",   yahooSym: "WIT",   name: "Wipro (ADR)",      ccy: "USD" },
  { scannerSym: "HDB",   yahooSym: "HDB",   name: "HDFC Bank (ADR)",  ccy: "USD" },
  { scannerSym: "IBN",   yahooSym: "IBN",   name: "ICICI Bank (ADR)", ccy: "USD" },
  // TTM (Tata Motors ADR) was delisted from NYSE in Jan 2024 — omitted.
  { scannerSym: "RDY",   yahooSym: "RDY",   name: "Dr Reddy's (ADR)", ccy: "USD" },
  // ── EU large caps — Germany (DAX) ──────────────────────────────
  { scannerSym: "SAP_DE",   yahooSym: "SAP.DE",   name: "SAP",                  ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "SIE_DE",   yahooSym: "SIE.DE",   name: "Siemens",              ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "BAS_DE",   yahooSym: "BAS.DE",   name: "BASF",                 ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "ALV_DE",   yahooSym: "ALV.DE",   name: "Allianz",              ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "DTE_DE",   yahooSym: "DTE.DE",   name: "Deutsche Telekom",     ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "MBG_DE",   yahooSym: "MBG.DE",   name: "Mercedes-Benz Group",  ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "VOW3_DE",  yahooSym: "VOW3.DE",  name: "Volkswagen (Pref)",    ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "DBK_DE",   yahooSym: "DBK.DE",   name: "Deutsche Bank",        ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "MUV2_DE",  yahooSym: "MUV2.DE",  name: "Munich Re",            ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "BMW_DE",   yahooSym: "BMW.DE",   name: "BMW",                  ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "ADS_DE",   yahooSym: "ADS.DE",   name: "Adidas",               ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "BAYN_DE",  yahooSym: "BAYN.DE",  name: "Bayer",                ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "IFX_DE",   yahooSym: "IFX.DE",   name: "Infineon",             ccy: "EUR", notes: EQ_NOTE_NON_US },
  // ── EU large caps — Netherlands ────────────────────────────────
  { scannerSym: "ASML_AS",  yahooSym: "ASML.AS",  name: "ASML Holding",         ccy: "EUR", notes: EQ_NOTE_NON_US },
  // ── EU large caps — France (CAC) ───────────────────────────────
  { scannerSym: "MC_PA",    yahooSym: "MC.PA",    name: "LVMH",                 ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "OR_PA",    yahooSym: "OR.PA",    name: "L'Oréal",              ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "AIR_PA",   yahooSym: "AIR.PA",   name: "Airbus",               ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "BNP_PA",   yahooSym: "BNP.PA",   name: "BNP Paribas",          ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "SAN_PA",   yahooSym: "SAN.PA",   name: "Sanofi",               ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "TTE_PA",   yahooSym: "TTE.PA",   name: "TotalEnergies",        ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "CS_PA",    yahooSym: "CS.PA",    name: "AXA",                  ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "GLE_PA",   yahooSym: "GLE.PA",   name: "Société Générale",     ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "KER_PA",   yahooSym: "KER.PA",   name: "Kering",               ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "DG_PA",    yahooSym: "DG.PA",    name: "Vinci",                ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "RMS_PA",   yahooSym: "RMS.PA",   name: "Hermès",               ccy: "EUR", notes: EQ_NOTE_NON_US },
  { scannerSym: "SU_PA",    yahooSym: "SU.PA",    name: "Schneider Electric",   ccy: "EUR", notes: EQ_NOTE_NON_US },
  // ── EU large caps — Switzerland ────────────────────────────────
  { scannerSym: "NESN_SW",  yahooSym: "NESN.SW",  name: "Nestlé",               ccy: "CHF", notes: EQ_NOTE_NON_US },
  { scannerSym: "NOVN_SW",  yahooSym: "NOVN.SW",  name: "Novartis",             ccy: "CHF", notes: EQ_NOTE_NON_US },
  { scannerSym: "ROG_SW",   yahooSym: "ROG.SW",   name: "Roche",                ccy: "CHF", notes: EQ_NOTE_NON_US },
  { scannerSym: "UBSG_SW",  yahooSym: "UBSG.SW",  name: "UBS Group",            ccy: "CHF", notes: EQ_NOTE_NON_US },
  { scannerSym: "ZURN_SW",  yahooSym: "ZURN.SW",  name: "Zurich Insurance",     ccy: "CHF", notes: EQ_NOTE_NON_US },
  // ── EU large caps — UK (FTSE) ──────────────────────────────────
  { scannerSym: "AZN_L",    yahooSym: "AZN.L",    name: "AstraZeneca",          ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "SHEL_L",   yahooSym: "SHEL.L",   name: "Shell",                ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "HSBA_L",   yahooSym: "HSBA.L",   name: "HSBC Holdings",        ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "BP_L",     yahooSym: "BP.L",     name: "BP",                   ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "RIO_L",    yahooSym: "RIO.L",    name: "Rio Tinto",            ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "GLEN_L",   yahooSym: "GLEN.L",   name: "Glencore",             ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "ULVR_L",   yahooSym: "ULVR.L",   name: "Unilever",             ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "VOD_L",    yahooSym: "VOD.L",    name: "Vodafone",             ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "BARC_L",   yahooSym: "BARC.L",   name: "Barclays",             ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "LLOY_L",   yahooSym: "LLOY.L",   name: "Lloyds Banking",       ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "GSK_L",    yahooSym: "GSK.L",    name: "GSK",                  ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "DGE_L",    yahooSym: "DGE.L",    name: "Diageo",               ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "TSCO_L",   yahooSym: "TSCO.L",   name: "Tesco",                ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "BATS_L",   yahooSym: "BATS.L",   name: "British American Tobacco",ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "RR_L",     yahooSym: "RR.L",     name: "Rolls-Royce Holdings", ccy: "GBP", notes: EQ_NOTE_NON_US },
  { scannerSym: "STAN_L",   yahooSym: "STAN.L",   name: "Standard Chartered",   ccy: "GBP", notes: EQ_NOTE_NON_US },
  // ── Japan (Nikkei top names) ───────────────────────────────────
  { scannerSym: "TYO_7203", yahooSym: "7203.T", name: "Toyota Motor",          ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_6758", yahooSym: "6758.T", name: "Sony Group",            ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_9984", yahooSym: "9984.T", name: "SoftBank Group",        ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_8306", yahooSym: "8306.T", name: "Mitsubishi UFJ FG",     ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_6861", yahooSym: "6861.T", name: "Keyence",               ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_7974", yahooSym: "7974.T", name: "Nintendo",              ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_8035", yahooSym: "8035.T", name: "Tokyo Electron",        ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_9432", yahooSym: "9432.T", name: "NTT",                   ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_9433", yahooSym: "9433.T", name: "KDDI",                  ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_9434", yahooSym: "9434.T", name: "SoftBank Corp",         ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_4063", yahooSym: "4063.T", name: "Shin-Etsu Chemical",    ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_6098", yahooSym: "6098.T", name: "Recruit Holdings",      ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_8316", yahooSym: "8316.T", name: "Sumitomo Mitsui FG",    ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_8411", yahooSym: "8411.T", name: "Mizuho FG",             ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_6501", yahooSym: "6501.T", name: "Hitachi",               ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_6981", yahooSym: "6981.T", name: "Murata Manufacturing",  ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_4502", yahooSym: "4502.T", name: "Takeda Pharmaceutical", ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_4661", yahooSym: "4661.T", name: "Oriental Land",         ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_7267", yahooSym: "7267.T", name: "Honda Motor",           ccy: "JPY", notes: EQ_NOTE_NON_US },
  { scannerSym: "TYO_8058", yahooSym: "8058.T", name: "Mitsubishi Corp",       ccy: "JPY", notes: EQ_NOTE_NON_US },
  // ── Hong Kong (Hang Seng heavyweights) ─────────────────────────
  { scannerSym: "HK_0700", yahooSym: "0700.HK", name: "Tencent Holdings",      ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_0941", yahooSym: "0941.HK", name: "China Mobile",          ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_1398", yahooSym: "1398.HK", name: "ICBC",                  ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_0939", yahooSym: "0939.HK", name: "China Construction Bank",ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_3988", yahooSym: "3988.HK", name: "Bank of China",         ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_2318", yahooSym: "2318.HK", name: "Ping An Insurance",     ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_0005", yahooSym: "0005.HK", name: "HSBC Holdings (HK)",    ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_1299", yahooSym: "1299.HK", name: "AIA Group",             ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_0388", yahooSym: "0388.HK", name: "Hong Kong Exchanges",   ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_9988", yahooSym: "9988.HK", name: "Alibaba (HK)",          ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_9618", yahooSym: "9618.HK", name: "JD.com (HK)",           ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_3690", yahooSym: "3690.HK", name: "Meituan",               ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_1810", yahooSym: "1810.HK", name: "Xiaomi",                ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_0883", yahooSym: "0883.HK", name: "CNOOC",                 ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_0857", yahooSym: "0857.HK", name: "PetroChina",            ccy: "HKD", notes: EQ_NOTE_NON_US },
  { scannerSym: "HK_1024", yahooSym: "1024.HK", name: "Kuaishou Technology",   ccy: "HKD", notes: EQ_NOTE_NON_US },
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
  exchange: exchangeForYahooSym(d.yahooSym),
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
  /**
   * Exchange whose cash session drives this index. Stoxx 50 and other
   * pan-European composites have no single home venue but publish during
   * Eurozone hours, so we tag them to a representative Euronext exchange.
   */
  exchange: GlobalExchange;
}

const INDEX_DEFS: ReadonlyArray<IdxDef> = [
  // ── US ──────────────────────────────────────────────────────────
  { scannerSym: "SPX",     yahooSym: "^GSPC",     name: "S&P 500",          ccy: "USD", exchange: "NYSE" },
  { scannerSym: "NDX",     yahooSym: "^NDX",      name: "Nasdaq 100",       ccy: "USD", exchange: "NYSE" },
  { scannerSym: "DJI",     yahooSym: "^DJI",      name: "Dow Jones IA",     ccy: "USD", exchange: "NYSE" },
  { scannerSym: "RUT",     yahooSym: "^RUT",      name: "Russell 2000",     ccy: "USD", exchange: "NYSE" },
  { scannerSym: "VIX",     yahooSym: "^VIX",      name: "CBOE VIX",         ccy: "USD", exchange: "NYSE" },
  // ── Europe ──────────────────────────────────────────────────────
  { scannerSym: "DAX",     yahooSym: "^GDAXI",    name: "DAX 40",           ccy: "EUR", exchange: "XETR" },
  { scannerSym: "FTSE",    yahooSym: "^FTSE",     name: "FTSE 100",         ccy: "GBP", exchange: "LSE" },
  { scannerSym: "FTSE250", yahooSym: "^FTMC",     name: "FTSE 250",         ccy: "GBP", exchange: "LSE" },
  { scannerSym: "CAC",     yahooSym: "^FCHI",     name: "CAC 40",           ccy: "EUR", exchange: "EPA" },
  { scannerSym: "SX5E",    yahooSym: "^STOXX50E", name: "Euro Stoxx 50",    ccy: "EUR", exchange: "EPA" },
  { scannerSym: "IBEX",    yahooSym: "^IBEX",     name: "IBEX 35",          ccy: "EUR", exchange: "BME" },
  { scannerSym: "MIB",     yahooSym: "FTSEMIB.MI",name: "FTSE MIB",         ccy: "EUR", exchange: "BIT" },
  { scannerSym: "AEX",     yahooSym: "^AEX",      name: "AEX",              ccy: "EUR", exchange: "AMS" },
  { scannerSym: "SMI",     yahooSym: "^SSMI",     name: "Swiss Market Index",ccy: "CHF", exchange: "SWX" },
  { scannerSym: "OMXS30",  yahooSym: "^OMX",      name: "OMX Stockholm 30", ccy: "SEK", exchange: "STO" },
  // ── Asia / Pacific ──────────────────────────────────────────────
  { scannerSym: "N225",    yahooSym: "^N225",     name: "Nikkei 225",       ccy: "JPY", exchange: "TSE" },
  { scannerSym: "HSI",     yahooSym: "^HSI",      name: "Hang Seng",        ccy: "HKD", exchange: "HKEX" },
  { scannerSym: "SSEC",    yahooSym: "000001.SS", name: "SSE Composite",    ccy: "CNY", exchange: "SSE" },
  { scannerSym: "AXJO",    yahooSym: "^AXJO",     name: "S&P/ASX 200",      ccy: "AUD", exchange: "ASX" },
  { scannerSym: "KOSPI",   yahooSym: "^KS11",     name: "KOSPI Composite",  ccy: "KRW", exchange: "KRX" },
  { scannerSym: "TWII",    yahooSym: "^TWII",     name: "Taiwan Weighted",  ccy: "TWD", exchange: "TWSE" },
  { scannerSym: "STI",     yahooSym: "^STI",      name: "Straits Times",    ccy: "SGD", exchange: "SGX" },
  { scannerSym: "KLSE",    yahooSym: "^KLSE",     name: "FTSE Bursa Malaysia KLCI", ccy: "MYR", exchange: "MYX" },
  { scannerSym: "JKSE",    yahooSym: "^JKSE",     name: "Jakarta Composite",ccy: "IDR", exchange: "IDX" },
  { scannerSym: "NZ50",    yahooSym: "^NZ50",     name: "S&P/NZX 50",       ccy: "NZD", exchange: "NZX" },
  // ── Emerging markets ───────────────────────────────────────────
  { scannerSym: "NIFTY",   yahooSym: "^NSEI",     name: "Nifty 50",         ccy: "INR", exchange: "NSE" },
  { scannerSym: "SENSEX",  yahooSym: "^BSESN",    name: "BSE Sensex",       ccy: "INR", exchange: "NSE" },
  { scannerSym: "BVSP",    yahooSym: "^BVSP",     name: "Bovespa",          ccy: "BRL", exchange: "B3" },
  { scannerSym: "MXX",     yahooSym: "^MXX",      name: "S&P/BMV IPC",      ccy: "MXN", exchange: "BMV" },
  { scannerSym: "IMOEX",   yahooSym: "IMOEX.ME",  name: "MOEX Russia",      ccy: "RUB", exchange: "MOEX" },
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
  exchange: d.exchange,
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
