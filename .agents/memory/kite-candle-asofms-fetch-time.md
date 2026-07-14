---
name: Kite candle series — asOfMs must be fetch time, not last-candle timestamp
description: Daily candle series from kiteProvider.ts were always rejected as HARD-STALE because asOfMs was the last candle bar's timestamp, not the fetch time. Fix: use Date.now() for candle series meta.
---

## The rule

In `kiteProvider.ts` (`getIndexCandles`, `getEquityCandles`, `getEquityCandlesByToken`), `asOfMs` passed to `buildMeta` must be the **fetch time** (`Date.now()`), NOT `lastTsSec * 1000` (last candle bar's open timestamp).

**Why:** For daily bars the last completed candle is always 17–30 hours old. The market-data policy's `staleBudgetSec=600s` treats this as HARD-STALE → `validationStatus="stale"` → `isTradeableMeta=false` → router drops the series → warmup throws "daily_history_unavailable_kite" → backbone marks all fno/swing modules BLOCKED even when Kite IS returning 60 daily bars correctly.

**How to apply:** For candle series the correct freshness question is "when was this fetched from Kite?", not "how old is the last data point?". The 60-s in-process cache in `kiteIntraday.ts` means the fetch time is always ≤60 s ago — well within any budget. Candle DATA timestamps are still in the `candles[].t` array and unaffected.

**Test guard:** `src/lib/marketData/kiteProvider.candleFreshness.test.ts` — pure `buildMeta` + `isTradeableMeta` tests proving the before (stale) and after (validated) behaviour without network I/O. The regression cases show that even a 1-hour-old last-candle timestamp exceeds `staleBudgetSec=600s` and causes rejection.
