---
name: Pack 33B Four-Blocker Correction
description: Pre-insert gate, real PG failure proof, PostgreSQL hydration proof, REIT reconciliation; commit 75f2a56
---

## Four blockers — commit 75f2a56

### Blocker 1 — Pre-insert validation gate

**Constant added**: `MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT = 1000`
**Location**: `_saveSnapshotToDb` in `nseSecurityMaster.ts` — fires BEFORE `ensureNseMasterSnapshotSchema()`, no DB round-trip.

**Snapshot id=61** (row_count=0, previously ACCEPTED):
- Retroactively marked: `REJECTED_INVALID_ROW_COUNT` via `UPDATE nse_security_master_snapshots SET validation_result='REJECTED_INVALID_ROW_COUNT' WHERE id=61`
- Not selectable: `_loadLatestSnapshotFromDb` requires `validation_result='ACCEPTED' AND row_count>=100`
- Live proof: snapshot 61 not in selectable set (confirmed via direct DB query)

**Runtime gate proof** (tsx script):
- Input: `totalRecords=0` → `ok=false, reasonCode=INVALID_SNAPSHOT_ROW_COUNT, durablyCommitted=false`
- `max_id before=62, max_id after=62` (no new row — no DB call at all)
- `dbTransactionMock not called` (regression test MP-10 confirms)

**Regression tests** (MP-10, 3 assertions):
- 0-row → ok=false, INVALID_SNAPSHOT_ROW_COUNT, no DB call
- 999-row → ok=false, INVALID_SNAPSHOT_ROW_COUNT, no DB call
- 1000-row boundary → proceeds to DB, ok=true (DB mock returns valid row)

### Blocker 2 — Real PostgreSQL transaction failure

**Method**: Invalid `::timestamptz` cast → PostgreSQL rejects INSERT inside transaction → DrizzleQueryError thrown → Drizzle ROLLBACK.

**Before/after evidence**:
```
max_id BEFORE: 62   total: 5
max_id AFTER:  62   total: 5   delta=0 ← transaction rolled back
```
- `ok=false, durablyCommitted=false, "durableStore" key present=false`
- `errorClass=DrizzleQueryError`
- PG error cause: `invalid input syntax for type timestamp with time zone: "NOT_A_VALID_TIMESTAMP"`
- `persistenceFailureCount++` confirmed in logs

**Why this is a REAL PG failure**: the SQL was parameterized and sent to PostgreSQL; PG rejected the type cast and the transaction was rolled back. The `db.transaction()` wrapper caught the DrizzleQueryError and re-threw it out of `_saveSnapshotToDb`'s try-catch.

### Blocker 3 — Generation and restart evidence

**Generation**: `gen-1786295234851-1`, 2065 rows, sourceDate=`kite:2026-08-09`

**Failure preservation** (tsx lifecycle script):
- Persistence failure (INVALID_SNAPSHOT_ROW_COUNT): 2065 rows still displayed after
- Same generation preserved (no empty generation)

**PostgreSQL hydration** (`_loadLatestSnapshotFromDb("RESTART_HYDRATION_PROOF")`):
- `totalRecords=2388, sourceHash=153db8e9, isLastGood=true` — runtime PostgreSQL data returned
- Snapshot 61 (REJECTED_INVALID_ROW_COUNT) NOT returned — selection excludes it

**Restart log** (api-server PID 20545, 2026-08-09 17:10:18):
- Disk scanner cache used at startup (1 min old)
- `snapshotId=65` committed to PostgreSQL at 17:10:19 (authoritative NSE reference)
- `generationId=gen-1786295419274-1` built with `eligible=2065`

**Older disk does not override PostgreSQL**: `_selectBetterSnapshot` prefers PostgreSQL when equal/newer. DB is queried on every startup. Scanner's disk cache (scan results) is separate from NSE master's disk cache (master data).

### Blocker 4 — Unexplained matched record reconciliation

**Root cause of "unexplained 1"**: `detectReitOrInvit` uses the KITE instrument NAME (not EQUITY_L name). A REIT symbol can appear in EQUITY_L with EQ series during NSE listing transitions. Yesterday one of the 6 REIT_OR_INVIT instruments was in both Kite NSE EQ and EQUITY_L; today it is not.

**Today's live data** (2026-08-09 17:01:21 UTC):
- EQUITY_L.csv SHA256=`153db8e940a615513151a7e2aed74eb9551f9529755861959a8c1f7f80ce914b`
- eq_etfseclist.csv SHA256=`c8528c08027f20c2862e2cb52b806c1e4129ddcefaed7110d563f1085dbca78f`
- Matched: 2086, eligible: 2075, T-to-T: 11, REIT_OR_INVIT in matched: 0 → diff=0

**6 REIT_OR_INVIT instruments today** (all Kite-only, not in EQUITY_L):
- SHREMINVIT-IV "SHREM INVIT"
- EMBASSY-RR "EMBASSY OFFICE PARKS REIT"
- IRBINVIT-IV "IRB INVIT FUND"
- MINDSPACE-RR "MINDSPACE BUSINESS P REIT"
- NDRINVIT-IV "NDR INVIT TRUST"
- BAGMANE-RR "BAGMANE PRIME OFFICE REIT"

**Comment fix**: Pack 33B over-corrected line 379 ("not in EQUITY_L.csv equity segment"). Corrected to "may appear in EQUITY_L.csv with EQ series during listing transitions". Inline comment at line 706 ("REITs appear in EQUITY_L.csv with series=EQ") is accurate.

### Final battery — commit 75f2a56

- api-server: 6920/6920 PASS (297 files, +4 MP-10 tests)
- scanner: 1305/1305 PASS (55 files)
- 4-package TSC: all EXIT:0
- api-server build: EXIT:0
- Debug markers in dist: all → 0
- V2 locks: all `= false as boolean`
- git diff --check: PASS
- No live placeOrder calls

**OWNER_DEPLOYMENT_AUTHORIZATION_REQUIRED**
