# Overview

This project is a pnpm monorepo using TypeScript to develop a comprehensive stock market scanner and analysis platform for the Indian market, featuring an Express API backend and a React + Vite frontend. It aims to provide real-time market insights, including NSE/BSE tracking, options chain analysis, F&O intraday signals, and stock-specific catalysts, for traders and investors.

Key capabilities include:
- **Market Scanning**: Comprehensive NSE/BSE stock scanner with full NSE coverage and real daily indicators.
- **Options Analysis**: Detailed option chain, Black-Scholes model, OI insights, and advanced option strategy building.
- **Intraday Signals**: F&O intraday signals for indices with confidence scoring and full lifecycle tracking.
- **Catalyst Tracking**: "Stocks To Watch" feature identifying positive and negative catalysts from news feeds.
- **System Monitoring**: Security audit and system status checks.
- **User Authentication**: Secure, cookie-based authentication with role-based access for owners and subscribers.

# User Preferences

I prefer clear and concise communication. For coding, I favor functional programming paradigms where applicable. I expect an iterative development approach with regular updates on progress. Please ask for confirmation before implementing any major architectural changes or feature deprecations. Ensure that all new features are accompanied by appropriate tests and documentation. I prefer detailed explanations for complex logic or design decisions.

# System Architecture

The project is structured as a pnpm workspace monorepo, utilizing TypeScript 5.9 for type safety.

## UI/UX Decisions

- **Theming**: Supports Dark, Light, and Ocean themes with `localStorage` persistence.
- **Typography**: Uses JetBrains Mono for monospaced elements.
- **Design Elements**: Softened card corners and theme-safe hover states.
- **Layout**: Dynamic header navigation, responsive search bar, full-width layouts, and dynamic grid layouts for data tables.
- **Accessibility**: Includes `sr-only` inputs and `autoComplete` attributes.
- **Error Handling**: Top-level `ErrorBoundary` for robust UI error management.
- **Page Titles**: Dynamic `document.title` updates based on the current route.
- **Manifesto Page Contrast**: Implemented light-mode specific styling for readability.

## Technical Implementations

- **API Framework**: Express 5 for backend services.
- **Database**: PostgreSQL with Drizzle ORM for data persistence.
- **Validation**: Zod (v4) for schema validation, integrated with `drizzle-zod`.
- **API Codegen**: Orval generates API hooks and Zod schemas from OpenAPI specifications.
- **Build System**: esbuild for bundling packages.
- **Authentication**: HMAC-SHA256 signed HttpOnly session cookies with rate limiting and role-based access control for owners and subscribers.
- **Security Headers**: Helmet applies a tight production CSP, Cross-Origin-Opener-Policy, and Referrer-Policy.
- **CORS**: Environment-configured allowlist with strict production defaults.
- **Frontend API Client**: TanStack-Query custom fetcher with `credentials: "include"`.
- **Scoring Robustness**: Recommendation scorer avoids synthetic defaults and ensures deterministic tie-breaking.
- **Market Data**: Primary reliance on Yahoo, with `lib/dataProvider.ts` designed for switching to Zerodha Kite.
- **Option Chain**: Orchestrates data from Kite Connect (primary) and NSE direct (fallback) with a 15s response cache, including Black-Scholes model and Greeks.
- **Option Strategies**: Builds 11 strategy templates against the live chain, providing distributional summaries, probabilistic R:R, and capital requirements, with realistic max profit/loss calculations.
- **F&O Intraday Signals**: Uses 4 detectors (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback) with a Baseline Outlook fallback and persists lifecycle tracking.
- **F&O Option-Premium Projection**: Displays delta-projected entry/T1/T2/SL on option premiums.
- **F&O Trigger Toast**: Provides real-time notifications for signal triggers with deduplication.
- **Home Tab**: Merged Dashboard and Indices functionality into a single "Home" tab with a comprehensive market fact-pack, trend overview, top gainers/losers, and setups.
- **Indices Board**: Displays 27 instruments across 5 categories (INDIA, GLOBAL, COMMODITY, ADR, FX) with live LTP, OHLC, range bars, EMAs, VWAP, market profile, and pivot ladders.
- **GIFT NIFTY and MIDCPNIFTY Proxy**: Uses `^NSEI` as a proxy for GIFT NIFTY and `^NSEMDCP50` for Nifty Midcap 50's historical data, with clear disclosures.
- **Yahoo `yahooTickerFor`**: Supports Yahoo futures and FX symbols without `.NS` suffix.
- **Strategies - Long Put "Unbounded"**: Overrides `maxProfit = null` for Long Put to align with trader conventions while retaining realistic R:R calculations.
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
- **Learn Tab Expansion**: Expanded content on futures, options, derivatives, trading psychology, and risk management.
- **Pre/Post-Market Additions**: The `/premarket` page includes Today's Game Plan, Key Index Levels, Option Snapshot, Sector Heatmap, and FII / DII Snapshot.
- **Paper Trading (owner-only)**: Auto-traded F&O paper account seeded ₹2,00,000 with daily IST refill. Risk = 2% of balance per trade, max 4 trades/day, only signals with confidence ≥ 70 are auto-opened. Lifecycle hook drives opens (PENDING → TRIGGERED) and closes (TARGET1/2, STOPPED, EXPIRED). All ledger mutations are wrapped in `db.transaction` with `SELECT FOR UPDATE` on the account row + conditional UPDATE on `dayTradeCount < cap` so the daily cap and the balance cannot race. `closePaperTradeForSignal` does the trade-row CAS and the account credit in one transaction. A `reconcileOrphanedPaperTrades()` safety net joins paper trades with terminal lifecycle rows and closes any orphans, called from `ensureDailyReset` (BEFORE the balance is wiped) and from the EOD `expireOpenSignalsForToday`. UI page at `/paper-trading` shows account stats, open positions with manual force-close, and today's closed trades; surfaces explicit error blocks rather than silent empty fallbacks. Equity segment is a Phase 3 placeholder.

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