---
name: Pack 33B final closure
description: 8-item pre-deployment evidence correction — all items closed; OWNER_DEPLOYMENT_AUTHORIZATION_REQUIRED.
---

# Pack 33B Final Correctness Correction — Closure

## Closing battery result

| Gate | Result |
|---|---|
| api-server TSC | CLEAN |
| scanner TSC | CLEAN |
| api-server tests (4 chunks) | **6909 PASS** / 297 files |
| scanner tests | **1305 PASS** / 55 files |
| Item 2 reconciliation report | **PASS** |
| Authorization flags (4) | ALL false |

## 8 items final status

### Item 1 — NSE 10-class → 14-class system
- Added `REIT_OR_INVIT` and `PARTLY_PAID_OR_PREFERENCE` to `InstrumentEligibilityClass` union
- Both added to `WAREHOUSE_EXCLUDED_CLASSES`
- Detection as steps 9a/9b **before** NSE reference join
- REIT triggers: name contains "REIT", "INVIT", "INFRASTRUCTURE INVESTMENT TRUST"
- PP triggers: symbol suffix "-PP" OR name contains "PARTLY PAID", "PARTLY-PAID", "PREFERENCE"
- 33 new tests (CF-01..CF-32) — all PASS

### Item 2 — Reconciliation report
- Script: `artifacts/api-server/src/lib/p33b.reconciliationReport.ts`
- Run: `pnpm exec tsx src/lib/p33b.reconciliationReport.ts`
- ELIGIBLE(3) + EXCLUDED(11) = 14 ✓ BALANCED; 0 class mismatches; REIT/PP excluded ✓

### Item 3 — F&O ban admission semantics
- `FnoBanAdmissionResult` extended with `banListStatus`, `canAuthorizeAdmission`, `banned`, `asOf`
- `BLOCKED_STALE_LIST` (banListStatus=LAST_KNOWN_STALE) is now distinct from `BLOCKED_UNAVAILABLE`
- Backward-compat: `verdict`, `allowed`, `rawBanResult`, `reason` retained
- File: `nseFnoBanGate.ts`

### Item 4 — Swing Cash / F&O ban separation
- F&O ban no longer hard-blocks swing cash (CNC delivery) staging
- `fnoBanAdmission?: FnoBanAdmissionResult | null` added to `StageSwingOrderResult`
- All return paths thread `fnoBanAdmission`
- File: `swingOrderStaging.ts`

### Item 5 — NSE-reference PostgreSQL persistence durability
- Both `void _saveSnapshotToDb(...)` → `await _saveSnapshotToDb(...)` in `nseSecurityMaster.ts`
- Hermetic disk mock added to `p33b.nseMasterPersistence.test.ts` to fix cross-file contamination race

### Item 6 — Stale-reference governance
- Already correct — no changes

### Item 7 — Production artifact tree cleanup
- `artifacts/scanner/public/project-codebase-summary.md` deleted

### Item 8 — Closing battery
- All PASS; see top table

## Authorization flags (ALL false — no deployment performed)
- `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false` (candleEvaluationControl.ts:44)
- `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false` (candleEvaluationControl.ts:117)
- `AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION` env var: NOT_SET
- No canary activation flag set

## Key test files added
- `p33b.correctionFinal.test.ts` — 33 tests (CF-01..CF-32)
- `p33b.reconciliationReport.ts` — executable reconciliation script

**Why:** Final pre-deployment evidence gate. Owner must authorize deployment manually after reviewing this evidence.
