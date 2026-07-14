---
name: Kite Integration Hardening Patterns
description: Callback injection for isKiteLive, quote throttle architecture, and EOD reconcile scheduler pattern — avoid repeating design mistakes.
---

## isKiteLive — callback injection to avoid circular deps

`kiteAuth.ts` cannot import `kiteFeed.ts` (kiteFeed already imports kiteAuth → circular).
Solution: `_registerWsLivenessCheck(fn: () => boolean)` in `kiteAuth.ts`; `kiteFeed.ts` calls it at module load with `() => feedStatus().running && feedStatus().connected`.

**Fail-closed**: `isKiteLive()` returns `_wsLivenessCheck?.() ?? false` — null check means startup window (before kiteFeed is imported) safely returns false.

**Test-only reset**: `_resetKiteLivenessForTest()` sets `_wsLivenessCheck = null`. Use in `beforeEach` to isolate tests from module-load state.

**How to apply**: Any new module that needs a reverse dependency on kiteAuth should use this same callback injection pattern. Never add a direct import in the other direction.

## Quote rate limiter — kiteRateLimiter.ts

333 ms interval = ≤3 req/s (Kite REST limit). `QUOTE_MAX_PENDING = 10` prevents queue starvation. `reserveQuoteSlot()` returns false immediately when full (fail-closed). `quotePendingCount` is decremented in `finally` so callers never need to track it.

**Test helper**: `_setQuotePendingCountForTest(n)` directly sets the count to simulate full queue without needing to actually fill it. `_resetQuoteThrottleForTest()` resets to pristine.

## EOD reconcile scheduler pattern

`maybeRunEodReconcile()` follows the exact same layered-dedup pattern as every other scheduler in dailyReports.ts:
1. Fast in-memory latch (`lastEodReconcileDate`)
2. `tryClaimScheduledReport("eod_reconcile", date)` for DB-backed multi-worker dedup
3. Wired into the 60s setInterval alongside pre/post/kite-session-check

Window: [15:35, 15:55) IST (START_MIN=935, WINDOW=20). Weekdays only.

The `ensureDailyReportRunsTable()` already covers the `daily_report_runs` table — no extra schema work needed.

**Why**: P&L field from `SUM(realised_pnl)` comes back as a string from drizzle raw execute; always coerce with `Number(...)`. Open rows at 15:35 = missed force-close — warn in log AND Telegram.
