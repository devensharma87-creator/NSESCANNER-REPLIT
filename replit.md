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
- **OI Lab "Open Interest by Strike" chart was rendering empty** — Reference lines (Spot, Max Pain) and X-axis strike labels would render, but bars, Y-axis ticks, and the legend were all missing even when bottom-strip totals (e.g. 19.16 Cr / 13.61 Cr) clearly showed valid OI. Root cause: each per-view set of `<Bar>` components was wrapped in a React Fragment `<>...</>` inside a conditional, and Recharts 2.x's BarChart misses Bar children hidden behind a Fragment when scanning `props.children` to register series + compute YAxis domain. Fixed by rendering every `<Bar>` as a direct child of `<BarChart>` via inline `{cond && <Bar/>}` expressions, switching XAxis to a stable string-category `dataKey="strikeLabel"`, snapping reference-line `x` values to real strike categories with a half-step tolerance, and coercing every chart numeric through `Number.isFinite` so a single bad row can't blank the YAxis domain.
- **OI Lab "Open Interest by Strike" — ΔOI overlay** — In the OI view (Total OI bars), the chart now overlays two dotted lines (Δ Call OI red-200, Δ Put OI green-200) on the same axis so per-strike change is visible alongside totals (Sensibull-style). Implementation switched the container from `BarChart` to `ComposedChart` (drop-in replacement that accepts both Bar and Line series); the YAxis domain now auto-extends below zero in the OI view (was clipped at `[0, "auto"]` and would have hidden negative ΔOI from contract unwinding); a `y={0}` ReferenceLine was added so the sign of ΔOI is unambiguous. Other views (oichg / pcr / pain) unchanged.
- **OI Lab bottom-strip "Open Interest Change" / "Total Open Interest" tooltips were unidentified** — Both cards rendered as a single Bar with `dataKey="value"` and no `name` prop, so the tooltip showed a generic `value : N` row that didn't tell you whether the number was Call or Put. Restructured each card to a single-row dataset with two named Bar series (`call` + `put`), explicit `name="Call OI/ΔOI"` and `name="Put OI/ΔOI"` props, an explicit cursor fill, and a `labelFormatter` that titles the tooltip ("Intraday change" / "Outstanding OI"). The static numbers under each card are now also CALL/PUT-prefixed for legibility.
- **OI Lab main chart tooltips were rendering invisible per-series rows** — Across all four chartViews (OI Total / OI Change / PCR / Max Pain), hovering a bar showed a tooltip box with only the strike label visible — the actual data rows ("Δ Call OI : N", "Δ Put OI : N", "PCR : N", "Pain : N") were rendering as dark text on the near-black `#0a0a0a` wrapper background. Recharts' `Tooltip` only honored the strike label color (which inherited from the parent dark theme) but used a default near-black for `itemStyle`. Fixed by setting explicit `labelStyle` (light-zinc 50, bold) and `itemStyle` (zinc 200) on every `RTooltip` instance in the file (main InsightsTab chart + both bottom-strip cards), plus a `labelFormatter` that prefixes the strike with "Strike " for clarity.
- **Max Pain orange highlight was using strict-equality strike comparison** — The orange `<Cell>` for the actual max-pain bar used `d.strike === data.maxPain`, which silently failed to highlight any bar when `data.maxPain` carried sub-step floating-point drift from upstream math (the reference line was already tolerant via the half-step snap from the prior round, but the bar fill wasn't). Fixed to use `Math.abs(d.strike - data.maxPain) <= halfStep`, matching the same tolerance the reference line uses.
- **Option Chain status line was lying about IV provenance** — The "Black-Scholes · r=6.75% · IV solved from market price" caption was hardcoded in `option-chain.tsx`, but the chain only solves IV per-leg from market price when `chain.source === "kite"`. On the NSE-direct fallback path, IV comes straight from NSE's published `impliedVolatility` field. Fixed: the caption now reads "IV solved per leg from market price" only when `chain.source === "kite"`, and "IV from exchange feed" otherwise. The truthful source name is already shown separately (`Source: kite|NSE`) in the controls strip.
- **NSE-direct fallback was missing index lot/step coverage AND index dispatch** — Three coordinated gaps in `optionChain.ts`: (a) `LOT_SIZES` only enumerated NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY, so SENSEX/NIFTYNXT50/BANKEX reached Strategies with `chain.lotSize` undefined and per-lot rupee figures collapsed to per-share; (b) `STRIKE_STEPS` had the same omissions, so the ATM rounding fell back to a generic 50 instead of the 100-point steps these indices actually trade on; (c) `INDEX_SET` (which decides whether `fetchOptionChain` calls `/option-chain-indices` vs `/option-chain-equities` and which step map to use) was also missing SENSEX/BANKEX, so even with the new map entries those symbols would still have been dispatched as equities. All three fixed in one round (NIFTYNXT50: lot 25/step 100; SENSEX: lot 10/step 100; BANKEX: lot 15/step 100). Equity lots remain unenumerated under the NSE-direct path — that's a documented limitation since the Kite path (the primary source) reads `lot_size` directly from the instruments dump and handles every symbol correctly.
- **OI Lab "Put/Call Ratio by Strike" chart was missing bars for high strikes** — In the PCR view, the right half of the chart (strikes above spot/max-pain) appeared empty. Bars on the left (strikes well below spot) were rendering at heights of 30–60 because at those deep ITM-call strikes the call OI is tiny and PCR = peOi/ceOi explodes to 30..100+. The YAxis auto-scaled to that extreme, which made the genuinely meaningful PCR values for high strikes (~0.1..0.5, where call OI dominates and put OI is small) render as essentially zero-height bars — i.e. visually missing from the chart. Fixed by adding a `pcrCapped: Math.min(pcr, 3)` field to the chart data and pointing the PCR bar's `dataKey` at it (the cap of 3 sits well above the 1.3/0.7 bullish/bearish thresholds we already shade against, so no meaningful information is hidden). The tooltip and the cell-color logic continue to read the true uncapped `pcr`, so extreme readings remain visible to the trader and the green/grey/red banding is unchanged.
- **Learn tab massively expanded (futures, options, derivatives, psychology)** — Topic count went from 11 to 13. Added new topic 06 "Futures Deep Dive" (18 concepts including OI matrix, cost of carry, basis, MTM, rollover, physical vs cash settlement, FII/DII positioning, currency/commodity, plus 3 callouts and 6 videos and 8 resources). Replaced existing "Options & Derivatives" with deep version as topic 07 (added intrinsic/extrinsic value, IV rank vs IV percentile, term structure, vol skew/smile, vega crush, charm/vanna/volga, put-call parity, synthetic positions, 0DTE, pin risk, IV crush around results; 5 callouts including SEBI 2023 study summary, strike selection cheat sheet, buyer-vs-seller framework, earnings playbook; 8 videos; 11 resources). Added new topic 08 "Options Strategies Playbook" cataloguing 22 named strategies (long call/put, all spreads, straddles, strangles, iron condor/butterfly, calendar, diagonal, ratio, jade lizard, broken-wing butterfly, covered call, cash-secured put, protective put, collar) each with when-to-use + IV-regime fit; 4 callouts (IV regime selector, adjustment 101, what works on Indian weeklies, view→strategy quick map); 6 videos; 7 resources. Replaced Trading Psychology as topic 10 with deep expansion: 30 concepts (Mark Douglas's 5 Truths, 7 Principles of Consistency, process-vs-outcome scoring, all major cognitive biases, Jared Tendler's tilt model, ego-vs-account, four acceptances, 21-day reset rule, A/B/C trade grading, identity-based discipline); 6 callouts (the 5 Truths to repeat daily, pre-market checklist, EOD journal template, tilt protocol, drawdown survival kit, 4-question pre-trade gate); 8 videos; 15 resources. Search index extended to include callout headings/bodies so the new playbook content is discoverable. Risk Management renumbered 07→09; Indian Market 09→11; Path to Pro 10→12; Free Resource Stack 11→13. File grew from 808 to ~1064 lines.
- **Strategies, OI Lab, and Option Chain Greeks math audits** — Walked the full chain: `blackScholes.ts` (cdf, pdf, d1/d2, price+greeks), `kiteOptionChain.ts` (per-leg IV solver + deep-OTM fallback), `optionChain.ts` mapLeg (NSE feed IV path), `optionStrategies.ts` (slope-at-infinity classification, breakeven ladder walk, breakeven-aware extrema), and `oiLab.ts` (atmIv averaging, sentiment scoring across PCR / max-pain / intraday-flow / cluster-confirmation signals). The math is mathematically sound across all paths. Reproduced Black-Scholes for the reported deep-OTM put scenario (S=24100, K=22850, T=1day, σ across 0.05..10.0) — put delta is bounded near 0 in every case; -0.806 is unreachable from any sane input. Confirmed the NSE feed's `leg.impliedVolatility` is correctly divided by 100 on entry to the model. No math fixes required this round.