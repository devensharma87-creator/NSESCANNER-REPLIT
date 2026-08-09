---
name: Pack 33B Three-Blocker Closure (second pass)
description: Threshold unified to MIN=1000 everywhere; actual server PostgreSQL hydration; real PG failure totalRecords=1000; commit b45df02
---

## Three blockers — commit b45df02

### Blocker 1 — Unified snapshot validation threshold

**Before**: pre-insert gate used 1000; all other paths (PG SELECT, disk blob guard, records.length check, HTTP parse-rejection, _selectBetterSnapshot) used hardcoded 100.

**After**: `MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT = 1000` applied to ALL paths:
- `_saveSnapshotToDb`: `totalRecords < MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT` (pre-insert gate)
- `_loadLatestSnapshotFromDb` SQL: `AND row_count >= ${MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT}`
- `_loadLatestSnapshotFromDb` records guard: `records.length < MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT`
- `tryLoadLastGoodFromDisk`: `p.records.length < MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT`
- `_selectBetterSnapshot`: `totalRecords >= MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT` (both disk+db)
- HTTP parse-rejection sanity: `totalRecords < MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT`

**Tests updated**: 5 test files had hardcoded 100/150/175/200/300/500 counts.
Updated all `stubFetchWithCsv(n)` and mock `row_count/totalRecords` to use n >= 1000.
LG-04 describe name updated: "< 100 records" → "< 1000 records".
GI-05 describe name updated: "< 100 records sanity check" → "< 1000".
LG-09 gate comment: "≥ 100" → "≥ 1000".
MP-10 regression: 0-row (no DB call), 999-row (no DB call), 1000-row (DB called).

**Proof**: 0-row → INVALID_SNAPSHOT_ROW_COUNT; 999-row → INVALID_SNAPSHOT_ROW_COUNT; 1000-row → DB transaction called, ok=true. All 235 p33b tests pass.

### Blocker 2 — PostgreSQL restart hydration (actual server startup)

**Method**: CANDIDATE_URLS temporarily set to `http://127.0.0.1:1/` (connection refused). Disk cache deleted. Server rebuilt and restarted (PID 23132, 2026-08-09T17:33:05).

**Log evidence** (actual api-server startup, not tsx direct invocation):
```
[17:33:05.315] WARN: NSE equity security master: all upstream URLs unreachable (EQUITY_L.csv)
[17:33:05.360] INFO: NSE equity master: loaded last-good from PostgreSQL (L2 STALE fallback)
    totalRecords: 2388  sourceHash: 153db8e9  reason: HTTP_FETCH_FAILED_L1_L2_COMPARE
[17:33:05.360] INFO: L3 failed — DB (L2) snapshot available, disk miss
    dbFetchedAt: 2026-08-09 17:10:19.848+00
[17:33:05.360] WARN: BLOCKED_STALE_NSE_REFERENCE — reference cannot authorize universe
    generationId: gen-1786296785314-1  isLastGood: true  canAuthorizeUniverse: false
```

**All 7 sub-requirements met**:
- ✅ PostgreSQL snapshot loaded (2388 records, sha256=153db8e9)
- ✅ No new snapshot inserted (disk miss — no disk→DB push possible)
- ✅ Hash matches existing DB row (sha256=153db8e9, dbFetchedAt matches id=65)
- ✅ isLastGood=true (confirmed in BLOCKED_STALE_NSE_REFERENCE log)
- ✅ canAuthorizeUniverse=false
- ✅ Scanner fail-closed (BLOCKED_STALE_NSE_REFERENCE)
- ✅ No older disk snapshot overrides PostgreSQL (disk deleted → "disk miss")

CANDIDATE_URLS reverted after proof captured. Server restarted normally.

### Blocker 3 — Generation preservation during real PG failure (totalRecords=1000)

**Method**: `_saveSnapshotToDb` called with `totalRecords=1000` (passes pre-insert gate: 1000 >= 1000) and `fetchedAt="NOT_A_VALID_TIMESTAMP_1000_ROWS"` (invalid `::timestamptz` → PG rejects INSERT inside transaction).

**Before/after DB**:
```
BEFORE: max_id=65  total_snapshots=5
AFTER:  max_id=65  total_snapshots=5  delta=0 — transaction rolled back
```

**Result**:
- `ok=false`  `errorClass=DrizzleQueryError`  `durablyCommitted=false`
- PG cause: `invalid input syntax for type timestamp with time zone: "NOT_A_VALID_TIMESTAMP_1000_ROWS"`
- `persistenceFailureCount=1`  `diagnosticEvent=NSE_MASTER_PERSISTENCE_FAILURE`
- `canAuthorizeUniverse=false`  `impact="Previous durable PostgreSQL snapshot preserved"`

**Generation preserved** (running server during proof):
- `generationId=gen-1786296785314-1` (loaded from PostgreSQL last-good, not affected by tsx script)
- `isLastGood=true`  `staleReason=HTTP_FETCH_FAILED_L1_L2_COMPARE`
- State=STALE  `canAuthorizeUniverse=false`  No score/signal/action created

### Historical reconciliation

`HISTORICAL_RECORD_NOT_REPRODUCIBLE` — NSE publishes only current-day EQUITY_L.csv; yesterday's file is no longer retrievable. The exact symbol/ISIN/series of the "unexplained 1" from Pack 33B cannot be confirmed. The REIT/InvIT claim was based on server heuristic breakdown only. Pack 33B comment correction (line 379) retained.

### Snapshot 61 scope

`DEVELOPMENT_ONLY` — production database was never touched. No production deployment was made in Pack 33B. Production schema changes propagate only via Replit Publish (not made). tsx script ran with dev NODE_ENV against the development DATABASE_URL.

### Battery — commit b45df02

- api-server: 6920/6920 PASS (297 files, 235 p33b including MP-10)
- scanner: 1305/1305 PASS (55 files)
- 4-package TSC: all EXIT:0
- api-server build: EXIT:0 / scanner build: EXIT:0
- Debug markers in dist: all → 0
- V2 locks: all `= false as boolean`
- git diff --check: PASS
- CANDIDATE_URLS reverted to production NSE URLs

**OWNER_DEPLOYMENT_AUTHORIZATION_REQUIRED**
