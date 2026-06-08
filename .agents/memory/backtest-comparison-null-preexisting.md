---
name: backtestComparisonIgnoredFilters null is pre-existing
description: The COMPARE live-DB test can fail with null strategyComparison independent of custom-strategy work; it's a separate compare-route issue.
---

# `backtestComparisonIgnoredFilters.test.ts` null comparison

This live-DB + candle-CSV regression test (`artifacts/api-server/src/routes/__tests__/`)
drives a real COMPARE_OFFICIAL_VS_STRATEGIES backtest over the HTTP router and
asserts `strategyComparison` is present with per-strategy `ignoredFilters`. It can
fail deterministically with `strategyComparison` null even when the candle CSVs
are present (so it runs, not skips).

**Why it is NOT a custom-strategy regression:** the COMPARE path runs the
built-in engines (`OFFICIAL_ENGINE`, `RANGE_REVERSAL`, `FAILED_BREAKOUT_REVERSAL`)
through `routes/backtest.ts` + the comparison builder + `runToDto` serialization —
NONE of which the custom-strategy / SMC-builder lane touches. Custom-spec changes
(`customSpec`/`customEval`/`optionSignals` SMC-label branches, `backtest/strategies/custom.ts`)
are a different code path and cannot null the comparison.

**How to apply:** if this test fails after custom-strategy / builder work, do not
chase it as your regression — confirm your diff doesn't touch the compare route /
comparison builder / runToDto, then treat the null as the separate pre-existing
compare-route serialization/persistence issue. Investigate it on its own (compare
route response shaping), not as part of builder tasks.
