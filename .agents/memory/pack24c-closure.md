---
name: Pack 24C closure
description: Fixture harness rebuild + 4 missing visual routes + 59 new tests; scanner 1112/api-server 5603; accepted 2026-08-05.
---

## Pack 24C — Final Acceptance Closure

**Date:** 2026-08-05  
**Why:** Gate B required 4 routes with screenshots at 3 viewports; all had fixture shape mismatches causing page crashes.

### Key fixture shape corrections (non-obvious)

1. **StockDetail** — endpoint returns nested `{ profile, quote, indicators, recommendation, financials, holdings, news }`, NOT a flat object. `quote.changePercent` (not `changePct`). Component crashes if `quote` is undefined.

2. **news endpoint** — `GET /api/news` returns `NewsItem[]` directly (plain array), NOT `{ items: [], total: N }`. Component uses `(news ?? []).map(...)` which fails when news is an object.

3. **ChartCandlesResponse** — must include `symbol, segment, timeframe, source, fresh, asOf` (top-level) + `candles: { t: number (epoch seconds), o, h, l, c, v? }[]`. Old fixture had `candles: []` with no metadata.

4. **PortfolioListResponse** — `{ items: PortfolioSummary[] }`, NOT a bare array.

5. **Portfolio by ID** — must be intercepted with a regex BEFORE the general `/api/portfolios` pattern, or the general catch will serve it.

6. **resolveProvenanceState** — accepts `{ source?, stale?, sourceHealthy?, isLive? }` ONLY. The `delayed`, `canDriveSignals`, `asOf`, `warnings`, `missingSymbols` fields are NOT part of the type — they exist only in API response shapes, not in the component's input.

7. **DataStatePanel** — `label` prop does NOT exist; use `title?` or `sourceName?` or `missingItems?`.

### How to apply

- Before writing fixtures for any new page, check `lib/api-zod/src/generated/types/` for the exact response type. Never assume a flat object.
- When interceptor fixture is a `data` object, verify it matches the API client hook's return type in `lib/api-client-react/src/generated/api.schemas.ts`.
- More specific URL patterns must appear BEFORE general patterns in the FIXTURES array.

### Final test counts
- `@workspace/scanner`: 1112 / 49 files
- `@workspace/api-server`: 5603 / 257 files
- 4-pkg TSC: all clean
