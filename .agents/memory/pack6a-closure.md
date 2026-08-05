---
name: Pack 6A closure
description: Actual route implementation and visual QA closure for Pack 6 primitives — fixture harness, route integration, 21 tests, authenticated screenshots.
---

# Pack 6A — Actual Route Implementation and Visual QA Closure

**Status:** COMPLETE (2026-08-05)

## What was done
- Dev fixture harness added to both LoginGate components (`import.meta.env.DEV && VITE_PREVIEW_BYPASS === "true"`)
- `VITE_PREVIEW_BYPASS=true` set as development env var (non-secret; prod safety from `import.meta.env.DEV=false` at build time)
- DataStatePanel ERROR wired into scanner/watchlist.tsx (replaced inline error text)
- DataStatePanel ERROR wired into global/Screener.tsx (replaced inline error card)
- DataProvenanceBadge + DataStatePanel ERROR wired into global/InstrumentDetail.tsx (replaced inline source text + card)
- 21 Gate F route-integration tests: `p6a.routeIntegration.test.tsx` (all pass)
- 9 authenticated screenshots: dashboard LOADING, screener EMPTY_VALID, mobile responsive, AppShell visible past auth wall
- Evidence file updated with terminator line

## Closing floors
- Scanner: 1032/1032 (+21)
- Api-server: 5603/5603

## Key constraint
- `import.meta.env.DEV` is the ONLY production safety for the fixture harness; the env var VITE_PREVIEW_BYPASS is irrelevant in prod because the branch is dead code

**Why:** Pack 6 was rejected because primitives were never wired into production routes; this task completed that wiring.
