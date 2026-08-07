---
name: Pack 33 closure — Canonical Kite Candle Store (Phase A ready)
description: All 9 gates implemented; Phase A deployment controls proven; awaiting AUTHORIZE_PROMPT_33_PHASE_A_STORE_POPULATION_DEPLOYMENT.
---

## Status
Gates 2–8 conditionally accepted. Phase A controls implemented (commit df1253b).
HOLD PUBLISH — awaiting owner authorization for Phase A deployment.
Do NOT mark task complete. Do NOT create follow-up tasks.

## Current verdict
PROMPT_33_GATES_2_TO_8_CONDITIONALLY_ACCEPTED — PHASE_A_HARD_LOCK_AND_PRODUCTION_POPULATION_PENDING

## Phase A controls (commit df1253b, all verified)

### Control 1 — Compile-time evaluation lock
- File: `artifacts/api-server/src/lib/candleEvaluationControl.ts`
- Line 49: `export const SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean;`
- Gate location in scanner.ts: `if (!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED)` before `buildRecommendation`
- When false: indicators computed for display; score=null, confidence=null, signal=NOT_EVALUATED
- Locked code: `PHASE_A_POPULATION_ONLY` in setupMessage
- No env-var/process.env/feature-flag bypass
- 21 test cases proving the lock (candleEvaluationControl.test.ts)

### Control 2 — Universe terminology
- CURATED_SIGNAL_UNIVERSE = 199 hand-curated stocks (not "full NSE")
- FULL_NSE_SCANNER_UNIVERSE = all eligible NSE EQ (~8,905 after ETF/SME filter)
- /api/scan/candle-store/metrics now reports both separately + evaluationStatus
- evaluatedCount=0 and notEvaluatedCount=totalSymbols while Phase A lock = false

### Control 3 — Full-NSE warehouse
- File: `artifacts/api-server/src/lib/kiteCandle/fullNseWarehouse.ts`
- Advisory lock key: 88_274_616 (distinct from curated 88_274_615)
- Uses shared kiteHistoricalBucket (3 req/s); never blocks scanner API
- 5-min delayed first run, 24h cadence; auto-started from initKiteCandleStore()
- getEligibleNseSymbols(): Kite master → ETF filter → exclude curated → ~8,700 symbols
- Initial ~50-min backfill is async and non-blocking

## Battery results (commit df1253b, 2026-08-07)
- api-server: **278 files / 6416 tests** — PASS
- scanner: **52 files / 1250 tests** — PASS
- 4-pkg TSC: CLEAN
- api-server production esbuild: PASS
- scanner Vite production build: PASS
- SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean ✓
- FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean ✓
- SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean ✓
- Broker execution: hard-disabled (c0Enforcement.ts) ✓
- Provider import guard: PASS ✓

## Phase A authorization request pending
String: AUTHORIZE_PROMPT_33_PHASE_A_STORE_POPULATION_DEPLOYMENT

## Phase A production checklist (post-publish)
After publishing, verify:
1. Schema created (kite_candle_store + runtime schema ensure)
2. Curated refresh running (advisory lock 88_274_615 acquiring)
3. Full-NSE warehouse started (88_274_616, ~50min first backfill)
4. No 429/rate-limit breaches (token bucket metrics via /api/scan/candle-store/metrics)
5. Losing replicas hydrate from DB (lock miss → sleep 15s → loadFromDb)
6. Last-good data preserved on refresh failure
7. NFO snapshot capture healthy
8. Scanner output = NOT_EVALUATED (PHASE_A_POPULATION_ONLY in setupMessage)
9. Zero Yahoo-derived Indian score/action
10. Production universe metrics: curated 199 ok, full-NSE warehouse progress
11. p50/p95 scanner response < 25 seconds

## Phase B activation (after Phase A evidence)
- Change `false` to `true` in candleEvaluationControl.ts line 49
- Requires code review + redeploy
- Then prove: evaluated rows have all canonical inputs; incomplete = NOT_EVALUATED;
  no Yahoo analytics; no fabricated scores; all downstream rules preserved;
  authenticated screenshots desktop + mobile

## Key implementation facts
- LTIM → LTM (verified via NFO LTM26AUGFUT name='LTM')
- Advisory lock keys: curated=88_274_615; warehouse=88_274_616
- Token bucket: 3 req/s rolling, capacity=3; shared by both jobs
- RefreshMode: FULL/INCREMENTAL/FAILED_RETRY/INSTRUMENT_CHANGE
- Scheduled refresh: INCREMENTAL post-close weekdays; FAILED_RETRY off-hours
- centralLooksLikeEtf in compat (burn-down compliant)
- storeKiteCandleEntry() public API for warehouse→store writes
