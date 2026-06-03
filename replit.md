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

### Code

- `artifacts/api-server/`: Express API backend
- `artifacts/scanner/`: React + Vite frontend (NSE)
- `artifacts/global/`: Global multi-asset React + Vite frontend
- `lib/db/src/schema/`: Drizzle schema (paperTrading, swingScan, optionChainSnapshot, candleWarehouse, etc.)
- `lib/api-spec/openapi.yaml`: OpenAPI specification (source of truth for codegen)
- `artifacts/scanner/src/theme/`: UI theme configurations

### Data infrastructure (full notes in **`docs/data-infrastructure.md`**)

- **Sector / industry mapping** — `artifacts/api-server/src/lib/sectorMap.ts` + diagnostic `GET /api/stocks-to-watch/diagnostics/sector-coverage`.
- **Option-chain snapshots** — `lib/db/src/schema/optionChainSnapshot.ts` + diagnostics `GET/POST /api/option-snapshots/*`. Write-only, does not feed trading decisions. Read-only analytics surface added 2026-05-15: `GET /api/option-snapshots/analytics` (owner-only, strict gate) computes PCR / total OI / OI deltas / highest-OI strike per side / highest-positive-OI-change / approx max-pain / ATM straddle / ATM IV / spread summary / staleness, defaulting to the latest snapshot per (underlying, top-2 most-recent expiries). Pure module: `artifacts/api-server/src/lib/optionSnapshotAnalytics.ts`. Does not feed any trading decision.
- **Candle warehouse** — `lib/db/src/schema/candleWarehouse.ts` + diagnostics `GET/POST /api/candles/*`. Write-only data substrate.
- **Equity sizing helper** — `artifacts/api-server/src/lib/equitySizingHelper.ts` + diagnostics `GET /api/paper/eq/sizing-preview` and `GET /api/paper/eq/candidates-diagnostic`. Read-only preview, mirrors `openPaperEquityTrade`'s 11-gate sequence; never called from any execution path.

### Architecture docs

- **`docs/paper-trader-architecture.md`** — long-form rationale for F&O Phases 1-4, paper-trader Pass-1/2/3 gates, trade-drought fix, observability addendum, OI Lab backfill, Equity Entry-Safety Gate, Account surface, Kite Offline UX, Pro Swing Scanner v3 port. **Read this for the "why".**
- **`docs/combo-paper-trader-design.md`** — Tier-C design note for the `paper_trade_combo` lane. Phase 1 SHIPPED 2026-05-13 (see Combo paper-trader lane below).
- **`docs/data-infrastructure.md`** — per-feature notes for sector map, option-chain snapshots, candle warehouse, equity sizing helper, combo lane.
- **`docs/audit-implementation-status-2026-05-15.md`** — implementation status report for audit Priorities 1-5 (all COMPLETED 2026-05-15) plus pending operator security actions and remaining audit backlog.

### Owner-only Data Infrastructure Health dashboard (Priority 10, 2026-05-15)
Read-only owner-only roll-up at `/infra-health` (nav: INFRA next to ADMIN). Five sections: Security Status, Sector/Industry Mapping, Candle Warehouse, F&O Option-Chain Snapshots (diagnostics + Priority 9 analytics), Equity Risk Diagnostics (incl. on-demand sizing-preview form). Pure severity helpers in `artifacts/scanner/src/lib/infraHealth.ts` (`deriveAgeSeverity`, `deriveCoverageSeverity`, `deriveSnapshotSeverity`, `deriveCandleSeverity`, `deriveSnapshotSectionSeverity`, `formatAge`, `rollUp`). Snapshot section badge AND header roll-up both consume `deriveSnapshotSectionSeverity` so analytics-down with diag-green correctly surfaces as WARN, never OK. Independent 30s wall-clock state so staleness ages in real time even with auto-refresh OFF. Consumes existing endpoints only (`/api/security/audit`, `/api/stocks-to-watch/diagnostics/sector-coverage`, `/api/option-snapshots/diagnostics`, `/api/option-snapshots/analytics`, `/api/candles/diagnostics`, `/api/paper/eq/candidates-diagnostic`, `/api/paper/eq/sizing-preview`). Zero backend, signal, scheduler, ingestion, or schema changes. 16 unit tests in `infraHealth.test.ts`.

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

### Portfolio Analyser (read-only, Phase 1, 2026-06-02)
Owner/subscriber tab at `/portfolio-analyser` (nav: "Portfolio", `tab: "PORTFOLIO_ANALYSER"` registered in `App.tsx`, `layout.tsx`, `auth-api.ts`, `lib/db/src/schema/users.ts`, `admin.tsx` — the schema entry is a string allow-list constant, **not** a DB migration). **Pure frontend, client-session-only** — no backend/DB/trading/scheduler/env changes; holdings live in React state only (never persisted). Real data via existing generated hooks (`getStockDetail` through `useQueries` for the table; `useGetStockDetail` + `useGetNews` in the deep-dive). **No silent mock data** — genuinely-unavailable data is explicitly labelled (live CMP unavailable, "Benchmark unavailable" for absent Nifty-500 sector weights, XIRR-unavailable). **SEBI-neutral**: only the neutral action-view vocabulary from `score.ts` (`Strong Structure / Hold with Review / Mixed / Watch / Weak Structure / Reduce Review / Exit Review / Avoid Fresh Buy`); support/resistance rendered only as "zones"; the tab NEVER surfaces `recommendation.target/stopLoss/displayLabel/signal`. Pure tested libs in `artifacts/scanner/src/lib/portfolio/` — `types.ts`, `csv.ts` (template + quoted parser + row validation), `calc.ts` (per-holding metrics, summary, sector allocation, Newton-Raphson XIRR), `score.ts` (transparent composite from AVAILABLE signals only + neutral label + risk flags). Sample portfolio is opt-in with a persistent amber "preview only" banner (real tickers/quotes; only qty/rate/date are illustrative); "Load from Database" is disabled (not configured in v1). Tests: `csv.test.ts`, `calc.test.ts`, `score.test.ts` (395/395 scanner tests pass).

### Portfolio Analyser Phase 2 — Save & Enrich (2026-06-03)
Makes Phase-1 portfolios **DB-persisted per-user** (survive refresh) and adds honest enrichment panels. **Per-user privacy**: new tables `portfolios` + `portfolio_holdings` (`lib/db/src/schema/portfolio.ts`, `ownerKey`-scoped FK); CRUD routes in `artifacts/api-server/src/routes/portfolio.ts` mounted under `/portfolios/*` (owner OR subscriber, each sees only their own rows — **no public/shared access**; unauth → empty/403). OpenAPI paths+schemas added to `lib/api-spec/openapi.yaml` → generated `Portfolio/PortfolioHolding/PortfolioHoldingInput/PortfolioSummary` DTOs + async client fns. Express-5 gotcha: `req.params["id"]` is `string|string[]` — use the `paramId(req)` helper. **Advisory fields (targetPrice/stopLoss) are intentionally NOT persisted** — only user book-keeping (qty/rate/date/broker/tag/notes/isin/dividendReceived/realisedPnl).
- **Frontend persistence**: `artifacts/scanner/src/lib/portfolio/persistence.ts` — pure mappers `holdingToRaw`/`rawToInput` + `usePortfolios()` React-Query hook. Page (`pages/portfolio-analyser.tsx`) auto-loads the default portfolio on mount, dirty-tracks via a holdings signature, and exposes switch/save/save-as/rename/set-default/delete via `components/portfolio/portfolio-toolbar.tsx`. Sample data stays save-disabled.
- **New pure tested libs** (`artifacts/scanner/src/lib/portfolio/`): `returnLabel.ts` (XIRR vs Annualised-Estimate vs Unavailable labelling — fixes the misleading "approx XIRR" when dates are missing), `risk.ts` (HHI/top-weight/value-weighted-beta+coverage/contributors/data-availability + flags, `RISK_THRESHOLDS`), `allocation.ts` (sector/stock/market-cap/P&L/win-loss views, `MARKET_CAP_BUCKETS`; market-cap honestly unavailable when no mcap), `holdingPeriod.ts` (`LONG_TERM_THRESHOLD_DAYS=365` config + dividend totals/yield-on-cost), `benchmark.ts` (honest "unavailable" — no index close-series is wired, sector over/under-weight explicitly **not fabricated**).
- **UI panels** (`components/portfolio/analytics-panels.tsx` + `methodology.tsx`): Risk, Allocation (mode toggle), Cost-Basis & Income, Benchmark, plus a collapsible Methodology disclosure. KPI strip now uses `returnLabel`; Day-P&L tile carries a formula tooltip (`qty×(CMP−prevClose)`). Deep-dive: bare em-dash stats render as labelled "n/a" with a "not reported by source" tooltip; structure-score shows a 0–100 scale tooltip (bands 0–39 weak / 40–59 mixed / 60–79 constructive / 80–100 strong); news section labelled "<SYMBOL> only". **No ADX anywhere** — score is the transparent `score.ts` composite (confirmed).
- **Strict scope**: NO changes to trading/F&O/paper-exec/stop-target-sizing/scanner-scoring/Kite-auth/scheduler. Benchmark return is left honestly unavailable rather than fabricated. Tests: `returnLabel/risk/allocation/holdingPeriod/benchmark/persistence.test.ts` (464/464 scanner, 812/812 api-server, full typecheck green). **Not published** — owner to deploy when ready.

### Navigation restructure — grouped nav (2026-06-02)
`artifacts/scanner/src/components/layout.tsx` top-level nav was reorganised from ~21 flat tabs into professional grouped dropdowns (Radix `DropdownMenu`). **Presentation-only — zero route/page/data/feature/auth/API/DB/schema/env/scheduler change.** Groups: **Home** (link), **Stock Intelligence** (Full Scanner / Deep Scan / Watchlist / Sector Rotation / To Watch), **Derivatives** (Option Chain / OI Lab), **Trading Desk** (F&O Intraday / Strategies / Paper Trading* / P&L Reports*), **Market Pulse** (Pre/Post / Market Info / FII·DII / Live Feed*), **Charting** (link), **Portfolio** (link → Portfolio Analyser), **Learn** (link), **Admin*** (Admin Console / Audit / Status / Infra). `*`=owner-only. Each leaf keeps its **original href** and its `tab`/`ownerOnly` visibility tag; a new `desc` page-purpose label renders in each dropdown (direct links carry it as a `title` tooltip). Visibility helper `canSee()` is functionally identical to the old flat filter (owner→all; `ownerOnly`→owner-only; tab-gated→`allowedTabs.includes(tab)`); a group renders only if ≥1 child is visible, so **no owner-only page is ever exposed to subscribers/public**. Top-right ADMIN + INFRA quick-access chips left untouched (dual access; report notes the redundancy). Dropdown content portals (Radix `Portal`) so it is not clipped by the nav's `overflow-x-auto`; `data-active` preserved on links + group triggers for the existing active-tab auto-scroll. Deferred to a future phase **as recommendations only** (not implemented, to stay within the safe nav-only scope): cross-page empty-state copy, data-source-badge wording consistency, and compact/collapsible ticker. Full mapping + report: `docs/navigation-restructure-2026-06-02.md`. Architect review PASS (no visibility/security regression); 395/395 scanner tests + typecheck green.

### P22: All-Open F&O Paper-Trade MTM Coverage Fix (2026-05-19)
Closes the MTM-staleness gap noted at P21b EOD: `markOpenFnoTradesToMarket` only updates OPEN rows whose (index, setup, direction) is in the **current** signal cohort, so rows that drop out went idle on `last_premium`/`max_runup`/`max_drawdown` until 15:20 force-exit. Now a second chain-driven sweep `markAllOpenFnoTradesToMarket(signalDate)` runs immediately after the cohort path in `getOptionSignals` and refreshes every OPEN row by looking up its stored `strike`/`optionType` in a freshly fetched chain for its `indexSymbol`. Pure helper `pickLtpFromChain(chain, strike, optionType)` does the lookup (epsilon-tolerant strike match for numeric(_,4) round-trip jitter). Updates only `last_premium`, `last_evaluated_at`, `max_runup` (GREATEST — monotone), `max_drawdown` (LEAST — monotone). 45-second freshness window (`MTM_FRESHNESS_WINDOW_MS`) skips rows already refreshed by the cohort path. Per-index batching (≤3 `fetchOptionChain` calls per cycle for NIFTY/BANKNIFTY/SENSEX; existing ~5s TTL cache makes repeats free). Top-level + per-row try/catch; caller wraps in `.catch(...)` — sweep failure can never break the signal loop. Optional `dbHandle` param is a test-injection seam (`Pick<typeof db, 'select' | 'update'>`); production passes nothing. Diagnostics: `getMtmSweepHealth()` returns `{cyclesTotal, rowsUpdatedTotal, lastCycle:{considered, updatedFromChain, skippedAlreadyFresh, skippedNoQuote, errors}, lastSuccessAt, lastErrorAt/Class/Message}`. 16 tests in `paperTradingFoMtmSweep.test.ts` (DB-rollback pattern; everything inside one `tx`, `tx.rollback()` at end → zero footprint on dev DB; auto-skip when `DATABASE_URL` unset). 493/493 api-server tests pass.

**Approved behaviour impact (sign-off 2026-05-19)**: `last_premium` is read by two paths beyond pure display — `pickExitPremium()` (TIME_EXIT_1520 / EXPIRED / MANUAL_OVERRIDE close settlement → realized P&L) and `getBaselineDayStats()` (`entry_premium − last_premium` → BASELINE 0.75 % intra-day loss-cap). Fresher MTM therefore makes BOTH **more accurate**, not less. Explicitly approved as a welcome side-effect — *not* a violation of P22 strict scope. **Unchanged**: signal generation, entry conditions, stop-loss / target formulas, sizing, gate thresholds, Kite execution, swing scanner, equity paper-trader, scanner, strategy builder, combo lane, snapshot/candle ingestion, scheduler, schema.

**Rollback**: remove the `await markAllOpenFnoTradesToMarket(...)` call site in `optionSignals.ts` (one block). The function and its tests can stay dormant; no schema migration, no scheduler change, no data backfill is required either way.

### Shadow F&O Cost / Slippage / Spread Model (P17b, 2026-05-17)
Reporting-only cost overlay. Pure deterministic model `artifacts/api-server/src/lib/fnoCostModel.ts` (`computeFnoTradeCost` + `FNO_COST_PARAMS`: brokerage ₹20/side, STT 0.0625% sell premium, exchange 0.03503%, SEBI 0.0001%, GST 18%, stamp 0.003% buy, spread 25bps/side, slippage 10bps/side). Aggregator `fnoShadowCosts.ts` joins `paper_trade_fo` (CLOSED) ↔ `option_signal_history` for tier, groups gross-vs-shadow-net by setup/index/tier/exitReason, surfaces top-N "flipped-to-loss" trades. Owner-only endpoint `GET /api/paper/analytics/fo/shadow-costs?from=&to=&topNFlipped=`. UI section on `/infra-health` ("F&O Shadow Costs"). Feature flag `PAPER_FO_COSTS_SHADOW_ENABLED` (default ON; only gates reporting). **NO** changes to signal/entry/exit/stops/targets/sizing/gates/confluence/paper-exec/realised P&L/DD caps/circuit-breakers/heat/Kite/swing/equity/scanner/strategy/combo/snapshot/candle/scheduler/schema. Distinguishes exit=null (open: 1-side brokerage, gross/net=null) from exit=0 (expired worthless: 2-side brokerage, STT=0, gross computed). 22 unit tests in `fnoCostModel.test.ts` (446/446 api-server tests pass).

### F&O Observability Substrate (P17a, 2026-05-17)
Diagnostics-only repair so future sessions populate `fno_signal_reasoning`, `paper_daily_summary_fo.skipped_by_reason`, exact `signal_fingerprint`, and `setup_key`. **NO** changes to signal generation, entry, exit, sizing, stops, targets, gates, confluence, paper-trade exec, Kite, swing, paper-equity, scanner, strategy, combo, option snapshot, candle ingestion, or scheduler. Three pieces:
1. **Process-local logger health counters** (`fnoSignalReasoningLogger.ts`): `getReasoningLoggerHealth()` returns `{writesAttempted, writesSucceeded, writesFailed, lastSuccessAt, lastErrorAt, lastErrorClass, lastErrorMessage (≤200 chars), bootedAt}`. `__resetReasoningLoggerHealthForTests()` for unit tests. Fire-and-forget contract preserved.
2. **Durable skip-reason fallback** (`paperDailySummaryFo.ts`): `fetchDurableSkipReasons(date)` consults `fno_signal_reasoning WHERE decision IN ('SKIPPED','MISSED_WINDOW')` when the in-memory `getMissedSignals()` ring is empty for the IST date (ring resets on every process restart). Fail-OPEN: returns empty histogram on DB error.
3. **Owner-only diagnostics endpoint** `GET /api/paper/diagnostics/fno-observability` + UI section ("F&O Observability Substrate (P17a)") on `/infra-health`. Returns verdict OK/WARN/FAIL with reasons, loggerHealth, durable totals (rowsToday, decisionsToday histogram, upstream/downstream split, fingerprint coverage %, skip-durable count), missedRing snapshot, and `paper_trade_fo.setup_key` distribution with validity flags. Known-valid set: `TREND_CONTINUATION/VWAP_RECLAIM/VOLUME_BREAKOUT/EMA_PULLBACK/MEAN_REVERSION/BASELINE` ("BASELINE" is the legitimate always-on directional detector at `optionSignals.ts:985`, not a tier conflation). 5 unit tests in `fnoObservability.test.ts`.

Root cause of empty substrate: logger + table both deployed 2026-05-17 07:41 UTC (Sunday, market closed). 0 rows because `getOptionSignals()` only fires during market hours; auto-trader is OFF in dev (`PAPER_TRADING_ENABLED` unset).

### F&O Failure Diagnosis Report (P16, 2026-05-17)
Owner-only READ-ONLY endpoint `GET /api/paper/analytics/fo/failure-diagnosis` + UI section on `/infra-health` ("F&O Failure Diagnosis"). Pure module `artifacts/api-server/src/lib/fnoFailureDiagnosis.ts` consumes `fno_signal_reasoning` rows (linked via P15b `signal_fingerprint`) and produces 8 sections: A setup table, B index table, C tier table + HC-vs-BASELINE verdict, D lifecycle funnel (EMITTED→OPENED→T1→T2 / →STOPPED conversions via exact fingerprint), E stop-loss deep dive (by setup/index/confidence/regime + after-T1 reversal count), F untriggered/expired (skip-reason histogram + late-session ≥14:00 IST share), G missing-data/demotion (per-field stop-rate correlation), H ten-hypothesis ranking (H1–H10) with each tagged status ∈ {proven, likely, insufficient_data, undetermined} and sample size. Filters: date range, index, setup, tier, direction, decision, reason code, regime, plus new `exactOnly=1` (rows with `signal_fingerprint IS NOT NULL`). Recommendations list only proven/likely hypotheses, ordered by status priority. **NO changes** to signal generation, entry, exit, sizing, stops, targets, gates, confluence, paper-trade exec, Kite, swing, paper-equity, scanner, strategy, combo, option snapshot, candle ingestion, or scheduler. 23 unit tests in `fnoFailureDiagnosis.test.ts` (414/414 api-server tests pass).

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

## Security hygiene

- **Kite token encryption-at-rest** — `kite_session.{api_key, access_token, public_token}` are AES-256-GCM encrypted (envelope `v1:<iv>:<tag>:<ct>`) when `KITE_TOKEN_ENC_KEY` is set. Implementation: `lib/kiteCrypto.ts` + `kiteAuth.ts`. Falls back to plaintext + one-time warn if the key is unset — **always set the key in production**. Decrypt failures are fail-closed; the daily 06:00 IST login flow recovers. See `docs/audit-implementation-status-2026-05-15.md` (Priority 1) for full notes.
- **Kite-token key rotation** — `pnpm --filter @workspace/api-server run rotate:kite-key` (dry-run) / `... -- --apply` (write). Reads `KITE_TOKEN_ENC_KEY_OLD` + `KITE_TOKEN_ENC_KEY_NEW` from env, decrypts the live `kite_session` row with OLD and re-encrypts under NEW inside one transaction. Never logs token plaintext or key bytes (only sha256[:8] fingerprints). Full operator runbook: `docs/kite-token-enc-key-rotation.md`.
- **DB exports** — never share a raw `pg_dump` of the live DB. Use `scripts/safe-db-export.sh` (excludes `kite_session`; scrubs `users.password_hash` + `global_screener_presets.share_token`).
- **`/api/kite/export-session` is APP_ACCESS_PASSWORD-gated**, not owner-cookie-gated, so dev can mirror prod via `autoMirrorSession()`. If APP_ACCESS_PASSWORD ever leaks, rotate it before the next 06:00 IST. Set `KITE_MIRROR_ALLOWED_HOSTS` explicitly in production.
- **Credential rotation order after a leak**: (1) `KITE_API_SECRET` in Zerodha developer console → (2) `APP_ACCESS_PASSWORD` → (3) `SESSION_SECRET` → (4) Postgres password / `DATABASE_URL` → (5) `TRADINGVIEW_WEBHOOK_SECRET`. Current `kite_session` row auto-dies at the next 06:00 IST or via `DELETE FROM kite_session;`.
- **`.gitignore` blocks** `.env*`, `*.sql`, `*.dump`, `*.backup`, `safe-export-*.sql`. Live security checks live in `securityAudit.ts` and surface in the owner-only audit dashboard.

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
