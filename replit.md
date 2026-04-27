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
- **Security Headers**: Helmet applies a tight production CSP (script-src locked to self + s3.tradingview.com / www.tradingview.com for the chart widget; img/connect/frame allow `*.tradingview.com`; style-src allows `'unsafe-inline'` for Radix). CSP is disabled in dev so Vite HMR keeps working. Cross-Origin-Opener-Policy=same-origin and Referrer-Policy=strict-origin-when-cross-origin are always on.
- **CORS**: Driven by an env-configured allowlist (`CORS_ORIGINS=comma,separated,origins`). Default is same-origin only. `CORS_ORIGINS=*` enables reflective mode for local dev but the app refuses to start with `*` when `NODE_ENV=production`.
- **Frontend API Client**: The generated TanStack-Query custom fetcher defaults to `credentials: "include"` so the auth cookie rides along on every cross-subdomain call (per-request overrides still win).
- **Scoring Robustness**: The recommendation scorer never substitutes synthetic neutral defaults for missing indicators — ADX/volume-ratio/delivery-percent are passed as null and each consuming rule short-circuits on null, so scores reflect only real evidence. Stop-loss is always capped at `price*0.999` (BUY) / `price*1.001` (SELL) to prevent inversion on fast breakdowns through support. Max-pain ties are broken deterministically by preferring the strike closest to spot.
- **Market Data Providers**: Primary reliance on Yahoo, with `lib/dataProvider.ts` designed for switching to Zerodha Kite.
- **Option Chain**: Orchestrates data from Kite Connect (primary) and NSE direct (fallback) with a 15s response cache. Includes Black-Scholes model for analytical payoff calculations and Greeks, and handles covered call logic for indices.
- **Option Strategies**: Builds 11 strategy templates against the live chain (long call/put, straddles, strangles, verticals, condors, butterfly, covered call). Each card surfaces a full distributional summary computed from a single 1001-sample lognormal integration over ±5σ in log-space using forward = spot·e^((r-q)T) as the risk-neutral drift center: Expected Value (₹/lot), σ of P/L, POP, average win, average loss, **Probabilistic R:R = E[win]/E[loss]** (replaces the old chart-range R:R, which was a UI artefact and meaningless for unbounded payoffs), plus ±1σ/±2σ implied-move bands shown in the page header. Per-leg edge is reported vs the ATM-IV-flat BS price so volatility skew shows up directly in the leg table. Capital required is approximated for sizing: pure-debit = premium paid, defined-risk credit = |maxLoss| (already net of credit), naked credit = 18%·notional − credit (SPAN+exposure proxy). Return on Capital = EV ÷ capital.
- **F&O Intraday Signals**: Uses 4 detectors (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback) with a Baseline Outlook fallback.
- **F&O Signal Lifecycle Tracking**: Every emitted intraday signal is persisted to `option_signal_history` keyed by (signalDate, indexSymbol, setupKey, direction). On every refresh the row is re-evaluated against the latest bar high/low, advancing through PENDING → TRIGGERED → TARGET1_HIT/TARGET2_HIT/STOPPED, with EXPIRED applied after the 15:30 IST close. Locked entry/SL/T1/T2 are stored in DB so they survive server restarts (DB is the source of truth — they are never recomputed). MFE/MAE are tracked per signal and persisted with SQL `GREATEST(...)` so concurrent evaluators can never lower the high-water marks. Race-safe via `ON CONFLICT DO NOTHING` on insert and compare-and-swap on `(status, exitedAt IS NULL)` for both updates and the post-close sweep. Exposed via `GET /api/options/signal-history`. The Intraday F&O Trade page renders a status pill on every card plus a "Today's scoreboard" tab with KPIs, per-setup and per-index breakdowns, win rate (decided trades only — EXPIRED excluded), and a full signal log.
- **Yahoo Hard Timeouts**: `lib/yahoo.ts` wraps every `yf.chart` (6s) and `yf.quoteSummary` (8s) call in a `Promise.race` with a hard timer. `clearTimeout` runs in `.finally` so the timer never leaks when the call resolves first. Retry policy is 429-only (no longer retries 5xx/ETIMEDOUT/ECONNRESET) — those are typically persistent in production, and retrying them just multiplied request time. Single root-cause fix for the production issue where every Yahoo-dependent endpoint (`/api/stocks`, `/api/sectors`, `/api/scan/top`, `/api/watchlist/*`, `/api/market/trend`, `/api/market/premarket`, `/api/options/signals`) was hitting the 5-min client abort because the underlying socket was waiting on the OS timeout.
- **Curated Scan Hard Cap**: `scanAll()` in `lib/scanner.ts` is bounded by `SCAN_HARD_TIMEOUT_MS=25000`. Both the request that started the scan AND every piggy-back caller go through the same bounded wait via a shared `ScanAccumulator`. When the timer fires, the awaiter returns whichever is bigger — the partial rows already collected, or the previously-cached set. The underlying scan keeps running in the background to warm the cache for the next request.
- **Full NSE Stale-While-Revalidate**: `scanFullNse()` in `lib/fullNseScanner.ts` returns whatever cache it has (warm-started from disk on boot, or stale from a prior cycle) immediately and kicks the refresh in the background. Only a truly cold cache (first deploy, disk wiped) makes the request wait. This eliminates the 7-12 s "Loading first scan…" pause on `/scanner` after every server restart — the page now renders rows in ~14 ms instead.
- **Scanner Fit-to-Viewport**: The full NSE table (19 columns) was previously fixed at `width: 1426 px` which forced horizontal scrolling on 1280 px viewports and left empty space on wider monitors. Tightened all numeric column widths so the total budget = ~1252 px, switched the outer + header + body containers from `width: TOTAL_WIDTH` to `className="w-full"` + `minWidth: TOTAL_WIDTH`, and absolute-positioned rows to `left-0 right-0` so they stretch with the container. Net effect: at 1280 px the page itself does not scroll horizontally (verified `scrollWidth = clientWidth = 1265 px`), on wider screens the SCORE column (already `flex-1`) absorbs the extra width.
- **TradingView Webhooks**: Processes rich payloads for alerts.
- **Security Audit**: `lib/securityAudit.ts` performs 18 checks for configuration, probes, authentication, secrets, and dependencies.
- **System Status**: `lib/systemStatus.ts` collects real-time status of subsystems.
- **OI Insights**: Calculates per-strike OI distribution, PCR aggregates, max-pain, and sentiment scoring using a dynamic F&O universe.
- **Full NSE Coverage**: Lightweight Yahoo intraday scanner for active NSE EQ symbols, with technical indicators and recommendations. Includes bhavcopy fallback and symbol aliasing, with resilience mechanisms for both NSE and Yahoo data.
- **Deep Scan Universal Lookup**: Merges curated universe with full daily NSE bhavcopy for comprehensive symbol search.
- **Stocks To Watch**: Identifies catalysts from 21 news feeds, scores headlines, and resolves NSE symbols.
- **OI Lab**: Provides bulk snapshot download, OI heatmap, and intraday tracker with time-series analytics. Includes UI/UX improvements for data visualization.
- **Kite Universe Hygiene**: Filters Kite's instrument dump to actively-tradeable stocks and bona-fide ETFs.
- **Mirror Kite Session Across Environments**: Zerodha Connect apps allow exactly one Redirect URL and one active access_token per user per day, so the daily login can only complete on the production domain (`marketscannerbydev.in`). To keep dev environments from being locked out of Kite, `GET /api/kite/export-session` (whitelisted from the cookie gate, but enforces an `X-App-Password` header against `APP_ACCESS_PASSWORD` with `crypto.timingSafeEqual`) returns the active session row as JSON. `POST /api/kite/import-session` (cookie-auth) does a server-side `fetch` against a peer's export endpoint and writes the row locally via `storeImportedSession()`, which validates timestamps and rejects already-expired payloads. SSRF/credential-leak guards: `sourceUrl` must be `https` (loopback `http` allowed only for self-test), and the host must be in `KITE_MIRROR_ALLOWED_HOSTS` (default `marketscannerbydev.in,localhost,127.0.0.1`). Upstream HTTP status and body fragment are propagated to the UI as `error + detail` so bad-password / no-session / unreachable failures are diagnosable. The `/kite` page exposes a "Mirror Session from Production" card with URL + password inputs and a one-click "Mirror" button; a successful import also kicks the WebSocket ticker so live ticks start flowing immediately.
- **Learn Tab Expansion**: Significantly expanded content on futures, options, derivatives, trading psychology, and risk management.
- **Light-mode contrast on Manifesto page**: The Gita / manifesto page used hardcoded Tailwind palette colors (`text-amber-100/200/300`) that are tuned for dark backgrounds and rendered as nearly-invisible pale yellow on the light theme's near-white surface. Fixed at the system level by registering a Tailwind v4 `light` custom variant in `artifacts/scanner/src/index.css` (`@custom-variant light (&:is(html.theme-light *));`), then layering `light:text-amber-700 / light:text-amber-800 / light:text-violet-700` overrides onto every offending element in `artifacts/scanner/src/pages/manifesto.tsx`: the hero Devanagari verses, the Gītā 2.47 reference label, the section headers (Inner Discipline, Equanimity in P&L), the centred shloka card title, the Sanskrit verse lines inside every shloka card, and the accent ACCENT lookup (chip text + chip background + chip border + bullet for amber/rose/cyan/violet/emerald). Dark and Carbon themes are untouched because the variant only fires when `html` carries `theme-light`.

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