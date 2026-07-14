---
name: Candle source/freshness honesty contract
description: How candle source + freshness is surfaced for swing daily bars and index trend intraday, and the deliberate "EOD daily is never live" rule.
---

# Candle source/freshness honesty

The two silent Kite→Yahoo candle fallback gaps (swing daily bars, index trend
intraday) surface `{ source, asOf, fresh }` honestly. Freshness is decided by
ONE shared pure helper `isFreshFor(asOfSec, tf, nowMs)` that reuses the same
per-timeframe budgets as `deriveFreshness` (`TIMEFRAME_CONFIG` in
`chartDatafeed.ts`). Do not invent a second freshness threshold — derive it from
`TIMEFRAME_CONFIG[tf].freshnessSec`.

**Unit trap:** `isFreshFor` expects asOf in SECONDS. Swing DailyBars timestamps
are epoch MILLISECONDS (divide by 1000); intraday timestamps are already
seconds. Mixing these silently shifts freshness by ~1000×.

**Rule — EOD daily bars are NEVER surfaced as "live".** For the swing daily
badge: `none→down`, `!fresh→stale`, `fresh→delayed`. A fresh end-of-day bar is
still end-of-day data, so "live" would be dishonest.
**Why:** daily bars only update once per session after close; calling a fresh
daily bar "live" implies intraday-realtime which it never is.
**How to apply:** only the intraday (15m) trend card may map `fresh + kite →
live`. Any new daily/EOD freshness badge must cap at "delayed", never "live".

**Honesty invariants:** never fabricate a source/asOf; an unknown source is
`none`/"unavailable", never silently relabelled as the other provider. Owner-only
diagnostics live at `GET /api/stocks-to-watch/diagnostics/candle-source` (strict
owner gate, same pattern as sector-coverage; covered by the parametrised matrix
in `diagnosticRouteAuth.test.ts`).
