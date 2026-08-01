---
name: B2.1 Core UI data-state accuracy
description: 9 UI data-state defects fixed across global and scanner apps; key patterns for null-safety, provenance badging, and test strategy.
---

## Rule
All user-facing surfaces must distinguish: loading / live / delayed / stale / partial / unavailable / error / closed.
Never use `?? 0` on a missing numeric data field — it fabricates a value that implies real data arrived.

## Defects fixed (B2.1, 2026-08-01)
- **D1/D4** `changePct ?? 0 >= 0` classified null change as UP/green. Fixed: `hasChange` guard before any directional colour.
- **D2/D5** No `isError` branch on Dashboard + Watchlist — failure appeared as "loading" or empty. Fixed: explicit `isError` card with message.
- **D3** Dashboard `staleTime` defaulted to 0 (re-fetched on every render). Fixed: `staleTime: 25_000, retry: 1`.
- **D6** StatusStrip `equity ?? 0` / `index ?? 0` presented missing universe counts as zero. Fixed: `?? "?"`.
- **D7** StatusStrip `if (!data) return null` conflated loading and empty. Fixed: `isLoading` → pulse-text loading state.
- **D8** Scanner watchlist breadth `changePercent ?? 0` inflated "unchanged" bucket with null rows. Fixed: null rows excluded from all directional counts; `noChangeData` tracked and shown.
- **D9** Scanner coverage `failures ?? 0` fabricated "0 failures" when metadata absent. Fixed: `null` when metadata absent; "…" shown.

## New shared component
`artifacts/global/src/components/ui/DataProvenanceBadge.tsx`
- `resolveDataDisplayState({ source, stale, sourceHealthy })` → `"LIVE"|"DELAYED"|"STALE"|"UNAVAILABLE"|"UNKNOWN"`
- Yahoo sources (`yahoo`, `yahoo-fx`, `yahoo-equity`, `yahoo-index`) always → `DELAYED`, never `LIVE`. Matches B1.1 restriction list.

## Test pattern
`artifacts/api-server/src/lib/b2.uiState.test.ts` — 42 pure-function tests.
Pattern: replicate the pure helper inline in the test file; import only from `lib/marketData/*` (no live providers, no DB).
Zero `.skip`, `.only`, DB calls, or network calls.

**Why:** Pure-function tests are stable and fast; they catch the category of bug (fabricated direction, fabricated zero) without needing browser DOM or a running server.

## How to apply
Before any new field renders in JSX: check `??` usage — if the field is nullable, what does the UI show when it's null? "0", "false", and "" are all often wrong. "—" or "?" or omitting the cell is always honest.
