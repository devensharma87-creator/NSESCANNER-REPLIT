---
name: Pack 32 closure
description: V2 Paper Cohort Isolation Foundation — compile-time locks, 4 canonical cohort IDs, null-resolution compat, migration ready-not-executed, CohortSelector UI, 112 tests.
---

## Pack 32 — V2 Paper Cohort Isolation Foundation

**Date:** 2026-08-06  
**Status:** COMPLETE

### Key decisions

**Hard locks:** `FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean` and `SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean` in `v2PaperLocks.ts`. The `as boolean` cast prevents TS dead-code elimination of the guard. No env-var bypass, no force param.

**Cohort IDs:** `FNO_PAPER_LEGACY | SWING_PAPER_LEGACY | FNO_PAPER_V2 | SWING_PAPER_V2` — stable, never renamed.

**Null-resolution rule:** NULL in `paper_trade_fo.cohort_id` → `FNO_PAPER_LEGACY`; NULL in `paper_trade_eq.cohort_id` → `SWING_PAPER_LEGACY`; NULL in segment tables → infer from `segment` field. Unknown non-null values FAIL CLOSED (exception, not silent fallback).

**Write guard pattern:** `assertV2CohortNotLocked(cohortId)` is called BEFORE any DB operation in any write path. Throws with machine-readable code (`FNO_PAPER_V2_DISABLED` / `SWING_PAPER_V2_DISABLED`).

**COHORT_REGISTRY is deep-frozen:** Both the outer record and each inner metadata object use `Object.freeze()` so mutation attempts fail at runtime (important for Cat 13 immutability test).

**Migration authorization gate:** `runV2CohortAdditiveMigration()` requires env var `AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION = "YES_I_AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION"` — not called from app startup. `paper_account` PK migration is deferred (separate authorization needed).

**V2 NOT_ACTIVATED response:** `balance: null` (not 0), `trades: []`, `status: "NOT_ACTIVATED"` — explicitly not fabricated.

**Why:**
- Prevents any V2 paper trade from entering the DB before FNO qualification data is ready (≥130 trading days of option-premium capture from Pack 9A).
- Two-phase compat means existing legacy rows (with NULL cohort_id) continue working without any migration.
- COHORT_REGISTRY freeze ensures no test can accidentally mutate registry state and poison subsequent tests.

**How to apply:**
- Any new paper-trading write path must call `assertV2CohortNotLocked(cohortId)` as its FIRST line (before DB).
- Any new cohort-scoped query must include `cohortId` in its React Query key (use `paperQueryKey()`).
- Any new Telegram alert must use `cohortAlertDedupKey(cohortId, baseKey)`.

### Files

| File | Purpose |
|---|---|
| `artifacts/api-server/src/lib/v2PaperLocks.ts` | Hard lock constants |
| `artifacts/api-server/src/lib/paperCohort.ts` | Full cohort domain contract (frozen registry, guards, resolvers) |
| `artifacts/api-server/src/lib/paperCohortMigrations.ts` | Migration SQL definitions (guarded, not executed) |
| `lib/api-zod/src/generated/types/paperCohortId.ts` | Zod schema + types |
| `artifacts/scanner/src/components/CohortStatusPanel.tsx` | CohortSelector, V2NotActivatedPanel, CohortLabel |
| `artifacts/api-server/src/lib/p31.pack32.cohortIsolation.test.ts` | 112 tests, 40 categories |

### Gate 10 baseline
- api-server: 6,241 tests / 272 files
- scanner: 1,250 tests / 52 files
- 4-pkg TSC clean
- git diff --check EXIT:0
