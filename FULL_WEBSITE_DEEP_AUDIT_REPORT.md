# FULL WEBSITE DEEP AUDIT REPORT

**Project:** Indian Stock Market Scanner — `marketscannerbydev.in`  
**Monorepo:** pnpm (`api-server` + `scanner` + `global` + `mockup-sandbox`)  
**Audit date:** 2026-07-01 (updated from prior 2026-06-23 audit)  
**Audit type:** READ-ONLY. No code changed, no fixes applied.  
**Method:** (a) Full codebase exploration via 10 parallel subagents across all pages, APIs, formulas, schedulers; (b) all 7 LLM index files read in full; (c) prior 2026-06-23 live-production audit findings preserved and updated.

> **What's new in this revision:** Daily Analysis module shipped + production-verified; F&O Risk Guard Pack G1-G4 added (shadow mode); trusted-layer foundation Phase 1 complete; pre/post builder fully upgraded. All prior findings re-evaluated.

---

## 0. THE SINGLE MOST IMPORTANT OPERATIONAL FINDING (preserved from 2026-06-23 audit)

**The Kite (Zerodha) session expires every day at 06:00 IST and there is NO automated daily re-login.** On 2026-06-23, the token was not renewed until 15:21 — after market close — causing the entire trading session to run blind.

Hard evidence from production (2026-06-23):

| Evidence | Value |
|---|---|
| `kite_session.login_time` | **15:21 IST** (market closed at 15:30) |
| F&O reasoning @09:15 (all 3 indices) | `PRE_EMISSION_REJECTED · no_live_kite_intraday` |
| `paper_daily_summary_fo` 06-23 | signals 0, candidates 0, trades opened 0 |
| `candle` table | **0 rows** (daily tick failing — malformed SQL) |
| Yahoo fallback | **wholesale failure** (equity 206/206, index 30/30, fx 35/35) |

**This is the actual reason F&O showed "0 setups."** The signal engine behaved correctly (honestly refused to emit without authoritative data). The operational gap is that nobody/no cron logged Kite in before the open.

**Fix direction (not implemented):** Add a pre-open alert at 08:45 IST: "Kite is logged out — reconnect before open." Details in §8.

---

## 1. EXECUTIVE SUMMARY — AREA STATUS TABLE

Status: ✅ Working · 🟡 Working-but-limited · 🔴 Broken/failing · ⚫ Hidden/stale/unused  
Severity: Critical / High / Medium / Low

| # | Area | Status | Severity | Production-usable? | Main issue |
|---|---|---|---|---|---|
| A | Home / Dashboard | 🟡 | Medium | Yes | Sparse when Kite offline or Yahoo down; per-panel honesty good |
| B | Pre-Market Analyser | 🟡 | Medium | Yes | GIFT Nifty / India VIX / Expected Range not integrated |
| C | Daily Analysis (new) | ✅ | Low | Yes | Module fully shipped; 8 of 22 sections SOURCE_NOT_INTEGRATED |
| D | Scanner | 🟡 | Medium | Yes | Full scan hard-timeouts → 198-row cache; delivery % unlabeled as T-1 |
| E | Deep Scan + Stock Detail | ✅ | Low | Yes | Honest; no fabrication |
| F | Option Chain / OI Lab | ✅ | Low | Yes | Kite→NSE fallback, all modelled values labeled |
| G | Option Strategies | ✅ | Low | Yes | Assumptions card explicit; no slippage in builder |
| H | F&O Signal Engine | 🟡 | High | Yes (needs Kite) | G1-G4 guards in shadow mode; reactive (pull-based) execution |
| I | F&O Diagnostics | ✅ | Low | Yes | Ephemeral reasons lost on restart |
| J | Swing Cash Queue | 🟡 | High | Yes | No background TTL sweep; approval is dry-run only |
| K | Stocks to Watch (Swing v3) | 🟡 | Medium | Yes | 24–50 symbol errors/run; 2026-06-19 total failure |
| L | Institutional Flows | ✅ | Low | Yes | T-1 NSE delay not labeled inline |
| M | Sectors / Sector Detail | ✅ | Low | Yes | Mapping as-of 2026-06-03; coverage % shown |
| N | Portfolio Analyser | ✅ | Medium | Yes | No corporate action adjustment; correlation not wired |
| O | Watchlist | ✅ | Low | Yes | Clean |
| P | Charting | ✅ | Low | Yes | ATR divergence vs scanner; CVD is proxy |
| Q | Paper Trading | 🟡 | High | Yes | G1-G4 shadow only; reactive tick; combo not in heat budget |
| R | Paper Reports | 🟡 | Medium | Yes | Intraday tab placeholder; MANUAL_OVERRIDE in blended WR |
| S | Backtest Lab | 🟡 | Medium | Yes | Synthetic ATM delta-0.5 premium proxy; no holiday list |
| T | Infra Health | ✅ | Low | Yes | Read-only; no fix triggers |
| U | Data Backbone — candle warehouse | 🔴 | Medium | Unused | 0 rows; daily tick fails (malformed SQL) |
| U | Data Backbone — Yahoo fallback | 🔴 | High | Degraded | Wholesale failure on prod cloud IP |
| U | Data Backbone — TradingView alerts | ⚫ | Medium | No | 4 rows, newest 2026-04-24 (~2 months stale) |
| V | Auth / Session | 🟡 | High | Yes | No login rate-limit; no 2FA for owner; no auto-login cron |
| W | Admin | 🟡 | Medium | Yes | No payment gateway; no subscription expiry enforcement |
| X | Global Multi-Asset Scanner | 🟡 | Low | Degraded | Yahoo-only; Yahoo wholesale failing on prod |

---

## 2. LIVE PRODUCTION STATE SNAPSHOT (2026-06-23 ~16:26 IST — preserved)

| Subsystem | Live state | Verdict |
|---|---|---|
| Kite session | Valid (login 15:21); was offline 06:00→15:21 | 🔴 operational |
| `candle` warehouse | **0 rows.** Daily tick errors every ~5 min | 🔴 |
| `option_chain_snapshot` | Fresh: NIFTY/BANKNIFTY/SENSEX @15:30 (~78–80k rows each) | ✅ |
| `swing_scan_result` | 476 rows for 06-23 (24 errors); 06-19: total failure (0/500) | 🟡 |
| `tv_alerts` | 4 rows total; **newest 2026-04-24** | ⚫ stale |
| `paper_account` | FNO ₹10,06,361 free; EQ ₹2,05,098 free | ✅ |
| `paper_trade_fo` | 28 CLOSED, 0 OPEN, **last open 2026-06-15** | 🟡 |
| `paper_trade_eq` | 20 CLOSED + 10 OPEN (3 single-share test positions) | 🟡 |
| `paper_trade_combo` | empty (unused) | ⚫ |
| `fno_signal_reasoning` (06-23) | 3 rows, all `PRE_EMISSION_REJECTED / no_live_kite_intraday` | 🔴 root cause |
| `paper_daily_summary_fo` | 06-23: 0/0/0 · 06-22: 5 sig/3 valid/0 opened · last open 06-15 | 🟡 |
| `global_sync_logs` | **yahoo-equity 206/206 failed, yahoo 30/30, yahoo-fx 35/35 failed** | 🔴 |
| `daily_report_runs` | Added post-06-23; PREPOST bot confirmed sending both reports | ✅ |

Recurring production log warnings (every few minutes, as of 06-23):
- `candle-warehouse: daily tick failed … ANY(($2,$3,$4)::bigint[]) … params: day,256265,260105,265` (malformed array cast)
- `NSE bhavcopy fetch failed for last 7 trading days` (NSE blocking cloud IPs)
- `scanAll hard-timeout reached, returning partial/cached … returned=198`
- `Yahoo chart failed … No data found, symbol may be delisted … LTIM.NS`

---

## 3. PER-MODULE AUDIT

---

### 3A. Home / Market Pulse (`/` — `pages/dashboard.tsx`)

**Purpose:** Central live market overview — daily nerve centre.

**APIs:**
- `useListStocks` — NIFTY universe movers
- `useGetTopScans` — top bullish/bearish setups
- `useListSectors` — sector heatmap
- `useGetMarketTrend` — auto-generated narrative
- `useGetHomeEnrichment` — composite bias, fact-packs
- `useGetIndicesBoard` — NIFTY/SENSEX/BankNifty fact-packs
- `useGetGlobalIndices` — GIFT Nifty, Dow, S&P, Brent, Gold
- `useGetMarketMacroHistory` — macro trend
- `useGetFiiDii` — FII/DII net flows (T-1)

**DB tables:** None (stateless aggregation)

**Data sources:**
- Kite: Live index OHLCV, EMA stacks, VWAP, scanner signals — TRADE_GRADE
- Yahoo: Global indices, commodities, FX — INFO_ONLY / DELAYED (labeled)
- NSE archive: FII/DII cash flows — INFO_ONLY (T-1)
- Computed: Market narrative, bias score — SYNTHETIC / COMPUTED (labeled)

**Sections:**
- `GlobalCuesStrip` — GIFT Nifty, Dow, S&P, Brent, Gold, DXY
- `SentimentBar` — India VIX, FII/DII net flows, expiry countdown
- `SectoralHeatmap` — avg change, gainer/loser count per sector
- `BreadthBar` — Advance/Decline ratio
- `IndexTabs` + `IndicesBoard` — OHLC, EMAs, Pivots, Market Profile per index
- `MarketMoodGauge` + `MarketTake` — auto-generated narrative (trend + PCR + RSI)
- Top Gainers / Losers + Top Bullish/Bearish Setups

**Strengths:**
- 52-week proximity chip (within 1% of highs/lows) is practically useful
- `MarketTake` auto-narrative is a genuine differentiator
- Source honesty: Yahoo labeled, Kite labeled, computed labeled
- Empty states shown correctly when Kite offline

**Gaps:**
- Global cues strip uses Yahoo (delayed ~15min) — no per-chip as-of timestamp
- Market breadth (Advance/Decline) source unlabeled — unclear if Kite or Yahoo
- No global "Kite offline" sticky banner — users see many half-empty panels and assume the site is broken
- `MarketTake` narrative heuristics not explained to the user

**Risk:** LOW — honesty is good; gaps are cosmetic/labeling  
**Priority:** MEDIUM

---

### 3B. Pre-Market Analyser (`/premarket` — `pages/premarket.tsx`)

**Purpose:** Deep-dive diagnostic for planning the trading day — composite bias, OI positioning, macro overlay, trade setups.

**APIs:**
- `useGetPreMarket` → `/api/pre-market`

**Data sources:**
- Kite: Index OHLCV, option chain OI — TRADE_GRADE
- NSE archive: Participant-wise OI — INFO_ONLY
- Yahoo: Global macro (USD/INR, Brent, DXY) — INFO_ONLY / DELAYED
- Computed: Composite bias score (-10 to +10) — SYNTHETIC

**Key sections:**
- Composite Bias Hero (FII long-share %, OI buildup 2x2 matrix)
- Participant-wise OI (FII/DII/Pro/Client, FII LSR %)
- Index OI Buildup (Long Buildup / Short Covering / Short Buildup / Long Unwinding)
- Strike-level OI (top Call/Put writing strikes → resistance/support floors)
- Macro Overlay (USD/INR, Brent, DXY)
- Sector Rotation + Trade Setups

**Strengths:**
- Data completeness tracker with honest source tagging
- Off-market-hours "No live feed" safety guards
- FII LSR % is a professional-grade pre-trade indicator

**Gaps:**
- **GIFT Nifty / SGX Nifty: `SOURCE_NOT_INTEGRATED`** — the #1 pre-market cue traders look for; unavailable
- **India VIX: `SOURCE_NOT_INTEGRATED`** — ATM IV from Kite option chain is available; should be surfaced as a proxy
- Expected Range (VIX-implied / ATM straddle): `AVAILABLE` in coverage matrix but not prominently displayed
- CPR / Pivot Levels: computed and `AVAILABLE` but buried
- News/Events calendar: `SOURCE_NOT_INTEGRATED`

**Risk:** LOW (honesty excellent)  
**Priority:** HIGH — GIFT Nifty and India VIX are the two highest-impact gaps

---

### 3C. Daily Analysis (`/daily-analysis` — `pages/daily-analysis.tsx`)

**Status:** FULLY SHIPPED and production-verified as of 2026-07-01.

**Purpose:** Pre/post market Telegram report management — 4-tab owner-only dashboard.

**APIs (all OWNER):**
- `GET /api/daily-analysis/status`
- `GET /api/daily-analysis/pre-market/latest`
- `GET /api/daily-analysis/post-market/latest`
- `GET /api/daily-analysis/history`
- `POST /api/daily-analysis/generate-pre-market`
- `POST /api/daily-analysis/generate-post-market`

**DB tables:** `daily_report_runs` (raw `CREATE TABLE IF NOT EXISTS` — NOT in Drizzle schema)

**Data sources:**
- Kite: Session status, F&O readiness — TRADE_GRADE
- NSE archive: FII/DII cash — INFO_ONLY
- DB: Paper trade counts — AVAILABLE
- Computed: Bias/setup preliminary — INFO_ONLY

**Coverage matrix (22 sections):**

| Section | Pre-Market | Post-Market | Status |
|---|---|---|---|
| Overnight Global Cues | ✅ | — | SOURCE_NOT_INTEGRATED (Yahoo failing) |
| GIFT Nifty / SGX | ✅ | — | SOURCE_NOT_INTEGRATED |
| FII / DII Activity | ✅ | — | INFO_ONLY (cash from NSE site, T-1) |
| India VIX | ✅ | — | SOURCE_NOT_INTEGRATED |
| Key Levels / CPR | ✅ | — | AVAILABLE (computed) |
| Option Chain | ✅ | ✅ | AVAILABLE (Kite) |
| Expected Range | ✅ | — | AVAILABLE (ATM straddle) |
| News & Events | ✅ | ✅ | SOURCE_NOT_INTEGRATED |
| Expiry / Rollover | ✅ | — | AVAILABLE (computed) |
| Bias & Trade Plan | ✅ | — | AVAILABLE (signal engine) |
| Index Performance | — | ✅ | AVAILABLE (Kite EOD) |
| Market Breadth | — | ✅ | INFO_ONLY |
| Participant OI Change | — | ✅ | AVAILABLE (NSE) |
| Option Chain EOD | — | ✅ | AVAILABLE (snapshot) |
| Level Validation | — | ✅ | SOURCE_NOT_INTEGRATED |
| Sector Moves | — | ✅ | AVAILABLE (sector scanner) |
| News Recap | — | ✅ | SOURCE_NOT_INTEGRATED |
| Global Status Check | — | ✅ | SOURCE_NOT_INTEGRATED |
| Trade Journal Tie-in | — | ✅ | AVAILABLE (paper trades DB) |
| Tomorrow Setup | — | ✅ | AVAILABLE (swing scan) |

**Strengths:**
- DB-backed multi-worker dedup (`INSERT … ON CONFLICT DO NOTHING` on `report_type + ist_date`)
- PREPOST bot isolated from urgent/F&O bot — no cross-contamination
- All 22 sections emit honest "Unavailable — data source not integrated yet" where not available
- Rate-limiting (30s) on manual send; `brokerExecution: DISABLED` enforced
- 107 unit tests + 21 contract tests

**Gaps:**
- `daily_report_runs` is raw SQL only — **NOT in Drizzle schema** → permanent schema drift risk
- History tab shows empty for manual sends (manual sends bypass `tryClaimScheduledReport()`) — confusing UX
- 8+ sections remain `SOURCE_NOT_INTEGRATED` — report value limited until integrated

**Risk:** LOW  
**Priority:** MEDIUM — schema formalization should be done; data coverage expands over time

---

### 3D. Scanner (`/scanner` — `pages/scanner.tsx`)

**Purpose:** NIFTY 500 universe scanner with signals, indicators, and setup detection.

**APIs:**
- `/api/scan/full-nse?limit=5000&sortBy=changePct&order=desc`
- `/api/scan/full-nse/status`
- `useListStocks` (F&O-curated subset)

**Formula coverage:**

| Indicator | Method | Status |
|---|---|---|
| RSI | Wilder smoothing (14-period) | ✅ Standard |
| EMA | SMA-seeded (20/50/100/200) | ✅ Standard |
| ATR | **EMA-smoothed** | ⚠️ Diverges from chart (see §3P) |
| VWAP | Cumulative from session open | ✅ Correct |
| Volume ratio | Vol vs avg | ✅ Standard |
| Delivery % | NSE bhavcopy (T-1) | ⚠️ Not labeled as T-1 inline |
| Signal score | Weighted multi-indicator (0-100) | ✅ |
| FUT OI buildup | LTP Δ + OI Δ quadrant | ✅ Uses prior-day OI |

**Columns:** Symbol, CMP, CHG, %CHG, Open, High, Low, PrevClose, VWAP, EMA20/50/100/200, RSI, Vol×, DEL%, FUT OI buildup, Score, Signal

**Presets:** `rsiOversold`, `volSpike`, `near52wHigh`, `goldenCross`

**Strengths:**
- `scannerProvenance.ts` stamps each row with true signal source — Yahoo LTP tick cannot promote Yahoo signal to Kite-authoritative
- `KiteOfflineBanner` when Kite session expires
- `RowSourceFlag` shows "Yahoo ~15m" or "Yahoo · stale" per row

**Gaps:**
- **Scan timeouts to 198-row cache** (from 4298-instrument full scan) — cached fallback not clearly labeled in UI
- No per-row "as-of" timestamp
- Delivery % from NSE bhavcopy (T-1) — not labeled as "T-1" in the column header
- FUT OI buildup uses prior-day OI change — not real-time intraday
- No "last scan at HH:mm IST" wall-clock on table header

**Risk:** MEDIUM  
**Priority:** MEDIUM

---

### 3E. Deep Scan + Stock Detail (`/deep-scan`, `/stocks/:symbol`)

**APIs:**
- `/api/deepscan/lookup?q={query}`
- `/api/deepscan/snapshot/{symbol}?range={range}&kind={kind}`
- `useGetStockDetail(symbol)`
- `useGetStockHistory(symbol, { range })`
- `useGetNews({ symbol })`

**Strengths:**
- `deepscan.honesty.test.ts` (CRITICAL test) enforces no synthetic fallback — verified
- Multi-timeframe chart: 1D, 1W, 1M, 3M, 6M, 1Y, 3Y, 5Y
- "Why this signal" list with weights — genuine signal transparency
- Conflicting evidence box + Invalidation triggers
- EntryPlanCard: GOOD/FAIR/POOR entry quality gate (POOR demotes STRONG_BUY→BUY)
- Horizon Bias breakdown (Intraday / Swing / Long-term)

**Gaps:**
- No "as-of" timestamp on candle data
- Fundamentals from Yahoo not always visually separated from Kite data
- Trendlyne widget is external embed — no data control, no source label

**Risk:** LOW  
**Priority:** LOW

---

### 3F. Option Chain + OI Lab (`/option-chain`, `/oi-lab`)

**APIs:**
- `GET /api/option-chain/:underlying` (Kite live)
- `GET /api/option-chain/:underlying/oi-buildup`
- `GET /api/oi-lab/:underlying`
- `GET /api/option-snapshots/analytics` (OWNER)

**DB tables:** `option_chain_snapshot`, `option_signals`, `iv_history`

**Formula audit:**

| Formula | Correctness | Notes |
|---|---|---|
| PCR | ✅ Sum(Put OI) / Sum(Call OI) | Standard |
| Max Pain | ✅ Σ\|S−K\|×OI per side, minimized | Standard |
| GEX (Gamma Exposure) | ✅ labeled MODELLED | Proxy, not true dealer positioning |
| OI Buildup | ✅ LTP Δ + OI Δ quadrant | Standard |
| Black-Scholes Greeks | ✅ European model | Correct for Indian index options |
| IV Rank / IVP | ✅ from `iv_history` | Main indices current |

**Strengths:**
- `KITE LIVE` vs `NSE FALLBACK / DISPLAY ONLY` badge
- `MODELLED GEX`, `MODELLED GREEKS`, `Synthetic Future (Modelled)` all clearly distinguished
- `STALE` and `PARTIAL OI` badges
- ATM IV from real option chain; IV Rank/IVP from `iv_history`
- Adaptive refetch: 15s market-open, 60s market-closed

**Gaps:**
- NSE fallback may fail on prod cloud IP (NSE rejects non-Indian cloud IPs) — silent failure possible
- No per-strike freshness indicator (last-updated-at)
- Greeks (Delta/Gamma/Vega/Theta) not shown on the main chain table — only ATM IV available
- GEX labeled MODELLED but label is not prominent enough for casual users

**Risk:** LOW  
**Priority:** MEDIUM (NSE cloud-IP risk)

---

### 3G. Option Strategies (`/strategies`, `/strategies/builder`)

**APIs:**
- `GET /api/options/strategies/:underlying` (regime-ranked 13-strategy bundle)
- `POST /api/options/strategies/:underlying/custom` (custom payoff, debounced 300ms)

**Formula audit:**
- Payoff: `Σ sign·(last−entry)·qty` — ✅ correct
- Black-Scholes: European model — ✅ correct for Indian index options
- Monte Carlo (PoP): ✅ estimate; labeled
- Net Greeks: ✅ aggregated correctly
- Defined-risk enforcement: `snapshot.maxLoss == null → UNDEFINED_RISK 400` — ✅

**Strengths:**
- 13 regime-ranked strategies (Iron Condor, straddles, spreads, etc.)
- "What-if" scenario sliders (Spot ±20%, IV ±50%, days passed)
- `StrategyAssumptionsCard` explicitly documents all assumptions
- "Send to Combo Paper Trade" gated to owner + defined-risk-only
- Zero math duplication (all math in `lib/optionStrategies.ts`)

**Gaps:**
- No slippage modeling in payoff calculation (documented in Assumptions card)
- No brokerage/STT/taxes in builder payoff — Mode D backtest has costs but builder does not
- Live bias can source from Yahoo in some cases — should be explicitly labeled when Yahoo-sourced
- Risk-free rate for Black-Scholes hardcoded at 6.5% — not dynamic

**Risk:** LOW  
**Priority:** MEDIUM

---

### 3H. F&O Signal Engine & Cockpit (`/options`)

**Purpose:** Live F&O signals for NIFTY / BANKNIFTY / SENSEX — HIGH_CONVICTION and BASELINE tiers.

**APIs:**
- `useGetOptionSignals`, `useGetOptionSignalHistory`
- `useGetOptionSignalReport`, `useGetOptionSignalReportDates`
- `/api/fno/no-signal-gap`

**DB tables:** `option_signals`, `paper_trade_fo`, `fno_signal_reasoning`, `iv_history`

**Architecture:**
- **Execution:** Pull-based — only evaluates when `/options/signals` is requested (no always-on tick loop)
- **Universe:** NIFTY (weekly Tue) / BANKNIFTY (monthly) / SENSEX (weekly Tue) — 3 indices only
- **Tier:** HIGH_CONVICTION (conf ≥ 65) vs BASELINE (conf 35–64 / INFO_ONLY)
- **Emission:** P3 confluence engine (replaces legacy per-detector confidence)
- **Kite dependency:** Hard requirement — Yahoo prohibited for F&O emission

**Gate stack (all active):**

| Gate | Effect |
|---|---|
| F&O liquidity (LTP≥20, spread≤1.5%, OI≥50k) | Reject open; fail-OPEN |
| Portfolio heat cap (6% FNO/EQ) | Reject open; FAIL-CLOSED |
| DD caps (daily 2.5%, weekly 5%) | Block opens; sticky latches |
| 15:20 IST force-exit | Close all open FNO |
| Vol-clamped stop | Reject or demote |
| HTF daily-EMA50 | Demote HC→BASELINE |
| True 1h HTF (EMA9/21) | Demote HC→BASELINE |
| Time-of-day (09:15-09:30, 15:15-15:30) | Demote HC→BASELINE |
| Expiry-day | Demote HC→BASELINE |
| Sector RS | Demote HC→BASELINE |
| 30-day win-rate | Demote HC→BASELINE |
| ATM-OI confluence | Mutate tier post-emission |
| **G1-G4 risk guards (shadow mode)** | **Log only — not yet blocking** |

**Risk guards G1-G4 (shadow mode — NOT blocking):**
- G1: NEAR_EXPIRY_THETA_RISK (DTE ≤ 5 AND premium < threshold)
- G2: LOW_ENTRY_PREMIUM (NIFTY ₹250 / BANKNIFTY ₹500 / SENSEX ₹250)
- G3: SAME_STRIKE_DIRECTION_STOP_COOLDOWN (90 min after STOP)
- G4: SENSEX_DISABLED_BY_REPLAY_DIAGNOSTICS (0% STOP WR, −₹45,908 net)

**Strengths:**
- P3 confluence engine is sophisticated and well-tested
- "Why this setup" breakdown visible in signal card
- 27 tests for risk guards

**Gaps:**
- **G1-G4 risk guards in shadow mode** — simulation endpoint exists; acceptance threshold should be checked and guards promoted to `paper_block` mode
- **Reactive execution** — stop/target detection lags until `/options/signals` is polled; if frontend is inactive and no TradingView alert fires, a missed stop is possible
- `FoWhyThisTrade.tsx` shows "reasoning not available" — `fno_signal_reasoning` not joinable from paper trade endpoint
- Ephemeral no-trade reasons lost on server restart

**Risk:** HIGH (operational — needs Kite live AND frontend polling)  
**Priority:** HIGH — activate G1-G4 block mode; fix reasoning join

---

### 3I. F&O Diagnostics (`/fno-diagnostics`)

**APIs (all OWNER GET):**
- `/api/fno/data-health`
- `/api/fno/diagnostics/today`
- `/api/fno/diagnostics/gate-waterfall`
- `/api/fno/diagnostics/no-trade-reasons`
- `/api/fno/diagnostics/setup-performance`
- `/api/fno/diagnostics/blocked-signals`
- `/api/fno/no-signal-gap`

**Strengths:**
- Gate waterfall shows exactly where the funnel leaks
- No-trade reason distribution (durable DB vs ephemeral process-local)
- Setup win-rate per setup key — enables data-driven tuning
- Risk guard simulation endpoint (`/api/backtest/fno/runs/:id/risk-guard-simulation`)

**Gaps:**
- Ephemeral no-trade reasons lost on restart (documented)
- Risk guard simulation only accessible on specific backtest run IDs — not a standing diagnostic

**Priority:** MEDIUM

---

### 3J. Swing Cash Queue (`/swing-cash`)

**Purpose:** Fast approval cockpit for staged swing-cash equity orders.

**APIs:**
- `GET /api/swing/status`
- `GET /api/swing/staged-orders`
- `POST /api/swing/staged-orders` + `/approve|reject|refresh|watch|expire`

**DB tables:** `swing_order_staging`

**Safety invariants (enforced):**
- `broker_order_id` always null
- `broker_status` always `BROKER_DISABLED`
- `LIVE_CASH_SWING_ORDER_ENABLED` must remain false
- Alert wording: "Risk eval: kite (as of \<time\>)" + "Note: Entry is the staged limit order price — not current market price"
- 58 tests guard wording compliance (`swingAlerts.test.ts`)
- Data-trust gate rejects stale Kite data (CRITICAL test)

**Gaps:**
- **No background TTL sweep** — staged orders only expire when the owner reads them (list/get). If the owner doesn't log in for 8+ hours, stale STAGED orders accumulate with no alert
- Approval is a dry-run only — no live broker execution path exists; the gap between "approved" and "actually in the market" is fully manual
- No mobile-optimized quick-approve view

**Risk:** HIGH (TTL gap)  
**Priority:** HIGH — add an hourly background worker to expire stale staged orders and alert the owner

---

### 3K. Stocks to Watch / Swing Scanner (`/stocks-to-watch`)

**APIs:**
- `GET /api/stocks-to-watch` (news catalyst signals)
- `GET /api/stocks-to-watch/analysis` (Pro Swing Scanner v3)

**DB tables:** `swing_scan`

**Swing scanner formula coverage:**

| Component | Method | Status |
|---|---|---|
| EMA (20/50/200) | SMA-seeded | ✅ |
| RSI | Wilder smoothing | ✅ |
| ATR | Wilder smoothing | ✅ (consistent with `lib/global/`) |
| VWAP | Cumulative from session | ✅ |
| Supertrend | ATR bands + flip logic | ✅ |
| ADX | Standard DX calculation | ✅ |
| Fixed Volume Profile | 48 bins | ⚠️ Coarse for low-priced names |
| Relative Strength | vs NIFTY benchmark | ⚠️ Goes neutral if Yahoo benchmark fails |
| Buy zone | ATR buffer from support | ✅ |
| T1 | `price + max(range·0.55, ATR·2.5)` | ✅ |
| Stop | `max(support, price − max(range·0.25, ATR·1.2))` | ✅ |

**Cadence:** Deep scan once/day after 15:35 IST (cold-start latch from `swing_scan_run`)

**Live state (2026-06-23):**
- 06-23: 476/24 errors
- 06-22: 450/50 errors
- **06-19: total failure — 0 scanned / 500 errors**
- 06-15: 443/57 errors

**Gaps:**
- 24–50 symbol errors per run (Kite throttling / Yahoo fallback failures) — no automatic retry
- 2026-06-19 total failure with no automatic recovery mechanism
- RS goes neutral silently when NIFTY benchmark fetch fails (Yahoo down)
- Score factors not explained to users in the UI

**Risk:** MEDIUM  
**Priority:** MEDIUM

---

### 3L. Institutional Flows (`/flows`)

**APIs:**
- `useGetFiiDii` → `/api/inst-flows/fii-dii`
- `useGetParticipantOi` → `/api/inst-flows/participant-oi`

**DB tables:** `inst_flows`

**Data:** NSE archive — T-1 delay (published ~18:00 IST); 45-day lookback with 5-day MA smoothing

**Gaps:**
- T-1 delay not labeled as "T-1" inline — only "Source: NSE" shown
- No real-time FII/DII data source exists publicly

**Risk:** LOW  
**Priority:** LOW

---

### 3M. Sectors & Sector Detail (`/sectors`, `/sectors/:name`)

**APIs:** `useListSectors` + `useGetSector`

**Gaps:**
- Sector mapping as-of 2026-06-03 — needs refresh when NSE publishes new industry weights
- Unmapped stocks excluded from aggregate — could underweight some sectors significantly
- No sector rotation momentum arrow (which sectors gaining vs losing day-over-day)

**Risk:** LOW  
**Priority:** LOW

---

### 3N. Portfolio Analyser (`/portfolio-analyser`)

**APIs:** `GET/PUT /api/portfolios`, `GET /api/portfolios/:id`

**DB tables:** `portfolios`, `portfolio_holdings`

**Formula audit:**

| Formula | Implementation | Status |
|---|---|---|
| Invested = Σ(Qty × Rate) | `lib/portfolio/calc.ts` | ✅ |
| Current = Σ(Qty × CMP) | Same | ✅ |
| Day Change = Σ(Qty × (CMP − PrevClose)) | Same | ✅ |
| Total Return % = (Return / Invested) × 100 | Same | ✅ |
| XIRR | Newton-Raphson + Bisection; null on no-sign-change | ✅ Edge cases handled |
| HHI (concentration) | Standard | ✅ |
| Structure Score (0-100) | DMA 40% + RSI 25% + Return Quality 20% + Concentration 15% | ✅ |
| Weighted Beta | Where beta available | ✅ |
| Manual CMP | Voids Day Change (`previousClose=null`) | ✅ No fabrication |

**Tabs/views:** KPI Strip, Holdings Table, Risk Panel (HHI + Beta), Allocation Panel, Benchmark, Cost Basis

**Strengths:**
- SEBI-neutral vocabulary: "Strong Structure / Hold with Review" — no BUY/SELL from score
- XIRR correctly returns null on no cash-flow sign change
- 395 portfolio tests (calc + score + risk + allocation)
- BSE-only / renamed / ETF symbol resolution handled

**Gaps:**
- **Correlation clustering not shown** — explicitly noted as "not wired"; no daily-return series per holding
- **No corporate action adjustment** — cost basis wrong for holdings with splits/bonuses (no warning shown)
- LTCG/STCG: 365-day boundary shown but no tax-payable calculation; "not tax advice" banner should be more explicit
- Sector benchmarking: P/E display-only (no reliable sectoral valuation benchmarks)
- Benchmark uses Yahoo for historical index returns — delayed; labeled but could be stale

**Risk:** MEDIUM (corporate action gap for long-term holders)  
**Priority:** HIGH — corporate action warning and correlation wiring are meaningful for serious users

---

### 3O. Watchlist (`/watchlist`)

**APIs:** `GET /api/personal-watchlist`, index baskets

**Strengths:** Source badge, advancers/decliners, 7 index baskets, RSI + Trend columns per symbol

**Gaps:**
- No price alert functionality per symbol
- No notes/tags on watchlist items
- Personal watchlist not linked to swing scanner output

**Risk:** LOW  
**Priority:** LOW

---

### 3P. Charting (`/charting`)

**APIs:**
- `GET /api/chart/instruments` (NSE+BSE merged, NSE-wins dedup)
- `GET /api/chart/candles` (TradingView datafeed)

**DB tables:** `candle` (warehouse substrate — NOT primary candle source for chart)

**Indicators available:**
- Multi-EMA Ribbon (11/20/50/100/200), Session VWAP, RSI (14)
- Fair Value Gaps (SMC), CVD Proxy, POC (Point of Control)
- Auto-Fibonacci, Fixed Volume Profile, Support/Resistance

**Formula gaps:**

| Issue | Detail | Severity |
|---|---|---|
| **ATR divergence** | Scanner uses EMA-smoothed ATR; charting (from `lib/global/indicators.ts`) uses Wilder's smoothed ATR → values differ | MEDIUM |
| **MACD seeding** | Scanner seeds signal on full series (nulls→0); global scanner slices from first valid MACD → minor value divergence | LOW |
| CVD is proxy | Candle-direction proxy, not tick-level order flow; labeled with `*` | LOW (labeled) |
| VWAP on index | Index candles lack volume → session mean `(H+L+C)/3` used; labeled | LOW (labeled) |

**Candle sourcing:**
- IST-local naive timestamps in CSV exports — ✅ (prevents double-shift)
- `asOf` in seconds (not ms) — ✅ (DailyBars asOf gotcha handled)
- BSE prices via Kite instrument_token — `source=kite` even for BSE symbols
- EOD badge capped at "delayed" — ✅ never "live"

**Gaps:**
- No drawing tools (trendlines, rectangles, horizontal levels)
- CVD proxy label is `*` footnote — easy to miss
- VWAP/VP disabled for Yahoo/Global sources — correct but not prominently noted
- ATR divergence between scanner ATR and chart ATR could confuse users

**Risk:** LOW  
**Priority:** MEDIUM (ATR standardization)

---

### 3Q. Paper Trading (`/paper-trading`)

**Purpose:** Live owner-only virtual broker — 3 segments: F&O auto, Equity auto, Combos manual.

**DB tables:** `paper_trade_fo`, `paper_trade_eq`, `paper_trade_combo`, `paper_trade_combo_leg`, `paper_account`

**Active guardrails:**
- `isPaperAutoTradingEnabled()` fail-closed in dev; `PAPER_TRADING_ENABLED` env gate
- `EnvironmentBanner`: amber (dev) / green (prod + live auto-trading)
- F&O 15:20 IST force-exit (latch)
- DD caps (daily 2.5% FNO / 0.4% EQ / weekly 5% FNO / 0.8% EQ) — sticky latches
- Heat cap (6% FNO/EQ of balance)
- Vol-clamped stop sanity
- G1-G4 risk guards (SHADOW — logging only)
- Equity stop-loss sanity (1-8%)
- F&O liquidity gate

**Live state (06-23):**
- 3 single-share equity test positions (MOTHERSON / GMRINFRA / OBEROIRLTY @ qty=1) polluting open book
- Last F&O open: 2026-06-15 (8 days ago)
- 06-22: 5 signals, 3 valid, 0 opened (gate stack rejecting 100% of candidates)

**Gaps:**
- **G1-G4 risk guards in shadow mode** — should be promoted to `paper_block` after simulation acceptance threshold passes
- **Combo trades not in FNO heat budget** — a large combo position can co-exist with FNO positions beyond heat cap
- **Reactive tick model** — open position stop/target detection lags until signal route is polled
- **3 test equity positions** — should be closed/cleaned so open book reflects only real sizing
- Cost model is shadow/reporting-only — P&L shown is gross; net P&L calculation not surfaced in the trade card

**Risk:** HIGH  
**Priority:** HIGH

---

### 3R. Paper Reports (`/paper-reports`)

**APIs:** `/api/paper/reports/fo/monthly`, `/api/paper/reports/eq/monthly`, `/api/paper/analytics/fo`, `/api/paper/journal-analytics`

**Strengths:**
- Equity curve SVG + drawdown overlay
- MFE/MAE review (max-favorable / max-adverse excursion)
- Journal editor: notes and tags per trade
- P25 evidence panel for exit overlay research
- Monthly/yearly calendar P&L with per-day pills

**Gaps:**
- **Intraday tab is a "Coming Soon" placeholder** (Phase 3)
- MANUAL_OVERRIDE trades counted in blended win-rate — overstates autonomous edge
- Shadow cost model not prominently explained in the analytics cards

**Priority:** MEDIUM

---

### 3S. Backtest Lab (`/backtest-lab`)

**DB tables:** `backtest`

**Modes:**
- **REAL_REPLAY (Mode A):** Engine history (`option_signal_history` + `fno_signal_reasoning`) — actual trades only; `pnl=null` for undecided
- **DIRECTIONAL (Mode B):** EMA/RSI/ATR/ADX/Regime on 15-min spot candles; **ATM Delta Proxy (|Δ|≈0.5)**
- **SNAPSHOT_PREMIUM_REPLAY (Mode D):** Prices from `option_chain_snapshot`; hierarchy: LTP → mid(bid,ask) → Black-Scholes from captured IV

**Formula audit:**

| Component | Formula | Status |
|---|---|---|
| DIRECTIONAL synthetic P&L | `\|ATM_DELTA\| × sign × (ExitSpot − EntrySpot) × LotSize × Lots` | ✅ labeled PROXY |
| ATM Delta | Hardcoded **0.5** | ⚠️ Valid for ATM only; OTM/ITM diverges |
| Mode D costs | STT 0.05% exit, brokerage ₹20/order, exchange 0.053%, stamp 0.003%, GST 18% | ✅ 2026-compliant |
| Spread cost default | 0.5% of premium (when real bid-ask missing) | ✅ labeled |
| Black-Scholes for BS pricing | European model | ✅ labeled MODELLED |
| Risk-free rate | Hardcoded **6.5%** | ⚠️ Should be dynamic (RBI repo) |
| VWAP substitute | `(H+L+C)/3` session mean | ✅ labeled (index candles lack volume) |
| Snapshot tolerance | 5 minutes (`REPLAY_ENTRY_TOLERANCE_MIN`) | ✅ |

**Candle source:** Real Kite-fetched CSV in `tools/fno-backtester/data/`; 15-min, IST-wall-clock-in-UTC (timezone gotcha documented and handled)

**Gaps:**
- **No NSE public holiday list** — `fnoTradingDays.ts` is Mon-Fri only; bank holidays on weekdays treated as trading days
- ATM delta hardcoded 0.5 — documented but diverges significantly for OTM strikes
- No slippage in DIRECTIONAL mode (Mode B)
- No theta/IV decay in Mode B (pure spot-delta proxy)
- Candle CSV must be manually fetched via `fetch:index-candles` — no automatic refresh

**Risk:** MEDIUM  
**Priority:** MEDIUM

---

### 3T. Infra Health (`/infra-health`)

**Purpose:** Owner-only read-only infrastructure health dashboard (Security, Sector/Industry, Candle Warehouse, Option Snapshots, Equity Risk).

**APIs:** 7 existing diagnostic endpoints consolidated

**Strengths:**
- 30s wall-clock staleness ages in real time
- `deriveSnapshotSectionSeverity` — analytics-down + diag-green → WARN (not OK)
- 16 unit tests for severity helpers

**Gaps:**
- No production deployment status (commit hash, pid, uptime) surfaced
- Sizing preview is a manual form, not auto-populated from active signals

**Priority:** LOW

---

### 3U. Data Backbone

#### Candle Warehouse
- **Status: 🔴 BROKEN** — `candle` table is **0 rows**
- Daily tick fails every ~5 min: `ANY(($2,$3,$4)::bigint[])` attempts to cast a record tuple to `bigint[]` → query throws
- **Fix:** Rewrite as `= ANY($1::bigint[])` with a single array param, then backfill with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` approach
- No user feature currently reads from the warehouse — so **no user-visible impact**, but constant log noise

#### Yahoo Fallback
- **Status: 🔴 FAILING WHOLESALE** (as of 06-23) — equity 206/206, index 30/30, fx 35/35 all failing on prod cloud IP
- Yahoo is rate-limiting/blocking the prod IP
- **Impact:** The safety net for Kite offline is effectively gone when Yahoo also fails

#### TradingView Alerts
- **Status: ⚫ STALE** — 4 rows total, newest 2026-04-24 (~2 months dormant)
- TradingView alerts not configured / alerts expired upstream
- `tv_alerts` page shows 2-month-old rows without age label

#### NSE Bhavcopy
- **Status: 🔴 BLOCKED** (prod cloud IP) — NSE rejects non-Indian cloud IPs
- Delivery % served from last-available local copy; not labeled as stale in UI

---

### 3V. Auth & Session Management

**Mechanism:** HMAC-SHA256 HttpOnly session cookies, role-based gates (owner > subscriber > viewer)

**Roles:**
- `owner` — all access including admin, paper trading, infra health
- `subscriber` — per-tab access from `users.tab_access`
- `viewer` — public read-only mode (entire site readable via shareable URL)

**Strengths:**
- `requireOwnerStrict` vs `requireOwner` — strict variant used for secret-metadata endpoints ✅
- Legal pages (`/legal/*`) bypass login correctly
- Kite token encrypted at rest (AES-256-GCM when `KITE_TOKEN_ENC_KEY` set)
- `kiteCrypto.test.ts` CRITICAL test guards token encryption

**Gaps:**
- **No rate-limiting on `POST /api/auth/login`** — brute-force risk
- **No 2FA / TOTP for owner login** — single-password auth for most privileged role
- **No automated Kite daily re-login** — token expires 06:00 IST daily; manual intervention required; missing a login silently kills the trading day
- No login audit trail (IP, timestamp, user-agent per successful/failed login)
- Public-mode allows full read access — no subscriber-tier gating for reads (by design, but worth noting)

**Risk:** HIGH  
**Priority:** HIGH (login rate-limit + 2FA are security gaps)

---

### 3W. Admin (`/admin`)

**Purpose:** Owner-only subscriber management.

**APIs:**
- `GET /api/admin/users`
- `DELETE /api/admin/users/:id`
- `POST /api/auth/signup` (OWNER — create subscriber)

**Strengths:**
- Granular per-tab access control
- "Quick Approve" for common terms (1 year / all tabs)

**Gaps:**
- **No payment gateway** — subscription dates and payments fully manual
- **No subscription expiry enforcement** — subscribers past end date can still access unless manually deleted
- No audit trail of admin actions (who granted which tab, when)

**Priority:** MEDIUM

---

### 3X. Global Multi-Asset Scanner (`/global` — `artifacts/global/`)

**Purpose:** Non-NSE coverage — US equities, crypto, commodities, FX, global indices.

**DB tables:** `global_scanner`

**Data sources:**
- Yahoo Finance: Primary source — INFO_ONLY / DELAYED (15min+)
- Binance: Crypto — fresh

**Status:** Yahoo wholesale failing on prod (see §3U) — severely degraded during outages

**Gaps:**
- Yahoo is the sole source for non-crypto — inherits all Yahoo limitations
- No source label inline per asset row
- No Kite cross-validation possible for non-NSE assets

**Priority:** LOW

---

## 4. FORMULA & CALCULATION AUDIT

### Correct Formulas
| Formula | Location | Status |
|---|---|---|
| RSI (Wilder smoothing) | `lib/indicators.ts` (shared) | ✅ |
| EMA (SMA-seeded) | `lib/indicators.ts` | ✅ |
| VWAP (cumulative) | `lib/indicators.ts` | ✅ |
| Supertrend (ATR bands) | `lib/global/indicators.ts` | ✅ |
| Bollinger Bands (population σ) | `lib/global/indicators.ts` | ✅ |
| XIRR (Newton-Raphson + Bisection) | `lib/portfolio/calc.ts` | ✅ Edge cases handled |
| HHI (concentration index) | `lib/portfolio/risk.ts` | ✅ |
| Portfolio Structure Score | `lib/portfolio/score.ts` | ✅ Weighted blend |
| PCR | `lib/optionAnalytics.ts` | ✅ |
| Max Pain | `lib/optionAnalytics.ts` | ✅ |
| Black-Scholes (European) | `lib/blackScholes.ts` | ✅ |
| F&O cost model (2026 rates) | `lib/backtest/premiumReplay.ts` | ✅ |
| Entry Safety gate (GOOD/FAIR/POOR) | `lib/scoring.ts` | ✅ |

### Formula Gaps / Divergences
| Issue | Location | Severity | Recommended Fix |
|---|---|---|---|
| **ATR: EMA smoothing vs Wilder's** | `lib/indicators.ts` vs `lib/global/indicators.ts` | MEDIUM | Standardize both to Wilder's smoothing for cross-component consistency |
| **MACD signal seeding: nulls→0 vs slice-from-valid** | Same files | LOW | Align to slice-from-first-valid (more precise) |
| **ATM Delta hardcoded 0.5** | `lib/backtest/directional.ts` | MEDIUM | Document prominently; consider OTM delta lookup for non-ATM strikes |
| **Black-Scholes risk-free rate: hardcoded 6.5%** | `lib/backtest/premiumReplay.ts` | LOW | Parameterize to current RBI repo rate |
| **VWAP on index: `(H+L+C)/3` session mean** | Chart datafeed | LOW | Correctly labeled; acceptable since volume unavailable for indices |
| **NSE holiday list absent** | `lib/fnoTradingDays.ts` | MEDIUM | Mon-Fri only; bank holidays counted as trading days |
| **F&O cost model shadow-only in live paper trades** | `lib/fnoCostModel.ts` | MEDIUM | Gross P&L shown live; "shadow cost" label not prominent |
| **No slippage in DIRECTIONAL backtest** | `lib/backtest/directional.ts` | MEDIUM | Documented in DataQualityPanel; add configurable slippage |

---

## 5. DATABASE AUDIT

| Table | Schema | Producer | Consumer | Risk | Notes |
|---|---|---|---|---|---|
| `kite_session` | Drizzle | `kiteAuth.ts` | All data paths | CRITICAL | Single-row; encrypted token |
| `option_signals` | Drizzle | `optionSignals.ts` | F&O cockpit | HIGH | Write-once-per-cycle |
| `paper_trade_fo` | Drizzle | `paperTradingFO.ts` | Paper reports | CRITICAL | pnl_gross (STT shadow-only) |
| `paper_trade_eq` | Drizzle | `paperTradingEq.ts` | Paper reports | CRITICAL | |
| `paper_trade_combo` + legs | Drizzle | `paperTradingCombo.ts` | Paper trading UI | HIGH | Advisory lock; CAS close |
| `paper_account` | Drizzle | `paperAccount.ts` | Capital ledger | CRITICAL | balance = available free cash |
| `fno_signal_reasoning` | Drizzle | `fnoSignalReasoningLogger.ts` | F&O diagnostics | HIGH | Write-once append log |
| `swing_order_staging` | Drizzle | `swingOrderStaging.ts` | Swing cash UI | CRITICAL | broker_order_id MUST remain null |
| `swing_scan` | Drizzle | `swingScannerStore.ts` | Stocks to Watch | HIGH | Once-per-day latch |
| `inst_flows` | Drizzle | `instFlows.ts` | Flows page | MEDIUM | T-1 NSE data |
| `option_chain_snapshot` | Drizzle | Option ingestor | OI lab analytics | HIGH | Write-only; not for signals |
| `candle` | Drizzle | `candleWarehouseIngestor.ts` | Backtest, chart | HIGH | **0 rows (broken)**; write-guard prevents lower-trust overwrite |
| `iv_history` | Drizzle | F&O signal engine | Regime classifier | HIGH | IVR/IVP; BANKEX/NIFTYNXT50 stale 05-08 |
| `backtest` | Drizzle | `lib/backtest/` | Backtest lab | HIGH | IST-wall-clock-in-UTC convention |
| `portfolios` + `portfolio_holdings` | Drizzle | Portfolio routes | Portfolio analyser | MEDIUM | ownerKey-scoped |
| `users` | Drizzle | `userAuth.ts` | Auth middleware | HIGH | bcrypt; role RBAC |
| `global_scanner` | Drizzle | Global pump | Global scanner | LOW | Yahoo-sourced cache |
| `instrument_map` | Drizzle | INDstocks mapper | Disabled | LOW | DISABLED by default |
| `app_state` | Drizzle | Schedulers | Swing scan latch | MEDIUM | Key-value latches |
| `strategy_control` | Drizzle (schema placeholder) | — | Prevent DROP | LOW | Must stay to prevent drizzle-kit push dropping it |
| **`daily_report_runs`** | **Raw SQL ONLY** | `dailyReports.ts` | Report dedup | **MEDIUM** | **NOT in Drizzle schema** — schema drift risk |
| `tv_alerts` | Drizzle | TradingView webhook | TV alerts page | LOW | **Stale since 2026-04-24** |
| `fno_signal_reasoning` | Drizzle | Signal logger | Diagnostics | HIGH | |
| `indstocks_token` | Drizzle | INDstocks | Disabled | LOW | |

**Critical finding:** `daily_report_runs` is the only table created via raw SQL outside the Drizzle schema. While intentional (avoids drop risk from `drizzle-kit push`), it creates permanent schema drift. Should be added to the Drizzle schema using the `strategy_control` pattern (present in schema to prevent DROP; protected from push).

---

## 6. SCHEDULER AUDIT

| Job | Interval | Condition | Multi-replica safe | Gap |
|---|---|---|---|---|
| Global data pump | 30s-15m internal | Continuous | ⚠️ No DB dedup | Double-run on autoscale |
| Screener preset scheduler | 30s | Continuous | ⚠️ No DB dedup | Double-run |
| FII/DII refresher | 15m | Continuous | ⚠️ No DB dedup | Double-run (idempotent, low-risk) |
| Kite readiness check | 1m | 08:40-09:20 IST | ✅ Alert-only | Duplicate alerts harmless |
| Swing deep scanner | 60s latch | ≥15:35 IST weekdays | ⚠️ In-memory latch | Double-scan possible on autoscale |
| Swing intraday LTP refresh | 15m | 09:15-15:30 IST | ⚠️ In-memory latch | Double-refresh possible |
| Option snapshot ingestor | 1m | 09:15-15:30 IST | ⚠️ No DB dedup | Double-capture (idempotent) |
| Candle warehouse sync | 5m/15m | 15:40 IST / market hours | ⚠️ In-memory latch | Double-sync |
| Pre/post market reports | 60s latch | 08:50-09:10 / 15:45-16:15 IST | ✅ **DB UNIQUE dedup** | ✅ Correctly protected |
| F&O paper EOD summary | 60s latch | ≥15:35 IST | ⚠️ In-memory latch | Double-persist on autoscale |
| **Swing order TTL expiry** | **None — on read only** | — | N/A | **CRITICAL GAP — no background sweep** |

**15:35-15:45 IST contention:** Swing deep scan, Candle warehouse EOD, F&O EOD summary, and post-market report all trigger within 10 minutes. Could cause DB/CPU spike. Consider staggering start times.

**Key finding:** Only `daily_report_runs` uses DB-level dedup for scheduler safety. All other schedulers rely on in-memory latches. In current single-replica deployment this is acceptable. Multi-replica deployment would cause double-firing for most jobs.

---

## 7. TEST COVERAGE

| Suite | Tests | Status | Key gaps |
|---|---|---|---|
| `dailyReports.test.ts` | 107 | ✅ | — |
| `dailyReportsDedupContract.test.ts` | 21 | ✅ | — |
| `swingAlerts.test.ts` | 58 | ✅ CRITICAL | — |
| `swingCashDataTrust.test.ts` | ~10 | ✅ CRITICAL | — |
| `swingOrderStaging.test.ts` | ~12 | ✅ CRITICAL | — |
| `paperTradingFO.premiumPath.test.ts` | ~10 | ✅ CRITICAL | — |
| `fnoPaperRiskGuards.test.ts` | 27 | ✅ | No integration test for block mode |
| `scannerProvenance.test.ts` | ~8 | ✅ CRITICAL | — |
| `deepscan.honesty.test.ts` | ~6 | ✅ CRITICAL | — |
| `marketData/*.test.ts` | ~50+ | ✅ CRITICAL | — |
| `kiteCrypto.test.ts` | ~5 | ✅ CRITICAL | — |
| `portfolio/calc.test.ts` + `score.test.ts` | ~130 | ✅ | — |
| `infraHealth.test.ts` | 16 | ✅ | — |
| Scanner total (34 files) | 721 | ✅ | — |
| **api-server total** | **~1100+** | ✅ | — |
| **End-to-end browser (Playwright)** | **0** | ❌ NONE | No UI regression tests |
| **Live Kite connectivity** | **0** | N/A | Mocked in all tests |
| **Full paper trade cycle** | **0** | ❌ NONE | Unit-tested per-function only |
| **NSE public holidays** | **0** | ❌ NONE | `fnoTradingDays` Mon-Fri only |

---

## 8. KITE SESSION — OPERATIONAL DEEP DIVE

### Session lifecycle
- Token expires **daily at 06:00 IST** (`next6amIST()`)
- `getActiveSession()` returns null past expiry
- Reconnect = **manual**: Login to Kite → `/api/kite/login-url` → Zerodha OAuth → `/api/kite/callback`
- Token stored in `kite_session` (AES-256-GCM at rest)
- Dev can mirror a prod session (`KITE_MIRROR_URL`) — but neither path obtains a fresh token after daily expiry

### What fails when Kite is offline

| Feature | Behavior | User message |
|---|---|---|
| F&O signals | **No emission at all** | 0 setups (no visible root cause) |
| Paper auto-open | No opens | Skip reason logged |
| Scanner | Yahoo fallback (failing) | cached/sparse |
| Home panels | Sparse/stale | Honest `—` / delayed labels |
| Portfolio CMP | null | "n/a" shown |
| Charting Indian | Visual-only Yahoo | "VISUAL ONLY" label |
| Option chain | NSE fallback | "NSE FALLBACK · DISPLAY ONLY" |

### Recommendations (not implemented)
1. **Pre-open alert:** At 08:45 IST, check `kite_session`; if expired/missing → send a loud Telegram alert "Kite logged out — reconnect before open"
2. **Sticky global banner:** Surface `kite_session.expires_at` as a global persistent banner so a missed login is obvious within seconds
3. **KITE_OFFLINE_SINCE counter:** Track how long Kite has been offline and escalate the alert severity
4. **Optional semi-automated token refresh** if request-token capture flow is acceptable

---

## 9. DATA SOURCE HONESTY MATRIX

| Feature | Primary | Fallback | Trade-grade? | Honest labeling | Fabrication? |
|---|---|---|---|---|---|
| Home indices | Kite | Yahoo (15m) | Kite only | "~15min delayed" badge | None |
| Watchlist | Kite | None (Yahoo banned) | Yes | Source badge | None |
| Portfolio | Kite (+resolver) | Manual CMP only | Valuation on real CMP | null/"n/a" when unavailable | None |
| Charting (Indian) | Kite | Yahoo VISUAL ONLY | Kite only | "VISUAL ONLY / NOT FOR SIGNALS" | None |
| Charting (global) | Yahoo | — | No | DELAYED badge | None |
| Scanner | Kite | Yahoo | Signal source-stamped | Cached-198 not prominently labeled | None |
| Swing scanner | Kite daily | Yahoo | Source-stamped | Per-symbol error shown | None |
| Option chain | Kite | NSE | TRADE_GRADE=Kite-only | "NSE FALLBACK · DISPLAY ONLY" | None |
| OI lab | Kite snapshot | NSE | — | GEX/Greeks MODELLED badge | None |
| **F&O signals** | **Kite (required)** | **None (Yahoo prohibited)** | **Yes** | `PRE_EMISSION_REJECTED` reason | **None** |
| Paper marks | Kite | — | Yes | Skip if untrusted | None |
| Backtest | Real spot CSV | — | Study only | "ATM delta-0.5 PROXY" labeled | None |
| Home global cues | Yahoo / TV proxy | — | No | Delayed (global cues only) | None |
| FII/DII, OI | NSE | — | Reference | "Source: NSE" | None |
| Daily analysis | Mixed | — | No (report only) | Availability matrix explicit | None |

**Bottom line:** Across every surface audited, the code **omits or labels** missing/secondary/modelled data — it **never fabricates**. This is a genuine and consistent strength.

---

## 10. FRONTEND UX AUDIT

| Aspect | Status | Notes |
|---|---|---|
| Dark theme | ✅ | Consistent |
| Card layout | ✅ | Clean margins |
| Empty states | ✅ | Honest ("No signals today", "CMP unavailable") |
| Loading states | ✅ | Skeleton loaders present |
| Error states | ✅ | Error boundaries present |
| Source labels | ✅ Most pages | `DataSourceBadge` consistently used |
| As-of timestamps | ⚠️ Partial | Missing on scanner table header and option chain rows |
| Stale warnings | ✅ | KiteOfflineBanner, stale badges |
| Owner-only controls | ✅ | Behind auth |
| Global "Kite offline" banner | ❌ Missing | Per-page banners only; no persistent global banner |
| Mobile/responsive | ⚠️ Partial | Dense tables use `overflow-x-auto` |
| CSV/PDF export | ❌ Missing | No export for scanner results, paper trade history, portfolio |
| Drawing tools on chart | ❌ Missing | Read-only chart only |

---

## 11. PRIORITY ROADMAP

### P0 — Security (fix immediately)
| # | Issue | Fix |
|---|---|---|
| 1 | **No rate-limiting on `POST /api/auth/login`** | Add `express-rate-limit` (5 req/min/IP) |
| 2 | **No 2FA / TOTP for owner login** | Add TOTP for the owner role |

### P1 — Operational safety
| # | Issue | Fix |
|---|---|---|
| 3 | **No automated Kite pre-open alert** | 08:45 IST scheduler: check session, Telegram if expired |
| 4 | **No background swing order TTL sweep** | Hourly worker: expire stale STAGED orders, alert owner |
| 5 | **Candle warehouse daily tick broken** | Rewrite `ANY(($2,$3,$4)::bigint[])` → `= ANY($1::bigint[])` then backfill |
| 6 | **Activate F&O risk guards G1-G4** | Run simulation, confirm acceptance threshold, flip `FNO_GUARD_CONFIG.mode` to `"paper_block"` |

### P2 — Data completeness & honesty
| # | Issue | Fix |
|---|---|---|
| 7 | **Add `daily_report_runs` to Drizzle schema** | Use `strategy_control` pattern (no drizzle-kit push needed) |
| 8 | **GIFT Nifty integration** | Top pre-market data point; currently `SOURCE_NOT_INTEGRATED` |
| 9 | **India VIX surfacing** | ATM IV from Kite option chain available; expose as VIX proxy on premarket page |
| 10 | **NSE holiday list** | `fnoTradingDays.ts` Mon-Fri only; bank holidays on weekdays counted as trading days |
| 11 | **ATR standardization** | Align both indicator files to Wilder's smoothing |
| 12 | **Delivery % T-1 label** | Add "T-1" inline to scanner column header |
| 13 | **As-of timestamps** | Add "last updated HH:mm IST" to scanner table header and option chain rows |
| 14 | **Yahoo fallback degraded banner** | Global banner when Yahoo wholesale failing |
| 15 | **Close 3 equity test positions** | MOTHERSON / GMRINFRA / OBEROIRLTY @ qty=1 polluting open book |

### P3 — Product / UX improvements
| # | Issue | Fix |
|---|---|---|
| 16 | **CSV export** | Scanner results, paper trade history, portfolio holdings |
| 17 | **Corporate action adjustment warning** | Portfolio cost basis wrong for splits/bonuses — show explicit warning |
| 18 | **Subscription expiry enforcement** | Auto-disable subscribers past end date |
| 19 | **Combo trades in risk budget** | Decide: include combos in FNO heat cap or document exclusion |
| 20 | **Intraday paper reports tab** | Complete Phase 3 |
| 21 | **Correlation clustering in portfolio** | Wire daily-return series per holding |
| 22 | **Payment gateway** | Remove manual billing; integrate payment provider |
| 23 | **Signal reasoning join** | Surface `fno_signal_reasoning` on paper trade detail view |
| 24 | **MACD seeding alignment** | Align both files to slice-from-first-valid |

### P4 — Architecture & maintenance
| # | Issue | Fix |
|---|---|---|
| 25 | **Multi-replica scheduler safety** | Add DB dedup for swing scanner and F&O EOD summary |
| 26 | **15:35-15:45 IST contention** | Stagger heavy end-of-day jobs |
| 27 | **Indices redirect** | `/indices` just redirects to Home; remove or make it a real page |
| 28 | **End-to-end tests (Playwright)** | Zero browser tests; add at minimum: env banner, daily analysis send flow |
| 29 | **Ephemeral no-trade reasons persistence** | Write all durable reasons to `fno_signal_reasoning` |
| 30 | **TradingView alerts page** | Age-label the 2-month-old rows or re-wire TradingView alerts |
| 31 | **Reactive F&O tick gap** | Add lightweight background tick (60s during market hours) for open position sweep |

---

## 12. FINAL VERDICT

**Overall platform quality: STRONG FOUNDATION — PRODUCTION VIABLE**

The platform is a serious professional-grade Indian market analytics terminal. Source honesty is carefully implemented and consistently enforced across all surfaces — **fabrication was found nowhere**. The signal engine is multi-layered with 11+ active gates. Paper trading has robust guardrails. Tests cover 1100+ cases for the backend. The daily Telegram reports are shipped and verified.

**The single most impactful gap is operational:** the Kite session expires daily and there is no automated pre-open alert. A missed morning login silently kills the entire trading day. This is not a code bug — the engine behaves correctly (refusing to emit without authoritative data) — but the operational awareness gap must be fixed.

**The three highest-priority code gaps are:**
1. Login rate-limiting (security)
2. F&O risk guard block-mode activation (trading quality)
3. Swing order TTL background sweep (operational safety)

Everything else is product depth and UX polish. The platform is genuinely ready to serve serious Indian retail traders.

---

*Report generated: 2026-07-01 | Prior audit: 2026-06-23 | Index files read: 7/7 | Parallel explorers: 10 | Production DB queries: from prior 2026-06-23 audit*
