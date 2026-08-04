---
name: Pack 5 canonical provider integration closure
description: Upstox shadow + IndianAPI reference providers implemented; test counts; shadow non-interference invariants; activation path.
---

## Pack 5 Closure (2026-08-04)

### What shipped
- `shadowState.ts` — ring-buffer parity sampling, `fireShadow()` fire-and-forget dispatcher, `assertCanonicalUnchanged()`
- `upstoxClient.ts` — V2 bearer auth, circuit breaker (5-fail/30s), 15s timeout, typed errors
- `indianApiClient.ts` — x-api-key, retry, typed errors
- `upstoxProvider.ts` — shadow facade, parity sampling, test seam `__setUpstoxClientForTests`
- `indianApiProvider.ts` — reference data, capability manifest, test seam
- `shadowDispatch.ts` — `dispatchShadowQuote` / `dispatchShadowCandles` (fire-and-forget, non-blocking)
- `routes/providerDiagnostics.ts` — 4 owner-only endpoints (diagnostics, shadow-parity, indianapi/capabilities, probe)
- 70 new tests (p23a–d); b1.canonical C2-07 + T13 updated for UNSUPPORTED semantics

### Test counts after Pack 5
- api-server: **5,352 / 5,352** (5,282 floor + 70 new)
- scanner: **947 / 947** (unchanged)
- TSC: 5-package clean

### Shadow non-interference invariants (MUST hold forever)
1. `fireShadow()` is fire-and-forget — caller never awaits it
2. Shadow has a timeout (default 5s) — slow shadow never blocks canonical
3. Shadow errors are swallowed — canonical result always returned
4. No averaging / no substitution of shadow values into canonical
5. `promotionEligible = false` hardcoded — promotion requires explicit owner action
6. No direct upstox/indianapi imports in scanner or global client bundles

**Why:** Pack 5 rule: shadow must be provably non-interfering before any promotion path is opened.

**How to apply:** Any future code touching `dispatchShadowQuote` or `shadowFetchQuote` must re-run P23C tests and confirm `assertCanonicalUnchanged` still holds.

### Activation path (credential-gated)
- Set `UPSTOX_ACCESS_TOKEN` → `isUpstoxConfigured()=true`, shadow dispatches fire for static-mapped symbols (NIFTY/BANKNIFTY/SENSEX)
- Set `INDIANAPI_API_KEY` → `getStockProfile`/`getStockRatios` operational; meta always `notForSignals=true`
- Promotion: requires explicit owner action + future pack; never automatic

### Known gaps (follow-on)
- Static instrument key mapping only (NIFTY/BANKNIFTY/SENSEX); full equity CSV mapping deferred
- Router integration (`dispatchShadowQuote` in `getEquityQuote`) not auto-wired; available as call site
- Parity ring buffer is in-memory only; DB-backed store deferred
