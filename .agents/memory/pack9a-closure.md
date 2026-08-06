---
name: Pack 9A closure
description: Option-premium data warehouse and capture recovery — root cause, hardening, schema, tests, and status.
---

## Pack 9A — Option Premium Data Warehouse & Capture Recovery

**Date:** 2026-08-06  
**Status:** COMPLETE — 86/86 Gate 9 tests PASS; api-server 6,129; scanner 1,250; 4-pkg TSC clean.

### Root Cause (0 rows in option_chain_snapshot)
`isOptionSnapshotEnabled()` auto-detects: enabled ONLY when `REPLIT_DEPLOYMENT="1"` or `OPTION_SNAPSHOT_ENABLED` explicitly set. Dev environment had neither. App was never republished after ingestor code was added.

**Fix:** Set `OPTION_SNAPSHOT_ENABLED=1` as persistent Secret, republish.

### New Files
- `artifacts/api-server/src/lib/optionSnapshotMigrations.ts` — lazy ALTER TABLE ensure
- `artifacts/api-server/src/lib/optionSnapshotArchive.ts` — storage projections + archive-before-delete
- `artifacts/api-server/src/lib/optionChainSnapshotIngestor.ts` — enhanced (circuit-breaker, alert dedup, advisory lock, tick timeout)
- `artifacts/api-server/src/routes/optionChainSnapshot.ts` — enhanced diagnostics + storage + gaps endpoints
- `artifacts/api-server/src/lib/p30.pack9a.warehouse.test.ts` — 86 tests, 24 categories

### 4 New DB Columns (lib/db/src/schema/optionChainSnapshot.ts)
`schema_version VARCHAR(8) DEFAULT 'v1'`, `lot_size INTEGER`, `market_status VARCHAR(16)`, `canary_marker VARCHAR(64)` — all nullable for legacy-row compatibility. lib/db rebuilt after schema change.

### Circuit-Breaker Constants
`CIRCUIT_BREAKER_THRESHOLD=5`, `CIRCUIT_RESET_MINUTES=15`, `ALERT_COOLDOWN_MINUTES=60`, `TICK_TIMEOUT_MS=60_000`, advisory lock key `0x534E4150`.

### Backfill: All option premium fields = FUTURE_CAPTURE_ONLY
Kite historical API covers equity/futures only. Expired option premiums unavailable. Spot candles = BACKFILL_VERIFIED.

### FNO_PAPER_V2 qualification timer
Starts when capture is first activated in production. Requires ≥ 130 trading days (≈ 26 weeks) of real option-premium history.

### Canary Capture
Status: LIVE_CANARY_PENDING_MARKET_WINDOW (market closed at task completion). Run at market open: `POST /api/option-snapshots/run-now?force=1&canaryMarker=p9a-canary-20260806-001`.

### lib/db rebuild required after schema changes
After editing `lib/db/src/schema/*.ts`, run `cd lib/db && pnpm exec tsc -p tsconfig.json` before api-server TSC — project references resolve to compiled .d.ts.
