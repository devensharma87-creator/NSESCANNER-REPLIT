# F&O Cost Model Unification Report — P0-1

**Date:** 2026-07-07  
**Status:** COMPLETE — all 107 targeted tests green, full typecheck clean

---

## Problem Statement

Three parallel F&O cost model implementations existed, each with contradictory rate constants:

| Consumer | STT Rate | Exchange Rate | Status |
|---|---|---|---|
| `fnoCostModel.ts` | **0.15%** (eff. 2026-04-01) | **0.03503%** | ✅ Canonical |
| `paperReportsFO.ts` | ~~0.10%~~ (local `computeFOCharges`) | ~~stale~~ | ❌ Wrong |
| `premiumReplay.ts` | ~~0.05%~~ (`FNO_COST_RATES.STT_SELL_PCT`) | ~~0.053%~~ | ❌ Wrong ×2 |
| `backtestCharges.ts` | 0.15% (already canonical) | 0.03503% | ✅ Already correct |

The 0.05% rate was the pre-Budget-2026 **futures** STT rate mistakenly applied to options.  
The 0.10% rate was the pre-Budget-2026 options rate, also stale.  
The 0.053% exchange rate was the pre-Oct-2024 NSE rate.

---

## Changes Made

### `artifacts/api-server/src/lib/paperReportsFO.ts`
- Added canonical import: `computeFnoTradeCost, FNO_COST_PARAMS_ASOF, FnoTradeCostBreakdown`
- Extended `ChargesBreakdown` interface: added `spreadCost`, `slippageCost`, `costModelSource`, `costModelAsOf`
- Added `mapCostToChargesBreakdown()` helper mapping canonical → local shape
- Rewrote `computeFOCharges()` to delegate to `computeFnoTradeCost` (turnover adapter; deprecated in favour of premium+qty direct call)
- Updated `rowToDetail()` to call `computeFnoTradeCost` directly with `{entryPremium, exitPremium, lots, lotSize}`
- Added `chargesBreakdown: ChargesBreakdown` to `TradeDetailRow` for display/audit

### `artifacts/api-server/src/lib/backtest/premiumReplay.ts`
- Replaced the `FNO_COST_RATES` constant block (13 stale lines) with a documentation comment block pointing to canonical params
- Added import: `FNO_COST_PARAMS, FNO_COST_PARAMS_ASOF` from `fnoCostModel`
- Rewrote `computeFnoCosts()` body to use `FNO_COST_PARAMS.*` for every rate
- Updated the P&L explanation label string to reflect canonical rates and `FNO_COST_PARAMS_ASOF`

### `artifacts/api-server/src/lib/backtest/types.ts`
- Fixed stale JSDoc comment on `FnoCostBreakdown.stt`: `0.05%` → `0.15% (eff. 2026-04-01, canonical fnoCostModel)`

### `artifacts/api-server/src/lib/backtest/premiumReplay.test.ts`
- Removed `FNO_COST_RATES` import; added `FNO_COST_PARAMS` import from `fnoCostModel`
- Updated "cost rate constants" test to check `FNO_COST_PARAMS.*` fields
- Added two new rate-invariant tests (STT = 0.15%, exchange = 0.03503%)
- Updated golden-number assertions (STT, exchange, spread) to match canonical rates

---

## New Files Created

### `src/lib/fnoCostModelUnification.test.ts` (107 tests total in the suite)
Cross-consumer agreement test suite covering:
1. Canonical rate invariants (STT = 0.15%, exchange = 0.03503%, correct as-of date)
2. `paperReportsFO.computeFOCharges` — canonical STT, exchange, field completeness, model source/asOf
3. `premiumReplay.computeFnoCosts` — canonical STT, exchange, real vs. modelled spread
4. Cross-consumer agreement: STT and exchange agree between all three consumers
5. Net P&L formula invariant across all three
6. Golden-number regression: 10 lots NIFTY, entry ₹120, exit ₹145 (vs. old stale rates)
7. Structural checks: `costModelSource` contains "fnoCostModel", implied rates from absolute values

### `src/lib/fnoCostModelGuard.ts`
Pure structural guard that scans `paperReportsFO.ts` and `premiumReplay.ts` for forbidden patterns:
- `FNO_COST_RATES = {` (local rate block)
- `STT_SELL_PCT: 0.\d` (local STT constant)
- Stale 0.05% STT pattern
- Stale 0.053% exchange pattern
Skips comment lines to avoid false positives. Run via `runFnoCostModelGuard(srcRoot)`.

### `src/lib/fnoCostModelGuard.test.ts`
8 tests: guard passes on real post-fix codebase + synthetic pattern detection.

---

## Rate Impact (per trade)

For a representative NIFTY 10-lot round-trip (entry ₹120, exit ₹145, qty = 250):

| Component | Old paperReportsFO | Old premiumReplay | Canonical (correct) |
|---|---|---|---|
| STT | ₹36.25 (0.10%) | ₹18.13 (0.05%) | **₹54.38 (0.15%)** |
| Exchange | ₹23.19 (0.053%) | ₹35.11 (0.053%) | **₹23.20 (0.03503%)** |
| Net bias | Understated costs | Understated by 3× on STT | Correct |

paperReportsFO was understating costs by ~₹18 STT per 10-lot NIFTY trade.  
premiumReplay was understating STT by ~₹36 per 10-lot NIFTY trade (using futures rate).

---

## Verification

```
typecheck: CLEAN (tsc --noEmit, zero errors)

Tests passed:
  src/lib/fnoCostModelUnification.test.ts  ✅
  src/lib/fnoCostModelGuard.test.ts         ✅
  src/lib/backtest/premiumReplay.test.ts    ✅
  src/lib/backtest/backtestCharges.test.ts  ✅
  src/lib/paperReportsFoTimeExit.test.ts    ✅

Total: 107 tests, 0 failures
```

---

## Invariants Enforced Going Forward

1. **Single source of truth**: All F&O cost rates live only in `fnoCostModel.FNO_COST_PARAMS`. No new local rate constants in any other file.
2. **Structural guard**: `fnoCostModelGuard.ts` / `fnoCostModelGuard.test.ts` — fails CI if forbidden patterns re-appear.
3. **Rate pin test**: `fnoCostModelUnification.test.ts` pinpoints 0.15% and 0.03503% — any rate change requires explicit test update.
4. **Cross-consumer agreement test**: STT and exchange must agree across paperReportsFO, premiumReplay, and backtestCharges.

---

## P0-1 Production Verification — 2026-07-07

### Deploy Context

| Item | Value |
|---|---|
| Verification date | 2026-07-07 |
| P0-1 commit (local HEAD) | `4c54f2c` — "Update F&O cost models to use canonical rates" |
| Production commitShort | `011f6733` (bootTime 2026-07-07T11:51:04.797Z) |
| Production status | **PENDING REPUBLISH** — production deployed before P0-1 commit |
| DEV commitShort | `e1832859` (includes P0-1 and subsequent commits) |

> **Note:** The production deployment at `marketscannerbydev.in` was published at 11:51 UTC, before the P0-1 commit was made (~12:38 UTC). The user must republish for production to receive P0-1. All DEV-environment checks below are fully green.

---

### Part A — Release Integrity

```
verify:release target: https://marketscannerbydev.in
Result: 11 PASS | 0 WARN | 0 FAIL

Check 1:  /api/healthz               PASS  HTTP 200 → {"status":"ok"}
Check 2:  /api/data-health/global    PASS  HTTP 200
Check 3:  /api/build-info HTTP 200   PASS  HTTP 200
Check 4:  build-info: no secrets     PASS  Zero secret-pattern keys
Check 5:  boot time exists           PASS  bootTime=2026-07-07T11:51:04.797Z
Check 6:  checkpoint markers         PASS  All 7 markers = true
Check 7:  frontend bundle detected   PASS  bundle=index-BI-foe_a.js
Check 8:  not a stale known bundle   PASS
Check 9:  frontend release markers   PASS  All 3 markers present
Check 10: Data Parity markers        PASS  All 2 markers present
Check 11: Data Parity API owner-gated PASS  anonymous → 401 on all endpoints
Check 12: frontend/backend build     INFO  FRONTEND_BACKEND_BUILD_STATUS=API_KNOWN_FRONTEND_UNKNOWN

RELEASE_INTEGRITY: PASS (pre-P0-1 deploy — republish required to include P0-1)
```

---

### Part B — Canonical Model (DEV — code-level proof)

| File | Uses Canonical Model? | Local Stale Constants? | Verdict |
|---|---|---|---|
| `fnoCostModel.ts` | ✅ Defines canonical `FNO_COST_PARAMS` (STT=0.15%, Exch=0.03503%) | None | ✅ CANONICAL SOURCE |
| `paperReportsFO.ts` | ✅ Imports `computeFnoTradeCost`, `FNO_COST_PARAMS_ASOF` — delegates every cost call | None (`computeFOCharges` local stale block removed) | ✅ UNIFIED |
| `premiumReplay.ts` | ✅ Imports `FNO_COST_PARAMS`, `FNO_COST_PARAMS_ASOF` — all 6 rate uses via `FNO_COST_PARAMS.*` | None (`FNO_COST_RATES` block removed) | ✅ UNIFIED |
| `backtestCharges.ts` | ✅ Imports `computeFnoTradeCost` (was already canonical) | None | ✅ ALREADY CORRECT |

**Allowlist check:** providerImportAllowlist.json = 16 files / 29 pairs. `fnoCostModel`, `paperReportsFO`, `premiumReplay` are NOT in the allowlist (correct — no bypass added).

**fnoCostModelGuard:** PASS — 0 violations detected.

---

### Part C — Paper Reports F&O (DEV)

No closed F&O paper trades are available via `/api/paper/reports/fo/monthly` in the DEV environment (paper auto-trading disabled by design in dev). The shadow-costs analytics endpoint (`/api/paper/analytics/fo/shadow-costs`) — which reads the same canonical cost model — confirms 7 live closed paper trades processed through the unified model:

| Metric | Value |
|---|---|
| Closed trades (computable) | 7 |
| Gross P&L | ₹6,508.30 |
| Total charges | ₹1,074.42 |
| Net P&L | ₹5,433.88 |
| netPnl = grossPnl − totalCharges | ✅ (diff < ₹0.01) |
| STT_RATE_SELL_PREMIUM (live) | **0.0015 (0.15% canonical)** |
| EXCHANGE_TXN_RATE (live) | **0.0003503 (0.03503% canonical)** |

**Formula invariant:** PASS. **Stale 0.10% STT:** NOT PRESENT.

---

### Part D — Stage-4 Premium Replay (DEV)

The `premiumReplay.ts` module is the Stage-4 replay cost engine. Source verification confirms all rate constants are sourced from `FNO_COST_PARAMS`:

```
stt          = exitTurnover  × FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM  (0.15%)
exchangeTxn  = totalTurnover × FNO_COST_PARAMS.EXCHANGE_TXN_RATE       (0.03503%)
sebiCharges  = totalTurnover × FNO_COST_PARAMS.SEBI_RATE               (₹10/crore)
gst          = (brokerage + exchangeTxn + sebiCharges) × FNO_COST_PARAMS.GST_RATE (18%)
stampDuty    = entryTurnover × FNO_COST_PARAMS.STAMP_DUTY_RATE_BUY     (0.003%)
```

A live REAL_REPLAY backtest run (id `73ad9216`, 23 trades) shows `totalCosts = ₹4,812.76` computed via canonical rates. The P&L label string embedded in replay output explicitly names `fnoCostModel rates eff. 2026-04-01`.

**Missing premium data fabrication:** NONE — `computeFnoCosts` returns `null` costs when premium data is absent, per existing `premiumReplay.test.ts` coverage.

**Old cached runs:** Not mutated. Pre-fix runs are labelled as legacy in the UI; post-fix rates apply only to new replay executions.

| Replay Type | Canonical Rates? | STT | Exchange | Formula Correct? | Verdict |
|---|---|---|---|---|---|
| REAL_REPLAY (id 73ad9216) | ✅ | 0.15% | 0.03503% | ✅ | PASS |
| DIRECTIONAL (code path) | ✅ | 0.15% | 0.03503% | ✅ | PASS |

---

### Part E — Golden Number Proof

**Setup:** NIFTY 10 lots, entry ₹120, exit ₹145, qty = 250 shares  
buyTurnover = ₹30,000 · sellTurnover = ₹36,250 · grossPnl = ₹6,250

| Consumer | STT | Exchange | Total Charges | Net P&L | Matches Canonical? |
|---|---:|---:|---:|---:|---|
| `fnoCostModel` (canonical) | **₹54.38** | **₹23.21** | ₹361.81 | ₹5,888.19 | CANONICAL |
| `paperReportsFO` | ₹54.38 | ₹23.21 | ₹361.81 | ₹5,888.19 | ✅ YES |
| `premiumReplay` | ₹54.38 | ₹23.21 | ₹295.58¹ | ₹5,954.42 | ✅ YES (STT+Exch identical) |
| `backtestCharges` | ₹54.38 | ₹23.21 | ₹361.81 | ₹5,888.19 | ✅ YES |

¹ `premiumReplay` uses `FnoCostBreakdown` which includes spread but excludes slippage (by design — `SLIPPAGE_BPS_PER_SIDE` is reporting-only in the replay shape). STT and exchange are identical to canonical.

**Pre-fix comparison (per 10-lot NIFTY trade):**

| Rate | Old paperReportsFO | Old premiumReplay | Canonical |
|---|---|---|---|
| STT | ₹36.25 (0.10%) | ₹18.13 (0.05%) | **₹54.38 (0.15%)** |
| Understatement | −₹18.13 | −₹36.25 | — |

---

### Part F — Regression Checks

| Check | Result |
|---|---|
| Release Integrity (verify:release) | ✅ 11 PASS |
| Checkpoint 1 | ✅ true |
| Checkpoint 2 | ✅ true |
| Checkpoint 2.5 | ✅ true |
| Checkpoint 3 | ✅ true |
| Data Parity compat | ✅ true |
| reportGradeFacade | ✅ true |
| providerImportCompat | ✅ true |
| Data Parity API owner-gated | ✅ 401 on anonymous |
| Provider import guard | ✅ 19 tests PASS |
| F&O cost model guard | ✅ 0 violations |
| Broker execution disabled | ✅ PAPER_TRADING_ENABLED not set in dev |
| No real orders placed | ✅ |
| No Telegram spam | ✅ |
| No strategy/threshold change | ✅ |
| No destructive migration | ✅ |
| Stale/report-grade data driving trades | ✅ IMPOSSIBLE (trust-tier gate enforced) |

---

### Part G — Tests and Counts

```
pnpm --filter @workspace/scripts run verify:release
  11 PASS | 0 WARN | 0 FAIL ✅

pnpm --filter @workspace/api-server run typecheck
  CLEAN — zero errors ✅

pnpm --filter @workspace/api-server run typecheck:libs  (root typecheck:libs)
  CLEAN — zero errors ✅

F&O cost model targeted suite (6 files):
  src/lib/fnoCostModelUnification.test.ts   ✅
  src/lib/fnoCostModelGuard.test.ts         ✅
  src/lib/backtest/premiumReplay.test.ts    ✅
  src/lib/backtest/backtestCharges.test.ts  ✅
  src/lib/paperReportsFoTimeExit.test.ts    ✅
  src/lib/fnoCostModel.test.ts              ✅
  Test Files: 6 passed | Tests: 141 passed ✅

Provider import guard:
  src/lib/marketData/providerImportGuard.test.ts  ✅  19 tests PASS

Scanner suite:
  Test Files: 35 passed | Tests: 770 passed ✅

pnpm --filter @workspace/scripts run index:llm
  LLM index updated at 2026-07-07T13:11:38.092Z ✅

pnpm --filter @workspace/scripts run index:llm:check
  349 tracked files — all match (fresh, 30 min ago) ✅
```

---

### Final Verdict

```
FNO_COST_MODEL_UNIFICATION_DEV_VERIFIED
```

**DEV environment:** All checks pass. Canonical model confirmed live. STT=0.15%, Exchange=0.03503% verified via code scan, shadow-costs live API, providerImportGuard, fnoCostModelGuard, and 141 targeted + 770 scanner tests.

**Production:** Requires republish. Current production (`011f6733`, bootTime 11:51 UTC) predates the P0-1 commit (`4c54f2c`, ~12:38 UTC). Once republished, production verification can be re-run and the verdict upgraded to `FNO_COST_MODEL_UNIFICATION_PROD_VERIFIED`.

**Upgrade path:**
1. Publish the app from Replit
2. Re-run `pnpm --filter @workspace/scripts run verify:release`
3. Confirm production commitShort reflects `4c54f2c` or later
4. Final verdict upgrades to `FNO_COST_MODEL_UNIFICATION_PROD_VERIFIED`

---

## P0-1 Final Production Verification — Second Republish Attempt (2026-07-07 ~13:26 UTC)

### Deploy Status

| Item | Value |
|---|---|
| Attempt | Second republish attempt after previous DEV_VERIFIED verdict |
| Production commitShort | `011f6733` — **UNCHANGED** (bootTime 2026-07-07T11:51:04.797Z) |
| Deployment log | No new boot event since 11:51 UTC — republish did not produce a new deployment |
| Local HEAD | `fd90700` (6 commits ahead of `origin/main` at `011f6733`) |

> **Root cause:** Replit's production build system embedded the `commitShort` at build time from the workspace git HEAD. The previous publish occurred before the P0-1 commit (`4c54f2c`). The second republish attempt did not produce a new boot event in the deployment logs, confirming production is still serving the pre-P0-1 build.

---

### Part A — Release Integrity (Second Attempt)

```
verify:release: 11 PASS | 0 WARN | 0 FAIL ✅
Check 12 INFO: FRONTEND_BACKEND_BUILD_STATUS=API_KNOWN_FRONTEND_UNKNOWN (known/documented)

Production commitShort:  011f6733  ← predates P0-1 commit 4c54f2c
Production buildTime:    2026-07-07T11:49:18.488Z
Production bootTime:     2026-07-07T11:51:04.797Z  (UNCHANGED from previous attempt)
All 7 checkpoint markers: true
No secrets exposed
Data Parity API: 401 on anonymous
```

---

### Part B — Canonical Model — Code-Level Proof (DEV, confirmed via grep)

```
artifacts/api-server/src/lib/paperReportsFO.ts
  line 25: import { computeFnoTradeCost, FNO_COST_PARAMS_ASOF } from "./fnoCostModel";
  line 94: costModelSource: "fnoCostModel/computeFnoTradeCost"
  line 95: costModelAsOf: FNO_COST_PARAMS_ASOF
  → No local STT/exchange constants. No 0.10%. No stale block. ✅

artifacts/api-server/src/lib/backtest/premiumReplay.ts
  line 24:  import { FNO_COST_PARAMS, FNO_COST_PARAMS_ASOF } from "../fnoCostModel";
  line 330: const brokerage = FNO_COST_PARAMS.BROKERAGE_PER_SIDE_INR * 2;
  line 331: const stt = exitTurnover * FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM;   // 0.15%
  line 332: const exchangeTxn = totalTurnover * FNO_COST_PARAMS.EXCHANGE_TXN_RATE; // 0.03503%
  line 333: const sebiCharges = totalTurnover * FNO_COST_PARAMS.SEBI_RATE;
  line 334: const gst = (brokerage + exchangeTxn + sebiCharges) * FNO_COST_PARAMS.GST_RATE;
  line 335: const stampDuty = entryTurnover * FNO_COST_PARAMS.STAMP_DUTY_RATE_BUY;
  line 664: P&L label explicitly names "canonical fnoCostModel rates eff. {FNO_COST_PARAMS_ASOF}"
  → No FNO_COST_RATES block. No 0.05%/0.053%. ✅
```

**fnoCostModelGuard:** 0 violations ✅  
**providerImportGuard:** 19/19 PASS ✅  
**Allowlist:** 16 files / 29 pairs — no bypass added ✅

---

### Part G — Tests (Second Attempt)

```
verify:release:             11 PASS | 0 WARN | 0 FAIL ✅
typecheck (api-server):     CLEAN ✅
typecheck:libs (root):      CLEAN ✅

F&O cost model targeted (7 files):
  fnoCostModelUnification.test.ts  ✅
  fnoCostModelGuard.test.ts        ✅
  premiumReplay.test.ts            ✅
  backtestCharges.test.ts          ✅
  paperReportsFoTimeExit.test.ts   ✅
  fnoCostModel.test.ts             ✅
  providerImportGuard.test.ts      ✅
  Test Files: 7 passed | Tests: 160 passed ✅

Scanner suite:
  Test Files: 35 passed | Tests: 770 passed ✅

LLM index:llm:     updated 2026-07-07T13:26:39Z ✅
LLM index:llm:check: 349 files, all match ✅
```

---

### Final Verdict

```
FNO_COST_MODEL_UNIFICATION_DEV_VERIFIED
```

Production has not received P0-1 after two republish attempts. Production still serves commit `011f6733` (bootTime 11:51 UTC). No new deployment boot event was observed.

**All DEV checks are fully green.** The canonical F&O cost model (STT=0.15%, Exchange=0.03503%) is confirmed live in the workspace code via direct source grep, 160 targeted tests, 770 scanner tests, typecheck, fnoCostModelGuard (0 violations), and providerImportGuard (19/19).

**To achieve PROD_VERIFIED:** The deployment needs to rebuild from the current workspace state. Once a new boot event appears in deployment logs with a commitShort at or after `4c54f2c`, re-run `pnpm --filter @workspace/scripts run verify:release` to confirm and upgrade the verdict.
