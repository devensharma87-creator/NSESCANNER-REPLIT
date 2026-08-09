---
name: Pack 33B three-blocker closure
description: PROMPT_33B_DATA_IDENTITY_AND_DEBUG_ISOLATION — three blockers resolved; NSE EQUITY_L.csv reference join, debug route isolation, F&O ban 6-field contract. Commit 282e245.
---

## Summary
Three blockers from P33B predeploy resolved. All safety locks remain false. Canary status unchanged (BLOCKED).

## Blocker 1 — NSE Authoritative Reference (EQUITY_L.csv)

### nseSecurityMaster.ts (new)
- `getNseSecurityMaster()` — async, triggers HTTP fetch (15s timeout), fail-safe
- `getNseSecurityMasterMap()` — synchronous, reads from in-memory cache
- `getNseSecurityMasterMeta()` — synchronous, returns meta with loaded/snapshotDate/sourceHash
- `classifyNseSeries(series)` — EQ→ORDINARY_MAIN_BOARD_EQUITY, BE/BT→TRADE_TO_TRADE, SM/ST→SME, other→OTHER_NSE_SERIES

### instrumentEligibility.ts — three-state nseRef
- `nseRef=undefined` (not passed) → backward-compat `ORDINARY_EQUITY_ELIGIBLE` (warehouseEligible=true)
- `nseRef=null` (feature active, reference unavailable) → `KITE_NSE_EQ_LIKE_PROVISIONAL` (warehouseEligible=false)
- `nseRef=Map` (loaded) → authoritative: EQ→ORDINARY_MAIN_BOARD_EQUITY, BE→T2T excluded, SM/ST→SME excluded, absent→UNRESOLVED
- `KITE_NSE_EQ_LIKE_PROVISIONAL` is NOT in WAREHOUSE_EXCLUDED_CLASSES (prices shown; signals blocked separately)

### fullNseScanner.ts — two-pass classification
1. Provisional first-pass (nseRef=null) before factory check — test scans don't wait for HTTP
2. Real scans: load NSE master AFTER factory check (avoids 15s timeout in test spin-waits), then re-classify
- DISK_CACHE_VERSION: 18 → 19
- ScanCountReconciliation +6 fields: rawKiteNseInstrumentCount, kiteInstrumentTypeEqCount, provisionallyClassifiedCount, authoritativelyVerifiedOrdinaryEquityCount, unresolvedSecurityCount, excludedSecurityCount
- ClassifierProvenance.authoritativeNseReferenceIntegrated: false → boolean
- buildClassifierProvenance(nseRefMeta) returns dynamic provenance per scan

### Critical timing fix
- `_testScanResultFactory` spin-wait (200ms) failed because getNseSecurityMaster() has 15s HTTP timeout
- Fix: NSE master loaded AFTER factory check; progress.inProgressGenerationId set at ORIGINAL position (before/after factory check, after Kite I/O)
- Test scans never trigger NSE HTTP; real scans get authoritative reference

## Blocker 2 — Debug Route Isolation

### App.tsx
- `HomeDebugPage` changed from static import to `React.lazy(() => import("@/pages/home-debug"))`
- Guard: `const HomeDebugPage = (import.meta.env.DEV as boolean) ? lazy(...) : null`
- Route: `{(import.meta.env.DEV as boolean) && HomeDebugPage && (<Route .../>)}`
- Vite replaces `import.meta.env.DEV` with `false` in production → tree-shaken

## Blocker 3 — F&O Ban 6-Field Contract

### New shape
```
status: "CURRENT" | "LAST_KNOWN_STALE" | "UNAVAILABLE"
currentAvailable: boolean
hasLastKnown: boolean
stale: boolean
canAuthorizeAdmission: boolean   ← true ONLY when status=CURRENT
sourceAsOf: string | null
```

### Admission semantics
- CURRENT + canAuthorizeAdmission=true → isFnoBanned returns boolean
- LAST_KNOWN_STALE + canAuthorizeAdmission=false → isFnoBanned returns null (fail closed)
- UNAVAILABLE + canAuthorizeAdmission=false → isFnoBanned returns null (fail closed)
- FnoBanBanner: fails closed when !data || status=UNAVAILABLE || !canAuthorizeAdmission

## Test counts (commit 282e245)
- api-server: 6779/6779 PASS (291 files)
- scanner: 1304/1304 PASS (55 files)
- TSC: all 4 packages clean
- Prod builds: api-server ⚡ 647ms, scanner ✓ 9.80s

## New test files
- p33b.fnoBanAdmission.test.ts (api-server): 16 tests
- p33b.nseIdentityTests.test.ts (api-server): 33 tests
- p33b.scannerBundleScan.test.ts (scanner): 6 describe blocks, source-scan proofs
- p33b.homeRendered.test.tsx (scanner): LAST_KNOWN_STALE test added

## Safety invariants (unchanged)
- All safety locks: false as boolean
- Canary: CANARY_BLOCKED_AUTHORITATIVE_NSE_SECURITY_REFERENCE_REQUIRED
- No deployment, no evaluation enable, no V2 activation
