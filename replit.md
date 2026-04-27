# Overview

This project is a pnpm monorepo using TypeScript to create a comprehensive stock market scanner and analysis platform. It features an Express API backend, a React + Vite frontend for data visualization, and various modules for in-depth financial analysis. The platform aims to provide real-time market insights, including NSE/BSE tracking, options chain analysis, F&O intraday signals, and stock-specific catalysts, catering to traders and investors in the Indian market.

Key capabilities include:
- **Market Scanning**: Comprehensive NSE/BSE stock scanner with curated and full-NSE coverage.
- **Options Analysis**: Detailed option chain, Black-Scholes model for option strategies, and OI insights.
- **Intraday Signals**: F&O intraday signals for indices with confidence scoring.
- **Catalyst Tracking**: "Stocks To Watch" feature identifying positive and negative catalysts from news feeds.
- **System Monitoring**: Security audit and system status checks for operational health.
- **User Authentication**: Secure, cookie-based authentication with rate limiting.

## User Preferences

I prefer clear and concise communication. For coding, I favor functional programming paradigms where applicable. I expect an iterative development approach with regular updates on progress. Please ask for confirmation before implementing any major architectural changes or feature deprecations. Ensure that all new features are accompanied by appropriate tests and documentation. I prefer detailed explanations for complex logic or design decisions.

# System Architecture

The project is structured as a pnpm workspace monorepo, leveraging TypeScript 5.9 for type safety across all packages.

## UI/UX Decisions

- **Theming**: Supports Dark, Light, and Ocean themes with `localStorage` persistence, defaulting to Dark. Utilizes `html.theme-*` classes for dynamic styling.
- **Typography**: Uses JetBrains Mono for monospaced elements (`--app-font-mono`).
- **Design Elements**: Softened card corners with `--radius` set to `0.5rem`. Implemented theme-safe hover states for rows using `.hover-row` and `.hover-row-strong` utilities.
- **Layout**: Dynamic header navigation with scrollable elements for small screens and responsive search bar sizing. Full-width layouts adopted for certain analytical pages like "Stocks To Watch" for better information density.
- **Accessibility**: Added `sr-only` inputs and appropriate `autoComplete` attributes for improved password manager and accessibility compliance.
- **Error Handling**: Top-level `ErrorBoundary` for robust UI error management, wrapped around both authentication gates and the main route tree.
- **Page Titles**: Dynamic `document.title` updates based on the current route, handling both static and dynamic segments.

## Technical Implementations

- **API Framework**: Express 5 for backend services.
- **Database**: PostgreSQL with Drizzle ORM for data persistence.
- **Validation**: Zod (v4) for schema validation, integrated with `drizzle-zod`.
- **API Codegen**: Orval is used to generate API hooks and Zod schemas from an OpenAPI specification.
- **Build System**: esbuild for bundling packages into CommonJS.
- **Authentication**: HMAC-SHA256 signed HttpOnly session cookies (`scanner_session`) with SameSite=Lax and Secure attributes (in production). Exemption for public endpoints like `/api/healthz`, `/api/auth/*`, `/api/kite/callback`, and POST-only `/api/webhooks/tradingview`.
- **Rate Limiting**: Implemented for login (5/15-min/IP), webhooks (60/min/IP), and general API (300/min/IP), respecting `trust proxy` settings.
- **Market Data Providers**: Primary reliance on Yahoo for live market data; `lib/dataProvider.ts` designed for easy switching to Zerodha Kite.
- **Option Chain**: Orchestrates data from Kite Connect (primary) and NSE direct (fallback for Indian IPs). Features 15s response cache.
- **Black-Scholes Model**: Analytical payoff calculations for option strategies, including max P/L, breakevens, and Greeks.
- **F&O Intraday Signals**: Uses 4 detectors (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback) with a Baseline Outlook fallback.
- **TradingView Webhooks**: Rich payload processing for alerts, storing detailed alert information in a JSONB column.
- **Security Audit**: `lib/securityAudit.ts` performs 18 checks covering configuration, live probes, authentication, secrets, and dependencies, providing a 0-100 score.
- **System Status**: `lib/systemStatus.ts` collects real-time status of subsystems (API uptime, DB, Kite, TradingView, market state) with cached probes for external services.
- **OI Insights**: Calculates per-strike OI distribution, PCR aggregates, max-pain, and sentiment scoring based on multiple signals. Uses a dynamic F&O universe from Kite NFO instruments.
- **Full NSE Coverage**: Lightweight Yahoo intraday scanner for ~2486 active NSE EQ symbols, with RSI/EMA/ATR/VWAP and recommendations. Includes a bhavcopy fallback and symbol aliasing.
- **NSE Bhavcopy Resilience**: Browser-like headers (Referer/Origin/Connection) + dual-host fallback (`archives.nseindia.com` and `nsearchives.nseindia.com`) + per-URL exponential backoff (0/1.5s/4s) for transient 403/429/5xx so production IPs reliably load the daily ~2,506-symbol bhavcopy.
- **Degraded-Cache Guards**: The Full NSE scanner tags any scan that fell back to the curated 199-name universe as `degraded`. Degraded results are NEVER persisted to disk (so cold boots can't serve stale fallbacks) and trigger a 60-second retry instead of the 5-min refresh interval. A degraded scan also can't downgrade a healthy in-memory cache. Bhavcopy is pre-warmed (8s budget) before the first scan so cold boots avoid degraded mode entirely when NSE is reachable.
- **Deep Scan Universal Lookup**: `searchUniverse()` merges the curated UNIVERSE (richer metadata) with the full daily NSE bhavcopy (background-refreshed every 15 min) so any of the ~2,486 listed symbols is searchable, not just the curated F&O names.
- **Yahoo Resilience**: `chartCall()` retries on transient errors (HTTP 429 / Too Many Requests, 502/503/504, ETIMEDOUT, ECONNRESET) with exponential backoff (800/2000/4500 ms) so bursty load against shared Yahoo endpoints (Deep Scan, market summary, trends) recovers cleanly without bubbling failure to the UI.
- **Stocks To Watch**: Identifies catalysts from 21 news feeds, scores headlines, and resolves NSE symbols. Groups by symbol with aggregated confidence.
- **OI Lab**: Provides bulk snapshot download, OI heatmap with buildup classification, and intraday tracker with time-series analytics (Spot vs MaxPain, PCR(OI), Call vs Put OI).
- **Kite Universe Hygiene**: `isLikelyTradeableEquity()` in `kiteScanner.ts` filters Kite's NSE-EQ instrument dump (~9,600 rows) down to the ~2,500 actively-tradeable stocks + bona-fide ETFs. Drops mutual-fund NAV trackers (`*INAV`, `*IETF`), liquid funds, Sovereign Gold Bonds (`SGB*`), Govt-securities (`GS\d*`), T-bills, and any instrument whose `name` field matches `MUTUAL FUND` / `LIQUID FUND` / `INDEX FUND` / `GILT FUND` / `SOVEREIGN GOLD` / `TREASURY BILL` / `STATE DEVELOPMENT LOAN`.
- **Option Chain Greeks**: UI surfaces all four Black-Scholes Greeks per leg — Δ (delta, 3-dp), Γ (gamma, 5-dp), Θ (theta-per-day, 2-dp), V (vega-per-1%-IV, 2-dp). Greeks are derived from solved IV via `priceAndGreeks()`; rows where IV cannot be solved (deep-ITM, stale ticks, no time value) show "—" instead of a fabricated number.
- **Covered Call (Indices)**: For cash-settled indices (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/NIFTYNXT50/SENSEX), the Covered Call template returns an "unavailable" entry with a clear explanation rather than synthesizing a fictitious "buy underlying at spot" leg (which previously made Max Loss = full underlying notional, e.g. -₹15.4L on NIFTY).

# External Dependencies

- **pnpm**: Monorepo management and package manager.
- **Node.js**: Runtime environment (v24).
- **TypeScript**: Programming language (v5.9).
- **Express**: Web application framework (v5).
- **PostgreSQL**: Relational database.
- **Drizzle ORM**: TypeScript ORM for PostgreSQL.
- **Zod**: Schema declaration and validation library (v4).
- **drizzle-zod**: Integration between Drizzle ORM and Zod.
- **Orval**: OpenAPI code generator for API hooks and schemas.
- **esbuild**: JavaScript bundler.
- **React**: Frontend UI library.
- **Vite**: Frontend build tool.
- **Yahoo Finance API**: Primary source for live market data and fundamentals.
- **Zerodha Kite Connect API**: Used for option chain data and dynamic F&O universe. Requires `KITE_API_KEY/SECRET/ACCESS_TOKEN`.
- **NSE India**: Direct data for option chains (fallback) and bhavcopy.
- **TradingView**: Webhook integration for alerts, secured by `TRADINGVIEW_WEBHOOK_SECRET`.
- **Moneycontrol**: News feed source (via RSS).
- **Mint**: News feed source (via RSS).
- **Economic Times (ET)**: News feed source (via RSS).
- **CNBC TV18**: News feed source (via RSS).
- **Business Standard**: News feed source (via RSS).
- **Investing.com**: News feed source (via RSS).
- **Google Fonts**: For typography (JetBrains Mono).

# Recent Fixes (April 2026)

- **ΔOI floating-point garbage** — Backend `kiteOptionChain.ts` now `Math.round`s the inferred `chgOi` value (OI counts whole contracts; eliminates IEEE-754 noise like `+268.6000000000006`). Frontend `fmtKL` / `fmtNum` defensively round small magnitudes as a safety net.
- **OI Insights "all values zero" empty state** — When the broker returns strikes but every value in the active chart view (OI / OI Δ / PCR / pain) is zero (newly-listed contract, off-hours snapshot), the chart now shows a mode-specific explanatory message instead of an empty plot with axes only.
- **Covered Call on indices** — Already guarded in `optionStrategies.ts` (commit `4ac9b94`); cash-settled indices return an explicit "needs ownership of the underlying" reason and surface in the unavailable-strategies section instead of synthesizing a fake long-stock leg that produced absurd Max Loss values like -₹15.43L on NIFTY.
- **Quote-payload hardening** — `kiteOptionChain.ts` coerces non-finite `last_price` / `oi` / `net_change` from broker payloads to safe defaults so NaN never propagates to the IV solver, Greeks, or UI.