# Pack 9A — Option Premium Data Warehouse and Capture Recovery
## Gate 0–9 Full Closure Evidence — AMENDED

**Generated:** 2026-08-07 (09:29–12:02 IST) — amended after environment-attribution review  
**Branch:** `main` — HEAD `063d393`  
**Market window at evaluation:** OPEN (09:20–15:25 IST)  
**Kite session (dev):** Active — userId `MRV421`, expiresAt `2026-08-08T00:30:00.000Z`

---

## ⚠ Environment Disambiguation (Critical — Read First)

The dev server (PID 464) and the production deployment (PID 20) share the same Kite session credentials but write to **separate PostgreSQL databases**.

| Environment | DB | All successful 3/3, 252-row captures | Canary marker rows |
|---|---|---|---|
| **Development** (PID 464) | dev DB — queried by `executeSql` default | ✅ ALL from dev | ✅ dev DB only |
| **Production** (PID 20) | prod DB — queried with `environment:"production"` | ❌ None since 04:04 UTC | ❌ not present |

Every SQL query in this document is labelled **[DEV DB]** or **[PROD DB]**.  
Every run record is labelled **[DEV]** or **[PROD]** by the process that wrote it.

---

## Final Verdict

```
BLOCKED_PACK_9A_CANARY — PRODUCTION_NFO_INSTRUMENT_MASTER_EMPTY_AND_PRODUCTION_3_INDEX_CAPTURE_NOT_PROVEN
```

### Reason

Prompt 31 requires deployed-production proof. The production deployment (PID 20) has `nfo:0` (NFO F&O instrument master empty). As a result:

- **NIFTY and BANKNIFTY** option chains cannot be fetched in production — `"Kite: no F&O legs found for underlying"` logged on every tick since ~05:11 UTC.
- **Production captures only SENSEX** (via BFO, 84 rows/tick, 1/3 underlyings) since 05:49 UTC.
- **Last production 3/3 capture:** run ID 3069, 04:04:42 UTC (IST 09:34:42) — 2 hours before this evaluation window.
- **The canary** (`p9a-canary-20260807-001`) was executed in the dev environment only and its marker rows exist only in the dev DB.

The dev environment proves the ingestor code is correct (3/3, 252 rows, 5-minute intervals for 30 minutes). But Prompt 31 requires this to be proven in the deployed production environment.

### Pass/Fail per Condition

| Condition | Dev | Production | Verdict |
|---|---|---|---|
| Live capture (3/3 underlyings, source=kite) | ✅ DEV ONLY | ❌ 1/3 since 05:49 UTC | **BLOCKED** |
| Canary executed | ✅ DEV ONLY | ❌ not run in production | **BLOCKED** |
| Scheduler continuity (30 min) | ✅ DEV: 06:02–06:32 UTC | ❌ 1/3 only | **BLOCKED** |
| Data integrity (0 dupes, 0 future-ts) | ✅ DEV canary rows | N/A | N/A |
| Lot-size reconciliation | ✅ shared Kite master | ✅ (same instrument dump) | ✅ PASS |
| Circuit state healthy | ✅ DEV: CLOSED | N/A | N/A |
| Archive fail-closed | ✅ both envs | ✅ | ✅ PASS |
| Production `nfo:0` root cause | — | ❌ unresolved | **BLOCKS** |

### Blocking Defect

**Production `nfo:0`:** The production process loads NFO instruments at startup or on refresh. At some point between run 3069 (04:04 UTC, `nfo:33421`) and run 3072 (05:11 UTC, implied `nfo:0`), the production NFO instrument cache became empty. Since then every NIFTY and BANKNIFTY option chain call returns `"no F&O legs found"`. BFO instruments (SENSEX) remain loaded. This is **owned by Prompt 33** and must be resolved before Prompt 31 can close.

---

## Gate 0 — Preflight

| Prerequisite | Dev | Production |
|---|---|---|
| `OPTION_SNAPSHOT_ENABLED=1` | ✅ confirmed active | ✅ shared secret |
| Kite session active | ✅ recovered 06:02 UTC | ⚠️ session imported 06:08 UTC |
| `OPTION_SNAPSHOT_ARCHIVE_PATH` | ⚠️ ABSENT (fail-closed, capture unblocked) | ⚠️ ABSENT |
| Schema columns (v1) | ✅ all 4 Pack 9A columns confirmed | ✅ same schema |

### Pack 9A Schema Columns (PROD DB — confirmed)

| Column | Type | Default | Nullable |
|---|---|---|---|
| `schema_version` | varchar(8) | `'v1'` | YES |
| `lot_size` | integer | — | YES |
| `market_status` | varchar(16) | — | YES |
| `canary_marker` | varchar(64) | — | YES |

---

## Gate 1 — Startup and Recovery

### Dev (PID 464) — process started 06:02:20 UTC

- `startOptionSnapshotIngestor()` called at `routes/index.ts:112`
- Migration: `"option-snapshot-migrations: v1 columns ensured (idempotent)"` at 06:02:23 UTC ✅
- Retention sweep: `"retention BLOCKED — configure OPTION_SNAPSHOT_ARCHIVE_PATH"` at 06:02:20 UTC ✅
- First tick (run 11): 06:02:23 UTC — 3/3, 252 rows, source=kite — `"capture recovered"` logged ✅
- Circuit state: **CLOSED** (consecutiveFullFailures=0, circuitOpenUntil=null)

### Production (PID 20) — session imported 06:08:21 UTC

- Production had 4 tick timeouts between 05:45–06:01 UTC (Kite session stale, NSE API also timing out)
- Session imported from dev peer at 06:08:21 UTC
- Post-import ticks: 1/3 underlyings (SENSEX only) — `nfo:0` prevents NIFTY/BANKNIFTY chains

---

## Gate 2 — Canary Execution (DEV ONLY)

**⚠ The canary was executed in the dev environment only. It has not been run in production.**

**Canary marker:** `p9a-canary-20260807-001`  
**Environment:** DEV — dev DB only  
**Method:** `runIngestionTick({ force: true, canaryMarker: 'p9a-canary-20260807-001' })` via tsx (same function as `/api/option-snapshots/run-now`)  
**Dev DB run ID:** 14  
**Start:** 2026-08-07T06:15:10.339Z (IST 11:45:10)  
**End:** 2026-08-07T06:15:15.753Z (IST 11:45:15)  
**Duration:** 5,414ms

### Canary Top-Line Result [DEV DB]

| Field | Value |
|---|---|
| `underlyingsAttempted` | 3 |
| `underlyingsOk` | **3** |
| `expiriesCovered` | 6 |
| `rowsWritten` | **252** |
| `errors` | [] |
| `source` | `kite` |

### Expected vs Actual Row Count

| Parameter | Value |
|---|---|
| `strikeWindow` | 10 → 2×10+1 = **21** strikes per expiry |
| `expiriesPerUnderlying` | 2 |
| Sides | CE + PE = 2 |
| Underlyings | 3 (NIFTY, BANKNIFTY, SENSEX) |
| **Expected** | 3 × 2 × 21 × 2 = **252** |
| **Actual** | **252** |
| **Verdict** | ✅ Exact match (dev only) |

### Per-Underlying, Per-Expiry Canary Detail [DEV DB]

| Underlying | Expiry | Rows | Strikes | CE | PE | Null LTP | Null OI | Null IV | Null Bid | Null Ask | lot_size | source |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BANKNIFTY | 2026-08-25 | 42 | 21 | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 30 | kite |
| BANKNIFTY | 2026-09-29 | 42 | 21 | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 30 | kite |
| NIFTY | 2026-08-11 | 42 | 21 | 21 | 21 | 0 | 0 | 3 | 0 | 0 | 65 | kite |
| NIFTY | 2026-08-18 | 42 | 21 | 21 | 21 | 0 | 0 | 1 | 0 | 0 | 65 | kite |
| SENSEX | 2026-08-13 | 42 | 21 | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 20 | kite |
| SENSEX | 2026-08-20 | 42 | 21 | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 20 | kite |

**NIFTY null IV:** 4/84 rows across 2 expiries. Expected — Kite omits IV for deep-OTM options near expiry when Black-Scholes does not converge. LTP, OI, bid, ask all populated. Stored as null, not zero-filled. ✅

### Data Integrity Results [DEV DB]

| Check | Count | Status |
|---|---|---|
| Duplicate PK (same underlying/expiry/strike/opt_type/captured_at) | 0 | ✅ PASS (dev) |
| Future-dated `captured_at` (> now + 5s) | 0 | ✅ PASS (dev) |
| Stale `captured_at` (< 06:05 UTC, >10min before canary) | 0 | ✅ PASS (dev) |
| `schema_version` | `v1` on all rows | ✅ PASS (dev) |
| `market_status` | `open` on all rows | ✅ PASS (dev) |
| `canary_marker` | `p9a-canary-20260807-001` on all 252 canary rows | ✅ PASS (dev) |
| `source` | `kite` on all rows | ✅ PASS (dev) |

---

## Gate 3 — Scheduler Continuity

### Dev Run Records [DEV DB — writer: PID 464 or predecessor]

| Dev ID | UTC | IST | OK/3 | Rows | Src | ms | Notes |
|---|---|---|---|---|---|---|---|
| 1 | 03:59:40 | 09:29:40 | 0/3 | 0 | none | 3,754 | NSE timeout, Kite stale |
| 2 | 04:04:37 | 09:34:37 | 0/3 | 0 | none | 21,014 | NSE timeout |
| 3 | 04:09:37 | 09:39:37 | 0/3 | 0 | none | 21,008 | NSE timeout |
| 4 | 04:14:37 | 09:44:37 | 0/3 | 0 | none | 21,009 | NSE timeout |
| 5 | 04:19:37 | 09:49:37 | 0/3 | 0 | none | 21,007 | NSE timeout |
| 6 | 04:38:22 | 10:08:22 | 2/3 | 168 | kite | 6,446 | NIFTY no_chain_returned; circuit reset to 0 |
| 7 | 04:43:20 | 10:13:20 | 3/3 | 252 | kite | 4,059 | ✅ |
| 8 | 04:48:20 | 10:18:20 | 3/3 | 252 | kite | 3,605 | ✅ |
| 9 | 04:53:20 | 10:23:20 | 3/3 | 252 | kite | 3,604 | ✅ |
| 10 | 04:58:20 | 10:28:20 | 3/3 | 252 | kite | 3,320 | ✅ |
| 11 | 06:02:23 | 11:32:23 | 3/3 | 252 | kite | 5,237 | ✅ new process; "capture recovered" |
| 12 | 06:07:20 | 11:37:20 | 3/3 | 252 | kite | 4,825 | ✅ |
| 13 | 06:12:20 | 11:42:20 | 3/3 | 252 | kite | 3,770 | ✅ |
| **14** | **06:15:10** | **11:45:10** | **3/3** | **252** | **kite** | **5,414** | **✅ CANARY (force=true)** |
| 15 | 06:17:20 | 11:47:20 | 3/3 | 252 | kite | 4,141 | ✅ (upsert into canary bucket 06:15:00; canary_marker preserved) |
| 16 | 06:22:20 | 11:52:20 | 3/3 | 252 | kite | 3,661 | ✅ |
| 17 | 06:27:20 | 11:57:20 | 3/3 | 252 | kite | 4,300 | ✅ |
| 18 | 06:32:20 | 12:02:20 | 3/3 | 252 | kite | 3,746 | ✅ |

**Dev 30-minute window (PID 464, current process):**  
Run 11 at 06:02:23 UTC → Run 18 at 06:32:20 UTC = **29m57s ≈ 30 minutes**  
7 scheduled ticks, all 3/3, all 252 rows, all source=kite. Circuit never opened. No alert fired.

```
DEV 11:32 — run 11: 252 rows, 3/3, 5,237ms  [06:02 UTC]
DEV 11:37 — run 12: 252 rows, 3/3, 4,825ms  [06:07 UTC]
DEV 11:42 — run 13: 252 rows, 3/3, 3,770ms  [06:12 UTC]
DEV 11:45 — CANARY:  252 rows, 3/3, 5,414ms  [06:15 UTC, force=true]
DEV 11:47 — run 15: 252 rows, 3/3, 4,141ms  [06:17 UTC] ← upserts canary bucket
DEV 11:52 — run 16: 252 rows, 3/3, 3,661ms  [06:22 UTC]
DEV 11:57 — run 17: 252 rows, 3/3, 4,300ms  [06:27 UTC]
DEV 12:02 — run 18: 252 rows, 3/3, 3,746ms  [06:32 UTC]
```

**This 30-minute proof is dev-environment only. Production did not achieve 3/3 capture during this window.**

---

### Production Run Records [PROD DB — writer: PID 20]

| Prod ID | UTC | IST | OK/3 | Rows | Src | ms | Notes |
|---|---|---|---|---|---|---|---|
| 3067 | 03:48:58 | 09:18:58 | 0/3 | 0 | none | 89,899 | ❌ Kite stale |
| 3068 | 03:53:55 | 09:23:55 | 0/3 | 0 | none | 77,200 | ❌ |
| **3069** | **04:04:42** | **09:34:42** | **3/3** | **252** | **kite** | **4,561** | ✅ **Last full 3/3 production capture** |
| 3070 | 04:20:15 | 09:50:15 | 0/3 | 0 | none | 122,103 | ❌ |
| 3071 | 04:25:15 | 09:55:15 | 3/3† | 126 | kite | 787,325 | ⚠️ Only 126 rows (half expected); 787s duration — partial/slow |
| 3072 | 05:11:36 | 10:41:36 | 1/3 | 42 | kite | 400,197 | ⚠️ First degraded tick; SENSEX only (1 expiry, 42 rows) |
| 3073 | 05:16:43 | 10:46:43 | 0/3 | 0 | none | 140,897 | ❌ |
| 3074 | 05:49:33 | 11:19:33 | 1/3 | 84 | kite | 240,998 | ⚠️ SENSEX only, 2 expiries |
| 3075 | 05:54:52 | 11:24:52 | 1/3 | 84 | kite | 100,614 | ⚠️ |
| 3076 | 06:00:03 | 11:30:03 | 1/3 | 84 | kite | 194,698 | ⚠️ |
| 3077 | 06:10:42 | 11:40:42 | 1/3 | 84 | kite | 15,651 | ⚠️ |
| 3078 | 06:15:43 | 11:45:43 | 1/3 | 84 | kite | 55,601 | ⚠️ SENSEX-concurrent with dev canary |
| 3079 | 06:20:48 | 11:50:48 | 1/3 | 84 | kite | 47,701 | ⚠️ Latest known prod tick |

† Run 3071: `underlyings_ok=3` per the run record, but `rows_written=126` (expected 252 for 3/3). This is an anomaly — the 787-second duration suggests Kite calls timed out for some strikes mid-run. The partial row set was stored; the run record reports "ok" for underlyings that returned any data.

**Production NFO degradation timeline:**

| Phase | First run | Last run | Rows/tick | Coverage |
|---|---|---|---|---|
| Full capture | — | 3069 (04:04 UTC) | 252 | 3/3 |
| Transition / degrading | 3070–3072 | 3072 (05:11 UTC) | 0–126 | 0–1/3 |
| Stable SENSEX-only | 3074 (05:49 UTC) | 3079+ | 84 | 1/3 (SENSEX/BFO only) |

---

## Gate 4 — Diagnostics Routes

All 5 routes registered with `strictOwner` middleware. Routes confirmed at startup log in dev. Not independently verified in production for this evaluation.

---

## Gate 5 — Archive Status

| Item | Dev | Production |
|---|---|---|
| `OPTION_SNAPSHOT_ARCHIVE_PATH` | NOT SET | NOT SET |
| Retention sweep | SKIPPED_ARCHIVE_REQUIRED | SKIPPED_ARCHIVE_REQUIRED |
| Rows deleted | 0 | 0 |
| Capture blocked by absent archive? | NO | NO |

Capture continues in both environments; archive is only required for the deletion path.

---

## Gate 6 — Data-Foundation State

### Dev DB [DEV DB — queried 2026-08-07 ~06:32 UTC]

| Underlying | Buckets | Rows | First bucket (UTC) | Last bucket (UTC) |
|---|---|---|---|---|
| BANKNIFTY | 12 | 1,008 | 04:35:00 | 06:30:00 |
| NIFTY | 11 | 924 | 04:40:00 | 06:30:00 |
| SENSEX | 12 | 1,008 | 04:35:00 | 06:30:00 |
| **Total** | **12** | **2,940** | | |

**Row count reconciliation (2,688 figure used in earlier drafts of this document):**

The figure `2,688 total rows` was queried between runs 17 and 18 (after 06:27, before 06:32). An earlier query captured the per-index breakdown when the total was 2,184. Both are internally consistent:

| Point in time | Event | BANKNIFTY | NIFTY | SENSEX | Total |
|---|---|---|---|---|---|
| After run 15 | Coverage query run | 756 (9 buckets) | 672 (8 buckets) | 756 (9 buckets) | **2,184** |
| After run 16 (+252 rows) | | 840 | 756 | 840 | **2,436** |
| After run 17 (+252 rows) | Total-rows query run | **924** | **840** | **924** | **2,688** |
| After run 18 (+252 rows) | Latest query | 1,008 | 924 | 1,008 | **2,940** |

The per-index sum 756+672+756=2,184 and the total 2,688 reference **different points in time**, not a discrepancy. At the 2,688 snapshot: BANKNIFTY=924 + NIFTY=840 + SENSEX=924 = **2,688** ✅.

### Production DB [PROD DB — queried 2026-08-07 ~06:32 UTC]

| Underlying | Buckets | Rows | First bucket (UTC) | Last bucket (UTC) |
|---|---|---|---|---|
| BANKNIFTY | 2,123 | 176,200 | 2026-05-18 06:00 | **2026-08-07 05:00** ← stalled |
| NIFTY | 2,083 | 173,760 | 2026-05-18 06:00 | **2026-08-07 04:25** ← stalled |
| SENSEX | 2,230 | 184,652 | 2026-05-18 06:00 | **2026-08-07 06:20** ← still capturing |
| **Total** | **2,292** | **534,612** | | |

Production has accumulated 534,612 rows since 2026-05-18 (inception). NIFTY and BANKNIFTY stopped updating at 04:25 and 05:00 UTC respectively due to `nfo:0`. SENSEX continues (last seen 06:20 UTC, 11:50 IST).

---

## Gate 7 — Test Coverage

**Tests added this session:** 27 (file: `p31.pack9aCanary.test.ts`)  
**All 27 pass ✅** in the dev environment.  
Tests cover: circuit-breaker state machine, alert-dedup cooldown, lot-size constants, storage projection arithmetic, archive-absent fail-closed, scheduler idempotency, V2 hard locks.

---

## Gate 8 — Verification Battery

| Suite | Tests | Status |
|---|---|---|
| `@workspace/api-server` | **6,268** | ✅ ALL PASS |
| `@workspace/scanner` | **1,250** | ✅ ALL PASS |
| 4-package TSC | — | ✅ CLEAN |

---

## Gate 9 — Lot-Size Reconciliation

**Cache timestamp (dev Kite instrument master):** 2026-08-07T04:38:26 UTC — same trading day, same Kite token as production.

### Kite Instrument Master vs SNAPSHOT_LOT_SIZES

| Underlying | Kite master lot_size | Sample option | SNAPSHOT_LOT_SIZES | Dev DB captured lot_size | Match |
|---|---|---|---|---|---|
| NIFTY | **65** | `NIFTY2681124650CE` (token 10500354) | 65 | 65 | ✅ |
| BANKNIFTY | **30** | `BANKNIFTY26AUG58100CE` (token 15132418) | 30 | 30 | ✅ |
| SENSEX | **20** | `SENSEX2681379000CE` (token 216458757) | 20 | 20 | ✅ |

Lot-size reconciliation is shared: both dev and production use the same Kite instrument master. The `SNAPSHOT_LOT_SIZES` constants match the live instrument dump. No mismatch.

### "25 vs 65" Investigation

`NIFTY: 50` in `optionChain.ts`, `contractMasterFact.ts`, and `kiteOptionChain.ts` are `STRIKE_STEPS` (50-point intervals between adjacent strikes), not lot sizes. Stale JSDoc comments `"e.g. 25 for NIFTY"` in `fnoCostModel.ts` and `gex.ts` reference the pre-Jan-2026 lot size (before NSE circular NSE/FAOP/70616). No runtime effect. **Classified: P2 documentation debt, non-blocking.**

**Lot-size reconciliation: ✅ PASS (shared across both environments)**

---

## What Remains Blocked

| Blocking Item | Owner | Required Resolution |
|---|---|---|
| `nfo:0` in production | **Prompt 33** | Restore production NFO instrument master so NIFTY and BANKNIFTY F&O legs are found on each tick |
| Production 3/3 capture proof | Pack 9A canary (not yet closable) | Run 3/3 in production for 30 uninterrupted minutes after Prompt 33 fix |
| Production canary execution | Pack 9A canary (not yet closable) | Execute `POST /api/option-snapshots/run-now` in production after NFO restored; verify prod DB for marker rows |

### What May Be Pre-Completed Now

- Lot-size reconciliation: ✅ already proven (shared instrument source)
- Data integrity checks (duplicate PK, future-ts, stale-ts): ✅ proven for dev canary rows — can be trivially re-verified for the production canary once it runs
- Schema columns (v1): ✅ already deployed in production DB
- Circuit-breaker logic, alert-dedup, archive fail-closed: ✅ proven in code and dev execution — carry over to production once capture is restored
- 27 Gate 7 tests: ✅ pass and will continue to pass regardless

---

## Evidence File History

| Date | Change |
|---|---|
| 2026-08-07 ~06:30 UTC | Initial draft — incorrectly attributed all 252-row captures to both environments; claimed 30-min window without environment qualification; 2,688 total with mismatched per-index sum |
| 2026-08-07 ~06:45 UTC | **Amended** — all 252-row captures attributed to DEV only; production run table added (IDs 3067–3079); BLOCKED verdict issued; per-index reconciliation corrected (2,184 and 2,688 from different query times, both consistent); 30-min window re-attributed to DEV (06:02–06:32 UTC). Lot-size and data-integrity evidence preserved. |
