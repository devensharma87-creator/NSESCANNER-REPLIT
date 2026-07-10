# CODER RESPONSE REQUIRED — PHASE 2A NOT ACCEPTED AS DEV_VERIFIED YET

## Owner-review verdict

PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS

Your response was structured and useful, but it is not enough to mark Phase 2A as DEV_VERIFIED because the required DB/API/UI/Telegram dry-run evidence was not provided, and some acceptance criteria were satisfied only by static or unit tests.

Do not start new work.
Do not mark DEV_VERIFIED.
Return a concise evidence pack closing the gaps below.

---

# Accepted from your response

1. Swing approval code path and tests added.
2. Post/pre Telegram count code and dailyReports tests added.
3. F&O index diagnostics skeleton and tests added.
4. Kite timeout constant static tests added.
5. TTL sweep fail-open tests added.
6. Scanner regression 770 passed.
7. Typecheck clean.

---

# Still missing before DEV_VERIFIED

## 1. Telegram dry-run proof is missing

You yourself listed Telegram dry-run payload as pending.

Required:
- pre-market dry-run payload
- post-market dry-run payload
- proof that paper trades are not reported as “none today” when paper rows exist
- proof swing staged/approved/expired/open/closed counts appear
- no real Telegram send

If owner cookie/PREPOST bot is unavailable, create a local dry-run test harness that invokes the same report builder and outputs the final message text. Do not leave this as pending.

## 2. DB/API/UI reconciliation proof is missing

Provide actual evidence table:

| Step | Evidence | Result |
|---|---|---|
| staged order exists |
| approval PENDING → APPROVED |
| paper_trade_eq row created |
| staged_order_id populated |
| portfolio/live position source visible |
| Telegram dry-run includes open |
| post-market does not say none today |
| broker execution disabled |

Tests alone are not enough. Provide sample DB rows or mocked DB integration output from the test.

## 3. F&O per-index diagnostics are incomplete

You added:
- dailyBarsOk
- intradayBarsOk
- optionChainOk
- quoteOk
- blockReason

But required fields were:

- dailyBarsCount
- dailyBarsOk
- intradayBarsCount
- intradayBarsOk
- optionChainFetchOk
- quoteStatus
- source
- asOf
- freshness
- exactBlockReason
- blocked true/false

Add the missing fields or explicitly state why each cannot be provided.

## 4. Kite timeout proof is only static

Static tests prove the constant exists. They do not prove stalled requests fail fast.

Add one behavioral test or a well-isolated client test proving timeout/fail-fast behavior returns a named reason:
- KITE_TIMEOUT_BLOCKED
- KITE_INTRADAY_TIMEOUT
- or equivalent

## 5. TTL sweep UI safety is not proven

Fail-open tests are useful, but the owner screenshot showed raw SQL/schema error in UI.

Required:
- API response does not include raw SQL
- UI/manual Run Sweep Now path maps DB error to safe message
- test proves raw SQL/secrets are not exposed

## 6. Required reports were not fully updated

Your response only mentions:
- FULL_PLATFORM_BUG_REGISTER.csv
- FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md

Required files were:
1. FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md
2. FULL_PLATFORM_BUG_REGISTER.csv
3. FULL_PLATFORM_ROUTE_DATAFLOW_MAP.md
4. USER_FACING_CORE_TABS_DEEP_AUDIT_REPORT.md
5. POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md
6. docs/telegram-alert-quality-audit-2026-07-03.md
7. docs/fno-signal-gap-audit/AUDIT-REPORT-2026-06-30.md
8. docs/swing-cash-live-readiness/PART-M-final-report.md

Update all or explain exact reason if any file is not applicable.

## 7. Required verification package incomplete

Provide exact counts for:
- verify:release
- api-server typecheck
- api-server typecheck:libs
- required vitest suites
- scanner typecheck
- scanner vitest
- index:llm
- index:llm:check

Do not only say typecheck clean.

---

# Final response format required

Return only this structure:

## Verdict
One of:
- PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED
- PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

## Evidence table
DB/API/UI/Telegram dry-run reconciliation table.

## Telegram payload proof
Pre-market and post-market dry-run message excerpts.

## F&O diagnostic proof
Per-index diagnostic table with all required fields.

## TTL safety proof
API/UI safe-error proof.

## Reports updated
List all required files and status.

## Test counts
Exact command-by-command counts.

Use DEV_VERIFIED only if every missing proof above is closed.
