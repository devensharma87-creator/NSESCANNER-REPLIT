# CODER RESPONSE REQUIRED — PHASE 2A DEPLOY VERIFY + CAPITAL-BLOCK PROOF

## Current owner-review verdict

PHASE_2A_PROD_FINAL_CLOSEOUT_PARTIAL_GAP_REMAINS

Do not claim PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED yet.

Your latest work is useful, but your own final table still has pending items:
1. retry fix deployed to production — pending build-info verification,
2. verify:release after deploy — pending,
3. paperConversion API/preview endpoint — pending deploy + owner-auth retest,
4. live SWING_STAGED_APPROVAL row — pending due paper capital block,
5. Telegram dry-run with swing open — pending because no SWING_STAGED_APPROVAL row exists.

Return only the evidence below. No long narrative.

---

# Accepted from latest work

1. PRE_MARKET timeout root cause found:
   - error_code=TIMEOUT
   - telegram_status=TIMEOUT
   - approx 24s timeout window
2. retry-for-FAILED-row fix added in `tryClaimScheduledReport`.
3. targeted daily-report tests passed: 23/23.
4. HDFCBANK staged approval reached ENTRY_VALID_NOW.
5. paper conversion correctly blocked due available paper cash around ₹58.59 versus required approx ₹825.
6. new approve response / preview work added:
   - `paperConversion.opened`
   - `blockedReason`
   - `availableCapital`
   - `requiredCapital`
   - read-only `paper-open-preview` endpoint.

---

# Required evidence now

## 1. Deployment verification

Provide:

| Check | Evidence | Verdict |
|---|---|---|
| /api/build-info commitShort/commitSha |
| buildTime |
| bootTime |
| environment=production |
| commit is after retry/paperConversion fix |
| verify:release result |
| API server healthy |

If production is still on old commit, final verdict must be:

PHASE_2A_RETRY_FIX_BUILD_NOT_DEPLOYED

---

## 2. Authenticated production paperConversion proof

Using owner-authenticated production session, call the approval response or read-only preview endpoint.

Provide:

| Field | Production value | Verdict |
|---|---|---|
| stagedOrderId |
| symbol |
| approvalStatus |
| paperConversion.opened |
| paperConversion.blockedReason |
| paperConversion.availableCapital |
| paperConversion.requiredCapital |
| brokerExecutionEnabled |
| brokerStatus |
| no real order |

Expected current acceptable result if capital still insufficient:

paperConversion.opened=false
blockedReason=CONCURRENT_CAP or INSUFFICIENT_PAPER_CAPITAL
availableCapital approx ₹58.59
requiredCapital > availableCapital
brokerExecutionEnabled=false

This will close the owner-facing blocked-reason proof, but it does NOT close the live SWING_STAGED_APPROVAL paper-row sample.

---

## 3. PRE_MARKET retry fix production status

Provide:

| Check | Evidence | Verdict |
|---|---|---|
| retry fix deployed |
| dailyReports retry tests still pass |
| pre-market preview works |
| failed-row retry behavior safe |
| next scheduled run pending or captured |

If next market-day scheduled run has not happened yet, final sub-status:

PRE_MARKET_RETRY_FIX_PROD_DEPLOYED_NEXT_RUN_PENDING

Do not pretend the next scheduled run has passed if it has not.

---

## 4. Live SWING_STAGED_APPROVAL row status

Provide one of:

### A. Live row created
If capital was freed and approval opened paper trade:

| Check | Production evidence | Verdict |
|---|---|---|
| paper_trade_eq row created |
| source=SWING_STAGED_APPROVAL |
| staged_order_id populated |
| positions API shows source |
| Telegram dry-run includes swing open |
| broker disabled |

### B. Still capital blocked
If capital still insufficient:

| Check | Production evidence | Verdict |
|---|---|---|
| availableCapital |
| requiredCapital |
| blockedReason |
| no paper_trade_eq row created |
| owner-facing blocked reason visible |
| broker disabled |

Then final sub-status must be:

PHASE_2A_PROD_LIVE_SWING_APPROVAL_SAMPLE_PENDING_CAPITAL_BLOCKED

---

# Required tests/checks

Run and report exact counts:

pnpm --filter @workspace/scripts run verify:release
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run typecheck:libs
pnpm --filter @workspace/api-server exec vitest run src/lib/dailyReports*.test.ts src/lib/*swing*.test.ts src/lib/*paper*.test.ts src/routes/**/*.test.ts
pnpm --filter @workspace/scripts run index:llm
pnpm --filter @workspace/scripts run index:llm:check

Run scanner typecheck only if scanner or shared types changed.

---

# Final verdict options

Use exactly one:

- PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED
- PHASE_2A_PROD_FINAL_CLOSEOUT_PARTIAL_GAP_REMAINS
- PHASE_2A_RETRY_FIX_BUILD_NOT_DEPLOYED
- PRE_MARKET_RETRY_FIX_PROD_DEPLOYED_NEXT_RUN_PENDING
- PHASE_2A_PROD_LIVE_SWING_APPROVAL_SAMPLE_PENDING_CAPITAL_BLOCKED
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

Use full PROD_VERIFIED only if:
1. retry fix is deployed and production verified,
2. live SWING_STAGED_APPROVAL paper row exists OR approved dry-run proves exact same production path,
3. Telegram dry-run includes the swing-open,
4. broker execution remains disabled,
5. all reports updated.
