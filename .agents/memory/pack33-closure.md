---
name: Pack 33 Corrective Closure
description: Pack 33 corrective R1+R2 state; deployment-race removal; compile-time warehouse population lock; battery counts.
---

## Current state (2026-08-08)

**Pre-publish verdict:**  
`PROMPT_33_CONTROL_REMEDIATION_IMPLEMENTED — DEPLOYMENT_PENDING — WAREHOUSE_POPULATION_HARD_PAUSED`

**Post-publish verdict (after production verification):**  
`PROMPT_33_PHASE_A_CONTROL_REMEDIATION_DEPLOYED — WAREHOUSE_STOPPED — CANARY_RETRY_REQUIRES_SEPARATE_OWNER_AUTHORIZATION`

---

## Two compile-time locks now active

| Constant | File | Value | Controls |
|----------|------|-------|----------|
| `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED` | `candleEvaluationControl.ts` | `false as boolean` | Warehouse scheduler registration + all Kite historical fetches for warehouse |
| `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED` | `candleEvaluationControl.ts` | `false as boolean` | Phase B evaluation + paper signal generation |

Neither has any env-var, route, admin, or force bypass. Both are `false as boolean` to prevent TSC dead-code elimination.

---

## Deployment race removal (R2 key change)

**Problem:** Previous implementation required owner to call force-stop within 5 minutes of deploy before the warehouse scheduler fired. Race was unacceptable.

**Solution:** `initFullNseWarehouseScheduler()` now returns immediately (no setTimeout) when `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED=false`. Application is safe with zero owner action after deployment.

**Three lock check points in fullNseWarehouse.ts:**
1. `initFullNseWarehouseScheduler()` — primary guard, no setTimeout registered
2. `runFullNseWarehousePopulation()` — returns `{skipped:true, skipReason:"PAUSED_BY_COMPILE_TIME_CONTROL"}`
3. `fetchWarehouseEntry()` — throws `BUG: ...` if somehow reached (belt-and-suspenders)

---

## Force-stop endpoint hardening (R2)

`POST /api/scan/candle-store/warehouse/force-stop` now requires:
- `expectedSnapshotId` — exact current snapshotId (409 SNAPSHOT_ID_MISMATCH on mismatch)
- `expectedCurrentStatus` — exact current status string (409 STATUS_MISMATCH on mismatch)
- Writes structured audit record: `{ts, event, idempotencyKey, actor:"[owner-session-redacted]", prevStatus, prevSnapshotId, prevStoppedReason, newStatus, newStoppedReason, evaluationLockUnchanged:true, candleHistoryDeleted:false, populationLockAtTimeOfStop}`

**The force-stop is NOT the primary safety mechanism.** The compile-time lock is. Force-stop corrects DB state after the lock is eventually enabled.

---

## Eligibility classifier reform (R2)

`instrumentEligibility.ts` — explicit precedence:
1. exchange → 2. segment → 3. instrument_type → 4. series (from tradingsymbol suffix) → 5. tradingsymbol → 6. ISIN → 7. inactive/delisted

New output fields:
- `seriesCode: string | null` — extracted from tradingsymbol suffix (not a heuristic; IS the Kite series code)
- `precedenceVector: string[]` — ordered list of signals used in the decision

Kite master artifact: SDL bonds and SGBs have `instrument_type=EQ, segment=NSE`. The series code from the suffix overrides the EQ type. This is documented in the classifier comments.

---

## Canary 50 breakdown (tokens verified from Kite instrument cache 2026-08-08)

| Class | Count | Root cause |
|-------|-------|------------|
| ORDINARY_EQUITY_ELIGIBLE | 14 | Normal main-board equity |
| DEBT_GOVERNMENT_SECURITY (series=SG) | 33 | SDL bonds — Kite master artifact |
| SOVEREIGN_GOLD_BOND (series=GB) | 1 | RBI Gold Bond |
| SME_EQUITY_POLICY_EXCLUDED (series=ST) | 1 | OMFURN-ST |
| UNRESOLVED_SECURITY_TYPE (series=BZ) | 1 | SANWARIA-BZ |

Token coverage: 49/50 (OMFURN-ST not in Kite cache — delisted from master).

---

## Production DB state (2026-08-08)

- `kite_warehouse_progress.status = CANARY` (from accidental reset on Aug 7)
- Source: test that called `POST /api/scan/candle-store/warehouse/reset` without `requireOwnerStrict`
- Fix: that endpoint now has `requireOwnerStrict`. Deploy will bring the lock, making the CANARY status inert.
- To correct the DB state after deploy: use the hardened force-stop endpoint with `expectedSnapshotId`+`expectedCurrentStatus`.

---

## Battery (2026-08-08)

| Suite | Tests | Files |
|-------|-------|-------|
| api-server | 6582 | 282 |
| scanner | 1250 | 52 |
| 4-pkg TSC | CLEAN | — |
| git diff --check | CLEAN | — |

---

## MIN_BARS constants (unchanged from Pack 33 R1)
- `MIN_BARS_FOR_STORAGE = 252` (1-year candle minimum for storage eligibility)
- `MIN_BARS_FOR_EVALUATION = 252` (52W binding; RSI_14=15; runtime proof 16 tests)

---

## Phase A → Phase B activation sequence (future)

When canary evidence is sufficient and the owner approves:
1. Set `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = true as boolean` in `candleEvaluationControl.ts`
2. Redeploy
3. Scheduler will register on next boot (5-min delayed first run)
4. After warehouse reaches COMPLETE, set `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = true as boolean`
5. Redeploy again for Phase B (evaluation enabled)

Neither step can be done without a code edit + review + redeploy. No env-var or route bypass exists.
