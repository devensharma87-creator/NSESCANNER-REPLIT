# Overview

This project is a pnpm monorepo using TypeScript, designed as a comprehensive stock market scanner and analysis platform specifically for the Indian market. It leverages an Express API backend and a React + Vite frontend to deliver real-time market insights. The platform aims to serve traders and investors with capabilities such as market scanning (NSE/BSE), advanced options chain analysis, F&O intraday signals, stock-specific catalyst tracking, system monitoring, and secure user authentication with role-based access. The business vision is to provide a robust, all-in-one solution for navigating the complexities of the Indian stock market.

# User Preferences

I prefer clear and concise communication. For coding, I favor functional programming paradigms where applicable. I expect an iterative development approach with regular updates on progress. Please ask for confirmation before implementing any major architectural changes or feature deprecations. Ensure that all new features are accompanied by appropriate tests and documentation. I prefer detailed explanations for complex logic or design decisions.

# System Architecture

The project is structured as a pnpm workspace monorepo using TypeScript 5.9.

## UI/UX Decisions

- **Theming**: Supports Dark, Light, and Ocean themes with `localStorage` persistence.
- **Typography**: Uses JetBrains Mono for monospaced elements.
- **Design Elements**: Features softened card corners and theme-safe hover states.
- **Layout**: Implements dynamic header navigation, a responsive search bar, full-width layouts, and dynamic grid layouts.
- **Accessibility**: Includes `sr-only` inputs and `autoComplete` attributes.
- **Error Handling**: Utilizes a top-level `ErrorBoundary` for robust UI error management.
- **Page Titles**: Dynamic `document.title` updates based on the current route.

## Technical Implementations

- **API Framework**: Express 5 is used for backend services.
- **Database**: PostgreSQL with Drizzle ORM.
- **Validation**: Zod (v4) for schema validation, integrated with `drizzle-zod`.
- **API Codegen**: Orval generates API hooks and Zod schemas from OpenAPI specifications.
- **Build System**: esbuild is used for bundling packages.
- **Authentication**: HMAC-SHA256 signed HttpOnly session cookies with rate limiting and role-based access control.
- **Security Headers**: Helmet applies a tight production CSP, Cross-Origin-Opener-Policy, and Referrer-Policy.
- **CORS**: Environment-configured allowlist with strict production defaults.
- **Frontend API Client**: TanStack-Query with a custom fetcher including `credentials: "include"`.
- **Scoring Robustness**: The recommendation scorer avoids synthetic defaults and ensures deterministic tie-breaking.
- **Market Data**: Kite Connect is the primary source for all live market data when a valid session exists (auto-mirrored from production on startup via `autoMirrorSession`). Yahoo Finance is the delayed fallback (15-min lag). NSE direct is geo-blocked from Replit.
- **OI Change Calculation**: Uses `oi_day_low`/`oi_day_high` from Kite quotes to infer intraday OI delta. For buildup (OI >= midpoint of day range), baseline is `oi_day_low` (approx. previous close OI). For unwinding (OI < midpoint), baseline is `oi_day_high`. This matches exchange-reported deltas within ~5% for directional sessions.
- **Buildup Classification**: Derives option price change from `ohlc.close` when Kite's `net_change` field is missing/zero. All four quadrants (LONG_BUILDUP, SHORT_BUILDUP, SHORT_COVERING, LONG_UNWINDING) are reachable.
- **Kite Session Auto-Mirror**: On server startup, if no local Kite session exists in the DB, `autoMirrorSession()` fetches the active session from production (`KITE_MIRROR_URL`) with SSRF guards (HTTPS-only, host allowlist via `KITE_MIRROR_ALLOWED_HOSTS`). This eliminates the need for manual daily session import in dev. Instruments are also auto-mirrored from production when no local cache exists (`/api/kite/export-instruments` endpoint).
- **Kite getInstruments Rate Limit Protection**: Exponential backoff (base 5min, doubling to max 30min cap) with disk-persisted failure state. Prevents restart-storm pattern from hammering Kite's rate-limited instruments endpoint. Failure cooldown survives server restarts via `.cache/kite_instruments_fail.json`.
- **Option Chain**: Orchestrates data from Kite Connect (primary) and NSE direct (fallback) with a 15s response cache, including Black-Scholes model, Greeks, per-strike data points, PCRs, and max-pain analysis. ALL strikes from the instruments dump are passed through to aggregation functions (Total OI, PCR, Max Pain, OI Change). Display trimming (ATM ±N) is applied AFTER aggregates are computed. Enhanced with: (1) Market Read card showing bias badge, confidence score (0-100), structured reasons with impact indicators, and invalidation warnings; (2) Sortable columns (OI, ΔOI, Vol, IV, LTP, Strike) with click-to-sort headers and direction indicators; (3) Strike filters (ATM±5, ATM±10, All, High OI, Unusual Activity); (4) Support/Resistance strength scoring (STRONG/MEDIUM/WEAK) based on OI magnitude, change direction, volume, and proximity to spot; (5) Data freshness indicator showing source badge (KITE LIVE/NSE DIRECT), color-coded staleness, and fallback warnings; (6) Rich column header tooltips explaining every metric.
- **Participant-wise OI Segment View**: Provides FII positioning insights and per-segment participant data, including Net OI, change, and diverging magnitude bars. Also includes a "Market Stance" score and tag for each participant.
- **Option Strategies**: Builds 13 strategy templates against the live chain, using target delta for strike picking and pair-aware picker for protective long wings. Each leg surfaces bid/ask/spreadPct/oi/volume/quoted with liquidity badges.
- **F&O Intraday Signals**: Uses 4 detectors (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback) with a Baseline Outlook fallback and persists lifecycle tracking. Includes option-premium projection and real-time trigger notifications. Enhanced signal generation for early sessions and non-trading days. Live tab shows signals only during market hours (09:15–15:30 IST); outside market hours a "Market is closed" banner appears. The "Report" tab replaced the old "Today's Scoreboard" and provides daily/monthly signal history with date/month pickers, prev/next navigation, a "Triggered only / All signals" filter (defaults to triggered), KPI cards, performance-by-setup/index tables, signal log, and CSV export (opens in Excel). API endpoints: `GET /api/options/signal-report`, `/signal-report/dates`, `/signal-report/export`.
- **Equity Swing Paper Book**: Filters `STRONG_BUY` scanner rows from the NSE F&O equity universe, attaches ATR-based stop and 2R/3R targets. Entries are based on per-stock technical analysis.
- **Site-wide live data via Kite**: `kiteIntraday.ts` exposes a generic core for fetching historical data from Kite, utilized by various components. Yahoo remains the fallback.
- **Home Tab**: Revamped Home tab with data-rich layout: Global Cues strip (GIFT Nifty, Dow, S&P, Nasdaq, USD/INR, Brent, Gold, VIX, DXY, US10Y), FII/DII net + India VIX + Expiry countdown sentiment bar, Sectoral Heatmap (color-coded sector blocks), Market Breadth bar (A/D ratio), Tabbed Indian Indices hero section (5 mini-cards — NIFTY 50, BANK NIFTY, FIN NIFTY, MIDCAP NIFTY, SENSEX — with sparklines and bias badges → expandable panel showing OHLC, EMAs, VWAP, Market Profile, CPR+PDH/PDL, Momentum Cluster (RSI/ADX/MACD/Vol Ratio), Options Layer (PCR/Max Pain/ATM IV/CE-PE walls), Floor Pivots ladder), Market Take auto-narrative, TrendCard + Market Mood gauge, Top Gainers/Losers, Top Bullish/Bearish Setups, full IndicesBoard (always visible), and scanner CTA. Backend enrichment at `/api/home/enrichment` returns per-index sparklines, momentum indicators, and options summary for all 5 indices with 30s cache.
- **Indices Board**: Displays 27 instruments across 5 categories with live LTP, OHLC, range bars, EMAs, VWAP, market profile, and pivot ladders. Uses `^NSEI` for GIFT NIFTY and `^NSEMDCP50` for Nifty Midcap 50's historical data, with a dedicated `lib/giftNifty.ts` for accurate GIFT NIFTY data from TradingView.
- **Yahoo `yahooTickerFor`**: Supports Yahoo futures and FX symbols without `.NS` suffix and handles non-Indian tickers correctly.
- **Kite F&O instruments — NFO + BFO**: `kiteOptionChain.loadInstruments()` and `oiLab.getDynamicFnoUniverse() / getOiHeatmap()` fetch both NFO (NSE F&O) and BFO (BSE F&O) in parallel.
- **Kite ticker self-restart on `noreconnect`**: `kiteFeed.startTicker()` schedules an exponential-backoff restart loop when Kite's built-in autoReconnect gives up.
- **Strategies - Long Put "Unbounded"**: Overrides `maxProfit = null` for Long Put.
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
- **OI Lab**: Provides bulk snapshot download, OI heatmap, and intraday tracker. Enhanced with: (1) IV Skew chart showing CE IV vs PE IV across strikes with PE−CE skew area overlay; (2) Expandable "Why?" sentiment explanation with bullet-point reasons covering PCR bias, intraday flow, max pain distance, and OI flow direction; (3) Spot price reference line on OI charts.
- **Kite Universe Hygiene**: Filters Kite's instrument dump to active, bona-fide instruments.
- **Mirror Kite Session**: Allows secure mirroring of Kite sessions from production to dev.
- **Learn Tab Expansion**: Expanded content on futures, options, derivatives, trading psychology, and risk management, including patterns and trading psychology key concepts.
- **Pre/Post-Market Additions**: The `/premarket` page includes Today's Game Plan, Key Index Levels, Option Snapshot, Sector Heatmap, and FII / DII Snapshot.
- **Paper Trading (owner-only)**: Auto-traded F&O and equity paper accounts with seeded balance, risk management rules, and lifecycle hooks. F&O paper trade opens run AFTER option-premium enrichment (not inside the lifecycle hook) so premiums are always available. Option premiums are back-filled to lifecycle DB rows post-enrichment via `persistOptionPremiums()`. Startup reconciliation catches signals that triggered+exited while the server was down. F&O premium stop-loss is capped at 30% of entry premium (in both enrichment and paper-trade open) to prevent 50%+ capital drawdowns. BASELINE signals now go through `clampPlanForIntraday` with a softer RR gate (1.0 vs 1.4 for high-conviction). F&O paper trades are blocked outside market hours (uses `computeMarketStatus` for weekend/holiday awareness + 15:25 IST late-session cutoff). Equity swing entries use the day's open price instead of mid-day LTP for more accurate entry pricing and U.P&L tracking.
- **Global Multi-Asset Scanner (`/global/`)**: A standalone React-Vite artifact covering Crypto (Binance), Commodities and Forex (Yahoo Finance), and Global Equities/Indices (Yahoo Finance). It includes a dashboard, source-health monitoring, instrument details with `lightweight-charts`, and a screener with multi-asset-class filters and sharable presets.

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
- **Yahoo Finance API**: Delayed fallback for market data (15-min lag).
- **Zerodha Kite Connect API**: Primary source for live market data, option chains, F&O universe, and WebSocket tick feed.
- **NSE India**: Direct data for option chains (fallback) and bhavcopy.
- **TradingView**: Webhook integration and source for GIFT NIFTY data.
- **Binance API**: For Crypto data in the Global Scanner.
- **News Feeds**: Moneycontrol, Mint, Economic Times (ET), CNBC TV18, Business Standard, Investing.com.
- **Google Fonts**: For typography.