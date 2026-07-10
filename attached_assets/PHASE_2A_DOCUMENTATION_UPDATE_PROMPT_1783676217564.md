# CODER PROMPT — PHASE 2A DOCUMENTATION UPDATE ONLY

## Current owner-reviewed verdict

PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS

Do not mark DEV_VERIFIED.
Do not start new code fixes in this documentation-only pass.
Do not start Lane 2, paper ledger redesign, chart reliability, ATR/Wilder, equity gap-through exits, or any unrelated work.

This task is only to update documentation so the project register honestly reflects what was accepted and what remains open.

---

# 1. Accepted completed items to document

Document the following as accepted partial completions:

## 1.1 Swing Approval → paper_trade_eq code path wired

Status:

SWING_APPROVAL_TO_PAPER_ATTEMPT_PARTIAL_DEV_VERIFIED

What was done:
- `swingOrderStaging.ts` now calls `openPaperEquityTradeFromStagedOrder(stagingRow)` after the CAS approval succeeds.
- `openPaperEquityTradeFromStagedOrder()` was added in `paperTradingEq.ts`.
- It opens via standard `openPaperEquityTrade()` with `source: "SWING_STAGED_APPROVAL"`.
- The flow is fire-safe: approval is not rolled back if paper-open fails.

What remains:
- No DB/API/UI/Telegram reconciliation proof yet.
- No proof that `paper_trade_eq` row is created in end-to-end scenario.
- No proof that `staged_order_id` is populated.
- No proof that portfolio shows source correctly.
- No proof that Telegram includes the paper open.

## 1.2 SWING_STAGED_APPROVAL provenance added

Status:

SWING_STAGED_APPROVAL_PROVENANCE_DEV_VERIFIED

What was done:
- New source is recognized by write-source to provenance mapper.
- `is_autonomous=false`.
- Audit label uses `SWING_APPROVAL_OPEN`.

What remains:
- Needs end-to-end proof with actual approved staged order.

## 1.3 FII/DII wired into pre-market report

Status:

FII_DII_PREMARKET_SECTION_DEV_VERIFIED

What was done:
- Pre-market report uses `getFiiDiiMonthly()`.
- Reads from `fii_dii_monthly`.
- Formats latest FII/DII net flows in crores.
- Falls back honestly to unavailable if DB query fails.

What remains:
- Post-market participant/OI/journal tie-in sections not proven.
- Full Telegram summary reconciliation not done.

## 1.4 suppressedIndices added to F&O readiness

Status:

FNO_SUPPRESSED_INDICES_PARTIAL_DEV_VERIFIED

What was done:
- `canonicalFnoReadiness.ts` now includes `suppressedIndices: string[]`.
- Suppressed index names are included in Telegram/readiness summary.

What remains:
- This is not the full per-index `DATA_BLOCKED` fix.
- Need per-index daily bars / intraday bars / option-chain / quote status.
- Need exact reason per NIFTY/BANKNIFTY/SENSEX.
- Need proof that one bad index does not block valid indices.

## 1.5 Provider import guard cleanup

Status:

PROVIDER_IMPORT_GUARD_CLEANUP_DEV_VERIFIED

What was done:
- `contractMasterFact.ts` and `paperTradingFO.ts` route runtime imports via compat layer.
- Allowlist was not expanded.
- Guard failure fixed.

---

# 2. Outstanding Phase 2A P0 tasks to document

Add the following open items to the master bug register / report.

## FP-P0-01A — Swing approval end-to-end proof missing

Severity: P0
Status: OPEN_P0

Required proof:
| Step | Required evidence |
|---|---|
| Swing staged candidate exists | DB/API row |
| Approval changes status to APPROVED | DB row |
| Paper trade created | `paper_trade_eq` row |
| Link stored | `paper_trade_eq.staged_order_id` |
| Portfolio position visible | UI/API |
| Telegram dry-run includes paper open | dry-run payload |
| Broker execution disabled | config/proof |

## FP-P0-02A — Telegram post-market paper-trade reconciliation missing

Severity: P0
Status: OPEN_P0

Problem:
Post-market can still say “paper trades none today” unless proven otherwise.

Required:
- If any swing/F&O paper trade opened or closed today, Telegram must not say none.
- Live open positions must be summarized clearly.
- Manual/swing/auto source must be distinguished.

## FP-P0-02B — Telegram swing count reconciliation missing

Severity: P0
Status: OPEN_P0

Required counts:
- staged
- approved
- expired
- converted/opened
- closed
- blocked
- notification failures

## FP-P0-03A — F&O DATA_BLOCKED per-index diagnostics missing

Severity: P0
Status: OPEN_P0

Required per index:
- dailyBars count/status
- intradayBars count/status
- quote status
- option-chain status
- source
- asOf/freshness
- failure reason
- blocked true/false

## FP-P0-03B — One-index failure isolation missing

Severity: P0
Status: OPEN_P0

Required:
- NIFTY must not be blocked if only SENSEX bars fail.
- BANKNIFTY must not be blocked if only another index fails.
- Telegram must explain which index is blocked and why.

## FP-P0-04 — Kite timeout/fail-fast proof missing

Severity: P0
Status: OPEN_P0

Required:
- Test/proof that stalled Kite request times out.
- Timeout must not starve full signal queue.
- Telegram/diagnostics should show timeout reason.

## FP-P0-05 — TTL sweep safe UI tests missing

Severity: P0
Status: OPEN_P0

Required:
- sweep success test
- expired staged candidate test
- no-op test
- failed query maps to safe UI error
- raw SQL/secrets never shown in UI
- manual Run Sweep Now test

## FP-P0-06 — Reports/register not fully updated

Severity: P0
Status: OPEN_P0

Required:
Update all docs listed below with Phase 2A accepted partial work and remaining blockers.

---

# 3. Required files to update

Update these files:

1. `FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md`
2. `FULL_PLATFORM_BUG_REGISTER.csv`
3. `FULL_PLATFORM_ROUTE_DATAFLOW_MAP.md`
4. `USER_FACING_CORE_TABS_DEEP_AUDIT_REPORT.md`
5. `POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md`
6. Any existing Swing / Telegram / F&O report files in repo.

Do not delete old findings.
Do not hide failures.
Mark duplicates if any, but keep traceability.

---

# 4. Required documentation format

Add a section titled:

`Phase 2A — Partial Completion and Outstanding P0 Development Tasks`

Include:

## Accepted partial completions
| ID | Title | Status | Evidence | Remaining proof |
|---|---|---|---|---|

## Outstanding P0 work
| ID | Title | Severity | Current status | Required fix | Required proof |
|---|---|---|---|---|---|

## Next execution queue
1. Complete Swing approval → paper → portfolio → Telegram reconciliation.
2. Complete Telegram post-market/pre-market summary reconciliation.
3. Complete F&O DATA_BLOCKED per-index diagnostics and one-index failure isolation.
4. Add Kite timeout/fail-fast tests.
5. Add TTL sweep safe UI tests.
6. Run required verification package.

---

# 5. Verification for documentation-only update

Run:

```bash
pnpm --filter @workspace/scripts run index:llm
pnpm --filter @workspace/scripts run index:llm:check
```

If documentation lint/check exists, run it.

No code tests are required if no code changed.

---

# 6. Final verdict

Final documentation-only verdict must be exactly:

PHASE_2A_DOCUMENTATION_UPDATED_PARTIAL_GAP_REMAINS

Do not use:
- PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED
- PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED

Those are not earned yet.
