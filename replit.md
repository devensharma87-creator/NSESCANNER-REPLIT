# Indian Stock Market Scanner

A comprehensive platform for scanning and analyzing the Indian stock market, providing real-time insights for traders and investors.

## Run & Operate

- **Run (per-artifact)**: Workflows handle this — do not `pnpm dev` at root. Use `restart_workflow "artifacts/api-server: API Server"` etc.
- **Codegen**: `pnpm --filter @workspace/api-spec run codegen` (regenerates `lib/api-client-react/src/generated/*` and `lib/api-zod/src/generated/*` from `lib/api-spec/openapi.yaml`).
- **Typecheck**: `pnpm run typecheck` (canonical full check; runs `typecheck:libs` + every leaf workspace's `tsc --noEmit`).
- **DB push**: `pnpm --filter @workspace/api-server exec drizzle-kit push` (applies `src/db/schema.ts` to the dev database).
- **Required env**: `DATABASE_URL`, `APP_ACCESS_PASSWORD`, `SESSION_SECRET`, `TRADINGVIEW_WEBHOOK_SECRET` (all already provisioned).

## Stack

- **Frameworks**: Express 5 (backend), React (frontend)
- **Runtime**: Node.js
- **Language**: TypeScript 5.9
- **ORM**: Drizzle ORM
- **Validation**: Zod v4, drizzle-zod
- **Build Tool**: Vite, esbuild
- **Monorepo**: pnpm

## Where things live

- `api-server/`: Express API backend
- `scanner/`: React + Vite frontend
- `global-scanner/`: Global multi-asset React + Vite frontend
- `api-server/src/db/schema.ts`: Database schema definition (Drizzle)
- `artifacts/api-server/src/openapi.yaml`: OpenAPI specifications for API
- `scanner/src/theme/`: UI theme configurations

## Architecture decisions

- **Secure Authentication**: Uses HMAC-SHA256 HttpOnly session cookies with role-based access control.
- **Public Access Mode**: Allows read-only access to the entire site via a shareable URL for unauthenticated users.
- **Data Sourcing Priority**: Prioritizes Kite Connect for real-time data, with Yahoo Finance as a fallback for delayed data.
- **Accurate OI Delta Calculation**: Employs four invariants (snapshot merging, baseline selection, market-hours guard, session/day guard) for correct per-strike Δ calculations.
- **Enhanced F&O Signal Quality**: Includes ATR-aware stop-loss floors, opening-noise gates, and raised high-conviction emission floors for reliable signals.
- **Compliance-driven Signal Labels**: API/DB use `STRONG_BUY/BUY/NEUTRAL/SELL/STRONG_SELL`, while UI renders `STRONG BULLISH/BULLISH/NEUTRAL/BEARISH/STRONG BEARISH` for compliance.
- **Legal Pages Accessibility**: Specific `/legal/*` paths bypass login for unauthenticated access with a stripped-down UI.
- **F&O Phase-1 Overhaul** (additive — no behaviour change to existing setups):
    1.  **Regime Classifier** (`lib/regimeClassifier.ts`): TRENDING_BULL/BEAR | RANGING | VOLATILE | EXPIRY_DAY. Computed in `buildContext()`, attached to every `OptionSignal` via `toSignal()`. Read-only label, does NOT gate emission. Decision order: EXPIRY_DAY → VOLATILE (BBW≥2% or ATR15/spot≥0.6%) → TRENDING_* (ADX≥22 + EMA stack + VWAP) → RANGING.
    2.  **IVR / IVP** (`lib/ivHistory.ts`): trailing-252 ATM-IV rank/percentile. **Snapshot is per-index, NOT per-bundle** — `recordAtmIv` + `computeIvMetrics` run inside the per-index sweep loop in `optionSignals.ts` (right after `bundles.push`), so quiet indices like BANKEX/MIDCPNIFTY accumulate IV history even on cycles with zero emitted signals. Bundle-side enricher only reads existing metrics.
    3.  **Daily/Weekly Portfolio DD Caps** (`lib/paperAccount.ts`): `MAX_DAILY_LOSS_PCT=0.025` / `MAX_WEEKLY_LOSS_PCT=0.05` of seed. `getDailyRealizedDrawdown()` / `getWeeklyRealizedDrawdown()` sum CLOSED `realizedPnl` over IST-day / IST-week windows. **Caps are STICKY** via in-process `dailyDdLatch` / `weeklyDdLatch` — once `capReached`, stays true for the rest of the window even if a later winner pulls realised P&L back below the cap. Latches reset implicitly on IST window rollover; `_resetDdLatchesForTest()` clears them in tests. `paperTradingFO.openPaperTrade` gates after the consecutive-stops gate; on cap-hit logs `MissedSignal` with skipReason `DAILY_DD_CAP` / `WEEKLY_DD_CAP`. `/paper/account?segment=FNO` returns `dailyDrawdownPct` / `dailyDrawdownCapPct` / `weeklyDrawdownPct` / `weeklyDrawdownCapPct` (omitted for EQUITY).
- **Macro 5D Sparklines**: Dedicated endpoint `/api/market/macroHistory` provides 5-day daily closes for key global indices, cached for 5 minutes.
- **F&O Phase-2 — EMA20/50 + Intraday Volume Profile** (2026-05-06): `Ctx` extended with `ema20`/`ema50` series + scalars and `vpIntraday` (60-bar fixed VP from `volumeProfile.ts`, computed alongside the existing daily VP). `toSignal` exposes `ema20`, `ema50`, `intradayValueAreaHigh`, `intradayValueAreaLow`, `intradayPointOfControl`, and `confluenceScore` on `OptionSignal`. Note: `vpIntraday` is null for cash-index spots (NIFTY/BANKNIFTY etc. report 0 cash volume); the confluence engine treats this as a 0-weight factor.
- **F&O Phase-3 — Confluence Engine REPLACES per-detector confidence** (2026-05-06, additive to driver list, replaces final confidence): `lib/confluenceEngine.ts` `scoreConfluence()` returns `{adjustedConfidence, confluenceScore, factors[]}`. Factor weights: EMA stack +5/-8 (9>20>50 vs 9<20<50 vs disordered), VWAP +3/-6 (spot side), VP zone ±3 (inside VAH/VAL = +3 if mean-reversion-aligned, outside = -3 for trend-continuation), regime +5 (trend-aligned) / -10 (counter-trend) / -3 (RANGING for trend-continuation) / -5 (VOLATILE) / -2 (EXPIRY_DAY for new trends), IVR ±2. Wired into `buildSignalsForIndex` AFTER vol-regime haircut, BEFORE `HC_EMISSION_FLOOR`. Pushes `ConfluenceFactor` entries to `r.drivers`, stashes `confluenceScore` on `Detected` so `toSignal` can surface it. **`ivRank` passed null at emission time** (IV metrics are computed at the bundle level after `buildSignalsForIndex`); the IV factor is a UI-only display via the existing `ivRank` field. Pre-Phase-3 emission policy preserved verbatim in `lib/optionSignals.legacyEmit.bak.ts` for rollback. Signal counts will change post-deploy (user-approved).
- **Paper Tab → Live-Only** (2026-05-07): The `/paper-trading` page is now a pure live dashboard — closed-trade history, equity curve, by-setup analytics and journal entries all live exclusively in `/paper-reports`. Both `EquitySegment` and `FOSegment` no longer fetch `/paper/trades/{eq,fo}` or `/paper/analytics/fo`. Stale components (`AnalyticsCard`, `EquityCurveSparkline`, `EqTradesCard`, `TradesCard`) remain defined in `paper-trading.tsx` but are unrendered (left for easy reinstatement; cleanup deferred). Open-position rows now show `fmtDateTime(openedAt)` (date · HH:MM:SS) instead of date-only, surfacing the trigger time the user explicitly asked for.
- **Equity Account Card simplified** (2026-05-07): Two clean sub-grids replace the prior 9-stat cluster — (a) **Capital**: Capital introduced / Invested / Realized P&L (lifetime) / Balance capital; (b) **Open portfolio (live MTM)**: Invested amount / Current value / Profit-Loss / % P/L. `currentValue` and `unrealizedPnl` are computed client-side from open positions (`Σ qty × LTP` vs `Σ capitalDeployed`). `lifetimeRealizedPnl` is now a server-side field on `/paper/account` (`Σ realizedPnl WHERE status='CLOSED'` for the segment), making it **top-up safe** — manual `/paper/account/topup` capital injections cannot inflate the realised figure.
- **F&O Fixed-lot paper sizing override** (2026-05-07): `PAPER_FIXED_LOTS` map in `paperAccount.ts` (`{ NIFTY: 10, SENSEX: 40, BANKNIFTY: 30 }`) — when an entry exists for the index, `paperTradingFO.openPaperTrade` opens EXACTLY that many lots instead of the dynamic `floor(balance × maxLossPct / (perShareLoss × lotSize))` budget formula. `lotSize` itself still comes from the exchange (Kite instruments dump), so total share qty = `lots × exchangeLotSize` (e.g. NIFTY 10 × 75 = 750 shares). Indices NOT in the map (FINNIFTY, MIDCPNIFTY, NIFTYNXT50, BANKEX) keep the dynamic risk-budget formula. **Per-trade % loss cap and daily/weekly DD caps still apply on TOP** — when fixed sizing implies risk above the configured 2% per-trade ceiling we WARN-log but still open (owner choice); the "insufficient balance" gate also still rejects fixed-lot orders the account can't afford. Owner motivation: apples-to-apples comparison across signals regardless of how tight/wide the planned stop is on a given setup.
- **F&O Confidence Floor lowered 70 → 65** (2026-05-07): `CONFIDENCE_THRESHOLDS.MIN_FNO_TRADE` aligned with `HC_EMISSION_FLOOR`. Pre-Phase-3 the paper trader used 70 as a second-line defence; post-Phase-3 the confluence engine already haircuts confidence at the emission gate (65), so the second-line gate became a perma-veto on legitimate 65–69 conviction signals (the user observed multiple `EMA_PULLBACK` 68-conf NIFTY/SENSEX signals being skipped on 2026-05-07 despite a clean trending move). `BASELINE` floor unchanged at 55. `paperTradingFO.ts` header comment updated.
- **F&O Phase-4 — KiteTicker WebSocket for Index Spots** (2026-05-06): `kiteFeed.subscribeIndices()` (called from the existing `"connect"` handler, idempotent) lazy-imports `getIndexTokenMap` from `kiteIntraday.ts` to avoid the kiteFeed↔kiteIntraday cycle, then subscribes the existing `KiteTicker` singleton to every index token in `INDEX_TABLE`. `kiteIndexQuotes.getKiteIndexQuotes()` consults `getLiveQuote(yahoo)` first with a 3s freshness gate and ALL-or-nothing fall-through (never serves a partial strip); REST `kc.getQuote` batch is the cold-start/disconnect fallback unchanged. No new vendor dep; reuses the singleton ticker, autoReconnect, and token-expiry handling already in place.

## Product

- Market scanning (NSE/BSE)
- Advanced options chain analysis (Black-Scholes, Greeks, PCR, Max Pain)
- F&O intraday signals
- Stock-specific catalyst tracking
- Secure user authentication with role-based access
- Paper trading for F&O and equities
- P&L reports and journal analytics
- Global multi-asset scanning (Crypto, Commodities, Forex, Global Equities/Indices)

## User preferences

I prefer clear and concise communication. For coding, I favor functional programming paradigms where applicable. I expect an iterative development approach with regular updates on progress. Please ask for confirmation before implementing any major architectural changes or feature deprecations. Ensure that all new features are accompanied by appropriate tests and documentation. I prefer detailed explanations for complex logic or design decisions.

## Gotchas

- **Kite API Rate Limiting**: Be mindful of rate limits and use exponential backoff; avoid polling F&O Top-50 faster than 15s.
- **OI Change Calculation**: Dependent on `oi_day_low`/`oi_day_high` from Kite quotes, which may have inconsistencies.
- **Paper Trading Anti-phantom-trade rules**: Logic for closing already-exited signals and backfilling missing trades.
- **F&O Signal Pipeline (HARD-CUT 2026-05-06)**: F&O code paths NEVER touch Yahoo. `optionSignals.ts` daily history → Kite `day` interval; `optionSignalGates.ts` VIX → Kite-only (intraday + day); when VIX missing the gate becomes a no-op rather than emit-block so signals still flow. `tradingConfig.isActionableForFno` returns false for `DELAYED_YAHOO` unconditionally; the `PAPER_TRADE_ALLOW_YAHOO` env override has been removed entirely (was a known footgun). Yahoo remains only for non-F&O segments (equity scanner, global multi-asset).
- **MissedSignal Log Dedup**: `recordMissedSignal()` returns a boolean to prevent log spam for repeatedly missed signals.
- **Signal Display vs. Enum**: When changing display text for signals, only modify the display layer (e.g., `signal-badge.tsx`), not the underlying `Signal` enum strings used by API/DB.
- **F&O Signal Sweep Cadence**: The `TRIGGER_SWEEP_INTERVAL_MS` is 30s. Do not set below 15s to avoid Kite throttling.
- **Indices Board Hang Protection**: `getIndicesBoard()` uses an 8s `Promise.race` deadline for Kite/TV quotes; client-side `<IndicesBoard>` adds a 25s `loadingTooLong` flag for better UX on slow requests.
- **Empty-state Copy**: Pages with panels that can render empty now show explicit "No live data — last attempt X" with a Retry button, distinguishing from a perpetual loading state.
- **Index-detail Pivots**: `/api/index/:slug` now returns `previousHigh`, `previousLow`, and classical floor `pivots` (pivot, r1, r2, s1, s2) based on prior session data.
- **Side-correct R/S in OI analytics**: `computeAnalytics()` filters `topResistance` to CE strikes ≥ spot and `topSupport` to PE strikes ≤ spot for accurate display.
- **Paper-trade LTP is live**: `GET /paper/positions/fo` and `POST /paper/positions/fo/:id/close` refresh `lastPremium` from a fresh `fetchOptionChain()` pull to ensure live LTP is used for calculations and settlements.

## Pointers

- **Kite Connect API Documentation**: _Populate as you build_
- **Zerodha Kite Connect**: [https://kite.trade/docs/connect/v3/](https://kite.trade/docs/connect/v3/)
- **Drizzle ORM Documentation**: [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **Zod Documentation**: [https://zod.dev/](https://zod.dev/)
- **TanStack Query Documentation**: [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **OpenAPI Specification**: [https://swagger.io/specification/](https://swagger.io/specification/)