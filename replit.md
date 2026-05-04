# Overview

This project is a pnpm monorepo using TypeScript, designed as a comprehensive stock market scanner and analysis platform specifically for the Indian market. It leverages an Express API backend and a React + Vite frontend to deliver real-time market insights. The platform aims to serve traders and investors with capabilities such as market scanning (NSE/BSE), advanced options chain analysis, F&O intraday signals, stock-specific catalyst tracking, system monitoring, and secure user authentication with role-based access. The business vision is to provide a robust, all-in-one solution for navigating the complexities of the Indian stock market, with ambitions to expand to global multi-asset scanning.

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
- **Market Data**: Kite Connect is the primary source for live market data; Yahoo Finance is the delayed fallback. Kite session and instrument data are auto-mirrored from production on startup. Rate limiting for Kite API calls is managed with exponential backoff.
- **OI Change Calculation**: Infers intraday OI delta using `oi_day_low`/`oi_day_high` from Kite quotes for buildup and unwinding classification.
- **Option Chain Analysis**: Orchestrates data from Kite Connect and NSE direct (fallback) with caching. Includes Black-Scholes, Greeks, PCRs, max-pain analysis, sentiment scoring, sortable columns, strike filters, support/resistance scoring, and data freshness indicators.
- **Participant-wise OI Segment View**: Provides FII positioning insights and per-segment participant data, including Net OI, change, and "Market Stance" score.
- **Option Strategies**: Builds 13 strategy templates against the live chain, with target delta for strike picking and liquidity badges for each leg.
- **F&O Intraday Signals**: Uses 4 detectors (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback) with a Baseline Outlook fallback, persisting lifecycle tracking and providing real-time trigger notifications. Includes signal history, KPIs, and CSV export.
- **Equity Swing Paper Book**: Filters `STRONG_BUY` scanner rows from the NSE F&O equity universe, attaching ATR-based stop and targets based on technical analysis.
- **Home Tab**: Data-rich layout featuring Global Cues, FII/DII sentiment, Sectoral Heatmap, Market Breadth, Tabbed Indian Indices with detailed analytics (OHLC, EMAs, VWAP, Market Profile, CPR+PDH/PDL, Momentum Cluster, Options Layer, Floor Pivots), Market Take auto-narrative, TrendCard, Market Mood gauge, Top Gainers/Losers, Top Bullish/Bearish Setups, and scanner CTA. Backend enrichment provides index sparklines, momentum indicators, and options summary.
- **Indices Board**: Displays 27 instruments across 5 categories with live LTP, OHLC, range bars, EMAs, VWAP, and pivot ladders, sourcing GIFT NIFTY data from TradingView.
- **Kite Universe Hygiene**: Filters Kite's instrument dump to active, bona-fide instruments.
- **OI Lab**: Provides bulk snapshot download, OI heatmap, intraday tracker, IV Skew chart, and sentiment explanation. Heatmap buildup classifications are merged into the scanner table as a sortable "FUT OI" column (Long Buildup, Short Buildup, Short Covering, Long Unwinding, Neutral).
- **Paper Trading (owner-only)**: Auto-traded F&O and equity paper accounts with seeded balance, risk management rules, and lifecycle hooks. Includes premium stop-loss caps, volatility regime adjustments, consecutive loss protection (pauses after 2 stops/day), and portfolio exposure heat indicator.
- **P&L Reports**: Monthly/yearly calendar views with per-trade detail. Includes Expectancy and Profit Factor metrics. Journal Analytics tab aggregates closed trades by setup type, exit reason, time-of-day, and tags.
- **IV History**: DB-backed daily ATM IV snapshots (`iv_history` table) powering IV Rank and IV Percentile on option chain, strategies, and home pages. Values are clamped to 0-100.
- **Trading Config**: Centralizes confidence thresholds, data quality labels, and volatility regime classification.
- **Audit-Driven Improvements**: Incorporates canonical Wilder's RMA smoothing for ADX, informational-only BASELINE signals, data quality gates for paper trades, sector-strength gates for swing entries, volatility regime awareness for F&O detectors, and OI confirmation for signal confidence.
- **Global Multi-Asset Scanner (`/global/`)**: A standalone React-Vite artifact covering Crypto (Binance), Commodities and Forex (Yahoo Finance), and Global Equities/Indices (Yahoo Finance). Features a dashboard, source-health monitoring, instrument details with `lightweight-charts`, and a screener with multi-asset-class filters and sharable presets.

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
- **Yahoo Finance API**: Delayed fallback for market data and source for global assets.
- **Zerodha Kite Connect API**: Primary source for live market data, option chains, and F&O data.
- **NSE India**: Direct data for option chains (fallback) and bhavcopy.
- **TradingView**: Webhook integration and source for GIFT NIFTY data.
- **Binance API**: For Crypto data in the Global Scanner.
- **News Feeds**: Moneycontrol, Mint, Economic Times (ET), CNBC TV18, Business Standard, Investing.com (for catalyst tracking).