# Paper Trader & F&O Signal Architecture

Detailed rationale and implementation notes for the F&O signal pipeline, paper-trader safety nets, and OI Lab. This is the long-form companion to the compressed summary in `replit.md`.

---

## F&O Signal Engine — Phased Build

### Phase-1 (additive — no behaviour change to existing setups)

1. **Regime Classifier** (`lib/regimeClassifier.ts`): TRENDING_BULL/BEAR | RANGING | VOLATILE | EXPIRY_DAY. Computed in `buildContext()`, attached to every `OptionSignal` via `toSignal()`. Read-only label, does NOT gate emission. Decision order: EXPIRY_DAY → VOLATILE (BBW≥2% or ATR15/spot≥0.6%) → TRENDING_* (ADX≥22 + EMA stack + VWAP) → RANGING.
2. **IVR / IVP** (`lib/ivHistory.ts`): trailing-252 ATM-IV rank/percentile. **Snapshot is per-index, NOT per-bundle** — `recordAtmIv` + `computeIvMetrics` run inside the per-index sweep loop in `optionSignals.ts` (right after `bundles.push`), so quiet indices accumulate IV history even on cycles with zero emitted signals. Bundle-side enricher only reads existing metrics.
3. **Daily/Weekly Portfolio DD Caps** (`lib/paperAccount.ts`): `MAX_DAILY_LOSS_PCT=0.025` / `MAX_WEEKLY_LOSS_PCT=0.05` of seed. `getDailyRealizedDrawdown()` / `getWeeklyRealizedDrawdown()` sum CLOSED `realizedPnl` over IST-day / IST-week windows. **Caps are STICKY** via in-process `dailyDdLatch` / `weeklyDdLatch` — once `capReached`, stays true for the rest of the window even if a later winner pulls realised P&L back below the cap. Latches reset implicitly on IST window rollover; `_resetDdLatchesForTest()` clears them in tests. `paperTradingFO.openPaperTrade` gates after the consecutive-stops gate; on cap-hit logs `MissedSignal` with skipReason `DAILY_DD_CAP` / `WEEKLY_DD_CAP`. `/paper/account?segment=FNO` returns `dailyDrawdownPct` / `dailyDrawdownCapPct` / `weeklyDrawdownPct` / `weeklyDrawdownCapPct` (omitted for EQUITY).

### Phase-2 — EMA20/50 + Intraday Volume Profile (2026-05-06)

`Ctx` extended with `ema20`/`ema50` series + scalars and `vpIntraday` (60-bar fixed VP from `volumeProfile.ts`, computed alongside the existing daily VP). `toSignal` exposes `ema20`, `ema50`, `intradayValueAreaHigh`, `intradayValueAreaLow`, `intradayPointOfControl`, and `confluenceScore` on `OptionSignal`. Note: `vpIntraday` is null for cash-index spots (NIFTY/BANKNIFTY etc. report 0 cash volume); the confluence engine treats this as a 0-weight factor.

### Phase-3 — Confluence Engine REPLACES per-detector confidence (2026-05-06)

`lib/confluenceEngine.ts` `scoreConfluence()` returns `{adjustedConfidence, confluenceScore, factors[]}`. Factor weights:
- EMA stack: +5 (9>20>50) / -8 (9<20<50) / 0 (disordered)
- VWAP: +3 / -6 (spot side)
- VP zone: ±3 (inside VAH/VAL = +3 if mean-reversion-aligned; outside = -3 for trend-continuation)
- Regime: +5 (trend-aligned) / -10 (counter-trend) / -3 (RANGING for trend-continuation) / -5 (VOLATILE) / -2 (EXPIRY_DAY for new trends)
- IVR: ±2

Wired into `buildSignalsForIndex` AFTER vol-regime haircut, BEFORE `HC_EMISSION_FLOOR`. Pushes `ConfluenceFactor` entries to `r.drivers`, stashes `confluenceScore` on `Detected` so `toSignal` can surface it. **`ivRank` passed null at emission time** (IV metrics are computed at the bundle level after `buildSignalsForIndex`); the IV factor is a UI-only display via the existing `ivRank` field. Pre-Phase-3 emission policy preserved verbatim in `lib/optionSignals.legacyEmit.bak.ts` for rollback. Signal counts changed post-deploy (user-approved).

### Phase-4 — KiteTicker WebSocket for Index Spots (2026-05-06)

`kiteFeed.subscribeIndices()` (called from the existing `"connect"` handler, idempotent) lazy-imports `getIndexTokenMap` from `kiteIntraday.ts` to avoid the kiteFeed↔kiteIntraday cycle, then subscribes the existing `KiteTicker` singleton to every index token in `INDEX_TABLE`. `kiteIndexQuotes.getKiteIndexQuotes()` consults `getLiveQuote(yahoo)` first with a 3s freshness gate and ALL-or-nothing fall-through (never serves a partial strip); REST `kc.getQuote` batch is the cold-start/disconnect fallback unchanged. No new vendor dep; reuses the singleton ticker, autoReconnect, and token-expiry handling already in place.

---

## Paper-Trader Safety Nets — Pass-1 / Pass-2A / Pass-2B (2026-05-07 → 2026-05-08)

Cumulative additive gates on top of the F&O signal engine — no dial changes, no behaviour change to non-matching trades. **Constants live in `paperAccount.ts`; gate logic split between `optionSignals.ts` emission loop (signal-side demotes) and `paperTradingFO.ts` / `paperTradingEq.ts` openPaperTrade (sizing-side scales/rejects).**

### Pass-1
- **F&O option-leg liquidity** (`FNO_LIQUIDITY`): MIN_OPTION_LTP=20, MAX_BID_ASK_SPREAD_PCT=0.015, MIN_OPTION_OI=50_000; fail-OPEN on chain-fetch fail.
- **F&O 15:20 IST force-exit**: `forceCloseAllOpenFnoFor1520`, `CloseReason="TIME_EXIT_1520"`, once-per-IST-day latch via `lastForceExit1520Date`.
- **Equity stop-loss sanity** (`EQUITY_STOP_SANITY`): rejects swing entries where (entry-stop)/entry < 1% or > 8%.
- **Equity DD caps** (`EQUITY_DD_CAPS`): 2%/4%/8% daily/weekly/monthly of ₹10L EQ seed, sticky in-process latches `eqDailyDdLatch` / `eqWeeklyDdLatch` / `eqMonthlyDdLatch`, mirror the F&O DD-cap latches from Phase-1.

### Pass-2A — F&O vol-clamped stop soft-demote
`clampPlanForIntraday` HARD-REJECTS when `minStopDist/maxStopDist > VOL_CLAMP_REJECT_RATIO=1.5`; below threshold sets `volClamped=true` → emission loop demotes tier to BASELINE → routes through `FNO_BASELINE_RISK` lane; `VOL_CLAMPED_STOP` audit tag. **Architect-driven**: vol-clamped setups partitioned OUT of top-3 HC pool BEFORE slicing, and `reconcileMissingPaperTrades` reads `h.tier AS persisted_tier` to prevent post-deploy re-promotion.

### Pass-2B (signal-side: B / C / F)
HC → BASELINE demotes via the same partition pattern as Pass-2A:
- (B) **HTF-as-tier-demote** — daily-EMA50 `ctx.htfBias` opposes direction → `htfConflictGate`.
- (C) **Time-of-day filter** — 09:15–09:30 = `OPENING_NOISE`; 15:15–15:30 = `CLOSING_NOISE`.
- (F) **Event-day filter** — `ctx.regime.regime==="EXPIRY_DAY"` → `EXPIRY_DAY` tag.

### Pass-2B (sizing-side)
- **Post-stop cool-down** (`POST_STOP_COOLDOWN`): 60min, 0.5× lot multiplier; index-scoped, stacks multiplicatively with VOLATILE_MULT, applies to both fixed-lot and dynamic-budget paths, floor at 1 lot.
- **VOLATILE regime sizing** (`REGIME_SIZING.VOLATILE_MULT=0.5`): halves lots when `signal.regime==="VOLATILE"`.
- **Portfolio heat cap** (`PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT=0.06` / `MAX_EQ_HEAT_PCT=0.06`): FAIL-CLOSED — no silent shrink. **Architect-driven**: heat queries run via `tx.execute(HEAT_SQL_FNO/EQ)` exported SQL fragments inside the same transaction holding `SELECT ... FOR UPDATE` on the account row so parallel opens cannot collectively breach.

### Adjacent dial changes (2026-05-07)
- `PAPER_FIXED_LOTS` map (`{NIFTY:10, SENSEX:40, BANKNIFTY:30}`) overrides dynamic budget formula for those 3 indices in STANDARD-tier opens (other indices keep dynamic; per-trade & DD caps still apply on top).
- `CONFIDENCE_THRESHOLDS.MIN_FNO_TRADE` lowered 70→65 to align with `HC_EMISSION_FLOOR` (post-Phase-3 confluence engine already haircuts at 65, so the second-line gate at 70 was perma-vetoing legit 65–69 trades).

### Combined isDemoted partition through Pass-2B
`volClamped || htfConflictGate || noiseWindow || inExpiryDay`

### Perma-deferred per owner
T1 partial booking, equity risk-based sizing, market-regime entry filter, global risk manager, all dial changes (MIN_FNO_TRADE 70, halved per-trade risk, MAX_TRADES_PER_DAY 3).

---

## Pass-3 — 4 Additive Signal-Accuracy Gates (2026-05-08)

Gates A, D, E, G. No behaviour change to non-matching trades; all gates additive on top of Pass-2A/2B. Same demote-only semantics — partition out of top-3 HC pool, append as BASELINE-tier extras with audit tags.

### (A) True 1h HTF gate
(`optionSignals.ts` buildContext + emission loop) — Pass-2B's "(B) HTF gate" is daily-EMA50 (the only HTF source the codebase had); this adds a TRUE 1h timeframe by aggregating 4×15m bars into 60m candles.

**Architect-driven hardening:** initial implementation walked backwards 4-at-a-time over the flat intra series, which silently spanned the overnight gap (mixing yesterday's last bars with today's first into a phantom-gap candle that distorted EMA9/21). Final implementation is **session-aware**: groups intra bars by IST date using `intra.timestamps`, then within each session takes the close of every completed 4-bar group from session-open forward (orphan ≤3-bar tail per session discarded by design). NSE F&O sessions are 25 bars → 6 60m candles per full day; ~30 60m bars by mid-day-3 of warm-up. EMA9/21 stack + last-close vs EMA21 derive `ctx.htf1hBias` (BULLISH/BEARISH/NEUTRAL needing ≥21 60m bars). When 1h opposes setup direction, set `d.htf1hConflictGate = true` → `HTF1H_CONFLICT` audit tag in `toSignal`. Independent of Pass-2B (B) — a setup can fail just one or both; either alone demotes.

### (D) Sector relative strength
(`optionSignalGates.ts` `loadNifty5dReturn` + `optionSignals.ts` buildContext per-index 5d return) — per-cycle Kite daily fetch for `^NSEI` computes NIFTY 5-day return; per-index 5d return computed inside buildContext from existing `daily` series (zero extra Kite calls). When `idxRet < niftyRet - TOLERANCE_PCT` (BULLISH on a laggard) or `idxRet > niftyRet + TOLERANCE_PCT` (BEARISH on a leader), set `d.rsConflictGate = true` → `RS_CONFLICT` audit tag. NIFTY itself exempt from the gate (it IS the benchmark — `cfg.symbol === "NIFTY"`). Tolerance `1.0` percentage points (RELATIVE_STRENGTH constant in `paperAccount.ts`). Fail-OPEN when NIFTY benchmark or this index's return is null (Kite fail / daily series too short).

### (E) Rolling 30-day per-setup win-rate calibration
(`optionSignalGates.ts` `loadSetupWinRates` + `paperAccount.ts` WIN_RATE_CALIBRATION constants `{LOOKBACK_DAYS: 30, MIN_SAMPLE: 10, MIN_WIN_RATE: 0.4}`) — per-cycle SQL query groups CLOSED `paper_trade_fo` rows by `setup_key` over the last 30 days. When `wr.total >= MIN_SAMPLE && wr.winRate < MIN_WIN_RATE`, set `d.lowWinRateGate = true` → `LOW_WINRATE` audit tag. **Sample-size guard prevents demoting brand-new setups** — they get the benefit of the doubt until enough closed trades accumulate. Self-healing: if a setup's regime shifts back to profitable, the demote auto-clears as the rolling window updates. Empty map on query failure (gate becomes a no-op).

### (G) ATM-strike OI confluence
(`optionSignals.ts` `applyOiConfirmation` + `ceBuildupVote`/`peBuildupVote` helpers) — after the existing aggregate-sentiment OI_CONFIRMED/OI_CONFLICT/OI_VETO branches, an INDEPENDENT check on the ATM strike from `oi.strikes.find(r => r.isAtm)`. Each leg's `ceBuildup`/`peBuildup` tag maps to a directional vote (-1/0/+1):
- CE LONG_BUILDUP / SHORT_COVERING = +1 BULLISH; CE SHORT_BUILDUP / LONG_UNWINDING = -1 BEARISH
- PE SHORT_BUILDUP / LONG_UNWINDING = +1 BULLISH; PE LONG_BUILDUP / SHORT_COVERING = -1 BEARISH

Demotes HC → BASELINE only when **BOTH legs unanimously vote against direction** (`atmVote ≤ -2` for BULLISH or `atmVote ≥ +2` for BEARISH) — single-leg dissent intentionally NOT enough (too many false positives on intraday chop). Mutates `s.tier = "BASELINE"` and pushes `OI_ATM_CONFLICT` + `BASELINE` tags. Skips signals already vetoed (continue at OI_VETO line) or already BASELINE. Catches "the wider chain looks fine but the strike where the trade actually lives is being defended by writers" — the most common failure mode aggregate PCR cannot see. **Routes via the existing post-toSignal mutation pattern** (same shape as OI_CONFIRMED/OI_CONFLICT) rather than a Detected flag, since OI insights aren't available until after `buildSignalsForIndex` returns.

### Combined isDemoted partition through Pass-3
`volClamped || htfConflictGate || noiseWindow || inExpiryDay || htf1hConflictGate || rsConflictGate || lowWinRateGate`

(G) is OUT of the partition — it mutates tier directly post-emission, so its setups never had a top-3 slot to lose.

All Pass-3 gates **fail-OPEN** on data failure — DB query failure, Kite fetch failure, missing ATM row → gate becomes a no-op rather than mis-classifying.

User-deferred (perma-skip): T1 partial booking, global risk manager, equity ATR sizing, dial changes (per-trade risk halving, MAX_TRADES_PER_DAY).

---

## OI Lab — Δ-window Kite-historical Backfill (2026-05-08)

When the api-server is restarted mid- or post-session the in-memory `OI_INSIGHTS_HISTORY` ring buffer is empty for today, so every Δ-window pill (3m / 30m / 1h / 3h / Full Day) falls back to broker since-open Δ via `windowMode==="none"` and ALL pills show the same number.

**Solution**: on the first `fetchOiInsights` call per (underlying|expiry|day) when buffer has < 8 in-session snaps, kick off a background `kc.getHistoricalData(token, "5minute", from, to, false, true)` (6th arg `oi=true`) for each visible option leg, reconstruct one snap per candle bucket, and feed into the SAME buffer via the extracted `insertOiSnap` helper.

**Existing live snaps are NEVER overwritten** — same-ts merge unions strike maps non-destructively (per owner directive "do not change existing data and information").

Capped at `BACKFILL_MAX_STRIKES=15` (ATM ± 7) × 2 sides = 30 historical_data calls per backfill ≈ 12s per index at the shared 2.5 req/s throttle. Dedup'd via `oiBackfillCompleted` (per-day) and `oiBackfillInflight` maps. Fail-OPEN: any failure leaves `oiBackfillCompleted` unset so the next poll retries; never blocks the request hot path.

New helper `fetchKiteOiHistoricalByToken` in `kiteIntraday.ts` shares the same `reserveHistoricalSlot` global throttle queue as the OHLCV path, so backfill bursts cannot starve the F&O signal sweep's intraday calls. WORKERS=2 per index (architect-tightened down from 4) to cap peak throttle footprint.

Backfilled snaps carry `spot: undefined` (Kite option-historical doesn't return underlying spot — surfacing as `windowBaselineSpot: null` is acceptable; live polls landing at the same ts merge their spot in via the existing `snap.spot ?? prev.spot` precedence).

---

## F&O Universe (2026-05-08)

`OPTION_INDICES` in `optionSignals.ts` and `FNO_INDICES` in `oiLab.ts` both trimmed to **NIFTY / BANKNIFTY / SENSEX**. Removed: FINNIFTY, MIDCPNIFTY, BANKEX (monthly-only cadence + thinner OI on weekly OTM strikes was producing low-quality fills and disproportionate stop-loss hits). `SIGNAL_INDEX_TO_LTP_KEY` trimmed to match. To restore an index: re-add to BOTH lists and the LTP-key map. Owner directive — applies to both signal engine (paper trades) and OI Lab analytics so users never see orphaned data for indices we don't trade.

---

## UI / Account Surface (2026-05-07)

### Paper Tab → Live-Only
The `/paper-trading` page is now a pure live dashboard — closed-trade history, equity curve, by-setup analytics and journal entries all live exclusively in `/paper-reports`. Both `EquitySegment` and `FOSegment` no longer fetch `/paper/trades/{eq,fo}` or `/paper/analytics/fo`. Stale components (`AnalyticsCard`, `EquityCurveSparkline`, `EqTradesCard`, `TradesCard`) remain defined in `paper-trading.tsx` but are unrendered (left for easy reinstatement; cleanup deferred). Open-position rows now show `fmtDateTime(openedAt)` (date · HH:MM:SS) instead of date-only.

### Equity Account Card simplified
Two clean sub-grids replace the prior 9-stat cluster:
- **Capital**: Capital introduced / Invested / Realized P&L (lifetime) / Balance capital
- **Open portfolio (live MTM)**: Invested amount / Current value / Profit-Loss / % P/L

`currentValue` and `unrealizedPnl` are computed client-side from open positions (`Σ qty × LTP` vs `Σ capitalDeployed`). `lifetimeRealizedPnl` is now a server-side field on `/paper/account` (`Σ realizedPnl WHERE status='CLOSED'` for the segment), making it **top-up safe** — manual `/paper/account/topup` capital injections cannot inflate the realised figure.

---

## Paper-Trader Trade-Drought Fix (2026-05-11)

Owner reported zero F&O trades for 15-20 days. DB confirmed only 7 real BASELINE trades in 30d at 42.9% win rate (above 40% floor — so LOW_WINRATE wasn't the cause). Root cause: a dozen silent skip points in `openPaperTrade` (`paperTradingFO.ts`) returned `null` with only `logger.info` — UI showed nothing, owner had no visibility into *why* triggers weren't becoming trades.

### (A) Win-rate classification (4-bucket, reviewer-amended 2026-05-11.c)
`lib/winRateClassification.ts` exports `classifyTradeOutcome()` returning `WIN / LOSS / SCRATCH / EXCLUDE`. WIN = system exit + pnl>0; LOSS = system exit + pnl<0; SCRATCH = system exit + pnl=0 (filled flat trades — kept as samples for expectancy, not depressed against win-rate); EXCLUDE = `MANUAL_OVERRIDE` (operator-influenced, not autonomous setup performance) or any non-system reason. System exits = `TARGET1_HIT / TARGET2_HIT / STOPPED / EXPIRED`. `loadSetupWinRates` SQL counts `wins = realized_pnl > 0`, `total = realized_pnl <> 0` over the system-exit set — denominator excludes scratches. Mandatory parity test (`SQL_PREDICATE_MIRROR` in `winRateClassification.test.ts`, 35 cartesian fixtures) gates SQL/helper drift in CI.

### (B) Sub-tiered BASELINE sizing + guardrails
`paperAccount.ts` adds `FNO_BASELINE_RISK` (MICRO 0.25 % conf 55-59 / BASELINE 0.5 % conf 60-64 / STANDARD 2 % conf 65+) resolved by `riskPctForConfidence(tier, conf)`, plus `FNO_BASELINE_GUARDRAILS` (max 2 BASELINE trades/day, 0.75 % daily loss cap, 2 consecutive-loss lane lock, 14:45 IST late-entry cutoff vs 15:25 for HC). Guardrails join `paper_trade_fo→option_signal_history.tier='BASELINE'` so no schema migration needed; all gates fail-OPEN. STANDARD signals bypass the BASELINE block entirely. Race-safe: guardrail checks run **inside the same `FOR UPDATE` transaction** as the open-row insert (via `tx.execute`). The 0.75 % daily-loss cap counts **realized + unrealized** BASELINE loss so a second BASELINE entry can't pile on while the first floats badly. Reviewer-amended 2026-05-11.c: `getBaselineDayStats` now **fails CLOSED** — on query failure it returns `null` and the caller skips the open with `BASELINE_GUARDRAIL_STATS_UNAVAILABLE` rather than allowing the trade through with zeroed stats.

### (C) Missed-entry diagnostics
`SkipReason` union extended from 6 to 23 values covering every silent rejection (MARKET_CLOSED / TIME_FILTER_LATE / BASELINE_LATE / LIQUIDITY_LTP / LIQUIDITY_SPREAD / LIQUIDITY_OI / LIQUIDITY_CHAIN_MISSING / INVALID_PREMIUM_PLAN / DAILY_TRADE_CAP / BASELINE_DAILY_CAP / CONSECUTIVE_STOPS / BASELINE_CONSECUTIVE_LOSSES / BASELINE_DAILY_DD_CAP / PORTFOLIO_HEAT / BUDGET_TOO_TIGHT / INSUFFICIENT_BALANCE). Every `return null` path now calls `recordSkip(reason)` which feeds the existing `MissedSignals` ring buffer. New `GET /paper/diagnostics/untriggered/fo` endpoint groups skips by reason / index / tier and includes a 50-row recent log so the owner can answer "Why no trade?" in one glance. UI label/tone maps in `paper-trading.tsx` updated for the new SkipReasons.

**Deferred per owner**: trigger geometry rework (separate change once 2-3 weeks of audit data accumulate).

---

## Paper-Trader Observability Addendum (2026-05-11.d)

Reviewer approved 2026-05-11.c and asked for 4 small observational/safety additions before collecting 10–20 sessions of data. Signal detectors and trigger geometry intentionally UNCHANGED.

1. **`BASELINE_GUARDRAIL_STATS_UNAVAILABLE` alert** — fail-CLOSED warn now tagged `event:"ALERT", alert:"BASELINE_GUARDRAIL_STATS_UNAVAILABLE"` and bumps a process-level counter (`baselineStatsUnavailableAlertCount`) exposed via `getOperationalAlerts()` in `paperTradingFO.ts`. Always logged (not gated by `recordSkip` dedup) so every occurrence enters the audit trail.
2. **`GET /paper/diagnostics/daily-summary/fo`** — single owner-scoped read returning today's IST-day metrics. Two distinct date anchors (architect-flagged 2026-05-11.d): **opened-today** metrics (`tradesOpened`, `tradesOpenedByTier`) key off `signal_date = today`; **closed-today** metrics (`pnl.{baseline,hc,total}`, `scratchesCount`, `manualOverridesCount`, `tradesClosed`) key off `(exited_at AT TIME ZONE 'Asia/Kolkata')::date = today` so a prior-day signal that closes today is correctly attributed. `signalsGenerated` is option_signal_history count for today; `skipped.byReason` reads the in-process MissedSignals ring filtered to today; `tradeOpenRate = tradesOpened / (tradesOpened + skippedToday)` returns null when no candidates (avoids 0/0). Pure read, no DB writes; multi-day analytics still belong on `/paper/analytics/fo`.
3. **SCRATCH denominator policy** confirmed — `winRateClassification.ts` already documents WIN+LOSS-only win-rate vs WIN+LOSS+SCRATCH expectancy; the SQL mirror enforces it (`wins = realized_pnl > 0`, `total = realized_pnl <> 0`). Daily-summary response surfaces the policy verbatim under `policy:{winRate, expectancy, manualOverride}`. New `SCRATCH denominator contract` test block in `winRateClassification.test.ts` pins the relationship so a future "tidy-up" cannot silently fold scratches into win-rate or drop them from expectancy.
4. **Daily-summary persistence + history** — new table `paper_daily_summary_fo` (PK = IST `date`) snapshots the full payload one-to-one (jsonb for `skippedByReason` + `alerts`). Logic extracted into `lib/paperDailySummaryFo.ts → computeDailySummaryFo(date)` (pure read, used by both the live endpoint AND the persister) and `persistDailySummaryFo(date)` (idempotent ON-CONFLICT upsert that THROWS on failure — earlier fail-OPEN swallow corrupted EOD latch retry semantics). Live endpoint fires a `.catch(...)`-wrapped upsert on every read so intra-day refreshes update the row in place while the read itself stays fail-OPEN. EOD persistence runs on its OWN 60s `setInterval` inside `paperDailySummaryFo.ts` (NOT piggy-backed on the trigger sweep — that path short-circuits at `computeMarketStatus !== "open"` which closes at 15:30 IST, before the 15:35 EOD target); `maybePersistEodDailySummary` latches on `lastEodPersistDate` and only burns the latch on a clean throw-free persist so transient DB failures retry on the next minute. `capturedAt` preserves the first-write timestamp; `updatedAt` advances. New `GET /paper/diagnostics/daily-summary/fo/history?from=YYYY-MM-DD&to=YYYY-MM-DD` returns trailing-30-day rows by default, ordered desc; date inputs are round-trip validated. **Single-replica assumption** documented — multi-replica scaling would require a DB advisory lock for EOD coordination.

**Watchlist over next 10–20 sessions** (per reviewer): `tradeOpenRate`, top `skipped.byReason`, `tradesOpenedByTier`, `pnl.{baseline,hc}`, `scratchesCount`, `manualOverridesCount`, `alerts.baselineStatsUnavailable`. Interpretation rules: high CONFIDENCE skips → detector/gating issue; high LIQUIDITY/TIME skips → entry geometry; high BASELINE_* skips → guardrail tightness; low open-rate during good market moves → execution layer too restrictive; high open-rate with poor P&L → signal-quality / option-selection issue. **Deferred** until 10–20 clean sessions accumulate: trigger-not-hit counter, average-R-by-tier, trigger geometry rework.

---

## Technical Analysis (NIFTY 500) — Pro Swing Scanner v3 Port (2026-05-11)

TS port of the 1818-line Python "Pro Swing Scanner v3" added as a third section on `/stocks-to-watch` (preserves the two existing news Watch/Avoid columns).

- **Pure-math library**: `lib/swingScanner.ts` — RSI, ATR, ADX, EMAs, rolling/anchored VWAP, pivots, market-structure, FVG, supply/demand zones, fixed-volume profile, weekly confirmation, candle confirmation, volatility/gap risk, fundamental score, build_buy_zone/stop/targets, position_size, classify_action/setup, score_and_plan. No I/O, no globals.
- **Data layer**: `lib/swingScannerData.ts` — Kite-first via `getInstrumentToken` + `fetchKiteHistoricalByToken(token, label, "day", 250)`; Yahoo `fetchChart` fallback; `fetchFundamentals` (NOT `fetchStatements` — too heavy at 500 names; QoQ deferred as NaN, ratios are divided by 100). NIFTY benchmark via `^NSEI`. Returns null only when both Kite and Yahoo fail.
- **Cache + scheduler**: `lib/swingScannerStore.ts` — `swing_scan_result` (composite PK `(symbol, scan_date)` — required for ON CONFLICT, plain index throws 42P10) + `swing_scan_run` audit table. Concurrency=6 to play nice with the existing throttle queue. Two `setInterval`s: deep-scan latch (60s tick, fires once per IST-day after 15:35), intraday LTP-only refresh (15min during market hours, ~5 batched quote calls). **Cold-start probe** (architect-amended 2026-05-11): only auto-runs when (a) weekday-IST, (b) past the 15:35 cutoff, AND (c) NO finished `swing_scan_run` row exists for today — latch decision keys off the run-audit row, NOT raw result rows, so a partially-written scan from a crashed prior process can't permanently suppress today's official rerun, and a pre-15:35 boot can't burn the latch and silence the scheduled post-close run. Single-replica assumption documented.
- **API**: `GET /api/stocks-to-watch/analysis?limit=&action=&setup=&minScore=` — same auth posture as the parent `/stocks-to-watch` endpoint (cookie-gated, public-mode allowed). Returns `{ asOf, scanDate, runMeta, rows }` direct-fetch (no zod codegen — matches existing endpoint convention).
- **UI**: `/stocks-to-watch` gains a third "Technical Analysis — NIFTY 500" section below the news columns. Sortable table (Symbol, Action, Setup, Quality, Score bar, Close, Entry, Stop, T1, T2, R:R, RSI, ATR%, Buy Zone, Weekly Trend), Action chips (Buy Zone / Breakout / Pullback / Wait for Confirmation / Watchlist / Avoid — `.includes()` matchers tolerate the Python action strings `"AVOID / NO TRADE"`, `"WAIT FOR PULLBACK"`, etc.), Quality chips (A / B+ / B / C / D), default sort score-desc. Cross-ref: news SignalCards show a small `Tech NN` badge when the symbol also appears in the tech scan.
- **Operational notes**: First production deep-scan on 2026-05-11 — 477 scored / 23 errors / 5m14s for 500 names. Action distribution skewed AVOID-heavy (294/477) — expected post-Monday-open behaviour, not a code bug; setup mix unblocks once the market trends.

---

## Equity Entry-Safety Gate (2026-05-08, equity swing only — does NOT touch F&O Pass-1/2/3)

- **Where**: `computeEntrySafety()` in `artifacts/api-server/src/lib/scoring.ts`, called inside `buildRecommendation` AFTER signal classification, BEFORE target/stop. Surfaces `recommendation.entryQuality` (GOOD/FAIR/POOR) and `recommendation.entryPlan` ({reason, avoidZone, breakoutTrigger, pullbackZone, invalidates}).
- **Pass-A demote**: When POOR fires, `STRONG_BUY → BUY` / `STRONG_SELL → SELL` (direction unchanged; target/stop/score preserved). Audit reason `LATE_ENTRY_AT_RESISTANCE` / `LATE_ENTRY_AT_SUPPORT` pushed with weight 0. This naturally blocks paper-trader auto-opens (`swingSignals.ts:261` requires `STRONG_BUY`).
- **Hybrid threshold (POOR)**: All three must hold — (1) within 1.5% of any candidate {20D high, R1, 52W high} OR within 1 ATR of {20D high, R1} only (52W extremes get %-only); (2) today's high/low tagged the level within 0.5%; (3) today's |move| ≥ 2.5%. Mirrored for bearish using {20D low, S1, 52W low}.
- **Strict pre-filter**: Candidates must be on the correct side of price (≥ price for bullish; ≤ price for bearish). Crossed levels never fire.
- **FAIR (advisory, no demote)**: inside 3% proximity ring but full POOR conditions not met. Plan rendered with reason only.
- **Pullback zone**: VWAP ↔ EMA20 (EMA50 fallback) when both anchors lie below current price (above for bearish). Omitted otherwise.
- **UI**: `EntryPlanCard` in `artifacts/scanner/src/pages/stock-detail.tsx` renders col-span-1 between Recommendation and Why-this-signal. POOR = rose theme + AlertTriangle, FAIR = amber + Hourglass, GOOD = emerald + ShieldCheck (badge only).

---

## Account Surface (2026-05-07)

- **Paper Tab → Live-Only**: `/paper-trading` is a pure live dashboard. Closed history, equity curve, analytics, journal live exclusively in `/paper-reports`. Open-position rows show `fmtDateTime(openedAt)`. Stale components in `paper-trading.tsx` left defined-but-unrendered for easy reinstatement.
- **Equity Account Card**: Two sub-grids — (a) Capital introduced / Invested / Realized P&L (lifetime) / Balance capital; (b) Open portfolio (live MTM): Invested / Current value / P&L / %. `lifetimeRealizedPnl` is server-side on `/paper/account` (top-up safe).

---

## Kite Offline UX (2026-05-13)

When the Zerodha Kite daily session expires, the server silently falls back to delayed Yahoo data and many panels (fundamentals, Deep Scan snapshot, F&O signals) look blank-or-zero. Visible UX surfaces added so the owner doesn't think the app is broken:

- **`KiteOfflineBanner`** (page-level amber strip) mounted on Scanner, Stock Detail, Deep Scan. Owner sees a "Reconnect Zerodha" CTA linking to `/kite`; non-owner sees the banner without the CTA.
- **`KiteOfflineNote`** (inline slim variant) embedded in Deep Scan snapshot error card and Stock Statements (fundamentals) — both empty and populated states.
- Backed by public `GET /api/provider/status` (mounted in `scanner.ts` behind only the global `requireAuth` gate — cookie-gated, public-mode allowed). Polled every 60s by **one** observer (the page banner sets `refetchInterval`; the inline note is a pure cache reader) to avoid multi-observer timer amplification.
- **FAIL-OPEN**: both surfaces silent on `isLoading || isError || !data`. A phantom warning is worse than a missing one when the status endpoint itself is flaky.
- **Branched copy by `data.reason`** so we don't shout "session expired" at non-expiry causes (cold-start, websocket disconnect, missing creds). `headlineFor()` switches between four headlines.
- **Dev verification path**: `?mockProvider=session|disconnected|no_creds|generic|kite|off` URL param (sticky in sessionStorage) short-circuits the real fetch in `import.meta.env.DEV` builds only — lets us verify all banner variants without waiting for a real session expiry. No-op in production.

### Paper-trade EQ heat query column-name fix (2026-05-13)
`HEAT_SQL_EQ` in `paperAccount.ts` referenced non-existent `entry` / `stop_loss` columns; the schema has `entry_price` / `stop_price`. Result: every equity swing open under heat-cap evaluation threw `Failed query` and the wrapper logged "Paper EQ open failed for one signal, continuing". Fixed to use the correct column names; verified against live DB (5 open rows, ₹32,911 heat — well under ₹60K cap).
