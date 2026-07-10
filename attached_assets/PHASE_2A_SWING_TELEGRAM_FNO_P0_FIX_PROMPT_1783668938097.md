# CODER PROMPT — PHASE 2A P0 FIX SPRINT: SWING QUEUE → PAPER TRADE → TELEGRAM + F&O DATA_BLOCKED

## Current accepted status

Phase 0 baseline is accepted as:

FULL_PLATFORM_AUDIT_BASELINE_CREATED

Created files:
1. FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md
2. FULL_PLATFORM_BUG_REGISTER.csv
3. FULL_PLATFORM_ROUTE_DATAFLOW_MAP.md

No code was changed in Phase 0.

## Owner priority

Stop audit-only work. Start fixing the highest production-visible P0s.

This Phase 2A sprint must close the biggest workflow failures:

1. Swing Cash Queue approval does not create an equity paper trade.
2. Telegram pre/post reports are empty or misleading despite data existing.
3. F&O DATA_BLOCKED is global/all-or-nothing and blocks all indices when one source/index fails.
4. Kite timeout / stalled request risk must be controlled.
5. Swing Queue, paper ledger, portfolio, and Telegram must reconcile.

Expected first fix verdict:

PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED

Do not claim PROD_VERIFIED until published and production build-info/API/UI/Telegram dry-run proof exists.

---

# STRICT SAFETY RULES

1. No broker execution.
2. No real orders.
3. No Telegram spam.
4. Telegram tests must use dry-run/sandbox unless owner approves real send.
5. No strategy threshold changes.
6. No detector weight changes.
7. No confidence formula changes.
8. No stop/target formula changes.
9. No account balance rewrite.
10. No realized P&L rewrite.
11. No historical trade rewrite.
12. No destructive migration.
13. Do not break P0-00 locked plan immutability.
14. Do not let Yahoo/delayed/proxy/report-grade data drive trades.
15. Do not render unavailable data as zero/none/green/live.

---

# PART A — FIX FP-P0-01: Swing Queue approval must create paper equity trade

## Current bug
Phase 0 found:
approveSwingOrder() marks the staging row APPROVED and stops.
It does not create a paper_trade_eq row.
The equity paper trading pipeline is fed only by runEquityPaperTradingTick.

This means manual Swing Queue approval does not enter the paper ledger.

## Required fix

When Swing Queue approval succeeds:

1. Freeze candidate data:
   - symbol
   - entry
   - stopLoss
   - target1
   - target2
   - quantity
   - capitalRequired
   - source
   - asOf
   - risk
   - setup/reason

2. Create a paper equity trade using the existing professional paper-trade open function or a shared safe wrapper.

3. Persist linkage:
   - swingCandidateId / stagedOrderId
   - paperTradeId
   - conversionAttemptedAt
   - conversionResult
   - conversionBlockReason
   - notificationStatus

4. Portfolio row must show source:
   - SWING_QUEUE
   - MANUAL
   - AUTO
   - LEGACY_UNKNOWN

5. If broker is disabled, paper trade may still open, but UI must clearly say:
   - BROKER DISABLED
   - PAPER TRADE ONLY
   - NO REAL ORDER

6. If paper open is blocked, the queue row must show the exact reason.

## Required tests

1. staged swing order approved → paper_trade_eq row created.
2. paper row has source SWING_QUEUE and source ID.
3. portfolio row shows paper position.
4. broker disabled does not block paper-only open.
5. blocked open writes conversionBlockReason.
6. historical rows are not rewritten.

---

# PART B — FIX FP-P0-02: Telegram pre/post reports must use existing data

## Current bug
Phase 0 found many Telegram report sections print unavailable even though data exists in the system.

Already available and must be wired:
1. FII/DII activity
2. India VIX
3. participant OI, if available
4. sector moves
5. F&O ban list
6. swing queue counts
7. swing paper opened/closed today
8. live swing paper positions
9. F&O generated/tradeable/suppressed
10. F&O paper opened/closed today

Still external/not integrated and may remain honestly unavailable:
1. GIFT Nifty
2. global cues
3. live news/events

## Required fix

Create one Telegram summary source-of-truth builder.

Pre-market must include:

| Metric | Source | Required |
|---|---|---|
| Swing staged | swing queue DB/API | yes |
| Swing approved | swing queue DB/API | yes |
| Swing expired | swing queue DB/API | yes |
| Swing paper opens today | paper equity DB | yes |
| Live swing positions | paper/portfolio DB | yes |
| F&O generated | signal DB/API | yes |
| F&O suppressed | signal DB/API | yes |
| F&O tradeable | signal DB/API | yes |
| Data blocked modules | diagnostics | yes |
| Broker execution status | config | yes |

Post-market must include the same, plus:
- paper closed today
- open positions
- notification failures
- exact data health per module

Telegram must not say "paper trades none today" if any paper trade opened/closed today or if live open positions should be reported.

## Required tests

1. DB has swing paper open today → post-market does not say none.
2. swing queue has staged/approved/expired → Telegram counts match.
3. FII/DII available in DB → Telegram section populated.
4. VIX available in indices board → Telegram section populated.
5. F&O ban unavailable → Telegram says unavailable, not "none".
6. dry-run Telegram returns message payload without sending real message.

---

# PART C — FIX FP-P0-03: F&O DATA_BLOCKED must be per-index and diagnostic

## Current bug
Phase 0 found:
If one index has missing bars or a timeout, all NIFTY/BANKNIFTY/SENSEX can become DATA_BLOCKED.
Kite client has no timeout, causing a stalled request to starve queues.

## Required fix

1. Make data-block decision per index:
   - NIFTY
   - BANKNIFTY
   - SENSEX

2. Add per-index diagnostics:
   - dailyBars count
   - intradayBars count
   - optionChain status
   - Kite quote status
   - source
   - asOf
   - failure reason
   - blocked true/false

3. If SENSEX bars fail, do not automatically block NIFTY/BANKNIFTY if their data is valid.

4. Add Kite request timeout and safe retry/fail-fast behavior.

5. Telegram must report:
   - which index is blocked
   - exact reason
   - next action

## Required tests

1. NIFTY bars valid, SENSEX missing → NIFTY not blocked.
2. one index timeout does not block all indices.
3. stalled Kite request times out safely.
4. Telegram data health lists symbol-level reasons.
5. suppressed signal includes exact reason.

---

# PART D — TTL sweep safety

Fix and test TTL sweep if not already fixed.

Required:

1. No raw SQL error visible in UI.
2. Safe UI error summary only.
3. sweep success test.
4. no-op test.
5. expired staged candidate test.
6. failed query mapped to safe UI message.

---

# PART E — Reports and bug register

Update:

1. FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md
2. FULL_PLATFORM_BUG_REGISTER.csv
3. FULL_PLATFORM_ROUTE_DATAFLOW_MAP.md
4. USER_FACING_CORE_TABS_DEEP_AUDIT_REPORT.md
5. POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md
6. Any swing / telegram / F&O report files

Add a Phase 2A section with:
- root cause
- files changed
- before/after behavior
- DB/API/UI/Telegram proof
- tests and exact counts
- what remains

---

# PART F — Required verification

Run and report exact counts:

pnpm --filter @workspace/scripts run verify:release
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run typecheck:libs
pnpm --filter @workspace/api-server exec vitest run src/lib/*swing*.test.ts src/lib/*telegram*.test.ts src/lib/*notification*.test.ts src/lib/*paper*.test.ts src/lib/*fno*.test.ts src/routes/**/*.test.ts
pnpm --filter @workspace/scanner run typecheck
pnpm --filter @workspace/scanner exec vitest run
pnpm --filter @workspace/scripts run index:llm
pnpm --filter @workspace/scripts run index:llm:check

Split timed-out suites and report exact counts.

---

# Final verdict

Use only one:

- PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED
- PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS
- PHASE_2A_FORENSIC_ONLY_OWNER_APPROVAL_REQUIRED
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

Use DEV_VERIFIED only if:
1. Swing approval creates linked paper trade in DEV.
2. Telegram dry-run reconciles swing/paper/F&O counts.
3. F&O DATA_BLOCKED is per-index with exact reason.
4. TTL sweep is safe.
5. Tests pass.
6. Reports are updated.
7. Safety rules are confirmed.

Do not claim PROD_VERIFIED until owner publishes and production build-info/API/UI/Telegram dry-run proof exists.
