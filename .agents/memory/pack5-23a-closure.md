---
name: Pack 5 23A closure
description: Prompt 23A production wiring — 6 gates completing deferred Pack 5 items; gate A–F all closed; 75 new tests; floors passed.
---

## Summary

Pack 5 left 3 deferred gates. Prompt 23A added 3 more. All 6 closed 2026-08-04.

## Gate A — Upstox Authentication Mode
- `UpstoxAuthMode = "ANALYTICS_TOKEN" | "STANDARD_DAILY_TOKEN" | "NOT_CONFIGURED"` in `upstoxClient.ts`
- `UPSTOX_ANALYTICS_TOKEN` preferred; `UPSTOX_ACCESS_TOKEN` fallback; mode in `UpstoxConfig.authMode`
- Error messages never mention env var names
- Existing tests updated: all inline `UpstoxConfig` objects need `authMode` field
- Existing `IndianApiConfig` objects need `plan` field too (same prompt)

## Gate B — Instrument Mapping (BOD Cache)
- New `marketData/upstoxInstrumentMap.ts` (~520 lines)
- Static index bootstrap: NIFTY/^NSEI, BANKNIFTY/^NSEBANK, SENSEX, NIFTYMIDCAP100 always available without BOD cache
- ISIN-based equity mapping via BOD cache; NSE wins over BSE for same ISIN (dedup rule)
- Derivative key: `segment:underlying:expiry:strike:optionType` composite key
- `isValidInstrumentRow()` must run in BOTH the isinSeen loop AND the final mapping loop — missed one pass caused a runtime crash on schema-invalid rows in tests
- Test seams: `__setInstrumentMapForTests(cache | null)`, `__resetInstrumentMapForTests()`, `__buildCacheForTests(rows, ts)`
- `shadowDispatch.ts` removed static 5-symbol STATIC_INDEX_MAP; now uses `resolveInstrumentKey`
- Dedup window: `shouldDispatch()` 15s single-flight per symbol; `__resetShadowDispatchForTests()` exported

## Gate C — Router Wiring
- `dispatchShadowQuote(sym, quote)` after Kite result in `getEquityQuote`, `getIndexQuote`
- `dispatchShadowCandles(sym, series, interval, from, to)` after canonical series in `getEquityCandles`
- Always fire-and-forget (no `await`); canonical result never mutated by dispatch

## Gate D — IndianAPI Host Allowlist
- `INDIANAPI_HOST_ALLOWLIST = Set(["api.indianapi.in", "api2.indianapi.in"])`
- `detectIndianApiPlan(url)` → INDIVIDUAL / ENTERPRISE / UNKNOWN
- `resolveIndianApiConfig()` rejects non-allowlisted hosts, falls back to default (no crash)
- Added `"rate_limited"` to `IndianApiErrorKind` (distinct from existing `"rate_limit"` which is transient/retry)
- `IndianApiConfig.plan: IndianApiPlan` is now a required field

## Gate E — Fundamentals API / Client / UI
- Route: `artifacts/api-server/src/routes/fundamentals.ts` → `GET /data/fundamentals/:symbol`
- Mounted in `routes/data.ts` via `router.use(fundamentalsRouter)` under existing `requireOwner` middleware
- NOT_CONFIGURED → HTTP 200 with `providerState: "NOT_CONFIGURED"` (never 500)
- `meta.notForSignals = true`, `meta.notForTradeDecisions = true` always set
- OpenAPI: `StockFundamentals` schema in `lib/api-spec/openapi.yaml`; `getStockFundamentals` operation
- Types: `lib/api-zod/src/generated/types/stockFundamentals.ts`; exported from `lib/api-zod/src/index.ts`
- api-client-react: types in `api.schemas.ts`; hook+URL in `api.ts` (appended manually, not regenerated)
- `@workspace/api-client-react` cannot be imported inside api-server test context; use `fs.readFile` on source files instead
- Relative path from `artifacts/api-server/src/lib/` to workspace root: use `../../../../` (4 levels up, not 6)
- UI: `artifacts/scanner/src/components/fundamentals-card.tsx`; fundamentals tab in `stock-detail.tsx`

## Gate F — Cross-Tab Parity Tests
- All structural tests use `fs.readFile` to read source files (no @workspace/api-client-react import in api-server)
- Use `../../../../` relative path from test files to reach workspace root

## Closing Floors
- api-server: 5,427 (+75 from this prompt)
- scanner: 947 (unchanged)
- 5-pkg TSC: all clean
- Evidence file ends with: `END_FAST_TRACK_PACK_5_PRODUCTION_WIRING_AND_CANONICAL_CONSUMPTION_CLOSURE`

**Why:** Document the relative path trap (6 vs 4 levels), the missing isValidInstrumentRow in second loop, and the api-server/api-client-react import isolation — all caused silent failures during the run.
