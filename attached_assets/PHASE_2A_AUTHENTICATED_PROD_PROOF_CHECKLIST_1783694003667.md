# PHASE 2A — AUTHENTICATED PRODUCTION PROOF CHECKLIST

## Current accepted status

PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED
PHASE_2A_PROD_BUILD_DEPLOYED_RELEASE_REGRESSION_VERIFIED

Full production functional verification is still pending because owner-only endpoints returned 401 to the agent.

Do not mark PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED until authenticated production proof is collected.

---

## What is already accepted

1. Production build is deployed on Phase 2A commit.
2. `/api/build-info` confirms production commit/build/boot.
3. `verify:release` passed.
4. Targeted regression tests passed.
5. Anonymous owner-only endpoints correctly return 401 AUTH_REQUIRED.
6. Reports were updated.

---

## What is still required

Run these checks with owner authentication / approved owner session.

### 1. Swing staged orders

Verify:

- `/api/swing/staged-orders` returns real production JSON.
- No raw SQL or schema error is visible.
- Each row shows lifecycle status clearly.
- Approved/expired/converted rows are correct.
- `staged_order_id` linkage is visible where applicable.

Evidence table:

| Check | Production result | Verdict |
|---|---|---|
| staged orders load |
| approved rows visible |
| expired rows visible |
| converted/paper-linked rows visible |
| no raw SQL |

### 2. Manual TTL sweep

Run only if safe and owner-approved:

- Manual “Run Sweep Now” / expire-stale endpoint.
- Confirm response is safe JSON.
- If failure occurs, response must say `sweep_failed`, not raw SQL.

Evidence table:

| Check | Production result | Verdict |
|---|---|---|
| success/no-op response |
| safe error response |
| raw SQL hidden |

### 3. Telegram dry-run / preview

Run dry-run only. No real Telegram message unless owner approves.

Verify pre-market preview includes:

- swing staged
- approved
- expired
- opened
- closed
- blocked
- notification failures
- FII/DII when DB data exists
- broker execution status

Verify post-market preview includes:

- equity paper opened
- equity paper closed
- live equity paper positions
- F&O paper opened/closed/live where rows exist
- no false “paper trades none today” when rows exist

Evidence table:

| Telegram section | Production dry-run output | Verdict |
|---|---|---|
| pre-market swing counts |
| pre-market FII/DII |
| post-market equity paper |
| post-market F&O paper |
| broker disabled |
| no real send |

### 4. F&O readiness / DATA_BLOCKED

Verify authenticated production F&O readiness includes per-index diagnostics:

| Index | dailyBarsCount | dailyBarsOk | intradayBarsCount | intradayBarsOk | optionChainFetchOk | quoteStatus | source | asOf | freshness | exactBlockReason | blocked |
|---|---:|---|---:|---|---|---|---|---|---|---|---|
| NIFTY |
| BANKNIFTY |
| SENSEX |

Confirm:

- one-index failure does not block valid indices.
- exactBlockReason appears when blocked.
- Telegram dry-run uses symbol-level reason.

### 5. Paper equity positions

Verify production UI/API:

- paper positions load.
- source/provenance column visible.
- `SWING_STAGED_APPROVAL` or equivalent source visible for swing-approved paper rows.
- broker execution remains disabled.

Evidence table:

| Check | Production result | Verdict |
|---|---|---|
| paper equity positions load |
| source visible |
| staged link visible |
| broker disabled |

---

## Required final verdict

Use only one:

- PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED
- PHASE_2A_PROD_AUTH_FUNCTIONAL_PROOF_PENDING
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

Use PROD_VERIFIED only after authenticated production API/UI/Telegram dry-run proof is captured.
