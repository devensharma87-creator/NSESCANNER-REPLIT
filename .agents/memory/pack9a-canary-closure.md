---
name: Pack 9A canary closure
description: Option-snapshot live capture canary — BLOCKED verdict. Dev proves code correct (3/3, 252 rows, 30 min). Production nfo:0 blocks NIFTY/BANKNIFTY; canary not run in prod. Lot-size reconciliation PASS.
---

## Verdict

**BLOCKED_PACK_9A_CANARY — PRODUCTION_NFO_INSTRUMENT_MASTER_EMPTY_AND_PRODUCTION_3_INDEX_CAPTURE_NOT_PROVEN**

Issued: 2026-08-07. Prompt 31 requires deployed-production proof. Dev environment passes all conditions; production fails due to `nfo:0`.

## Environment Attribution (Critical)

Dev server (PID 464) and production (PID 20) write to **separate databases**.

| Env | DB | 3/3 captures | Canary rows |
|---|---|---|---|
| Dev | dev DB (default executeSql) | ✅ runs 7–18 | ✅ p9a-canary-20260807-001 |
| Production | prod DB (environment:"production") | ❌ last 3/3 at 04:04 UTC | ❌ not present |

## Dev Canary (dev DB only)

- Marker: `p9a-canary-20260807-001`, dev run ID 14
- Time: 06:15:10–06:15:15 UTC (IST 11:45)
- Results: 3/3 underlyings, 252 rows (3×2×21×2), errors=[], source=kite, 5,414ms
- Integrity: 0 dupes, 0 future-ts, 0 stale-ts; NIFTY 4/84 null IV (OTM near expiry, expected)

## Dev Scheduler Continuity (dev DB — PID 464)

Runs 11–18: 06:02:23 to 06:32:20 UTC = **30 minutes** (7 scheduled ticks + canary, all 3/3, 252 rows)

| Run | UTC | Rows | OK |
|---|---|---|---|
| 11 | 06:02:23 | 252 | 3/3 |
| 12 | 06:07:20 | 252 | 3/3 |
| 13 | 06:12:20 | 252 | 3/3 |
| 14 (canary) | 06:15:10 | 252 | 3/3 |
| 15 | 06:17:20 | 252 | 3/3 |
| 16 | 06:22:20 | 252 | 3/3 |
| 17 | 06:27:20 | 252 | 3/3 |
| 18 | 06:32:20 | 252 | 3/3 |

Dev circuit: CLOSED, consecutiveFullFailures=0. **This is dev-only proof.**

## Production Run Records (prod DB — PID 20)

| Prod ID | UTC | OK/3 | Rows | Notes |
|---|---|---|---|---|
| 3069 | 04:04:42 | 3/3 | 252 | ✅ Last full 3/3 production capture |
| 3071 | 04:25:15 | 3/3† | 126 | ⚠️ Partial (787s; half rows) |
| 3072 | 05:11:36 | 1/3 | 42 | First degraded (SENSEX/BFO partial) |
| 3073 | 05:16:43 | 0/3 | 0 | ❌ |
| 3074–3079 | 05:49–06:20 | 1/3 | 84 | SENSEX only (BFO); stable |

Production `nfo:0` since ~05:11 UTC: `"Kite: no F&O legs found for underlying"` for NIFTY and BANKNIFTY.

## Production DB State (prod DB)

- Total rows: 534,612 (since 2026-05-18)
- NIFTY last bucket: 2026-08-07 04:25:00 UTC — **stalled**
- BANKNIFTY last bucket: 2026-08-07 05:00:00 UTC — **stalled**
- SENSEX last bucket: 2026-08-07 06:20:00 UTC — still capturing via BFO

## Dev DB Row Count Reconciliation

| Snapshot time | Event | BANKNIFTY | NIFTY | SENSEX | Total |
|---|---|---|---|---|---|
| After run 15 | Coverage query | 756 | 672 | 756 | **2,184** |
| After run 17 | Total-rows query | 924 | 840 | 924 | **2,688** |
| After run 18 | Final query | 1,008 | 924 | 1,008 | **2,940** |

2,184 and 2,688 reference different query times (not a discrepancy). Both internally consistent.

## Lot-Size Reconciliation (PASS — shared instrument source)

| Underlying | Kite master | SNAPSHOT_LOT_SIZES | Dev DB | Match |
|---|---|---|---|---|
| NIFTY | 65 | 65 | 65 | ✅ |
| BANKNIFTY | 30 | 30 | 30 | ✅ |
| SENSEX | 20 | 20 | 20 | ✅ |

Stale comments "25 for NIFTY" in fnoCostModel.ts/gex.ts: pre-Jan-2026, no runtime effect. P2 doc debt.
`NIFTY: 50` in optionChain.ts etc = STRIKE_STEPS (50-pt intervals), not lot sizes.

## Test Floor

- api-server: 6,268 tests (27 new in p31.pack9aCanary.test.ts, all pass)
- scanner: 1,250 tests
- 4-pkg TSC: clean

## What Blocks Closure

1. **Prompt 33**: Fix `nfo:0` in production so NIFTY+BANKNIFTY F&O legs are found
2. **After Prompt 33**: Re-run canary in production (`POST /api/option-snapshots/run-now`), observe 30 min of 3/3 prod captures, query prod DB for marker rows

## Evidence File

`artifacts/audit-evidence/PACK_9A_OPTION_PREMIUM_DATA_WAREHOUSE_AND_CAPTURE_RECOVERY.md`
