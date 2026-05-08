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
- `docs/paper-trader-architecture.md`: Long-form rationale for F&O Phases 1-4, paper-trader Pass-1/2/3 gates, OI Lab backfill, and account-surface decisions.

## Architecture decisions

### Cross-cutting
- **Secure Authentication**: HMAC-SHA256 HttpOnly session cookies with role-based access control.
- **Public Access Mode**: Read-only access to the entire site via a shareable URL for unauthenticated users.
- **Legal Pages Accessibility**: `/legal/*` paths bypass login with a stripped-down UI.
- **Data Sourcing Priority**: Kite Connect for real-time data, Yahoo Finance fallback for delayed.
- **Compliance-driven Signal Labels**: API/DB use `STRONG_BUY/BUY/NEUTRAL/SELL/STRONG_SELL`; UI renders `STRONG BULLISH/BULLISH/NEUTRAL/BEARISH/STRONG BEARISH` for compliance.
- **Macro 5D Sparklines**: `/api/market/macroHistory` returns 5-day daily closes for key global indices, cached 5 min.

### F&O signal pipeline (see `docs/paper-trader-architecture.md` for full detail)
- **F&O universe = NIFTY / BANKNIFTY / SENSEX only** (`OPTION_INDICES` in `optionSignals.ts`, `FNO_INDICES` in `oiLab.ts`, `SIGNAL_INDEX_TO_LTP_KEY`). To restore: re-add to all three.
- **Phase-1**: Regime classifier (`lib/regimeClassifier.ts`) + IVR/IVP per-index snapshot (`lib/ivHistory.ts`) + sticky daily/weekly DD caps (`paperAccount.ts` constants `MAX_DAILY_LOSS_PCT=0.025` / `MAX_WEEKLY_LOSS_PCT=0.05`, latches `dailyDdLatch`/`weeklyDdLatch`, skipReasons `DAILY_DD_CAP`/`WEEKLY_DD_CAP`).
- **Phase-2**: EMA20/50 series + 60-bar intraday volume profile (`vpIntraday`) added to `Ctx` and surfaced on `OptionSignal`.
- **Phase-3**: Confluence engine (`lib/confluenceEngine.ts`) REPLACES per-detector confidence — wired AFTER vol-regime haircut, BEFORE `HC_EMISSION_FLOOR`. Legacy emission preserved in `lib/optionSignals.legacyEmit.bak.ts`.
- **Phase-4**: KiteTicker WebSocket for index spots (`kiteFeed.subscribeIndices()`); REST `kc.getQuote` is cold-start fallback.
- **Accurate OI Delta Calculation**: Four invariants (snapshot merging, baseline selection, market-hours guard, session/day guard).

### Paper-trader safety nets (constants in `paperAccount.ts`; gates split between `optionSignals.ts` emission loop and `paperTradingFO.ts`/`paperTradingEq.ts` openPaperTrade)

| Gate | Constant / Trigger | Audit tag | Effect |
|---|---|---|---|
| F&O option-leg liquidity (P1) | `FNO_LIQUIDITY` (LTP≥20, spread≤1.5%, OI≥50k) | — | Reject open; fail-OPEN |
| F&O 15:20 IST force-exit (P1) | `forceCloseAllOpenFnoFor1520`, latch `lastForceExit1520Date` | `TIME_EXIT_1520` | Close all open FNO |
| Equity stop-loss sanity (P1) | `EQUITY_STOP_SANITY` (1%–8%) | — | Reject swing entry |
| Equity DD caps (P1) | `EQUITY_DD_CAPS` (2/4/8% of ₹10L), latches `eqDailyDdLatch`/`eqWeeklyDdLatch`/`eqMonthlyDdLatch` | — | Block opens; sticky |
| Vol-clamped stop (P2A) | `VOL_CLAMP_REJECT_RATIO=1.5` (`clampPlanForIntraday`) | `VOL_CLAMPED_STOP` | Hard-reject above ratio; below → demote HC→BASELINE |
| HTF (daily-EMA50) (P2B-B) | `ctx.htfBias` opposes direction → `htfConflictGate` | — | Demote HC→BASELINE |
| Time-of-day (P2B-C) | 09:15–09:30 / 15:15–15:30 IST | `OPENING_NOISE` / `CLOSING_NOISE` | Demote HC→BASELINE |
| Expiry-day (P2B-F) | `ctx.regime.regime==="EXPIRY_DAY"` | `EXPIRY_DAY` | Demote HC→BASELINE |
| Post-stop cool-down (P2B) | `POST_STOP_COOLDOWN` (60min, 0.5×); index-scoped, stacks with VOLATILE_MULT, floor 1 lot | — | Sizing scale |
| VOLATILE regime sizing (P2B) | `REGIME_SIZING.VOLATILE_MULT=0.5` | — | Sizing scale |
| Portfolio heat cap (P2B) | `PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT=0.06` / `MAX_EQ_HEAT_PCT=0.06`; FAIL-CLOSED, runs in same tx as `SELECT ... FOR UPDATE` on account row | — | Reject open |
| True 1h HTF (P3-A) | Session-aware 4×15m → 60m aggregation; EMA9/21 stack; `ctx.htf1hBias` (needs ≥21 60m bars) | `HTF1H_CONFLICT` | Demote HC→BASELINE |
| Sector relative strength (P3-D) | `RELATIVE_STRENGTH.TOLERANCE_PCT=1.0`; NIFTY exempt; fail-OPEN if either return null | `RS_CONFLICT` | Demote HC→BASELINE |
| 30-day setup win-rate (P3-E) | `WIN_RATE_CALIBRATION {LOOKBACK_DAYS:30, MIN_SAMPLE:10, MIN_WIN_RATE:0.4}` | `LOW_WINRATE` | Demote HC→BASELINE |
| ATM-strike OI confluence (P3-G) | Both legs vote against direction (`|atmVote|≥2`); `applyOiConfirmation` post-emission | `OI_ATM_CONFLICT` + `BASELINE` | Mutate `tier="BASELINE"` |

**Combined `isDemoted` partition (P2A + P2B + P3-A/D/E)**: `volClamped || htfConflictGate || noiseWindow || inExpiryDay || htf1hConflictGate || rsConflictGate || lowWinRateGate`. Demoted setups partition OUT of top-3 HC pool BEFORE slicing, append as BASELINE-tier extras with audit tags. P3-G is OUT of the partition (post-emission tier mutation, never had a top-3 slot to lose). All P3 gates **fail-OPEN** on data failure.

**Adjacent dial changes (2026-05-07)**: `PAPER_FIXED_LOTS` map `{NIFTY:10, SENSEX:40, BANKNIFTY:30}` overrides dynamic budget for STANDARD-tier opens on those 3 indices; `CONFIDENCE_THRESHOLDS.MIN_FNO_TRADE` lowered 70→65 to align with `HC_EMISSION_FLOOR`.

### Equity Entry-Safety Gate (2026-05-08, equity swing only — does NOT touch F&O Pass-1/2/3)
- **Where**: `computeEntrySafety()` in `artifacts/api-server/src/lib/scoring.ts`, called inside `buildRecommendation` AFTER signal classification, BEFORE target/stop. Surfaces `recommendation.entryQuality` (GOOD/FAIR/POOR) and `recommendation.entryPlan` ({reason, avoidZone, breakoutTrigger, pullbackZone, invalidates}).
- **Pass-A demote**: When POOR fires, `STRONG_BUY → BUY` / `STRONG_SELL → SELL` (direction unchanged; target/stop/score preserved). Audit reason `LATE_ENTRY_AT_RESISTANCE` / `LATE_ENTRY_AT_SUPPORT` pushed with weight 0. This naturally blocks paper-trader auto-opens (`swingSignals.ts:261` requires `STRONG_BUY`).
- **Hybrid threshold (POOR)**: All three must hold — (1) within 1.5% of any candidate {20D high, R1, 52W high} OR within 1 ATR of {20D high, R1} only (52W extremes get %-only); (2) today's high/low tagged the level within 0.5%; (3) today's |move| ≥ 2.5%. Mirrored for bearish using {20D low, S1, 52W low}.
- **Strict pre-filter**: Candidates must be on the correct side of price (≥ price for bullish; ≤ price for bearish). Crossed levels never fire — they're either failed or new S/R, not late-entry candidates.
- **FAIR (advisory, no demote)**: inside 3% proximity ring but full POOR conditions not met. Plan rendered with reason only.
- **Pullback zone**: VWAP ↔ EMA20 (EMA50 fallback) when both anchors lie below current price (above for bearish). Omitted otherwise.
- **UI**: `EntryPlanCard` in `artifacts/scanner/src/pages/stock-detail.tsx` renders col-span-1 between Recommendation and Why-this-signal. POOR = rose theme + AlertTriangle, FAIR = amber + Hourglass, GOOD = emerald + ShieldCheck (badge only).

**Perma-deferred per owner**: T1 partial booking, equity risk-based / ATR sizing, market-regime entry filter, global risk manager, dial changes (MIN_FNO_TRADE 70, halved per-trade risk, MAX_TRADES_PER_DAY).

### Account surface (2026-05-07)
- **Paper Tab → Live-Only**: `/paper-trading` is a pure live dashboard. Closed history, equity curve, analytics, journal live exclusively in `/paper-reports`. Open-position rows show `fmtDateTime(openedAt)`. Stale components in `paper-trading.tsx` left defined-but-unrendered for easy reinstatement.
- **Equity Account Card**: Two sub-grids — (a) Capital introduced / Invested / Realized P&L (lifetime) / Balance capital; (b) Open portfolio (live MTM): Invested / Current value / P&L / %. `lifetimeRealizedPnl` is server-side on `/paper/account` (top-up safe).

### OI Lab
- **Δ-window Kite-historical backfill** (2026-05-08): On first `fetchOiInsights` per (underlying|expiry|day) when buffer < 8 snaps, fire-and-forget background fetch of `kc.getHistoricalData(..., oi=true)` for ATM±7 strikes × 2 sides at 5-min interval. `insertOiSnap` does same-ts merge → never overwrites live snaps (owner constraint). Dedup'd via `oiBackfillCompleted`/`oiBackfillInflight`. WORKERS=2 per index. Helper `fetchKiteOiHistoricalByToken` in `kiteIntraday.ts` shares the `reserveHistoricalSlot` throttle queue. Fail-OPEN.

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
- **OI Change Calculation**: Dependent on `oi_day_low`/`oi_day_high` from Kite quotes (occasional inconsistencies).
- **Paper Trading Anti-phantom-trade rules**: Logic for closing already-exited signals and backfilling missing trades. `reconcileMissingPaperTrades` reads `h.tier AS persisted_tier` to prevent post-deploy re-promotion.
- **F&O Signal Pipeline (HARD-CUT 2026-05-06)**: F&O code paths NEVER touch Yahoo. `optionSignals.ts` daily history → Kite `day` interval; `optionSignalGates.ts` VIX → Kite-only; when VIX missing the gate is a no-op rather than emit-block. `tradingConfig.isActionableForFno` returns false for `DELAYED_YAHOO`; `PAPER_TRADE_ALLOW_YAHOO` env override removed entirely. Yahoo remains only for non-F&O segments.
- **MissedSignal Log Dedup**: `recordMissedSignal()` returns a boolean to prevent log spam.
- **Signal Display vs. Enum**: When changing display text, only modify the display layer (e.g., `signal-badge.tsx`), never the underlying `Signal` enum strings used by API/DB.
- **F&O Signal Sweep Cadence**: `TRIGGER_SWEEP_INTERVAL_MS` is 30s. Do not set below 15s (Kite throttling).
- **Indices Board Hang Protection**: `getIndicesBoard()` uses an 8s `Promise.race` deadline; client `<IndicesBoard>` has a 25s `loadingTooLong` flag.
- **Empty-state Copy**: Empty panels show "No live data — last attempt X" + Retry, distinct from a perpetual loading state.
- **Index-detail Pivots**: `/api/index/:slug` returns `previousHigh`, `previousLow`, and classical floor `pivots`.
- **Side-correct R/S in OI analytics**: `computeAnalytics()` filters `topResistance` to CE strikes ≥ spot, `topSupport` to PE strikes ≤ spot.
- **Paper-trade LTP is live**: `GET /paper/positions/fo` and `POST /paper/positions/fo/:id/close` refresh `lastPremium` from a fresh `fetchOptionChain()` pull.

## Pointers

- **Zerodha Kite Connect**: https://kite.trade/docs/connect/v3/
- **Drizzle ORM**: https://orm.drizzle.team/docs/overview
- **Zod**: https://zod.dev/
- **TanStack Query**: https://tanstack.com/query/latest
- **OpenAPI Specification**: https://swagger.io/specification/
