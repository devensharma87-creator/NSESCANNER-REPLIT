---
name: Phase 0 containment deliverables 2026-07-20
description: P0-A/C/D/G implementations, 9 memory deliverable files, test results, and known open items from the superseding Phase 0 work order.
---

# Phase 0 Containment — Durable Summary

**Date:** 2026-07-20  
**HEAD at completion:** post-commit (all changes on main — branch creation blocked by Replit policy)

## What Was Implemented

| Item | File | Status |
|------|------|--------|
| `isTradeGradeSwingRow()` | `swingSignals.ts` | SHIPPED |
| `LEVELS_NOT_TRADE_GRADE` gate | `paperTradingEq.ts` | SHIPPED |
| `CONTRACT_NOT_TRADE_GRADE` SkipReason + gate | `paperTradingFO.ts` | SHIPPED |
| `LEVELS_NOT_TRADE_GRADE` in EqAuditReason | `paperEqAudit.ts` | SHIPPED |
| `TradeAdmissionDecision` + `evaluateAdmission()` | `tradeAdmissionDecision.ts` (new) | SHIPPED |
| `requireIsolatedTestDb()` + sentinel | `testIsolationGuard.ts` (new) | SHIPPED |
| Read-only `detectInvalidSessionTrades()` | `invalidSessionDetector.ts` (new) | SHIPPED |
| 18 provenance/sentinel unit tests | `swingSignals.provenance.test.ts` (new) | 18/18 PASS |
| 9 deliverable memory files | `memory/PHASE0_*.md` et al. | WRITTEN |

## Safety Invariants (CONFIRMED UNCHANGED)

- `FNO_AUTO_OPEN_C0_BLOCKED = true` (paperTradingFO.ts:396)
- `EQUITY_AUTO_OPEN_C0_BLOCKED = true` (paperTradingEq.ts:1047)
- Zero DB mutations, zero broker calls, zero Telegram sends in this session
- `drizzle-kit push` NOT run

## Key NEEDS_OFFICIAL_FACT (Do NOT change without primary source)

1. **BANKNIFTY/SENSEX expiry weekday** — repo has BANKNIFTY=monthly/Thu, SENSEX=weekly/Tue. Scratchpad said "reversed" but no official NSE/BSE circular URL confirmed. Do NOT change.
2. **Holiday calendar dates** — ZIP and repo conflict; neither authoritative without NSE/BSE official circular.

## Open Owner Actions Required Before Phase 1

1. Provision `TEST_DATABASE_URL` (disposable Postgres, name must contain "test"/"vitest"/"ephemeral"/"tmp")
2. Classify F&O balance drift ₹799,772.70 (root cause UNPROVED)
3. Classify 6 deleted SILENT_DRIFT audit rows (evidence irrecoverable)
4. Classify equity test contamination (all rows need provenance classification)
5. Create the `phase0/containment-forensics-20260720` branch via alternative mechanism (Replit policy blocked main-agent creation)
6. Provide official NSE/BSE circular URL for BANKNIFTY/SENSEX expiry weekday + 2026 holiday dates

## Why these gates are defense-in-depth (not C0 replacement)

`LEVELS_NOT_TRADE_GRADE` and `CONTRACT_NOT_TRADE_GRADE` block AFTER C0. They protect against a future caller lifting C0 without first completing Phase 1 (Kite candle warehouse, warm instrument master). C0 remains the primary block.

## 30-Session Qualification Clock

NOT_STARTED — requires all open owner actions resolved + Phase 1 canonical session service shipped.
