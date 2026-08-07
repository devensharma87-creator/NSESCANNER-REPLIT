---
name: Pack 33 closure
description: Canonical Kite candle store (Gates 1-6) + Phase B for curated NSE scanner; deployment status.
---

# Pack 33 Closure

## Commits
- `7633064` — Phase B: Kite daily candles for curated scanner (HOLD was lifted by f3afca6)
- `f3afca6` — Gates 1-6: canonical Kite candle store + Yahoo containment (HEAD)

## Gate Results
- Gate 1: kiteCandleStore.ts — 194/199 ok, 0 stale, 0 insufficient; advisory lock 88_274_615; circuit breaker; background refresh 20/60 min
- Gate 2: /api/scan/candle-store/metrics (owner-only); POST /api/scan/candle-store/refresh
- Gate 3: KITE_CANDLE_FIELD_CONTRACT.md — all indicator sources frozen
- Gate 4: score/confidence null for NOT_EVALUATED; stale warning in provenance warnings[]
- Gate 5: Yahoo VWAP fallback removed from getIntradayVwap(); zero Yahoo candle calls in Phase B
- Gate 6: 77s dev vs 359s prod (4.6× faster); zero Kite daily calls per scan; restart-safe via DB persistence

## Test results
- 6329/6329 pass, 4-pkg TSC clean (as of 2026-08-07)

## Production status
- PENDING PUBLISH (SuggestUserAction emitted)
- Production URL: https://marketscannerbydev.in
- Autoscale deployment

## Key architecture
- L1 in-memory Map (zero Kite calls on scan path) seeded from PostgreSQL kite_candle_store at boot
- getKiteCandleSeries() is synchronous — scanner never blocks on Kite for daily candles
- kite_candle_store declared in runtimeTables.ts — no DROP risk on drizzle-kit push
- Cold-start: Phase B returns null → Yahoo fallback (safe)
- Warm (after ~100s): 194/199 symbols served from Kite store

## Yahoo containment (Gate 5)
- Yahoo VWAP fallback REMOVED from getIntradayVwap() 
- If Kite 15-min candles unavailable: vwap=null (fail-closed, VWAP scoring skipped)
- Yahoo allowed ONLY in: global/macro display surfaces (labeled DELAYED/INFO_ONLY)

## NOT_EVALUATED rules (unchanged from Prompt 33 Phase B)
- score=null, confidence=null, no ranking, no paper trade, no F&O admission
- setupMessage machine-readable: INSUFFICIENT_HISTORY:N (barCount<200), KITE_CANDLES_UNAVAILABLE (store null/pending)
