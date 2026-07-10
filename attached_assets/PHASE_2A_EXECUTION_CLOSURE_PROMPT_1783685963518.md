# CODER PROMPT — PHASE 2A EXECUTION CLOSURE: CLOSE 7 OPEN P0 GAPS

## Current accepted status

Documentation update accepted:

PHASE_2A_DOCUMENTATION_UPDATED_PARTIAL_GAP_REMAINS

Overall Phase 2A status remains:

PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS

Do not mark DEV_VERIFIED until all 7 open P0 gaps below are closed with code, tests, DB/API/UI/Telegram dry-run evidence, and report updates.

## Accepted completed / partial items

1. Swing approval now attempts paper trade open.
2. SWING_STAGED_APPROVAL provenance added.
3. FII/DII wired into pre-market Telegram.
4. suppressedIndices added to F&O readiness.
5. Provider import guard cleanup completed.
6. Documentation updated to show partial status.

## Strict rules

- No broker execution.
- No real orders.
- No Telegram spam.
- Telegram verification must use dry-run/sandbox mode only.
- No strategy threshold changes.
- No detector weight changes.
- No confidence formula changes.
- No stop/target formula changes.
- No account balance rewrite.
- No realized P&L rewrite.
- No historical trade rewrite.
- No destructive migration.
- Do not break P0-00 locked plan immutability.
- Do not start unrelated lanes.

---

# GAP 1 — FP-P0-01A: Swing approval end-to-end proof and tests

Close the full chain:

Swing staged candidate → approval → paper_trade_eq → portfolio/live position → Telegram dry-run.

Required reconciliation table:

| Step | Evidence | Result |
|---|---|---|
| staged order exists | DB/API |
| approval status changes PENDING → APPROVED | DB/API |
| paper_trade_eq row created | DB |
| paper_trade_eq.staged_order_id populated | DB |
| portfolio/live position shows source SWING_STAGED_APPROVAL / SWING_QUEUE | API/UI |
| Telegram dry-run includes paper open | dry-run payload |
| post-market does not say paper trades none today | dry-run payload |
| broker execution disabled | config/proof |

Required tests:
1. approval creates paper_trade_eq row.
2. paper_trade_eq row has staged_order_id.
3. portfolio/live position source is visible.
4. Telegram dry-run includes the swing paper open.
5. post-market is not empty when today’s swing paper row exists.
6. approval failure records conversionBlockReason / paperTradeResult.error without rollback.

---

# GAP 2 — FP-P0-02A: Post-market paper trade counts

Wire post-market report to query paper_trade_eq and paper_trade_fo for today’s opens/closes.

Must distinguish:
- Swing paper opens
- F&O paper opens
- Manual paper opens
- Auto paper opens
- Closed today
- Live open positions

Required tests:
1. today’s equity paper row exists → post-market includes it.
2. today’s F&O paper row exists → post-market includes it.
3. no paper rows → post-market may say none, honestly.
4. open positions exist → summary includes open positions separately from today’s opens.

---

# GAP 3 — FP-P0-02B: Telegram swing queue counts

Pre-market and post-market Telegram must include:
- staged
- approved
- expired
- converted/opened
- closed
- blocked
- notification failures

Required tests:
1. staged count matches DB.
2. approved count matches DB.
3. expired count matches DB.
4. converted/opened count matches DB.
5. notification failures count appears when failures exist.
6. dry-run payload includes all fields.

---

# GAP 4 — FP-P0-03A: F&O per-index DATA_BLOCKED reasons

For each index NIFTY / BANKNIFTY / SENSEX, expose:
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

Telegram must say exact reason, for example:
SENSEX blocked: intraday bars missing (0/8), source=Kite, asOf=...

Required tests:
1. all indices OK → none blocked.
2. SENSEX intraday bars missing → only SENSEX blocked.
3. NIFTY OK while SENSEX bad → NIFTY not blocked.
4. exactBlockReason appears in API.
5. exactBlockReason appears in Telegram dry-run.

---

# GAP 5 — FP-P0-03B: One-index failure isolation

Ensure one index failure does not block other valid indices.

Required test scenario:
NIFTY daily OK, intraday OK, option chain OK → not suppressed.
SENSEX daily OK, intraday timeout/missing → suppressed with reason.
BANKNIFTY valid → not suppressed.

---

# GAP 6 — FP-P0-04B: Kite timeout/fail-fast proof

1. Audit all Kite REST call sites:
   - kiteIntraday.ts
   - kiteOptionChain.ts
   - kiteScanner.ts
   - any other Kite client usage
2. Confirm timeout is applied everywhere or add it.
3. Add test proving stalled request fails fast and returns named reason.
4. Telegram/diagnostics must surface timeout reason by index.

---

# GAP 7 — FP-P0-05B: TTL sweep safe-error tests and UI safety

Add tests:
1. sweep success.
2. expired staged candidate.
3. no-op sweep.
4. failed DB/query maps to safe UI error.
5. manual Run Sweep Now path.
6. raw SQL/secrets are never shown in UI/API.

If current UI can show raw SQL, fix it.

---

# Reports to update

Update:
1. FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md
2. FULL_PLATFORM_BUG_REGISTER.csv
3. FULL_PLATFORM_ROUTE_DATAFLOW_MAP.md
4. USER_FACING_CORE_TABS_DEEP_AUDIT_REPORT.md
5. POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md
6. docs/telegram-alert-quality-audit-2026-07-03.md
7. docs/fno-signal-gap-audit/AUDIT-REPORT-2026-06-30.md
8. docs/swing-cash-live-readiness/PART-M-final-report.md

---

# Required test commands

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

# Final verdict

Use exactly one:
- PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED
- PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS
- PHASE_2A_FORENSIC_ONLY_OWNER_APPROVAL_REQUIRED
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

Use DEV_VERIFIED only if all 7 open P0 gaps are closed with code, tests, DB/API/UI/Telegram dry-run proof, and reports updated.
