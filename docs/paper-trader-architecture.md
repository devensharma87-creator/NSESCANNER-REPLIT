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
