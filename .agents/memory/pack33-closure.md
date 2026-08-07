---
name: Pack 33 closure — Canonical Kite Candle Store (full 9 gates)
description: Candle store implementation: 9 gates PASS; commit f5bd468; HOLD PUBLISH active (Gate 9 pending).
---

## Status
All 9 gates implemented and verified. HOLD PUBLISH directive active — do not publish until owner signs off on Gate 9 (Phase A/B deployment).

## Gate verdicts

| Gate | Topic | Status | Evidence |
|------|-------|--------|---------|
| G1 | Universe breakdown | PASS | 199 active (PEL inactive); candle store 194 ok / 5 unavailable pre-fix; post-fix all 199 ok |
| G2 | ISIN-free symbol resolver | PASS | validateKiteSymbolOverrides(); LTIM→LTM (was wrong LTIMINDTREE); INSTRUMENT_IDENTITY_UNRESOLVED fail-closed |
| G3 | ATP naming + provenance | PASS | getKiteSessionAtp(); KITE_SESSION_AVERAGE_TRADED_PRICE in provenance; KITE_SESSION_ATP_POLICY.md |
| G4 | True token-bucket | PASS | KiteHistoricalTokenBucket; 3 req/s rolling; acquire()+reportRateLimit(); 13 timing tests PASS |
| G5 | Refresh modes | PASS | RefreshMode: FULL/INCREMENTAL/FAILED_RETRY/INSTRUMENT_CHANGE; getSymbolsForMode(); smart scheduler |
| G6 | Cross-replica correctness | PASS | 30 unit tests; lock winner/loser/hydration/last-good/never-empty |
| G7 | Input completeness | PASS | 42 unit tests; all mandatory inputs × all states |
| G8 | Full battery | PASS | api-server 277 files / 6395 tests; scanner 52 files / 1250 tests; 4-pkg TSC clean; both prod builds |
| G9 | Staged deployment | PENDING | Phase A (population only) → Phase B (evaluated output) after publish |

## Test counts (commit f5bd468)
- api-server: **277 files / 6395 tests** (was 6329 before new Gate 6/7/8 tests; +66 new tests)
- scanner: **52 files / 1250 tests**

## Key implementation facts
- **LTIM → LTM** (not LTIMINDTREE): verified via NFO future LTM26AUGFUT where name='LTM'
- **Advisory lock key**: `ADVISORY_LOCK_KEY = 88_274_615`
- **centralKiteNseEqInstruments**: re-exported from marketData/compat (NOT direct kiteScanner import — burn-down rule)
- **Token bucket capacity**: 3 tokens (1 second worth), refill=3/s; no BATCH_PAUSE_MS
- **RefreshMode default**: FULL for manual; INCREMENTAL post-close weekdays; FAILED_RETRY off-hours
- **Instrument validation**: done at every refresh cycle start; UNVERIFIED is non-fatal (cache unavailable)
- **VWAP/ATP**: optional (weight=10/~119); null → VWAP rule skipped, NOT NOT_EVALUATED

## New files
- `KITE_SESSION_ATP_POLICY.md` — ATP policy document
- `artifacts/api-server/src/lib/kiteCandle/tokenBucket.ts` — KiteHistoricalTokenBucket class + singleton
- `artifacts/api-server/src/lib/kiteCandle/tokenBucket.test.ts` — 13 rate-limiter tests (Gate 4)
- `artifacts/api-server/src/lib/kiteCandle/kiteCandleStore.g6g7.test.ts` — 72 cross-replica + input completeness tests

## Modified files
- `artifacts/api-server/src/lib/universe.ts` — LTIM→LTM; validateKiteSymbolOverrides() added
- `artifacts/api-server/src/lib/scanner.ts` — getKiteSessionAtp(); provenance ATP source; sessionAtp var
- `artifacts/api-server/src/lib/kiteCandle/kiteCandleStore.ts` — RefreshMode, getSymbolsForMode,
  runKiteCandleRefresh(mode), token bucket integration, instrument validation, extended metrics

## Gate 9 (pending)
Phase A: deploy with kite_candle_store populated but NOT_EVALUATED output (scanner disabled)
Phase B: enable evaluated output after verifying production metrics (okCount, ATP coverage, timing)
