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
- **Stocks To Watch**: Identifies catalysts from 21 news feeds, scores headlines, and resolves NSE symbols. Groups by symbol with aggregated confidence.
- **OI Lab**: Provides bulk snapshot download, OI heatmap with buildup classification, and intraday tracker with time-series analytics (Spot vs MaxPain, PCR(OI), Call vs Put OI).

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