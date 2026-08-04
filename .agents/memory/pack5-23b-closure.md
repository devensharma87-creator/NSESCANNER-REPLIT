---
name: Pack 5 23B Closure
description: Fast-Track Pack 5 23B — IndianAPI host contract & runtime parity final closure; supersedes 23A rejection.
---

## Pack 5 Prompt 23B — IndianAPI Host Contract & Runtime Parity

### Why 23A Was Rejected
`api.indianapi.in` / `api2.indianapi.in` used in allowlist — not documented plan hosts. Invented `/stock_ratios` endpoint. Silent fallback. No real handler tests.

### Key Decisions

**Correct plan→host mapping** (INDIANAPI_PLAN_HOST):
- FREE / HOBBY → `stock.indianapi.in`
- DEVELOPER → `dev.indianapi.in`
- GROWTH_ANALYST → `analyst.indianapi.in`
- PRO → `pro.indianapi.in`

**Why:** These are the only documented hosts. `api.indianapi.in` is not documented.

**Single endpoint:** Only `/stock?name=` is documented. `getStockRatios` / `getStockProfile` both extracted from one `getStock()` call.

**resolveIndianApiConfig()** rejects with `INVALID_PROVIDER_CONFIG` (no fallback). Empty `INDIANAPI_PLAN` env → defaults to FREE (falsy check, not `??`).

**resolveState() fix:** not-implemented → `baseStateIfOk` (NOT_CONFIRMED), NOT `NOT_ENTITLED`. Plan entitlement checked only for implemented features.

**indianApiHealth()** used in route handler instead of importing `resolveIndianApiConfig` directly (it's not re-exported from provider).

**validateIndexBootstrap()** on `upstoxInstrumentMap.ts`: scans BOD by tradingSymbol (not isIndex-filtered first pass), then classifies as UNCHANGED/CHANGED/MISSING/AMBIGUOUS/WRONG_SEGMENT. Read-only — no side effects on resolveInstrumentKey.

### Test Battery
- New: p23b5 (37), p23b6 (32), p23b7 (17), p23d2-replaced (25), p23d3 (9), p23e2 (14), p23f2 (15), p23b-updated (21) = 170 new tests
- api-server: 5,562 passed (floor was 5,427); TSC 5-pkg clean; scanner clean
- ACCEPTED 2026-08-04

### Watch-outs for Future Work
- `Response` name collision: Express `Response` vs Web API `Response` in test files — use `globalThis.Response` for fetch mocks and `as unknown as typeof fetch` for fetchImpl type casts.
- `__setIndianApiClientForTests` accepts partial mock object (only config + getStock needed).
- Arrow functions with `{...} as X` need parentheses: `(async () => {...}) as X`.
