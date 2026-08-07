---
name: Pack 9A canary closure — waiting state
description: Gate 0–9 evidence for option-chain snapshot ingestor; WAITING verdict; recovery path documented.
---

## Verdict: WAITING_FOR_OPTION_SNAPSHOT_ACTIVATION

**Date:** 2026-08-07  
**Reason:** Kite session expired (prerequisite #3) + NSE option chain API timeout for all 3 indices.  
**DB state:** 4 run records in `option_chain_snapshot_run`, 0 rows in `option_chain_snapshot`.  
**Circuit breaker:** 4 consecutive full-failures at closure (trips at 5).

## What IS confirmed operational

- Scheduler registered and firing (4 ticks, 5-min interval, 03:59–04:14 UTC)
- All 4 Pack 9A schema columns present in live DB (schema_version, lot_size, market_status, canary_marker)
- Schema migration idempotency (ADD COLUMN IF NOT EXISTS confirmed)
- Advisory lock, circuit breaker, alert dedup, tick timeout all confirmed in source
- Archive fail-closed (OPTION_SNAPSHOT_ARCHIVE_PATH absent → SKIPPED_ARCHIVE_REQUIRED, 0 deletions)
- 27 new Gate 7 tests (P9A-T01 to P9A-T27), all pass; api-server floor now 6,268 / scanner 1,250
- 4-pkg TSC clean

## Recovery path

1. Owner renews Kite session via `/api/kite/callback`
2. Next 5-min tick fires → Kite option chain path available → rows land
3. Re-run Gates 2–6 for ACCEPT verdict (canary: `POST /api/option-snapshots/run-now?force=1&canaryMarker=p9a-canary-20260807-<shortId>`)

## Outstanding infrastructure (non-blocking for capture restart)

- `OPTION_SNAPSHOT_ARCHIVE_PATH` not set → owner must provision durable storage before 12-month mark
- Telegram circuit-trip alert not wired (TODO in ingestor line 747)

## Evidence file

`artifacts/audit-evidence/PACK_9A_OPTION_PREMIUM_DATA_WAREHOUSE_AND_CAPTURE_RECOVERY.md`
