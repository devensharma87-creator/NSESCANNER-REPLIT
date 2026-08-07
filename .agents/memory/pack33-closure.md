---
name: Pack 33 closure
description: NOT_EVALUATED signal for Indian equity scanner rows lacking Kite candle analytics; Zod + TypeScript + UI changes; 6294 tests pass.
---

## Summary
Prompt 33 implemented the NOT_EVALUATED scanner trust-guard.

## What changed

### New Signal value
- `Signal.NOT_EVALUATED` added to all 3 type locations:
  - `lib/api-zod/src/generated/types/signal.ts`
  - `lib/api-client-react/src/generated/api.schemas.ts`
  - `lib/api-zod/src/generated/api.ts` (all 9 recommendation `signal: zod.enum([...])` blocks + `ListStocksQueryParams`)

### Recommendation.score + confidence → nullable
- `Recommendation.score: number | null` and `confidence: number | null` in all 3 type locations.
- All 10 `score: zod.number().describe("-100 to 100")` Zod blocks → `.nullable()`.
- All 9 `confidence: zod.number().describe("0 to 100")` Zod blocks → `.nullable()`.

### api-server: scanner logic
- `fullNseScanner.ts`: `NOT_EVALUATED_RECOMMENDATION` constant; `rowFromKiteOnly` + `rowFromKitePlusIndicators` return it instead of calling `buildRecommendation`.
- `scanner.ts` (curated): same NOT_EVALUATED inline constant replaces `buildRecommendation`.
- `scanner.ts` (routes): all `.score` arithmetic guards with `?? -Infinity` / `?? 0`; `/scan/top` filters `score != null`; signal allowlist includes `NOT_EVALUATED`.
- `marketTrend.ts`: avgScore excludes null-score rows; topPick sort uses `?? -Infinity`.
- `preMarket.ts`: top-pick sort uses `?? -Infinity`.
- `kiteFnoInstruments.ts`: NFO 3-second retry when nfo=0 on cold boot while BFO > 0.
- `swingSignals.ts`: `SwingSignal.score` type changed to `number | null`.

### Scanner UI (artifacts/scanner)
- `signal-badge.tsx`: NOT_EVALUATED → "NOT EVALUATED" badge in muted style.
- `score-bar.tsx`: accepts `number | null`; null renders em-dash + empty bar.
- `deep-scan.tsx` ScannerSnapshot: local signal type includes NOT_EVALUATED; score nullable.
- `index-detail.tsx`: score null guards.
- `scanner.tsx`: score sort uses `?? -Infinity`; ScoreBar passed `score` (now accepts null).
- `sector-detail.tsx`, `stock-detail.tsx`: ScoreBar called with nullable score.

### Tests
- `src/lib/p33.notEvaluated.test.ts`: 26 tests, 8 gates (A–H).
- Full suite: 274 files / 6294 tests (all PASS).

## Verification (dev)
- api-server restarted: nfo:33421, bfo:4317, total:37738.
- First option-snapshot tick: rows:252, ok:3, src:kite.
- `/api/scan/full-nse?limit=3` with auth: all rows `signal=NOT_EVALUATED score=None confidence=None`.

## Status
DEV: VERIFIED ✓  
PRODUCTION: PENDING PUBLISH — new code must be published to take effect in production.  
Pack 9A canary (Prompt 31): PENDING — run after production publish confirms NOT_EVALUATED live.

**Why this matters:** Without this guard, Yahoo-derived indicators were producing fabricated base-50 ± changePct numeric scores on 2412 Indian equity rows, falsely implying trade-grade signal quality. After this fix, all Indian equity rows are NOT_EVALUATED until Phase B (Kite candle warehouse) is live.
