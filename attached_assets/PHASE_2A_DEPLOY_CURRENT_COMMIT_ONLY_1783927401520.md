# CODER INSTRUCTION — PHASE 2A DEPLOY CURRENT COMMIT ONLY

## Current verdict

PHASE_2A_RETRY_FIX_BUILD_NOT_DEPLOYED

Do not write more code.
Do not start any new lane.
Do not change strategy, thresholds, P&L, ledger, or broker settings.
Do not place real orders.
Do not send real Telegram messages.

## Reason

Production is still serving old commit:

3ee67447

Current local/head fix commit is:

183f66de

The retry fix and paperConversion fields are not deployed, so production cannot be marked verified.

## Required action

1. Publish/deploy current commit `183f66de` or later.
2. After deployment, check:

GET https://marketscannerbydev.in/api/build-info

Required:
- commitSha is not 3ee67447
- commitSha is 183f66de or later
- buildTime is after deployment
- bootTime is after deployment
- environment=production

3. Run:

pnpm --filter @workspace/scripts run verify:release

Expected:
11 PASS / 0 WARN / 0 FAIL

4. Owner-authenticated production checks:

### A. paperConversion proof

Use owner-authenticated session and verify approval / preview response includes:

- paperConversion.opened
- paperConversion.blockedReason
- paperConversion.availableCapital
- paperConversion.requiredCapital
- brokerExecutionEnabled=false
- brokerStatus=BROKER_DISABLED

Expected if paper account remains capital-blocked:

- opened=false
- blockedReason=CONCURRENT_CAP or INSUFFICIENT_PAPER_CAPITAL
- availableCapital < requiredCapital
- no real order

### B. PRE_MARKET retry fix production proof

Confirm:
- retry fix commit is deployed.
- pre-market preview works.
- failed-row retry logic test still passes.
- next scheduled 08:50 IST run is pending or captured.

If next scheduled run has not happened, status must be:

PRE_MARKET_RETRY_FIX_PROD_DEPLOYED_NEXT_RUN_PENDING

### C. Live SWING_STAGED_APPROVAL row

If paper capital is still insufficient, final status must be:

PHASE_2A_PROD_LIVE_SWING_APPROVAL_SAMPLE_PENDING_CAPITAL_BLOCKED

Do not fake this. Do not bypass capital gates.

## Final allowed verdicts

Use exactly one:

- PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED
- PHASE_2A_RETRY_FIX_BUILD_NOT_DEPLOYED
- PRE_MARKET_RETRY_FIX_PROD_DEPLOYED_NEXT_RUN_PENDING
- PHASE_2A_PROD_LIVE_SWING_APPROVAL_SAMPLE_PENDING_CAPITAL_BLOCKED
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

Use full PROD_VERIFIED only if:
1. new commit is deployed,
2. verify:release passes on new build,
3. paperConversion proof is captured in production,
4. live SWING_STAGED_APPROVAL row exists OR authenticated dry-run proves same production path,
5. Telegram dry-run includes swing open OR final status remains capital-blocked pending,
6. broker execution remains disabled.
