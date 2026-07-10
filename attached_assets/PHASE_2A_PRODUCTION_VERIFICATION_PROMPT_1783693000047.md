# CODER PROMPT — PHASE 2A PRODUCTION VERIFICATION

## Current accepted DEV status

PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED

Do production verification only after the owner publishes the app.

Expected final production verdict if all checks pass:

PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED

---

## Strict safety rules

1. No broker execution.
2. No real orders.
3. No real Telegram spam.
4. Telegram verification must use dry-run/sandbox unless owner explicitly approves a real send.
5. No strategy threshold changes.
6. No detector weight changes.
7. No confidence formula changes.
8. No stop/target formula changes.
9. No P&L/account rewrite.
10. No historical trade rewrite.
11. No destructive migration.
12. Do not break P0-00 signal plan immutability.

---

## Part A — Production build proof

Check:

GET https://marketscannerbydev.in/api/build-info

Confirm:
1. HTTP 200.
2. Production commit equals or is after the Phase 2A fix commit.
3. buildTime is after publish.
4. bootTime is after publish.
5. environment=production.
6. release checkpoint markers remain true.
7. no secrets exposed.

If production is still on the old commit, stop and return:

PHASE_2A_BUILD_NOT_DEPLOYED

---

## Part B — Production Swing Queue → Paper Trade verification

Use safe dry-run/test data only. Do not place broker orders.

Verify:

| Step | Production proof | Verdict |
|---|---|---|
| staged swing candidate exists |
| approval PENDING → APPROVED |
| paper_trade_eq row created |
| staged_order_id populated |
| portfolio/live position source visible |
| broker execution disabled |
| no real order placed |

If a live owner-approved row already exists, use that for proof. Do not create real trades without owner approval.

---

## Part C — Production Telegram dry-run verification

Run pre-market and post-market dry-run/preview only.

Required proof:

1. Pre-market includes swing staged/approved/expired/opened/closed/blocked/notification failure counts.
2. Pre-market includes FII/DII when DB data exists.
3. Post-market includes equity paper opened/closed/live.
4. Post-market includes F&O paper opened/closed/live if rows exist.
5. Post-market does not say "paper trades none today" when paper rows exist.
6. No real Telegram message is sent.

---

## Part D — Production F&O DATA_BLOCKED diagnostics

Verify production diagnostics for NIFTY / BANKNIFTY / SENSEX include:

| Index | dailyBarsCount | dailyBarsOk | intradayBarsCount | intradayBarsOk | optionChainFetchOk | quoteStatus | source | asOf | freshness | exactBlockReason | blocked |
|---|---:|---|---:|---|---|---|---|---|---|---|---|

Confirm:
1. One-index failure does not block valid indices.
2. DATA_BLOCKED output includes exact reason.
3. Telegram dry-run includes symbol-level block reason.

---

## Part E — Production TTL sweep safe-error verification

Verify manual Run Sweep Now / expire-stale path:

1. Success path returns expired/scanned counts.
2. No-op path is not an error.
3. Failure path returns safe error only.
4. No raw SQL, table names, relation names, SQLSTATE, secrets, or stack traces are shown in UI/API.

---

## Part F — Regression commands

Run and report exact counts:

pnpm --filter @workspace/scripts run verify:release
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run typecheck:libs
pnpm --filter @workspace/api-server exec vitest run src/lib/*swing*.test.ts src/lib/*telegram*.test.ts src/lib/*notification*.test.ts src/lib/*paper*.test.ts src/lib/*fno*.test.ts src/routes/**/*.test.ts
pnpm --filter @workspace/scanner run typecheck
pnpm --filter @workspace/scanner exec vitest run
pnpm --filter @workspace/scripts run index:llm
pnpm --filter @workspace/scripts run index:llm:check

Split timeouts and report exact counts.

---

## Part G — Reports to update

Update production proof in:

1. FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md
2. FULL_PLATFORM_BUG_REGISTER.csv
3. FULL_PLATFORM_ROUTE_DATAFLOW_MAP.md
4. USER_FACING_CORE_TABS_DEEP_AUDIT_REPORT.md
5. POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md
6. docs/telegram-alert-quality-audit-2026-07-03.md
7. docs/fno-signal-gap-audit/AUDIT-REPORT-2026-06-30.md
8. docs/swing-cash-live-readiness/PART-M-final-report.md

---

## Final verdict

Use exactly one:

- PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED
- PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED
- PHASE_2A_BUILD_NOT_DEPLOYED
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

Use PROD_VERIFIED only if production build-info, API/UI/Telegram dry-run, schema/path checks, and regression commands all pass.
