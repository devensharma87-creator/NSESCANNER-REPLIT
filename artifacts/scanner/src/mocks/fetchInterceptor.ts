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

const F_STOCK_DETAIL = {
  symbol: "NIFTY",
  name: "Nifty 50 Index",
  exchange: "NSE",
  price: 25000.00,
  change: 0,
  changePct: 0,
  open: 24900,
  high: 25100,
  low: 24800,
  volume: 0,
  marketCap: null,
  pe: null,
  pb: null,
  fiftyTwoWeekHigh: 26300,
  fiftyTwoWeekLow: 21300,
  sector: "Index",
  asOf: NOW_MS,
  provenance: {
    source: "yahoo",
    stale: false,
    delayed: true,
    canDriveSignals: false,
    asOf: NOW_MS,
    warnings: ["Yahoo Finance — display only, ~15 min delayed"],
    missingSymbols: [],
  },
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
  indices: [],
  asOf: null,
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

const F_STOCK_HISTORY = {
  history: [],
  asOf: null,
};

const F_CHART_CANDLES = {
  candles: [],
  asOf: null,
  instrument: null,
};

const F_ETF_QUOTE = {
  price: null,
  nav: null,
  asOf: null,
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

  // Scan
  { test: url("/api/scan/top"), data: F_TOP_SCANS },
  { test: url("/api/scan/health"), data: F_SCAN_HEALTH },

  // Stocks — detail first (more specific), then list
  { test: (u) => u.includes("/statements"), data: F_STOCK_HISTORY },
  { test: (u) => /\/api\/stocks\/[A-Z0-9&%:.]+(\?.*)?$/.test(u), data: F_STOCK_DETAIL },
  { test: (u) => u.includes("/api/stocks") && !u.match(/\/api\/stocks\/[A-Z]/), data: F_STOCKS_EMPTY },

  // Sectors
  { test: (u) => /\/api\/sectors\/[^?]+/.test(u), data: F_SECTOR_DETAIL },
  { test: (u) => u.includes("/api/sectors") && !u.match(/\/api\/sectors\/[^?]/), data: F_SECTORS },

  // FNO ban list
  { test: url("/api/inst/fno-ban"), data: F_FNO_BAN_LIST },
  { test: url("/api/inst/participant-oi"), data: F_PARTICIPANT_OI },
  { test: url("/api/inst/refresh"), data: { ok: true }, status: 200 },

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
  { test: url("/api/paper/reports/"), data: F_PAPER_REPORT_MONTHLY },
  { test: url("/api/paper/combos"), data: F_PAPER_COMBOS },
  { test: url("/api/paper/account"), data: F_PAPER_ACCOUNT },
  // Mutations: POST to close/open — return ok
  { test: (u, m) => u.includes("/api/paper/") && m === "POST", data: { ok: true } },

  // Watchlist
  { test: url("/api/watchlist/basket/"), data: F_WATCHLIST_BASKET },
  { test: (u) => u.includes("/api/watchlist/") && !u.includes("/basket/"), data: F_WATCHLIST_ITEMS },

  // Swing
  { test: url("/api/swing/ttl-sweep"), data: F_SWING_TTL_SWEEP },
  { test: url("/api/swing/staged-orders"), data: F_SWING_STAGED_ORDERS },
  { test: url("/api/swing/status"), data: F_SWING_STATUS },
  { test: (u, m) => u.includes("/api/swing/") && m === "POST", data: { ok: true } },

  // Portfolio
  { test: url("/api/portfolios"), data: F_PORTFOLIOS },

  // Daily analysis status (DailyAnalysisStatusPanel in premarket page)
  { test: url("/api/daily-analysis/status"), data: {
    prepostTelegram: { enabled: false, status: "disabled" },
    schedule: {
      preMarket: { time: "08:00", description: "Pre-market Telegram report" },
      postMarket: { time: "16:00", description: "Post-market Telegram report" },
    },
    lastPreMarket: null,
    lastPostMarket: null,
    workerDedup: { mechanism: "in-memory", description: "Dedup via in-memory Set" },
  } },
  { test: (u, m) => u.includes("/api/daily-analysis") && m === "POST", data: { ok: true } },
  // Backtest
  { test: url("/api/backtest/fno/snapshot-coverage"), data: F_BACKTEST_COVERAGE },
  { test: url("/api/backtest/fno/strategies"), data: F_BACKTEST_STRATEGIES },
  { test: url("/api/backtest/fno/runs"), data: F_BACKTEST_RUNS },
  { test: (u, m) => u.includes("/api/backtest/") && m === "POST", data: { ok: true } },

  // Chart candles
  { test: url("/api/chart/candles"), data: F_CHART_CANDLES },

  // ETF
  { test: url("/api/etf/"), data: F_ETF_QUOTE },

  // FII/DII
  { test: url("/api/market/fii"), data: F_FII_DII },
  { test: url("/fii"), data: F_FII_DII },

  // Data diagnostics
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
