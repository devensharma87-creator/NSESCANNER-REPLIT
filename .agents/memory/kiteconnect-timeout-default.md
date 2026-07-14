---
name: KiteConnect SDK timeout is undefined by default
description: KiteConnect v5 has no default HTTP timeout; omitting it causes OS-level TCP resets (30-60s) that starve the throttle queue with ECONNABORTED retries.
---

# KiteConnect SDK timeout is undefined by default

**The rule:** Always pass `timeout: KITE_HTTP_TIMEOUT_MS` to every `new KiteConnect({ api_key, timeout: KITE_HTTP_TIMEOUT_MS })` instantiation in kiteAuth.ts.

**Why:** KiteConnect SDK v5.2.0 sets `timeout` to `undefined` by default — not 7s as one might expect. An undefined timeout lets the OS decide, which means TCP resets at 30–60s. When a historical candle request hangs for 30-60s and then fails with `ECONNABORTED`, the 30-slot throttle queue fills with backlogged retries. With 3 indices × 15+ strikes × 2 sides polling simultaneously, this starvation cascades: F&O signal sweeps can't get throttle slots → indices get 0 bars → `suppressedSummary` fires and the whole signal cycle is suppressed. The fix is a 15s hard cap (`KITE_HTTP_TIMEOUT_MS = 15_000`) that surfaces the error quickly and frees the throttle slot.

**How to apply:**
- Define `const KITE_HTTP_TIMEOUT_MS = 15_000` AFTER all import blocks in `kiteAuth.ts` (not between them — TypeScript import hoisting).
- Pass it to all three `new KiteConnect(...)` calls: `completeLogin`, `forceRefreshInstruments`, `getRestClient`.
- If a new KiteConnect instantiation is added anywhere, it must also receive this timeout.
- The constant belongs in `kiteAuth.ts` (the single file that owns all KiteConnect instantiation), not in a shared config, to keep it co-located with all three callsites.
