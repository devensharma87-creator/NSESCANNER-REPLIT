# Overview

This project is a pnpm monorepo using TypeScript to develop a comprehensive stock market scanner and analysis platform for the Indian market. It features an Express API backend and a React + Vite frontend, aiming to provide real-time market insights for traders and investors. Key capabilities include market scanning (NSE/BSE), options chain analysis, F&O intraday signals, stock-specific catalyst tracking, system monitoring, and secure user authentication with role-based access.

# User Preferences

I prefer clear and concise communication. For coding, I favor functional programming paradigms where applicable. I expect an iterative development approach with regular updates on progress. Please ask for confirmation before implementing any major architectural changes or feature deprecations. Ensure that all new features are accompanied by appropriate tests and documentation. I prefer detailed explanations for complex logic or design decisions.

# System Architecture

The project is structured as a pnpm workspace monorepo, utilizing TypeScript 5.9.

## UI/UX Decisions

- **Theming**: Supports Dark, Light, and Ocean themes with `localStorage` persistence.
- **Typography**: Uses JetBrains Mono for monospaced elements.
- **Design Elements**: Softened card corners and theme-safe hover states.
- **Layout**: Dynamic header navigation, responsive search bar, full-width layouts, and dynamic grid layouts.
- **Accessibility**: Includes `sr-only` inputs and `autoComplete` attributes.
- **Error Handling**: Top-level `ErrorBoundary` for robust UI error management.
- **Page Titles**: Dynamic `document.title` updates based on the current route.

## Technical Implementations

- **API Framework**: Express 5 for backend services.
- **Database**: PostgreSQL with Drizzle ORM.
- **Validation**: Zod (v4) for schema validation, integrated with `drizzle-zod`.
- **API Codegen**: Orval generates API hooks and Zod schemas from OpenAPI specifications.
- **Build System**: esbuild for bundling packages.
- **Authentication**: HMAC-SHA256 signed HttpOnly session cookies with rate limiting and role-based access control.
- **Security Headers**: Helmet applies a tight production CSP, Cross-Origin-Opener-Policy, and Referrer-Policy.
- **CORS**: Environment-configured allowlist with strict production defaults.
- **Frontend API Client**: TanStack-Query custom fetcher with `credentials: "include"`.
- **Scoring Robustness**: Recommendation scorer avoids synthetic defaults and ensures deterministic tie-breaking.
- **Market Data**: Primary reliance on Yahoo, with `lib/dataProvider.ts` designed for switching to Zerodha Kite.
- **Option Chain**: Orchestrates data from Kite Connect (primary) and NSE direct (fallback) with a 15s response cache, including Black-Scholes model and Greeks. Includes per-strike data points, PCRs, and max-pain analysis.
- **Participant-wise OI Segment View**: Provides FII positioning insights and per-segment participant data, including Net OI, change, and diverging magnitude bars.
- **Option Strategies**: Builds 13 strategy templates against the live chain, using target delta for strike picking and pair-aware picker for protective long wings. Each leg surfaces bid/ask/spreadPct/oi/volume/quoted with liquidity badges.
- **F&O Intraday Signals**: Uses 4 detectors (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback) with a Baseline Outlook fallback and persists lifecycle tracking. Includes option-premium projection and real-time trigger notifications.
- **Home Tab**: Merged Dashboard and Indices functionality into a single "Home" tab with a comprehensive market fact-pack, trend overview, top gainers/losers, and setups.
- **Indices Board**: Displays 27 instruments across 5 categories with live LTP, OHLC, range bars, EMAs, VWAP, market profile, and pivot ladders.
- **GIFT NIFTY and MIDCPNIFTY Proxy**: Uses `^NSEI` for GIFT NIFTY and `^NSEMDCP50` for Nifty Midcap 50's historical data.
- **Yahoo `yahooTickerFor`**: Supports Yahoo futures and FX symbols without `.NS` suffix.
- **Strategies - Long Put "Unbounded"**: Overrides `maxProfit = null` for Long Put to align with trader conventions.
- **Yahoo Hard Timeouts**: Implements `Promise.race` for Yahoo API calls with a 429-only retry policy.
- **Curated Scan Hard Cap**: `scanAll()` is bounded by a `SCAN_HARD_TIMEOUT_MS`, returning partial results.
- **Full NSE Stale-While-Revalidate**: `scanFullNse()` returns cached data immediately and triggers background refresh.
- **Shared Yahoo 429 Circuit-Breaker**: Implements a process-wide circuit breaker for Yahoo API calls with exponential backoff.
- **TradingView Webhooks**: Processes rich payloads for alerts.
- **Security Audit**: Performs 18 checks for configuration, probes, authentication, secrets, and dependencies.
- **System Status**: Collects real-time status of subsystems.
- **OI Insights**: Calculates per-strike OI distribution, PCR aggregates, max-pain, and sentiment scoring.
- **Deep Scan Universal Lookup**: Merges curated universe with full daily NSE bhavcopy.
- **Stocks To Watch**: Identifies catalysts from 21 news feeds, scores headlines, and resolves NSE symbols.
- **OI Lab**: Provides bulk snapshot download, OI heatmap, and intraday tracker.
- **Kite Universe Hygiene**: Filters Kite's instrument dump to active, bona-fide instruments.
- **Mirror Kite Session**: Allows secure mirroring of Kite sessions from production to dev.
- **Learn Tab Expansion**: Expanded content on futures, options, derivatives, trading psychology, and risk management, including 50 patterns (candlestick and chart) and 16 additional trading psychology key concepts.
- **Pre/Post-Market Additions**: The `/premarket` page includes Today's Game Plan, Key Index Levels, Option Snapshot, Sector Heatmap, and FII / DII Snapshot.
- **Paper Trading (owner-only)**: Auto-traded F&O paper account with seeded balance, risk management rules, and lifecycle hooks for opens and closes. Includes equity paper trading for multi-day swing positions with specific stop-loss and target calculations, position sizing, and charges.
- **Global Multi-Asset Scanner (`/global/`)**: Standalone react-vite artifact at `/global/`, completely separate from the NSE Stock Scanner at `/`. Phase 1 covers Crypto (Binance via `data-api.binance.vision`), Commodities and Forex (Yahoo Finance). Has its own password gate using the `GLOBAL_APP_ACCESS_PASSWORD` env var and a separate `global_session` cookie scoped to `Path=/api/global` (so it never bleeds into NSE routes). The login endpoint is protected by a strict brute-force limiter (`globalLoginLimiter`: 5 failed attempts per 15 min, skipSuccessful). Backend tables are prefixed `global_*` (`global_instruments`, `global_candles`, `global_live_prices`, `global_watchlist`, `global_sync_logs`). API routes at `/api/global/*` are mounted before the NSE auth gate. Features: dashboard with Crypto/Commodities/Forex/Watchlist tabs, source-health strip, sortable rows, per-row staleness UX (rows where the upstream feed is overdue or failing get a `stale` badge and muted styling — staleness is computed against per-source freshness budgets defined in `FRESHNESS_BUDGET_MS` in `dataLayer.ts`), an "Updated" column showing relative age, instrument detail with `lightweight-charts` candlestick + indicator overlays (SMA/EMA/RSI/MACD/BB/ATR/VWAP/Supertrend), and a screener with multi-asset-class filters including Min volume, 1d/1w window % change, and price-vs-SMA50/SMA200 trend filters, with sortable result table.

# External Dependencies

- **pnpm**: Monorepo management.
- **Node.js**: Runtime environment.
- **TypeScript**: Programming language.
- **Express**: Web application framework.
- **PostgreSQL**: Relational database.
- **Drizzle ORM**: TypeScript ORM.
- **Zod**: Schema validation library.
- **drizzle-zod**: Drizzle ORM and Zod integration.
- **Orval**: OpenAPI code generator.
- **esbuild**: JavaScript bundler.
- **React**: Frontend UI library.
- **Vite**: Frontend build tool.
- **Yahoo Finance API**: Primary source for live market data.
- **Zerodha Kite Connect API**: Used for option chain data and F&O universe.
- **NSE India**: Direct data for option chains (fallback) and bhavcopy.
- **TradingView**: Webhook integration.
- **News Feeds**: Moneycontrol, Mint, Economic Times (ET), CNBC TV18, Business Standard, Investing.com.
- **Google Fonts**: For typography.