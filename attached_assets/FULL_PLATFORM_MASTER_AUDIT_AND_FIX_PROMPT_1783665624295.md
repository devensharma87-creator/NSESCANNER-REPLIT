# MASTER CODER PROMPT — FULL PROFESSIONAL REBUILD AUDIT + FIX PROGRAM

## Project
marketscannerbydev.in — Indian market analytics, F&O signalling, swing cash, paper trading, portfolio, backtest, Telegram notification, and market intelligence platform.

## Owner instruction
Stop random one-off fixes. Run one systematic professional audit-and-fix program from data source to UI to Telegram to reports.

This is not a cosmetic job. Treat this as a production-grade market-data and trading-decision platform remediation program.

The final objective is a complete, accurate, efficient, professional-level market tool that the owner can actually use daily.

---

# 0. Current known accepted status

Before starting, reconcile repo reports and build-info with these milestones:

1. `RELEASE_INTEGRITY_PROD_VERIFIED`
2. `BACKTEST_CHARGES_MODEL_NET_PNL_PROD_VERIFIED`
3. `FNO_COST_MODEL_UNIFICATION_PROD_VERIFIED`
4. `FNO_VWAP_VOLUME_PROFILE_HONESTY_PROD_VERIFIED`
5. `FNO_TRIGGER_WORDING_SEMANTICS_PROD_VERIFIED`
6. `KITE_OI_UNIT_VERIFICATION_CONFIRMED_CORRECT`
7. `P1A_PAPER_TRADING_GROSS_NET_DISPLAY_PROD_VERIFIED`
8. `P1B_MACD_WARMUP_FIX_PROD_VERIFIED`
9. `MASTER_QUANT_REMEDIATION_ROADMAP_CREATED`
10. `P0_00_SIGNAL_PLAN_IMMUTABILITY_PROD_VERIFIED`
11. `P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_DEV_VERIFIED`
12. `EXIT_PREMIUM_MARKET_SHADOW_PROD_INFRA_VERIFIED_LIVE_SAMPLE_PENDING`
13. `POST_P0_SIGNAL_SYSTEM_REBASELINE_PARTIAL_GAP_REMAINS`

Do not claim any status unless the repo reports and `/api/build-info` prove it.

---

# 1. Strict rules

## Not allowed
1. No broker execution.
2. No real orders.
3. No Telegram spam.
4. No destructive migration.
5. No historical trade rewrite.
6. No realized P&L rewrite.
7. No account balance rewrite.
8. No hidden change to signal thresholds.
9. No hidden change to detector weights.
10. No hidden change to confidence formula.
11. No hidden change to stop/target formula.
12. No Yahoo/delayed/proxy/report-grade source driving trades.
13. No unavailable data rendered as zero, empty, none, green, or live.
14. No silent mutation of trading plans.
15. No partial completion labelled as verified.

## Required for every market number
Every market number shown in API/UI/report/Telegram must carry or be traceable to:

- source
- asOf
- fetchedAt
- freshness
- tradeGrade/reportGrade
- fallback status
- unavailable reason, if missing

---

# 2. Program structure

This task has 5 controlled phases.

Do not skip phases.
Do not start random fixes outside this structure.
Do not mark any phase complete without evidence.

---

# PHASE 0 — BASELINE, INVENTORY, AND FREEZE

Create:

`FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md`
`FULL_PLATFORM_BUG_REGISTER.csv`
`FULL_PLATFORM_ROUTE_DATAFLOW_MAP.md`

## 0A. Inventory all product surfaces

Audit and map:

1. Home / Market Pulse
2. Indices board
3. Stock Intelligence
4. Scanner / Deep Scan
5. Charting
6. Portfolio
7. Swing Cash Queue
8. Manual Buy / Buy Stock
9. Paper Trading F&O
10. Paper Trading Swing
11. F&O Intraday Signals
12. Option Chain
13. OI Lab
14. Backtest Lab
15. P&L Reports
16. Telegram pre-market
17. Telegram post-market
18. Telegram live signal alerts
19. Admin / Infra / Health
20. Diagnostics endpoints
21. APIs and database tables behind each surface

For each surface create:

| Surface | Route | API | DB/cache tables | Source | Freshness | Current status | Owner-visible issue | Severity |
|---|---|---|---|---|---|---|---|---|

## 0B. Dataflow map

For each business flow map:

### Flow A — Live market data
Kite / NSE / BSE / fallback → ingestion → cache/DB → API → UI → Telegram/report

### Flow B — F&O signal
market data → bars → indicators → option chain → signal generator → suppression/tradeable decision → paper open → lifecycle → Telegram/report

### Flow C — Swing cash
candidate → approval/staging → TTL sweep → paper open → portfolio → Telegram/report

### Flow D — Paper trade lifecycle
open → live MTM → SL/T1/T2/close → ledger/report → Telegram

### Flow E — Backtest
historical data → strategy engine → charges → trade rows → reports

For each flow create:

| Flow | Step | File/function | Input | Output | Failure mode | Current proof | Gap |
|---|---|---|---|---|---|---|---|

---

# PHASE 1 — PROFESSIONAL DEEP AUDIT FROM SCRATCH

Run a full audit from code, DB, API, UI, and Telegram.

No assumptions. No "probably fixed."
Every finding must have evidence.

## 1A. Data source audit

Audit:
1. Kite quotes
2. Kite instruments
3. Kite option chain
4. NSE/BSE fallback
5. Yahoo/report-grade sources
6. Cache freshness
7. historical bars
8. daily bars
9. intraday bars
10. index quotes
11. equity quotes
12. contract master
13. 52W range
14. OHLC
15. pivots/EMAs/indicators
16. India VIX / global VIX
17. FII/DII
18. F&O ban list
19. corporate actions/fundamentals if shown

Create:

| Data Item | Current source | Correct source | Trade grade? | Used by signals? | Used by UI? | Problem | Fix |
|---|---|---|---|---|---|---|---|

## 1B. Maths / indicators / calculations audit

Audit:
1. RSI
2. EMA/SMA
3. MACD
4. ATR
5. ADX
6. VWAP
7. Bollinger
8. pivots
9. support/resistance
10. max pain
11. PCR
12. OI buildup
13. Greeks/IV
14. Black-Scholes assumptions
15. charges/STT/GST/brokerage
16. P&L gross/net
17. paper trade sizing
18. lot size
19. strike step
20. expiry/DTE
21. risk %, max risk, capital required
22. drawdown/win rate/expectancy

Create:

| Calculation | File/function | Formula | Expected | Actual | Difference | Severity | Fix |
|---|---|---|---|---|---|---|---|

## 1C. F&O signalling audit

Audit:
1. signal generation
2. confidence calculation
3. detector votes
4. suppression reasons
5. tradeable gate
6. data blocked logic
7. daily/intraday bar availability
8. option chain readiness
9. contract master
10. trigger semantics
11. premium entry/SL/target
12. plan immutability
13. paper open
14. lifecycle close
15. Telegram alert
16. report inclusion

Create:

| Signal | Underlying | Generated? | Tradeable? | Suppressed? | Reason | Paper open? | Telegram? | Issue |
|---|---|---|---|---|---|---|---|---|

## 1D. Swing cash / portfolio audit

Audit:
1. candidate generation
2. manual staging
3. approval
4. TTL sweep
5. conversion to paper
6. portfolio insertion
7. source ID
8. notification status
9. close logic
10. SL/T1/T2 trail logic
11. Telegram summary
12. post-market report

Create:

| Symbol | Candidate source | Queue status | Paper row | Portfolio row | Telegram row | Linked? | Issue |
|---|---|---|---|---|---|---|---|

## 1E. UI and presentation audit

Audit every visible UI component:

1. missing source label
2. stale label
3. wrong color
4. wrong units
5. wrong baseline
6. hidden fallback
7. unhandled error
8. raw SQL in UI
9. blank chart with data
10. no-data when data exists
11. misleading "live"
12. misleading "no trades"

Create:

| Page | Component | Displayed | Correct | User risk | Fix |
|---|---|---|---|---|---|

---

# PHASE 2 — P0 FIX SPRINT

Fix only P0 issues first.

Current known P0 focus items include:

1. Swing paper trades / portfolio not reconciled with Telegram.
2. Swing Cash Queue lifecycle and paper conversion not clear.
3. Telegram pre/post summary says swing/paper zero incorrectly.
4. TTL sweep SQL/schema error.
5. F&O DATA_BLOCKED with Kite active and option chain ready.
6. F&O daily/intraday bars missing or mapped wrong.
7. F&O suppressed signals need exact reason.
8. Paper trade execution/linkage issues.
9. Any stale/report-grade/proxy data reaching trade paths.
10. Any UI showing false "live", "none", or "no trades."

For every P0 fix:

| P0 ID | Root cause | Files changed | Before | After | Test | Status |
|---|---|---|---|---|---|---|

---

# PHASE 3 — P1 PROFESSIONALIZATION SPRINT

After all P0 are fixed, fix P1 items:

1. report/ledger terminology
2. chart reliability
3. source-cleanliness
4. max pain sign
5. OI denominator
6. ΔOI baseline labels
7. risk-free rate central config
8. expiry/holiday/calendar staleness
9. VIX labeling
10. FII/DII date parity
11. support/resistance quality
12. Greeks/IV quality flags
13. paper/report exports
14. pro trader explanatory UI

Do not start P1 until P0 report is accepted.

---

# PHASE 4 — END-TO-END QA AND PRODUCTION CERTIFICATION

Create end-to-end test cases:

1. Kite active market day
2. Kite unavailable
3. pre-market
4. live market
5. post-market
6. holiday
7. expiry day
8. no trades
9. swing candidate staged
10. swing candidate converted
11. F&O signal suppressed
12. F&O signal tradeable
13. paper open
14. paper close
15. Telegram dry-run
16. stale data
17. proxy blocked
18. fallback labelled

For each:

| Scenario | Expected API | Expected UI | Expected Telegram | Result |
|---|---|---|---|---|

---

# PHASE 5 — OWNER ACCEPTANCE PACKAGE

Final package must include:

1. Executive summary
2. What was fixed
3. What was not fixed
4. Remaining risk
5. Source/data architecture
6. F&O signal methodology
7. Swing methodology
8. Paper trading methodology
9. Telegram notification contract
10. UI page-by-page evidence
11. Test evidence
12. Production build-info
13. Final verdict

---

# Required tests

Run and report exact counts.

```
pnpm --filter @workspace/scripts run verify:release
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run typecheck:libs
pnpm --filter @workspace/api-server exec vitest run
pnpm --filter @workspace/scanner run typecheck
pnpm --filter @workspace/scanner exec vitest run
pnpm --filter @workspace/scripts run index:llm
pnpm --filter @workspace/scripts run index:llm:check
```

If tests time out, split suites and report exact counts.

---

# Final verdicts

Use only these verdicts:

- `FULL_PLATFORM_AUDIT_BASELINE_CREATED`
- `FULL_PLATFORM_P0_FIXES_DEV_VERIFIED`
- `FULL_PLATFORM_P0_FIXES_PARTIAL_GAP_REMAINS`
- `FULL_PLATFORM_PROFESSIONALIZATION_DEV_VERIFIED`
- `FULL_PLATFORM_PROD_VERIFIED`
- `RELEASE_INTEGRITY_REGRESSION_FOUND`
- `ROLLBACK_REQUIRED`

First expected deliverable:

`FULL_PLATFORM_AUDIT_BASELINE_CREATED`

This first deliverable must not be only a report. It must include:
1. full surface inventory,
2. route/API/DB dataflow map,
3. P0/P1/P2 bug register,
4. owner screenshot issues added,
5. exact next P0 fix queue,
6. no code changes unless a critical production blocker is found and separately reported.
