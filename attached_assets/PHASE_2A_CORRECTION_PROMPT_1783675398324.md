# CODER CORRECTION PROMPT — PHASE 2A IS PARTIAL, CLOSE REMAINING P0 GAPS

Current owner-review verdict:

PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS

Your latest sprint included useful code, but it does not satisfy the Phase 2A acceptance criteria. Do not claim DEV_VERIFIED yet.

Accepted sub-fixes:
1. Swing staging approval now attempts to create a paper equity trade through openPaperEquityTradeFromStagedOrder().
2. paper_trade_eq linkage via staged_order_id was added.
3. SWING_STAGED_APPROVAL provenance was added.
4. FII/DII was wired into pre-market report.
5. suppressedIndices was added to canonical F&O readiness / Telegram summary.
6. providerImportGuard violations were cleaned up through compat layer.
7. Reported tests: api-server chunks 619 + 365, targeted swing/paper 174, targeted fno/lifecycle 297, scanner 770, typecheck clean.

Remaining blockers:
1. Telegram post-market still not proven to reconcile swing/paper positions and “paper trades none today.”
2. Telegram swing counts staged/approved/expired/open/closed are not proven.
3. Swing queue → paper trade → portfolio → Telegram dry-run proof is missing.
4. F&O DATA_BLOCKED is not truly per-index; only suppressedIndices was appended. Need daily/intraday bars per index and exact reasons.
5. Kite timeout/fail-fast proof is missing.
6. TTL sweep was inspected only; no tests/proof that raw SQL error cannot appear.
7. Required reports / master bug register updates were not shown.
8. verify:release, LLM index, and full required command counts were not provided.
9. No DB/API/UI/Telegram reconciliation table was provided.

====================================================
STRICT RULES
====================================================

Do not start any new lane.
No broker execution.
No real orders.
No Telegram spam.
Telegram must use dry-run/sandbox only unless owner approves.
No strategy threshold changes.
No detector weight changes.
No confidence formula changes.
No stop/target formula changes.
No account balance rewrite.
No realized P&L rewrite.
No historical trade rewrite.
No destructive migration.
Do not break P0-00 locked plan immutability.

====================================================
GAP 1 — COMPLETE SWING → PAPER → PORTFOLIO → TELEGRAM RECONCILIATION
====================================================

Provide proof, not just code.

Required table:

| Step | DB/API/UI/Telegram Evidence | Result |
|---|---|---|
| Swing staged candidate exists |
| Approval changes status to APPROVED |
| paper_trade_eq row created |
| paper_trade_eq.staged_order_id populated |
| portfolio/live positions show source SWING_QUEUE |
| Telegram dry-run includes swing paper open |
| Post-market no longer says paper trades none today |
| Broker execution remains disabled |

Add/verify tests:
1. approved staged swing creates paper_trade_eq row.
2. portfolio/live position has SWING_QUEUE or staged source.
3. Telegram dry-run includes the new swing paper open.
4. post-market summary does not say “none today” when a swing paper row exists.
5. approval failure records conversionBlockReason.

====================================================
GAP 2 — TELEGRAM SUMMARY BUILDER MUST RECONCILE ALL REQUIRED EXISTING DATA
====================================================

Wire and prove:

1. swing staged count
2. swing approved count
3. swing expired count
4. swing paper opened today
5. swing paper closed today
6. live swing open positions
7. F&O generated
8. F&O suppressed
9. F&O tradeable
10. F&O paper opened/closed today
11. notification failures
12. broker execution status
13. FII/DII
14. India VIX, if already available
15. F&O ban list, if already available
16. sectors, if already available

If a data section is genuinely unavailable, label it honestly with reason.

Required dry-run payload proof:
- pre-market payload
- post-market payload

No real Telegram send.

====================================================
GAP 3 — F&O DATA_BLOCKED PER-INDEX DIAGNOSTICS
====================================================

Do not only show suppressedIndices.

Required:
1. dailyBars status per NIFTY/BANKNIFTY/SENSEX.
2. intradayBars status per NIFTY/BANKNIFTY/SENSEX.
3. optionChain status per index.
4. quote status per index.
5. source/asOf/freshness per index.
6. exact failure reason per index.
7. one index failure must not block other valid indices.
8. Telegram must show symbol-level blocked reason.
9. Add Kite timeout/fail-fast proof or clearly point to existing implementation with test.

Required tests:
1. NIFTY valid, SENSEX bars missing → NIFTY not blocked.
2. one index timeout does not block all.
3. DATA_BLOCKED message lists exact symbol and reason.
4. suppressed signal includes exact reason.
5. stalled Kite request times out safely.

====================================================
GAP 4 — TTL SWEEP SAFE UI AND TESTS
====================================================

The screenshot showed a raw SQL/schema error in TTL sweep. Inspection is not enough.

Required:
1. test sweep success.
2. test expired staged candidate.
3. test no-op sweep.
4. test failed query maps to safe UI error.
5. UI must not show raw SQL/secrets.
6. manual “Run sweep now” path tested.

====================================================
GAP 5 — REPORTS / BUG REGISTER
====================================================

Update:
1. FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md
2. FULL_PLATFORM_BUG_REGISTER.csv
3. FULL_PLATFORM_ROUTE_DATAFLOW_MAP.md
4. USER_FACING_CORE_TABS_DEEP_AUDIT_REPORT.md
5. POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md
6. Any swing / telegram / F&O report files

Add:
- root cause
- files changed
- DB/API/UI/Telegram proof
- tests and exact counts
- what remains
- final verdict

====================================================
REQUIRED TEST COMMANDS
====================================================

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

====================================================
FINAL VERDICT
====================================================

Final verdict must be exactly one:

- PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED
- PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS
- PHASE_2A_FORENSIC_ONLY_OWNER_APPROVAL_REQUIRED
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

Use DEV_VERIFIED only if all remaining gaps are closed with DB/API/UI/Telegram dry-run proof and exact required test counts.
