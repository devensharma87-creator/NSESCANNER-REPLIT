# FULL WEBSITE DEEP AUDIT REPORT

**Project:** Indian Stock Market Scanner (monorepo: api-server + scanner + global + mockup-sandbox)
**Audit date:** 2026-06-23, ~16:26 IST (market closed; Tuesday)
**Audit type:** READ-ONLY. No code changed, no fixes applied, no UI touched, no workflows restarted, no features started.
**Method:** Combined **(a) full code audit** (8 area-by-area code explorations across the whole repo) **+ (b) live production audit** (read-only queries against the production database, production deployment logs, and dev workflow/console logs).

> **Important:** This is a findings report only. Nothing was fixed. A prioritised fix list is in §17 — awaiting your approval before any change.

---

## 0. THE SINGLE MOST IMPORTANT FINDING (read this first)

**The Kite (Zerodha) session expires every day at 06:00 IST and there is NO automated daily re-login. Today (2026-06-23) you did not log in until 15:21 — i.e. after the market had already closed at 15:30. So for the ENTIRE trading session (09:15–15:30) the live data feed was offline.**

Hard proof from production:

| Evidence | Value |
|---|---|
| `kite_session.login_time` (today) | **15:21 IST** |
| `kite_session.expires_at` | 2026-06-24 06:00 IST |
| F&O engine reasoning logged at 09:15 (all 3 indices) | `PRE_EMISSION_REJECTED · no_live_kite_intraday (Kite session expired / throttled / index uncovered)` |
| `paper_daily_summary_fo` 2026-06-23 | signals_generated **0**, valid_candidates **0**, trades_opened **0** |
| Prod scan logs *after* 15:21 (~15:48+) | `kiteOffline=false` (Kite came back only after you logged in) |

**This is the actual reason the F&O page showed "0 setups across 0 indices" even on a strong-move day.** It is NOT a bug in the signal logic — the engine *correctly* refused to emit option signals when it had no authoritative (Kite) intraday data, and instead of faking it with Yahoo (which is also failing right now, see §14), it emitted nothing. The system behaved honestly. The operational gap is that **nobody/no cron logged Kite in before the open**, so the whole day ran blind.

Knock-on effects of the same root cause:
- F&O auto paper-trader has opened **0 trades for 8 days** (last open 2026-06-15) — many of those days Kite was offline during the session.
- Live scanner / Home / charts fell back to Yahoo during the session — and Yahoo is currently failing wholesale (206/206 equity symbols failing), so several panels were sparse/stale all day.
- Option-chain snapshots for today only exist for the 15:30 capture (after re-login).

**Fix direction (not yet done):** add a daily Kite token bootstrap + a loud pre-open "Kite is logged out — reconnect now" alert so a missed login can't silently kill the whole trading day. Details in §8 and §17.

---

## 1. EXECUTIVE SUMMARY — AREA STATUS TABLE

Status legend: ✅ Working · 🟡 Working-but-limited · 🔴 Broken/failing · ⚫ Hidden/stale
Severity legend: Critical / High / Medium / Low / Cosmetic

| # | Area | Status | Severity | Production-usable? | Main issue |
|---|---|---|---|---|---|
| A | Home / Dashboard | 🟡 | Medium | Yes | Several panels depend on Kite (offline pre-15:21 today) or Yahoo (failing) → sparse during outages; honesty is good |
| B | Watchlist | ✅ | Low | Yes | Kite-priced, Yahoo banned; missing symbols labelled honestly |
| C | Portfolio Analyser | ✅ | Low | Yes | No fabrication; null/“n/a” for missing CMP; re-verified clean (§13) |
| D | Charting | ✅ | Low | Yes | Kite intraday + Yahoo "visual only" labelled; warehouse NOT used here so unaffected by §K bug |
| E | Scanner / Stock Intelligence | 🟡 | Medium | Yes | Full scan hard-timeouts → serves cached 198 rows; bhavcopy blocked in prod |
| F | Swing Engine (Pro Swing v3) | 🟡 | Medium | Yes | Runs daily (476 rows today) but 24–50 symbols error each run; one total failure 2026-06-19 |
| G | F&O Intraday Engine | 🟡 | **High (operational)** | Yes (when Kite up) | 0 setups = Kite offline all session + pull-based engine; logic is sound but blind without daily login |
| H | Option Chain / OI Lab | ✅ | Low | Yes | Kite→NSE fallback, all modelled values (GEX/Greeks) labelled; snapshots fresh |
| I | Paper Trading | 🟡 | Medium | Yes | Honest & gated; but 0 F&O opens for 8 days, and 3 single-share equity test positions polluting the open book |
| J | Backtest Lab | 🟡 | Medium | Yes | Option P&L is a **synthetic ATM delta-0.5 proxy** (labelled) — not real historical premiums |
| K | Data Backbone — candle warehouse | 🔴 | Medium | Yes (nothing reads it yet) | `candle` table is **EMPTY (0 rows)**; daily tick fails on malformed SQL every ~5 min |
| K | Data Backbone — Yahoo fallback | 🔴 | High | Degraded | Yahoo failing wholesale (equity 206/206, index 30/30, fx 35/35) → no safety net when Kite down |
| K | Data Backbone — TradingView alerts | ⚫ | Medium | No | `tv_alerts` has **4 rows, newest 2026-04-24** (~2 months stale) — webhook dormant |
| L | Auth / Infra | ✅ | Low | Yes | HMAC session cookies, role gates, public read mode; DB pool healthy |
| M | UI/UX / Navigation | 🟡 | Low | Yes | Stale-but-real data can read as "broken" without a louder global "Kite offline / data degraded" banner |

---

## 2. LIVE PRODUCTION STATE SNAPSHOT (evidence captured 2026-06-23 ~16:26 IST)

| Subsystem | Live state | Verdict |
|---|---|---|
| Kite session | Valid now (login 15:21, expires 06-24 06:00). **Was offline 06:00→15:21 today.** | 🔴 operational |
| `candle` warehouse | **0 rows.** Sync runs write 0 rows. Daily tick errors continuously. | 🔴 |
| `option_chain_snapshot` | Fresh: NIFTY/BANKNIFTY/SENSEX all captured 06-23 15:30 (~78–80k rows each) | ✅ |
| `swing_scan_result` | 476 rows for 06-23 (deep scan finished 15:38); 24 errors | 🟡 |
| `swing_scan_run` history | 06-23 ok (476/24); 06-22 ok (450/50); **06-19 total failure (0 scanned / 500 errors)**; 06-15 ok | 🟡 |
| `tv_alerts` | 4 rows total; earliest 04-23, **latest 2026-04-24** | ⚫ stale |
| `paper_account` | FNO free balance ₹10,06,361 (seed ₹2,00,000); EQUITY free balance ₹2,05,098 (seed ₹10,00,000, rest deployed) | ✅ |
| `paper_trade_fo` | 28 CLOSED, **0 OPEN, last open 2026-06-15** | 🟡 |
| `paper_trade_eq` | 20 CLOSED + 10 OPEN (last open 06-16) | 🟡 (3 test positions) |
| `paper_trade_combo` | empty (no combos ever) | ⚫ unused |
| `fno_signal_reasoning` today | 3 rows, all `PRE_EMISSION_REJECTED / no_live_kite_intraday`, all @ 09:15 | 🔴 root cause |
| `option_signal_history` | last signal_date **2026-06-22** (none today) | consistent w/ Kite offline |
| `paper_daily_summary_fo` | 06-23: 0/0/0 · 06-22: 5 sig / 3 valid / 0 opened / 3 skipped · 06-19: 4 sig / 7 valid / 0 opened / 7 skipped | 🟡 0 opens despite candidates |
| `fii_dii_daily` | latest 06-22 (1-day lag, normal) | ✅ |
| `iv_history` | NIFTY/BANKNIFTY/SENSEX/FINNIFTY/MIDCPNIFTY current to 06-23; BANKEX/NIFTYNXT50 stale (05-08) | ✅ (main indices) |
| `global_live_prices` | 392 symbols, newest 16:29 (fresh); 1 failing; some stale since 05-20 | 🟡 |
| `global_sync_logs` (Yahoo) | **yahoo-equity 206/206 failed, yahoo 30/30, yahoo-index 30/30, yahoo-fx 35/35 failed**; binance ok | 🔴 |
| `backtest_runs` | 6 runs, all COMPLETE, last 06-22 | ✅ |

Recurring production log warnings (every few minutes):
- `candle-warehouse: daily tick failed … ANY(($2, $3, $4)::bigint[]) … params: day,256265,260105,265` (malformed array cast)
- `NSE bhavcopy fetch failed for last 7 trading days` (NSE blocking cloud IPs; dev still loads 06-22 bhavcopy)
- `scanAll hard-timeout reached, returning partial/cached … returned=198`
- `Kite scanner: getQuote batch failed … ECONNRESET` (intermittent)
- `Yahoo chart failed … No data found, symbol may be delisted … LTIM.NS`

---

## 3. WHAT'S WORKING (with proof + data source + limitation)

| Feature | Proof it works | Data source | Limitation |
|---|---|---|---|
| Market indices board | `/api/indices` live; renders `—` for nulls, "Live" vs "~15min delayed" badge | Kite → Yahoo fallback | Sparse when both offline |
| Watchlist | Kite-priced batches, 60s cache, source badge, honest `missingSymbols` | Kite only (Yahoo banned) | Off-universe trend is heuristic |
| Portfolio Analyser | Saves per-user; enriches via stockDetail→etfQuote→search→candles; null when no CMP | Kite (+ alias/BSE resolver) | XIRR needs purchase dates; sector weights honestly "unavailable" |
| Charting | `/api/chart/candles` returns provenance + freshness; LIVE/STALE/DELAYED/VISUAL-ONLY badges | Kite intraday; Yahoo "visual only" for Indian, primary for global | Global intraday depth limited; CVD/VP approximated |
| Option Chain page | `/options/chain` + `/options/analytics`; KITE LIVE vs NSE FALLBACK badge | Kite → NSE | NSE fallback marked "display only, not for signals" |
| OI Lab | `/options/oi-lab/insights`; sentiment, windowed OI deltas; MODELLED badges | Kite snapshots (+ historical backfill) | GEX/Greeks are Black-Scholes modelled (labelled) |
| Swing scanner | 476 rows persisted today; A–D grades; provenance per symbol | Kite daily (500d) → Yahoo; 15-min LTP refresh | Per-run symbol errors (§9) |
| Paper trading (manual + auto) | Atomic txns, heat caps, DD latches, capital ledger; honest skip reasons | Kite for marks | Auto-open gated to prod + Kite up |
| Backtest Lab | 6 COMPLETE runs; honest data-quality + modelled-premium labels | Real 15-min spot CSVs | Synthetic option P&L (§11) |
| Auth & public read mode | HMAC session cookies, role gates, `/legal/*` bypass | — | — |
| Data diagnostics | `/api/data/diagnostics`, `/symbol/:s`, `/system/status`, `/paper/diagnostics/*` | — | Owner-gated |

---

## 4. BROKEN / FAILING (table)

| Feature | Where | Symptom (live) | Root cause | Severity | Fix needed |
|---|---|---|---|---|---|
| Candle warehouse daily tick | `candleWarehouseIngestor.ts` (daily tick query) | Fails every ~5 min in prod; `candle` table = 0 rows; sync writes 0 | Malformed SQL: `instrument_token = ANY(($2,$3,$4)::bigint[])` casts a record tuple to `bigint[]` → query throws before any fetch | Medium | Rewrite as `= ANY($1::bigint[])` with a single array param (or `IN (…)`). Then backfill |
| Yahoo fallback (all lanes) | global pump + Indian fallback | `global_sync_logs`: equity 206/206, index 30/30, fx 35/35, yahoo 30/30 all failing | Yahoo endpoints blocking the prod cloud IP / rate-limited | High | Treat Yahoo as best-effort; ensure UI shows degraded clearly; consider a second delayed source |
| TradingView alerts feed | `tv_alerts`, webhook route | Page shows alerts from "2 months ago"; only 4 rows ever, newest 2026-04-24 | Webhook has received nothing since 2026-04-24 (TradingView alerts not configured/expired upstream) | Medium | Either re-wire TradingView alerts, or hide/age-label the panel so 2-month-old rows don't look "live" |
| NSE bhavcopy (prod) | bhavcopy fetcher | `NSE bhavcopy fetch failed for last 7 trading days` (prod) | NSE rejects cloud IPs; dev still loads (06-22) | Medium | Fallback source for delivery%/bhavcopy, or label as last-available date |
| Full NSE scan timeout | `fullNseScanner.ts` / scanAll | `scanAll hard-timeout … returned=198` repeatedly; full Kite scan does complete 4298 separately | Quoting 8,760-instrument universe exceeds the hard time budget; serves cached 198-row subset | Medium | Raise/parallelise budget, or make the cached-fallback explicit in UI |

> Note: items in §4 are *failing*, but the **site as a whole stays usable** because each has an honest fallback (cached rows, "n/a", delayed labels) rather than fabricated data.

---

## 5. WORKS-BUT-LIMITED (list)

1. **Home panels** — correct and honest, but visibly sparse whenever Kite is offline (pre-15:21 today) or Yahoo is down (now). Reads as "broken" to a user without a louder banner (see §16).
2. **Scanner breadth/sectors/top-movers** — derived from the same scan that timeouts to 198 cached rows; during timeouts the breadth is computed off a reduced set.
3. **Swing engine** — works daily but loses 24–50 symbols/run to source errors, and had a full failure on 2026-06-19 (0 scanned / 500 errors).
4. **F&O engine** — logic is sound but **pull-based** (only runs when `/options/signals` is requested) and **fully dependent on a live Kite session**; both must hold for setups to appear.
5. **Equity paper auto-trader** — enabled in prod, but no equity auto-opens recently; open book mixes real sized positions with 3 single-share test buys.
6. **Backtest Lab** — usable for directional/structure study, but option P&L is a delta proxy, so absolute ₹ outcomes are approximations, not broker-accurate.
7. **IV history** — main indices current; BANKEX & NIFTYNXT50 stale since 2026-05-08.
8. **Global multi-asset app** — crypto (binance) fresh; Yahoo-sourced equity/fx/index symbols mostly failing right now.

---

## 6. HIDDEN / DISABLED / STALE (table)

| Feature | Location | Current state | Why | Recommendation |
|---|---|---|---|---|
| INDstocks secondary provider | `marketData/indstocks*` | Disabled (`INDSTOCKS_ENABLED` off) | Scaffold/foundation only; failover signal-block deferred | Keep disabled until adapter + mappings verified |
| Candle warehouse (read side) | `candleWarehouse*` | Empty, write-only, tick broken | No user-facing consumer reads it yet | Fix tick + backfill *or* park it explicitly; remove log noise |
| TradingView alerts | `tv_alerts` | Stale (newest 04-24) | Upstream alerts not firing | Re-wire or hide/age-label |
| Combo paper-trader lane | `paper_trade_combo*` | 0 combos ever | Owner-only manual lane, unused | Keep (functional), low priority |
| FINNIFTY / MIDCPNIFTY (F&O signals) | `OPTION_INDICES` | Removed from signal universe | Low weekly OTM liquidity | Intentional — leave out |
| BANKEX / NIFTYNXT50 IV | `iv_history` | Stale since 05-08 | Not in active capture set | Confirm intended |
| Equity test positions | `paper_trade_eq` (OPEN) | MOTHERSON / GMRINFRA / OBEROIRLTY @ qty=1 | Look like manual 1-share test buys | Close/clean so the open book reflects only real sizing |
| "Load from Database" (Portfolio) | portfolio page | Disabled in v1 | Not configured | Intended |

---

## 7. DATA-SOURCE MATRIX (per feature)

| Feature | Primary | Fallback | Trade-grade? | Display-only path | Modelled values | Stale handling | Missing handling | Risk |
|---|---|---|---|---|---|---|---|---|
| Indices board | Kite | Yahoo (15m) | Kite only | Yahoo labelled "~15min delayed" | — | "Live" vs "delayed" badge | `—` | Low |
| Watchlist | Kite | none (Yahoo banned) | Yes | — | trend heuristic off-universe | stale-but-complete cache | `missingSymbols` | Low |
| Portfolio | Kite (+resolver) | candles | Valuation only on real CMP | — | — | manual CMP only if live null | null / "n/a" | Low |
| Charting (Indian) | Kite | Yahoo "visual only" | Kite only | Yahoo = VISUAL ONLY / NOT FOR SIGNALS | indicators client-side | LIVE/STALE/DELAYED badge | empty state | Low |
| Charting (global) | Yahoo | — | No | whole tab delayed | — | DELAYED badge | empty | Low |
| Scanner | Kite | Yahoo | signal=source-stamped | — | — | cached 198 on timeout | drops rows (no fake) | Medium |
| Swing | Kite daily | Yahoo | source-stamped | — | zones/FVG/VP computed | per-symbol error skip | warnings[] | Medium |
| Option chain | Kite | NSE | TRADE_GRADE=Kite-only | NSE=DISPLAY ONLY | — | STALE/PARTIAL OI badge | 503 | Low |
| OI Lab metrics | Kite snapshot | NSE | — | — | GEX, Greeks, synthetic future (MODELLED) | freshness badge | partial flag | Low |
| F&O signals | Kite intraday + chain | **none** (Yahoo prohibited) | Yes | — | premium model in backtest only | rejects if not LIVE_KITE | PRE_EMISSION_REJECTED | High (needs Kite up) |
| Paper marks | Kite | — | Yes | — | — | skip if untrusted | skip reasons | Low |
| Backtest | real spot CSV | — | study only | — | **ATM delta-0.5 premium proxy** | data-quality labels | "unavailable" | Medium |
| Home global cues | Yahoo / TV proxy | — | No | delayed | — | omit if non-finite | null | Low |
| FII/DII, participant OI | NSE | — | reference | — | — | 1-day lag normal | — | Low |

**Bottom line on honesty:** across every surface audited, the code **omits or labels** missing/secondary/modelled data — it does **not** fabricate (`?? 0` is avoided; nulls and explicit "n/a"/"unavailable"/"MODELLED"/"VISUAL ONLY" are used). This is a genuine strength and was re-confirmed in code in Home, Watchlist, Portfolio, Charting, Option Chain, and the market-data guard layer.

---

## 8. KITE-OFFLINE BEHAVIOR + SESSION MANAGEMENT

### 8a. What happens to each feature when Kite is offline

| Feature | Works without Kite? | What breaks | User message | Correct behavior? |
|---|---|---|---|---|
| Home indices | Partially | Live LTP → falls to Yahoo (currently failing) | "~15min delayed" / `—` | ✅ honest |
| Watchlist | No (Yahoo banned) | Prices unavailable | missing/empty | ✅ honest (won't fake) |
| Portfolio CMP | Degraded | CMP null | "n/a" + manual CMP | ✅ |
| Charting Indian | Visual only | No live/intraday Kite | "VISUAL ONLY" Yahoo | ✅ |
| Scanner | Degraded | Yahoo fallback (failing now) | cached/sparse | 🟡 sparse, not labelled loudly |
| Swing | Degraded | Yahoo daily fallback | warnings[] | 🟡 |
| Option chain | Yes (NSE) | Kite→NSE | "NSE FALLBACK · DISPLAY ONLY" | ✅ |
| **F&O signals** | **No** | **No emission at all** | `no_live_kite_intraday` → 0 setups | ✅ honest, but invisible to user as a *cause* |
| Paper auto-trade | No | No opens (untrusted) | skip reason | ✅ |

### 8b. Session lifecycle (today's failure mode)
- Tokens expire **daily at 06:00 IST** (`next6amIST()`); `getActiveSession()` returns null past expiry.
- Reconnect = manual: **Login to Kite** → `/api/kite/login-url` → Zerodha OAuth → `/api/kite/callback`.
- Token stored in Postgres `kite_session` (AES-256-GCM at rest if `KITE_TOKEN_ENC_KEY` set).
- WebSocket ticker auto-reconnects, and a dev instance can mirror a prod session (`KITE_MIRROR_URL`) — **but neither obtains a fresh token after the daily 06:00 expiry.**
- **There is NO daily auto-login cron.** Today that meant: expired 06:00 → not re-logged until 15:21 → entire session blind.

### 8c. Recommendation (not implemented)
1. A pre-open scheduled check (~08:45 IST) that, if `kite_session` is expired/missing, raises a **loud, unmissable "Kite logged out — reconnect before open"** alert (banner + ideally push/email).
2. Persisted `KITE_OFFLINE_SINCE` surfaced as a global banner so a missed login is obvious within seconds, not after a confusing "0 setups" day.
3. (Optional) semi-automated token refresh if a request-token capture flow is acceptable to you.

---

## 9. SWING ENGINE — DEEP AUDIT

- **What it is:** TS port of "Pro Swing Scanner v3"; deterministic math (EMA/RSI/ATR/ADX/VWAP, supply-demand zones, FVG, fixed volume profile). Surfaced on `/stocks-to-watch`.
- **Data:** Kite daily (500 bars) → Yahoo fallback; 15-min intraday LTP refresh during market hours; NIFTY 50 benchmark loader (Yahoo→retry→Kite); Yahoo fundamentals (6h cache).
- **Scoring:** Technical + SMC + Volume + Momentum + Fundamental + Risk + Context + RS → A–D quality grade. Buy-zone from ATR buffer; T1 = `price + max(range·0.55, ATR·2.5)`; stop = `max(support, price − max(range·0.25, ATR·1.2))`.
- **Cadence:** Deep scan once/day after 15:35 IST; cold-start latch keyed off the `swing_scan_run` audit row.
- **Live state:** 06-23 → 476 results, 24 errors; 06-22 → 450/50; **06-19 → 0 scanned / 500 errors (total failure)**; 06-15 → 443/57.

**Findings:**
- 🟡 **Persistent per-run symbol errors (24–50/run).** Likely Kite historical throttling / Yahoo fallback failures for a subset; not fatal but erodes coverage.
- 🔴 **Whole-run failure on 2026-06-19** (0 scanned). Correlates with that day's broader Kite/Yahoo trouble. No automatic retry surfaced.
- 🟡 **RS goes neutral** when the NIFTY benchmark fetch fails (Yahoo down) — can flip RS-dependent grades silently.
- 🟡 **Single-replica scheduler assumption** — fine for one instance; would double-run if scaled.
- ⚪ Fundamentals lack QoQ growth (uses ratios endpoint, not statements); volume profile fixed at 48 bins (coarse for low-priced names).
- **Trade-grade?** Plans are **modelled once/day** (labelled); only Kite-sourced price/OI is treated as authoritative. Honest.

---

## 10. F&O INTRADAY ENGINE — DEEP AUDIT (the "0 setups" question)

### 10a. Architecture
- **Universe:** NIFTY (weekly Tue), BANKNIFTY (monthly), SENSEX (weekly Tue). FINNIFTY/MIDCPNIFTY intentionally removed.
- **Execution:** **Per-request** on `GET /options/signals` (pull-based). No always-on background signal loop; reasoning is logged only when the page/API is hit.
- **Gating:** market hours 09:15–15:30 IST; requires Kite session; data must be `LIVE_KITE_FULL/PARTIAL` (Yahoo prohibited for F&O).
- **Emission:** HIGH_CONVICTION (conf ≥ 65, tradeable) vs BASELINE (35–64, INFO_ONLY under SIGNAL_HYGIENE_V2). `HC_EMISSION_FLOOR = 65`.
- **Gates/vetoes:** RECOVERY_VETO, CHASE_VETO, ANTI-FLIP (45 min post-stop), P25 evidence, premiumTrusted (complete non-stale Kite chain), VIX-spike/circuit-breaker suppression, daily 2.5% / weekly 5% DD latches.
- **Paper execution:** `isPaperAutoTradingEnabled()` gates writes; dev read-only, prod enabled; opens are single-transaction with cap checks.

### 10b. Why "0 setups across 0 indices" — enumerated, with TODAY's actual cause flagged

| Cause | Triggers 0 setups when… | Today 2026-06-23? |
|---|---|---|
| **Market closed** | weekend/holiday/outside 09:15–15:30 | ✅ true NOW (16:26, post-close) |
| **Kite session offline** | no live intraday → `no_live_kite_intraday` | ✅ **TRUE 06:00–15:21 (root cause)** |
| Pull-based engine idle | nobody requests `/options/signals` | ✅ contributed (only 3 logs all day, @09:15) |
| Option chain unavailable | `fetchOptionChain` null/empty | followed from Kite offline |
| Warm-up incomplete | <2 bars / <50 daily for EMA50 | n/a (no feed) |
| All candidates below floor | confluence < 65 | n/a (none generated) |
| VIX-spike / circuit breaker | global suppression | not reached |

### 10c. Per-index table — TODAY (2026-06-23)

| Index | Live Kite data? | Candidate generated? | Decision logged | Reason | Setup emitted? |
|---|---|---|---|---|---|
| NIFTY | ❌ (offline till 15:21) | ❌ | PRE_EMISSION_REJECTED @09:15 | `no_live_kite_intraday` | No |
| BANKNIFTY | ❌ | ❌ | PRE_EMISSION_REJECTED @09:15 | `no_live_kite_intraday` | No |
| SENSEX | ❌ | ❌ | PRE_EMISSION_REJECTED @09:15 | `no_live_kite_intraday` | No |

`paper_daily_summary_fo` 06-23: **signals 0 / valid 0 / opened 0 / skipped 0** — consistent: the engine never had data to evaluate.

### 10d. But even on days WITH data, 0 trades open
- 06-22: 5 signals, 3 valid candidates, **0 opened**, 3 skipped.
- 06-19: 4 signals, 7 candidates, **0 opened**, 7 skipped.
- Last actual F&O paper open: **2026-06-15** (8 days ago).

This is a **secondary finding worth a focused look (separate from Kite):** when candidates do exist, the gate stack (premiumTrusted / DD latch / heat / baseline guardrails / time cutoffs) is rejecting 100% of them. That may be correct risk discipline, *or* the gates may be over-tight. The skip-reason breakdown (`/api/paper/diagnostics/untriggered/fo` and `paper_daily_summary_fo.skipped_by_reason`) should be reviewed before any tuning. **No change made.**

### 10e. Verdict
The "0 setups" is **not a logic bug** — it is (1) market closed now and (2) Kite offline the whole session today. The engine behaved honestly. The real fixes are operational (daily Kite login + loud banner, §8) plus a review of why valid candidates never convert to opens (§10d).

---

## 11. BACKTEST LAB — AUDIT

| Aspect | Finding | Honest label present? |
|---|---|---|
| Candle source | Real 15-min SPOT candles from `tools/fno-backtester/data/*.csv`; fingerprinted for cache invalidation | ✅ |
| **Option premium** | **SYNTHETIC** — fixed **ATM delta ≈ 0.5 proxy** on the real spot move; no historical premiums, no theta/IV term structure | ✅ "Option P&L uses a labeled ATM delta proxy (|Δ|≈0.5) … no historical option premiums exist" |
| Charges/slippage | `gross − (charges + slippagePoints·ATM_DELTA·qty·2)` | ✅ |
| Signal source | Re-runs live strategy logic over historical spot (`directional.ts`/`replay.ts`/registry) | ✅ |
| Export | `csvExport.ts` includes `dataBlockedCount`, `riskBlockedCount` (trades not taken) | ✅ |
| Live state | 6 runs, all COMPLETE, last 06-22 | ✅ |

**Verdict:** Directionally useful and **honestly labelled**, but absolute ₹ P&L is an approximation (linear delta, volatility-blind). Treat as a strategy-structure study, not a broker-accurate simulator. (Matches the prior "Backtest Lab synthetic premium" note — a candidate for a real-premium upgrade later, not part of this audit's fixes.)

---

## 12. OPTION CHAIN / OI LAB — AUDIT

- **Single source of truth:** central `optionChainProvider.ts`. DISPLAY mode = Kite→NSE fallback; TRADE_GRADE mode = Kite-only (used by signals/backtest).
- **Consistency:** PCR, total OI, Max Pain, OI clusters all computed from the **same snapshot** in a single request (`optionAnalytics.ts`). GEX from `gex.ts` (Gamma·Qty·Spot²·0.01). IV rank/percentile from `iv_history`. ATM basis selectable (spot / future / synthetic-future via put-call parity).
- **Labels:** `KITE LIVE` vs `NSE FALLBACK / DISPLAY ONLY`; `MODELLED GEX`, `MODELLED GREEKS`, `Synthetic Future (Modelled)`; `STALE` and `PARTIAL OI` badges; 503 with explicit reason if both sources fail.
- **Live state:** snapshots fresh (all 3 underlyings @15:30). IV history current for main indices.

**Verdict:** ✅ Solid and honest. Modelled values (Greeks/GEX/synthetic future) are clearly distinguished from exchange data. No fabrication. Only nit: GEX/Greeks accuracy is bounded by the Black-Scholes assumptions (expected and labelled).

---

## 13. PORTFOLIO ANALYSER — RE-VERIFICATION

Re-checked specifically for valuation honesty and edge cases:

| Check | Result |
|---|---|
| Fabricated CMP / `?? 0`? | ❌ none — null when unavailable, UI shows "n/a"/"-" |
| Manual CMP overriding live? | ❌ `applyManualCmp` only fills when live CMP is null; forces `previousClose=null` so no fake day-P&L |
| BSE-only / renamed / ETF symbols | ✅ resolver handles NSE+BSE, alias map (e.g. AMARAJABAT→ARE&M), ETF whitelist, BSE scrip codes |
| Unpriced holdings | ✅ counted as `missingCount` / `investedNotEnriched`, summed only over available |
| XIRR | ✅ Newton-Raphson + bisection fallback; returns null if no convergence/dates |
| Benchmark | ✅ real NIFTY series windowed to first covered candle; "unavailable" when absent; sector over/under-weight honestly not fabricated |
| Diagnostics | `/api/portfolio/resolve-debug` available |

**Verdict:** ✅ Clean. Confirms the earlier "Portfolio never fabricates" memory. No issues found.

---

## 14. DATA BACKBONE — STATUS

- **Trusted layer (`marketData/`):** import guard active; allowlist down to **12 files** (from 34 at foundation) — burn-down progressing. `DataMeta` carries source/trustTier/asOf/isStale/notForSignals/notForTradeDecisions/validationStatus. Write-guard prevents lower-trust rows overwriting Kite rows (provenance priority).
- **Yahoo fencing:** ✅ Yahoo (`secondary_analytics`) can **never** be `TradeableBrand`; only fresh Kite (`authoritative`) is tradeable. Hard-stale rejected.
- **INDstocks:** disabled (scaffold), failover loud-labelled but signal-block deferred.
- 🔴 **Candle warehouse:** `candle` = **0 rows**; daily tick fails on `ANY(($2,$3,$4)::bigint[])`; sync writes 0. No user feature reads it yet, so **no user-visible impact**, but it's dead infra + constant log noise. (Matches "drizzle-kit push drops out-of-schema tables" caution — fix the query and backfill with `ALTER`-safe ops, don't push.)
- 🔴 **Yahoo lanes:** failing wholesale right now (see §2) — the fallback safety net is effectively gone while Kite is the only working source.
- ⚫ **TradingView:** dormant since 2026-04-24.
- 🟡 **NSE bhavcopy:** blocked from prod cloud IP (dev still loads 06-22).

---

## 15. AUTH / INFRA

- HMAC-SHA256 HttpOnly session cookies, role-based gates, public read-only mode, `/legal/*` login bypass — all present and functioning.
- DB: `pg.Pool` (max 10, keepAlive, 30s idle, 10s connect timeout); staggered boot scheduler to avoid connection storms.
- Instrument master warm-start: 6h disk cache with exponential backoff on fetch failure.
- Diagnostics: `/api/data/diagnostics`, `/symbol/:s`, `/portfolio-resolution`, `/data/compare`, `/system/status` (owner-gated).
- Owner-only Infra-Health dashboard at `/infra-health` consolidates security/sector/warehouse/option-snapshot/equity-risk.

**Verdict:** ✅ Healthy. (Reminder from prior memory: owner-only READ surfaces exposing secrets/token metadata must use `requireOwnerStrict`, not `requireOwner` — worth a spot-check during any future auth change, not part of this audit.)

---

## 16. UI/UX / NAVIGATION

- Dev browser console: clean (only Vite HMR messages). No frontend JS errors observed.
- All 4 workflows running (api-server, scanner, global, mockup-sandbox).
- **Main UX gap:** the app is *honest* about degraded data (sparse panels, "n/a", delayed badges) but there is **no single, loud, global banner** that says "Kite is logged out / live data degraded." So on a day like today, a user sees many half-empty panels and "0 setups" and reasonably concludes "the site is broken," when the real message should be "reconnect Kite." Per-page banners exist (KiteOfflineBanner on Scanner/Detail/Deep Scan) but not a persistent global one tied to session expiry.
- **Stale-but-real reads as broken:** TradingView "2 months ago" and stale global tiles look like bugs because they aren't age-labelled prominently.

**Recommendation (not implemented):** one global status strip driven by `/api/kite/status` + data-diagnostics: "Kite: OFFLINE since 06:00 — Reconnect" and age badges on any panel older than its budget.

---

## 17. PRIORITISED REMEDIATION (awaiting your approval — nothing changed yet)

### Fix first (operational / highest user impact)
1. **Daily Kite login + loud pre-open alert** (§0/§8). Removes the #1 cause of dead trading days. *Operational + small code.*
2. **Global "Kite offline / data degraded" banner** (§16). Turns confusing "0 setups / empty panels" into a clear "reconnect" prompt. *Frontend.*
3. **Candle-warehouse daily-tick SQL fix** (`= ANY($1::bigint[])`) + backfill (§4/§14). Stops 5-minute error spam; makes the warehouse real. *Small, contained.*

### Should fix (correctness / coverage)
4. **Yahoo fallback resilience** (§4/§14) — accept it's flaky; ensure UI degradation is explicit; evaluate a second delayed source.
5. **Review F&O "valid candidates → 0 opens for 8 days"** (§10d) via skip-reason diagnostics before any gate tuning.
6. **Full-scan timeout** (§4) — raise/parallelise budget or label the 198-row cached fallback.
7. **Swing per-run errors + 06-19 failure** (§9) — add retry/visibility.
8. **TradingView alerts** (§4) — re-wire or hide/age-label.
9. **Clean 3 single-share test positions** from the equity paper open book (§6).

### Can wait
10. NSE bhavcopy prod fallback (§4). 11. BANKEX/NIFTYNXT50 IV staleness (§5). 12. Backtest real-premium upgrade (§11). 13. Volume-profile bin granularity (§9).

### Don't touch (intentional / correct)
- Yahoo never tradeable; F&O Yahoo prohibition; FINNIFTY/MIDCPNIFTY exclusion; INDstocks disabled; "no fabrication" omit-or-label policy; portfolio advisory-field non-persistence; combo lane isolation. **These are correct — leave as-is.**

---

## APPENDIX — RAW EVIDENCE (read-only)

**Production now:** 2026-06-23 16:26 IST (Tue, post-close).
**Kite:** user "Devendra Ramkishan Sharma", login 15:21, expires 06-24 06:00, valid=true.
**candle:** `count = 0`.
**Today's F&O reasoning (all 3):** `PRE_EMISSION_REJECTED · OTHER · "no_live_kite_intraday (Kite session expired / throttled / index uncovered)"` @ 09:15.
**paper_daily_summary_fo:** 06-23 [0/0/0/0] · 06-22 [5 sig/3 valid/0 open/3 skip] · 06-19 [4/7/0/7].
**paper_trade_fo (last opens):** all CLOSED, newest opened 06-15 (BANKNIFTY VWAP_RECLAIM, STOPPED −20,113).
**Equity OPEN book:** BERGEPAINT(505), COALINDIA(156), FORTIS(141), GLAND(49), INDIGO(25), LT(27), PHOENIXLTD(60) [real sizing]; MOTHERSON(1), GMRINFRA(1), OBEROIRLTY(1) [single-share = likely tests].
**tv_alerts:** 4 rows, 2026-04-23 → 2026-04-24.
**option_chain_snapshot:** NIFTY/BANKNIFTY/SENSEX all 06-23 15:30, ~78–80k rows each.
**swing_scan_run:** 06-23 476/24; 06-22 450/50; 06-19 0/500; 06-15 443/57.
**global_sync_logs (Yahoo):** equity 206/206 failed, yahoo 30/30, index 30/30, fx 35/35; binance ok.
**candle_sync_run:** INCREMENTAL 15minute last 06-23 13:19 (rows 0); day last 06-22 18:36 (rows 0).
**Recurring prod log errors:** candle-warehouse daily tick (`ANY(($2,$3,$4)::bigint[])`); NSE bhavcopy fail 7d; scanAll hard-timeout → 198; Kite getQuote ECONNRESET; Yahoo chart fail (LTIM.NS).

*End of report. No code, data, UI, or configuration was modified during this audit.*
