# Phase B2.1 — Core Website API/UI Data-State Accuracy
**Status:** COMPLETE — PENDING ACCEPTANCE  
**Date:** 2026-08-01  
**Branch:** main  
**HEAD at start:** da0aff6  

---

## Scope

B2.1 mandates that every core user-facing surface renders every data state
truthfully: loading, live, delayed, stale, partial, unavailable, error, and
closed.  B2.2 (API contracts) and B2.3 (mobile) are explicitly out of scope.

---

## Defect Matrix and Dispositions

| ID | Surface | File | Root Cause | Fix |
|----|---------|------|------------|-----|
| D1 | Global/Dashboard | `artifacts/global/src/pages/Dashboard.tsx:392` | `(changePct ?? 0) >= 0` — null classified as UP/green | Added `hasChange` guard; colour only applied when `Number.isFinite` |
| D2 | Global/Dashboard | `Dashboard.tsx` | No `isError` branch; API failure showed "warming up" | Added explicit `isError` block with actionable message |
| D3 | Global/Dashboard | `Dashboard.tsx` | `staleTime` defaults to 0; unlimited retries | Added `staleTime: 25_000, retry: 1` |
| D4 | Global/Watchlist | `artifacts/global/src/pages/Watchlist.tsx:60` | Same `changePct ?? 0` direction bug as D1 | Same `hasChange` guard pattern |
| D5 | Global/Watchlist | `Watchlist.tsx` | No `isError` state; failure appeared as empty list | Added `isError` block (AlertTriangle + message) |
| D6 | Global/StatusStrip | `artifacts/global/src/components/StatusStrip.tsx:269` | `equity ?? 0` / `index ?? 0` presented missing counts as 0 | Changed to `?? "?"` — genuinely missing is "?" not zero |
| D7 | Global/StatusStrip | `StatusStrip.tsx:228` | `if (!data) return null` — loading and error both invisible | Distinguished `isLoading` (pulse text) from null data |
| D8 | Scanner/Watchlist | `artifacts/scanner/src/pages/watchlist.tsx:120-121` | `changePercent ?? 0` — null rows inflated "unchanged" bucket | Null rows excluded from all directional counts; `noChangeData` tracked and shown |
| D9 | Scanner/Scanner | `artifacts/scanner/src/pages/scanner.tsx:629-636` | `failures ?? 0` — showed "0 failures" when scan metadata absent | `null` when metadata absent; "…" shown until metadata arrives |

---

## New Components / Files

### `artifacts/global/src/components/ui/DataProvenanceBadge.tsx` (new)
- Shared provenance badge for Global app surfaces.
- Exports `resolveDataDisplayState()` (pure function, importable in tests).
- Shows "delayed" for Yahoo sources; "unavailable" for unhealthy; nothing for live.
- Yahoo sources: `"yahoo" | "yahoo-fx" | "yahoo-equity" | "yahoo-index"` — matches B1.1 restriction list.

### `artifacts/api-server/src/lib/b2.uiState.test.ts` (new — 42 tests)
- Pure-function/contract test suite; zero DB connections; zero live provider calls.
- No `.skip`, `.only`, retries, or arbitrary sleeps.
- Covers: shared state classification (T01–T11), direction fix (T12–T16),
  breadth null-safety (T17–T21), coverage display (T22–T29),
  cross-surface parity (T30–T35), B1.1/B0/A0.3 regression guards (T36–T42).

---

## Verification Battery Results

### TypeScript — all five packages

| Package | Result |
|---------|--------|
| `@workspace/api-server` | ✅ 0 errors |
| `@workspace/global` | ✅ 0 errors |
| `@workspace/scanner` | ✅ 0 errors |
| `@workspace/api-client-react` | ✅ 0 errors |
| `@workspace/lib-db` | ✅ 0 errors |

### Test Suites

| Suite | Files | Tests | Duration | Result |
|-------|-------|-------|----------|--------|
| `api-server` (full, `--pool=threads`) | 212 | 4477 | 50.7 s | ✅ |
| `api-server` (b2 targeted) | 1 | 42 | 0.4 s | ✅ |
| `scanner` (full) | 39 | 843 | 6.9 s | ✅ |

### Safety Invariants
- `DB_TEST_RUNTIME_AUTHORIZED` not `'true'` ✅ (T39 confirms)
- Zero live provider calls in test suite ✅ (T40 confirms)
- No `.skip` / `.only` in b2 suite — confirmed by grep ✅

### Git Working Tree

```
 M artifacts/global/src/components/StatusStrip.tsx
 M artifacts/global/src/pages/Dashboard.tsx
 M artifacts/global/src/pages/Watchlist.tsx
 M artifacts/scanner/src/pages/scanner.tsx
 M artifacts/scanner/src/pages/watchlist.tsx
?? artifacts/api-server/src/lib/b2.uiState.test.ts
?? artifacts/global/src/components/ui/DataProvenanceBadge.tsx
```
*(prompt attachment is also `??` — unchanged from session start)*

---

## B1.1 / B0 / A0.3 Regression Status

- `computeFreshness` future-timestamp gate: unmodified ✅  
- `buildMeta` / `unavailableMeta` / `sourceStatusFromMeta`: unmodified ✅  
- `CLOCK_SKEW_TOLERANCE_SEC = 5`: confirmed unchanged by T38 ✅  
- Full api-server suite +42 net new tests, 0 regressions ✅  

---

## Acceptance Conditions

- [x] All 9 defects (D1–D9) resolved  
- [x] `resolveDataDisplayState()` pure function exported and testable  
- [x] 42 B2.1 tests pass, zero skipped  
- [x] 5 TSC checks clean  
- [x] 4477 api-server + 843 scanner tests pass  
- [x] No `.skip`, `.only`, DB calls, or live-provider calls in test suite  
- [x] Evidence file written  
- [x] B1.1 / B0 / A0.3 regressions: 0  
