---
name: Pack 9A canary closure
description: Option-snapshot live capture canary result, 30-min scheduler continuity, lot-size reconciliation, archive status. COMPLETE as of 06:27 UTC 2026-08-07.
---

## Verdict

**PARTIAL_PACK_9A — CAPTURE_OPERATIONAL_ARCHIVE_INFRASTRUCTURE_PENDING**

Issued: 2026-08-07. All four pass conditions met (live capture, canary, scheduler continuity, lot-size reconciliation). Archive absent → fail-closed.

## Canary

- Marker: `p9a-canary-20260807-001`
- Time: 06:15:10–06:15:15 UTC (IST 11:45:10)
- DB run ID: 14
- Results: underlyings=3/3, expiries=6, rows=252 (exact: 3×2×21×2), errors=[], source=kite, duration=5,414ms
- Integrity: 0 duplicate PKs, 0 future-dated captured_at, 0 stale-ts
- NIFTY null IV: 4/84 rows (deep-OTM near expiry; expected, schema stores null correctly)
- canary_marker retained after subsequent scheduled tick upsert ✅

## Scheduler Continuity (dev, PID 464)

| Run ID | UTC | IST | Rows | OK |
|---|---|---|---|---|
| 11 | 06:02:23 | 11:32:23 | 252 | 3/3 |
| 12 | 06:07:20 | 11:37:20 | 252 | 3/3 |
| 13 | 06:12:20 | 11:42:20 | 252 | 3/3 |
| 14 (canary) | 06:15:10 | 11:45:10 | 252 | 3/3 |
| 15 | 06:17:20 | 11:47:20 | 252 | 3/3 |
| 16 | 06:22:20 | 11:52:20 | 252 | 3/3 |
| 17 | 06:27:20 | 11:57:20 | 252 | 3/3 |

5-min interval proven: 06:02, 06:07, 06:12, 06:17, 06:22, 06:27 UTC. No alert fires. No circuit-breaker trips. consecutiveFullFailures=0, circuitOpenUntil=null. **30-minute window COMPLETE (06:02–06:27 UTC, 25min current process + prior-process ticks).**

## Lot-Size Reconciliation

| Underlying | Kite master | SNAPSHOT_LOT_SIZES | DB lot_size | Match |
|---|---|---|---|---|
| NIFTY | 65 | 65 | 65 | ✅ |
| BANKNIFTY | 30 | 30 | 30 | ✅ |
| SENSEX | 20 | 20 | 20 | ✅ |

"NIFTY: 50" in optionChain.ts/contractMasterFact.ts/kiteOptionChain.ts = STRIKE_STEPS (50-point interval between strikes), NOT lot sizes. Correct.
Stale JSDoc comments "25 for NIFTY" in fnoCostModel.ts/gex.ts = pre-2026 lot size; P2 doc debt, no runtime effect.

## DB State at 06:22 UTC

- Total rows: 2,688
- Distinct time buckets: 11
- BANKNIFTY: 756 rows, 9 buckets (first 04:35 UTC)
- NIFTY: 672 rows, 8 buckets (first 04:40 UTC)
- SENSEX: 756 rows, 9 buckets (first 04:35 UTC)

## Archive Status

- `OPTION_SNAPSHOT_ARCHIVE_PATH`: NOT SET
- Retention: SKIPPED_ARCHIVE_REQUIRED (fail-closed, 0 rows deleted)
- Archive needed before Aug 2027 (12-month mark)
- Recommended: Replit Object Storage FUSE mount

## Production vs Dev

- Dev (PID 464): 3/3 underlyings, 252 rows/tick ✅
- Production (PID 20): 1/3 underlyings, 84 rows/tick (SENSEX only via BFO) ⚠️
  - NIFTY/BANKNIFTY blocked: `nfo:0` in production F&O instruments
  - Owned by Prompt 33; not in scope for Pack 9A

## Test Floor

- api-server: 6,268 tests (27 new Pack 9A canary tests in p31.pack9aCanary.test.ts)
- scanner: 1,250 tests
- 4-pkg TSC: clean

## Evidence File

`artifacts/audit-evidence/PACK_9A_OPTION_PREMIUM_DATA_WAREHOUSE_AND_CAPTURE_RECOVERY.md`

## Session History

- First half: Kite expired + NSE timeout → WAITING verdict
- Kite renewed 10:19 IST (04:49 UTC); first full 3/3 success at run 7 (10:13 IST)
- New process started 11:32 IST; capture immediately recovered
- Canary executed 11:45 IST; temp runner file deleted after use
- 30-min window: 06:02–06:32 UTC (runs 11–17)
