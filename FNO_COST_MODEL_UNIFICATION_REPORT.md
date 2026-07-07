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
