/**
 * Dev-only deterministic fixture interceptor for the Global Multi-Asset Scanner.
 *
 * PRODUCTION SAFETY: Only imported inside
 *   `if (import.meta.env.DEV && import.meta.env.VITE_PREVIEW_BYPASS === "true")`
 * Vite replaces `import.meta.env.DEV` with `false` in production → dead code,
 * tree-shaken out of every production bundle.
 *
 * No DB, provider, Telegram, or broker calls. No credentials embedded.
 */

const NOW_ISO = "2026-08-05T10:00:00.000Z";

// ── Fixture payloads ──────────────────────────────────────────────────────────

const F_GLOBAL_AUTH = {
  authenticated: true,
  role: "owner",
};

// GlobalDashboardResponse = { rows: GlobalDashboardRow[] }
// GlobalDashboardRow fields: symbol, displayName, assetClass, source, price?,
//   changePct?, changeAbs?, volume?, updatedAt?, ageMs?, stale, exchange?
const CRYPTO_ROWS = [
  {
    symbol: "BTC/USD", displayName: "Bitcoin", assetClass: "crypto",
    source: "binance", price: 65432.10, changePct: 1.23, changeAbs: 793.4,
    volume: 28_000_000_000, stale: false, updatedAt: NOW_ISO, ageMs: 5000,
  },
  {
    symbol: "ETH/USD", displayName: "Ethereum", assetClass: "crypto",
    source: "binance", price: 3450.00, changePct: -0.54, changeAbs: -18.72,
    volume: 9_500_000_000, stale: false, updatedAt: NOW_ISO, ageMs: 5000,
  },
  {
    symbol: "BNB/USD", displayName: "Binance Coin", assetClass: "crypto",
    source: "binance", price: 572.30, changePct: 0.82, changeAbs: 4.65,
    volume: 1_200_000_000, stale: false, updatedAt: NOW_ISO, ageMs: 5000,
  },
];

const F_GLOBAL_DASHBOARD_CRYPTO = { rows: CRYPTO_ROWS };
const F_GLOBAL_DASHBOARD_COMMODITIES = {
  rows: [
    {
      symbol: "XAU/USD", displayName: "Gold", assetClass: "commodity",
      source: "yahoo", price: 2385.40, changePct: 0.21, changeAbs: 5.0,
      volume: null, stale: true, updatedAt: NOW_ISO, ageMs: 900_000,
    },
    {
      symbol: "XAG/USD", displayName: "Silver", assetClass: "commodity",
      source: "yahoo", price: 30.12, changePct: -0.34, changeAbs: -0.10,
      volume: null, stale: false, updatedAt: NOW_ISO, ageMs: 60_000,
    },
  ],
};
const F_GLOBAL_DASHBOARD_FOREX = {
  rows: [
    {
      symbol: "EUR/USD", displayName: "Euro / US Dollar", assetClass: "forex",
      source: "yahoo", price: 1.0842, changePct: -0.12, changeAbs: -0.0013,
      volume: null, stale: false, updatedAt: NOW_ISO, ageMs: 60_000,
    },
    {
      symbol: "GBP/USD", displayName: "British Pound", assetClass: "forex",
      source: "yahoo", price: 1.2734, changePct: 0.08, changeAbs: 0.001,
      volume: null, stale: false, updatedAt: NOW_ISO, ageMs: 60_000,
    },
  ],
};
const F_GLOBAL_DASHBOARD_EQUITIES = {
  rows: [
    {
      symbol: "AAPL", displayName: "Apple Inc.", assetClass: "equity",
      source: "yahoo", price: 227.52, changePct: 0.32, changeAbs: 0.73,
      volume: 55_000_000, stale: false, updatedAt: NOW_ISO, ageMs: 60_000,
      exchange: "NASDAQ",
    },
  ],
};
const F_GLOBAL_DASHBOARD_INDICES = {
  rows: [
    {
      symbol: "^IXIC", displayName: "NASDAQ Composite", assetClass: "index",
      source: "yahoo", price: 19450.23, changePct: 0.45, changeAbs: 87.1,
      volume: null, stale: false, updatedAt: NOW_ISO, ageMs: 60_000,
      exchange: "NASDAQ",
    },
    {
      symbol: "^NSEI", displayName: "Nifty 50", assetClass: "index",
      source: "yahoo", price: 25000.00, changePct: 0.12, changeAbs: 29.5,
      volume: null, stale: false, updatedAt: NOW_ISO, ageMs: 60_000,
      exchange: "NSE",
    },
  ],
};
const F_GLOBAL_DASHBOARD_WATCHLIST = { rows: [] };

function getGlobalDashboardFixture(rawUrl: string): unknown {
  if (rawUrl.includes("asset=commodities")) return F_GLOBAL_DASHBOARD_COMMODITIES;
  if (rawUrl.includes("asset=forex")) return F_GLOBAL_DASHBOARD_FOREX;
  if (rawUrl.includes("asset=equities")) return F_GLOBAL_DASHBOARD_EQUITIES;
  if (rawUrl.includes("asset=indices")) return F_GLOBAL_DASHBOARD_INDICES;
  if (rawUrl.includes("asset=watchlist")) return F_GLOBAL_DASHBOARD_WATCHLIST;
  return F_GLOBAL_DASHBOARD_CRYPTO; // default / crypto
}

// GlobalWatchlistResponse = { items: GlobalWatchlistItem[] }
const F_GLOBAL_WATCHLIST = {
  items: [],
};

// useListGlobalScreenerPresets returns { items: GlobalScreenerPreset[] }
const F_GLOBAL_SCREENER_PRESETS = { items: [] };

const F_GLOBAL_SCREENER_PRESET_LIBRARY: unknown[] = [];

const F_GLOBAL_SCREENER_RESULT = {
  hits: [],
  evaluatedCandidates: 0,
  indicatorEvaluated: false,
  runAt: NOW_ISO,
};

const F_GLOBAL_INSTRUMENT_DETAIL = {
  instrument: {
    symbol: "BTC/USD",
    displayName: "Bitcoin",
    assetClass: "crypto",
    source: "binance",
    currency: "USD",
    notes: null,
  },
  quote: {
    price: 65432.10,
    changePct: 1.23,
    change: 793.4,
    volume: 28_000_000_000,
    high: 66100,
    low: 64200,
    open: 64639,
    updatedAt: NOW_ISO,
  },
};

const F_GLOBAL_CANDLES = {
  candles: [],
  asOf: null,
};

const F_GLOBAL_INDICATORS = {
  indicators: null,
  asOf: null,
};

const F_GLOBAL_SHARE_PREVIEW = {
  preset: null,
};

// ── URL pattern → fixture map ─────────────────────────────────────────────────

type FixtureEntry = {
  test: (url: string, method: string) => boolean;
  data?: unknown;
  resolve?: (url: string) => unknown;
  status?: number;
};

function url(u: string): (s: string) => boolean {
  return (s) => s.includes(u);
}

const FIXTURES: FixtureEntry[] = [
  // Auth
  { test: url("/api/global/auth/status"), data: F_GLOBAL_AUTH },
  { test: url("/api/global/auth/logout"), data: { ok: true } },

  // Dashboard — per-asset-class fixture data (resolved dynamically from URL params)
  {
    test: url("/api/global/dashboard"),
    resolve: getGlobalDashboardFixture,
  },

  // Watchlist — delete/add are mutations
  { test: (u, m) => u.includes("/api/global/watchlist/") && (m === "DELETE" || m === "POST"), data: { ok: true } },
  { test: url("/api/global/watchlist"), data: F_GLOBAL_WATCHLIST },

  // Instrument detail
  { test: (u) => /\/api\/global\/instruments\/[^/]+(\?.*)?$/.test(u), data: F_GLOBAL_INSTRUMENT_DETAIL },

  // Candles & indicators
  { test: url("/api/global/candles"), data: F_GLOBAL_CANDLES },
  { test: url("/api/global/indicators"), data: F_GLOBAL_INDICATORS },

  // Screener presets — more specific first
  { test: url("/api/global/screener-presets/library"), data: F_GLOBAL_SCREENER_PRESET_LIBRARY },
  { test: url("/api/global/screener-presets/share/"), data: F_GLOBAL_SHARE_PREVIEW },
  { test: (u, m) => u.includes("/api/global/screener-presets") && (m === "POST" || m === "PUT" || m === "DELETE"), data: { ok: true } },
  { test: url("/api/global/screener-presets"), data: F_GLOBAL_SCREENER_PRESETS },

  // Screener run
  { test: (u, m) => u.includes("/api/global/screen") && m === "POST", data: F_GLOBAL_SCREENER_RESULT },
];

// ── Interceptor installation ──────────────────────────────────────────────────

let _installed = false;
const _origFetch = window.fetch.bind(window);

export function installGlobalFixtures(): void {
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
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    for (const entry of FIXTURES) {
      if (entry.test(rawUrl, method)) {
        const payload = entry.resolve ? entry.resolve(rawUrl) : entry.data;
        const body = JSON.stringify(payload);
        return new Response(body, {
          status: entry.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return _origFetch(input, init);
  };
}
