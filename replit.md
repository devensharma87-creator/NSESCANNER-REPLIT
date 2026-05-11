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

### Paper-trader trade-drought fix (2026-05-11)
Owner reported zero F&O trades for 15-20 days. DB confirmed only 7 real BASELINE trades in 30d at 42.9% win rate (above 40% floor — so LOW_WINRATE wasn't the cause). Root cause: a dozen silent skip points in `openPaperTrade` (`paperTradingFO.ts`) returned `null` with only `logger.info` — UI showed nothing, owner had no visibility into *why* triggers weren't becoming trades.

- **(A) Win-rate classification (4-bucket, reviewer-amended 2026-05-11.c)** — `lib/winRateClassification.ts` exports `classifyTradeOutcome()` returning `WIN / LOSS / SCRATCH / EXCLUDE`. WIN = system exit + pnl>0; LOSS = system exit + pnl<0; SCRATCH = system exit + pnl=0 (filled flat trades — kept as samples for expectancy, not depressed against win-rate); EXCLUDE = `MANUAL_OVERRIDE` (operator-influenced, not autonomous setup performance) or any non-system reason. System exits = `TARGET1_HIT / TARGET2_HIT / STOPPED / EXPIRED`. `loadSetupWinRates` SQL counts `wins = realized_pnl > 0`, `total = realized_pnl <> 0` over the system-exit set — denominator excludes scratches. Mandatory parity test (`SQL_PREDICATE_MIRROR` in `winRateClassification.test.ts`, 35 cartesian fixtures) gates SQL/helper drift in CI.
- **(B) Sub-tiered BASELINE sizing + guardrails** — `paperAccount.ts` adds `FNO_BASELINE_RISK` (MICRO 0.25 % conf 55-59 / BASELINE 0.5 % conf 60-64 / STANDARD 2 % conf 65+) resolved by `riskPctForConfidence(tier, conf)`, plus `FNO_BASELINE_GUARDRAILS` (max 2 BASELINE trades/day, 0.75 % daily loss cap, 2 consecutive-loss lane lock, 14:45 IST late-entry cutoff vs 15:25 for HC). Guardrails join `paper_trade_fo→option_signal_history.tier='BASELINE'` so no schema migration needed; all gates fail-OPEN. STANDARD signals bypass the BASELINE block entirely. Race-safe: guardrail checks run **inside the same `FOR UPDATE` transaction** as the open-row insert (via `tx.execute`). The 0.75 % daily-loss cap counts **realized + unrealized** BASELINE loss so a second BASELINE entry can't pile on while the first floats badly. Reviewer-amended 2026-05-11.c: `getBaselineDayStats` now **fails CLOSED** — on query failure it returns `null` and the caller skips the open with `BASELINE_GUARDRAIL_STATS_UNAVAILABLE` rather than allowing the trade through with zeroed stats (a stats outage must not be a free pass to stack risk).
- **(C) Missed-entry diagnostics** — `SkipReason` union extended from 6 to 23 values covering every silent rejection (MARKET_CLOSED / TIME_FILTER_LATE / BASELINE_LATE / LIQUIDITY_LTP / LIQUIDITY_SPREAD / LIQUIDITY_OI / LIQUIDITY_CHAIN_MISSING / INVALID_PREMIUM_PLAN / DAILY_TRADE_CAP / BASELINE_DAILY_CAP / CONSECUTIVE_STOPS / BASELINE_CONSECUTIVE_LOSSES / BASELINE_DAILY_DD_CAP / PORTFOLIO_HEAT / BUDGET_TOO_TIGHT / INSUFFICIENT_BALANCE). Every `return null` path now calls `recordSkip(reason)` which feeds the existing `MissedSignals` ring buffer. New `GET /paper/diagnostics/untriggered/fo` endpoint groups skips by reason / index / tier and includes a 50-row recent log so the owner can answer "Why no trade?" in one glance. UI label/tone maps in `paper-trading.tsx` updated for the new SkipReasons.
- **Deferred per owner**: trigger geometry rework (separate change once 2-3 weeks of audit data accumulate).

### Paper-trader observability addendum (2026-05-11.d, reviewer-requested)
Reviewer approved 2026-05-11.c and asked for 4 small observational/safety additions before collecting 10–20 sessions of data. Signal detectors and trigger geometry intentionally UNCHANGED.
- **(1) `BASELINE_GUARDRAIL_STATS_UNAVAILABLE` alert** — fail-CLOSED warn now tagged `event:"ALERT", alert:"BASELINE_GUARDRAIL_STATS_UNAVAILABLE"` and bumps a process-level counter (`baselineStatsUnavailableAlertCount`) exposed via `getOperationalAlerts()` in `paperTradingFO.ts`. Always logged (not gated by `recordSkip` dedup) so every occurrence enters the audit trail.
- **(2)+(3) `GET /paper/diagnostics/daily-summary/fo`** — single owner-scoped read returning today's IST-day metrics. Two distinct date anchors (architect-flagged 2026-05-11.d): **opened-today** metrics (`tradesOpened`, `tradesOpenedByTier`) key off `signal_date = today`; **closed-today** metrics (`pnl.{baseline,hc,total}`, `scratchesCount`, `manualOverridesCount`, `tradesClosed`) key off `(exited_at AT TIME ZONE 'Asia/Kolkata')::date = today` so a prior-day signal that closes today is correctly attributed. `signalsGenerated` is option_signal_history count for today; `skipped.byReason` reads the in-process MissedSignals ring filtered to today; `tradeOpenRate = tradesOpened / (tradesOpened + skippedToday)` returns null when no candidates (avoids 0/0). Pure read, no DB writes; multi-day analytics still belong on `/paper/analytics/fo`.
- **(4) SCRATCH denominator policy confirmed** — `winRateClassification.ts` already documents WIN+LOSS-only win-rate vs WIN+LOSS+SCRATCH expectancy (lines 18-19); the SQL mirror enforces it (`wins = realized_pnl > 0`, `total = realized_pnl <> 0`). Daily-summary response surfaces the policy verbatim under `policy:{winRate, expectancy, manualOverride}`. New `SCRATCH denominator contract` test block in `winRateClassification.test.ts` pins the relationship so a future "tidy-up" cannot silently fold scratches into win-rate or drop them from expectancy.
- **(5) Daily-summary persistence + history (2026-05-11.d follow-up, architect-amended)** — new table `paper_daily_summary_fo` (PK = IST `date`) snapshots the full payload one-to-one (jsonb for `skippedByReason` + `alerts`). Logic extracted into `lib/paperDailySummaryFo.ts → computeDailySummaryFo(date)` (pure read, used by both the live endpoint AND the persister) and `persistDailySummaryFo(date)` (idempotent ON-CONFLICT upsert that THROWS on failure — earlier fail-OPEN swallow corrupted EOD latch retry semantics). Live endpoint fires a `.catch(...)`-wrapped upsert on every read so intra-day refreshes update the row in place while the read itself stays fail-OPEN. EOD persistence runs on its OWN 60s `setInterval` inside `paperDailySummaryFo.ts` (NOT piggy-backed on the trigger sweep — that path short-circuits at `computeMarketStatus !== "open"` which closes at 15:30 IST, before the 15:35 EOD target); `maybePersistEodDailySummary` latches on `lastEodPersistDate` and only burns the latch on a clean throw-free persist so transient DB failures retry on the next minute. `capturedAt` preserves the first-write timestamp; `updatedAt` advances. New `GET /paper/diagnostics/daily-summary/fo/history?from=YYYY-MM-DD&to=YYYY-MM-DD` returns trailing-30-day rows by default, ordered desc; date inputs are round-trip validated (rejects `2026-99-99` etc). **Single-replica assumption** documented in the helper — multi-replica scaling would require a DB advisory lock for EOD coordination.
- **Watchlist over next 10–20 sessions** (per reviewer): `tradeOpenRate`, top `skipped.byReason`, `tradesOpenedByTier`, `pnl.{baseline,hc}`, `scratchesCount`, `manualOverridesCount`, `alerts.baselineStatsUnavailable`. Interpretation rules: high CONFIDENCE skips → detector/gating issue; high LIQUIDITY/TIME skips → entry geometry; high BASELINE_* skips → guardrail tightness; low open-rate during good market moves → execution layer too restrictive; high open-rate with poor P&L → signal-quality / option-selection issue. **Deferred** until 10–20 clean sessions accumulate: trigger-not-hit counter, average-R-by-tier, trigger geometry rework.

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
