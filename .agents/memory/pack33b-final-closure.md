---
name: Pack 33B final closure (corrected)
description: 8-item evidence closure for pack33b predeploy correction; commit f5d96ae; OWNER_DEPLOYMENT_AUTHORIZATION_REQUIRED
---

## Commit
f5d96ae — pack33b-final-predeploy-correction: 8-item evidence closure

## Baseline
api-server 6826 tests (e523505), scanner 1305 tests

## Final test counts
- api-server: 296 test files / 6876 tests PASS (+50 from 3 new p33b files)
- scanner: 55 test files / 1305 tests PASS
- 4-pkg TSC: CLEAN

## 8 items completed

### Item 1 — Admission fail-closed
- `nseFnoBanGate.ts`: central gate; FnoBanAdmissionResult with 6 verdicts
- NSE_INDEX_DERIVATIVE_SYMBOLS: NIFTY/BANKNIFTY/SENSEX/MIDCPNIFTY/FINNIFTY/NIFTYNXT50/BANKEX → EXEMPT
- Wired into: dispatchFnoWithCanonicalGates (Gate 2.5), stageSwingOrder, openPaperTrade
- `p33b.admissionBanGate.test.ts`: 19 tests (AG-01..AG-18)

### Item 2 — NSE reconciliation (2026-08-09)
- EQUITY_L.csv: 2,397 data rows; 0 rejected; EQ=2,075 BE=294 BZ=28; 2,397 unique ISINs; 169,183 bytes

### Item 3 — Replica-safe persistence (PostgreSQL L2)
- Load chain: L0 (memory) → L1 (disk) → L2 (PostgreSQL) → L3 (HTTP)
- `nse_security_master_snapshots` table declared in runtimeTables.ts (prevents DROP on push)
- Advisory lock (key 8274613): pg_try_advisory_lock, production-only (skipped in dev/test to avoid pool leakage)
- `p33b.nseMasterPersistence.test.ts`: 17 tests (MP-01..MP-09) with vi.hoisted DB mock

### Item 4 — Stale governance
- NSE_REFERENCE_MAX_AGE_HOURS = 48 (exported)
- canAuthorizeUniverse: false when isLastGood=true OR age > 48h; true only fresh HTTP
- NseMasterMeta: ageHours, stale, maxAgeHours, canAuthorizeUniverse fields
- GET /api/data/diagnostics/nse-reference (owner-only) returns full meta

### Item 5 — Generation immutability
- fullNseScanner.ts: canAuthorizeUniverse=false gate → BLOCKED_STALE_NSE_REFERENCE
- `p33b.nseGenerationImmutability.test.ts`: 14 tests (GI-01..GI-08)

### Item 6 — Full dist tree scan
- Scanner dist: 9 files; hits are UI display strings (env var NAMES shown to user)
- API server dist: 10 files; hits are process.env.* references in compiled code
- No actual secret values in any dist file

### Item 7 — Four safety locks confirmed
- FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean (candleEvaluationControl.ts:44)
- SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean (candleEvaluationControl.ts:117)
- FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean (v2PaperLocks.ts:39)
- SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean (v2PaperLocks.ts:40)
- FNO_AUTO_OPEN_C0_BLOCKED = true (paperTradingFO.ts:398)
- EQUITY_AUTO_OPEN_C0_BLOCKED = true (paperTradingEq.ts:1385)

### Item 8 — Full closing battery
- git diff --check: CLEAN
- skip/only audit: all .skip are conditional guards; no hard .only
- secret sentinel: CLEAN
- provider import guard: CLEAN
- artifacts/global: UNCHANGED

## Status
OWNER_DEPLOYMENT_AUTHORIZATION_REQUIRED

## Key technical notes
- Advisory lock uses pg_try_advisory_lock (session-level) which MUST NOT be used in tests
  via connection pool (acquire+release use different connections). Guard: NODE_ENV !== 'production'.
- p33b.nseLastGood.test.ts, p33b.nseMasterPersistence.test.ts, p33b.nseGenerationImmutability.test.ts
  all require vi.hoisted + vi.mock('@workspace/db') to prevent real DB interaction.
- _injectCacheForTest() added for state injection in tests (sets bySymbol/byIsin to empty Maps).
