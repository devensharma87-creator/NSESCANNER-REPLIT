---
name: Pack 33 closure — Canonical Kite Candle Store (Phase A ready)
description: All 4 predeploy corrections implemented; full battery green; awaiting AUTHORIZE_PROMPT_33_PHASE_A_STORE_POPULATION_DEPLOYMENT.
---

## Status
Commit 6179ce9. HOLD PUBLISH — awaiting owner authorization.
Do NOT mark task complete. Do NOT create follow-up tasks.

## Current verdict
PROMPT_33_PHASE_A_ARCHITECTURE_ACCEPTED — four predeploy corrections COMPLETE.

## All Phase A controls (commit 6179ce9)

### Control 1 — Compile-time evaluation lock
- `candleEvaluationControl.ts` line 49: `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean`
- `scanner.ts`: `if (!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED)` before `buildRecommendation`
- Phase A return: `signal='NOT_EVALUATED'`, `score=null`, `confidence=null`, `action=null`
- No env-var, feature-flag, admin-route, or query-param bypass path exists
- 79 tests across 10 describe blocks proving the lock (candleEvaluationControl.routes.test.ts + candleEvaluationControl.test.ts)

### Correction 1 — Distributed rate protection
- `KITE_HISTORICAL_INGESTION_GLOBAL_LOCK = 88_274_614` in kiteCandleStore.ts
- Both curated refresh AND full-NSE warehouse acquire this lock before any Kite historical call
- Serializes ALL historical ingestion across ALL autoscale replicas → ≤ 3 req/s guaranteed
- Curated priority: warehouse checks `getCuratedRefreshDueAt()` before each batch, yields 60s if due within 30s
- 429: bounded exponential backoff, MAX_CONSECUTIVE_429=3 → RATE_LIMIT_PERSISTENT stop
- 401/403: AUTH_FAILURE stop immediately
- Option-snapshot and live Kite quotes unaffected (different API endpoints)

### Correction 2 — History sufficiency
- `historySufficiency.ts`: per-indicator INDICATOR_MIN_BARS constants
  - EMA_200=200 (BINDING CONSTRAINT), RSI_14=14, MACD_12_26_9=34, HIGH_LOW_52W=252, etc.
- MIN_BARS_FOR_STORAGE=1 (any bar stored, not gated on evaluation)
- MIN_BARS_FOR_EVALUATION=200
- scanner.ts: reason code = INSUFFICIENT_CANONICAL_HISTORY (was INSUFFICIENT_HISTORY)
- < 200 bars: stored as 'insufficient', always NOT_EVALUATED

### Correction 3 — Staged, resumable warehouse
- `kite_warehouse_progress` table: single-row cursor persisted to PostgreSQL
- `computeSnapshotId()`: FNV-1a hash of sorted symbols + IST date (deterministic)
- CANARY phase: first 50 symbols, ≤10% fail → IN_PROGRESS
- Bounded batches: 100 symbols per global-lock hold
- Resumable: cursor_idx persisted; resumes from last position on restart
- No re-download: skips symbols with today's ok sessionDate
- `validateWarehouseEntry()`: bar ordering, future timestamps, column-length, size
- Stop thresholds: 3×429, 401/403, 20× consecutive errors
- Storage estimate: BYTES_PER_SYMBOL_ESTIMATE × eligible count (not hard-coded)
- Instrument counts dynamic from live Kite master

### Correction 4 — Runtime lock proof
- candleEvaluationControl.routes.test.ts: 58 tests covering all specified route surfaces
- Source-level analysis of: curated scanner, routes, bypass paths, Yahoo rows
- V2 locks still false; v2PaperLocks re-exports SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED
- Warehouse protocol proven via source analysis
- historySufficiency constants verified

## Battery (commit 6179ce9, 2026-08-07)
- api-server: **279 files / 6474 tests** — PASS
- scanner: **52 files / 1250 tests** — PASS
- 4-pkg TSC: CLEAN
- api-server production esbuild: PASS
- scanner Vite production build: PASS
- SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean ✓
- FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean ✓
- SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean ✓
- Provider import guard: PASS ✓
- git diff --check: PASS ✓

## Advisory lock keys (all distinct, all safe integers)
- 88_274_614 = KITE_HISTORICAL_INGESTION_GLOBAL_LOCK (shared serializer)
- 88_274_615 = ADVISORY_LOCK_KEY (curated refresh identity)
- 88_274_616 = FULL_NSE_WAREHOUSE_LOCK_KEY (warehouse identity)

## Canary batch
- Size: WAREHOUSE_CANARY_SIZE = 50 symbols
- Validation: ≤ 10% fail rate required to advance to IN_PROGRESS
- If canary fails: status = STOPPED, reason = CANARY_VALIDATION_FAILED
- Reset via POST /api/scan/candle-store/warehouse/reset

## Phase A authorization request pending
String: AUTHORIZE_PROMPT_33_PHASE_A_STORE_POPULATION_DEPLOYMENT

## Post-publish verification checklist
1. kite_warehouse_progress table created (runtime schema-ensure)
2. Curated refresh: advisory lock 88_274_615 acquired; 194+ ok entries within 5 min
3. Global lock: 88_274_614 serializing both jobs (verify no rate-limit 429s)
4. Warehouse: 88_274_616 acquired after 5-min delay; CANARY phase (50 symbols)
5. Canary validated → IN_PROGRESS; ~50-min full backfill begins
6. Token bucket metrics: rate429Count=0 via /api/scan/candle-store/metrics
7. Losing replicas: LOCK_HELD skip → DB reload (no permanent empty L1)
8. Last-good data preserved on refresh failure
9. NFO snapshot unchanged; no regression
10. Scanner output: NOT_EVALUATED, PHASE_A_POPULATION_ONLY in setupMessage
11. Zero Yahoo-derived Indian score or action
12. Universe metrics: curatedSignalUniverse active=199, fullNseScannerUniverse.warehousePhase=CANARY
13. p50/p95 scanner response < 25 seconds

## Phase B activation (after Phase A evidence)
1. Change `false → true` in candleEvaluationControl.ts line 49
2. Requires code review + redeploy
3. Then prove: evaluated rows have all canonical inputs; incomplete = NOT_EVALUATED;
   no Yahoo analytics; no fabricated scores; all downstream rules preserved

## Rollback procedure
Roll back via Replit checkpoint. kite_candle_store uses upsert (non-destructive).
Advisory locks are session-scoped and self-release on connection drop.
kite_warehouse_progress table cursor can be reset without data loss.
