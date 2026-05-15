# Deep Review — Indian Market F&O + Swing Trading Platform

**Source:** `db_backup_20260513_132619.sql` (PostgreSQL 16.10 dump, 22 tables, ~1.4 MB)
**Reviewed:** Every table, every row.
**Bottom line up front:** Your schema is solid for an MVP and the swing engine is genuinely thoughtful (multi-factor scoring with SMC, RS, VWAP, volume profile — most retail platforms don't go this deep). But there are **three blocking bugs**, **major data gaps**, and the F&O engine is operating with a **0% high-conviction win rate** — it's not just a lucky sample, the setup logic has a structural problem. Read below.

---

## 1. What this database actually is — baseline understanding

Before critique, here's what's in there so we're aligned:

| Table | Rows | Purpose |
|---|---:|---|
| `users` | **0** | Auth/subscription/RBAC (`allowed_tabs[]`). Empty. |
| `kite_session` | 1 | Zerodha Kite token (expires 2026-05-14 00:30) — single global session |
| `fii_dii_daily` | 44 | FII/DII cash flows. Coverage: 2026-03-06 → 2026-05-13 (~2 mo) |
| `participant_oi_daily` | 168 | F&O participant OI (Client/DII/FII/Pro × 42 dates) |
| `iv_history` | 32 | ATM IV for 6 underlyings (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX). 6–8 days each only |
| `option_signal_history` | 98 | F&O signals (4 setups × 6 indices, 10 distinct dates) |
| `paper_trade_fo` | 7 | F&O paper book |
| `paper_trade_eq` | 12 | Equity paper book |
| `paper_eq_audit` | 378 | Why each candidate was rejected (gold for debugging) |
| `paper_daily_summary_fo` | 3 | Daily F&O roll-up (only 3 days populated) |
| `paper_account` | 2 | FNO ₹2L seed → ₹2.06L bal; EQUITY ₹10L seed → ₹1.27L bal (?!) |
| `swing_scan_result` | 1,168 | 477 symbols × 3 dates of deep scans |
| `swing_scan_run` | 3 | Scan run metadata |
| `global_instruments` | 392 | Global universe: equity(206) + crypto(91) + forex(35) + commodity(30) + index(30) |
| `global_live_prices` | 392 | Last snapshot table |
| `global_candles` | **0** | OHLCV store — empty |
| `global_sync_logs` | 5 | Sync status per source |
| `tv_alerts` | 4 | TradingView webhook ingest (3 test alerts) |
| `personal_watchlist`, `global_watchlist`, `global_screener_presets`, `global_instrument_overrides` | 0 | All empty |

So the platform has roughly two production-leaning modules (swing scanner + F&O signal engine), one "global markets" module that's wired but barely used, and the user/auth/billing scaffolding hasn't been exercised at all.

---

## 2. Critical bugs (fix these before anything else)

### 🔴 BUG #1 — `option_signal_history.exit_price` is storing **spot index value**, not option premium

This is the single most damaging issue. I cross-checked: in rows like `BANKNIFTY CALL strike=54600`, you see `exit_price = 54669.75` — that's the BANKNIFTY spot, identical to `last_spot`. Real option premiums for that strike would be a few hundred to a couple thousand rupees.

Consequence: every backtest, every realised-P&L report, every win/loss curve you display off this table is **nonsense**. My P&L calc using these values produced things like "+₹77,375 per unit on a SENSEX call" — physically impossible for an option that traded at ₹431.

You already have `option_entry`, `option_stop_loss`, `option_target1`, `option_target2` (premium-space). Add `option_exit_price` and **stop overwriting `exit_price` with spot**. Or: rename `exit_price` to `exit_spot` and add a true `exit_premium` column. Also backfill from Kite quote history for the 17 currently-decided signals if you can.

### 🔴 BUG #2 — Swing `sector` and `industry` are 100% NULL across all 1,168 rows

You have columns for sector and industry, you scan 477 symbols, you display them in `quality_grade` and `fundamental_status`, but the actual sector/industry strings are `\N` for **every single row**. Without sector tagging:

- You can't show "Pharma leading today" / "PSU Banks weak"
- Your `rs20/rs50/rs120` is benchmark-relative only; you have no sector-RS
- You can't rotate into the right basket; you can't avoid concentration

Fix: pull sector/industry from Kite's instrument dump (it has `segment`/`exchange` only — combine with a one-time NSE sector mapping CSV or scrape NSE's "Sectoral Indices Constituents" page). Refresh monthly. This is a 1-day task with outsized payoff.

### 🔴 BUG #3 — `paper_eq_audit` shows **93.7% of equity candidates rejected for `QTY_LT_1`**

378 audit entries, 354 of them skipped because position-sizing produced qty < 1. That means your risk/sizing math is incompatible with the equity book's capital. The audit also shows `EQUITY` segment balance has decayed from ₹10,00,000 seed → ₹1,27,617 — that's an 87% drawdown, which suggests either (a) test runs that weren't reset, or (b) seven open positions sitting on the books eating capital deployed.

You need to:
- Confirm whether the equity balance is "after capital deployed to open positions" (in which case ₹1.27L is just unallocated cash with 7 OPEN trades) or actually realised loss.
- Audit the sizing formula. If risk-per-trade × ATR is producing fractional shares on most setups, either lower min-risk threshold or scale by account-value rather than free-cash.
- Add a "rejection summary" widget in your UI from `paper_eq_audit` so you can see *why* the system is mostly skipping — this table is excellent and underused.

---

## 3. Data gaps and integrity issues

### `global_candles` is empty
You defined a (symbol, timeframe, ts) OHLCV store, indexed it well, and populated zero rows. Every chart you render must be hitting Yahoo/Binance live each time. That's slow, rate-limited, and unauditable. **Persist daily candles for at least 252 trading days for every symbol you scan** — your `swing_scan_result` proves you have the indicator inputs (RSI14, ADX14, ATR14, RS20/50/120, 52w hi/lo) so you're computing on candles you don't store. Persist them.

### `global_sync_logs` shows mass-failure on Yahoo sources
- `yahoo-equity`: last error = "206/206 symbols failed"
- `yahoo-fx`: 35/35 failed
- `yahoo-index`: 30/30 failed

These recovered (latest `ok` timestamps are after the errors), but a full-universe failure is a kill-switch event. Add alerting when `err_count/(ok_count+err_count) > 0.5` in any 1-hour window. Yahoo's API is hostile and unstable — you're already storing `last_error` and `failure_streak` per symbol; **build a "data health" dashboard tab** that surfaces these.

### `iv_history` covers only 6–8 days per underlying
You have a great schema for IV percentile/rank but only ~1 week of history. IV percentile needs ≥1 year. Until you have it, don't display "IVP" — display absolute IV with a caveat. Bootstrap historical IV by computing from past close prices + an option chain backfill (Kite's `/instruments/historical` for ATM strike of each expiry).

### `fii_dii_daily` data inconsistency
44 rows but two sources: `niftytrader` (29 rows, older data) and `nse` (15 rows, recent). Run a one-time reconciliation — if niftytrader and NSE disagree on any overlap dates, you'll be displaying numbers that contradict any other site the user checks. Standardise on NSE as source of truth.

### `participant_oi_daily` has FII building shorts aggressively
This isn't a bug, it's a finding worth surfacing in the UI: FII Index Futures net went from –192,572 (May 4) to –237,144 (May 12). FII index PUT-long net is +475,949 vs CALL-long net –250,003. Combined with –₹36,688 Cr cash outflow over 10 days vs +₹46,941 Cr DII absorption, your data is *telling a clear story* (FII risk-off, DII defending) — but I see no derived metric/badge surfacing this. **Add a "Smart Money Bias" tile** computed from these two tables that updates daily.

### Missing data domains entirely
For an "India market data-rich platform" you don't have:

1. **Option chain snapshots** — strike-wise OI / ChgOI / Volume / IV by expiry. Without it you can't show max pain, PCR, OI build-up, IV smile. Kite gives the chain; you must persist it (suggest 15-min snapshots during market hours).
2. **India VIX time series** — single most important regime indicator for F&O sizing. Not a column anywhere.
3. **Sector indices OHLCV** — NIFTYAUTO, NIFTYBANK, NIFTYIT, NIFTYFMCG, NIFTYPHARMA, NIFTYMETAL, NIFTYREALTY, NIFTYPSUBANK, NIFTYPVTBANK, NIFTYFINSRVC. You need these for sector RS and rotation views.
4. **Advance/Decline + new 52w highs/lows** — daily market breadth. Single most useful "is this rally real" indicator and trivial to collect.
5. **Pre-open data** — gap %, GIFT NIFTY (NSE IX), SGX-equivalent, ADR/GDR for index heavyweights overnight (INFY, HDFCBANK ADRs).
6. **Corporate actions calendar** — dividends, splits, bonuses, buybacks, results dates. Affects every gap. Kite exposes this.
7. **Economic calendar** — RBI MPC, CPI, IIP, GDP, US FOMC, US CPI/NFP. The events that move IV.
8. **Delivery percentage** — NSE bhavcopy daily. Massive edge for swing trading. Cheap to ingest.
9. **Bulk/block deals** — NSE publishes daily. Smart-money tape.
10. **F&O ban list** — daily NSE list of symbols crossing market-wide position limits. You must show this before letting users take stock-F&O trades.
11. **Index constituents + weights** — to compute "of NIFTY moving +0.5%, what % is from top-5 contributors". For breadth analysis.
12. **Earnings dates / surprises** — overlay on swing scanner.

That's the **data backlog**. I'd prioritise India VIX → Option chain → Delivery % → Sector indices → Advance/Decline → F&O ban list → corporate actions → earnings → bulk deals → economic calendar.

---

## 4. F&O engine — analysis and verdict

### What you have
Four setups defined: `BASELINE` (74% of signals), `EMA_PULLBACK`, `VWAP_RECLAIM`, `TREND_CONTINUATION`. Two tiers: `BASELINE` and `HIGH_CONVICTION`. Generated for 6 indices. Stored with both spot trigger and option premium levels (entry, SL, T1, T2).

### What the numbers say (98 signals, 2026-04-27 → 2026-05-13)

| Tier | Total | Triggered | T1 | T2 | Stopped | Win rate (decided) |
|---|---:|---:|---:|---:|---:|---:|
| BASELINE | 78 | 43 (55%) | 2 | 1 | 11 | **21.4%** |
| HIGH_CONVICTION | 20 | 12 (60%) | 0 | 0 | 5 | **0.0%** |

Exit-reason distribution:
- `EXPIRED_TRIGGERED` — 38.8% (entered, neither T1 nor SL hit by EOD)
- `EXPIRED_PENDING` — 30.6% (signal never even triggered)
- `STOPPED` — 16.3%
- `STALE_TRIGGER` — 13.3%
- `TARGET2_HIT` — 1.0% (single signal across the whole sample)

### Honest assessment
This is failing. Not by margin — structurally.

1. **The "HIGH_CONVICTION" tier underperforms BASELINE.** A higher tier with 0/5 win rate vs baseline's 3/14 is a flag. Either the filter that promotes signals to HC is selecting on the wrong feature, or HC trades are getting tighter stops that flush before targets. Investigate `confidence` thresholds (most HC are at 60–73 confidence; many BASELINE signals at 50–55 outperformed).

2. **The exit logic is too coarse.** 70% of signals expire (either pending or triggered-but-undecided). That's because every signal closes at EOD regardless of state. For intraday options on indices this is questionable — premiums decay overnight, so EXPIRED_TRIGGERED probably contains many that ended marginally green/red. Track and report them; don't lump 38% of your sample into a black box. Add `exit_reason='EOD_GREEN'` and `exit_reason='EOD_RED'` with the realised premium-P&L recorded.

3. **`STALE_TRIGGER` at 13%** suggests trigger conditions are written too tight (e.g. "trigger if 15-min close > X within 90 min"). Make this configurable per setup and review by index — BANKNIFTY needs wider triggers than FINNIFTY.

4. **Sample is tiny.** 98 signals over 10 trading days is not statistically meaningful for any single setup. You can't reach valid conclusions on EMA_PULLBACK from 12 signals. You need at minimum 100 *decided* trades per setup before drawing conclusions; that's ~6 months of operation at current rate.

### Critical missing features in F&O engine

1. **No IV/IVP awareness in entry.** Buying ATM premium at high IV is a different trade than at low IV. Every signal should carry the IV-at-entry and a regime tag (Low/Normal/High/Extreme IV). At Extreme IV, the system should refuse to buy premium and either skip or suggest spreads.

2. **No event filter.** Did the system avoid generating signals on RBI policy day, US CPI day, expiry-day morning, budget day? If not, your signals are getting wrecked by event vol that's nothing to do with technicals.

3. **No PCR / max pain / OI change context** anchoring direction. Your `direction` (BULLISH/BEARISH) is technical-only. Stock options trade off positioning. Hook in `participant_oi_daily` deltas day-over-day; at minimum surface "FII bought puts last 3 days" as a confidence multiplier.

4. **No spread logic.** You're buying naked options exclusively. With 16% straight-up stop rate and 38% expire-undecided, this is a theta-burning approach. Add at minimum: **bull-call-spread**, **bear-put-spread**, **iron-condor** templates with stored entry levels and broken-wing variants.

5. **No position sizing / Kelly / risk-of-ruin.** `paper_trade_fo.lots` is constant at 1 in all 7 paper trades. Decide lot count from: free-margin, IV-regime, signal-confidence, recent system-edge. Otherwise every trade is sized identically and you can't compound.

6. **No "skip" reasons recorded** the way you have `paper_eq_audit` for equity. You need `paper_fo_audit` showing every candidate that was generated but skipped, with reason (vix-too-high, near-event, max-trades-hit, capital-cap). Without this you can't tune the engine.

7. **No expiry-day handling.** SENSEX expires Friday, NIFTY Thursday, BANKNIFTY/FINNIFTY/MIDCPNIFTY have their own cycles. Premium behaviour on expiry day is completely different. Tag every signal with `dte` (days to expiry) and either skip or apply special rules at `dte ≤ 1`.

8. **No correlation guard.** If NIFTY signal is BULLISH and BANKNIFTY signal is BULLISH and FINNIFTY is BULLISH, you'd open three positions that are 0.8+ correlated. One bad open and you lose on all three. Cap simultaneous bullish/bearish exposure across correlated indices.

### F&O scoring/confidence — what to add
Current `confidence` is an integer 0–100 with no documented composition. Make it a vector:

```
confidence = w1 * technical_alignment      (trend across timeframes)
           + w2 * volume_confirmation
           + w3 * positioning_tailwind     (PCR, OI build, FII flow)
           + w4 * regime_compatibility     (VIX, IV, breadth)
           + w5 * event_clearance          (no event within 24h)
           - p1 * stale_factor             (penalty if trigger > N min old)
           - p2 * correlation_penalty
```

Store each component. Then you can show users "trade taken because: trend 9/10, volume 6/10, positioning 8/10, regime 7/10, event clear" — explainability matters for trust *and* for your own tuning.

---

## 5. Swing engine — analysis and verdict

### What you have
A genuinely sophisticated multi-factor scorer (53 columns per result). The factor stack:
- **Technical** (RSI14, ADX14, ATR, EMAs implicit in reasons)
- **SMC** — demand zones, FVGs, liquidity sweeps, supply zones
- **Volume** (vol_ratio, avg_value_lakhs)
- **Momentum**
- **Fundamental** (status only — no actual ratios stored)
- **Risk** (presumably ATR%/spread-based)
- **Context** (market structure, weekly trend)
- **RS** (20/50/120 day vs benchmark)

Plus VWAP anchoring (monthly, quarterly, YTD, 20-day), volume-profile value area, 52w-position. **This is the strongest part of your platform.**

### What's wrong / weak

1. **Action funnel is too brutal.** Of 1,168 results across 3 days, 960 say `AVOID/NO TRADE` (82%), 147 `WATCHLIST`, 54 `WAIT FOR CONFIRMATION`, 7 `WAIT FOR PULLBACK`, and **zero pure `BUY`**. The top-scored row (SCHAEFFLER, score 77.10) is action=AVOID despite having 14 bullish reasons listed and only 2 warnings. Either:
   - Your action-decision logic is mis-mapped from score (looks like it; 77/100 scoring AVOID is wrong), or
   - The "supply zone overhead" warning is a hard veto that overrides everything else.

   Fix the score→action mapping. A 77-score row with strong trend, VWAP stacking, demand/FVG overlap, ADX confirmation — that's at least a WATCHLIST/PULLBACK candidate, not AVOID. (Verify intent — if "AVOID" actually means "don't chase, wait for pullback," **rename the action label**; the current name is misleading users and yourself.)

2. **0% trigger_hit rate.** All 1,168 rows have `trigger_hit = NULL` or `false`. Either the intraday-evaluator isn't writing back to this table, or no triggers were actually hit, or the column isn't being checked. This is your "did the signal turn actionable today?" data — fix the pipeline.

3. **Reasons/warnings are great but underused.** You're storing rich JSONB explanations and presumably not showing them prominently. They're the most user-trust-building output you have. Display every reason as a coloured badge in the UI, sorted by category (Trend / SMC / Volume / VWAP / Volume Profile).

4. **No sector/industry — repeating from §2 but it bears repeating** because it cripples the swing module specifically. Without it the RS scores are floating in space.

5. **Fundamental dimension is shallow.** `fundamental_status` is a 4-bucket string (Strong / Acceptable / Weak-Mixed / Poor-Unavailable). For swing trades held 5–30 days you need at minimum: latest quarterly YoY revenue %, EPS growth %, ROE, D/E, latest QoQ surprise, ownership change (promoter pledge ↑↓, FII holding ↑↓), days-to-results. Pull from BSE corporate filings API or scrape Screener.

6. **Buy zone basis is stored but not stratified in action.** Rows have `buy_zone_basis = "Bullish FVG"` or `"Demand zone"` or `"Volume profile value area"`. These have different statistical edges. Track win-rate by buy_zone_basis once you have outcomes, then weight them differently in score.

7. **No regime overlay.** Your scan doesn't condition on market regime. NIFTY in a strong uptrend should bias scores toward longs; NIFTY breakdown should suppress all long setups regardless of stock score. Compute a `nifty_regime` (bull/neutral/bear) daily and multiply into the score.

8. **No portfolio fit / overlap check.** When swing scan returns 147 watchlist names, there's no diversification logic — they could all be from the same sector or correlated. After scoring, run a final clustering pass (correlation matrix on last-60-day returns) and only show the top-K per cluster.

9. **Universe size = 477.** Good (covers NIFTY 500 ish). Just confirm you're not silently dropping mid/smallcaps that are most of the alpha. Compare the symbol list to NIFTY 500 + NIFTY MICROCAP 250 + Nifty SmallCap 250 = ~750 actively-tradeable names. Add the missing ~270.

10. **Two scan-run failures.** May 12 had `error_count=286` on only 214 scanned (more errors than scans!) and took 12 sec vs the usual 5 min. That's a partial outage. Surface "today's scan health" in the UI header so users know if results are reliable.

### Swing — exit logic
You define `target1`, `target2`, `stop_loss`, `trailed_to_t1`, `max_runup`, `max_drawdown`. That's good. What's missing:

- **Trailing logic isn't visible.** Is the trail ATR-based, structure-based (last swing low), or % drawdown? Document and configure.
- **Time stop.** If a swing trade hasn't moved 1R in 10 days, exit. Cuts opportunity-cost dead-weight.
- **Volume-fade exit.** If volume contracts below 60% of 20-DMA for 3 days while position is held, scale out.
- **Profit-protect after T1.** Once T1 hits, stop should move to entry (your `trailed_to_t1` flag implies this — confirm it actually moves stop to entry, not just an audit flag).
- **Re-entry rules.** What happens if a stopped-out symbol re-prints a buy setup within 5 days? Most systems incorrectly re-enter; the better systems require a higher-quality re-print.

---

## 6. Migrating data ingestion to Kite Connect (your ask #6)

You already have a `kite_session` row, so Kite auth is wired. The migration path:

**Current state:** Live prices come from `yahoo-*` (failing intermittently) and `binance`. Indian stock data on Yahoo is unreliable (delayed, frequent symbol mismatches like `RELIANCE.NS` vs `RELIANCE.BO`). Kite is the right move.

**Phased plan:**

1. **Phase 1 — Indian equity LTP & quote.** Replace `yahoo-equity` for any `*.NS` / `*.BO` symbol with `kite.quote()` / `kite.ltp()`. Kite is delayed-free, supports 250 symbols per quote call (use batching).

2. **Phase 2 — Daily candle ingestion.** `kite.historical_data(instrument_token, from, to, "day")` — backfill 500 days for each of your 477 swing symbols, then daily incremental. Persist to `global_candles` (which is currently empty). This single change kills 90% of your Yahoo dependency.

3. **Phase 3 — Intraday candles.** 5-min candles for index F&O underlyings during market hours; needed for VWAP_RECLAIM, EMA_PULLBACK setups to evaluate correctly. Cache for the day, drop overnight.

4. **Phase 4 — Live streaming via KiteTicker (websocket).** Replace the polling `global_live_prices` updates with the websocket feed for any symbol on user watchlists / in open positions. Massively reduces latency and Kite API hit count.

5. **Phase 5 — Option chain.** `kite.instruments("NFO")` for the instrument list, then `kite.quote()` on the OPTIDX/OPTSTK tokens by expiry. Snapshot every 15 min during market hours into a new `option_chain_snapshot` table (date, time, underlying, expiry, strike, type, oi, oi_change, volume, iv, ltp, bid, ask). This unlocks max-pain, PCR, OI shifts.

6. **Phase 6 — Orders.** Eventually paper → live order placement via `kite.place_order()`. Add a `kill_switch` boolean in `paper_account` and a daily loss limit before going live.

**Caveats:**
- Kite's rate limit is **3 req/sec, 200 req/min** per endpoint type. You'll need request queuing.
- Access token expires at 06:00 IST daily — already visible in your kite_session expires_at. **Add auto-refresh notification** (the user has to log in manually each morning; Kite doesn't allow headless refresh).
- For backtesting, Kite historical only goes back 60 days for 1-min, 400 days for 5-min, unlimited for daily.
- **Security:** your `kite_session` table stores `access_token` in plaintext. Encrypt at rest using a server-side key (e.g. Postgres `pgcrypto` with `pgp_sym_encrypt`).

---

## 7. UI, colours, fonts, visuals (your ask #7)

I haven't seen the actual UI — but from the data shape, here's what an Indian-market-fluent trader expects to see, opinionated:

### Information hierarchy (top-down)
1. **Market-regime header strip** — never goes away. Shows: NIFTY %, BANKNIFTY %, India VIX (with arrow), FII cash (today), DII cash (today), Adv/Dec ratio, IV regime tag (LOW/NORMAL/HIGH/EXTREME), market session badge (PRE-OPEN / OPEN / LUNCH-LULL / POWER-HOUR / CLOSED).
2. **Module tabs** — Swing / F&O / Watchlist / Paper / Backtest / Settings.
3. **Within each module:** Filters left, signals/results centre (sortable table), detail/chart drawer right.

### Colour system (data-rich + readable)
Use a desaturated dark theme as default — traders stare at this for hours. Indian conventions:
- **Green / Red:** standard up/down. Use a slightly desaturated palette (e.g. `#16a34a` and `#dc2626`, not pure `#00FF00`). Pure-saturated red/green causes eye fatigue.
- **Avoid red/green-only signalling** — about 8% of men have some red-green colour vision deficiency. Always pair colour with a glyph or arrow.
- **Conviction tier colours:** BASELINE → cool blue (`#3b82f6`), HIGH_CONVICTION → amber/gold (`#f59e0b`). Don't use red for the strong tier.
- **Action chips:** BUY = solid green, WATCHLIST = blue outline, WAIT FOR PULLBACK = amber outline, AVOID = grey outline. Outline ≠ filled communicates "informational vs actionable".
- **Score gradient:** use a single hue ramp (e.g. blue 30→90), not red-yellow-green — for an analytical score, a heatmap diverging palette confuses with P&L colour.

### Typography
- **Numeric font:** Use a tabular-figures monospace digit font for all prices, scores, %. **Inter** with `font-feature-settings: 'tnum'` is great. Or **JetBrains Mono** / **IBM Plex Mono** for the table cells. This stops digit-jitter on live updates.
- **Body:** Inter or **Sans Serif (system-ui)** — readable, neutral.
- **Don't mix more than 2 fonts.** Monospace for numbers, sans for prose. That's it.
- **Size:** 14px base, 12px in dense tables, 16–18px for headers. Indian users tend to view on 1366×768 laptops more than 1440p; design for the lower res first.

### Visualisations you actually need
- **Mini-charts (sparklines)** in every row: 20-day, 30px tall. Critical for swing tables.
- **Heatmap** for sector performance (treemap by market-cap, colour by % change). Single most-loved view in Indian retail analytics.
- **OI build-up tile** for option chain: strike on Y, OI bars + ChgOI deltas overlaid.
- **FII/DII bar over time:** stacked dual bar (FII on top of X axis, DII below) over last 30 days. Trader can read positioning instantly.
- **VIX gauge** — semi-circle from 10 to 40 with current value and 30-day percentile.
- **Participant OI net-position table** — already a Sensibull/Opstra staple; you have the raw data.
- **Heatmap of NIFTY-500 daily returns** in 10×50 grid coloured by % change — essentially what NSE's "market mover" board does.

### Density vs whitespace
F&O traders accept dense screens (think Bloomberg, Sensibull, Opstra). Don't over-pad. Use:
- 8px row height in tables, not 14.
- 1px borders, not 4px shadowed cards.
- Inline icons (16px) for setups (e.g. SMC zones, VWAP, FVG) — visual vocabulary.

### What to avoid
- Generic "Material Design" tables — too airy.
- Animated transitions on price ticks — causes nausea and obscures the move.
- Modal popups for trade detail — use a side drawer; user wants to keep watching the market.
- "Empty state" illustrations on data screens — show the schema/columns even when empty.

### Accessibility
- All numbers should have ≥4.5:1 contrast ratio against background.
- Keyboard navigation for the signal tables (j/k to move row, enter to expand).
- Persistent timezone display (IST) so the user never doubts what time a signal was generated.

---

## 8. Prioritised roadmap (what I'd do, in order)

**Week 1 — stop the bleeding**
1. Fix BUG #1 (option exit_price). Backfill 17 known-decided signals.
2. Fix BUG #2 (populate sector/industry). One-time CSV from NSE sectoral indices.
3. Fix BUG #3 (equity sizing producing qty<1). Audit `paper_eq_audit` and recalibrate.
4. Reconcile fii_dii_daily sources, standardise on NSE.
5. Encrypt `kite_session.access_token`.

**Week 2 — fill data layer**
6. Start persisting daily candles to `global_candles` via Kite. Backfill 500 days for NIFTY-500.
7. Add tables: `india_vix_daily`, `option_chain_snapshot`, `sector_index_daily`, `market_breadth_daily`, `corporate_actions`, `economic_events`, `fno_ban_list`, `delivery_pct_daily`, `bulk_block_deals`.
8. Build "data health" tab from `global_sync_logs` with alerting.

**Week 3 — F&O fixes**
9. Add `paper_fo_audit` table mirroring equity audit.
10. Stratify `EXPIRED_TRIGGERED` into EOD_GREEN / EOD_RED with realised P&L.
11. Add `dte`, `iv_at_entry`, `ivp_at_entry`, `event_within_24h` to `option_signal_history`.
12. Add IV regime gate (skip naked-buys at IVP > 80).
13. Add correlation guard across indices.
14. Investigate why HIGH_CONVICTION underperforms BASELINE (look at component weights).

**Week 4 — swing fixes**
15. Fix action-decision mapping (a 77-score row should not be AVOID).
16. Fix `trigger_hit` write-back from intraday evaluator.
17. Add regime overlay (multiply by NIFTY regime).
18. Add time-stop and volume-fade exits.
19. Add sector-RS computation (using sector indices from Week 2).
20. Add real fundamental fields (YoY rev/EPS, ROE, results date).

**Week 5 — UI**
21. Build market-regime header strip.
22. Build sector heatmap (treemap).
23. Build OI build-up + max-pain widget from option chain.
24. Adopt tabular-figures font, 8px row density.
25. Add explainability badges from `reasons`/`warnings` JSONB.

**Week 6+ — strategy depth**
26. Add option spread templates (bull-call, bear-put, iron-condor).
27. Add proper position sizing (Kelly-fraction × volatility-adjusted).
28. Backtest framework reading `global_candles` so you can rerun strategy changes on history before deploying.
29. KiteTicker websocket for live data.
30. Live order placement with kill-switch + daily loss cap.

---

## 9. One-paragraph executive summary

You have the bones of a serious tool — the swing scanner's factor stack and the F&O signal+paper-trade plumbing are above what most Indian retail products offer. But three bugs are silently destroying the system's outputs (option exit_price is index spot, sector is 100% NULL, equity sizing rejects 94% of candidates), the F&O engine is operating with 0% high-conviction win rate over 20 trades, and you're missing the entire Indian market data spine that traders actually use (India VIX, option chain, delivery %, sector indices, F&O ban list, breadth, corporate actions, economic events). Migrate ingestion to Kite Connect with persisted daily candles as the first big move, fix the three bugs in week 1, fill the data gaps in weeks 2–3, then re-tune the F&O engine with regime/IV/event awareness. The swing engine needs a smaller fix list — primarily the action-mapping and sector enrichment. UI should target dense-but-readable in the Sensibull/Opstra style, tabular-figures font, regime header strip, sector heatmap.

---

*Notes on what I couldn't see in this dump:* application source code, API endpoints, the actual UI, billing/auth flows in operation, the exact scoring formulas. If you share the repo (or the scoring functions specifically), I can audit the algorithms directly rather than inferring from output patterns.
