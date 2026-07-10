# CODER PROMPT — PHASE 2A FINAL PRODUCTION CLOSEOUT: TWO BLOCKERS ONLY

## Current owner-review status

Accepted:

PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED
PHASE_2A_PROD_BUILD_DEPLOYED_RELEASE_REGRESSION_VERIFIED
PHASE_2A_PROD_AUTH_FUNCTIONAL_CORE_VERIFIED

Not yet accepted:

PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED

Reason: authenticated production proof is strong, but two production blockers remain:

1. No live production `SWING_STAGED_APPROVAL` paper-equity row has been observed yet.
2. Production daily-analysis history shows PRE_MARKET 2026-07-10 FAILED.

Do not reopen random work. Do not start Lane 2. Close only these two blockers.

---

## Strict safety rules

1. No broker execution.
2. No real orders.
3. No real Telegram spam.
4. Use dry-run/preview only unless owner explicitly approves real send.
5. No strategy threshold changes.
6. No detector weight changes.
7. No confidence/stop/target formula changes.
8. No P&L/account rewrite.
9. No historical trade rewrite.
10. No destructive migration.

---

# BLOCKER 1 — Production SWING_STAGED_APPROVAL live-sample proof

## Problem

Authenticated production proof showed `/api/paper/positions/eq` returns 10 open positions, all with:

source = AUTO_STRONG_BUY
stagedOrderId = null

No `SWING_STAGED_APPROVAL` production row exists yet because the only staged swing row, RELIANCE, expired before approval.

That means the production deployment is ready, but the actual owner-used approval path has not been observed in production.

## Required closeout

Use one of these safe options:

### Option A — owner-approved real paper-only staged approval

Only if owner approves:

1. Stage a safe test swing candidate in paper-only mode, or use the next real staged candidate.
2. Owner approves it.
3. Confirm:
   - staging row status becomes APPROVED
   - `paper_trade_eq` row created
   - `paper_trade_eq.source = SWING_STAGED_APPROVAL`
   - `paper_trade_eq.staged_order_id` populated
   - portfolio/API shows the position source
   - Telegram dry-run includes the open
   - broker execution remains disabled
   - no real order placed

### Option B — authenticated production dry-run/simulation endpoint

If available and safe:

1. Use an authenticated production dry-run endpoint that exercises the same approval-to-paper code path without committing a real position.
2. It must call the same production code path.
3. It must output the same linkage fields.
4. It must not mutate ledger or place any order.

If neither option is possible, final status must remain:

PHASE_2A_PROD_LIVE_SWING_APPROVAL_SAMPLE_PENDING

## Required evidence table

| Step | Production evidence | Verdict |
|---|---|---|
| staged swing candidate exists |
| approval executed / simulated safely |
| status APPROVED |
| paper_trade_eq row created |
| source = SWING_STAGED_APPROVAL |
| staged_order_id populated |
| portfolio/source visible |
| Telegram dry-run includes open |
| broker disabled |
| no real order |

---

# BLOCKER 2 — Pre-market 2026-07-10 FAILED root cause

## Problem

Authenticated production daily-analysis history shows:

PRE_MARKET 2026-07-10 FAILED
POST_MARKET 2026-07-10 SENT

This must not be ignored. It may not be caused by Phase 2A, but a professional production status cannot hide a failed scheduled report.

## Required closeout

Investigate production logs/history for the failed pre-market report.

Find and report:

1. exact failure timestamp
2. route/job/function that failed
3. error class
4. root cause:
   - data unavailable
   - Telegram send failure
   - scheduler issue
   - auth/config issue
   - timeout
   - DB error
   - unknown/no logs
5. whether this still reproduces
6. whether preview/dry-run now works
7. whether any fix is required

If fix required, make minimal fix only.

If root cause cannot be determined because logs were not retained, document as:

PRE_MARKET_FAILURE_ROOT_CAUSE_LOGS_UNAVAILABLE

and add monitoring improvement:
- capture failure reason in daily-analysis history table
- safe error code
- no raw stack/secret leakage

## Required evidence table

| Check | Production evidence | Verdict |
|---|---|---|
| failed job located |
| failure reason found |
| dry-run pre-market works now |
| scheduler status healthy |
| monitoring/failure reason captured |
| fix required? |

---

# Reports to update

Update only the relevant production proof sections in:

1. FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md
2. FULL_PLATFORM_BUG_REGISTER.csv
3. docs/telegram-alert-quality-audit-2026-07-03.md
4. docs/swing-cash-live-readiness/PART-M-final-report.md
5. POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md

---

# Required verification

Run and report exact counts:

pnpm --filter @workspace/scripts run verify:release
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run typecheck:libs
pnpm --filter @workspace/scripts run index:llm
pnpm --filter @workspace/scripts run index:llm:check

Run targeted tests only if code changed.

---

# Final verdict

Use exactly one:

- PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED
- PHASE_2A_PROD_LIVE_SWING_APPROVAL_SAMPLE_PENDING
- PHASE_2A_PROD_PREMARKET_FAILURE_INVESTIGATION_PENDING
- PHASE_2A_PROD_AUTH_FUNCTIONAL_CORE_VERIFIED_WITH_2_BLOCKERS
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

Use PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED only if both blockers are closed with authenticated production evidence.
