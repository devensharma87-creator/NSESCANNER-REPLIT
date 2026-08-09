---
name: Pack 33B Continuation Closure
description: PROMPT_33B_CONTINUATION implementation — all 10 sections complete; production data surface + API contract; Phase A performance fix; scanner data contract; fnoBanList tri-state; preMarket false-zero; trust badge overhaul.
---

## Sections Implemented

### Section 1 — Three independent quality dimensions (scannerDataContract.ts)
- Types: `DataState`, `EvaluationState`, `Actionability`
- `computeScannerGrade()` computes all three independently from their own inputs
- 38 tests proving invariants (scannerDataContract.test.ts)
- INVARIANT: Phase A + READY_LIVE → NOT_ACTIONABLE (never TRADE_GRADE)

### Section 2 — Provisional classifier provenance
- `CLASSIFIER_PROVENANCE` export from fullNseScanner.ts
- status: "ELIGIBILITY_CLASSIFIER_PROVISIONAL", canaryStatus: "CANARY_BLOCKED"
- Exposed in `/api/scan/full-nse` response as `classifierProvenance`

### Section 3 — Immutable generation identity
- `generationId` added to Cache interface (format: `gen-{ts}-{counter}`)
- `inProgressGenerationId` in Progress interface
- `getFullNseStatus()` returns both `displayedGenerationId` and `inProgressGenerationId`
- DISK_CACHE_VERSION bumped 17 → 18

### Section 4 — Exact count reconciliation
- `ScanCountReconciliation` type with full breakdown (rawKiteMaster → eligibleOrdinaryEquities)
- Three accounting equations validated; `allValid` flag in API response
- Per-phase timing recorded in `timingMs` field
- Production verified: reconciliationValid=true, 2416/2416 rows, 4219ms cold scan

### Section E — Performance fix (Phase A enrichment skip)
**Root cause:** 400 per-row Yahoo enrichment calls ran even in Phase A where indicators
are unused (rows get NOT_EVALUATED). With Kite online at ENRICH_TIMEOUT=25s, this
adds up to 25s of dead enrichment time per cycle.
**Fix:** `if (!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED) { enrichList = []; }`
**Impact:** Cold Phase A scan 1294.5s → 4219ms (308× improvement)
**p50/p95/max from 10 warm scans:** 26ms / 33ms / 33ms

### Section F — Home page false zeros
1. `buildTradeSetups`: Skip when `compositeBias?.score == null` (was: `?? 0`)
2. `isFnoBanned()`: Now tri-state `boolean | null` (null = UNAVAILABLE)
   - `isFnoBannedLegacy()` added for backward compat with deprecation warning

### Section 7 — Trust badge correction  
**Bug:** `fallbackUsed: phaseA` in UnifiedGradeChip misused fallback field to proxy Phase A lock
**Fix:** `fallbackUsed = actionability !== "TRADE_GRADE"` (from data contract)
**Proven:** 38 tests in scannerDataContract.test.ts include invariant proofs for badge logic

### Section 1/7 — DataSourceBadge driven by dataState + actionability
**Bug:** Phase A + fresh Kite → badge showed "delayed" (wrong reason — data is not late)
**Fix:** Badge status derived from `dataState` + `actionability` from the grade contract
- `READY_LIVE + TRADE_GRADE` → "live"
- `READY_LIVE + NOT_ACTIONABLE` → "delayed" (data is fresh; evaluation is locked)
- `UNAVAILABLE` → "stale", `ERROR` → "down"

## Battery Results (2026-08-09)
- api-server TSC: CLEAN (0 errors)
- scanner TSC: CLEAN (0 errors)  
- global TSC: CLEAN (0 errors)
- 4-pkg TSC: ALL CLEAN
- api-server tests: 6667/284 files PASSED
- scanner tests: 1250/52 files PASSED
- git diff --check: CLEAN
- Scanner prod build: SUCCESS (9.14s)
- Global prod build: SUCCESS (3.33s)
- api-server prod build: SUCCESS (7.3mb dist/index.mjs, 650ms)
- Skip/only audit: No unconditional .skip/.only
- Secret sentinel: CLEAN (no hardcoded values)
- Provider import guard: CLEAN
- scannerDataContract tests: 38/38 PASSED
- eligibilityGates tests: 40/40 PASSED

**Why:** PROMPT_33B_PRODUCTION_DATA_SURFACE_AND_API_CONTRACT_IMPLEMENTED_IN_DEVELOPMENT — OWNER_DEPLOYMENT_AUTHORIZATION_REQUIRED
