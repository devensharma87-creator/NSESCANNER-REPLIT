# CODER PROMPT — PHASE 2A FINAL CLOSEOUT CORRECTION

## Owner-review verdict

Do not mark full PROD_VERIFIED yet.

Current accepted status:

PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED
PHASE_2A_PROD_AUTH_FUNCTIONAL_CORE_VERIFIED_WITH_2_BLOCKERS

Updated blocker status:

1. PRE_MARKET failure root cause found and retry fix added in code.
2. Live SWING_STAGED_APPROVAL sample is still not closed because production paper account free cash is only ₹58.59, so approval succeeded but paper conversion was blocked by capital/risk gate.

Correct current verdict:

PHASE_2A_PROD_FINAL_CLOSEOUT_PARTIAL_GAP_REMAINS

---

## What is accepted from your latest work

### Blocker 2 — PRE_MARKET failure investigation

Accepted as root-cause found:

- daily_report_runs showed PRE_MARKET 2026-07-10 FAILED.
- error_code=TIMEOUT.
- telegram_status=TIMEOUT.
- elapsed around 24 seconds.
- root cause: Telegram transient timeout.
- systemic bug: failed daily report rows were permanently dedup-skipped because tryClaimScheduledReport only inserted fresh slots and did not retry FAILED rows.
- fix added: retry FAILED rows by resetting status to CLAIMED and clearing error fields inside scheduler window.
- targeted tests: 23 pass.
- typecheck clean.

Not fully production verified yet unless /api/build-info confirms this retry-fix commit is deployed and verify:release passes after deploy.

### Blocker 1 — Swing staged approval live sample

Not accepted as closed.

Production finding:
- staged HDFCBANK order reached STAGED and approval succeeded with ENTRY_VALID_NOW.
- paperTrade was None / not opened.
- reason: paper equity account free cash approximately ₹58.59.
- even 1 HDFCBANK share needed approximately ₹824.95.
- paper conversion blocked by capital/concurrent-cap safety gate.

This proves the approval gate can pass, but it does not prove:
- paper_trade_eq row created,
- source=SWING_STAGED_APPROVAL,
- staged_order_id populated,
- portfolio source visible,
- Telegram dry-run includes the swing-open.

Therefore live SWING_STAGED_APPROVAL sample remains pending.

---

# Required closeout actions

## A. Deploy and verify PRE_MARKET retry fix

After publishing the retry fix, provide:

| Check | Evidence | Verdict |
|---|---|---|
| /api/build-info commit is after retry fix |
| buildTime/bootTime after deploy |
| verify:release 11 PASS / 0 WARN / 0 FAIL |
| pre-market preview still works |
| failed report retry logic test still passes |
| daily_report_runs failure reason fields preserved / safe |

If logs/history cannot verify actual next scheduled retry until next market day, mark:
PRE_MARKET_RETRY_FIX_PROD_DEPLOYED_NEXT_RUN_PENDING

Do not call full PROD_VERIFIED until next scheduled pre-market run either succeeds or a safe retry outcome is captured.

---

## B. Close the live SWING_STAGED_APPROVAL sample properly

Do not bypass risk/capital gates.
Do not place real broker orders.
Do not rewrite historical rows.

Choose one owner-approved safe option:

### Option 1 — free paper capital
Owner approves closing one or more existing paper-only equity positions, or otherwise freeing paper capital using existing app workflows.

Then:
1. stage valid swing candidate,
2. approve candidate,
3. confirm paper_trade_eq row is created,
4. confirm source=SWING_STAGED_APPROVAL,
5. confirm staged_order_id populated,
6. confirm portfolio/API source visible,
7. confirm Telegram dry-run includes opened swing paper trade,
8. confirm broker execution remains disabled.

### Option 2 — use valid low-capital symbol
Find a valid NSE equity where required paper capital <= available free cash, if such a symbol exists and passes all gates.

Then run the same proof chain.

### Option 3 — authenticated dry-run/simulation
If available, use a production dry-run endpoint that calls the same approval-to-paper code path without mutating the ledger.

It must prove the same output fields:
- wouldOpen=true
- source=SWING_STAGED_APPROVAL
- stagedOrderId present
- requiredCapital
- availableCapital
- brokerExecution=false

If no safe option is possible, final status must remain:
PHASE_2A_PROD_LIVE_SWING_APPROVAL_SAMPLE_PENDING_CAPITAL_BLOCKED

---

## C. Improve owner-facing blocked reason if missing

Because production approval can succeed while paper conversion is blocked by capital, the owner must see the reason clearly.

Verify UI/API shows:

- approval status: APPROVED
- paper conversion: BLOCKED
- reason: insufficient paper capital / CONCURRENT_CAP
- required capital
- available capital
- broker disabled / paper-only

If not visible, add minimal UI/API mapping only.

Required proof:

| Surface | Required message | Evidence |
|---|---|---|
| Swing Queue row |
| Approval API response |
| Telegram dry-run |
| Audit/report log |

---

# Required final evidence table

| Item | Production evidence | Verdict |
|---|---|---|
| PRE_MARKET timeout root cause |
| retry FAILED-row fix deployed |
| verify:release after deploy |
| next pre-market retry/success captured or pending |
| paper account available cash |
| staged approval passes |
| paper conversion blocked reason shown |
| live SWING_STAGED_APPROVAL row created OR pending due capital |
| Telegram dry-run includes open OR pending due capital |
| broker execution disabled |

---

# Required tests

If code changed, run and report exact counts:

pnpm --filter @workspace/scripts run verify:release
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run typecheck:libs
pnpm --filter @workspace/api-server exec vitest run src/lib/dailyReports*.test.ts src/lib/*swing*.test.ts src/lib/*paper*.test.ts src/routes/**/*.test.ts
pnpm --filter @workspace/scanner run typecheck
pnpm --filter @workspace/scripts run index:llm
pnpm --filter @workspace/scripts run index:llm:check

---

# Reports to update

Update:

1. FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md
2. FULL_PLATFORM_BUG_REGISTER.csv
3. docs/telegram-alert-quality-audit-2026-07-03.md
4. docs/swing-cash-live-readiness/PART-M-final-report.md
5. POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md

---

# Final verdict options

Use exactly one:

- PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED
- PHASE_2A_PROD_FINAL_CLOSEOUT_PARTIAL_GAP_REMAINS
- PHASE_2A_PROD_LIVE_SWING_APPROVAL_SAMPLE_PENDING_CAPITAL_BLOCKED
- PRE_MARKET_RETRY_FIX_PROD_DEPLOYED_NEXT_RUN_PENDING
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

Use PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED only if:
1. PRE_MARKET retry fix is deployed and verified,
2. live SWING_STAGED_APPROVAL paper row is observed or an authenticated production dry-run proves the same code path,
3. Telegram dry-run includes the swing-open,
4. broker execution remains disabled,
5. all reports are updated.
