# P0.2 Acceptance-Blocker Corrections — Evidence Report
**Branch**: `phase0/authorized-remediation-20260720`  
**Date**: 2026-07-21  
**Spec**: `REPLIT_P0_2_SPEC_COMPLIANCE_CORRECTION_2026-07-21`

---

## Summary

All 5 spec-required code corrections applied. 31/31 tests pass. Both typechecks clean.  
No DB mutations, schema changes, deploy, merge, or push performed.

---

## Correction 1 — Remove invented `TRADE_GRADE_MAX_AGE_SEC = 90` constant

**File**: `artifacts/api-server/src/lib/sessionAdmission.ts`

**Before**: A local `TRADE_GRADE_MAX_AGE_SEC = 90` constant existed as a default for quote freshness checks. It was applied via `ctx.quoteMaxAgeSec ?? TRADE_GRADE_MAX_AGE_SEC` — silently substituting a 90s threshold when the caller omitted `quoteMaxAgeSec`, making the gate appear to validate freshness while actually applying a value not derived from any authoritative per-lane policy.

**After**: The constant is removed entirely. The quote freshness section now:
- Fails closed with `TRADE_ADMISSION_CONTEXT_INCOMPLETE` when `quoteAgeSec` is supplied without `quoteMaxAgeSec`
- Applies no default threshold — callers MUST supply the authoritative value from `MODULE_REQUIREMENTS` (`marketData/requirements.ts`)
- JSDoc updated: lists authoritative per-lane values (fno.indexQuote: 120s, requirements.ts:177) and states the fail-closed contract

**Authoritative source now cited**: `MODULE_REQUIREMENTS.fno.indexQuote.maxFreshnessSec = 120` (requirements.ts:177)

---

## Correction 2 — Add authoritative `FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN` constant

**File**: `artifacts/api-server/src/lib/paperAccount.ts`

**Before**: The F&O Standard-tier (High-Conviction) late-entry cutoff was an inline literal `15 * 60 + 25` in `paperTradingFO.ts` with an invented `policySource` string `"FNO_STANDARD_CUTOFF_15:25"`. No authoritative named constant existed.

**After**: Added named constant with full JSDoc:
```typescript
export const FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN = 15 * 60 + 25;
```
- Placed after `FNO_BASELINE_GUARDRAILS` (14:45 = 885 min)
- JSDoc explains: 15:25 IST = 925 min-of-day, 5 min before 15:30 close
- Documents relationship to the BASELINE lane's tighter 14:45 cutoff

---

## Correction 3 — Wire authoritative constant into session gate

**File**: `artifacts/api-server/src/lib/paperTradingFO.ts`

**Before**:
```typescript
{
  istMinOfDay: 15 * 60 + 25,
  policySource: "FNO_STANDARD_CUTOFF_15:25",
}
```

**After**:
```typescript
{
  istMinOfDay: FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN,
  policySource: "FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN",
}
```
- Import consolidated into the existing `paperAccount` import block (no duplicate import)
- `policySource` now names the constant that can be grepped, not an opaque string

Also re-exported `FNO_BASELINE_GUARDRAILS` and `FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN` from `sessionAdmission.ts` so tests import from one place.

---

## Correction 4 — Fix quote freshness fail-closed path

**File**: `artifacts/api-server/src/lib/sessionAdmission.ts`

**Before**: `ctx.quoteAgeSec` provided without `ctx.quoteMaxAgeSec` silently fell back to `TRADE_GRADE_MAX_AGE_SEC = 90`.

**After**: 
```typescript
if (quoteAgeProvided && !maxAgeProvided) {
  return { allowed: false, reason: "TRADE_ADMISSION_CONTEXT_INCOMPLETE", ... };
}
```
An undecidable freshness check (age known, threshold absent) is now treated as a mandatory context gap. The gate fails closed with a detail string naming `MODULE_REQUIREMENTS` as the authoritative source.

---

## Correction 5 — Rewrite `tradeAdmission.test.ts` with all 22 spec cases

**File**: `artifacts/api-server/src/lib/tradeAdmission.test.ts`

**Test count**: 31 tests (expanded from 16 prior)

**8 new spec-required cases added**:

| # | Spec case | Reason code tested |
|---|---|---|
| 2 | Official holiday (Republic Day 2026-01-26) | `MARKET_CLOSED_HOLIDAY` |
| 3 | Before 09:00 IST (07:30 IST weekday) | `BEFORE_MARKET_SESSION` |
| 5 | Pre-open auction (09:05 IST) | `SPECIAL_SESSION_NOT_AUTHORIZED` |
| 7 | Invalid server timestamp (NaN Date) | `INVALID_SERVER_TIMESTAMP` |
| 10b | `quoteAgeSec` supplied without `quoteMaxAgeSec` | `TRADE_ADMISSION_CONTEXT_INCOMPLETE` |
| 13 | BASELINE 14:45 boundary equality (at 885 → blocked; 884 → admitted) | `ENTRY_CUTOFF_PASSED` |
| 14 | F&O Standard: null cutoff → fail closed; at 15:24 → admitted; at 15:26 → blocked | `ENTRY_CUTOFF_CONFIG_UNAVAILABLE` / `ENTRY_CUTOFF_PASSED` |
| 21 | Missing/null provenance never renders as `VALID_SESSION` | `classifyStoredTimestamp` invariant |
| 22 | Generated `GetPaperPositionsEqResponse` schema accepts all 7 provenance fields | Schema parse |

**Fixes to existing tests**:
- Test 9b: Removed `TRADE_GRADE_MAX_AGE_SEC` import; now uses `quoteMaxAgeSec: 120` citing `MODULE_REQUIREMENTS fno.indexQuote (requirements.ts:177)` as authoritative source
- Test 9c: New companion — verifies 119s < 120s threshold → admitted
- Tests 12/13: `policySource` strings updated to `"FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN"` and `"FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN"`
- Supertest: `MARKET_CLOSED_HOLIDAY` and `BEFORE_MARKET_SESSION` added to the 12-code coverage sweep

---

## Test Evidence

```
 Test Files  1 passed (1)
      Tests  31 passed (31)
   Duration  5.46s
```

**api-server typecheck**: clean (zero errors)  
**scanner typecheck**: clean (zero errors)

---

## Authoritative Policy Sources (no invented values)

| Gate | Source | Value |
|---|---|---|
| Quote freshness (FNO index) | `MODULE_REQUIREMENTS.fno.indexQuote.maxFreshnessSec` (requirements.ts:177) | 120 s |
| Standard-tier AUTO cutoff | `FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN` (paperAccount.ts) | 925 min (15:25 IST) |
| BASELINE-tier AUTO cutoff | `FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN` (paperAccount.ts) | 885 min (14:45 IST) |
| BSE calendar status | `BSE_CALENDAR_VERIFIED = false` (sessionAdmission.ts) | false → CALENDAR_UNAVAILABLE |
| Equity AUTO cutoff | `EQUITY_AUTO_ENTRY_CUTOFF = null` (sessionAdmission.ts) | null → ENTRY_CUTOFF_CONFIG_UNAVAILABLE |

---

## No-touch scope confirmation

- Zero DB mutations, schema changes, or historical-row modifications
- Zero trading logic changes (signal scoring, confluence, sizing, heat, DD latches, capital ledger)
- Zero new routes, no broker/scheduler/deployment changes
- OpenAPI YAML and generated code unchanged from prior session
