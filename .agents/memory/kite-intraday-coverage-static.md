---
name: hasKiteIntradayCoverage is a static check
description: The F&O coverage flag is a hardcoded INDEX_TABLE lookup, not a live connectivity probe; actual suppression comes from centralIndexCandles returning null.
---

## Rule
`hasKiteIntradayCoverage(yahooSymbol)` in `kiteIntraday.ts` returns `INDEX_TABLE.some(e => e.yahoo === yahooSymbol)` — a static table check. It is always `true` for NIFTY/BANKNIFTY/SENSEX because they are in the hardcoded `INDEX_TABLE`.

**It does NOT reflect whether the Kite historical API is actually working.**

## Why This Matters
When the F&O signal cycle reports `no_live_kite_intraday`, it is NOT because `centralHasIndexCoverage` returned false. The actual failure is `centralIndexCandles(cfg.yahoo, "15minute", 5)` returning `null`. The coverage guard passes, then the candle fetch fails.

## Root Cause of Live vs Dev Divergence
- Prod (pid=19): boot warmup ran first, successfully primed the candle cache → setups shown
- Prod (pid=18): warmup raced with pid=19, Kite historical API rate-limited → suppressed
- Dev/workspace: candle cache cold, Kite historical API rate-limited or throttled → suppressed

## Fix Applied
`optionSignals.ts` now auto-triggers `triggerKiteWarmup("scheduler")` via dynamic import when all indices are suppressed with `no_live_kite_intraday` or `daily_history_unavailable_kite`. Warmup is debounced 60s so it doesn't flood the cycle.

## How to Apply
When diagnosing F&O suppression: check `centralIndexCandles` cache directly, not `centralHasIndexCoverage` — the latter will always say true for the 3 configured indices.
