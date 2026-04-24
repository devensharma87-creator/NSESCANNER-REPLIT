# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **api-server** (`artifacts/api-server`) — Express API. Routes under `/api/*` (scanner, market summary, index detail, stock detail, options, news, provider status). Yahoo is the live data source; `lib/dataProvider.ts` is a scaffold for switching to Zerodha Kite when KITE_API_KEY/SECRET/ACCESS_TOKEN are set.
- **scanner** (`artifacts/scanner`) — React + Vite NSE/BSE tracker. Pages: `/` dashboard (MMI gauge, clickable index cards w/ breadth), `/scanner` full table, `/index/:slug` index detail, `/stock/:symbol` enriched stock page (KeyStats + Sector Peers via Yahoo quoteSummary), `/sectors`, `/options`, `/news`.
- **mockup-sandbox** (`artifacts/mockup-sandbox`) — component preview server.

## NSE Scanner notes

- Stock universe defined in `artifacts/api-server/src/lib/universe.ts` (~280 NSE F&O / index constituents). `INDEX_CONSTITUENTS` maps each index slug → ticker list (NIFTY50, BANKNIFTY, FINNIFTY, IT, AUTO, PHARMA, FMCG, METAL, REALTY, ENERGY).
- `breadth.adRatio` is `null` when decliners=0 and advancers>0 (UI renders "∞").
- Fundamentals fetched lazily via `fetchFundamentals()` (Yahoo quoteSummary, 1h cache).
- **Option Chain (T002)**: `lib/optionChain.ts` orchestrates two sources for `/api/options/chain/:underlying` — (1) Kite Connect (`lib/kiteOptionChain.ts`, primary, works from any IP when user has authenticated daily) using NFO instrument dump + batched `getQuote`; (2) NSE direct (fallback, only works from Indian IPs). 15s response cache. F&O universe of 199 entries (5 indices + 194 equities, sector-grouped) lives in `artifacts/scanner/src/data/fnoUniverse.ts`. Chain page (`pages/option-chain.tsx`) has searchable picker, ATM-centered ±25-strike grid with OI/ΔOI heatmap, and informative error UI that shows live Kite-session state.
- **Deep Scan**: `lib/deepscan.ts` + `routes/deepscan.ts` expose `/api/deepscan/lookup?q=` (universe + 22 vetted Indian indices) and `/api/deepscan/snapshot/:symbol?range=&kind=` (5y Yahoo history → trimmed candles + EMA20/50/100/200 + rolling VWAP20 + 1M/3M/6M/1Y/3Y/5Y returns + fundamentals on stocks). Stock chart ticker uses `yahooTickerFor()` so renamed NSE symbols (ZOMATO→ETERNAL etc.) work. VWAP suppressed for indices (zero volume). `pages/deep-scan.tsx` is the search-driven detail page with composed price/EMA/VWAP chart, volume bars, returns grid, and key statistics.
- **Option Strategies (T003)**: `lib/blackScholes.ts` (BS price + Δ/Γ/Vega/Θ/Rho with Newton-Raphson IV solver and bisection fallback; `yearsToExpiry()` enforces 15:30 IST settlement for both DD-MMM-YYYY and ISO YYYY-MM-DD inputs) + `lib/optionStrategies.ts` (13 templates: Long/Short Call/Put, Long/Short Straddle, Long/Short Strangle, Bull Call/Bear Put/Bull Put/Bear Call Spread, Iron Condor, Iron Butterfly, Covered Call). Payoff math is **analytical, not just sampled**: max P/L computed at every kink (S=0, each strike, far tail) with unbounded direction inferred from sum-of-CE-slopes — so e.g. Long Put correctly shows max profit at S=0 and Covered Call correctly shows bounded max loss at S=0. Premiums prefer bid/ask mid over LTP; missing IV is recovered via the BS solver. Endpoint `GET /api/options/strategies/:underlying` returns all 13 with legs, net debit/credit, breakevens, payoff series (161 points ±35% spot for visualization), net Greeks, lognormal POP, R:R, and per-lot ₹ figures. Returns 503 with `kiteAuthenticated` flag when chain is unavailable. `pages/strategies.tsx` renders each as a card with Recharts payoff diagram (Area+Line + breakeven reference lines + you-are-here dot at live spot), legs table, and a "Recommended" filter that flags strategies matching current bias (BULLISH/BEARISH/NEUTRAL) + IV regime (LOW≤30 pct / HIGH≥70 pct).
- **F&O Intraday Signals (T004)**: `lib/optionSignals.ts` runs 4 detectors (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback) + a Baseline Outlook fallback for every index in `OPTION_INDICES` (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX/BANKEX). Confidence floor is 50 (down from 65 — 65 produced empty pages on choppy days). HTF (daily EMA50) bias is a **soft penalty** (`-12` confidence + `HTF_CONFLICT` tag), not a hard drop. RR < 1.5 is also advisory (tag `RR_LOW`), not a drop. Baseline always emits per index (tier `BASELINE`, setupKey `BASELINE` so it doesn't collide with high-conviction `TREND_CONTINUATION` in the session-level entry/SL/T1/T2 lock store) — bias resolves to `sessionChangePct` sign in tied/zero-vote case so e.g. NIFTY -1.3% reliably yields a SHORT bias card. `getOptionSignals()` returns `{signals, diagnostics{indicesConfigured,indicesWithBars,highConvictionCount,baselineCount,suppressed[]}}`; `/api/options/signals` adds `lastUpdated` + `marketState` (open/closed/pre_open via `lib/marketEvents.ts`). Each signal carries `tier` (`HIGH_CONVICTION`|`BASELINE`), `htfBias`, `htfConflict`, `dailyEma50`, and `tags[]` (`BASELINE`/`HTF_CONFLICT`/`RR_LOW`/`COUNTER_TREND`). 30s response cache.
- **TradingView Alerts (T005)**: `lib/tradingViewAlerts.ts` accepts rich webhook payloads — beyond the narrow `tv_alerts` DB columns it parses `stopLoss`, `target1`, `target2`, `riskRewardRatio` (auto-derived from SL/entry/T1 if not provided), `urgency`, `rationale`, `tags[]`, `setupKey`, `timeframe`, `note` from the request body and stores them inside the existing `raw` JSONB column (no schema migration). `pickFromRaw()` rehydrates them on read so the in-memory buffer and DB-backfilled alerts both surface the same shape. Frontend `components/tradingview-alerts.tsx` displays SL/T1/T2/RR with color thresholds (≥1.5 emerald, ≥1 yellow, <1 red), urgency-toned chips, tag chips, setupKey badge, and side/strategy/symbol filters. Includes 3 ready-to-paste Pine Script templates (EMA 9/21 cross, RSI divergence, Opening Range Breakout) accessible from a dropdown selector in the "How to connect" panel. Only the `POST /api/webhooks/tradingview` endpoint is publicly reachable (TradingView is server-to-server and authenticates via `TRADINGVIEW_WEBHOOK_SECRET`); GET/DELETE on the same path require the session cookie.
- **Auth gate (T006)**: `lib/auth.ts` enforces a signed HttpOnly session cookie (`scanner_session`, HMAC-SHA256 with `SESSION_SECRET`, SameSite=Lax, Secure in prod, 30-day rolling). `requireAuth` middleware exempts `/api/healthz`, `/api/auth/*`, `/api/kite/callback`, and **POST-only** `/api/webhooks/tradingview`. Frontend wraps the app in `LoginGate` which polls `/api/auth/status`. Rate limits: login 5/15-min/IP, webhooks 60/min/IP, general API 300/min/IP — `trust proxy` is enabled so Replit's CDN client IPs are honored.
- **Security Audit + System Status (T007)**: `lib/securityAudit.ts` runs 18 checks (config + 4 live loopback probes against the running server) covering auth, secrets, transport/cookies, headers, data handling, rate limiting, and dependencies — returns a 0–100 score. `lib/systemStatus.ts` collects a snapshot of every subsystem (API uptime, DB connectivity, Kite credentials/session/WebSocket, TradingView webhook auth + recent alerts, market state) plus singleflight-cached probes (60s TTL) of Yahoo, NSE, Moneycontrol, and Business Standard RSS. Endpoints `/api/security/audit` and `/api/system/status` (both auth-gated). Frontend pages `/audit` and `/status` poll every 60 s / 30 s respectively with auto-refresh toggles, grouped cards, severity badges, and remediation hints.
