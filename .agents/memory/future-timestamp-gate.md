---
name: Future-timestamp gate (B1.1-C1)
description: How the platform rejects provider timestamps that are materially in the future, and the exact tolerance/propagation path.
---

# Future-Timestamp Gate

## The Rule
Any provider timestamp more than `CLOCK_SKEW_TOLERANCE_SEC = 5` seconds in the future (relative to server clock) is classified `FUTURE_TIMESTAMP` and must never power trade decisions, paper admission, contract selection, or exit monitoring.

**Why:** The old `Math.max(0, ageSec)` clamp silently treated future timestamps as `ageSec=0` (live). A provider whose clock is hours ahead would appear fresh; a fabricated/replayed timestamp would pass. Fail-closed honesty requires explicit classification.

**How to apply:**
- `computeFreshness(asOfMs, nowMs)` in `lib/marketData/freshness.ts` is the single gate. `rawAgeSec = (nowMs - asOfMs) / 1000`. If `rawAgeSec < -CLOCK_SKEW_TOLERANCE_SEC`, returns `isFutureTimestamp: true, isStale: true, freshnessSec: null`.
- `buildMeta()` in `validator.ts` propagates `isFutureTimestamp: true` into `DataMeta` and sets `validationStatus = "stale"`.
- `fetchKiteOnly()` in `optionChainProvider.ts` checks `meta.isFutureTimestamp === true` AFTER building the meta and returns `ok: false` with reason `"FUTURE_TIMESTAMP: ..."` before entering the cache. This ensures future-stamped chains never reach the TRADE_GRADE consumer path.
- `CLOCK_SKEW_TOLERANCE_SEC` is derived from `clockDrift.ts` `DRIFT_ALERT_MS = 1000 ms` plus symmetric provider-side drift and network latency buffer.

## Test coverage
`src/lib/marketData/b1.canonical.test.ts` §B1.1-C1: 13 boundary tests covering the pure function (injected clock) and production fail-closed paths (mocked `fetchKiteOptionChain`).

## Boundary semantics
- `rawAgeSec >= -CLOCK_SKEW_TOLERANCE_SEC` → within tolerance, accepted (clamped to 0 for display).
- `rawAgeSec < -CLOCK_SKEW_TOLERANCE_SEC` → rejected, `isFutureTimestamp=true`.
- The boundary is **exclusive** (`< -TOLERANCE`, not `<=`), meaning a timestamp exactly `TOLERANCE` seconds in the future is accepted. One unit beyond is rejected.
