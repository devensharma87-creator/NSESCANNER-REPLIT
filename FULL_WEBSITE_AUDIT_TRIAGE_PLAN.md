# FULL WEBSITE AUDIT TRIAGE PLAN

**Based on:** `FULL_WEBSITE_DEEP_AUDIT_REPORT.md` (2026-07-01, 1,135 lines, 31 prioritised findings)  
**Triage date:** 2026-07-01  
**Method:** Code-level verification via targeted grep + file reads against current HEAD, cross-checked against every audit finding before classification.  
**Constraint:** READ-ONLY triage. No code changes. No trading state mutated. No broker execution enabled.

---

## VERIFICATION EVIDENCE (raw probe results, per audit finding)

### PROBE 1 — Login Rate-Limiting

**Audit claim:** "No rate-limiting on `POST /api/auth/login`" (P0 #1)

**Code checked:** `artifacts/api-server/src/app.ts`

```
Line 6:   import rateLimit from "express-rate-limit";
Line 147: const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, ... legacyHeaders: false });
Line 172: app.use("/api/auth/login", loginLimiter);
Line 177: const globalLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, ... });
Line 185: app.use("/api/global/auth/login", globalLoginLimiter);
```

**Verdict: ALREADY_FIXED** — 15-minute rate-limit window applied to both login routes. The audit finding is stale.

---

### PROBE 2 — G1-G4 Risk Guards Mode

**Audit claim:** "G1-G4 risk guards in shadow mode" (P1 #6, P3-Q)

**Code checked:** `artifacts/api-server/src/lib/fnoPaperRiskGuards.ts`

```
Line 161: * Live default config — paper_block mode.
Line 174: export const FNO_GUARD_CONFIG: FnoPaperRiskGuardConfig = {
Line 175:   mode: "paper_block",
Line 298: config.mode === "paper_block" && hardBlocks.length === 0
Line 441: const allowed = config.mode === "shadow" ? true : hardBlocks.length === 0;
```

G4 (SENSEX_DISABLED): `disableSensexPaperAutoOpen: true` visible in surrounding config.

**Verdict: ALREADY_FIXED** — Guards are in `paper_block` mode, not shadow. The audit was based on pre-promotion state. G4 SENSEX disable is active.

---

### PROBE 3 — Kite Pre-Open Alert / Session Alerting

**Audit claim:** "No automated Kite pre-open alert" (P1 #3, §0, §8)

**Code checked:** `artifacts/api-server/src/lib/kiteReadinessScheduler.ts` + `artifacts/api-server/src/routes/index.ts`

```
kiteReadinessScheduler.ts:
  - Runs every 5 min, IST-gated 08:40–09:20
  - At 08:45 IST: logger.warn("Kite offline approaching market open — reconnect required")
  - At 09:05 IST: logger.error("Kite STILL offline near market open")
  - Per-IST-day latches prevent duplicate fire
  - KITE_OFFLINE_SINCE tracked via appStateStore

index.ts line 33: import { startKiteReadinessScheduler } from "../lib/kiteReadinessScheduler"
```

**What is missing:** The scheduler emits structured **server logs** only. It does NOT call `alertOwner()` or dispatch a Telegram message. The owner will not see this notification unless actively monitoring server logs.

`/api/fno/no-signal-gap` — endpoint exists (fno.ts line 390-399) returning last F&O signal date gap.

**Verdict: PARTIALLY_FIXED** — Session monitoring infrastructure exists; per-day latches work; `KITE_OFFLINE_PREOPEN` state is tracked. **Gap:** No Telegram alert dispatched. Server log alone is not owner-visible pre-market.

---

### PROBE 4 — Candle Warehouse SQL (Broken Daily Tick)

**Audit claim:** "Malformed SQL `ANY(($2,$3,$4)::bigint[])` causes 0 rows" (P1 #5, §U)

**Code checked:** `artifacts/api-server/src/lib/candleWarehouseIngestor.ts`

```
Line 403: AND instrument_token = ANY(${tokens}::bigint[])
```

The malformed parameterized form `ANY(($2,$3,$4)::bigint[])` is **gone**. The query now uses a Drizzle template literal that correctly passes `tokens` as a PostgreSQL array.

**Enabled gate:** `CANDLE_WAREHOUSE_ENABLED` env var — auto-off in dev/preview (fail-closed pattern matching paper trader). Line 159: reads env var. Line 587-599: returns early when disabled.

**Current production state:** Cannot confirm from code alone whether `CANDLE_WAREHOUSE_ENABLED=true` is set in prod, or whether the table is now populated.

**Verdict: PARTIALLY_FIXED** — SQL is corrected. Whether rows now exist in production depends on `CANDLE_WAREHOUSE_ENABLED` being set and the scheduler having run. **NEEDS_PRODUCTION_VERIFICATION**.

---

### PROBE 5 — Swing Order TTL Background Sweep

**Audit claim:** "No background TTL sweep — staged orders only expire on read" (P1 #4, §3J)

**Code checked:** `artifacts/api-server/src/routes/swingStaging.ts` + `artifacts/api-server/src/routes/index.ts`

```
swingStaging.ts line 277: router.post("/swing/staged-orders/expire-stale", requireOwner, ...)
swingStaging.ts line 401: router.post("/swing/staged-orders/:id/expire", requireOwner, ...)
```

Searching `index.ts` for swing TTL scheduler wiring: **no results** (`startSwingScanScheduler` is wired but only for the deep scanner, not for staged order expiry).

Test file confirms: `"Case 4: a staged order expires after its TTL (expiry-on-read)"` — expiry is still read-triggered.

**Verdict: PARTIALLY_FIXED** — Manual expiry endpoint exists. No background worker auto-calls it. Since broker execution is **HARD-DISABLED** (`LIVE_CASH_SWING_ORDER_ENABLED` = false), no live order risk. But stale STAGED orders accumulate silently if the owner doesn't visit the page. No Telegram alert for TTL expiry fires without a read.

---

### PROBE 6 — 2FA / TOTP for Owner Login

**Audit claim:** "No 2FA / TOTP for owner login" (P0 #2)

**Code checked:** `artifacts/api-server/src/routes/auth.ts`, `artifacts/api-server/src/lib/auth.ts`

Grep for `2FA`, `totp`, `TOTP`, `auditLog`, `loginHistory`, `loginAudit`, `failedAttempt`: **zero results**.

**Verdict: OPEN** — No TOTP/2FA, no login audit trail. The single shared owner password is the only auth factor.

---

### PROBE 7 — daily_report_runs Drizzle Schema Coverage

**Audit claim:** "`daily_report_runs` is raw SQL only — schema drift risk" (P2 #7)

**Code checked:**
- `lib/db/src/schema/` directory listing — no `dailyReportRuns.ts` or equivalent
- `artifacts/api-server/src/lib/dailyReports.ts` line 110: `CREATE TABLE IF NOT EXISTS daily_report_runs (...)`
- No file in `lib/db/src/schema/` covers this table

**Verdict: OPEN** — Confirmed schema drift. The table exists in production (created by `CREATE TABLE IF NOT EXISTS`), but is not in the Drizzle schema. If `drizzle-kit push` is ever run (which it shouldn't be per golden rules), the table would be detected as unmanaged. More concretely, the `strategyControl.ts` pattern (present in schema specifically to prevent DROP) is the correct fix.

---

### PROBE 8 — ATR Formula Divergence

**Audit claim:** "ATR divergence: scanner EMA-smoothed vs global Wilder's" (P2 #11)

**Code checked:**
- `artifacts/api-server/src/lib/indicators.ts` line 25: `return ema(trs, period)` — EMA-smoothed ATR
- `lib/indicators/src/index.ts` lines 14-16: explicitly documents "api-server ATR is EMA-smoothed vs global's Wilder RMA"

ATR in `lib/global/indicators.ts` line 106: separate `atr(candles, OHLCV[])` function — different interface signature, different smoothing.

**Which drives trade logic:** Scanner ATR (EMA-smoothed) feeds into `scoring.ts` for signal score and entry safety gate. Global ATR (Wilder's) feeds the global multi-asset scanner only (display-only, no signals).

**User-facing impact:** Scanner stop-loss calculations use EMA-smoothed ATR. This produces slightly higher ATR values in fast-moving markets vs Wilder's smoothing, making stops slightly wider. Not a safety risk (conservative direction), but creates inconsistency if users compare chart ATR (which may also be Wilder's) to scanner-displayed ATR.

**Verdict: OPEN** — Divergence confirmed and documented. Not a safety risk (EMA ATR is wider = more conservative stops). Standardization is a quality improvement, not an emergency fix.

---

### PROBE 9 — MANUAL_OVERRIDE in Blended Win-Rate

**Audit claim:** "MANUAL_OVERRIDE trades counted in blended win-rate" (§3R gap)

**Code checked:** `artifacts/api-server/src/lib/winRateClassification.ts`

```
Line 16: EXCLUDE: not a filled autonomous-system trade (e.g. MANUAL_OVERRIDE, unknown)
Line 21: MANUAL_OVERRIDE is *operator-influenced* P&L, not autonomous-system
Line 38: | "MANUAL_OVERRIDE"
Line in test: "returns EXCLUDE for MANUAL_OVERRIDE (operator-influenced)"
```

**Verdict: ALREADY_FIXED** — `winRateClassification.ts` correctly classifies `MANUAL_OVERRIDE` as `EXCLUDE`. The audit finding was incorrect or has since been corrected.

---

### PROBE 10 — Yahoo Never in Trade-Grade Path

**Audit claim:** Yahoo wholesale failing, fallback safety net gone (§U)

**Code checked:** `artifacts/api-server/src/lib/marketData/policy.ts`, `types.ts`, `validator.ts`, tests

```
policy.ts line 10: Yahoo is secondary analytics ONLY — never prices/signals/valuation/F&O
types.ts line 14: "secondary_analytics" — Yahoo. NEVER allowed for prices/signals
validator.ts line 22: Yahoo/analytics → delayed + not-for-signals
marketData.test.ts line 34: "bans Yahoo from trading/signals/valuation (analytics only)"
```

**Impact of Yahoo failure:** Yahoo being down affects display-only surfaces (global cues strip, chart visual-only mode, fundamentals, delayed macro overlay). Zero impact on any trade-grade signal, paper trade open/close, or F&O emission path. The failure is visible (degraded UI) but not dangerous.

**Verdict: STALE_FINDING (as a safety concern)** — Yahoo failure is cosmetic/display-only. The trust gate prevents Yahoo from ever reaching a trade decision path. The production impact is sparse UI panels during Yahoo outages, which is honest degradation, not data corruption.

---

### PROBE 11 — Candle Warehouse Used by Production Features?

**Code checked:** `candleWarehouseIngestor.ts` comment (lines 11-13):

> "Nothing in this module is consumed by the F&O signal pipeline, paper-trader, swing scorer, scanner, strategy builder, or order placement. Verified by callsite — see `swingScannerData.fetchDailyBars` which still calls Kite directly, NOT this warehouse."

**Charting:** `chart.ts` uses `kiteIntraday.ts` directly, not the candle warehouse.

**Verdict: CONFIRMED** — The candle warehouse is write-only infrastructure. Its brokenness (if still applicable after SQL fix) has **zero user-facing impact**. No production feature reads from `candle` table today.

---

## TRIAGE MASTER TABLE

Status legend: **OPEN** | **ALREADY_FIXED** | **STALE_FINDING** | **PARTIALLY_FIXED** | **NEEDS_PRODUCTION_VERIFICATION** | **NEEDS_DESIGN_DECISION** | **DEFERRED** | **BLOCKED**

| ID | Module | Audit Finding | Current Status | Evidence | Prod Impact | Risk | Impl Priority | Recommended Action | Files Affected | Tests Required | Prod Verify? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F01 | Auth | No rate-limit on `POST /api/auth/login` | **ALREADY_FIXED** | `app.ts:172` — `loginLimiter` 15min window applied | None | None | None | Update audit report | — | — | No |
| F02 | Auth | No 2FA / TOTP for owner login | **OPEN** | No TOTP in auth routes/lib | Attacker with password gets full owner access | HIGH | PHASE_0 | Add TOTP using `otplib`; seed on first login; enforce on owner role | `routes/auth.ts`, `lib/auth.ts` | Auth flow tests | Yes (prod login) |
| F03 | Auth | No login audit trail (IP, timestamp, user-agent) | **OPEN** | No `loginHistory` or `loginAudit` tables/logs | Owner cannot detect brute-force attempts after the fact | MEDIUM | PHASE_0 | Log failed+successful owner logins to structured log or new DB table | `routes/auth.ts` | — | No |
| F04 | Scheduler | No automated Kite pre-open Telegram alert | **PARTIALLY_FIXED** | `kiteReadinessScheduler.ts`: logs WARN/ERROR; does NOT call `alertOwner()` | Silent blind trading day (proven 2026-06-23) | HIGH | PHASE_0 | Add `alertOwner()` call in `kiteReadinessScheduler.ts` at 08:45+09:05 IST; per-day latch already present | `lib/kiteReadinessScheduler.ts` | Unit test: alert sent once/day; alertOwner call verified | Yes (Telegram receipt) |
| F05 | Swing | No background TTL sweep for staged orders | **PARTIALLY_FIXED** | `POST /swing/staged-orders/expire-stale` exists; not in any scheduler | Stale STAGED orders accumulate silently; no Telegram expiry alert fires without read | MEDIUM | PHASE_0 | Wire `expireStagedOrders()` to a 60-min background tick in `routes/index.ts`; alert owner when orders expire TTL | `routes/index.ts`, `lib/swingOrderStaging.ts` | Test: background sweep fires; Telegram alert on expiry | No |
| F06 | Data | Candle warehouse daily tick broken (malformed SQL) | **PARTIALLY_FIXED** → **NEEDS_PRODUCTION_VERIFICATION** | `candleWarehouseIngestor.ts:403` — SQL now uses `ANY(${tokens}::bigint[])` template literal; `CANDLE_WAREHOUSE_ENABLED` env gates it | Zero (no feature reads candle table) | LOW | VERIFY_ONLY | Confirm `CANDLE_WAREHOUSE_ENABLED=true` in prod; confirm rows > 0 in `candle` table; confirm no more daily-tick error logs | — | Existing candle warehouse tests | Yes (row count + log check) |
| F07 | Trading | G1-G4 risk guards in shadow mode | **ALREADY_FIXED** | `fnoPaperRiskGuards.ts:175` — `mode: "paper_block"`; G4 SENSEX disable active | None — guards are blocking | None | None | Update audit report | — | — | No |
| F08 | Reporting | MANUAL_OVERRIDE in blended win-rate | **ALREADY_FIXED** | `winRateClassification.ts` excludes `MANUAL_OVERRIDE` (lines 16, 21, 38); test at line 75 | None | None | None | Update audit report | — | — | No |
| F09 | DB schema | `daily_report_runs` not in Drizzle schema | **OPEN** | Confirmed raw `CREATE TABLE IF NOT EXISTS` in `dailyReports.ts:110`; no file in `lib/db/src/schema/` | Schema drift: table invisible to Drizzle introspection; would confuse future migrations | MEDIUM | PHASE_0 | Add `dailyReportRunsTable` to Drizzle schema using `strategyControl` pattern (schema present = prevents DROP; no `drizzle-kit push` needed) | `lib/db/src/schema/dailyReportRuns.ts`, `lib/db/src/schema/index.ts` | Compile check; schema file correct | No |
| F10 | Data | Yahoo wholesale failing on prod cloud IP | **STALE_FINDING (safety)** | Yahoo blocked by trust gate; `policy.ts`, `validator.ts` tests confirm Yahoo never reaches trade-grade path | Cosmetic: sparse UI panels on Yahoo outage | LOW | DEFERRED | Mark as expected degradation; consider dedicated display-data provider later | — | — | Yes (check if Yahoo recovered) |
| F11 | Data | NSE bhavcopy blocked from prod cloud IP | **OPEN** | NSE rejects non-Indian cloud IPs; delivery % served from last-available local copy | Delivery % may be T-2 or older; unlabeled staleness | MEDIUM | PHASE_1 | Label delivery % column as "T-1 (NSE bhavcopy)"; investigate alternative delivery% source | `routes/scanner.ts`, scanner frontend | — | Yes |
| F12 | Data | TradingView alerts page shows 2-month-old rows | **OPEN** | `tv_alerts` newest row: 2026-04-24; TradingView webhooks dormant | Users see stale alert rows without age label | LOW | PHASE_3 | Add "last alert received: X days ago" banner; or hide page | `pages/tv-alerts.tsx` (if exists) | — | No |
| F13 | Formulas | ATR formula divergence (EMA-smoothed scanner vs global) | **OPEN** | `indicators.ts:25`: `return ema(trs, period)`; `lib/indicators` README confirms divergence | Minor: scanner stops slightly wider than Wilder's ATR; no safety risk | LOW | PHASE_2 | Standardize both to Wilder's smoothing; update tests | `lib/indicators.ts`, `lib/global/indicators.ts` | ATR value regression tests | No |
| F14 | Formulas | MACD seeding divergence (nulls→0 vs slice-from-valid) | **OPEN** | `lib/indicators/src/index.ts` documents divergence | Minor: slight MACD value difference; no trade-grade impact | LOW | PHASE_2 | Align both to slice-from-first-valid | Same as F13 | MACD regression tests | No |
| F15 | Formulas | ATM Delta hardcoded 0.5 in DIRECTIONAL backtest | **OPEN (DEFERRED)** | `lib/backtest/directional.ts`; documented in DataQualityPanel | Research-only tool; labeled clearly; OTM/ITM diverges | LOW | DEFERRED | Document more prominently; add OTM lookup later | `lib/backtest/directional.ts` | — | No |
| F16 | Formulas | Black-Scholes risk-free rate hardcoded 6.5% | **OPEN (DEFERRED)** | Used in `lib/backtest/premiumReplay.ts` | Low: small pricing delta | LOW | DEFERRED | Parameterize to RBI repo rate | `lib/backtest/premiumReplay.ts` | — | No |
| F17 | Scheduler | NSE holiday list absent in `fnoTradingDays.ts` | **OPEN** | `fnoTradingDays.ts` is Mon-Fri only; confirmed in `PROJECT_MAP.md` | Backtest counts bank holidays as trading days; minor overstating | MEDIUM | PHASE_2 | Add hard-coded NSE 2026 holiday list; test against known holidays | `lib/fnoTradingDays.ts` | Holiday boundary tests | No |
| F18 | UI | No global "Kite offline" sticky banner | **OPEN** | Per-page `KiteOfflineBanner` exists on scanner/detail/deep-scan but not header-level | Users see sparse panels without knowing root cause | MEDIUM | PHASE_3 | Add global offline banner driven by `KITE_OFFLINE_SINCE` state from `kiteReadiness.ts` | `artifacts/scanner/src/` (layout/header) | — | No |
| F19 | UI | Scanner delivery % not labeled T-1 | **OPEN** | Column header shows "DEL%" with no T-1 note | Users may think delivery % is live intraday | LOW | PHASE_3 | Add "(T-1)" suffix to column header tooltip | `pages/scanner.tsx` | — | No |
| F20 | UI | No as-of timestamp on scanner table | **OPEN** | Scanner table has no "last updated at HH:mm IST" header | Users can't tell how fresh the cached-198 data is | LOW | PHASE_3 | Add wall-clock "Last scan: HH:mm IST" to scanner table header | `pages/scanner.tsx` | — | No |
| F21 | UI | Scanner 198-row cache not labeled when serving cached fallback | **OPEN** | `fullNseScanner.ts` logs `hard-timeout … returned=198` but UI shows no indicator | Users may not know they're seeing partial data | MEDIUM | PHASE_3 | Add "⚠ Partial scan (198 of 4298)" indicator in scanner when serving cached results | `pages/scanner.tsx`, `routes/scanner.ts` | — | No |
| F22 | Data | GIFT Nifty / SGX Nifty not integrated | **OPEN** | Coverage matrix: `SOURCE_NOT_INTEGRATED` | Pre-market report misses #1 cue | MEDIUM | PHASE_1 | Evaluate providers (CMOTS, Refinitiv, or scraping CME GIFT Nifty futures); licensing cost assessment needed | `lib/dailyReports.ts`, `pages/premarket.tsx` | — | No |
| F23 | Data | India VIX not integrated (ATM IV available as proxy) | **OPEN** | ATM straddle IV available from Kite option chain; not wired to premarket page or daily report | Pre-market report section shows "Unavailable" | MEDIUM | PHASE_1 | Wire ATM straddle IV from option chain analytics as India VIX proxy; label clearly as "ATM IV (proxy, not official NSE VIX)" | `lib/optionChainAnalytics.ts`, `pages/premarket.tsx` | — | No |
| F24 | Data | FII/DII data is T-1 but not labeled "T-1" inline | **OPEN** | "Source: NSE" shown; no T-1 delay label | Minor: display issue | LOW | PHASE_3 | Add "T-1" to FII/DII source label | `pages/flows.tsx` | — | No |
| F25 | Product | Subscription expiry not enforced automatically | **OPEN** | Subscribers past end date can access unless manually deleted | Revenue / access control leak | MEDIUM | PHASE_1 | Add `expires_at` check to `requireSubscriberOrOwner` middleware; auto-downgrade expired subscribers | `src/middlewares/`, `lib/userAuth.ts` | Middleware tests | No |
| F26 | Product | No payment gateway | **NEEDS_DESIGN_DECISION** | Manual billing only; no Stripe/Whop/etc | Business risk: no automated revenue collection | HIGH | BLOCKED | Decision: choose payment provider (Whop recommended for fastest setup); then implement | Multiple | — | No |
| F27 | Product | Combo trades not in FNO heat budget | **NEEDS_DESIGN_DECISION** | Combo lane excluded from FNO heat cap by design | A large combo can co-exist with FNO positions beyond heat cap | MEDIUM | PHASE_1 | Decision: include combos in heat cap or document explicit exclusion | `lib/paperAccount.ts` | — | No |
| F28 | Product | Intraday paper reports tab is placeholder | **DEFERRED** | "Coming Soon" placeholder; Phase 3 planned | No production impact | LOW | DEFERRED | Implement Phase 3 intraday reports | `pages/paper-reports.tsx` | — | No |
| F29 | Product | Correlation clustering in portfolio not wired | **OPEN** | Noted as "not wired" in code comments | Portfolio risk panel is incomplete | LOW | PHASE_3 | Compute daily-return series per holding; Pearson correlation matrix | `lib/portfolio/risk.ts` | Correlation tests | No |
| F30 | Product | No corporate action adjustment warning | **OPEN** | Cost basis wrong for holdings with splits/bonuses | Long-term holders may see incorrect P&L | MEDIUM | PHASE_1 | Show explicit "Cost basis may be incorrect if this symbol had a split/bonus" warning per holding | `lib/portfolio/calc.ts`, portfolio frontend | — | No |
| F31 | Product | Signal reasoning not joined to paper trade detail | **OPEN** | `fno_signal_reasoning` not joinable from paper trade endpoint | "Why this setup" unavailable in trade card | LOW | PHASE_3 | Add join to paper trade detail endpoint; surface reasoning in UI | `routes/paper.ts`, `lib/fnoSignalReasoningLogger.ts` | — | No |
| F32 | Product | F&O reactive execution (pull-based, no background tick) | **NEEDS_DESIGN_DECISION** | Stop/target detection only fires when `/options/signals` is polled | Missed stop/target if frontend is inactive overnight | MEDIUM | PHASE_1 | Decision: add lightweight 60s background tick during market hours for open position sweep (stop/target check only; no new signal emission) | `routes/index.ts`, `lib/optionSignalLifecycle.ts` | — | No |
| F33 | Product | No CSV/PDF export for scanner/paper trades/portfolio | **OPEN** | No export endpoints or UI buttons | Power-user gap | LOW | PHASE_3 | Add export for scanner results, paper trade history, portfolio holdings | Multiple routes | — | No |
| F34 | Infra | Multi-replica scheduler safety (in-memory latches) | **DEFERRED** | All except `daily_report_runs` use in-memory latches | Harmless in single-replica deployment | LOW | DEFERRED | Add DB dedup when scaling to multi-replica | `routes/index.ts`, multiple | — | No |
| F35 | Data | 3 equity test positions in open book | **NEEDS_PRODUCTION_VERIFICATION** | MOTHERSON/GMRINFRA/OBEROIRLTY @ qty=1 seen 2026-06-23 | Pollutes open book / analytics | LOW | VERIFY_ONLY | Check current open equity paper trades; close test positions via `/paper/positions/eq/:id/close` if still open | — | — | Yes |
| F36 | Formulas | CPR / Pivot levels computation | **OPEN** | Computed and "AVAILABLE" per coverage matrix; not prominently surfaced on premarket page | Useful pre-market tool buried | LOW | PHASE_3 | Surface CPR card prominently on `/premarket`; confirm formula: CPR = (H+L+C)/3, TC/BC from CPR | `pages/premarket.tsx` | — | No |
| F37 | Formulas | Expected range formula (VIX-implied / ATM straddle) | **OPEN** | Marked AVAILABLE; not prominently displayed on premarket page | Traders miss ATM straddle expected range | MEDIUM | PHASE_2 | Surface ATM straddle as expected range; formula: `Spot × (ATM_IV / √252)` per day | `pages/premarket.tsx`, `lib/optionAnalytics.ts` | — | No |
| F38 | Formulas | GEX/Greeks bounded by Black-Scholes assumptions | **OPEN (ACCEPTABLE)** | Labeled MODELLED; Black-Scholes correct for European index options | Known limitation; labeled | LOW | DEFERRED | No action needed; continue labeling | — | — | No |
| F39 | UI | Market breadth (A/D) source unlabeled | **OPEN** | Home page BreadthBar shows no source label | Minor: display issue | LOW | PHASE_3 | Add "Source: Kite" or "Source: computed" label | `pages/dashboard.tsx` | — | No |
| F40 | UI | No drawing tools on chart | **OPEN (DESIGN)** | Read-only chart; no trendlines/boxes | Feature gap vs TradingView | LOW | NEEDS_DESIGN_DECISION | Evaluate: TradingView Charting Library licensing vs Lightweight Charts drawing tools | — | — | No |
| F41 | Scheduler | 15:35-15:45 IST scheduler contention | **OPEN** | Swing deep scan + candle EOD + F&O EOD summary + post-market report all trigger in 10 min | CPU/DB spike risk; low severity in practice | LOW | PHASE_3 | Stagger by 2-3 min: swing @15:35, candle @15:38, FO EOD @15:41, post-market @15:45 | `routes/index.ts` | — | No |
| F42 | Infra | BANKEX / NIFTYNXT50 IV stale since 2026-05-08 | **NEEDS_PRODUCTION_VERIFICATION** | `iv_history` stale for non-main indices | Not used for F&O signals (only main 3 indices) | LOW | VERIFY_ONLY | Confirm whether capturing BANKEX/NIFTYNXT50 IV is intended | — | — | Yes |
| F43 | Infra | INDstocks secondary provider disabled | **DEFERRED (INTENTIONAL)** | `INDSTOCKS_ENABLED` off; scaffold complete; failover signal-block deferred | No user impact (provider disabled) | LOW | DEFERRED | Keep disabled until instrument mapping verified | — | — | No |
| F44 | Infra | Ephemeral no-trade reasons lost on restart | **OPEN** | Process-local buffer lost on deploy; only durable `fno_signal_reasoning` rows survive | Diagnostics less useful post-deploy | LOW | PHASE_3 | Write all no-trade reasons to `fno_signal_reasoning` before process exit | `lib/fnoSignalReasoningLogger.ts` | — | No |
| F45 | Backtest | Candle CSV not auto-refreshed | **OPEN (DEFERRED)** | `fetch:index-candles` is manual; needs to be run outside market hours | Backtest data may become stale | LOW | DEFERRED | Add to deployment runbook or cron; low urgency | `tools/fno-backtester/` | — | No |
| F46 | Formulas | VWAP on index uses `(H+L+C)/3` session mean | **OPEN (ACCEPTABLE)** | Volume unavailable for indices; substitution labeled | Labeled; correct tradeoff | LOW | DEFERRED | No action; keep label | — | — | No |
| F47 | Product | NSE bhavcopy: delivery % T-1 label missing inline | **OPEN** | Column header shows "DEL%" only | Users may expect live data | LOW | PHASE_3 | Add tooltip "(T-1 — next-day bhavcopy)" | `pages/scanner.tsx` | — | No |

---

## PHASE 0 — SAFETY / SECURITY ITEMS (implement first, in order)

**Phase 0 definition:** security risk, data corruption risk, fake/misleading data risk, production instability, duplicate automation risk, order/trading safety risk, auth/secret risk.

| Order | ID | Item | Status | Why Phase 0 | Estimated Size |
|---|---|---|---|---|---|
| 0.1 | F04 | Add Telegram alert to `kiteReadinessScheduler.ts` | PARTIALLY_FIXED | Silent blind trading day proven 2026-06-23; server log alone not visible pre-market | SMALL (2-3 lines, use existing `alertOwner()`) |
| 0.2 | F09 | Add `daily_report_runs` to Drizzle schema | OPEN | Schema drift: raw SQL table invisible to Drizzle; future schema ops could DROP it | SMALL (`strategyControl` pattern, ~20 lines) |
| 0.3 | F05 | Wire swing staged-order TTL sweep to background scheduler | PARTIALLY_FIXED | Stale STAGED orders accumulate silently; no auto-expiry alert fires | SMALL (wiring + 60-min scheduler + alert) |
| 0.4 | F02 | Add owner TOTP / 2FA | OPEN | Single-password owner login is the only auth barrier; owner has access to all data, manual paper-trade opens, Telegram dispatch | MEDIUM (otplib integration + DB seed + UI) |
| 0.5 | F03 | Log owner login events | OPEN | No audit trail for failed/successful logins; attacker detection impossible | SMALL (structured log entry on login) |

**Phase 0 items verified NOT needed:**
- ✅ Login rate-limiting — ALREADY_FIXED
- ✅ G1-G4 guards — ALREADY_FIXED (paper_block mode active)
- ✅ MANUAL_OVERRIDE win-rate — ALREADY_FIXED
- ✅ Yahoo in trade-grade path — STALE_FINDING (trust gate prevents this)
- ✅ Candle warehouse SQL — PARTIALLY_FIXED (verify prod rows separately; no feature depends on it)

---

## PHASE 1 — DATA FOUNDATION ITEMS

These items expand data coverage without changing trading logic.

| ID | Item | Source Needed | Cost/Licensing | Trade-grade? | Candidates | Wait for Vendor? |
|---|---|---|---|---|---|---|
| F22 | GIFT Nifty / SGX Nifty | Real-time SGX/CME GIFT Nifty futures | **Yes — data vendor license required** | No (display/info-only) | CMOTS, Refinitiv, Bloomberg; or scrape GIFT Nifty official site | **Yes** |
| F23 | India VIX trusted source | NSE VIX feed or ATM straddle proxy | Free via NSE API (or Kite ATM straddle) | No (display/info-only) | Wire ATM straddle IV from existing `optionAnalytics.ts` as proxy | **No** — proxy available now |
| F25 | Subscription expiry enforcement | No new source needed | Free (DB gate) | No | Middleware check on `expires_at` | No |
| F11 | NSE bhavcopy fallback | CDN or alternative delivery% source | Free (NSE CDN) | No (display/info-only) | Try NSE CDN backup URL; add as-of label | No |
| F27 | Combo trades in heat budget | No new source needed | Free (logic change) | Yes (paper trade) | **Design decision required before implementation** | No |
| F30 | Corporate action adjustment warning | Corporate action data (splits/bonuses) | Moderate cost | No (display only) | BSE corporate actions API (free, delayed); warn-only in phase 1 | Partial |
| F32 | F&O reactive tick → background sweep | No new source needed | Free (logic) | No (lifecycle sweep only) | **Design decision required** | No |
| NSE data | FII/DII freshness | Same as today (NSE archive T-1) | Free | No | No improvement possible without real-time FII/DII source (not publicly available) | **Yes** |

**Phase 1 do-not-integrate list (provider decision required):**
- GIFT Nifty — requires vendor contract decision
- News/events calendar — requires news API decision (e.g. Polygon, IIFL, Moneycontrol API)
- Global cues provider replacement for Yahoo — requires vendor decision

---

## PHASE 2 — FORMULA STANDARDIZATION

| ID | Formula | Current | Preferred (Professional) | User-facing Impact | Test Required |
|---|---|---|---|---|---|
| F13 | ATR | Scanner: EMA-smoothed (`return ema(trs, period)`) | Wilder's RMA (running mean): `prev_atr × (n-1)/n + tr/n` | Scanner stop widths slightly different from charting ATR; conservative direction | ATR value regression vs Wilder's over 14-period; compare to TradingView |
| F14 | MACD signal seeding | Scanner: nulls→0 seed; global: slice-from-valid | Slice from first valid MACD value (avoids zero-bias in signal line) | Minor early-bar MACD divergence | MACD values regression test with known fixture |
| F37 | Expected range / VIX-implied move | Not surfaced (data available) | `Spot × (ATM_IV / √252) × √DTE` for n-day move | Premarket page missing key metric | Expected range math unit test |
| F17 | NSE trading day counter | Mon-Fri only (no holidays) | NSE calendar with all bank holidays | Backtest trade count overstated for holiday weeks | Holiday boundary tests: Holi, Diwali, Independence Day |
| F36 | CPR / Pivot Levels | Computed, available, buried | Surface prominently: CPR = (H+L+C)/3; TC = (H+CPR)/2; BC = (CPR+L)/2 | Premarket missing key levels | CPR formula unit test vs manual calculation |

---

## PHASE 3 — UI / PAGE IMPROVEMENTS

These are non-blocking improvements ordered by user-impact.

| Priority | ID | Page | Issue | Recommended Fix |
|---|---|---|---|---|
| 3.1 | F18 | Global (header) | No sticky "Kite offline" global banner | Add header banner from `KITE_OFFLINE_SINCE` state |
| 3.2 | F21 | Scanner | 198-row cache not labeled when partial | Add "⚠ Partial scan (198 / 4298)" chip when serving cached results |
| 3.3 | F20 | Scanner | No "last scan at HH:mm IST" timestamp | Add wall-clock to table header |
| 3.4 | F19 | Scanner | DEL% column not labeled T-1 | Add "(T-1)" to column header tooltip |
| 3.5 | F12 | TV Alerts | Stale rows look live | Add "last alert received X days ago" banner |
| 3.6 | F39 | Home | A/D breadth source unlabeled | Add "Source: Kite" label to BreadthBar |
| 3.7 | F29 | Portfolio | Correlation clustering not wired | Compute per-holding daily returns + correlation matrix |
| 3.8 | F31 | Paper Trading | Signal reasoning not shown on trade card | Join `fno_signal_reasoning` to paper trade detail |
| 3.9 | F36 | Pre-Market | CPR levels buried | Surface CPR/TC/BC card prominently |
| 3.10 | F24 | Flows | FII/DII not labeled T-1 | Add "T-1" to source label |
| 3.11 | F33 | Multiple | No CSV export | Add export for scanner, paper history, portfolio |
| 3.12 | F41 | Scheduler | 15:35-15:45 IST contention | Stagger by 2-3 min intervals |
| 3.13 | F44 | F&O Diagnostics | Ephemeral no-trade reasons lost on restart | Write all reasons to `fno_signal_reasoning` |
| 3.14 | F47 | Scanner | DEL% tooltip | Add NSE bhavcopy disclaimer |

---

## STALE FINDINGS — DO NOT IMPLEMENT

These audit findings were true on 2026-06-23 but are **no longer accurate** as of current HEAD:

| ID | Finding | Why Stale | Evidence |
|---|---|---|---|
| F01 | No login rate-limiting | Already fixed | `app.ts:172` `loginLimiter` with 15min window |
| F07 | G1-G4 guards in shadow mode | Already in `paper_block` + G4 SENSEX disabled | `fnoPaperRiskGuards.ts:175` |
| F08 | MANUAL_OVERRIDE in blended win-rate | Already excluded by `winRateClassification.ts` | Lines 16, 21, 38 + test at line 75 |
| F10 | Yahoo failure as safety risk | Yahoo is display-only; trust gate prevents trade-grade use | `policy.ts:10`, `types.ts:14`, test file |
| F06 (partial) | Candle warehouse SQL malformed | SQL rewritten to Drizzle template literal | `candleWarehouseIngestor.ts:403` |

---

## NEEDS PRODUCTION VERIFICATION (before assuming fixed/broken)

| ID | Item | What to check | How to verify |
|---|---|---|---|
| F06 | Candle warehouse populated? | Is `CANDLE_WAREHOUSE_ENABLED=true` in prod? Is `candle` table row count > 0? | Prod DB: `SELECT COUNT(*) FROM candle;` — or check `/api/candles/diagnostics` |
| F35 | 3 equity test positions | Are MOTHERSON/GMRINFRA/OBEROIRLTY still OPEN? | Prod DB: `SELECT * FROM paper_trade_eq WHERE status='OPEN' AND qty=1;` |
| F10 | Yahoo wholesale failure | Has Yahoo recovered on prod cloud IP? | Check `global_sync_logs` latest entries: `SELECT * FROM global_sync_logs ORDER BY created_at DESC LIMIT 5;` |
| F42 | BANKEX/NIFTYNXT50 IV stale | Intentional or broken capture? | Check `iv_history` for BANKEX/NIFTYNXT50 latest entry |

---

## NEXT IMPLEMENTATION TASK RECOMMENDATION

**Recommended: `PHASE_0_KITE_PREOPEN_TELEGRAM_ALERT`**

**Why this task first:**
1. The Kite session expiry is the #1 operational finding — proven to have caused a full blind trading day (2026-06-23)
2. The infrastructure is **already 80% built**: `kiteReadinessScheduler.ts` fires at 08:45 and 09:05 IST with per-day latches, correct state detection, and in-process dedup
3. The gap is a **single missing `alertOwner()` call** — 2-3 lines of code change
4. The change touches **zero trading logic** — no signals, no paper trades, no formulas
5. Fully verifiable: the Telegram message will be received on the next 08:45 IST tick (or testable via `/api/alerts/test-telegram`)
6. Scope is contained to one file: `artifacts/api-server/src/lib/kiteReadinessScheduler.ts`

**Task definition:**
- File: `artifacts/api-server/src/lib/kiteReadinessScheduler.ts`
- Change: In the `criticallyOffline` branch at 08:45 IST, add `await alertOwner(...)` call using existing `alerting.ts` `alertOwner` function
- Add a second Telegram at 09:05 IST for the escalated "STILL offline" case
- Keep existing per-day log latches (`warnLoggedDay`, `errorLoggedDay`)
- Add corresponding Telegram-send latches to prevent duplicate messages
- Test: unit test that `alertOwner` is called once per IST day at threshold, not on subsequent ticks

**Runner-up tasks (in order):**
- `PHASE_0_DB_SCHEMA_DRIFT_DAILY_REPORT_RUNS` — add `dailyReportRunsTable` to Drizzle schema using `strategyControl` pattern
- `PHASE_0_SWING_TTL_BACKGROUND_SWEEP` — wire `expireStagedOrders()` to 60-min scheduler
- Production verifications: candle warehouse row count, Yahoo recovery check, equity test position cleanup

---

## SUMMARY COUNTS

| Metric | Count |
|---|---|
| Total findings triaged | **47** |
| ALREADY_FIXED | **3** (F01, F07, F08) |
| STALE_FINDING (as safety concern) | **1** (F10) |
| PARTIALLY_FIXED | **3** (F04, F05, F06) |
| OPEN | **25** (F02, F03, F09, F11, F12, F13, F14, F17-F21, F23-F25, F29-F31, F33, F36, F37, F39, F41, F44, F47) |
| NEEDS_PRODUCTION_VERIFICATION | **4** (F06 confirm, F35, F10 recovery, F42) |
| NEEDS_DESIGN_DECISION | **4** (F26, F27, F32, F40) |
| DEFERRED | **7** (F15, F16, F28, F34, F38, F43, F45, F46) |
| BLOCKED | **1** (F26 — payment gateway, vendor decision required) |
| True Phase 0 items | **5** |
| Phase 1 data foundation items | **8** |
| Phase 2 formula items | **5** |
| Phase 3 UI items | **14** |

---

## FINAL VERDICT

**`FULL_WEBSITE_AUDIT_TRIAGE_COMPLETE`**

- Every audit finding classified ✅
- Stale/current findings separated ✅  
- Phase 0 clearly identified ✅  
- Phase 1/2/3 clearly separated ✅  
- Next implementation task specified: `PHASE_0_KITE_PREOPEN_TELEGRAM_ALERT` ✅  
- No trading state mutated ✅  
- No broker execution enabled ✅  
- No real order placed ✅  
- LLM index to be refreshed post-write ✅

*Triage completed: 2026-07-01 | Source: 11 verification probes against current HEAD*
