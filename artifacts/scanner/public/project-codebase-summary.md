# Stock Scanner Pro - Full Codebase Summary

Generated: 2026-05-04

---

## Project Overview

A comprehensive, private Indian-market stock scanner and analysis platform (NSE/BSE) with ambitions for global multi-asset coverage. Built as a pnpm monorepo using TypeScript 5.9, Express 5, React 19.1, Vite 7.3, PostgreSQL (Drizzle ORM), and TanStack Query. Password-protected, owner-only deployment.

**Codebase Stats:**
- 355 TypeScript files
- 73,818 lines of code
- 61 API paths
- 134 OpenAPI schemas
- 17 database tables

---

## Monorepo Structure

```
workspace/
├── artifacts/                        # Deployable applications
│   ├── api-server/                   # Express 5 API backend (port 8080, path /api)
│   ├── scanner/                      # NSE Stock Scanner React frontend (path /)
│   ├── global/                       # Global Multi-Asset Scanner React frontend (path /global)
│   └── mockup-sandbox/               # Component preview server for design iteration
├── lib/                              # Shared libraries (composite, emit declarations)
│   ├── api-spec/                     # OpenAPI 3.0 spec + Orval codegen config
│   ├── api-client-react/             # Generated TanStack Query hooks + custom fetcher
│   ├── api-zod/                      # Generated Zod validation schemas
│   └── db/                           # Drizzle ORM schemas, migrations, DB connection
├── scripts/                          # Utility scripts
├── pnpm-workspace.yaml               # Workspace config, catalog pins, overrides
├── tsconfig.base.json                # Shared strict TS defaults
├── tsconfig.json                     # Root solution config for libs
└── package.json                      # Root task orchestration
```

**Build & Typecheck Commands:**
- `pnpm run typecheck` - Full project typecheck (libs first, then all artifacts)
- `pnpm run typecheck:libs` - Build composite libs only
- `pnpm --filter @workspace/api-spec run codegen` - Regenerate API client + Zod schemas from OpenAPI
- `pnpm --filter @workspace/db run push` - Push DB schema changes

---

## Artifacts (Deployable Applications)

### 1. API Server (`artifacts/api-server`)
- **Package:** `@workspace/api-server`
- **Framework:** Express 5
- **Port:** 8080 (proxied at `/api`)
- **Build:** esbuild (`node ./build.mjs`)
- **Key Dependencies:** express, cors, helmet, kiteconnect, yahoo-finance2, drizzle-orm, zod, pino, pino-http, cookie-parser

### 2. NSE Stock Scanner (`artifacts/scanner`)
- **Package:** `@workspace/scanner`
- **Framework:** React 19.1 + Vite 7.3
- **Preview Path:** `/` (root)
- **Key Dependencies:** TanStack Query, Recharts, Radix UI, Tailwind CSS v4, wouter, lightweight-charts, framer-motion, lucide-react, date-fns

### 3. Global Multi-Asset Scanner (`artifacts/global`)
- **Package:** `@workspace/global`
- **Framework:** React 19.1 + Vite 7.3
- **Preview Path:** `/global/`
- **Key Dependencies:** Same UI stack as scanner + lightweight-charts for charting
- **Scope:** Crypto (Binance), Commodities, Forex, Global Equities/Indices (Yahoo Finance)

### 4. Mockup Sandbox (`artifacts/mockup-sandbox`)
- **Package:** `@workspace/mockup-sandbox`
- **Framework:** Vite dev server for isolated component previews
- **Preview Path:** `/__mockup`

---

## Shared Libraries

### `lib/api-spec` (`@workspace/api-spec`)
- OpenAPI 3.0 YAML specification (`openapi.yaml`)
- Orval config for code generation
- Generates hooks into `lib/api-client-react` and Zod schemas into `lib/api-zod`

### `lib/api-client-react` (`@workspace/api-client-react`)
- Generated TanStack Query hooks from OpenAPI
- Custom fetch wrapper with `credentials: "include"` for cookie auth
- Barrel export from `src/index.ts`

### `lib/api-zod` (`@workspace/api-zod`)
- Generated Zod validation schemas from OpenAPI
- Used server-side for request/response parsing in route handlers
- Barrel export from `src/index.ts`

### `lib/db` (`@workspace/db`)
- PostgreSQL connection via `pg`
- Drizzle ORM schemas and config
- `drizzle-zod` for form validation schemas
- `drizzle-kit` for migrations

---

## Database Schema (17 Tables)

### `paperTrading.ts`
| Table | Description |
|-------|-------------|
| `paper_account` | Per-segment (FNO/EQUITY) paper trading account state: balance, seed capital, daily counters |
| `paper_trade_fo` | F&O paper trades: entry/exit premiums, stops, targets, P&L, journal, tags |
| `paper_trade_eq` | Equity paper trades: entry/exit prices, stops, targets, P&L, journal, tags |

### `optionSignals.ts`
| Table | Description |
|-------|-------------|
| `option_signal_history` | Persisted F&O signal lifecycle: entry, stop, targets, status, MFE/MAE, exit info |

### `globalScanner.ts`
| Table | Description |
|-------|-------------|
| `global_instruments` | Universe of tracked global instruments (crypto, forex, commodities, equities) |
| `global_candles` | OHLCV candle history for global instruments |
| `global_live_prices` | Latest prices/quotes for global instruments |
| `global_watchlist` | User's global instrument watchlist |
| `global_sync_logs` | Data source sync history and error tracking |
| `global_screener_presets` | Saved screener filter presets (shareable via token) |
| `global_instrument_overrides` | Manual override/disable flags for instruments |

### `instFlows.ts`
| Table | Description |
|-------|-------------|
| `fii_dii_daily` | Daily FII/DII buy/sell/net figures |
| `participant_oi_daily` | Per-segment participant OI data (FII/DII/Pro/Client) |

### `kiteSession.ts`
| Table | Description |
|-------|-------------|
| `kite_session` | Active Kite Connect access token (single-row table) |

### `tvAlerts.ts`
| Table | Description |
|-------|-------------|
| `tv_alerts` | Parsed TradingView webhook alert payloads |

### `users.ts`
| Table | Description |
|-------|-------------|
| `users` | Subscriber accounts with subscription info |
| `personal_watchlist` | Per-user personal watchlist entries |

---

## API Server - Route Handlers (89 endpoints across 18 files)

| File | Lines | Endpoints | Domain |
|------|------:|----------:|--------|
| `scanner.ts` | 710 | 24 | Stock scanning, full NSE, deep scan, top scans |
| `paper.ts` | 553 | 13 | Paper trading accounts, positions, trades, reports, journal |
| `kite.ts` | 282 | 11 | Kite Connect auth, session, instruments, ticker |
| `oiLab.ts` | 272 | 10 | OI snapshots, heatmap, intraday tracker, IV skew |
| `userAuth.ts` | 270 | 6 | User registration, login, session, role management |
| `admin.ts` | 174 | 4 | Admin controls, Kite session management |
| `home.ts` | 159 | 1 | Home page enrichment (sparklines, momentum, options) |
| `optionChain.ts` | 125 | 3 | Option chain, analytics, and strategies |
| `optionStrategies.ts` | 90 | 1 | 13 strategy templates with payoff analysis |
| `tradingview.ts` | 80 | 3 | TradingView webhook receiver, alert log |
| `deepscan.ts` | 54 | 2 | Deep scan for individual stocks |
| `instFlows.ts` | 47 | 3 | FII/DII data, participant OI |
| `auth.ts` | 46 | 3 | Password auth, session management |
| `system.ts` | 29 | 2 | System status, security audit |
| `indices.ts` | 28 | 1 | Indices board snapshot |
| `stocksToWatch.ts` | 24 | 1 | News-based catalyst tracking |
| `health.ts` | 11 | 1 | Health check (`/api/healthz`) |
| `global/index.ts` | — | — | Global scanner routes (auth, data, screener, watchlist) |

---

## API Server - Library Modules (Core Logic)

| Module | Lines | Purpose |
|--------|------:|---------|
| `optionSignals.ts` | 1,614 | F&O signal generation: 4 detectors + baseline, context building, vol regime, OI confirmation, lifecycle evaluation, signal cycle orchestration |
| `optionStrategies.ts` | 1,468 | 13 option strategy templates, delta-based strike picking, payoff calculation, liquidity scoring |
| `oiLab.ts` | 1,376 | Bulk OI snapshots, heatmap computation, intraday tracker, IV skew, sentiment scoring |
| `preMarket.ts` | 967 | Pre/post-market report: game plan, key levels, sector heatmap, gap analysis, FII/DII snapshot |
| `optionSignalLifecycle.ts` | 948 | Signal persistence, lifecycle state machine (PENDING -> TRIGGERED -> TARGET/STOPPED/EXPIRED), MFE/MAE tracking |
| `fullNseScanner.ts` | 936 | Full NSE universe scanner: 4200+ stocks, technical scoring, recommendation engine |
| `paperTradingFO.ts` | 793 | F&O paper trade executor: position sizing, risk gates, open/close/MTM, reconciliation |
| `yahoo.ts` | 784 | Yahoo Finance wrapper: quotes, charts, intraday, circuit breaker, 429 retry |
| `watchlistLists.ts` | 733 | Personal watchlist CRUD, multi-list support |
| `instFlows.ts` | 589 | FII/DII daily data, participant OI, data backfill |
| `paperTradingEq.ts` | 560 | Equity paper trade executor: swing entries, stop trailing, time stops |
| `optionChain.ts` | 515 | Option chain orchestration: Kite + NSE fallback, aggregation, max pain |
| `indicesBoard.ts` | 481 | 27 instruments, live LTP, EMAs, VWAP, pivot ladders |
| `kiteAuth.ts` | 488 | Kite Connect OAuth, session management, auto-mirror from production |
| `paperReportsFO.ts` | 486 | F&O paper trade reports: daily, monthly, yearly aggregation |
| `paperReportsEq.ts` | 457 | Equity paper trade reports: daily, monthly, yearly aggregation |
| `deepscan.ts` | 445 | Individual stock deep analysis |
| `scanner.ts` | 443 | Core scanner logic: scoring, ranking, recommendation |
| `universe.ts` | 441 | Curated stock universe management, F&O universe |
| `swingSignals.ts` | 388 | Equity swing signal generation with sector-strength gating |
| `securityAudit.ts` | 387 | 18-check security audit (config, probes, auth, secrets, deps) |
| `marketEvents.ts` | 382 | Holiday calendar, market hours, event scheduling |
| `watchlist.ts` | 354 | Watchlist trend computation |
| `kiteOptionChain.ts` | 348 | Kite-sourced option chain with NFO + BFO instruments |
| `kiteFeed.ts` | 332 | Kite WebSocket ticker: live quotes, auto-reconnect |
| `paperAccount.ts` | 328 | Paper account state: balance, resets, risk caps |
| `systemStatus.ts` | 327 | Real-time subsystem health monitoring |
| `optionAnalytics.ts` | 315 | OI clusters, market read, support/resistance scoring |
| `stocksToWatch.ts` | 311 | News RSS catalyst detection, symbol resolution |
| `kiteIntraday.ts` | 297 | Kite historical intraday data fetcher |
| `scoring.ts` | 282 | Technical scoring engine for stock recommendations |
| `kiteScanner.ts` | 265 | Kite-accelerated scanner overlay |
| `indicators.ts` | 255 | Technical indicators: EMA, RSI, VWAP, ADX (Wilder RMA), ATR, pivots, volume profile |
| `userAuth.ts` | 257 | User authentication: HMAC-SHA256 cookies, rate limiting |
| `symbolAlias.ts` | 255 | Symbol normalization and alias resolution |
| `tradingViewAlerts.ts` | 211 | TradingView webhook parsing and persistence |
| `newsRss.ts` | 203 | RSS feed aggregation from 21 sources |
| `nseBhavcopy.ts` | 185 | NSE bhavcopy (delivery %) data loader |
| `blackScholes.ts` | 175 | Black-Scholes pricing model, Greeks calculation |
| `liveBias.ts` | 181 | Live market bias computation |
| `giftNifty.ts` | 162 | GIFT Nifty data from TradingView |
| `auth.ts` | 145 | Password auth middleware |
| `marketTrend.ts` | 141 | Market trend classification |
| `globalIndices.ts` | 144 | Global indices tracking |
| `kiteIndexQuotes.ts` | 120 | Kite live index quote fetcher |
| `financials.ts` | 99 | Company financial data (P&L, balance sheet, cash flow) |
| `diskCache.ts` | 80 | Disk-based JSON caching layer |
| `csvExport.ts` | 67 | CSV export utility for signal reports |
| `kiteFnoInstruments.ts` | 55 | Kite F&O instrument loader |
| `dataProvider.ts` | 50 | Active data provider state (kite/yahoo) |
| `tradingConfig.ts` | 43 | Central trading config: thresholds, data quality, vol regime |
| `logger.ts` | 20 | Pino logger singleton |
| `global/` | 2,619 | Global scanner: Binance, Yahoo, screener, universe, indicators, presets |

---

## Scanner Frontend - Pages (26 pages)

| Page | Lines | Route | Purpose |
|------|------:|-------|---------|
| `oi-lab.tsx` | 2,467 | `/oi-lab` | OI heatmap, intraday tracker, IV skew, sentiment |
| `learn.tsx` | 1,322 | `/learn` | Educational content: futures, options, trading psychology |
| `option-chain.tsx` | 1,261 | `/option-chain/:symbol` | Interactive option chain with Greeks, filters, sorting |
| `options.tsx` | 1,161 | `/options` | F&O intraday signals: Live + Report tabs |
| `paper-trading.tsx` | 1,032 | `/paper-trading` | Paper trading dashboard: F&O + Equity tabs, positions, closed trades, journal |
| `paper-reports.tsx` | 989 | `/paper-reports` | Monthly/yearly paper trade performance reports |
| `flows.tsx` | 978 | `/flows` | FII/DII flows, participant OI analysis |
| `strategies.tsx` | 805 | `/strategies` | 13 option strategy templates with payoff charts |
| `deep-scan.tsx` | 730 | `/deep-scan/:symbol` | Individual stock deep analysis |
| `premarket.tsx` | 676 | `/premarket` | Pre-market report: game plan, key levels, sectors |
| `scanner.tsx` | 573 | `/scanner` | Full NSE stock scanner with filters |
| `watchlist.tsx` | 545 | `/watchlist` | Personal watchlist management |
| `admin.tsx` | 405 | `/admin` | Admin panel: Kite session, system controls |
| `manifesto.tsx` | 391 | `/manifesto` | Trading manifesto / philosophy |
| `stock-detail.tsx` | 376 | `/stock/:symbol` | Individual stock detail page |
| `kite.tsx` | 367 | `/kite` | Kite Connect setup and session management |
| `news.tsx` | 287 | `/news` | Market news and catalysts |
| `index-detail.tsx` | 234 | `/index/:symbol` | Individual index detail page |
| `dashboard.tsx` | 226 | `/dashboard` | Home dashboard with market overview |
| `status.tsx` | 223 | `/status` | System status monitoring |
| `audit.tsx` | 212 | `/audit` | Security audit results |
| `stocks-to-watch.tsx` | 247 | `/stocks-to-watch` | Catalyst-driven stock watchlist |
| `sector-detail.tsx` | 122 | `/sector/:sector` | Sector detail page |
| `sectors.tsx` | 92 | `/sectors` | Sector overview |
| `indices.tsx` | 11 | `/indices` | Indices board |
| `not-found.tsx` | 21 | `*` | 404 page |

---

## Scanner Frontend - Components

| Component | Lines | Purpose |
|-----------|------:|---------|
| `indices-board.tsx` | 604 | 27-instrument indices dashboard with live data |
| `stock-statements.tsx` | 419 | Financial statements display (P&L, balance sheet, cash flow) |
| `option-signal-alerter.tsx` | 388 | Real-time signal notification system |
| `tradingview-alerts.tsx` | 381 | TradingView webhook alert display |
| `layout.tsx` | 377 | App shell with navigation, search, theme switcher |
| `login-gate.tsx` | 270 | Password authentication gate |
| `global-strip.tsx` | 263 | Global market data strip (top bar) |
| `indian-strip.tsx` | 260 | Indian market data strip |
| `in-app-candle-chart.tsx` | 217 | Embedded candlestick chart (lightweight-charts) |
| `events-marquee.tsx` | 178 | Scrolling market events ticker |
| `mmi-gauge.tsx` | 122 | Market mood index gauge |
| `theme-switcher.tsx` | 107 | Dark/Light/Ocean theme switcher |
| `trendlyne-widget.tsx` | 107 | Trendlyne embed widget |
| `markets-news-card.tsx` | 99 | News card component |
| `access-guard.tsx` | 85 | Route-level access control |
| `trend-card.tsx` | 84 | Market trend indicator card |
| `tradingview-chart.tsx` | 78 | TradingView chart embed |
| `market-mood.tsx` | 73 | Market mood display |
| `error-boundary.tsx` | 67 | React error boundary |

### Home Components (`components/home/`, 1,034 lines total)
- `index-tabs.tsx` - Tabbed index cards (NIFTY 50, BANK NIFTY, etc.) with expanded analytics
- `index-expanded-panel.tsx` - Detailed index panel (OHLC, EMAs, VWAP, Market Profile, CPR, Momentum, Options Layer, Pivots)
- `sectoral-heatmap.tsx` - Color-coded sector performance grid
- `global-cues-strip.tsx` - GIFT Nifty, Dow, S&P, Nasdaq, USD/INR, Brent, Gold, VIX, DXY
- `sentiment-bar.tsx` - FII/DII net + India VIX + Expiry countdown
- `market-take.tsx` - Auto-generated market narrative
- `breadth-bar.tsx` - Advance/Decline ratio bar

### Learn Components (`components/learn/`, 555 lines)
- `pattern-diagrams.tsx` - Chart pattern visual diagrams

---

## Global Scanner Frontend - Pages (5 pages)

| Page | Lines | Route | Purpose |
|------|------:|-------|---------|
| `Screener.tsx` | 1,249 | `/global/screener` | Multi-asset screener with filters, presets, sharing |
| `Dashboard.tsx` | 497 | `/global/` | Global market dashboard with live prices |
| `InstrumentDetail.tsx` | 439 | `/global/instrument/:symbol` | Instrument detail with charts and indicators |
| `Watchlist.tsx` | 95 | `/global/watchlist` | Global watchlist |
| `not-found.tsx` | 21 | `*` | 404 page |

---

## API Endpoints (61 paths)

### Health & System
```
GET  /healthz                          Health check
GET  /market/summary                   Market overview
GET  /market/global                    Global market data
GET  /market/trend                     Market trend classification
GET  /market/events                    Holidays, earnings, economic events
GET  /market/premarket                 Pre-market analysis report
GET  /home/enrichment                  Home page data enrichment
```

### Stocks & Sectors
```
GET  /stocks                           Stock list with recommendations
GET  /stocks/{symbol}                  Individual stock detail
GET  /stocks/{symbol}/statements       Financial statements
GET  /stocks/{symbol}/history          Price history
GET  /sectors                          Sector summaries
GET  /sectors/{sector}                 Sector detail
GET  /scan/top                         Top scanner picks
```

### Options
```
GET  /options/signals                  F&O intraday signals (live)
GET  /options/signal-history           Today's signal lifecycle history
GET  /options/signal-report            Daily/monthly signal report
GET  /options/signal-report/export     CSV export
GET  /options/signal-report/dates      Available report dates
GET  /options/chain/{underlying}       Option chain data
GET  /options/analytics/{underlying}   OI analytics, market read
GET  /options/strategies/{underlying}  13 strategy templates
```

### Paper Trading
```
GET  /paper/account                    Paper account state
GET  /paper/positions/fo               Open F&O positions
GET  /paper/trades/fo                  Closed F&O trades (by date)
POST /paper/positions/fo/{id}/close    Manual close F&O position
GET  /paper/reports/fo/monthly         F&O monthly report
GET  /paper/reports/fo/yearly          F&O yearly report
GET  /paper/positions/eq               Open equity positions
GET  /paper/trades/eq                  Closed equity trades (by date)
POST /paper/positions/eq/{id}/close    Manual close equity position
GET  /paper/reports/eq/monthly         Equity monthly report
GET  /paper/reports/eq/yearly          Equity yearly report
PATCH /paper/trades/fo/{id}/journal    Update F&O trade journal/tags
PATCH /paper/trades/eq/{id}/journal    Update equity trade journal/tags
```

### Institutional Flows
```
GET  /inst/fii-dii                     FII/DII daily data
GET  /inst/participant-oi              Participant-wise OI
POST /inst/refresh                     Force refresh institutional data
```

### OI Lab (via `oiLab.ts` routes)
```
GET  /oi/snapshot                      Bulk OI snapshot
GET  /oi/heatmap                       OI heatmap
GET  /oi/intraday                      Intraday OI tracker
GET  /oi/iv-skew                       IV skew chart data
GET  /oi/insights                      Per-index OI sentiment
... (10 endpoints total)
```

### Kite Connect
```
POST /kite/login                       Initiate Kite login
GET  /kite/callback                    OAuth callback
GET  /kite/session                     Current session status
POST /kite/import-session              Import session from production
GET  /kite/export-instruments          Export instrument dump
... (11 endpoints total)
```

### Global Scanner
```
GET  /global/auth/status               Auth status
POST /global/auth/login                Login
POST /global/auth/logout               Logout
GET  /global/instruments               Instrument universe
GET  /global/dashboard                 Dashboard data
GET  /global/instruments/{symbol}      Instrument detail
GET  /global/instruments/{symbol}/candles   OHLCV candles
GET  /global/instruments/{symbol}/indicators  Technical indicators
POST /global/screen                    Run screener
GET  /global/watchlist                 Watchlist
PUT  /global/watchlist/{symbol}        Add to watchlist
DELETE /global/watchlist/{symbol}      Remove from watchlist
GET  /global/screener-presets          User's presets
GET  /global/screener-presets/library  Curated presets
POST /global/screener-presets          Create preset
... (and sharing, import, run-now, disable endpoints)
GET  /global/status                    Source health status
```

### Other
```
GET  /news                             Market news
GET  /watchlist/{key}                  Personal watchlist
GET  /indices                          Indices board
POST /tradingview/webhook              TradingView alert receiver
```

---

## Key Architectural Patterns

### Data Flow
```
Kite Connect / Yahoo Finance / NSE / Binance
            ↓
    API Server (Express 5)
    ├── lib/ modules (business logic, indicators, signals)
    ├── routes/ (HTTP handlers, Zod validation)
    └── DB (Drizzle ORM → PostgreSQL)
            ↓
    OpenAPI Spec (lib/api-spec/openapi.yaml)
            ↓
    Orval Codegen
    ├── lib/api-client-react/ (TanStack Query hooks)
    └── lib/api-zod/ (Zod schemas)
            ↓
    React Frontend (scanner / global)
```

### Authentication
- **App Access:** HMAC-SHA256 signed HttpOnly session cookies (`APP_ACCESS_PASSWORD`)
- **Kite Connect:** OAuth 2.0 with auto-mirror from production
- **Global Scanner:** Separate auth gate
- **Security:** Helmet CSP, CORS allowlist, rate limiting

### Market Data Priority
1. **Kite Connect** (live, primary) - auto-mirrored session from production
2. **Yahoo Finance** (15-min delayed fallback) - shared 429 circuit breaker
3. **NSE Direct** (fallback for option chains) - geo-blocked from Replit
4. **TradingView** (GIFT Nifty only)
5. **Binance** (crypto, global scanner)

### Signal Generation Pipeline (F&O)
```
buildContext() → 4 Detectors + Baseline → Vol Regime Haircuts → OI Confirmation
    → Lifecycle Persistence → Paper Trade Gating → Position Sizing → MTM
```

### Paper Trading Risk Management
- **F&O:** 2% max loss per trade, 4 trades/day cap, 70 confidence floor, premium stop-loss capped at 30%
- **Equity:** 4 base slots (25% each), 10 max concurrent, 3 new/day, 30-day time stop
- **Data Quality Gate:** Blocks trades on delayed/Yahoo data even when Kite is globally connected
- **BASELINE Gate:** Informational-only signals never open paper trades
- **Sector Gate:** Bottom-quartile sectors blocked from swing entries

### Volatility Regime Classification
| Regime | 14-day Realized Vol | Confidence Haircut |
|--------|--------------------:|-------------------:|
| LOW | < 10% | 0 |
| NORMAL | 10-18% | 0 |
| HIGH | 18-28% | -4 |
| EXTREME | > 28% | -8 |

### Central Trading Config (`tradingConfig.ts`)
- `MIN_FNO_TRADE: 70` - Minimum confidence for F&O paper trades
- `MIN_SWING_TRADE: 65` - Minimum confidence for equity swing entries
- `MIN_BASELINE_DISPLAY: 35` - Minimum confidence to show BASELINE signals
- `HTF_CONFLICT_HAIRCUT: 12` - Confidence penalty for higher-timeframe conflicts

---

## Environment Variables & Secrets

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_ACCESS_PASSWORD` | App-wide password protection |
| `SESSION_SECRET` | Cookie signing secret |
| `TRADINGVIEW_WEBHOOK_SECRET` | TradingView webhook authentication |
| `PORT` | Server port (assigned per artifact) |

---

## External Data Sources

| Source | Used For | Module |
|--------|----------|--------|
| Zerodha Kite Connect | Live NSE/BSE quotes, option chains, F&O instruments, WebSocket ticker | `kiteAuth.ts`, `kiteFeed.ts`, `kiteIntraday.ts`, `kiteOptionChain.ts` |
| Yahoo Finance | Delayed quotes, charts, intraday (fallback), global assets | `yahoo.ts`, `global/yahoo.ts` |
| NSE India | Option chains (fallback), bhavcopy delivery % | `optionChain.ts`, `nseBhavcopy.ts` |
| TradingView | GIFT Nifty data, webhook alerts | `giftNifty.ts`, `tradingViewAlerts.ts` |
| Binance | Crypto market data (global scanner) | `global/binance.ts` |
| News RSS (21 feeds) | Moneycontrol, Mint, ET, CNBC TV18, Business Standard, Investing.com | `newsRss.ts`, `stocksToWatch.ts` |

---

## Technical Indicators (`indicators.ts`)

- **EMA** (Exponential Moving Average) - any period
- **RSI** (Relative Strength Index) - 14-period default
- **VWAP** (Volume Weighted Average Price) - session-based
- **ADX** (Average Directional Index) - Wilder's RMA smoothing (canonical)
- **ATR** (Average True Range) - Wilder's smoothing
- **Volume Profile** - Value Area High/Low, Point of Control
- **Pivots** - Floor pivots (S1-S3, R1-R3)
- **Black-Scholes** - Option pricing model with Greeks (Delta, Gamma, Theta, Vega)

---

## F&O Signal Detectors

| Detector | Key Logic |
|----------|-----------|
| Trend Continuation | Strong trend (ADX > 20) + pullback to EMA9/21 + volume confirmation |
| VWAP Reclaim | Price reclaiming VWAP after dislocation + volume surge |
| Volume Breakout | Price breaking key level on 2x+ average volume |
| EMA Pullback | Trend-following pullback to EMA support/resistance |
| Baseline | Always-on directional read (informational only, never trades) |

---

## UI/UX Design

- **Themes:** Dark (default), Light, Ocean - persisted in localStorage
- **Typography:** JetBrains Mono for data/numbers
- **Component Library:** Radix UI primitives + shadcn/ui patterns
- **Styling:** Tailwind CSS v4
- **Charts:** Recharts (bar/line/area), lightweight-charts (candlestick)
- **Animations:** Framer Motion
- **Icons:** Lucide React
- **Routing:** Wouter (lightweight)
- **Forms:** React Hook Form + Zod resolvers
- **Notifications:** Sonner toast library
