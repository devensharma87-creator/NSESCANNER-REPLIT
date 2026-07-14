---
name: F&O OI backfill queue must be capped separately from signal-sweep slots
description: OI historical backfill jobs share the 30-slot kiteIntraday throttle queue; without a separate cap they crowd out live F&O signal-sweep requests causing cycle suppression.
---

# F&O OI backfill queue must be capped separately from signal-sweep slots

**The rule:** `reserveHistoricalSlot` in `kiteIntraday.ts` accepts `{ isBackfill?: boolean }`. Backfill requests count against a separate `backfillPendingCount` cap (`BACKFILL_MAX_QUEUE = 8`) and are rejected early when at cap, protecting the live-signal pool.

**Why:** OI backfill fires background `getHistoricalData` calls for ATM±7 strikes × 2 sides per (underlying|expiry|day) tuple — potentially dozens of concurrent jobs. They share the same 30-slot throttle queue as the live F&O signal sweep (index quotes, historical candles for HC signals). Without a cap, backfill jobs can occupy 20+ of the 30 slots, starving the live sweep slots → signal cycle suppresses with `allBarsAvailable=false`. The separate cap lets backfill proceed in the background (up to 8 concurrent) while guaranteeing the live sweep always has headroom.

**How to apply:**
- OI backfill callers pass `{ isBackfill: true }` to `reserveHistoricalSlot`.
- Do NOT set `BACKFILL_MAX_QUEUE` higher than ~8–10 without profiling; the live signal sweep needs at least 20 free slots at peak.
- If a new type of batch/background historical fetch is added (e.g., option-chain history), classify it as `isBackfill: true` to participate in the separate cap.
- Catch blocks in `fetchKiteHistoricalByToken` and `fetchKiteOiHistoricalByToken` now log `kiteErrCode` from `classifyKiteHistoricalError()` for observability; ensure that helper stays updated when Kite error response shapes change.
