---
name: Pack 8 closure
description: Yahoo coverage and retirement qualification — what changed, what was retained, test counts, guard fix.
---

## What Pack 8 did

- **fetchBenchmarkBarsResilient** in `swingScannerData.ts` is now **Kite-first** (attempt 1: Kite historical by token 256265; attempts 2-3: Yahoo fallback labeled `source=yahoo/yahoo_retry`).
- `analyticsYahoo.ts` gained `export const DELAYED_ANALYTICS_ONLY = "DELAYED_ANALYTICS_ONLY" as const` for test verification.
- Yahoo RETAINED (no replacement exists): `globalIndices.ts`, `macroHistory.ts`, `indicesBoard.ts`, `preMarket.ts`, `marketTrend.ts` (global only), `financials.ts` + `fetchFundamentalsForSwing` (full P&L/balance-sheet).
- Legacy `fetchDailyBars` preserved as Yahoo-only (separate function, not the production path).

## New test files
- `p28.gate0.futureTimestampRegression.test.ts` (13 tests)
- `p28.gate1.yahooInventory.test.ts` (20 tests)
- `p28.gate5.yahooIsolation.test.ts` (18 tests)
- `p28.gate7.runtimeTests.test.ts` (32 tests)

## Test count & TSC
- api-server: 5964, scanner: 1250; 4-pkg TSC clean; git diff clean.

## Guard fix
- Observation scripts (gate0_p28_observe.ts, gate0_p28_round.ts) were temporarily added to allowlist with ceiling raised to 33; deleted after observation; allowlist restored to 29 pairs / FROZEN_CEILING=29.

## Pre-existing test fixes (Upstox activation from Pack 27)
- P23A/P23D/b1 tests that expected NOT_CONFIGURED now also stub UPSTOX_ANALYTICS_TOKEN="" (resolveUpstoxConfig prefers ANALYTICS over ACCESS).
- swingScannerData.benchmark.test.ts tests 1 and 3 updated for Kite-first error ordering.
- G5-12: router.ts has "analyticsYahoo" in comment only — regex changed to `^import.*analyticsYahoo` to avoid false positive.

**Why:** resolveUpstoxConfig in upstoxClient.ts reads UPSTOX_ANALYTICS_TOKEN first; tests that stub only UPSTOX_ACCESS_TOKEN="" pass over the analytics token and return configured=true.

## Gate 0 observation
- 26 rounds × 8 instruments = 208 MATCH_WITHIN_TOLERANCE; max Δ 4.28 bps (threshold 50 bps); 0 FUTURE_TIMESTAMP.
- Bash-loop observation approach (setsid + disown does NOT survive vitest runs in this env; use foreground sequential tsx calls from shell tool instead).

## COMPLETE 2026-08-06
