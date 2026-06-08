---
name: Custom strategy live↔backtest parity boundary
description: Where the custom F&O strategy live/backtest parity guarantee actually holds, and why an end-to-end "identical entries" test is not achievable.
---

The custom F&O strategy (Task #113) shares ONE evaluator across surfaces. The
parity guarantee holds at the boundary `projectFeatureSeries(...)` →
`evaluateSpecAt(series, i, spec)`, which both surfaces call verbatim (live in
`optionSignals.ts` buildContext as `customFeatureSeries`; backtest in
`featureSeriesFromBacktestContext`). The cross-surface parity test feeds the SAME
raw candle arrays into BOTH projection calls and asserts deep-equal FeatureSeries
+ identical per-bar evaluation.

**Why there is no end-to-end "same candles ⇒ identical entries" test above that
boundary:** the live VWAP is volume-weighted (real intraday volume), while the
backtest VWAP is the labeled equal-weighted session-mean substitute (historical
index candles carry no volume). They are intentionally different data sources, so
the feature arrays CANNOT be byte-identical at the data-construction layer — only
at/after `projectFeatureSeries`. A reviewer may flag "the test doesn't exercise
optionSignals' own VWAP/ATR/IST construction"; that gap is by design, not a
defect. If you ever want to test the live array-construction, extract the
day-reset VWAP/istMinute loop from optionSignals into a pure helper and unit-test
IT in isolation — do not try to force it equal to the backtest substitute.
