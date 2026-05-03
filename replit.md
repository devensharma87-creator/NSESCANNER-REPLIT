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
- **Market Data**: Primarily relies on Yahoo, with `lib/dataProvider.ts` designed for switching to Zerodha Kite.
- **Option Chain**: Orchestrates data from Kite Connect (primary) and NSE direct (fallback) with a 15s response cache, including Black-Scholes model, Greeks, per-strike data points, PCRs, and max-pain analysis.
- **Participant-wise OI Segment View**: Provides FII positioning insights and per-segment participant data, including Net OI, change, and diverging magnitude bars.
- **Option Strategies**: Builds 13 strategy templates against the live chain, using target delta for strike picking and pair-aware picker for protective long wings. Each leg surfaces bid/ask/spreadPct/oi/volume/quoted with liquidity badges.
- **F&O Intraday Signals**: Uses 4 detectors (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback) with a Baseline Outlook fallback and persists lifecycle tracking. Includes option-premium projection and real-time trigger notifications. Premium projection (`enrichBundlesWithOptionLevels`) requires `optionLtp` from the chain; when broker greeks are missing (no IV → no Black-Scholes delta) it falls back to the analytical ATM closed-form delta (call=+0.5, put=−0.5) since the bundle strike is `nearestStrike(spot, step)` by construction. This guarantees every signal carries a tradable `optionEntry/Stop/T1/T2` plan whenever `optionLtp` is available, so triggered signals are not silently dropped by the paper book on "invalid premium plan".
- **Equity Swing Paper Book**: `swingSignals.buildAllSwingSignals` filters `STRONG_BUY` scanner rows in the curated NSE F&O equity universe down to those clearing `EQUITY_RISK.MIN_SCORE` (24), then attaches an ATR(14) + 20-bar swing-low stop and 2R/3R targets. Per the user's directive (2026-05-04), entries are taken on **per-stock technical analysis only** — the prior NIFTY-vs-50-EMA macro-regime gate that previously vetoed all equity entries during index downtrends has been removed. Per-symbol gates (volume confirmation ≥ 1.3× the 20-day average, real ATR-based stop, daily new-entry cap, concurrent-position cap) remain unchanged.
- **Site-wide live data via Kite**: `kiteIntraday.ts` exposes a generic core for fetching historical data from Kite, utilized by various components like `scanner.getIntradayVwap`, `marketTrend`, `indicesBoard`, and `optionChain.getSpotForUnderlying`. Yahoo remains the fallback.
- **Home Tab**: Merged Dashboard and Indices functionality into a single "Home" tab with a comprehensive market fact-pack, trend overview, top gainers/losers, and setups.
- **Indices Board**: Displays 27 instruments across 5 categories with live LTP, OHLC, range bars, EMAs, VWAP, market profile, and pivot ladders.
- **GIFT NIFTY and MIDCPNIFTY Proxy**: Uses `^NSEI` for GIFT NIFTY and `^NSEMDCP50` for Nifty Midcap 50's historical data, with a dedicated `lib/giftNifty.ts` for accurate GIFT NIFTY data from TradingView.
- **Yahoo `yahooTickerFor`**: Supports Yahoo futures and FX symbols without `.NS` suffix.
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
- **OI Lab**: Provides bulk snapshot download, OI heatmap, and intraday tracker.
- **Kite Universe Hygiene**: Filters Kite's instrument dump to active, bona-fide instruments.
- **Mirror Kite Session**: Allows secure mirroring of Kite sessions from production to dev.
- **Learn Tab Expansion**: Expanded content on futures, options, derivatives, trading psychology, and risk management, including 50 patterns (candlestick and chart) and 16 additional trading psychology key concepts.
- **Pre/Post-Market Additions**: The `/premarket` page includes Today's Game Plan, Key Index Levels, Option Snapshot, Sector Heatmap, and FII / DII Snapshot.
- **Paper Trading (owner-only)**: Auto-traded F&O and equity paper accounts with seeded balance, risk management rules, and lifecycle hooks.
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
- **Yahoo Finance API**: Primary source for live market data.
- **Zerodha Kite Connect API**: Used for option chain data and F&O universe.
- **NSE India**: Direct data for option chains (fallback) and bhavcopy.
- **TradingView**: Webhook integration and source for GIFT NIFTY data.
- **Binance API**: For Crypto data in the Global Scanner.
- **News Feeds**: Moneycontrol, Mint, Economic Times (ET), CNBC TV18, Business Standard, Investing.com.
- **Google Fonts**: For typography.
## FII/DII tab — per-participant Market Stance (2026-05)

The FII/DII tab's Participant-wise OI section previously showed only an FII-only insight strip + per-segment cards with a generic "Net Long / Net Short" label and a momentum tag (longs added / shorts covered). It did not answer the question every trader actually asks first: **"Is this participant bullish or bearish on the market right now?"**

Added per-participant Market Stance with a transparent scoring rule (`flows.tsx:481-606`):
- **Score (range −100 … +100)**: 0.7 × Index-Futures-Long-score + 0.3 × Index-Options-bias-score.
  - Index Futures score = `(longPct − 50) × 2` clamped to ±100. This is the textbook directional read on Indian institutional desks — net-long Nifty/BankNifty futures = bet that the market goes up; net-short = bet on a fall.
  - Index Options bias = `((CallLong + PutShort) − (CallShort + PutLong)) / totalLegs × 100` — long-calls and short-puts are bullish exposure, long-puts and short-calls are bearish.
  - Stock futures and stock options are excluded from the market-stance score because they reflect bottom-up single-stock views, not directional market positioning.
- **Tag**: ≥+35 Bullish, ≥+12 Mildly Bullish, ≤−12 Mildly Bearish, ≤−35 Bearish, otherwise Neutral.
- **Null-safe**: when one of futures/options has zero activity, the present component is used alone (no fabricated zero); when both are absent the row is "No data" with `tone: "unknown"` rather than a misleading neutral tag.
- **Day-over-day delta**: stance score is computed for `previousRows` too and the delta is shown next to today's score (or "—" when no prior data exists). Deltas with `|Δ| < 3` are reported as "stance unchanged" so noise doesn't trigger spurious "shifting more bullish" labels.

Presentation:
- Replaced `FiiInsightStrip` (4 segment tiles for FII only) with `ParticipantStanceStrip` — 4 tiles, one per FII / DII / Pro / Client. Each tile shows: name, BULLISH/BEARISH/NEUTRAL tag with bull/bear icon, IndexFut Long%, score, d/d delta, and a plain-English rationale ("Index Futures 12% long (net −1.84 L); Index Options bias +5 · shifting more bullish vs prev day").
- Reordered `PARTICIPANT_DISPLAY` to FII / DII / Pro / Client (matching the tab name) instead of FII / Pro / Client / DII.
- Added a "Market Stance" column to the Long/Short Detail table — a colored stance pill with `(Long%)` annotation and the full rationale on hover.
- Tightened the "How to read" footer to teach the new scoring thresholds.

Verified live (2026-04-30 NSE archive): FII = Bearish (12% IdxFut Long, score −76, futures heavily net-short −1.84 L contracts); DII = Bullish (67% IdxFut Long, score +34); Client = Bullish (73%, score +47); Pro = Mildly Bullish (61%, score +22). Matches the well-known late-April 2026 setup of FIIs being defensive on Nifty futures while DIIs/retail buy the dip.
