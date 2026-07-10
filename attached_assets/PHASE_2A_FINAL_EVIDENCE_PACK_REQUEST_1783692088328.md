# CODER RESPONSE REQUIRED — PHASE 2A FINAL EVIDENCE PACK

Current owner-review verdict remains:

PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS

Your latest response says all 7 gaps are closed, but the response is incomplete/truncated and does not yet provide the full final evidence required for acceptance.

Do not write more narrative.
Do not start new work.
Return a concise final evidence pack only.

## Required final evidence pack

### 1. Final verdict

Use exactly one:

- PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED
- PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

### 2. Seven-gap closure table

Provide this exact table:

| Gap ID | Required closure | Code file(s) changed | Test file(s) | Evidence | Status |
|---|---|---|---|---|---|
| FP-P0-01A | Swing approval → paper → portfolio → Telegram proof |
| FP-P0-02A | Post-market paper trade counts |
| FP-P0-02B | Telegram swing queue counts |
| FP-P0-03A | F&O per-index DATA_BLOCKED reasons |
| FP-P0-03B | One-index failure isolation |
| FP-P0-04B | Kite timeout/fail-fast behavioral proof |
| FP-P0-05B | TTL sweep safe UI/API error proof |

### 3. Telegram dry-run proof

Paste message excerpts from the actual dry-run/test harness output.

Required excerpts:

- Pre-market message showing:
  - swing opened/closed/blocked/notification failures
  - FII/DII real values
  - F&O readiness with per-index status

- Post-market message showing:
  - equity paper opened/closed/live positions
  - F&O paper opened/closed if fixture exists
  - no false “paper trades none today” when paper rows exist

Confirm no real Telegram send occurred.

### 4. DB/API/UI reconciliation proof

Provide:

| Step | Evidence source | Sample value | Status |
|---|---|---|---|
| swing_order_staging row exists |
| approval PENDING → APPROVED |
| paper_trade_eq row created |
| staged_order_id populated |
| listSwingOrders/API serialization shows source/link |
| portfolio/live position source visible |
| Telegram dry-run includes the open |
| broker execution disabled |

If UI browser proof is not available, state exactly what API/component serialization test proves and what remains for production/UI verification.

### 5. F&O per-index diagnostics proof

Provide a table for NIFTY / BANKNIFTY / SENSEX:

| Index | dailyBarsCount | dailyBarsOk | intradayBarsCount | intradayBarsOk | optionChainFetchOk | quoteStatus | source | asOf | freshness | exactBlockReason | blocked |
|---|---:|---|---:|---|---|---|---|---|---|---|---|

Also include one-index isolation proof:

- NIFTY valid while SENSEX bad → NIFTY not suppressed.
- SENSEX bad → SENSEX suppressed with exact reason.
- BANKNIFTY valid → BANKNIFTY not suppressed.

### 6. Kite timeout proof

Provide:

- changed file(s)
- test file
- named timeout reason returned
- exact test case names
- proof it is behavioral, not only static source-scan

### 7. TTL safe error proof

Provide:

- route/API/manual sweep path tested
- failed DB/query maps to safe UI/API message
- raw SQL/secrets not present
- exact test case names

### 8. Reports updated

Confirm every file:

1. FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md
2. FULL_PLATFORM_BUG_REGISTER.csv
3. FULL_PLATFORM_ROUTE_DATAFLOW_MAP.md
4. USER_FACING_CORE_TABS_DEEP_AUDIT_REPORT.md
5. POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md
6. docs/telegram-alert-quality-audit-2026-07-03.md
7. docs/fno-signal-gap-audit/AUDIT-REPORT-2026-06-30.md
8. docs/swing-cash-live-readiness/PART-M-final-report.md

### 9. Exact command counts

Provide command-by-command counts:

| Command | Result |
|---|---|
| verify:release |
| api-server typecheck |
| api-server typecheck:libs |
| api-server vitest chunks |
| scanner typecheck |
| scanner vitest |
| index:llm |
| index:llm:check |

Do not just say “all tests pass.”

### 10. Safety confirmation

Confirm:

- no broker execution
- no real orders
- no real Telegram send
- no strategy/threshold/weight changes
- no P&L/account rewrite
- no historical trade rewrite
- no destructive migration
- P0-00 immutability not broken

Only after this full evidence pack can owner consider accepting:

PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED
