# Indian Stock Market Scanner

A comprehensive platform for scanning and analyzing the Indian stock market, providing real-time insights for traders and investors.

## Run & Operate

- **Run (per-artifact)**: Workflows handle this — do not `pnpm dev` at root. Use `restart_workflow "artifacts/api-server: API Server"` etc.
- **Codegen**: `pnpm --filter @workspace/api-spec run codegen` (regenerates `lib/api-client-react/src/generated/*` and `lib/api-zod/src/generated/*` from `lib/api-spec/openapi.yaml`).
- **Typecheck**: `pnpm run typecheck` (canonical full check; runs `typecheck:libs` + every leaf workspace's `tsc --noEmit`).
- **Tests**: `pnpm --filter @workspace/api-server run test` (vitest, includes live-DB heat-SQL regression that auto-skips when `DATABASE_URL` is unset). `pnpm --filter @workspace/scanner run test` (vitest + jsdom).
- **DB push**: `pnpm --filter @workspace/api-server exec drizzle-kit push` (applies the Drizzle schema in `lib/db/src/schema/` to the dev database).
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

- `artifacts/api-server/`: Express API backend
- `artifacts/scanner/`: React + Vite frontend (NSE)
- `artifacts/global/`: Global multi-asset React + Vite frontend
- `lib/db/src/schema/`: Drizzle schema (paperTrading, swingScan, etc.)
- `lib/api-spec/openapi.yaml`: OpenAPI specification (source of truth for codegen)
- `artifacts/scanner/src/theme/`: UI theme configurations
- **`docs/paper-trader-architecture.md`**: Long-form rationale for F&O Phases 1-4, paper-trader Pass-1/2/3 gates, trade-drought fix, observability addendum, OI Lab backfill, Equity Entry-Safety Gate, Account surface, Kite Offline UX, and Pro Swing Scanner v3 port. **Read this for the "why".** `replit.md` keeps only the current-state summary and active guardrails.
- **`docs/combo-paper-trader-design.md`**: Tier-C design note for a separate `paper_trade_combo` lane (manual multi-leg entries from the Strategy Builder). **Phase 1 SHIPPED 2026-05-13** — see Combo paper-trader lane below.

## Architecture decisions

### Cross-cutting
- **Dev-vs-prod paper-trading isolation (2026-05-13)**: Dev/Workspace preview is **read-only** for the paper auto-trader by default — `runEquityPaperTradingTick`, `tryOpenPaperTrades`, `reconcileMissingPaperTrades`, and the inner `openPaperTrade` (FO) all early-return when `isPaperAutoTradingEnabled()` is false. Resolution: `PAPER_TRADING_ENABLED` env override (`1`/`true`/`yes`/`on` enable, anything else disable, fail-closed on unrecognised) → falls back to auto-detect via `REPLIT_DEPLOYMENT === "1"`. Production deployment has `PAPER_TRADING_ENABLED=true` set explicitly. Manual buys (`POST /paper/positions/eq/manual`) and manual closes are NOT gated. UI: `EnvironmentBanner` on `/paper-trading` (green when prod+live, amber otherwise). Diagnostics: `GET /paper/diagnostics/environment` (public, no secrets — only `env`/`autoTradingEnabled`/`reason`). EQ mark-to-market still runs in dev so existing OPEN positions move correctly.
- **Secure Authentication**: HMAC-SHA256 HttpOnly session cookies with role-based access control.
- **Public Access Mode**: Read-only access to the entire site via a shareable URL for unauthenticated users.
- **Legal Pages Accessibility**: `/legal/*` paths bypass login with a stripped-down UI.
- **Data Sourcing Priority**: Kite Connect for real-time data, Yahoo Finance fallback for delayed.
- **Compliance-driven Signal Labels**: API/DB use `STRONG_BUY/BUY/NEUTRAL/SELL/STRONG_SELL`; UI renders `STRONG BULLISH/BULLISH/NEUTRAL/BEARISH/STRONG BEARISH` for compliance.
- **Kite Offline UX**: When Kite session expires the server falls back to Yahoo and panels go sparse; `KiteOfflineBanner` (Scanner / Stock Detail / Deep Scan) and `KiteOfflineNote` (fundamentals, Deep Scan snapshot) tell the owner before they think the app is broken. Owner-only "Reconnect Zerodha" CTA. See architecture doc for branching copy + dev `?mockProvider=` override.

### F&O signal pipeline (full detail in `docs/paper-trader-architecture.md`)
- **F&O universe = NIFTY / BANKNIFTY / SENSEX only** (`OPTION_INDICES` in `optionSignals.ts`, `FNO_INDICES` in `oiLab.ts`, `SIGNAL_INDEX_TO_LTP_KEY`). To restore an index: re-add to all three.
- Phase-1 regime + IVR/IVP + sticky daily/weekly DD caps; Phase-2 EMA20/50 + intraday VP; Phase-3 confluence engine REPLACES per-detector confidence (legacy preserved in `lib/optionSignals.legacyEmit.bak.ts`); Phase-4 KiteTicker WebSocket for index spots.

### Paper-trader safety nets (active guardrails — constants in `paperAccount.ts`)

| Gate | Constant / Trigger | Audit tag | Effect |
|---|---|---|---|
| F&O option-leg liquidity | `FNO_LIQUIDITY` (LTP≥20, spread≤1.5%, OI≥50k) | — | Reject open; fail-OPEN |
| F&O 15:20 IST force-exit | `forceCloseAllOpenFnoFor1520`, latch `lastForceExit1520Date` | `TIME_EXIT_1520` | Close all open FNO |
| Equity stop-loss sanity | `EQUITY_STOP_SANITY` (1%–8%) | — | Reject swing entry |
| Equity DD caps | `EQUITY_DD_CAPS` (2/4/8% of ₹10L) | — | Block opens; sticky latches |
| F&O DD caps | `MAX_DAILY_LOSS_PCT=0.025` / `MAX_WEEKLY_LOSS_PCT=0.05` | `DAILY_DD_CAP` / `WEEKLY_DD_CAP` | Block opens; sticky latches |
| Vol-clamped stop | `VOL_CLAMP_REJECT_RATIO=1.5` | `VOL_CLAMPED_STOP` | Reject above ratio; below → demote HC→BASELINE |
| HTF (daily-EMA50) | `ctx.htfBias` opposes direction | — | Demote HC→BASELINE |
| True 1h HTF | EMA9/21 stack on session-aware 60m bars | `HTF1H_CONFLICT` | Demote HC→BASELINE |
| Time-of-day | 09:15–09:30 / 15:15–15:30 IST | `OPENING_NOISE` / `CLOSING_NOISE` | Demote HC→BASELINE |
| Expiry-day | `regime==="EXPIRY_DAY"` | `EXPIRY_DAY` | Demote HC→BASELINE |
| Sector relative strength | `RELATIVE_STRENGTH.TOLERANCE_PCT=1.0` (NIFTY exempt) | `RS_CONFLICT` | Demote HC→BASELINE |
| 30-day setup win-rate | `WIN_RATE_CALIBRATION {LOOKBACK:30, MIN_SAMPLE:10, MIN_WR:0.4}` | `LOW_WINRATE` | Demote HC→BASELINE |
| ATM-strike OI confluence | Both legs vote against direction (`|atmVote|≥2`) | `OI_ATM_CONFLICT` | Mutate `tier="BASELINE"` |
| Post-stop cool-down | 60min, 0.5× lot multiplier; index-scoped | — | Sizing scale |
| VOLATILE regime sizing | `REGIME_SIZING.VOLATILE_MULT=0.5` | — | Sizing scale |
| Portfolio heat cap | `PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT=0.06` / `MAX_EQ_HEAT_PCT=0.06` | — | Reject open; FAIL-CLOSED, runs in same `FOR UPDATE` tx |

**Combined `isDemoted` partition**: `volClamped || htfConflictGate || noiseWindow || inExpiryDay || htf1hConflictGate || rsConflictGate || lowWinRateGate`. Demoted setups partition OUT of top-3 HC pool BEFORE slicing, append as BASELINE-tier extras. ATM-OI gate is OUT of the partition (post-emission tier mutation). All P3 gates **fail-OPEN** on data failure.

**Sub-tiered BASELINE sizing (2026-05-11)**: `FNO_BASELINE_RISK` (MICRO 0.25 % conf 55-59 / BASELINE 0.5 % conf 60-64 / STANDARD 2 % conf 65+) + `FNO_BASELINE_GUARDRAILS` (max 2 BASELINE/day, 0.75 % daily loss cap incl. unrealised, 2-loss lane lock, 14:45 IST late-entry cutoff). `getBaselineDayStats` fails CLOSED via `BASELINE_GUARDRAIL_STATS_UNAVAILABLE`.

**Active dial overrides**: `PAPER_FIXED_LOTS = {NIFTY:10, SENSEX:40, BANKNIFTY:30}` (overrides dynamic budget for STANDARD-tier opens); `CONFIDENCE_THRESHOLDS.MIN_FNO_TRADE = 65` (aligned with `HC_EMISSION_FLOOR`).

### Equity Entry-Safety Gate (equity swing only)
`computeEntrySafety()` in `lib/scoring.ts` surfaces `entryQuality` GOOD/FAIR/POOR + `entryPlan`. POOR demotes `STRONG_BUY→BUY` (audit `LATE_ENTRY_AT_RESISTANCE/SUPPORT`), naturally blocking paper-trader auto-opens which require `STRONG_BUY`. UI: `EntryPlanCard` on stock-detail.

### Technical Analysis (NIFTY 500) — Pro Swing Scanner v3
TS port of the Python "Pro Swing Scanner v3" surfaced as a third section on `/stocks-to-watch`. Pure-math `lib/swingScanner.ts` + `lib/swingScannerData.ts` (Kite-first, Yahoo fallback) + `lib/swingScannerStore.ts` (deep scan once-per-day after 15:35 IST + 15min intraday LTP refresh). API: `GET /api/stocks-to-watch/analysis`. Cold-start latch keys off `swing_scan_run` audit row, not result rows. Single-replica assumption.

### OI Lab
- **Δ-window Kite-historical backfill**: First `fetchOiInsights` per (underlying|expiry|day) when buffer < 8 snaps fires background `kc.getHistoricalData(..., oi=true)` for ATM±7 strikes × 2 sides. Same-ts merge never overwrites live snaps. WORKERS=2 per index. Fail-OPEN.

### Options Strategy surface
- `/strategies` has two tabs: **Recommended Plans** (existing 13-strategy regime-ranked bundle, `GET /options/strategies/:underlying`) and **Custom Builder** (`StrategyBuilder` in `pages/strategies-builder.tsx`, max 8 legs, scenario sliders for spot ±20% / IV ±50% / days passed). Builder calls `POST /options/strategies/:underlying/custom` (debounced 300ms) which delegates to `buildCustomStrategy` + `simulateScenario` in `lib/optionStrategies.ts` — both reuse `buildPayoff`, `distributionalMetrics`, `computeLegEdges`, `estimateMargin`, `classifyLegQuality`, `netGreeks`, `netDebit`, `midOrLtp`, `legLiquidity`. **Zero math duplication client- or server-side.** Builder is read-only — no order placement, no paper-trade integration in v1.
- Option chain has an `oiSpike` filter (Unusual OI Buildup): `OI≥5000 AND |ΔOI/OI|≥15%`. Pure helper in `artifacts/scanner/src/lib/optionChainFilters.ts` (`applyStrikeFilter` + constants). Existing volume filter renamed to "Unusual Vol" for clarity.

### Combo paper-trader lane (Tier C, Phase 1, 2026-05-13)
Owner-only manual multi-leg paper trades, fully isolated from the auto `paper_trade_fo` lane.
- **Tables** (`paper_trade_combo` + `paper_trade_combo_leg`): UNIQUE(combo_id, leg_index), 6 CHECK constraints, FK CASCADE. Combo legs persist `qty = lots × lotSize` (shares) and `lots` is taken straight from the request, never reverse-derived. P&L formula `Σ sign·(last−entry)·qty` therefore yields rupees.
- **Routes** (`/api/paper/combos`): owner-only. POST opens, GET lists/details (re-marks live on detail), POST `:id/close`. All pricing comes from `fetchOptionChain` server-side; the request schema does not accept premium/IV/Greeks/margin/P&L — `sanitizeLegSpec` strips them defense-in-depth.
- **Defined-risk only v1**: rejects naked shorts/ratios via `snapshot.maxLoss == null` → `UNDEFINED_RISK` 400.
- **Concurrency safety**: open-cap (`COMBO_MAX_OPEN`) gated inside the insert txn under `pg_advisory_xact_lock(7593721)`; close uses CAS `WHERE id=? AND status='OPEN'` and returns "already closed" for the loser of a race.
- **Isolation**: auto-trader paths (`runFnoPaperTradingTick`, `tryOpenPaperTrades`, etc.) only touch `paper_trade_fo`/`paper_trade_eq`; combo lane never enters the FNO heat budget and is **opted out of the 15:20 force-exit**.

### Account surface
- `/paper-trading` is live-only; closed history / equity curve / analytics / journal live in `/paper-reports`.
- Equity Account Card: Capital sub-grid + Open-portfolio MTM sub-grid. `lifetimeRealizedPnl` is server-side (top-up safe).

### Diagnostics & observability (Paper F&O)
- `GET /paper/diagnostics/untriggered/fo` — groups skips by reason / index / tier with 50-row recent log.
- `GET /paper/diagnostics/daily-summary/fo` — today's IST-day metrics with two date anchors (opened-today vs closed-today).
- `GET /paper/diagnostics/daily-summary/fo/history?from=&to=` — trailing-30-day persisted history from `paper_daily_summary_fo`.
- `getOperationalAlerts()` — process-level counters (e.g. `baselineStatsUnavailableAlertCount`).

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

- **Kite API Rate Limiting**: Use exponential backoff; do not poll F&O Top-50 faster than 15s.
- **F&O Signal Sweep Cadence**: `TRIGGER_SWEEP_INTERVAL_MS = 30s`. Do not set below 15s (Kite throttling).
- **F&O Signal Pipeline (HARD-CUT 2026-05-06)**: F&O code paths NEVER touch Yahoo. `optionSignals.ts` daily history → Kite `day` interval; `optionSignalGates.ts` VIX → Kite-only (no-op when missing). `tradingConfig.isActionableForFno` returns false for `DELAYED_YAHOO`. Yahoo remains only for non-F&O segments.
- **Paper-trade DB column names**: `paper_trade_eq` uses `entry_price`/`stop_price` (not `entry`/`stop_loss`); `paper_trade_fo` uses `entry_premium`/`stop_premium`. Heat-SQL fragments in `paperAccount.ts` must reference the schema columns exactly — column-name typos surface as `Failed query` + a "continuing" warn that silently skips trade opens (see 2026-05-13 fix).
- **Paper Trading Anti-phantom-trade rules**: Logic for closing already-exited signals and backfilling missing trades. `reconcileMissingPaperTrades` reads `h.tier AS persisted_tier` to prevent post-deploy re-promotion.
- **MissedSignal Log Dedup**: `recordMissedSignal()` returns a boolean to prevent log spam.
- **Signal Display vs. Enum**: When changing display text, only modify the display layer (e.g., `signal-badge.tsx`), never the underlying `Signal` enum strings used by API/DB.
- **OI Change Calculation**: Dependent on `oi_day_low`/`oi_day_high` from Kite quotes (occasional inconsistencies).
- **Indices Board Hang Protection**: `getIndicesBoard()` uses an 8s `Promise.race` deadline; client `<IndicesBoard>` has a 25s `loadingTooLong` flag.
- **Empty-state Copy**: Empty panels show "No live data — last attempt X" + Retry, distinct from a perpetual loading state.
- **Index-detail Pivots**: `/api/index/:slug` returns `previousHigh`, `previousLow`, and classical floor `pivots`.
- **Side-correct R/S in OI analytics**: `computeAnalytics()` filters `topResistance` to CE strikes ≥ spot, `topSupport` to PE strikes ≤ spot.
- **Paper-trade LTP is live**: `GET /paper/positions/fo` and `POST /paper/positions/fo/:id/close` refresh `lastPremium` from a fresh `fetchOptionChain()` pull.
- **Buy column gating**: Scanner `Row` Buy pill renders only when `signal === "STRONG_BUY" || "BUY"`; everything else shows muted `—`.

## Pointers

- **Zerodha Kite Connect**: https://kite.trade/docs/connect/v3/
- **Drizzle ORM**: https://orm.drizzle.team/docs/overview
- **Zod**: https://zod.dev/
- **TanStack Query**: https://tanstack.com/query/latest
- **OpenAPI Specification**: https://swagger.io/specification/
