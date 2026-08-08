---
name: Pack 33 Control-Only Deployment Closure
description: Full Pack 33 corrective state — compile-time locks, transactional force-stop, classifier reform, pre-publish evidence. DEPLOYMENT_PENDING.
---

## Pre-publish verdict (2026-08-08)

`PROMPT_33_CONTROL_REMEDIATION_IMPLEMENTED — DEPLOYMENT_PENDING — WAREHOUSE_POPULATION_HARD_PAUSED`

**Post-publish verdict (after verification + corrective STOP):**  
`PROMPT_33_PHASE_A_CONTROL_REMEDIATION_DEPLOYED — WAREHOUSE_STOPPED — AUTHORITATIVE_ELIGIBILITY_FOUNDATION_PENDING — CANARY_RETRY_REQUIRES_SEPARATE_OWNER_AUTHORIZATION`

---

## Four compile-time locks (all `false as boolean`)

| Constant | File | Value | Controls |
|----------|------|-------|----------|
| `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED` | `candleEvaluationControl.ts` | `false as boolean` | Warehouse scheduler + all Kite historical fetches for warehouse |
| `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED` | `candleEvaluationControl.ts` | `false as boolean` | Phase B evaluation + paper signal generation |
| `FNO_PAPER_V2_RUNTIME_AUTHORIZED` | `v2PaperLocks.ts` | `false as boolean` | FNO V2 paper cohort activation |
| `SWING_PAPER_V2_RUNTIME_AUTHORIZED` | `v2PaperLocks.ts` | `false as boolean` | Swing V2 paper cohort activation |

No env-var, route, admin, or force bypass exists for any lock. All confirmed in both source and built artifact.

---

## Broker execution hard disable

`isLiveCashSwingOrderEnabled()` in `swingLiveExecutionConfig.ts`:
- Returns false when `LIVE_CASH_SWING_ORDER_ENABLED` env var is absent (default)
- Must be explicitly set to a truthy string value to enable
- In current deployment: env var absent → `return false`
- Even when true, no real broker order code exists in the current phase

---

## Deployment race elimination (primary safety)

`initFullNseWarehouseScheduler()` checks `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED` as its **first statement** and returns without registering any `setTimeout`. After deploy, application is safe with zero owner action.

Three independent lock check points in `fullNseWarehouse.ts`:
1. Scheduler — no `setTimeout` registered, `warehouseTimer` stays `null`
2. `runFullNseWarehousePopulation()` — returns `{skipped:true, skipReason:"PAUSED_BY_COMPILE_TIME_CONTROL"}`
3. `fetchWarehouseEntry()` — throws `BUG:` error if somehow reached

Built artifact: `PAUSED_BY_COMPILE_TIME_CONTROL` appears 4× in `dist/index.mjs` (guard branches preserved by esbuild). No env-var bypass in built bundle.

---

## Classifier design contract (authoritative source requirement)

`instrumentEligibility.ts` — key constraints:
1. `inCurrentMaster: boolean` is a **required** input. `false` → UNRESOLVED_SECURITY_TYPE immediately.
2. ORDINARY_EQUITY_ELIGIBLE requires affirmative evidence: `inCurrentMaster=true + exchange=NSE + segment=NSE + instrument_type=EQ + no exclusion`
3. Suffix (-SG, -GB, -ST, -BZ) is supporting evidence for in-master instruments only — NOT independent authority
4. OMFURN-ST (NOT_FOUND in Kite cache) → `inCurrentMaster=false` → UNRESOLVED, not SME_EQUITY_POLICY_EXCLUDED
5. Missing/conflicting metadata fails closed

**Authoritative NSE security-master integration is a pre-canary requirement.** Must join instrument_token, ISIN, exchange, segment, series/security type, tradingsymbol from a dated NSE reference. T2T stocks currently reach step 10 (ORDINARY_EQUITY_ELIGIBLE) due to no T2T detection — pending that integration.

---

## Transactional force-stop with idempotency

`forceStopWarehouseTransactional()` in `fullNseWarehouse.ts`:
- Checks `kite_warehouse_stop_audit` for existing SUCCESS record → returns cached if found (idempotent)
- Opens `db.transaction()`: INSERT audit (status=SUCCESS) + UPDATE progress atomically
- Failed tx rolls back both — no SUCCESS record for failed mutations
- Failed attempt recorded best-effort with `_FAIL_<ts>` key suffix
- Table declared in `runtimeTables.ts` to prevent drizzle-kit DROP

---

## Reset route lock gate

`POST /warehouse/reset` returns 409 `POPULATION_LOCK_PREVENTS_CANARY_RESTART` when `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED=false`. Cannot advance STOPPED→CANARY while no scheduler is registered. Force-stop route requires `expectedSnapshotId` + `expectedCurrentStatus` + `idempotencyKey`.

---

## Production state (2026-08-08)

- `kite_warehouse_progress.status = CANARY` (from Aug 7 accidental reset)
- Post-deploy corrective STOP: use `POST /api/scan/candle-store/warehouse/force-stop`
  - `expectedCurrentStatus: "CANARY"` (verify after deploy)
  - `expectedSnapshotId`: read from GET /api/scan/candle-store/metrics after deploy
  - `stoppedReason: "ACCIDENTAL_OWNER_BOUNDARY_TEST_RESET_PENDING_REMEDIATION"`
  - `confirmationPhrase: "AUTHORIZE_FORCE_STOP_KITE_WAREHOUSE"`
  - unique `idempotencyKey`

---

## Battery (2026-08-08 final)

| Check | Result |
|-------|--------|
| api-server tests | 6589 / 282 files PASS |
| scanner tests | 1250 / 52 files PASS |
| 4-pkg TSC | CLEAN |
| api-server prod build | SUCCESS (7.3MB) |
| scanner prod build | SUCCESS (2.9MB) |
| git diff --check | CLEAN |
| Built artifact lock scan | `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false` confirmed, 4× PAUSED_BY_COMPILE_TIME_CONTROL, no env-var bypass |
| Eligibility tests | 46/46 PASS |
| Compile-time lock tests | 17/17 PASS |

---

## Remaining work before canary retry

1. **Authoritative NSE security master** — dated reference file (NSE security master / Kite full instrument dump with series field) joined via instrument_token + ISIN + exchange + segment + series/security type + tradingsymbol. Required before next canary. T2T integration is part of this.
2. **Post-deploy verification** (C) — check production build identity, warehousePopulationLock.authorized=false, schedulerRunning=false, kiteRequests=0, all four locks=false, broker=disabled
3. **Corrective production STOP** (D) — force-stop with exact snapshotId + status + idempotency + stoppedReason
4. **Do NOT**: retry canary, enable warehouse population, enable evaluation, activate V2 cohorts, change F&O/swing logic
