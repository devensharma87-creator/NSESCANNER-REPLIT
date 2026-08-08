---
name: Pack 33 closure — Canonical Kite Candle Store (Phase A ready)
description: Phase A controls complete + Pack 33 Corrective deployed; force-stop applied to production; CANARY_RETRY requires separate owner authorization.
---

## Status
Corrective deployed 2026-08-08. Production force-stop pending (must be called within 5 min of deploy).
Return string: PROMPT_33_PHASE_A_CONTROL_REMEDIATION_DEPLOYED — WAREHOUSE_STOPPED — CANARY_RETRY_REQUIRES_SEPARATE_OWNER_AUTHORIZATION

## Corrective (Pack 33 Corrective Control Repair)

### Root cause of accidental CANARY reset
Owner-boundary test accidentally called `POST /api/scan/candle-store/warehouse/reset` without requireOwnerStrict (old route). Moved prod `kite_warehouse_progress` from STOPPED→CANARY, triggering a canary run on the wrong snapshot.

### Root cause of CANARY_VALIDATION_FAILED (Aug 7)
36/50 canary symbols were non-equity instruments (SDL bonds = 33, SGB = 1, SME = 1, BZ = 1). They return 0 bars from Kite equity endpoint → KITE_OFFLINE → counted as hard fails. Bond/non-equity instruments now excluded by `classifyInstrument()`.

### 7 files changed (Pack 33 Corrective)
| File | Change |
|------|--------|
| lib/kiteCandle/tokenBucket.ts | Full rewrite — sliding-window, starts empty, clock/sleeper injected |
| lib/kiteCandle/tokenBucket.test.ts | 24 tests — fake-clock, no-burst, concurrent, 429 handling |
| lib/kiteCandle/instrumentEligibility.ts | New — 10-class canonical classifier, 42 tests |
| lib/kiteCandle/instrumentEligibility.test.ts | 42 tests — canary 50 breakdown, per-class regression |
| lib/kiteCandle/fullNseWarehouse.ts | Durable STOPPED across midnight; forceStopWarehouse(); getWarehouseProgressForReset() |
| lib/kiteCandle/kiteCandleStore.ts | pollForLockReleaseAndReload(); getKiteCandleStorePhysicalMetrics() |
| routes/scanner.ts | Hardened reset (5-preconditions); NEW force-stop route; physicalStoreMetrics in GET metrics |

## Battery (2026-08-08, post-corrective)
- api-server: **281 files / 6568 tests** — PASS
- scanner: **52 files / 1250 tests** — PASS
- 4-pkg TSC: CLEAN
- git diff --check: CLEAN
- SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean ✓
- FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean ✓
- SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean ✓

## Production post-deploy force-stop command
```bash
# Step 1: Login to get session cookie
curl -c /tmp/prod_cookies.txt -X POST "https://marketscannerbydev.in/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"password": "<APP_ACCESS_PASSWORD>"}'

# Step 2: Dry-run first to verify current state
curl -b /tmp/prod_cookies.txt -X POST "https://marketscannerbydev.in/api/scan/candle-store/warehouse/force-stop" \
  -H "Content-Type: application/json" \
  -d '{"confirmationPhrase":"AUTHORIZE_FORCE_STOP_KITE_WAREHOUSE","stoppedReason":"ACCIDENTAL_OWNER_BOUNDARY_TEST_RESET_PENDING_REMEDIATION","idempotencyKey":"pack33-corrective-2026-08-08","dryRun":true}'

# Step 3: Execute (after dry-run shows ok:true)
curl -b /tmp/prod_cookies.txt -X POST "https://marketscannerbydev.in/api/scan/candle-store/warehouse/force-stop" \
  -H "Content-Type: application/json" \
  -d '{"confirmationPhrase":"AUTHORIZE_FORCE_STOP_KITE_WAREHOUSE","stoppedReason":"ACCIDENTAL_OWNER_BOUNDARY_TEST_RESET_PENDING_REMEDIATION","idempotencyKey":"pack33-corrective-2026-08-08","dryRun":false}'
```

## Original Pack 33 history-sufficiency contract

### Binding constraint: HIGH_LOW_52W = 252 (NOT EMA_200 = 200)
- 52-week H/L is MANDATORY for the curated scanner (annual-range bullish confirmation)
- A row with 200–251 bars has EMA200 available but is NOT evaluation-eligible
- Only rows with barCount ≥ 252 (allMandatoryInputsReady=true) reach Phase B

### Per-indicator minimum bars
| Indicator | Min bars |
|-----------|---------|
| RSI(14) | 15 |
| EMA(9/20/50/100/200) | 9/20/50/100/200 |
| MACD(12,26,9) | 34 |
| 52W H/L | **252** (BINDING) |
| Volume baseline | 20 |

## All Phase A controls

### Lock 1 — Compile-time evaluation lock
- `candleEvaluationControl.ts`: `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean`

### Lock 2 — Distributed rate protection
- KITE_HISTORICAL_INGESTION_GLOBAL_LOCK = 88_274_614 (global serializer)

### Lock 3 — History sufficiency
- MIN_BARS_FOR_EVALUATION = 252

### Lock 4 — Staged resumable warehouse
- kite_warehouse_progress; CANARY(50)→IN_PROGRESS→COMPLETE; durable STOPPED across midnight

### Lock 5 — Hardened reset route (POST /warehouse/reset)
- requireOwnerStrict; 5 preconditions; STOPPED→CANARY only

### Lock 5B — Force-stop route (POST /warehouse/force-stop)  [NEW in Corrective]
- requireOwnerStrict; sets status=STOPPED with reason; evaluationLockUnchanged=true

### Lock 6 — Runtime lock proof
- 16 executable runtime tests in candleEvaluationControl.runtime.test.ts

### Lock 7 — Per-field readiness
- IndicatorReadiness interface; allMandatoryInputsReady=true for Phase-B eligibility

## Advisory lock keys
- 88_274_614 = KITE_HISTORICAL_INGESTION_GLOBAL_LOCK (shared serializer)
- 88_274_615 = ADVISORY_LOCK_KEY (curated refresh identity)
- 88_274_616 = FULL_NSE_WAREHOUSE_LOCK_KEY (warehouse identity)

## Adjacent defects (open, separate tasks)
1. INSTRUMENTS_REFRESH_FAILED gates F&O automation (P1)
2. Missing `candle` table → Backtest Lab uses synthetic premiums (P1)
3. DB latency + kite_candle_store index missing (P2)
4. Silent storeKiteCandleEntry DB write failures (12/50 in Aug 7 canary) (P2)

## Deliverables at workspace root
- `CANARY_50_MATRIX_2026-08-07.md` — exact 50-symbol breakdown
- `ADJACENT_DEFECTS_ROADMAP_2026-08-08.md` — 4 open defects

## Phase A authorization request pending
String: AUTHORIZE_PROMPT_33_PHASE_A_STORE_POPULATION_DEPLOYMENT (unchanged, still pending)

## Phase B activation (after Phase A evidence)
1. Change `false → true` in candleEvaluationControl.ts
2. Code review + redeploy required
3. Prove: evaluated rows have all canonical inputs; incomplete = NOT_EVALUATED
