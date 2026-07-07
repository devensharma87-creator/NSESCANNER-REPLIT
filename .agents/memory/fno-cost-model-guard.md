---
name: F&O cost model unification guard
description: fnoCostModelGuard.ts prevents local rate constants re-appearing; test precision gotcha for r2-rounded values
---

## Rule
All F&O options statutory rates live only in `fnoCostModel.FNO_COST_PARAMS`. No other file may define local STT/exchange/SEBI/GST/stamp rate constants.

## Enforcement
- `fnoCostModelGuard.ts` — pure structural scanner; forbidden patterns: `FNO_COST_RATES = {`, `STT_SELL_PCT: 0.\d`, stale 0.05% STT, stale 0.053% exchange. Target files: `paperReportsFO.ts` + `premiumReplay.ts`. Run via `runFnoCostModelGuard(srcRoot)`.
- `fnoCostModelGuard.test.ts` — verifies guard passes on real codebase + synthetic bad-pattern detection.
- `fnoCostModelUnification.test.ts` — cross-consumer agreement: all three consumers (paperReportsFO, premiumReplay, backtestCharges) must produce identical STT and exchange charges for the same turnover.

## Why
Before P0-1 (2026-07-07), three divergent implementations existed:
  - paperReportsFO: STT 0.10% (stale pre-Budget-2026)
  - premiumReplay: STT 0.05% (futures rate!), exchange 0.053% (pre-Oct-2024)
  - backtestCharges: canonical (correct)
The guard prevents silent regression back to local constants.

## How to apply
- When adding a new F&O reporting consumer: import from `fnoCostModel`, do NOT define local rate constants.
- When asserting charge correctness in tests: `computeFnoCosts` uses `r2()` rounding — compare the absolute charge amount with `toBeCloseTo(expected, 1)`, not a back-calculated implied rate (rounding distorts to 7dp comparisons).
- Current rates (as of FNO_COST_PARAMS_ASOF = "2026-04-01"): STT 0.15% sell-side options, exchange 0.03503%, SEBI ₹10/crore, GST 18%, stamp 0.003% buy-side, brokerage ₹20/side.
