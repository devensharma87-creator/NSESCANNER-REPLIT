---
name: Pack 33B final closure
description: All six items of PROMPT_33B_FINAL_FAIL_CLOSED_REFERENCE_GATE implemented; commit e523505
---

## Six Items Delivered (commit e523505)

**Item 1 — nseRef required (non-optional)**
- `NseSecurityReference` type exported from instrumentEligibility.ts
- `nseRef: NseSecurityReference | null` is non-optional (compile error if omitted)
- nseRef=null → KITE_NSE_EQ_LIKE_PROVISIONAL (fail-closed)
- nseRef=Map → authoritative series join
- `KITE_NSE_EQ_LIKE_PROVISIONAL` and `ORDINARY_EQUITY_ELIGIBLE` added to WAREHOUSE_EXCLUDED_CLASSES
- `fullNseWarehouse.ts`: imports getNseSecurityMasterMap() and passes as nseRef
- `fullNseScanner.ts`: provisional first-pass REMOVED; single authoritative pass only

**Item 2 — Live NSE reference evidence**
- URL: https://archives.nseindia.com/content/equities/EQUITY_L.csv
- HTTP 200, 169,183 bytes, SHA-256: 153db8e940a6155131...
- Header: SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE
- 2,397 data rows: 2,075 EQ + 294 BE + 28 BZ
- HINDCOPPER in prod bundle from fnoUniverse.ts (production symbol), NOT from home-debug.tsx

**Item 3 — Last-good disk persistence**
- nseSecurityMaster.ts: LAST_GOOD_BLOB_NAME="nse-security-master-last-good", VERSION=1
- saveLastGoodToDisk() on every successful fresh HTTP fetch
- tryLoadLastGoodFromDisk() on failure: isLastGood=true, staleReason set
- HTTP fail + no disk blob → null (BLOCKED, fail-closed)
- isLastGood/staleReason on MasterCache and getNseSecurityMasterMeta()
- _clearLastGoodDiskBlobForTest() + _resetNseSecurityMasterForTest() for test isolation

**Item 4 — Debug route prod build isolation**
- All forbidden strings ABSENT from new prod build (index-D1E9sgUF.js)
- /debug/home-states, HomeDebugPage, STATE-A/B/C, MANINFRA, home-debug: all PASS

**Item 5 — F&O admission fail-closed runtime tests**
- _resetFnoBanListForTest() added to fnoBanList.ts
- p33b.fnoAdmissionRuntime.test.ts: 20 tests (FA-01..FA-09) via stub HTTP
- Tests call real isFnoBanned() (async, 1-arg, calls getFnoBanList() internally)
- UNAVAILABLE → null, CURRENT+empty → false, CURRENT+banned → true

**Item 6 — Final predeploy battery**
- fullNseScanner.ts: buildBlockedScanResult() function added
- api-server: 6826/6826 PASS, scanner: 1305/1305 PASS
- All 4 TSC clean, both prod builds green
- SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=false, FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED=false
- No broker placeOrder calls, git diff --check CLEAN

**Why:** nseRef=undefined backward-compat was the last hole in the reference gate — provisional instruments could enter the warehouse even without authoritative confirmation. Removing it makes the gate unconditionally enforced at compile time.

**Scanner prod build chunk name changed:** index-D1E9sgUF.js (was index-TL_cM3nE.js after rebuild).

**Test ISIN format:** for buildValidCsv() helpers, ISIN must be exactly 12 chars matching /^IN[A-Z0-9]{10}$/. Use INE + 8 digits + A (not 9 digits).
