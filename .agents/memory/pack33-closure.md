---
name: Pack 33 closure — Canonical Kite Candle Store (Phase A ready)
description: All predeploy corrections complete; full battery green; awaiting AUTHORIZE_PROMPT_33_PHASE_A_STORE_POPULATION_DEPLOYMENT.
---

## Status
Latest commit: fe12160. HOLD PUBLISH — awaiting owner authorization.

## Corrected history-sufficiency contract

### Binding constraint: HIGH_LOW_52W = 252 (NOT EMA_200 = 200)
- 52-week H/L is MANDATORY for the curated scanner (annual-range bullish confirmation)
- A row with 200–251 bars has EMA200 available but is NOT evaluation-eligible
- Only rows with barCount ≥ 252 (allMandatoryInputsReady=true) reach Phase B

### Per-indicator minimum bars (verified against actual production functions)
| Indicator | Min bars | Implementation proof |
|-----------|---------|---------------------|
| RSI(14) | **15** | `if (values.length < period+1) return all-null`; 14 prices→13 changes→no valid RSI |
| EMA(9) | 9 | `if (values.length < period) return all-null` |
| EMA(20) | 20 | same |
| EMA(50) | 50 | same |
| EMA(100) | 100 | same |
| EMA(200) | 200 | same |
| MACD(12,26,9) | **34** | slow EMA(26) first valid idx 25; signal EMA(9) first valid idx 25+8=33; hist[33] first non-null → 34 bars |
| 52W H/L | **252** | BINDING CONSTRAINT |
| Volume baseline | 20 | 20-day ADV |

### Scanner gate (scanner.ts)
- `bars < 252` → NOT_EVALUATED, INSUFFICIENT_CANONICAL_HISTORY
- `bars >= 252` but lock=false → NOT_EVALUATED, PHASE_A_POPULATION_ONLY (Phase A)

## All Phase A controls (commit fe12160)

### Lock 1 — Compile-time evaluation lock
- `candleEvaluationControl.ts`: `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean`
- scanner.ts: if(!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED) fires before buildRecommendation
- Phase A return: signal='NOT_EVALUATED', score=null, confidence=null, reasons=[], setupMessage=PHASE_A_POPULATION_ONLY

### Lock 2 — Distributed rate protection (Correction 1)
- KITE_HISTORICAL_INGESTION_GLOBAL_LOCK = 88_274_614 (global serializer)
- Both curated refresh AND warehouse acquire this before any Kite historical call
- Curated priority: warehouse yields 60s if curated due within 30s
- 429: bounded backoff; 3 consecutive → RATE_LIMIT_PERSISTENT stop
- 401/403: AUTH_FAILURE stop

### Lock 3 — History sufficiency (Correction 2)
- MIN_BARS_FOR_EVALUATION = 252 (HIGH_LOW_52W binding)
- IndicatorReadiness per-field interface + getIndicatorReadiness() function
- insufficiencyReason() distinguishes 200-251 case from <200 case

### Lock 4 — Staged resumable warehouse (Correction 3)
- kite_warehouse_progress table; FNV-1a snapshotId; CANARY(50)→IN_PROGRESS→COMPLETE
- 100 symbols per batch; resumable cursor; no re-download; validateWarehouseEntry
- Stop thresholds: 3×429, 401/403, 20× consecutive errors
- WAREHOUSE_HISTORY_DAYS = 400 calendar days → ~276 trading days >> 252

### Lock 5 — Reset route protected (new correction)
- POST /api/scan/candle-store/warehouse/reset → requireOwnerStrict
- Resets cursor only; candleHistoryDeleted=false; evaluationLockUnchanged=true
- Cannot touch eval lock or kite_candle_store rows

### Lock 6 — Runtime lock proof (Correction 4)
- candleEvaluationControl.runtime.test.ts: 16 executable runtime tests
- vi.mock: 252-bar candle entry + valid Kite quote
- Proves NOT_EVALUATED at runtime for: curated scanner, full-NSE, export, home movers
- Not source inspection — actual production function called

### Lock 7 — Per-field readiness (Correction 5)
- IndicatorReadiness interface: rsiReady, ema20Ready…ema200Ready, macdReady, volumeBaselineReady, week52Ready, allMandatoryInputsReady
- Only allMandatoryInputsReady=true rows are Phase-B eligible

## Battery (commit fe12160, 2026-08-07)
- api-server: **280 files / 6515 tests** — PASS
- scanner: **52 files / 1250 tests** — PASS
- 4-pkg TSC: CLEAN
- api-server production esbuild: PASS
- scanner Vite production build: PASS
- SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean ✓
- FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean ✓
- SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean ✓
- Provider import guard: PASS ✓
- git diff --check: PASS ✓

## Advisory lock keys
- 88_274_614 = KITE_HISTORICAL_INGESTION_GLOBAL_LOCK (shared serializer)
- 88_274_615 = ADVISORY_LOCK_KEY (curated refresh identity)
- 88_274_616 = FULL_NSE_WAREHOUSE_LOCK_KEY (warehouse identity)

## Phase A authorization request pending
String: AUTHORIZE_PROMPT_33_PHASE_A_STORE_POPULATION_DEPLOYMENT

## Post-publish verification checklist
1. kite_warehouse_progress table created (runtime schema-ensure)
2. Curated refresh: lock 88_274_615 acquired; ≥190 ok entries within 5 min
3. Global lock 88_274_614: serializing both jobs (rate429Count=0 in metrics)
4. Warehouse: lock 88_274_616; phase=CANARY (50 symbols) after 5-min boot delay
5. Canary ≤10% fail → IN_PROGRESS; ~50-min full backfill begins
6. /api/scan/candle-store/metrics: evaluationStatus.authorized=false, phase='A'
7. Scanner: every row signal='NOT_EVALUATED', setupMessage contains PHASE_A_POPULATION_ONLY
8. Insufficient rows: setupMessage contains INSUFFICIENT_CANONICAL_HISTORY + ≥252 message
9. Zero Yahoo-derived Indian score or action
10. Losing replicas: LOCK_HELD skip → DB reload within 15s
11. p50/p95 scanner response < 25 seconds
12. POST /api/scan/candle-store/warehouse/reset returns 403 for non-owner requests

## Rollback
Roll back via Replit checkpoint. All operations are non-destructive upserts.
Advisory locks self-release on connection drop.
kite_warehouse_progress cursor resets without data loss.

## Phase B activation (after Phase A evidence)
1. Change `false → true` in candleEvaluationControl.ts (SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED)
2. Code review + redeploy required
3. Prove: evaluated rows have all canonical inputs; incomplete = NOT_EVALUATED
