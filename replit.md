# Overview

This project is a pnpm monorepo using TypeScript to develop a comprehensive stock market scanner and analysis platform for the Indian market, featuring an Express API backend and a React + Vite frontend. It aims to provide real-time market insights, including NSE/BSE tracking, options chain analysis, F&O intraday signals, and stock-specific catalysts, for traders and investors.

Key capabilities include:
- Market Scanning: Comprehensive NSE/BSE stock scanner.
- Options Analysis: Detailed option chain, Black-Scholes model, and OI insights.
- Intraday Signals: F&O intraday signals for indices with confidence scoring.
- Catalyst Tracking: "Stocks To Watch" feature identifying positive and negative catalysts from news feeds.
- System Monitoring: Security audit and system status checks.
- User Authentication: Secure, cookie-based authentication with rate limiting.

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
- **Scanner Fit-to-Viewport**: Dynamic grid layout for the full NSE table to auto-fit various viewport widths, ensuring alignment and readability.
- **Manifesto Page Contrast**: Implemented light-mode specific styling to ensure readability of text elements previously tuned for dark backgrounds.

## Technical Implementations

- **API Framework**: Express 5 for backend services.
- **Database**: PostgreSQL with Drizzle ORM for data persistence.
- **Validation**: Zod (v4) for schema validation, integrated with `drizzle-zod`.
- **API Codegen**: Orval generates API hooks and Zod schemas from OpenAPI specifications.
- **Build System**: esbuild for bundling packages.
- **Authentication**: HMAC-SHA256 signed HttpOnly session cookies with rate limiting.
- **Security Headers**: Helmet applies a tight production CSP, Cross-Origin-Opener-Policy, and Referrer-Policy.
- **CORS**: Environment-configured allowlist with strict production defaults.
- **Frontend API Client**: TanStack-Query custom fetcher defaults to `credentials: "include"` for authentication.
- **Scoring Robustness**: Recommendation scorer avoids synthetic defaults for missing indicators, ensuring scores reflect only real evidence. Stop-loss logic prevents inversion on fast market movements. Max-pain ties are broken deterministically.
- **Market Data Providers**: Primary reliance on Yahoo, with `lib/dataProvider.ts` designed for switching to Zerodha Kite.
- **Option Chain**: Orchestrates data from Kite Connect (primary) and NSE direct (fallback) with a 15s response cache. Includes Black-Scholes model for analytical payoff calculations and Greeks, and handles covered call logic for indices.
- **Option Strategies**: Builds 11 strategy templates against the live chain, providing distributional summaries, probabilistic R:R, and capital requirements. Headline Max Profit/Loss and the realistic R:R suffix are anchored to the **±2σ expected-move window by expiry** (lognormal stdev × spot, doubled), not the chart range — a Long Put now reports a tradeable ~₹55K instead of the misleading ~₹180K chart-edge or ₹1.86M theoretical-at-S=0; bounded strategies (verticals, condors) automatically resolve back to their analytical max because the 2σ window envelops every kink. Theoretical extremum is shown only when within 10× of realistic.
- **F&O Intraday Signals**: Uses 4 detectors (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback) with a Baseline Outlook fallback.
- **F&O Signal Lifecycle Tracking**: Persists and re-evaluates intraday signals against latest bar data, tracking status (PENDING, TRIGGERED, TARGET_HIT, STOPPED, EXPIRED) and MFE/MAE.
- **Yahoo Hard Timeouts**: Implements `Promise.race` with hard timers for Yahoo Finance API calls and a 429-only retry policy to prevent client aborts.
- **Curated Scan Hard Cap**: `scanAll()` is bounded by a `SCAN_HARD_TIMEOUT_MS`, returning partial results while warming the cache in the background.
- **Full NSE Stale-While-Revalidate**: `scanFullNse()` returns cached data immediately and triggers a background refresh to eliminate loading pauses.
- **Full NSE Coverage + Real Daily Indicators**: When Kite is offline, the scanner falls back to Yahoo, covering all 2,483 symbols and enriching them with `1y / 1d` data for accurate technical indicators.
- **Shared Yahoo 429 Circuit-Breaker**: A process-wide circuit breaker pauses all Yahoo calls on the first 429 error, with an exponential backoff, to allow Yahoo's throttle to reset.
- **TradingView Webhooks**: Processes rich payloads for alerts.
- **Security Audit**: `lib/securityAudit.ts` performs 18 checks for configuration, probes, authentication, secrets, and dependencies.
- **System Status**: `lib/systemStatus.ts` collects real-time status of subsystems.
- **OI Insights**: Calculates per-strike OI distribution, PCR aggregates, max-pain, and sentiment scoring using a dynamic F&O universe.
- **Deep Scan Universal Lookup**: Merges curated universe with full daily NSE bhavcopy for comprehensive symbol search.
- **Stocks To Watch**: Identifies catalysts from 21 news feeds, scores headlines, and resolves NSE symbols.
- **OI Lab**: Provides bulk snapshot download, OI heatmap, and intraday tracker with time-series analytics.
- **Kite Universe Hygiene**: Filters Kite's instrument dump to actively-tradeable stocks and bona-fide ETFs.
- **Mirror Kite Session Across Environments**: Allows secure mirroring of Kite sessions from production to dev environments, with SSRF/credential-leak guards.
- **Learn Tab Expansion**: Expanded content on futures, options, derivatives, trading psychology, and risk management.
- **Pre/Post-Market Trader-Grade Additions**: The `/premarket` page now renders five additional sections: Today's Game Plan (trading scenarios with probabilities), Key Index Levels (pivots, CPR, high-low bands for F&O indices), Option Snapshot (ATM straddle, expected-move, PCR, max-pain), Sector Heatmap (ranking of sectors), and FII / DII Snapshot (cash and cumulative data). Error handling ensures report robustness against upstream failures.

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