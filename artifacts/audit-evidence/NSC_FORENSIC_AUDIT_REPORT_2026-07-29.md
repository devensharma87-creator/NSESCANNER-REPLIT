# NSC Scanner — Forensic Audit Report
**Audit Date:** 2026-07-29  
**Conducted by:** Replit Agent (Main Branch)  
**Audit Prompt:** NSC_Scanner_Forensic_Audit_Prompt_1785318358649.pdf (46 sections)  
**Repository HEAD:** `be186dd`  
**Production Commit:** `e7ae0783` (built 2026-07-23T06:17:24Z, booted 2026-07-29T08:59:38Z)

---

## D1 — Executive Verdict

**Overall Assessment: CONDITIONAL PASS with 5 P0 blockers requiring immediate resolution before any new production publish.**

The platform is structurally sound in its non-trading layers (data ingestion, market-status gating, indicator arithmetic, security, and test coverage). All three F&O signal-path overhauls from Phase A0.3 (VWAP honesty, ConfluenceInputs/VetoInputs, routing state contract) are complete and unit-verified in dev — but **not yet deployed to production**.

The paper-trading engines are in a dual-locked state: `FNO_AUTO_OPEN_C0_BLOCKED = true` and `EQUITY_AUTO_OPEN_C0_BLOCKED = true` both hard-code to `null` inside the respective open functions, meaning **zero automated paper trades have ever been opened by either engine during any session** regardless of signals. While these kill-switches are intentional safety gates, the audit reveals they masked a set of underlying entry-gate defects that would also have blocked trades even without the kill-switches. The combination produces a zero-trade outcome that is functionally correct for the current safety posture, but which cannot be verified as "would work if re-enabled" without resolving the Phase B admission failure and EQUITY cutoff absence.

The most consequential finding is the **TESTSTK ledger contamination**: a real-symbol test trade (`TESTSTK`, source `SWING_STAGED_APPROVAL`) was opened post-market (16:33 IST, after 15:30 close) on 2026-07-18 in the production paper equity ledger, and three earlier same-source TESTSTK positions (opened in-session on 2026-07-10, -13, -14) remain permanently OPEN. Total locked capital: ₹20,000. These are swing staging integration test records that bypassed test isolation and wrote into the live database.

| Layer | Verdict |
|---|---|
| Architecture / API | ✅ Pass |
| Data providers & trust | ✅ Pass |
| Market-status gating | ✅ Pass |
| Indicator arithmetic | ✅ Pass (minor VIX field bug P1) |
| F&O signal engine | ✅ Pass (VWAP honesty complete in dev) |
| F&O paper engine | ⚠️ Conditional — dual kill-switch + Phase B fail-closed |
| Swing engine | ⚠️ Conditional — EQUITY cutoff null, kill-switch |
| Paper ledger integrity | ❌ FAIL — TESTSTK contamination + post-market breach |
| Production parity | ❌ FAIL — 30 commits undeployed |
| Security | ✅ Pass (one P2 observation) |
| Testing | ✅ 4298/4301 (3 DB isolation skips), Scanner 843/843 |

---

## D2 — Complete System Inventory

### 2.1 Infrastructure
| Item | Value |
|---|---|
| Runtime | Node.js v24.13.0, pnpm 10.26.1, NixOS |
| Framework | Express + Drizzle ORM + PostgreSQL |
| DB connection pool | max=10, 10s timeout, keepAlive enabled |
| Production deployment | Replit Autoscale |
| Kite WebSocket | KiteConnect v5, timeout=15000ms (fixed) |
| Kite session expiry | ~06:00 IST daily — manual re-login required |
| Session encryption | AES-256-GCM via KITE_TOKEN_ENC_KEY |

### 2.2 Database Tables (27 distinct tables across 17 schema files)

| Schema Group | Tables |
|---|---|
| App state | `app_state` |
| Backtest | `backtest_runs`, `backtest_trades`, `backtest_blocked_setups` |
| Candle warehouse | `candle`, `candle_sync_run` |
| F&O signals | `fno_signal_reasoning`, `fno_signal_reasoning_archive_pre_dedupe`, `option_signal_history`, `option_signal_plan_audit` |
| Global scanner | `global_instruments`, `global_candles`, `global_live_prices`, `global_watchlist`, `global_sync_logs`, `global_screener_presets`, `global_instrument_overrides` |
| Institutional flows | `fii_dii_daily`, `participant_oi_daily` |
| Instruments | `instrument_map`, `indstocks_token`, `kite_session` |
| IV history | `iv_history` |
| Option chain | `option_chain_snapshot`, `option_chain_snapshot_run` |
| Paper trading | `paper_account`, `paper_trade_fo`, `paper_trade_eq`, `paper_eq_audit`, `paper_daily_summary_fo`, `paper_capital_event`, `paper_trade_combo`, `paper_trade_combo_leg` |
| Portfolio | `portfolios`, `portfolio_holdings` |
| Runtime tables | `daily_report_runs`, `notification_delivery_log`, `system_alert_dedup`, `system_alert_state`, `reconciliation_report` |
| Strategy control | `strategy_definitions`, `strategy_engine_state` |
| Swing | `swing_order_staging`, `swing_scan_result`, `swing_scan_run` |
| TV alerts | `tv_alerts` |
| Users | `users`, `personal_watchlist` |

### 2.3 API Routes
38 route files, 120+ endpoints. Major groups:
- `/api/fno/*`, `/api/paper/*`, `/api/paper/combos/*` — paper trading & F&O lifecycle
- `/api/swing/*` — swing scanner, staging, approval
- `/api/data/*`, `/api/candles/*`, `/api/option-snapshots/*` — market data
- `/api/kite/*` — Kite auth and session management
- `/api/admin/*`, `/api/system/*` — system operations
- `/api/global/*` — global scanner (independent password gate)
- `/api/inst/*` — institutional flows
- `/api/backtest/*` — backtest engine
- `/api/webhooks/tradingview` — TradingView alert ingestion

### 2.4 Scheduled Jobs (setInterval-based)
| Job | Interval | File |
|---|---|---|
| News RSS refresh | TTL-based (~5 min) | newsRss.ts |
| Stocks-to-watch | TTL-based | stocksToWatch.ts |
| Global data layer (Binance + others) | 30s / per-source | global/dataLayer.ts |
| Preset scheduler tick | 30s | global/presetScheduler.ts |
| Institutional flows | 15 min | instFlows.ts |
| Paper F&O daily summary | once at 15:35 IST | paperDailySummaryFo.ts |
| Candle warehouse daily | 5 min | candleWarehouseIngestor.ts |
| Candle warehouse intraday | 15 min | candleWarehouseIngestor.ts |
| Candle retention sweep | daily | candleWarehouseIngestor.ts |
| Swing scanner deep | ≥15:35 IST, 60s check | swingScannerStore.ts |
| Swing scanner intraday | own interval | swingScannerStore.ts |
| Swing TTL sweep | 10 min (unref'd) | swingTtlSweep.ts |
| EOD reconciliation | daily | eodReconciliation.ts |
| OI Lab tracker | configurable | oiLab.ts |
| Option chain ingestor | configurable | optionChainSnapshotIngestor.ts |
| Kite readiness scheduler | periodic | kiteReadinessScheduler.ts |
| Instruments integrity | periodic | marketData/instrumentsIntegrity.ts |
| Staleness watchdog | periodic | marketData/stalenessWatchdog.ts |
| Clock drift check | periodic | clockDrift.ts |
| Daily reports | once daily | dailyReports.ts |
| Deepscan bhavcopy | 15 min | deepscan.ts |

### 2.5 Frontend Artifacts
- **NSE Stock Scanner** (`artifacts/scanner`) — primary trading terminal
- **Global Multi-Asset Scanner** (`artifacts/global`) — crypto/forex/global markets
- **API Server** (`artifacts/api-server`) — Express backend
- **Mockup Sandbox** (`artifacts/mockup-sandbox`) — design prototyping

---

## D3 — Tab-by-Tab Audit Matrix

### Home / Daily Analysis
| Check | Status | Notes |
|---|---|---|
| Pre-market cues load | ✅ | Uses Yahoo + computeMarketStatus |
| VIX level displayed | ❌ **P1** | VIX field contains `regularMarketPrice` which for `^INDIAVIX` returns intraday change-% (~2-3.42) instead of level (~13-14); the level-typed field is mislabeled. `compositeBias.ts:53` explicitly documents this as `vixChangePct`, which is correct, but the `fno_signal_reasoning.vix` column was found to contain values 2.02–3.42 on 2026-07-17 when India VIX was 13–14 — the column name implies level. |
| Regime label | ❌ **P1** | Classifier labeled all 3 indices as RANGING on 2026-07-17, a day with clean breakout trending character (+1.13%/+1.67%/+1.32%). Regime label inconsistency with realized behavior quantified in case_study_2026-07-17.md. |
| Session gate (computeMarketStatus) | ✅ | Pure IST offset arithmetic; correct pre-open/open/closed boundaries; NSE 2026 holiday list curated to 15 dates from NSE Circular NSE/CMTR/71775 (updated 2026-07-22). |
| Suppression event persistence | ❌ **P1** | "SUPPRESSED BY: MARKET CLOSED · 12" counter is an in-memory `suppressed[]` array in `optionSignals.ts:1517`; not persisted; lost on restart; no timestamped audit trail per event. |

### Scanner (F&O / Options tab)
| Check | Status | Notes |
|---|---|---|
| Signal generation | ✅ | EMA-pullback confirmed VWAP-free; VWAP correctly flows as `null` for cash indices |
| VWAP availability gate | ✅ | `vwapAvailable` flag gates VP/VWAP checks; cash indices (NIFTY/BANKNIFTY/SENSEX) correctly excluded from fullIndicators warm-up gate |
| Route state contract | ✅ | `getOptionSignals()` returns exactly 9 `indexFnoSetupAvailability` records unconditionally (pure static function `computeAllIndexFnoSetupAvailability()`) |
| A0.3 VWAP honesty (dev) | ✅ | `Ctx.pivotRef` removed; `ConfluenceInputs/VetoInputs.vwap` = `number | null`; null = VWAP-unavailable canonical |
| A0.3 in production | ❌ **P0** | Not deployed — production is on `e7ae0783` (2026-07-23), 30 commits behind |

### F&O Paper Engine
| Check | Status | Notes |
|---|---|---|
| Kill-switch (C0) | INFO | `FNO_AUTO_OPEN_C0_BLOCKED = true` hard-coded; no trades opened since deployment |
| Phase B admission | ❌ **P1** | `computeFinalExecutionAdmission` always returns `TRADE_ADMISSION_CONTEXT_INCOMPLETE` — Kite option chain lacks per-contract exchange timestamps needed to satisfy the Phase B quoteAge check (requires `quoteAgeSec > 0`); would block all trades even if C0 removed |
| PAPER_TRADING_ENABLED | INFO | `false` in production env — `reconcileMissingPaperTrades` returns 0 immediately |
| Ledger serialization | ✅ | `SELECT FOR UPDATE` on paper_account, CAS close (`status='OPEN'`), ON CONFLICT DO NOTHING on open |
| P&L computation | ✅ | Gross = `(exitPremium - entryPremium) × qty × lotSize`; net = gross - charges; `dayRealizedPnl` is GROSS, `balance` credited NET |
| Lot-size sourcing | ✅ | Live Kite cache first; static fallback; `LOT_SIZE_DRIFT` alarm on divergence |
| OI units | ✅ | `q.oi` in contracts (lots), multiplied by lot_size for quantity |
| Daily summary (paper_daily_summary_fo) | INFO | All days show 0 opened/closed — consequence of C0 kill-switch |

### Swing / Equity Engine
| Check | Status | Notes |
|---|---|---|
| Kill-switch (C0) | INFO | `EQUITY_AUTO_OPEN_C0_BLOCKED = true` hard-coded |
| EQUITY_AUTO_ENTRY_CUTOFF | ❌ **P1** | Env var is `null` → `computePreliminaryAdmission` fails closed with no cutoff defined; would block all equity auto-entries even without C0 |
| Swing scan universe | ✅ | NIFTY 500 (`NIFTY500_SYMBOLS`), deep scan ≥15:35 IST, intraday refresh own interval |
| Staged approval state machine | ✅ | PENDING → APPROVED → FILLED → CLOSED; capital reservation locked at approval; `riskDecisionJson` frozen |
| TESTSTK contamination | ❌ **P0** | See §D5 |
| Swing TTL sweep | ✅ | 10-min interval, unref'd; handles PENDING → CANCELLED on TTL expiry |
| Swing session gate | ✅ | Corrected in equity session gate fix (P0.2 era); `computeMarketStatus` gates `openPaperEquityTrade` |

### Backtest Lab
| Check | Status | Notes |
|---|---|---|
| Mode labeling | ✅ | `REAL_REPLAY` = real historical premium fills only; `DIRECTIONAL` = synthetic delta proxy, all fields flagged `modeled: true` + `dataQuality.modeledFields` list |
| Stop distance vs premium stop | ❌ **P1** | Mismatch documented in `backtest-lab-synthetic-premium.md`: synthetic premium uses fixed ~0.40% spot / ~0.50 delta; stop-doc mismatch; owned by separate later task |
| Premium replay | ✅ | `premiumReplay.ts` sourced from real Kite snapshots where available |

### Portfolio / Holdings
| Check | Status | Notes |
|---|---|---|
| CMP source | ✅ | CMP computed live at request time, not stored |
| Data authenticity | ✅ | `DATA_AUTHENTICITY: omit, never fabricate` policy enforced; missing data labeled not faked |
| Quote source labeling | ✅ | `quote_source` field surfaced; Yahoo labeled as secondary/DELAYED |

### OI Lab
| Check | Status | Notes |
|---|---|---|
| OI units | ✅ | Contracts (lots), not shares; verified 2026-07-08 |
| OI backfill queue | ✅ | Separate `isBackfill:true` cap (BACKFILL_MAX_QUEUE=8) prevents crowding live slots |
| Tracker state machine | ✅ | `trackerState.timer` owned; overlapping tick protection via `isExecuting` flag |

### Global Scanner
| Check | Status | Notes |
|---|---|---|
| Auth gate | INFO | Independent password gate (separate from NSE `requireAuth`); global routes bypass NSE owner gate |
| Data freshness | ✅ | `safeFireAndForget` prevents rejection escapes from setInterval dispatches |

---

## D4 — Master Issue Register

### P0 — Blocker (requires resolution before next production publish)

#### P0-1: TESTSTK post-market trade — session gate breach
**Evidence:** `paper_db_snapshot_C0_2026-07-18.sql`, `paper_eq_audit` rows  
**Detail:** A TESTSTK equity paper trade (`id=059f44c7`, source=`SWING_STAGED_APPROVAL`) was inserted at `2026-07-18 11:03:32 UTC = 16:33 IST`. Market close is 15:30 IST. This is a 63-minute post-market breach. The trade entered the **production** paper equity ledger (C0 forensic snapshot). The staged-order approval flow bypassed the `computeMarketStatus` session gate — the approval route did not re-validate market-open state at fill time.  
**Impact:** Capital accounting integrity. One trade in the ledger carries incorrect session-admission semantics. The post-market entry would have received a stale quote, not a real execution price.  
**Root cause:** The swing staged approval execution path (`SWING_STAGED_APPROVAL` source) does not check `computeMarketStatus` at fill time; only the automated open path does.  
**Fix required:** Add `computeMarketStatus(new Date())` check inside the staged-order fill handler; return 422 if market is closed.

#### P0-2: TESTSTK ghost positions — 4 permanently OPEN records
**Evidence:** `paper_db_snapshot_C0_2026-07-18.sql`  
**Detail:**
| ID (short) | Opened (UTC) | Opened (IST) | Session? |
|---|---|---|---|
| 72fbe09b | 2026-07-10 07:55:37 | 13:25 | ✅ In-session |
| 726d2236 | 2026-07-13 06:29:27 | 11:59 | ✅ In-session |
| 645c8a3f | 2026-07-14 06:52:09 | 12:22 | ✅ In-session |
| 059f44c7 | 2026-07-18 11:03:32 | **16:33** | ❌ Post-market |

All 4 status=OPEN with no exit mechanism — TESTSTK is not a real symbol; no live price exists; paper exit monitoring will never trigger. Total locked capital: **4 × ₹5,000 = ₹20,000**.  
EQUITY balance understates available cash by ₹20,000 permanently.  
**Root cause:** `swingOrderStaging.test.ts` Case 10 fixture used a real `SWING_STAGED_APPROVAL` codepath against the production database (test isolation was absent or bypassed). The `paper_eq_audit` shows these trades originating from `staged_order_id` UUIDs that were created by integration tests.  
**Fix required:** (a) Manual DB cleanup of the 4 TESTSTK rows and corresponding `paper_eq_audit` entries; (b) enforce `TEST_DATABASE_URL` isolation guard in all swing staging integration tests (mirroring `dbTestGuard.ts` pattern).

#### P0-3: F&O Phase B admission permanently fails closed
**Evidence:** `paperTradingFO.ts:942`, `sessionAdmission.ts`  
**Detail:** `computeFinalExecutionAdmission` has been patched (P0.2 Corrections 1–4) to always return `TRADE_ADMISSION_CONTEXT_INCOMPLETE` because Kite option chain data does not include per-contract exchange timestamps. `quoteAgeSec` must be `> 0` to pass the age gate; it currently receives `NaN` (P0.2 F&O quote-age proxy prohibition fix). This means: even if `FNO_AUTO_OPEN_C0_BLOCKED` were set to `false`, **no F&O paper trade would open** — Phase B gates them all off.  
**Impact:** The kill-switch is redundant; Phase B is the actual blocker. The owner cannot verify whether the broader F&O signal funnel works end-to-end without resolving Phase B first.  
**Fix required:** Implement a per-contract quote timestamp source from Kite option chain fetch metadata; pass real `quoteAgeSec` to `computeFinalExecutionAdmission`.

#### P0-4: Production 30 commits behind dev HEAD
**Evidence:** `git log --oneline e7ae078..HEAD` (30 commits)  
**Production build date:** 2026-07-23T06:17:24Z (6 days ago)  
**Key undeployed work:**
- `be186dd` — A0.3 VWAP decision-path honesty (memory update)
- `9306e0a` — A0.3 audit evidence
- `faa1d0a` — Option signals confluence engine stability refactor
- `efb153a`, `62552dc`, `a1388b1`, `c8ac1be`, `ae48a29` — A0.3.2 complete (pivotRef/authVwap rename, 9-record contract)
- `f14fc11`, `d3c6083`, `a4d747b`, `b94732d`, `33d4320` — A0.3.1 complete
- `d42d8b4` — option signals logic update
- All Phase A0.3 VWAP honesty signal-path changes

**Impact:** Production is still running the pre-A0.3 confluence engine with the old `Ctx.vwap` VWAP-substitution path that A0.3 specifically corrected for honesty.  
**Fix required:** Publish to production after resolving P0-1 through P0-3.

#### P0-5: DLF incident — unresolvable from forensic snapshot
**Evidence:** Audit prompt §"Historical Stop-Ship Incident", `paper_db_snapshot_C0_2026-07-18.sql`  
**Detail:** The audit prompt requests investigation of a "DLF AUTO paper trade recorded at approximately 18 Jul · 16:00:28." No DLF row exists in `paper_trade_fo` or `paper_trade_eq` in the forensic snapshot. `18 Jul 16:00:28 IST = 10:30:28 UTC` — not present in the snapshot. The snapshot was taken at some point on 2026-07-18 and shows the EQUITY balance at ₹10,17,024.86 with the most recent event being TESTSTK at 11:03:32 UTC (16:33 IST).  
**Possible explanations:** (a) The DLF trade was opened and immediately rolled back before commit; (b) it existed in a table not captured by the snapshot; (c) it was manually deleted before the snapshot; (d) the "16:00:28" timestamp in the prompt is IST and equates to a different UTC time that predates the snapshot.  
**Impact:** Cannot confirm or deny whether a real DLF position was opened post-market and whether additional capital was debited. The 4 TESTSTK positions are confirmed; DLF remains unverified.  
**Fix required:** Query live production database for any DLF row (including soft-deleted / archived tables) or check Telegram notification logs for a DLF entry notification.

---

### P1 — High Priority

#### P1-1: VIX field corruption in `fno_signal_reasoning`
**Evidence:** `case_study_2026-07-17.md`, `compositeBias.ts:53`  
**Detail:** The `fno_signal_reasoning.vix` column stores values 2.02–3.42 on 2026-07-17 when India VIX was ~13–14. The values are consistent with intraday change-percent being written to the level-typed column. `compositeBias.ts` correctly defines `vixChangePct` as a change-percent, but the field name `vix` in the reasoning logger implies a level. Any downstream consumer reading `fno_signal_reasoning.vix` as a level value will mis-classify volatility.  
**Fix required:** Clarify column semantics; if it stores change-%, rename to `vix_change_pct`; if it should store level, fix the write path.

#### P1-2: Regime classifier labels trending days as RANGING
**Evidence:** `case_study_2026-07-17.md` (three-index forensic case)  
**Detail:** On 2026-07-17, all three indices (NIFTY, BANKNIFTY, SENSEX) were stamped `regime=RANGING` across plans emitted 10:01–15:22 IST. All three delivered a clean afternoon breakout (+1.13%/+1.67%/+1.32%), confirming the session character was trending. Three triggered plans (NIFTY 24,288.90, BANKNIFTY 58,185.85, SENSEX 77,989.44) expired at 13:27 before the breakout materialized post-14:00. The regime label gated valid trend setups off at exactly the moment they'd be valid.  
**Fix required:** Regime classifier tuning; consideration of re-arm-on-retest lifecycle for crossed-but-expired plans.

#### P1-3: Kite session requires daily manual re-login
**Evidence:** `kiteAuth.ts:11` — "The token expires at ~06:00 IST the next morning; user re-logins daily."  
**Detail:** KiteConnect access tokens expire ~06:00 IST each day. There is no automated re-authentication mechanism. If the owner does not log in before the F&O session (09:15 IST), the entire signal pipeline is suppressed (centralIndexCandles returns null → F&O blocked). A missed login silently blocks all trades for the day.  
**Fix required:** Pre-session Telegram alert at 07:00 IST if no valid Kite session exists; retry/reminder mechanism; or explore Kite TOTP-based auto-login if permitted by the API agreement.

#### P1-4: EQUITY_AUTO_ENTRY_CUTOFF is null
**Evidence:** `paperTradingFO.ts:7` session-check comment, `sessionAdmission.ts`  
**Detail:** `EQUITY_AUTO_ENTRY_CUTOFF` is `null`, which causes `computePreliminaryAdmission` to fail closed with no cutoff defined. Even without the C0 kill-switch, no automated equity entry would be permitted.  
**Fix required:** Define a concrete cutoff (recommended: 14:45 IST matching BASELINE F&O cutoff) and set `EQUITY_AUTO_ENTRY_CUTOFF`.

#### P1-5: P0.1 suppression events have no persistence
**Evidence:** `optionSignals.ts:1517`, `case_study_2026-07-17.md` §"P0.1 evidence status: UNRESOLVED"  
**Detail:** The "SUPPRESSED BY: MARKET CLOSED · 12, OTHER · 5" UI counter is sourced from an in-memory `suppressed[]` array aggregated at request-time. No per-event row is written anywhere. Suppression events cannot be audited, back-filled, or distinguished by timestamp. The counter resets on every server restart.  
**Fix required:** Write one row per suppression event (signal_date, index_symbol, reason_code, suppressed_at timestamp) to `fno_signal_reasoning` with `verdict='SUPPRESSED'`; or extend `option_signal_plan_audit`.

---

### P2 — Medium Priority

#### P2-1: System alert dedup is in-memory-only
**Evidence:** `system-alert-dedup-architecture-gap.md`  
**Detail:** Data-health, Kite, and session Telegram alerts dedup via a plain `Map`. Under autoscale restarts or multi-replica deployments, duplicate alerts fire. Trade alerts and daily reports already use DB-backed dedup (correct pattern).  
**Fix required:** Migrate system alerts to `system_alert_dedup` table (already in schema) for cross-restart dedup.

#### P2-2: Backtest DIRECTIONAL premium model is synthetic
**Evidence:** `backtest/types.ts:10-12`  
**Detail:** DIRECTIONAL mode uses `SYNTHETIC_DELTA_PROXY` (fixed ~0.40% spot, ~0.50 delta proxy) rather than real historical option premiums. Every modeled field is flagged `modeled: true`. Stop-distance in the DIRECTIONAL summary does not account for realistic option premium decay. Disclosed in the data quality metadata, but the discrepancy between directional spot P&L and option P&L is material for NIFTY (high-IV, time-decay-sensitive) strategies.  
**Fix required:** Backtest Lab UI should display a prominent "SYNTHETIC P&L" disclaimer on DIRECTIONAL runs; consider adding a theta-decay adjustment term.

#### P2-3: Reconciliation report suppression risk on autoscale
**Evidence:** `autoscale-coldstart-500.md`  
**Detail:** Production autoscale first-request 500 on cold start; retry recovers. Any single-shot reconciliation report that fires in the cold-start window will fail. The `eodReconciliation.ts` interval-based reconciler mitigates this, but a one-shot manual trigger is at risk.  
**Fix required:** Add retry-with-backoff on autoscale reconciliation endpoints.

---

## D5 — Data Lineage and Provider Matrix

| Data Type | Primary Source | Trust Tier | Trade-Grade? | Fallback |
|---|---|---|---|---|
| F&O index quotes (NIFTY/BANKNIFTY/SENSEX) | Kite REST/WebSocket | `TrustedQuote` | ✅ Yes | None (hard-fail if unavailable) |
| Equity quotes (NSE) | Kite | `TrustedQuote` | ✅ Yes | Yahoo (DELAYED label, never trade-grade) |
| Index candles (day/15m) | Kite via candle warehouse | Trusted (fresh) / Stale (>10 min) | Fresh only | None |
| VWAP / Volume Profile | Kite intraday | VWAP-available flag | ✅ When available | `null` (canonical — never substitute spot) |
| Option chain (strike/premium/OI) | Kite REST | Trusted (per-fetch) | ✅ If quoteAgeSec>0 | None |
| India VIX | Yahoo `^INDIAVIX` via centralIndexCandles | INFO_ONLY (Yahoo) | ❌ Never | None |
| Global assets (crypto/forex) | Binance + others | DELAYED | ❌ Never | None |
| Institutional flows (FII/DII) | NSE bhavcopy | INFO_ONLY | ❌ Never | None |
| NSDL/BSE prices | Kite by instrument_token | Trusted (BSE-only) | ✅ For BSE instruments | Yahoo (labeled fallback) |
| INDstocks | Secondary validation only | Never trade-grade | ❌ Never | Not used for signals |

**Key invariants verified:**
- Hard-stale quotes (validationStatus=`stale`) are rejected unconditionally — not gated behind `strictFreshness` flag
- Yahoo is never imported directly into signal paths (provider-import burn-down policy enforced via `marketData/compat`)
- `TrustedQuote` brand is a TypeScript compile-time guard (`TradeableBrand`) — cannot be constructed without going through the trusted router
- Scanner row provenance is stamped by indicator/signal source (Yahoo), not live LTP source, preventing silent Yahoo→Kite promotion

---

## D6 — Calculation Verification

### 6.1 Market Status
**Implementation:** `marketEvents.ts:computeMarketStatus`  
**Method:** UTC epoch + 5.5h offset → IST wall-clock; weekday check (0=Sun, 6=Sat); holiday set lookup; session bounds [09:00–09:15) = pre_open, [09:15–15:30] = open.  
**Verified:** Correct IST arithmetic; no DST risk (IST is UTC+5:30 fixed); NSE 2026 holidays from official circular NSE/CMTR/71775 (15 dates, last updated 2026-07-22); provisional 2027 list present.

### 6.2 MACD
**Implementation:** Dual-copy (scanner + global); `startIdx` slice applied before signal EMA warm-up (P1B fix 2026-07-08).  
**Verified:** New listings (<35 bars) correctly receive `null` histogram (not distorted values); long-history candles unaffected; both copies aligned.

### 6.3 VWAP / Volume Profile
**Implementation:** `vwapAvailable` flag gates all VWAP/VP calculations; cash indices (NIFTY/BANKNIFTY/SENSEX) have volume=0 → flag=false → all VWAP references in `ConfluenceInputs/VetoInputs` receive `null` (not spot substitution).  
**Verified:** A0.3 VWAP honesty complete in dev; not yet in production (P0-4).

### 6.4 Black-Scholes / Options
**Implementation:** `blackScholes.ts`; NSE settlement at 15:30 IST = 10:00 UTC; date-only expiries also enforced at 15:30 IST settlement.  
**Noted:** Settlement time correct; no DST error possible (IST fixed).

### 6.5 F&O P&L
**Gross:** `(exitPremium - entryPremium) × qty × lotSize` — in premium points, lot-size adjusted.  
**Net:** gross - `computeFnoTradeCost` (STT 0.15%/0.05% eff 2026-04-01, brokerage, exchange charges).  
**Balance ledger:** Credits/debits use NET P&L; `dayRealizedPnl` field uses GROSS for report continuity.  
**Verified:** Consistent; STT rates current as of 2026-04-01 per `F&O cost model scope` memory entry.

### 6.6 Candle Time Convention
**Verified:** `candleUtcIso` used for IST-wall-clock-in-UTC emission; `.toISOString()` only in `replay.ts`; Kite candle CSV exported as IST-local naive format (`YYYY-MM-DD HH:MM:SS`) to prevent backtester +05:30 double-shift.

### 6.7 OI Units
**Verified:** `q.oi` and NSE `openInterest` are in contracts (lots); multiplied by lot_size for quantity. Confirmed 2026-07-08 via prod snapshot magnitude analysis.

---

## D7 — F&O Engine Audit

### 7.1 Signal Funnel (Candidate → Trade)
```
CANDIDATE (index in setup list)
  ↓ getSetupAvailability (9 indices)
  ↓ VWAP availability gate (cash indices: vwap=null)
  ↓ Market status gate (09:15–15:30 IST)
  ↓ EMA-pullback detection (VWAP-free confirmed)
  ↓ Confluence engine (ConfluenceInputs, VetoInputs — A0.3 complete)
  ↓ Circuit breaker (VIX spike, FII/DII divergence)
  ↓ Signal fingerprint dedup (option_signal_history)
  ↓ recordLifecycle → PENDING
  ↓ Trigger evaluation (bar.high/bar.low vs trigger price)
  ↓ recordLifecycle → TRIGGERED
  ↓ openPaperTrade (BLOCKED by FNO_AUTO_OPEN_C0_BLOCKED=true)
       AND/OR
  ↓ computeFinalExecutionAdmission → TRADE_ADMISSION_CONTEXT_INCOMPLETE (Phase B fail-closed)
```

**Status:** Signal funnel through TRIGGERED is functional. Paper trade open is doubly blocked (C0 kill-switch + Phase B). No F&O paper trades have been opened in production since deployment.

### 7.2 Setup Retirement
All three primary F&O setups (HC/BASELINE/EMA-pullback) are now:
- **RETIRED** for cash index F&O due to structural data limitations (volume=0 → VWAP/VP structurally null)
- Per A0.3, the correct response is `null` VWAP (not spot substitution)

### 7.3 Exit Monitoring
Exit reasons: `TARGET1_HIT`, `TARGET2_HIT`, `STOPPED`, `EXPIRED`, `MANUAL_OVERRIDE`, `TIME_EXIT_1520`, `TIME_EXIT_1430_EXPIRY`.  
Corrective-sweep close-first ordering enforced: close BEFORE lifecycle advance to prevent OPEN freeze on close failure.

### 7.4 Environment Label Type Safety
`/api/fno/*` `environment` field is `{env, autoTradingEnabled, reason}` — not a string. JSX rendering of this field would trigger React #31 error. All consumers must destructure the object before render.

---

## D8 — Swing Engine Audit

### 8.1 Staged Approval State Machine
```
GENERATED (swing_scan_result)
  ↓ swing_order_staging INSERT (status=PENDING, riskDecisionJson frozen)
  ↓ Owner approval (UI)
  ↓ status=APPROVED
  ↓ Fill execution (SWING_STAGED_APPROVAL source)
    → session gate: computeMarketStatus check (added P0.2 era)
    → NOT validated at fill time for post-market ← P0-1 finding
  ↓ status=FILLED → paper_trade_eq OPEN
  ↓ Exit monitoring (TTL sweep, stop/target/trail monitoring)
  ↓ paper_trade_eq CLOSED
```

### 8.2 Capital Reservation
Reserved at APPROVED state; checked against `availableCash` at fill time. `CONCURRENT_CAP` (zero balance) correctly gates further opens.

### 8.3 Kill Switch
`EQUITY_AUTO_OPEN_C0_BLOCKED = true` — no automated opens. Staged approval is a manual path; C0 applies only to the automation layer.

### 8.4 Scan Universe
NIFTY 500 (`NIFTY500_SYMBOLS`); deep scan triggered ≥15:35 IST; intraday refresh separate interval. ATM IV / 5cr daily turnover threshold blocks many mid/small-caps.

---

## D9 — Paper Trading and Capital Reconciliation

### 9.1 Account Balances (Forensic Snapshot 2026-07-18)
| Segment | Balance | Book Value | Account Value |
|---|---|---|---|
| EQUITY | ₹10,17,024.86 | ₹20,000 (4 × TESTSTK) | ₹10,37,024.86 |
| FNO | ₹10,06,281 (approx) | ₹0 (no open F&O trades) | ₹10,06,281 |

**Contamination:** ₹20,000 is permanently locked in the 4 TESTSTK ghost positions. True EQUITY available cash is ₹9,97,024.86 (₹20,000 below reported balance).

### 9.2 Capital Accounting Invariants
✅ `SELECT FOR UPDATE` on paper_account for all debits/credits  
✅ CAS close pattern (`status='OPEN'` in WHERE clause prevents double-credit)  
✅ ON CONFLICT DO NOTHING on trade open (idempotency on signal fingerprint)  
✅ `paper_capital_event` ledger for all top-ups/withdrawals  
✅ Balance credited with NET P&L, dayRealizedPnl carries GROSS

### 9.3 Historical Equity Trades (Closed)
| Symbol | Signal Date | Entry | Exit Reason | Gross P&L | Source |
|---|---|---|---|---|---|
| BAJAJ-AUTO | 2026-05-04 | ₹10,039 | TRAIL_STOP_HIT | +₹18,521 | LEGACY_UNKNOWN |
| MARICO | 2026-05-05 | ₹789 | TRAIL_STOP_HIT | +₹14,763 | LEGACY_UNKNOWN |
| MOTHERSON | 2026-05-07 | ₹128 | TRAIL_STOP_HIT | +₹12.88 | LEGACY_UNKNOWN |
| LICHSGFIN | 2026-05-06 | ₹560 | STOPPED | -₹1,496 | LEGACY_UNKNOWN |
| SIEMENS | 2026-05-05 | ₹3,850 | STOPPED | -₹462 | LEGACY_UNKNOWN |
| AARTIIND | 2026-05-06 | ₹513 | STOPPED | -₹2,153 | LEGACY_UNKNOWN |
| GODREJPROP | 2026-05-04 | ₹1,925 | STOPPED | -₹12,510 | LEGACY_UNKNOWN |

All historical trades carry `source=LEGACY_UNKNOWN` (pre-SWING_STAGED_APPROVAL era).

### 9.4 Open Positions (Snapshot)
4 × TESTSTK (ghost positions, no exit path, ₹100 entry, 50 shares each, total ₹20,000)

---

## D10 — Production vs Repository Parity

| Item | Production | Dev HEAD |
|---|---|---|
| Commit | `e7ae0783` | `be186dd` |
| Built | 2026-07-23T06:17:24Z | — |
| Booted | 2026-07-29T08:59:38Z | — |
| Gap | **30 commits, 6 days** | — |
| PAPER_TRADING_ENABLED | `false` | (dev default false) |
| LIVE_CASH_SWING_ORDER_ENABLED | `false` | — |
| SWING_CASH_EXECUTION_MODE | `paper_only` | — |
| PAPER_FO_SHADOW_EXITS_ENABLED | not set | `1` (dev only) |
| REASONING_WRITER_V2_ENABLED | `1` | `1` |
| A0.3 VWAP honesty | ❌ Not deployed | ✅ Complete |
| A0.3.1 authVwap proxy removal | ❌ Not deployed | ✅ Complete |
| A0.3.2 pivotRef/authVwap rename | ❌ Not deployed | ✅ Complete |
| Option chain confluence fix (faa1d0a) | ❌ Not deployed | ✅ Complete |
| swingOrderStaging Case 10 fix | ❌ Not deployed | ✅ In working tree |

**Action required:** Resolve P0-1 through P0-3 (and commit the Case 10 fix), then publish to production.

---

## D11 — Security Report

### 11.1 Authentication Architecture
| Mechanism | Coverage |
|---|---|
| `requireOwner` | Most `/api/*` routes; bypasses GET/HEAD in public-access mode |
| `requireOwnerStrict` | Secrets vault, Kite token metadata, data-health backbone, mode overrides |
| `requireAuth` | All NSE routes; subscriber-level access |
| Unauthenticated | `/api/healthz`, `/api/build-info`, `/api/auth/*`, `/api/kite/callback`, `/api/data-health/market`, `/api/data-health/global`, `/api/observability/*` |
| Special gate | `/api/kite/export-session` → `X-App-Password` header; `/api/webhooks/tradingview` → `TRADINGVIEW_WEBHOOK_SECRET` |

### 11.2 Findings
**✅ Pass:** AES-256-GCM encryption at rest for Kite tokens (`kiteCrypto.ts`)  
**✅ Pass:** CORS — `CORS_ORIGINS="*"` throws at boot; default same-origin; `credentials: true`  
**✅ Pass:** Rate limiting — login 5/15min/IP; webhooks 60/min/IP; general 300/min/IP  
**✅ Pass:** No secrets logged; `pino-http` excludes query strings; secrets vault masks values  
**✅ Pass:** Error handler prevents stack trace leakage to HTTP responses  
**✅ Pass:** `requireOwnerStrict` correctly gates Kite session metadata (token info, login URL)

**⚠️ P2 Observation:** `/api/inst/*` (Institutional Flows) — the security audit found this route group potentially lacks specific role-based gating beyond the global `requireAuth` gate. Depending on how `app.ts` mounts these routes, subscriber-authenticated users may have read access to institutional flow data. **Action required:** Verify mount order in `app.ts`; add `requireOwner` if inst-flows data is owner-only.

**⚠️ P2 Observation:** SSRF risk in `/api/kite/import-session` — fetches from a user-supplied URL, gated by `ALLOWED_PEER_HOSTS` allowlist. Misconfiguration of the allowlist could allow SSRF. Current default allowlist should be reviewed against actual Kite peer domains.

### 11.3 Public-Access Mode Risk
When `PUBLIC_ACCESS_MODE` is enabled, `requireOwner` bypasses all GET/HEAD requests. The `/api/paper/*` and `/api/fno/*` routes use `requireOwner`, meaning paper trade history, P&L, capital balances, and signal details are readable by any unauthenticated visitor in public mode. The owner is aware of this (it is the intended behavior), but it should be documented in the security posture for any future subscriber model.

---

## D12 — Testing Gap Report

### 12.1 Current Status
| Suite | Result |
|---|---|
| Scanner (`@workspace/scanner`) | 843/843 ✅ |
| API server (`@workspace/api-server`) | 4298 passed, 3 skipped (4301 total) ✅ |
| TypeScript (`tsc`) | 0 errors ✅ |
| Vitest pool | `--pool=threads` required for api-server (forks pool exceeds 120s) |

### 12.2 Known Coverage Gaps
| Gap | Risk | Recommendation |
|---|---|---|
| No e2e test for staged-order fill-time session gate | Post-market fills can bypass gate (P0-1 root cause) | Add Playwright test: approve staged order after 15:30, expect 422 |
| No integration test for Phase B admission path | Phase B fail-closed cannot be verified without real quoteAgeSec | Add unit test: mock quoteAgeSec=60, verify Phase B passes |
| No test for TESTSTK isolation guard | Integration tests wrote to production DB | Add dbTestGuard assertion to all swing staging tests |
| DB-backed tests isolated but require explicit opt-in | 51 files excluded from `test:unit` | Ensure CI uses `test:unit`; `test:db` is manual only |
| Suppression event persistence | P1-5: in-memory only, no DB write test | Add test: suppression event writes a row with timestamp |
| Backtest DIRECTIONAL disclaimer | UI-level check only | Add unit assertion that all DIRECTIONAL trades have `modeled=true` |

### 12.3 Stale-Date Fixture Pattern
**Memory entry confirmed:** Hardcoded future dates in proximity-guard tests silently drift into the production window. Canonical fix: always use dynamic `new Date(t + N * 86400000)` offsets. Applied in `swingOrderStaging.test.ts` Case 10 (A0.3.3 completion).

---

## D13 — Prioritised Remediation Roadmap

### Immediate (before next production publish)
| # | Item | Effort | Owner |
|---|---|---|---|
| R1 | Manual DB cleanup: delete 4 TESTSTK rows from `paper_trade_eq` + `paper_eq_audit`; adjust `paper_account.balance` for actual EQUITY available cash | 30 min | DBA / owner |
| R2 | Add `computeMarketStatus` session gate to staged-order fill handler; return 422 if post-market | 1h | Dev |
| R3 | Add `TEST_DATABASE_URL` isolation guard to all swing staging integration tests | 2h | Dev |
| R4 | Investigate DLF row: query prod DB for any DLF entry in paper tables, Telegram logs | 30 min | Owner |
| R5 | Publish A0.3 + all pending commits to production | 10 min | Owner |

### Sprint 1 (before F&O kill-switch re-enable)
| # | Item | Effort |
|---|---|---|
| R6 | Implement real quoteAgeSec from Kite option chain fetch timestamp → resolve Phase B fail-closed | 3h |
| R7 | Define EQUITY_AUTO_ENTRY_CUTOFF (e.g., 14:45 IST) | 1h |
| R8 | Add suppression event persistence to `fno_signal_reasoning` with per-event timestamp | 2h |
| R9 | Fix VIX column semantics: rename `fno_signal_reasoning.vix` to `vix_change_pct` or fix write path | 2h |

### Sprint 2 (quality & observability)
| # | Item | Effort |
|---|---|---|
| R10 | Migrate system alert dedup to `system_alert_dedup` table (DB-backed, cross-restart safe) | 2h |
| R11 | Add Kite session pre-market alert at 07:00 IST if no valid session | 1h |
| R12 | Add "SYNTHETIC P&L" banner to Backtest Lab DIRECTIONAL mode UI | 1h |
| R13 | Verify `/api/inst/*` auth mount order; add `requireOwner` if needed | 1h |
| R14 | Regime classifier improvement (backlog — see case_study_2026-07-17.md) | Separate task |

---

## D14 — Final Acceptance Manifest

### Audit Coverage
All 46 sections of the audit prompt addressed. Evidence collected from:
- Live codebase (38 route files, 27 tables, 120+ endpoints)
- Forensic snapshot `paper_db_snapshot_C0_2026-07-18.sql`
- Case study `case_study_2026-07-17.md`
- Git history (30-commit production gap)
- 5 parallel explore subagents (schema, paper trading, F&O engine, swing engine, security)
- Production deployment logs (build 2026-07-23, boot 2026-07-29)

### 40 Mandatory Questions (§29 Summary)

| # | Question | Answer |
|---|---|---|
| Q1 | Is any live capital at risk? | No — production has `PAPER_TRADING_ENABLED=false`, `LIVE_CASH_SWING_ORDER_ENABLED=false`. All trades are paper simulation only. |
| Q2 | Has any automated trade fired post-market? | Yes — TESTSTK at 16:33 IST on 2026-07-18 (paper, not live capital). |
| Q3 | Is the F&O engine generating real paper trades? | No — doubly blocked by C0 kill-switch + Phase B fail-closed. |
| Q4 | Is the equity engine generating real paper trades? | No — C0 kill-switch active. |
| Q5 | Is production running the latest code? | No — 30 commits behind dev HEAD. |
| Q6 | Are indicator calculations correct? | MACD ✅, ATR ✅, Pivots ✅, VWAP ✅ (null for cash indices). VIX column semantics ❌ P1. |
| Q7 | Is capital accounting sound? | Yes (SELECT FOR UPDATE, CAS close) — except TESTSTK contamination (₹20,000 ghost). |
| Q8 | Is Kite session encrypted? | Yes — AES-256-GCM. |
| Q9 | Are secrets exposed in logs or responses? | No — explicit masking in place. |
| Q10 | Is the session gate (09:15–15:30 IST) correctly implemented? | Yes for automated opens. No for staged-order fills (P0-1). |
| Q11 | Does the test suite pass? | 4298/4301 (3 DB isolation skips). Scanner 843/843. |
| Q12 | Are there hardcoded credentials? | No. All via env vars / encrypted DB. |
| Q13 | Is Yahoo data used for trade decisions? | No — Yahoo is INFO_ONLY, never TrustedQuote. |
| Q14 | Is the NSE holiday calendar current? | Yes — 15 dates for 2026, sourced from NSE/CMTR/71775. |
| Q15 | Does VWAP correctly handle zero-volume indices? | Yes (A0.3 complete in dev, not yet deployed). |
| Q16 | Is there data fabrication anywhere? | No — omit/label policy enforced. No `?? 0` / fake-n/a. |
| Q17 | Is option OI in correct units? | Yes — contracts × lot_size. |
| Q18 | Are lot sizes live-sourced? | Yes — `getCachedLotSizeForIndex()` with static fallback. |
| Q19 | Is the signal reasoning logger append-only? | Yes — immutable archive on pre-dedupe copy. |
| Q20 | Is suppression event history auditable? | No — in-memory only (P1-5). |
| Q21 | Is the backtest engine mode-labeled? | Yes — DIRECTIONAL trades have `modeled=true`. |
| Q22 | Is candle time convention correct (IST)? | Yes — `candleUtcIso`, not `.toISOString()`. |
| Q23 | Is the TESTSTK row a test artifact? | Yes — confirmed test-isolation failure; 4 rows in production paper ledger. |
| Q24 | Was DLF incident resolved? | Unresolved — no DLF row found in forensic snapshot (P0-5). |
| Q25 | Is regime classification reliable? | No — labels trending days as RANGING (P1-2). |
| Q26 | Is CORS configured correctly? | Yes — wildcard forbidden at boot; same-origin default. |
| Q27 | Is rate limiting active? | Yes — 3-tier (login/webhooks/general). |
| Q28 | Are Kite timeouts configured? | Yes — 15000ms (fixed from undefined). |
| Q29 | Is OI backfill isolated from live slots? | Yes — separate `isBackfill:true` cap (8 slots). |
| Q30 | Is clock drift monitored? | Yes — `clockDrift.ts` periodic check. |
| Q31 | Is reconciliation running? | Yes — `eodReconciliation.ts` interval-based. |
| Q32 | Are Telegram alerts deduped persistently? | Partially — trade alerts ✅; system health alerts ❌ (in-memory only). |
| Q33 | Is the candle retention configured? | Yes — 60 days intraday (configurable `CANDLE_WAREHOUSE_RETENTION_DAYS_INTRADAY`); daily indefinite. |
| Q34 | Is Black-Scholes settlement time correct? | Yes — 15:30 IST = 10:00 UTC for NSE. |
| Q35 | Are Drizzle schema tables complete? | Yes — `runtimeTables.ts` declares all runtime-created tables; no DROP risk. |
| Q36 | Is the provider burn-down policy enforced? | Yes — new modules must route via `marketData/compat`; direct Yahoo imports blocked. |
| Q37 | Is the F&O cost model unified? | Yes — `fnoCostModelGuard.ts` + `fnoCostModelUnification.test.ts`. |
| Q38 | Is the signal gate reconciled with `reconcileMissingPaperTrades`? | Yes — fail-closed gates honored in reconciliation path. |
| Q39 | Is tradeClass re-derived after tier mutation? | Yes — re-derived after `applyOiConfirmation`. |
| Q40 | Is the publish-time schema propagation understood? | Yes — dev ADD COLUMN reaches prod via Publish introspection. No direct DDL against prod. |

---

**Report compiled:** 2026-07-29  
**Next required action:** Owner to confirm TESTSTK cleanup, DLF investigation, and production publish authorization.
