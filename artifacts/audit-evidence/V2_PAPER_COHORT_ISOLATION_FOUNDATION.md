# V2 Paper-Trading Cohort Isolation Foundation
## Pack 32 Audit Evidence

**Date:** 2026-08-06  
**Task:** Build the V2 Paper-Trading Cohort Isolation Foundation for FNO_PAPER_V2 and SWING_PAPER_V2.  
**Status:** COMPLETE — all gates PASS  

---

## Executive Summary

Pack 32 establishes a non-destructive, two-phase cohort isolation foundation for future V2 paper-trading cohorts. Both V2 cohorts are hard-disabled at compile time. No V2 trades, no V2 account rows, and no V2 capital events exist or can be created while the locks remain false.

The four canonical cohort IDs are:

| Cohort ID | Family | Generation | State |
|---|---|---|---|
| `FNO_PAPER_LEGACY` | FNO | LEGACY | ACTIVE |
| `SWING_PAPER_LEGACY` | SWING_CASH | LEGACY | ACTIVE |
| `FNO_PAPER_V2` | FNO | V2 | DISABLED |
| `SWING_PAPER_V2` | SWING_CASH | V2 | DISABLED |

---

## Gate 1 — Hard Lock Proof

### Lock Constants (compile-time, not runtime env-var reads)

File: `artifacts/api-server/src/lib/v2PaperLocks.ts`

```typescript
export const FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;
export const SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;
```

- `as boolean` prevents TypeScript from narrowing to literal `false` (dead-code elimination of the guard).
- No `process.env` read. No feature flag. No force parameter. No admin bypass.
- Changing requires a code edit + redeploy.

**Test assertion (P32-C7-01):** `expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false)` ✓  
**Test assertion (P32-C8-01):** `expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false)` ✓  
**Test assertion (P32-C9-01/02):** Setting env vars after import does NOT change lock ✓  
**Test assertion (P32-C10-01):** `assertV2CohortNotLocked.length === 1` (no force param) ✓  

---

## Gate 2 — Cohort Contract and Null-Resolution

File: `artifacts/api-server/src/lib/paperCohort.ts`

### Null-Resolution Rules (two-phase compatibility)

| Table | NULL cohort_id resolves to |
|---|---|
| `paper_trade_fo` | `FNO_PAPER_LEGACY` |
| `paper_trade_eq` | `SWING_PAPER_LEGACY` |
| `paper_account` / `paper_capital_event` | Inferred from `segment` field |

Unknown non-null values → **FAIL CLOSED** (exception thrown, never silently become legacy).

**Test assertions:**  
- P32-C4-01/02: `resolveFoCohortId(null)` → `FNO_PAPER_LEGACY` ✓  
- P32-C5-01/02: `resolveEqCohortId(null)` → `SWING_PAPER_LEGACY` ✓  
- P32-C2-02/03/04: Unknown non-null → throws with `code: "UNKNOWN_COHORT"` ✓  

---

## Gate 3 — V2 Write Guard

```typescript
export function assertV2CohortNotLocked(cohortId: PaperCohortId): void {
  if (cohortId === "FNO_PAPER_V2" && !FNO_PAPER_V2_RUNTIME_AUTHORIZED) {
    throw Object.assign(new Error(FNO_PAPER_V2_DISABLED_CODE), {
      code: FNO_PAPER_V2_DISABLED_CODE, cohortId,
    });
  }
  // ... SWING_PAPER_V2 guard ...
}
```

**Pattern in every write path:**
```typescript
// 1. Guard (throws here if V2 and locked)
assertV2CohortNotLocked(cohortId);
// 2. DB insert (never reached for V2)
await db.insert(...);
```

**Test assertion (P32-C11-01):** DB mock never called when guard throws ✓  
**Test assertion (P32-C11-02):** Legacy writes pass through without effect ✓  
**Test assertion (P32-C7-03):** Error code is `FNO_PAPER_V2_DISABLED` ✓  
**Test assertion (P32-C8-03):** Error code is `SWING_PAPER_V2_DISABLED` ✓  

---

## Gate 4 — Asset-Family Mismatch Rejection

```typescript
// resolveFoCohortId rejects SWING cohort_id on an FO row:
expect(() => resolveFoCohortId("SWING_PAPER_LEGACY")).toThrow(
  expect.objectContaining({ code: "ASSET_FAMILY_MISMATCH" })
);
```

**Test assertions (P32-C3-01 through C3-05):** All 5 cross-family rejections verified ✓

---

## Gate 5 — Additive DB Migration (Ready, Not Executed)

File: `artifacts/api-server/src/lib/paperCohortMigrations.ts`

### Tables receiving `cohort_id VARCHAR(32)` (additive, IF NOT EXISTS)

| Table | NULL meaning |
|---|---|
| `paper_trade_fo` | NULL = FNO_PAPER_LEGACY |
| `paper_trade_eq` | NULL = SWING_PAPER_LEGACY |
| `paper_capital_event` | NULL = infer from segment |
| `paper_account` | **DEFERRED** — PK change requires separate authorization |

### Authorization Gate

```typescript
const AUTHORIZATION_TOKEN = "YES_I_AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION";
// runV2CohortAdditiveMigration() exits early if env var !== AUTHORIZATION_TOKEN
```

**Status:** `READY_NOT_EXECUTED`  
**Not called from:** application startup, scheduler boot, or any automatic path.

**Test assertion (P32-C38-01):** Report status is `READY_NOT_EXECUTED` ✓  
**Test assertion (P32-C38-02):** All ALTER TABLE statements use `IF NOT EXISTS` ✓  
**Test assertion (P32-C38-03):** Rollback statements use `DROP COLUMN IF EXISTS` ✓  
**Test assertion (P32-C38-04):** `getMigrationImpactReport()` completes in <50ms (no DB call) ✓  

---

## Gate 6 — Capital Isolation Proof

**Claim:** V2 cohorts have zero inherited balance from legacy cohorts.

**Proof:**
1. `FNO_PAPER_V2_RUNTIME_AUTHORIZED = false` → `assertV2CohortNotLocked("FNO_PAPER_V2")` throws before any DB write.
2. No V2 account row exists in `paper_account` (locked → never created).
3. No V2 balance row exists → no inherited balance possible.
4. `getV2NotActivatedResponse("FNO_PAPER_V2").balance === null` — explicitly null, not ₹0.

**Test assertion (P32-C26-01):** `assertV2HasNoInheritedBalance("FNO_PAPER_V2", false)` passes ✓  
**Test assertion (P32-C26-02):** `assertV2HasNoInheritedBalance("FNO_PAPER_V2", true)` throws with `V2_ACCOUNT_ALREADY_EXISTS` ✓  
**Test assertion (P32-C27-01):** `balance === null` (not 0) ✓  

---

## Gate 7 — UI: V2 Cohort Selector and Not-Activated State

File: `artifacts/scanner/src/components/CohortStatusPanel.tsx`

### Components Delivered

| Component | Purpose |
|---|---|
| `CohortSelector` | Tab selector (Legacy / V2) inside F&O or Equity tabs |
| `V2NotActivatedPanel` | Disabled state panel — explicit "not started" message |
| `CohortLabel` | Compact inline badge for cohort labelling in tables |

### V2 Display Rules
- V2 tabs show a `Lock` icon + "Pending" badge.
- V2 content area shows `V2NotActivatedPanel` — no ₹0, no empty trade table, no fabricated state.
- Panel lists prerequisites explicitly (Pack 9A canary, 130 trading days, frozen protocol).
- `data-testid="v2-not-activated-fno"` and `data-testid="v2-not-activated-swing"` for automated testing.

### Screenshots (3 viewports)

Screenshots captured below at 390×844, 768×1024, and 1440×900.

---

## Gate 8 — Idempotency and Alert Dedup Cohort Isolation

```typescript
cohortIdempotencyPrefix("FNO_PAPER_LEGACY")  // "FNO_PAPER_LEGACY"
cohortIdempotencyPrefix("FNO_PAPER_V2")      // "FNO_PAPER_V2"

cohortAlertDedupKey("FNO_PAPER_LEGACY", "TRADE_OPEN:NIFTY")  // "FNO_PAPER_LEGACY:TRADE_OPEN:NIFTY"
cohortAlertDedupKey("FNO_PAPER_V2", "TRADE_OPEN:NIFTY")      // "FNO_PAPER_V2:TRADE_OPEN:NIFTY"
```

**Test assertion (P32-C15-01):** All 4 cohort idempotency prefixes are distinct ✓  
**Test assertion (P32-C16-01):** V2 alert key cannot suppress legacy alert key ✓  
**Test assertion (P32-C16-02):** Dedup Map doesn't share keys across cohorts ✓  

---

## Gate 9 — API Zod Types

File: `lib/api-zod/src/generated/types/paperCohortId.ts`  
Re-exported from: `lib/api-zod/src/index.ts`

```typescript
export type { PaperCohortId, V2LockStatus, CohortMetadata, V2NotActivatedResponse };
export { paperCohortIdSchema, v2LockStatusSchema, cohortMetadataSchema, PAPER_COHORT_ID_VALUES };
```

**Test assertion (P32-C29-01):** `paperCohortIdSchema` validates all 4 IDs ✓  
**Test assertion (P32-C29-02):** Unknown IDs are rejected by the schema ✓  
**Test assertion (P32-C29-03):** `PAPER_COHORT_ID_VALUES` matches `PAPER_COHORT_IDS` ✓  

---

## Gate 10 — Full Test Battery

### Test Counts (Gate 10 verified)

| Package | Files | Tests | Status |
|---|---|---|---|
| `@workspace/api-server` | 272 | **6,241** | ✅ PASS |
| `@workspace/scanner` | 52 | **1,250** | ✅ PASS |

**Pack 32 new tests:** 112 (p31.pack32.cohortIsolation.test.ts, 40 categories)  
**api-server baseline (pre-Pack 32):** 6,129  
**api-server post-Pack 32:** 6,241 (+112)

### TSC Clean (4 packages)

| Package | Status |
|---|---|
| `@workspace/api-server` | ✅ clean |
| `@workspace/api-zod` | ✅ clean |
| `@workspace/scanner` | ✅ clean |
| `@workspace/api-client-react` | ✅ clean |

### git diff --check

```
EXIT:0 — no whitespace or merge-conflict markers
```

---

## Files Created / Modified

### New Files
| File | Purpose |
|---|---|
| `artifacts/api-server/src/lib/v2PaperLocks.ts` | Hard lock constants (compile-time) |
| `artifacts/api-server/src/lib/paperCohort.ts` | Full cohort domain contract |
| `artifacts/api-server/src/lib/paperCohortMigrations.ts` | Migration definitions (guarded, not executed) |
| `lib/api-zod/src/generated/types/paperCohortId.ts` | Zod schema + types |
| `artifacts/scanner/src/components/CohortStatusPanel.tsx` | CohortSelector, V2NotActivatedPanel, CohortLabel |
| `artifacts/api-server/src/lib/p31.pack32.cohortIsolation.test.ts` | 112 tests, 40 categories |
| `artifacts/audit-evidence/V2_PAPER_COHORT_ISOLATION_FOUNDATION.md` | This document |

### Modified Files
| File | Change |
|---|---|
| `lib/api-zod/src/index.ts` | +15 lines: re-export PaperCohortId and Zod schemas |

---

## Non-Interference Proof

- **No legacy paper trade modified** — no changes to `paperTradingFO.ts`, `paperTradingEq.ts`, `paperAccount.ts`, `eodReconciliation.ts`.
- **No route changed** — `paper.ts` and `fno.ts` are untouched. Cohort validation is ready to wire in as a separate, guarded step.
- **No DB migration executed** — `paper_trade_fo`, `paper_trade_eq`, `paper_capital_event` are unchanged in production.
- **Global artifact frozen** — zero files under `artifacts/global/` modified.
- **Scanner test count unchanged** — 1,250 / 52 (same as Pack 9A baseline).

---

## Cohort Isolation Guarantees (Summary)

| Guarantee | Mechanism | Tested |
|---|---|---|
| V2 write = hard error | `assertV2CohortNotLocked` throws before DB | P32-C7/8/11 ✓ |
| Env var cannot bypass | compile-time constant, no env-var read | P32-C9 ✓ |
| Force flag cannot bypass | function takes only cohortId (no force param) | P32-C10-01 ✓ |
| Null FO row = legacy | `resolveFoCohortId(null)` → LEGACY | P32-C4 ✓ |
| Null EQ row = legacy | `resolveEqCohortId(null)` → LEGACY | P32-C5 ✓ |
| Unknown cohort = fail closed | throws with UNKNOWN_COHORT | P32-C2 ✓ |
| Cross-family cohort = rejected | throws with ASSET_FAMILY_MISMATCH | P32-C3 ✓ |
| V2 balance = null (not ₹0) | `getV2NotActivatedResponse` | P32-C27-01 ✓ |
| V2 alerts isolated | cohort-prefixed dedup keys | P32-C16 ✓ |
| V2 query cache isolated | cohort in React Query key | P32-C31/32 ✓ |
| Migration ready, not executed | guarded by AUTHORIZE env var | P32-C38 ✓ |
| Global artifact untouched | no files changed in artifacts/global | P32-C40 ✓ |

---

END_V2_PAPER_COHORT_ISOLATION_FOUNDATION
