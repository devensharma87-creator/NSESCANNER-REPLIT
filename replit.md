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
- **F&O Intraday Signals**: Uses 4 detectors (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback) with a Baseline Outlook fallback, persisting lifecycle tracking and providing real-time trigger notifications. Includes signal history, KPIs, and CSV export. Indicator warm-up in `buildContext`: EMA9 / EMA21 / RSI14 are computed on the full 5-day intraday window and then sliced to the session tail before being exposed as `*Series` — this preserves positional indexing semantics (`c.rsiSeries[n - 4]` still means "4 today-bars ago") while keeping the values properly seeded with prior days, so `c.rsi14`/`c.ema9`/`c.ema21` scalars match the corresponding series tail and detector slope checks (e.g. `c.rsi14 < rsiPrev` in VWAP Reclaim) compare like-for-like. Without warm-up, EMA21 on a 15-min frame can only become non-null after 5h15m of session bars (≈ 14:30 IST), which collides with the 14:30 IST late-entry gate on trend-class detectors and silently collapses every signal to BASELINE every day. ATR is split deliberately: full-window ATR drives the `fullIndicators` warm-up gate, but the `effectiveAtr15` scalar used for stop/target geometry prefers session-only ATR (≥ 14 session bars) and falls back to a 14-intra-bar high–low simple range — both paths avoid the overnight-gap inflation that pure full-window TR-based ATR produces, since gap risk is not a stop-relevant move on an intraday options trade.
- **Equity Swing Paper Book**: Filters `STRONG_BUY` scanner rows from the NSE F&O equity universe, attaching ATR-based stop and targets based on technical analysis.
- **Home Tab**: Data-rich layout featuring Global Cues, FII/DII sentiment, Sectoral Heatmap, Market Breadth, Tabbed Indian Indices with detailed analytics (OHLC, EMAs, VWAP, Market Profile, CPR+PDH/PDL, Momentum Cluster, Options Layer, Floor Pivots), Market Take auto-narrative, TrendCard, Market Mood gauge, Top Gainers/Losers, Top Bullish/Bearish Setups, and scanner CTA. Backend enrichment provides index sparklines, momentum indicators, and options summary.
- **Indices Board**: Displays 28 instruments across 5 categories (India / Global / Commodity / ADR / FX) with live LTP, OHLC, range bars, EMAs, VWAP, and pivot ladders. Live data sourcing: 6 Indian indices use Kite Connect (real-time tick), and 22 non-Indian rows use a generalised TradingView batch quote fetcher (`artifacts/api-server/src/lib/tvQuotes.ts`, `https://scanner.tradingview.com/global/scan`, 10s cache, inflight dedup keyed by ticker-set fingerprint). Yahoo Finance still drives historical analytics (EMAs, pivots, 52w hi/lo, intraday VWAP, value area) but no longer drives the headline LTP. Each TV row carries its real `update_mode` from the response (`streaming`, `delayed_streaming_600`, `delayed_streaming_900`) so the UI pill is honest: green "LIVE" only for true real-time, amber "LIVE 10m"/"LIVE 15m" for live-streaming-but-delayed, never substituting one symbol for another. Gold/Silver carry an explicit basis-disclosure note since the LTP is TV spot while the EMAs/pivots are derived from Yahoo CME-futures history.
- **Kite Universe Hygiene**: Filters Kite's instrument dump to active, bona-fide instruments.
- **OI Lab**: Provides bulk snapshot download, OI heatmap, intraday tracker, IV Skew chart, and sentiment explanation. Heatmap buildup classifications are merged into the scanner table as a sortable "FUT OI" column (Long Buildup, Short Buildup, Short Covering, Long Unwinding, Neutral).
  - **Sentiment scoring** (`api-server/src/lib/oiLab.ts` `scoreSentiment`): weighted sum on -100..+100. PCR(OI) is the heaviest leg at ±35 (saturates at PCR 0.7 / 1.3), max-pain ±20, intraday flow ±20, top-cluster ±25. NEUTRAL band is ±12 (was ±20). The `OiInsightsResponse` exposes `sentimentStrengthPct` (0-100) so the UI can render "Mildly Bearish 70%" alongside the band label, matching the convention every commercial chain platform uses.
  - **Insights tab layout** (`scanner/src/pages/oi-lab.tsx` `InsightsTab`): top KPI strip is 6 tiles (PCR, Max Pain, ATM IV, Sentiment, Total Call OI, Total Put OI). Sidebar is 240px (was 280). Market Insight + Analysis are folded into one card to avoid the 70px of vertical chrome the separate Analysis card used to take. Bottom strip charts are 120px tall (was 140).
  - **Windowed OI Δ correctness** (`api-server/src/lib/oiLab.ts`): the timeframe pills (5m/15m/30m/1h/2h/3h) ride on a per-`underlying|expiry` ring buffer (`OI_INSIGHTS_HISTORY`, max 450 entries, ~3h10m window) of `{ts, ce, pe}` snapshots. Two correctness invariants protect the per-strike Δ math: (a) `pushOiInsightsSnapshot` MERGES `ce`/`pe` strike maps when the latest buffer entry has the same `ts` as the new push (which happens whenever a `strikes=5` poll lands on the same chain-cache hit as an earlier `strikes=20` poll within `CHAIN_TTL=15s`) — replacing would shrink coverage to the smaller strike subset, causing future windowed queries on the outer strikes to falsely report "missing baseline"; (b) `resolveWindowDelta` picks the LATEST snapshot OLDER than `(now - windowMs)` when one exists (Tier 1) and falls back to the oldest available snap only when the buffer doesn't reach back that far (Tier 2). The previous closest-to-cutoff picker would silently select a 2-min-old snapshot for a "Last 1hr" pill on a sparse buffer → microscopic Δ that rounded to 0 against a chain-cache hit. The Insights tab's OI Change card (`scanner/src/pages/oi-lab.tsx`) renders value labels above the bars via Recharts `LabelList` (Cr/L formatting), shows the actual baseline timestamp + minutes-ago + approx flag below the title, and swaps the empty bars for an explicit "no movement vs baseline" state when every per-strike Δ is exactly zero.
- **Paper Trading (owner-only)**: Auto-traded F&O and equity paper accounts with seeded balance, risk management rules, and lifecycle hooks. Includes premium stop-loss caps, volatility regime adjustments, consecutive loss protection (pauses after 2 stops/day), and portfolio exposure heat indicator. F&O auto-trade has two lanes that share the same `MAX_TRADES_PER_DAY` cap: STANDARD (high-conviction detectors, 2% per-trade loss cap, confidence floor from `tradingConfig.MIN_FNO_TRADE`) and BASELINE (always-on directional outlook fallback, 1% per-trade loss cap, confidence floor 55) — defined in `paperAccount.ts` as `FNO_RISK` / `FNO_BASELINE_RISK`. Trade opens are gated per-signal on `dataQuality` (`isActionableForFno`) rather than the global `activeProvider()`, so a slow Kite WebSocket tick at open no longer suppresses every trade for the day. Kite `getHistoricalData` is throttled globally in `kiteIntraday.ts` (~2.5 req/sec via single-counter `nextSlotAt`) with per-cacheKey inflight dedup and `MAX_QUEUE=30` fail-fast — protects the 3 req/s budget when the equity scanner bursts in parallel and prevents starving the F&O index calls of the bars needed for full EMA21/RSI14/ATR14. Anti-phantom-trade rules: (a) `tryOpenPaperTrades` never opens already-exited signals; instead it routes them to `closePaperTradeForSignal`, which is a safe no-op when no OPEN paper_trade_fo row matches but closes any orphaned OPEN row when a lifecycle close was missed during a server crash/restart — this prevents a phantom loss for a slot we never held while still healing orphans we did hold (see the `closedExistingOpenRow` log field for which case fired); (b) `reconcileMissingPaperTrades` only backfills LIVE (`exited_at IS NULL`) lifecycle rows, for both STANDARD and BASELINE setups, so a mid-day deploy catches up open positions without retroactively booking phantom losses on the day's already-stopped signals.
- **P&L Reports**: Monthly/yearly calendar views with per-trade detail. Includes Expectancy and Profit Factor metrics. Journal Analytics tab aggregates closed trades by setup type, exit reason, time-of-day, and tags.
- **IV History**: DB-backed daily ATM IV snapshots (`iv_history` table) powering IV Rank and IV Percentile on option chain, strategies, and home pages. Values are clamped to 0-100.
- **Trading Config**: Centralizes confidence thresholds, data quality labels, and volatility regime classification.
- **Setup for Tomorrow Panel**: A sticky right-sidebar on the Pre/Post Market page inspired by Moneycontrol's "Trade Setup" article. Displays 15 key items: Nifty/BankNifty key levels (pivot, R1/R2, S1/S2, CPR), Call/Put OI walls for both indices, FII/DII flows, Put-Call Ratio, India VIX, OI buildup summary (Long Buildup, Long Unwinding, Short Buildup, Short Covering with top 5 stocks each), high delivery stocks (50%+ from bhavcopy, filtered to scanner universe), and F&O ban list. Items 10-14 are expandable with stock-level detail. Desktop renders as `xl:block w-[340px]` sticky sidebar; mobile shows below main content. Backend aggregates from OI heatmap cache, NSE bhavcopy delivery data, and existing premarket report fields. F&O ban is placeholder (NSE API limitation).
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