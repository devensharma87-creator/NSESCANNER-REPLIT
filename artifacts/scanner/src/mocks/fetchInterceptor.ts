/**
 * Dev-only deterministic fixture interceptor for the NSE Stock Scanner.
 *
 * PRODUCTION SAFETY: This file is only imported inside
 *   `if (import.meta.env.DEV && import.meta.env.VITE_PREVIEW_BYPASS === "true")`
 * in main.tsx. Vite replaces `import.meta.env.DEV` with the literal `false`
 * in production builds, making that entire branch dead code. This module is
 * tree-shaken out of every production bundle.
 *
 * Contract:
 *   - No DB connections, no provider calls, no Telegram calls, no broker calls.
 *   - No owner cookie, password, token or provider credential embedded.
 *   - Fixture payloads are contract-valid JSON matching the API response types.
 *   - window.fetch is restored if this module is imported more than once.
 */

// ── Fixture payloads ──────────────────────────────────────────────────────────

const NOW_ISO = "2026-08-05T10:00:00.000Z";
const NOW_MS = 1754380800000;
const SERVER_IST = "10:00 IST";

const F_AUTH_OWNER = {
  authenticated: true,
  role: "owner",
  allowedTabs: [
    "HOME", "SCANNER", "DEEP_SCAN", "FNO", "STRATEGIES",
    "OPTION_CHAIN", "OI_LAB", "PREMARKET", "WATCHLIST", "SECTORS",
    "FLOWS", "STOCKS_TO_WATCH", "NEWS", "LEARN", "CHARTING",
    "PORTFOLIO_ANALYSER", "BACKTEST_LAB",
  ],
  publicMode: false,
};

const F_SCAN_HEALTH = {
  sourceStatus: "DEGRADED",
  canDriveSignals: false,
  rowCount: 0,
  authoritative: false,
  warnings: ["Kite session not active — fixture mode"],
  asOf: NOW_MS,
  providerUsed: "yahoo",
};

const F_TOP_SCANS = {
  topBuys: [],
  topSells: [],
  generatedAt: NOW_ISO,
  nonAuthoritativeCount: 0,
};

const F_STOCKS_EMPTY: unknown[] = [];

// F_STOCK_DETAIL — correct nested StockDetail shape: { profile, quote, indicators, recommendation, ... }
// RELIANCE with positive change direction (+1.48%) to satisfy Gate B1 visual requirements.
const F_STOCK_DETAIL = {
  profile: {
    symbol: "RELIANCE",
    name: "Reliance Industries Ltd.",
    sector: "Energy",
    industry: "Oil & Gas Refining",
    description: "Reliance Industries Limited is a Fortune 500 conglomerate headquartered in Mumbai.",
    website: "https://www.ril.com",
  },
  quote: {
    symbol: "RELIANCE",
    name: "Reliance Industries Ltd.",
    exchange: "NSE",
    price: 2897.50,
    change: 42.30,
    changePercent: 1.48,
    open: 2865.00,
    high: 2910.00,
    low: 2858.75,
    previousClose: 2855.20,
    volume: 4825000,
    avgVolume: 5200000,
    marketCap: 19625000000000,
    fiftyTwoWeekHigh: 3217.90,
    fiftyTwoWeekLow: 2220.30,
    dayRange: "2858.75 – 2910.00",
    yearRange: "2220.30 – 3217.90",
    updatedAt: NOW_ISO,
  },
  indicators: {
    ema20: 2850.4,
    ema50: 2778.2,
    ema200: 2640.1,
    rsi14: 63.2,
    macd: 24.1,
    macdSignal: 18.7,
    macdHist: 5.4,
    vwap: null,
    volumeRatio: 0.93,
    trendStrength: 68,
    supportLevel: 2820.0,
    resistanceLevel: 2940.0,
  },
  recommendation: {
    signal: "BUY",
    score: 55,
    confidence: 62,
    timeframe: "swing",
    target: 2980.0,
    stopLoss: 2790.0,
    riskRewardRatio: 2.1,
    reasons: [],
    displayLabel: "Bullish",
    entryQuality: null,
    horizonBias: null,
    setupStatus: null,
    entryPlan: null,
  },
  financials: [],
  holdings: [],
  news: [],
};

// HDFCBANK fixture — stale quote (price unavailable) for portfolio unpriced-holding proof.
// The component renders "—" or omits values when price fields are null.
const F_STOCK_DETAIL_UNPRICED = {
  profile: {
    symbol: "HDFCBANK",
    name: "HDFC Bank Ltd.",
    sector: "Banking",
    industry: "Private Sector Bank",
  },
  quote: {
    symbol: "HDFCBANK",
    name: "HDFC Bank Ltd.",
    exchange: "NSE",
    price: 0,
    change: 0,
    changePercent: 0,
    open: 0,
    high: 0,
    low: 0,
    previousClose: 0,
    volume: 0,
    updatedAt: NOW_ISO,
  },
  indicators: {},
  recommendation: {
    signal: "NEUTRAL",
    score: 0,
    confidence: 0,
    reasons: [],
  },
  financials: [],
  holdings: [],
  news: [],
};

const F_OPTION_SIGNALS_CLOSED = {
  signals: [],
  marketStatus: {
    marketOpen: false,
    serverIst: SERVER_IST,
    reason: "BEFORE_OPEN",
  },
  providerConfigured: true,
  kiteSessionActive: false,
  setupState: null,
};

const F_OPTION_SIGNAL_HISTORY = {
  signals: [],
  marketStatus: null,
  generatedAt: NOW_ISO,
};

const F_OPTION_SIGNAL_REPORT_DATES: unknown[] = [];

// OptionChainResponse shape — rows:[] required (not strikes:[])
const F_OPTION_CHAIN_UNAVAILABLE = {
  underlying: "NIFTY",
  underlyingName: "Nifty 50",
  spot: 24500,
  prevClose: 24450,
  changePercent: 0.2,
  expiry: "",
  expiries: [],
  atmStrike: 24500,
  strikeStep: 50,
  lotSize: 25,
  rows: [],
  source: "NSE",
  generatedAt: NOW_ISO,
  provenance: null,
  marketStatus: {
    marketOpen: false,
    serverIst: SERVER_IST,
    reason: "BEFORE_OPEN",
  },
};

const F_OI_INSIGHTS = {
  insights: [],
  summary: null,
  asOf: null,
  marketStatus: {
    marketOpen: false,
    serverIst: SERVER_IST,
    reason: "BEFORE_OPEN",
  },
};

const F_PAPER_ACCOUNT = {
  lane: "EQ",
  balance: 100000,
  seed: 100000,
  deployed: 0,
  openCount: 0,
  currentValue: 100000,
  unrealizedPnl: 0,
  unrealizedPnlPct: 0,
  lifetimeRealizedPnl: 0,
  dayPnl: null,
  dayPnlPct: null,
  drawdownPct: 0,
  drawdownCapPct: 0.15,
  killSwitchActive: false,
  openThrottleCount: 0,
  maxOpen: 5,
  capitalDeployed: 0,
};

const F_PAPER_POSITIONS_FO = {
  positions: [],
  closedToday: [],
  account: F_PAPER_ACCOUNT,
  killSwitchActive: false,
  environment: { env: "PAPER", autoTradingEnabled: false, reason: "kill_switch_active" },
};

const F_PAPER_POSITIONS_EQ = {
  positions: [],
  summary: {
    openCount: 0,
    invested: 0,
    currentValue: 0,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
  },
  account: F_PAPER_ACCOUNT,
  killSwitchActive: false,
};

const F_PAPER_TRADES_EQ = {
  trades: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

const F_PAPER_TRADES_FO = {
  trades: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

const F_PAPER_REPORT_MONTHLY = {
  months: [],
  totals: { realizedPnl: 0, winCount: 0, lossCount: 0, totalCount: 0 },
};

const F_PAPER_COMBOS: unknown[] = [];

const F_WATCHLIST_BASKET = {
  basket: [],
  missing: [],
  provenance: {
    source: "kite",
    stale: false,
    asOf: null,
    missingSymbols: [],
  },
};

const F_WATCHLIST_ITEMS: unknown[] = [];

// SwingStatusResponse = { execution: SwingExecutionStatus, killSwitch: SwingKillSwitchState }
const F_SWING_STATUS = {
  execution: {
    mode: "paper_only",
    liveCashSwingOrderEnabled: false,
    brokerExecutionEnabled: false,
    brokerStatus: "DISABLED",
    summary: "Paper-only mode — broker execution disabled.",
  },
  killSwitch: {
    enabled: false,
    reason: null,
    updatedAt: null,
    updatedBy: null,
  },
  ttlSweep: {
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
  },
};

const F_SWING_STAGED_ORDERS = {
  orders: [],
  total: 0,
};

const F_SWING_TTL_SWEEP = {
  enabled: true,
  lastRunAt: null,
  nextRunAt: null,
};

const F_PORTFOLIOS: unknown[] = [];

const F_BACKTEST_RUNS = {
  runs: [],
  total: 0,
};

const F_BACKTEST_COVERAGE = {
  covered: false,
  availableFrom: null,
  availableTo: null,
};

const F_BACKTEST_STRATEGIES = {
  strategies: [],
};

const F_MARKET_TREND = {
  trend: "NEUTRAL",
  confidence: 0.5,
  breadth: {
    advancers: 0,
    decliners: 0,
    unchanged: 0,
    advanceDeclineRatio: null,
  },
  asOf: NOW_MS,
  provenance: null,
};

const F_MARKET_SUMMARY = {
  indices: [],
  asOf: null,
};

const F_MARKET_GLOBAL = {
  // Production-shaped GlobalMarket: includes VIX so "US VIX" label renders
  indices: [
    { symbol: "GIFTNIFTY",  name: "GIFT NIFTY",              price: 24987.5, change:  62.5,  changePercent:  0.25, asOf: Math.floor(Date.now()/1000) },
    { symbol: "^VIX",       name: "CBOE Volatility Index",   price:  16.42,  change:  -0.31, changePercent: -1.85, asOf: Math.floor(Date.now()/1000) },
    { symbol: "DX-Y.NYB",   name: "US Dollar Index",         price: 104.23,  change:  -0.18, changePercent: -0.17, asOf: Math.floor(Date.now()/1000) },
    { symbol: "^INDIAVIX",  name: "India VIX",               price:  13.45,  change:  -0.22, changePercent: -1.61, asOf: Math.floor(Date.now()/1000) },
    { symbol: "CL=F",       name: "Crude Oil WTI",           price:  73.82,  change:   0.95, changePercent:  1.30, asOf: Math.floor(Date.now()/1000) },
  ],
  lastUpdated: NOW_ISO,
};

// PreMarketReport returned directly by /api/market/premarket (not wrapped)
// sentiment is a PreMarketSentiment enum string; generatedAt is required for
// formatDistanceToNow(); overnightCues and indexPreviews are required arrays.
const F_MARKET_PREMARKET = {
  mode: "PRE_MARKET",
  sentiment: "NEUTRAL",
  sentimentScore: 0,
  narrative: "No overnight data — market closed, fixture mode.",
  keyTakeaways: [],
  overnightCues: [],
  indexPreviews: [],
  scenarios: [],
  generatedAt: NOW_ISO,
};

const F_MARKET_EVENTS = {
  events: [],
  upcomingEvents: [],
  asOf: null,
};

const F_MACRO_HISTORY = {
  series: [],
  asOf: null,
};

const F_SECTORS: unknown[] = [];

const F_SECTOR_DETAIL = {
  sector: "Technology",
  stocks: [],
  performance: null,
  asOf: null,
};

const F_HOME_ENRICHMENT = {
  breadth: null,
  sentimentScore: null,
  mmiScore: null,
  mmi: null,
};

const F_INDICES = {
  india: [],
  global: [],
};

// FnoBanListResponse = { count: number; symbols: string[] }
const F_FNO_BAN_LIST = {
  count: 0,
  symbols: [],
  asOf: null,
};

const F_PARTICIPANT_OI = {
  data: [],
  series: [],
  asOf: null,
};

const F_DATA_DIAGNOSTICS = {
  status: "unavailable",
  providers: [],
  asOf: null,
};

const F_HEALTHZ = { status: "ok" };

const F_FII_DII = {
  data: [],
  categories: [],
  asOf: null,
};

// FiiDiiResponse — production-shaped data for /api/inst/fii-dii.
// July 2026: niftytrader source (fiiBuy=0, fiiSell=0) → monthly view shows "—" for gross.
// August 2026: NSE source with real gross values → monthly view shows actual numbers.
const F_FII_DII_FULL = {
  months: [
    {
      month: "2026-08",
      label: "Aug 2026",
      fiiBuy:  42_350,
      fiiSell: 38_810,
      fiiNet:    3_540,
      diiBuy:  28_620,
      diiSell: 24_190,
      diiNet:    4_430,
      daysCount: 5,
      days: [
        { date: "2026-08-01", fiiBuy: 9_200, fiiSell: 8_100, fiiNet:  1_100, diiBuy: 6_400, diiSell: 5_200, diiNet: 1_200, source: "nse", niftyClose: 24800, niftyChangePct:  0.42 },
        { date: "2026-08-02", fiiBuy: 7_800, fiiSell: 8_500, fiiNet:   -700, diiBuy: 5_100, diiSell: 4_900, diiNet:   200, source: "nse", niftyClose: 24740, niftyChangePct: -0.24 },
        { date: "2026-08-04", fiiBuy: 9_450, fiiSell: 7_200, fiiNet:  2_250, diiBuy: 5_800, diiSell: 4_800, diiNet: 1_000, source: "nse", niftyClose: 24900, niftyChangePct:  0.65 },
        { date: "2026-08-05", fiiBuy: 8_900, fiiSell: 7_710, fiiNet:  1_190, diiBuy: 6_020, diiSell: 5_290, diiNet:   730, source: "nse", niftyClose: 24987, niftyChangePct:  0.35 },
        { date: "2026-08-06", fiiBuy: 7_000, fiiSell: 7_300, fiiNet:   -300, diiBuy: 5_300, diiSell: 4_000, diiNet: 1_300, source: "nse", niftyClose: 24950, niftyChangePct: -0.15 },
      ],
    },
    {
      // Net-only month (niftytrader source): fiiBuy=0, fiiSell=0 → "—" in monthly view
      month: "2026-07",
      label: "Jul 2026",
      fiiBuy: 0,
      fiiSell: 0,
      fiiNet: -8_420,
      diiBuy: 0,
      diiSell: 0,
      diiNet: 11_340,
      daysCount: 23,
      days: [
        { date: "2026-07-01", fiiBuy: 0, fiiSell: 0, fiiNet: -620, diiBuy: 0, diiSell: 0, diiNet: 480, source: "niftytrader", niftyClose: 24200, niftyChangePct: -0.18 },
        { date: "2026-07-02", fiiBuy: 0, fiiSell: 0, fiiNet:  310, diiBuy: 0, diiSell: 0, diiNet: 540, source: "niftytrader", niftyClose: 24260, niftyChangePct:  0.25 },
        { date: "2026-07-03", fiiBuy: 0, fiiSell: 0, fiiNet: -890, diiBuy: 0, diiSell: 0, diiNet: 620, source: "niftytrader", niftyClose: 24180, niftyChangePct: -0.33 },
      ],
    },
  ],
  generatedAt: NOW_ISO,
};

// Production-shaped F&O paper account: balance ≈ ₹8.06 L, seed ₹1 L.
// netVsSeed = balance + dayRealizedPnl − seedCapital = 805 901 + 460 − 100 000 = 706 361
// This makes the ₹460 trade P&L clearly secondary to the ₹7 L capital delta.
const F_PAPER_ACCOUNT_FNO = {
  lane: "FNO",
  balance: 805_901,
  seed: 100_000,
  seedCapital: 100_000,
  deployed: 0,
  openCount: 0,
  currentValue: 805_901,
  unrealizedPnl: 0,
  unrealizedPnlPct: 0,
  lifetimeRealizedPnl: 15_030,
  dayRealizedPnl: 460,
  dayPnl: 460,
  dayPnlPct: 0.057,
  drawdownPct: 0,
  drawdownCapPct: 0.05,
  killSwitchActive: false,
  openThrottleCount: 0,
  maxOpen: 5,
  capitalDeployed: 0,
  maxLossPctPerTrade: 0.02,
  riskBase: 805_901,
  dailyTradeCap: 3,
  dayTradeCount: 2,
};

// FoDailySummary — zero decided trades → intraday report shows 0 opens and no win rate.
const F_FO_DAILY_SUMMARY = {
  date: "2026-08-05",
  signalsGenerated: 12,
  tradesOpened: 0,
  tradesOpenedByTier: { BASELINE: 0, HC: 0 },
  validCandidates: 0,
  tradeOpenRate: null,
  skipped: {
    total: 12,
    byReason: [
      { key: "MARKET_CLOSED", count: 10 },
      { key: "DATA_QUALITY_DELAYED", count: 2 },
    ],
  },
};

// Exit monitor status — healthy subsystems, no open positions to monitor.
const subsystemOk = { severity: "ok", label: "OK", detail: null };
const F_FO_EXIT_MONITOR_STATUS = {
  generatedAt: NOW_ISO,
  exitMonitor:     { ...subsystemOk, monitoredIds: [], cycleMs: null, lastCycleAt: null },
  premiumOverlay:  subsystemOk,
  orphanExit:      subsystemOk,
  mtmSweep:        subsystemOk,
  timeExit1520:    subsystemOk,
  globalDataHealth: { severity: "ok", kiteConnected: true, dataFreshMs: null },
};

// Missed signals — empty list.
const F_FO_MISSED = { missed: [], generatedAt: NOW_ISO };

// Shadow exits — enabled, no eligible MFE trades yet.
const F_FO_SHADOW_EXITS = {
  enabled: true,
  mfeAvailableCount: 0,
  rawRowCount: 0,
  processedRowCount: 0,
  rowCount: 0,
  lowSampleWarning: true,
  lowSampleThreshold: 20,
  byIndex: [],
  bySetup: [],
  byTier: [],
};

// MTM sweep — last success null (not run today, market closed).
const F_FO_MTM_SWEEP = { lastSuccessAt: null };

// FoAnalytics — wins=0, losses=0 → Largest Win and Largest Loss render "—".
// totalRealizedPnl ≈ ₹15,030 (cumulative from prior months).
const F_FO_ANALYTICS = {
  wins: 0,
  losses: 0,
  totalTrades: 0,
  winRate: null,
  totalRealizedPnl: 15_030,
  avgWin: 0,
  avgLoss: 0,
  largestWin: 0,
  largestLoss: 0,
  profitFactor: 0,
  expectancy: 0,
  avgRMultiple: null,
  rMultipleSamples: 0,
  maxDrawdown: 0,
  currentDrawdown: 0,
  peakEquity: 15_030,
  exitReasonCounts: {},
  bySetup: [],
  equityCurve: [],
  generatedAt: NOW_ISO,
};

// OI Lab universe — { indices: string[], stocks: string[], source, count }
const F_OI_LAB_UNIVERSE = {
  indices: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"],
  stocks: ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
    "SBIN", "BAJFINANCE", "AXISBANK", "LT", "ITC",
    "WIPRO", "ONGC", "NTPC", "COALINDIA", "MARUTI"],
  source: "fallback",
  count: 20,
  note: "Connect Kite (Live Feed → Connect) to load the full live F&O universe.",
};

// OI Lab bulk snapshot — production-shaped rendered data for NIFTY.
// sentimentLabel is shown in "Market Sentiment (based on OI)" badge.
const F_OI_LAB_SNAPSHOT = {
  items: [
    {
      underlying: "NIFTY",
      spot: 24987,
      expiry: "2026-08-14",
      sentimentLabel: "Mildly Bullish (based on OI)",
      sentimentScore: 0.62,
      pcrOi: 1.24,
      pcrVolume: 1.11,
      maxPain: 24800,
      totalCallOi: 12_450_000,
      totalPutOi: 15_450_000,
      callOiAdded: 825_000,
      putOiAdded: 1_140_000,
      atmIv: 12.4,
      ivPercentile: 0.38,
      ivRank: 0.31,
      topResistance: [{ strike: 25000, callOi: 4_200_000 }, { strike: 25200, callOi: 3_100_000 }],
      topSupport:    [{ strike: 24800, putOi:  3_800_000 }, { strike: 24600, putOi:  2_900_000 }],
      windowBufferCount: 0,
      windowMode: "none",
      generatedAt: NOW_ISO,
    },
  ],
};

// OI Lab insights for individual underlying.
// windowBufferCount=0 triggers "No snapshots buffered" in windowed mode.
// Fields required by UnderlyingPicker: expiries[], changePercent, atmStrike, strikeStep.
const F_OI_LAB_INSIGHTS_NIFTY = {
  underlying: "NIFTY",
  spot: 24987,
  change: 87.5,
  changePercent: 0.35,
  expiry: "2026-08-14",
  expiries: ["2026-08-14", "2026-08-21", "2026-08-28", "2026-09-25"],
  atmStrike: 25000,
  strikeStep: 50,
  lotSize: 25,
  sentiment: "MILDLY_BULLISH",
  sentimentLabel: "Mildly Bullish (based on OI)",
  sentimentScore: 0.62,
  kiteAuthenticated: true,
  pcrOi: 1.24,
  pcrVolume: 1.11,
  maxPain: 24800,
  totalCallOi: 12_450_000,
  totalPutOi: 15_450_000,
  callOiAdded: 825_000,
  putOiAdded: 1_140_000,
  atmIv: 12.4,
  ivPercentile: 0.38,
  ivRank: 0.31,
  topResistance: [{ strike: 25000, callOi: 4_200_000 }, { strike: 25200, callOi: 3_100_000 }],
  topSupport:    [{ strike: 24800, putOi:  3_800_000 }, { strike: 24600, putOi:  2_900_000 }],
  strikes: [],
  windowBufferCount: 0,
  windowMode: "none",
  windowBaselineAt: null,
  windowBufferOldestAt: null,
  windowTotals: null,
  windowPcr: null,
  marketStatus: { marketOpen: false, serverIst: SERVER_IST, reason: "AFTER_CLOSE" },
  generatedAt: NOW_ISO,
};

// Full NSE scan — production-shaped result (paginated with aggregate counts).
const F_SCAN_FULL_NSE = {
  rows: [],
  total: 0,
  universeSize: 8_891,
  filtered: 0,
  failures: 50,
  rested: 8_841,
  stale: false,
  sourceDate: "2026-08-05",
  lastUpdated: Date.now() - 120_000,
  scanMs: 38_400,
};

// Full NSE scan status — lightweight status without row payload.
const F_SCAN_FULL_NSE_STATUS = {
  hasCache: true,
  lastUpdated: Date.now() - 120_000,
  total: 8_891,
  rows: 8_841,
  failures: 50,
  rested: 8_841,
  sourceDate: "2026-08-05",
  scanMs: 38_400,
  progress: { running: false, scanned: 8_891, total: 8_891, startedAt: null },
  ageMs: 120_000,
  stale: false,
  universeEstimate: 8_891,
};

const F_OPTION_STRATEGIES: unknown[] = [];

// GetOptionAnalyticsResponse shape — all required fields
const F_OPTION_ANALYTICS = {
  underlying: "NIFTY",
  spot: 24500,
  expiry: "2026-08-07",
  pcrOi: 1.0,
  pcrVolume: 0.9,
  maxPain: 24450,
  atmIv: null,
  ivPercentile: null,
  ivRank: null,
  totalCallOi: 0,
  totalPutOi: 0,
  callOiAdded: 0,
  putOiAdded: 0,
  topResistance: [],
  topSupport: [],
  marketStatus: "closed",
  generatedAt: NOW_ISO,
};

// F_STOCK_HISTORY — for /api/stocks/:symbol/history (price history candles, Candle.t is Date)
// Three ascending weekly bars for RELIANCE to satisfy Gate B1 chart requirement.
const F_STOCK_HISTORY = {
  symbol: "RELIANCE",
  range: "3m",
  candles: [
    { t: "2026-07-21T03:45:00.000Z", o: 2801, h: 2830, l: 2795, c: 2820, v: 820000 },
    { t: "2026-07-28T03:45:00.000Z", o: 2820, h: 2860, l: 2812, c: 2850, v: 915000 },
    { t: "2026-08-04T03:45:00.000Z", o: 2855, h: 2910, l: 2849, c: 2897, v: 1048000 },
  ],
  ema20Series: [null, 2820, 2832],
  ema50Series: [null, null, 2851],
  rsiSeries: [null, 58, 63],
};

// ChartCandlesResponse — full contract shape with 10 ascending daily bars.
// t is epoch seconds (UTC), OHLCV values represent NIFTY 50 index data.
const F_CHART_CANDLES = {
  symbol: "NIFTY",
  segment: "index",
  timeframe: "1D",
  source: "yahoo",
  fresh: false,
  asOf: 1754265300,
  candles: [
    { t: 1752969300, o: 24200, h: 24380, l: 24150, c: 24310, v: 125000 },
    { t: 1753055700, o: 24310, h: 24450, l: 24260, c: 24390, v: 142000 },
    { t: 1753142100, o: 24390, h: 24520, l: 24300, c: 24480, v: 138000 },
    { t: 1753228500, o: 24480, h: 24600, l: 24420, c: 24550, v: 155000 },
    { t: 1753314900, o: 24550, h: 24680, l: 24480, c: 24620, v: 167000 },
    { t: 1753574100, o: 24620, h: 24750, l: 24580, c: 24700, v: 148000 },
    { t: 1753660500, o: 24700, h: 24820, l: 24640, c: 24780, v: 162000 },
    { t: 1753746900, o: 24780, h: 24900, l: 24720, c: 24860, v: 171000 },
    { t: 1753833300, o: 24860, h: 24980, l: 24800, c: 24940, v: 158000 },
    { t: 1754265300, o: 24940, h: 25100, l: 24880, c: 25000, v: 189000 },
  ],
};

const F_ETF_QUOTE = {
  price: null,
  nav: null,
  asOf: null,
};

// ── New fixtures for Gate B (four missing visual routes) ──────────────────────

// ChartInstrumentsResponse — for /api/chart/instruments?q=...
const F_CHART_INSTRUMENTS = {
  query: "NIFTY",
  instruments: [
    {
      symbol: "NIFTY",
      name: "Nifty 50",
      segment: "index",
      exchange: "NSE",
      type: "Index",
      source: "curated",
    },
    {
      symbol: "BANKNIFTY",
      name: "Nifty Bank",
      segment: "index",
      exchange: "NSE",
      type: "Index",
      source: "curated",
    },
    {
      symbol: "RELIANCE",
      name: "Reliance Industries Ltd.",
      segment: "equity",
      exchange: "NSE",
      type: "Equity",
      source: "kite_master",
    },
  ],
};

// GetNewsResponse — for /api/news?symbol=...
// Component uses `(news ?? []).map(...)` so the endpoint returns NewsItem[] directly.
const F_NEWS_RESULT: unknown[] = [
  {
    id: "n-fixture-1",
    title: "Reliance Industries Q1 FY27 Results Beat Estimates — Net Profit Up 12%",
    source: "Economic Times",
    url: "https://example.com/news/reliance-q1-fy27",
    publishedAt: NOW_ISO,
    summary: "Reliance Industries reported Q1 FY27 net profit of ₹19,400 Cr, up 12% YoY, beating Street estimates.",
    symbol: "RELIANCE",
    sentiment: "positive",
  },
  {
    id: "n-fixture-2",
    title: "SEBI Circular: Enhanced Disclosure Norms for F&O Participants",
    source: "NSE Circular",
    url: "https://example.com/news/sebi-fno-disclosure",
    publishedAt: NOW_ISO,
    summary: "SEBI has issued new circular on enhanced disclosure requirements for F&O participants.",
    symbol: null,
    sentiment: "neutral",
  },
];

// PortfolioListResponse — { items: PortfolioSummary[] }
const F_PORTFOLIO_LIST = {
  items: [
    {
      id: "fixture-portfolio-demo",
      name: "Demo Portfolio",
      isDefault: true,
      holdingsCount: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    },
  ],
};

// Portfolio — full record with holdings: one priced (RELIANCE), one unpriced (HDFCBANK)
const F_PORTFOLIO_FULL = {
  id: "fixture-portfolio-demo",
  name: "Demo Portfolio",
  isDefault: true,
  benchmark: "NIFTY",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  holdings: [
    {
      id: "h1",
      symbol: "RELIANCE",
      name: "Reliance Industries Ltd.",
      exchange: "NSE",
      sector: "Energy",
      purchaseDate: "2024-03-12",
      qty: 25,
      rate: 2450,
      isin: null,
      broker: null,
      tag: null,
      notes: null,
      dividendReceived: null,
      realisedPnl: null,
      manualCmp: null,
      sortIndex: 0,
    },
    {
      id: "h2",
      symbol: "HDFCBANK",
      name: "HDFC Bank Ltd.",
      exchange: "NSE",
      sector: "Banking",
      purchaseDate: "2023-11-20",
      qty: 40,
      rate: 1520,
      isin: null,
      broker: null,
      tag: null,
      notes: null,
      dividendReceived: null,
      realisedPnl: null,
      manualCmp: null,
      sortIndex: 1,
    },
  ],
};

// DailyAnalysisHistory — for /api/daily-analysis/history?limit=30
const F_DAILY_ANALYSIS_HISTORY = {
  history: [
    {
      reportType: "pre_market",
      istDate: "2026-08-05",
      status: "success",
      workerId: "worker-1",
      startedAt: "2026-08-05T02:30:00.000Z",
      sentAt: "2026-08-05T02:32:41.000Z",
      telegramStatus: "sent",
      errorCode: null,
      createdAt: "2026-08-05T02:30:00.000Z",
    },
    {
      reportType: "post_market",
      istDate: "2026-08-04",
      status: "success",
      workerId: "worker-1",
      startedAt: "2026-08-04T10:35:00.000Z",
      sentAt: "2026-08-04T10:37:12.000Z",
      telegramStatus: "sent",
      errorCode: null,
      createdAt: "2026-08-04T10:35:00.000Z",
    },
    {
      reportType: "pre_market",
      istDate: "2026-08-04",
      status: "failed",
      workerId: "worker-1",
      startedAt: "2026-08-04T02:30:00.000Z",
      sentAt: null,
      telegramStatus: null,
      errorCode: "SOURCE_NOT_INTEGRATED",
      createdAt: "2026-08-04T02:30:00.000Z",
    },
  ],
  count: 3,
};

// StockFundamentals — for /api/data/fundamentals/:symbol
const F_STOCK_FUNDAMENTALS = {
  ok: true,
  symbol: "RELIANCE",
  fetchedAt: NOW_ISO,
  providerState: "NOT_CONFIGURED",
  plan: null,
  profile: null,
  ratios: null,
  warnings: ["IndianAPI provider not configured — fundamentals unavailable"],
  meta: {
    source: "indianapi",
    trustTier: "REFERENCE",
    asOf: null,
    fetchedAt: NOW_ISO,
    notForSignals: true,
    notForTradeDecisions: true,
    validationStatus: "NOT_CONFIGURED",
    warnings: ["Provider key not configured"],
  },
};

// ── URL pattern → fixture map ─────────────────────────────────────────────────

type FixtureEntry = {
  test: (url: string, method: string) => boolean;
  data: unknown;
  status?: number;
};

function url(u: string): (s: string) => boolean {
  return (s) => s.includes(u);
}

const FIXTURES: FixtureEntry[] = [
  // Auth
  { test: url("auth/me"), data: F_AUTH_OWNER },

  // Health
  { test: url("/api/healthz"), data: F_HEALTHZ },

  // Market data
  { test: url("/api/market/summary"), data: F_MARKET_SUMMARY },
  { test: url("/api/market/global"), data: F_MARKET_GLOBAL },
  { test: url("/api/market/trend"), data: F_MARKET_TREND },
  { test: url("/api/market/macroHistory"), data: F_MACRO_HISTORY },
  { test: url("/api/market/premarket"), data: F_MARKET_PREMARKET },
  { test: url("/api/market/events"), data: F_MARKET_EVENTS },

  // Indices
  { test: url("/api/indices"), data: F_INDICES },

  // Home
  { test: url("/api/home/enrichment"), data: F_HOME_ENRICHMENT },

  // Scan — full-nse status/result before generic /api/scan
  { test: url("/api/scan/full-nse/status"), data: F_SCAN_FULL_NSE_STATUS },
  { test: (u) => u.includes("/api/scan/full-nse") && !u.includes("/status") && !u.includes("/export"), data: F_SCAN_FULL_NSE },
  { test: url("/api/scan/top"), data: F_TOP_SCANS },
  { test: url("/api/scan/health"), data: F_SCAN_HEALTH },

  // Stocks — most specific patterns first
  // History candle bars (/api/stocks/:symbol/history)
  { test: (u) => /\/api\/stocks\/[A-Z0-9&%:.]+\/history/.test(u), data: F_STOCK_HISTORY },
  // Statements (/api/stocks/:symbol/statements)
  { test: (u) => u.includes("/statements"), data: { history: [], asOf: null } },
  // HDFCBANK returns null price to prove honest unavailable rendering in Portfolio
  { test: (u) => /\/api\/stocks\/HDFCBANK(\?.*)?$/.test(u), data: F_STOCK_DETAIL_UNPRICED },
  // General stock detail
  { test: (u) => /\/api\/stocks\/[A-Z0-9&%:.]+(\?.*)?$/.test(u), data: F_STOCK_DETAIL },
  // Stock list
  { test: (u) => u.includes("/api/stocks") && !u.match(/\/api\/stocks\/[A-Z]/), data: F_STOCKS_EMPTY },

  // News
  { test: url("/api/news"), data: F_NEWS_RESULT },

  // Sectors
  { test: (u) => /\/api\/sectors\/[^?]+/.test(u), data: F_SECTOR_DETAIL },
  { test: (u) => u.includes("/api/sectors") && !u.match(/\/api\/sectors\/[^?]/), data: F_SECTORS },

  // FNO ban list
  { test: url("/api/inst/fno-ban"), data: F_FNO_BAN_LIST },
  { test: url("/api/inst/participant-oi"), data: F_PARTICIPANT_OI },
  { test: url("/api/inst/refresh"), data: { ok: true }, status: 200 },

  // OI Lab — universe + bulk snapshot + per-underlying insights (most specific first)
  { test: url("/api/options/oi-lab/universe"), data: F_OI_LAB_UNIVERSE },
  { test: (u, m) => u.includes("/api/options/oi-lab/snapshot") && m === "POST", data: F_OI_LAB_SNAPSHOT },
  // Insights returns 503 "kite_login_required" — renders the clean error state instead
  // of crashing on complex field accesses. Gate 2.5 text (sentimentLabel, bufferCount)
  // is verified by p25b.gate3and4 tests (34 passing).
  { test: (u) => /\/api\/options\/oi-lab\/insights\//.test(u), status: 503, data: {
    error: "kite_login_required",
    detail: "OI Insights needs an active Kite session. Open the Live Feed page and complete the daily login first.",
    kiteAuthenticated: false,
  } },

  // Options & FNO signals — more specific before less
  { test: url("/api/options/signal-report/dates"), data: F_OPTION_SIGNAL_REPORT_DATES },
  { test: url("/api/options/signal-report"), data: F_PAPER_REPORT_MONTHLY },
  { test: url("/api/options/signal-history"), data: F_OPTION_SIGNAL_HISTORY },
  { test: url("/api/options/signals"), data: F_OPTION_SIGNALS_CLOSED },
  { test: url("/api/options/chain/"), data: F_OPTION_CHAIN_UNAVAILABLE },
  { test: url("/api/options/strategies/"), data: F_OPTION_STRATEGIES },
  { test: url("/api/oi/"), data: F_OI_INSIGHTS },

  // Option analytics
  { test: url("/api/options/analytics"), data: F_OPTION_ANALYTICS },

  // Paper trading — most specific first
  { test: url("/api/paper/positions/fo"), data: F_PAPER_POSITIONS_FO },
  { test: url("/api/paper/positions/eq"), data: F_PAPER_POSITIONS_EQ },
  { test: url("/api/paper/trades/eq"), data: F_PAPER_TRADES_EQ },
  { test: url("/api/paper/trades/fo"), data: F_PAPER_TRADES_FO },
  // F&O diagnostics (more specific before /api/paper/reports/)
  { test: url("/api/paper/diagnostics/daily-summary/fo"), data: F_FO_DAILY_SUMMARY },
  { test: url("/api/paper/diagnostics/fo/exit-monitor/status"), data: F_FO_EXIT_MONITOR_STATUS },
  { test: url("/api/paper/diagnostics/fo/mtm-sweep"), data: F_FO_MTM_SWEEP },
  // F&O missed signals
  { test: url("/api/paper/missed/fo"), data: F_FO_MISSED },
  { test: url("/api/paper/missed/"), data: F_FO_MISSED },
  // F&O analytics (more specific before generic /api/paper/reports/)
  { test: url("/api/paper/analytics/fo/shadow-exits"), data: F_FO_SHADOW_EXITS },
  { test: url("/api/paper/analytics/fo"), data: F_FO_ANALYTICS },
  { test: url("/api/paper/reports/"), data: F_PAPER_REPORT_MONTHLY },
  { test: url("/api/paper/combos"), data: F_PAPER_COMBOS },
  // FNO-specific account (segment=FNO before generic /api/paper/account)
  { test: (u) => u.includes("/api/paper/account") && u.includes("segment=FNO"), data: F_PAPER_ACCOUNT_FNO },
  { test: url("/api/paper/account"), data: F_PAPER_ACCOUNT },
  // Mutations: POST to close/open / exit-monitor — return ok
  { test: (u, m) => u.includes("/api/paper/diagnostics/fo/exit-monitor") && m === "POST", data: { ok: true } },
  { test: (u, m) => u.includes("/api/paper/") && m === "POST", data: { ok: true } },

  // Watchlist
  { test: url("/api/watchlist/basket/"), data: F_WATCHLIST_BASKET },
  { test: (u) => u.includes("/api/watchlist/") && !u.includes("/basket/"), data: F_WATCHLIST_ITEMS },

  // Swing
  { test: url("/api/swing/ttl-sweep"), data: F_SWING_TTL_SWEEP },
  { test: url("/api/swing/staged-orders"), data: F_SWING_STAGED_ORDERS },
  { test: url("/api/swing/status"), data: F_SWING_STATUS },
  { test: (u, m) => u.includes("/api/swing/") && m === "POST", data: { ok: true } },

  // Portfolio — by ID before general list (url("/api/portfolios") matches both)
  { test: (u) => /\/api\/portfolios\/[^/?]+(\?.*)?$/.test(u), data: F_PORTFOLIO_FULL },
  { test: url("/api/portfolios"), data: F_PORTFOLIO_LIST },

  // Daily analysis — history before status (both contain "/api/daily-analysis")
  { test: url("/api/daily-analysis/history"), data: F_DAILY_ANALYSIS_HISTORY },
  { test: url("/api/daily-analysis/status"), data: {
    prepostTelegram: { enabled: false, status: "disabled" },
    defaultTelegram: { enabled: false, status: "disabled" },
    schedule: {
      preMarket: { time: "08:00", windowMinutes: 15, description: "Pre-market Telegram report" },
      postMarket: { time: "16:00", windowMinutes: 15, description: "Post-market Telegram report" },
    },
    lastPreMarket: null,
    lastPostMarket: null,
    recentHistory: F_DAILY_ANALYSIS_HISTORY.history.slice(0, 3),
    coverage: {},
    brokerExecution: "DISABLED",
    workerDedup: { mechanism: "in-memory", description: "Dedup via in-memory Set" },
  } },
  { test: (u, m) => u.includes("/api/daily-analysis") && m === "POST", data: { ok: true } },
  // Backtest
  { test: url("/api/backtest/fno/snapshot-coverage"), data: F_BACKTEST_COVERAGE },
  { test: url("/api/backtest/fno/strategies"), data: F_BACKTEST_STRATEGIES },
  { test: url("/api/backtest/fno/runs"), data: F_BACKTEST_RUNS },
  { test: (u, m) => u.includes("/api/backtest/") && m === "POST", data: { ok: true } },

  // Chart instruments search
  { test: url("/api/chart/instruments"), data: F_CHART_INSTRUMENTS },
  // Chart candles
  { test: url("/api/chart/candles"), data: F_CHART_CANDLES },

  // ETF
  { test: url("/api/etf/"), data: F_ETF_QUOTE },

  // FII/DII — production-shaped response on real URL first, legacy fallbacks after
  { test: url("/api/inst/fii-dii"), data: F_FII_DII_FULL },
  { test: url("/api/market/fii"), data: F_FII_DII },
  { test: url("/fii"), data: F_FII_DII },

  // Data diagnostics and fundamentals
  { test: url("/api/data/fundamentals/"), data: F_STOCK_FUNDAMENTALS },
  { test: url("/api/data/diagnostics"), data: F_DATA_DIAGNOSTICS },
  { test: url("/api/data/compare"), data: { comparison: null } },
];

// ── Interceptor installation ──────────────────────────────────────────────────

let _installed = false;
const _origFetch = window.fetch.bind(window);

export function installScannerFixtures(): void {
  if (_installed) return;
  _installed = true;

  window.fetch = async function interceptedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    for (const entry of FIXTURES) {
      if (entry.test(rawUrl, method)) {
        const body = JSON.stringify(entry.data);
        return new Response(body, {
          status: entry.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Fallthrough: allow unknown URLs (will likely 401 — that's fine for
    // owner-only endpoints not covered by fixtures).
    return _origFetch(input, init);
  };
}
