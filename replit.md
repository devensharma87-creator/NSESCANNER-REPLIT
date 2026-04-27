# Overview

This project is a pnpm monorepo using TypeScript to develop a comprehensive stock market scanner and analysis platform for the Indian market. It features an Express API backend and a React + Vite frontend. The platform provides real-time market insights, including NSE/BSE tracking, options chain analysis, F&O intraday signals, and stock-specific catalysts, targeting traders and investors.

Key capabilities include:
- **Market Scanning**: Comprehensive NSE/BSE stock scanner.
- **Options Analysis**: Detailed option chain, Black-Scholes model, and OI insights.
- **Intraday Signals**: F&O intraday signals for indices with confidence scoring.
- **Catalyst Tracking**: "Stocks To Watch" feature identifying positive and negative catalysts from news feeds.
- **System Monitoring**: Security audit and system status checks.
- **User Authentication**: Secure, cookie-based authentication with rate limiting.

# User Preferences

I prefer clear and concise communication. For coding, I favor functional programming paradigms where applicable. I expect an iterative development approach with regular updates on progress. Please ask for confirmation before implementing any major architectural changes or feature deprecations. Ensure that all new features are accompanied by appropriate tests and documentation. I prefer detailed explanations for complex logic or design decisions.

# System Architecture

The project is structured as a pnpm workspace monorepo, utilizing TypeScript 5.9 for type safety.

## UI/UX Decisions

- **Theming**: Supports Dark, Light, and Ocean themes with `localStorage` persistence.
- **Typography**: Uses JetBrains Mono for monospaced elements.
- **Design Elements**: Softened card corners and theme-safe hover states.
- **Layout**: Dynamic header navigation, responsive search bar, and full-width layouts for analytical pages.
- **Accessibility**: Includes `sr-only` inputs and `autoComplete` attributes.
- **Error Handling**: Top-level `ErrorBoundary` for robust UI error management.
- **Page Titles**: Dynamic `document.title` updates based on the current route.

## Technical Implementations

- **API Framework**: Express 5 for backend services.
- **Database**: PostgreSQL with Drizzle ORM.
- **Validation**: Zod (v4) for schema validation, integrated with `drizzle-zod`.
- **API Codegen**: Orval generates API hooks and Zod schemas from OpenAPI specifications.
- **Build System**: esbuild for bundling packages.
- **Authentication**: HMAC-SHA256 signed HttpOnly session cookies with rate limiting for login, webhooks, and general API access.
- **Market Data Providers**: Primary reliance on Yahoo, with `lib/dataProvider.ts` designed for switching to Zerodha Kite.
- **Option Chain**: Orchestrates data from Kite Connect (primary) and NSE direct (fallback) with a 15s response cache. Includes Black-Scholes model for analytical payoff calculations and Greeks, and handles covered call logic for indices.
- **F&O Intraday Signals**: Uses 4 detectors (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback) with a Baseline Outlook fallback.
- **F&O Signal Lifecycle Tracking**: Every emitted intraday signal is persisted to `option_signal_history` keyed by (signalDate, indexSymbol, setupKey, direction). On every refresh the row is re-evaluated against the latest bar high/low, advancing through PENDING → TRIGGERED → TARGET1_HIT/TARGET2_HIT/STOPPED, with EXPIRED applied after the 15:30 IST close. Locked entry/SL/T1/T2 are stored in DB so they survive server restarts (DB is the source of truth — they are never recomputed). MFE/MAE are tracked per signal. Race-safe via `ON CONFLICT DO NOTHING` on insert and compare-and-swap on `(status, exitedAt IS NULL)` for both updates and the post-close sweep. Exposed via `GET /api/options/signal-history`. The Intraday F&O Trade page renders a status pill on every card plus a "Today's scoreboard" tab with KPIs, per-setup and per-index breakdowns, win rate (decided trades only — EXPIRED excluded), and a full signal log.
- **TradingView Webhooks**: Processes rich payloads for alerts.
- **Security Audit**: `lib/securityAudit.ts` performs 18 checks for configuration, probes, authentication, secrets, and dependencies.
- **System Status**: `lib/systemStatus.ts` collects real-time status of subsystems.
- **OI Insights**: Calculates per-strike OI distribution, PCR aggregates, max-pain, and sentiment scoring using a dynamic F&O universe.
- **Full NSE Coverage**: Lightweight Yahoo intraday scanner for active NSE EQ symbols, with technical indicators and recommendations. Includes bhavcopy fallback and symbol aliasing, with resilience mechanisms for both NSE and Yahoo data.
- **Deep Scan Universal Lookup**: Merges curated universe with full daily NSE bhavcopy for comprehensive symbol search.
- **Stocks To Watch**: Identifies catalysts from 21 news feeds, scores headlines, and resolves NSE symbols.
- **OI Lab**: Provides bulk snapshot download, OI heatmap, and intraday tracker with time-series analytics. Includes UI/UX improvements for data visualization.
- **Kite Universe Hygiene**: Filters Kite's instrument dump to actively-tradeable stocks and bona-fide ETFs.
- **Learn Tab Expansion**: Significantly expanded content on futures, options, derivatives, trading psychology, and risk management.

# External Dependencies

- **pnpm**: Monorepo management.
- **Node.js**: Runtime environment (v24).
- **TypeScript**: Programming language (v5.9).
- **Express**: Web application framework (v5).
- **PostgreSQL**: Relational database.
- **Drizzle ORM**: TypeScript ORM.
- **Zod**: Schema validation library (v4).
- **drizzle-zod**: Drizzle ORM and Zod integration.
- **Orval**: OpenAPI code generator.
- **esbuild**: JavaScript bundler.
- **React**: Frontend UI library.
- **Vite**: Frontend build tool.
- **Yahoo Finance API**: Primary source for live market data.
- **Zerodha Kite Connect API**: Used for option chain data and F&O universe.
- **NSE India**: Direct data for option chains (fallback) and bhavcopy.
- **TradingView**: Webhook integration.
- **Moneycontrol**: News feed source.
- **Mint**: News feed source.
- **Economic Times (ET)**: News feed source.
- **CNBC TV18**: News feed source.
- **Business Standard**: News feed source.
- **Investing.com**: News feed source.
- **Google Fonts**: For typography (JetBrains Mono).