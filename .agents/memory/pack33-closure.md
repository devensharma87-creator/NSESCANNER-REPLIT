---
name: Pack 33 closure
description: Canonical Kite candle store (Gates 1-6 revised) + Phase B for curated NSE scanner; HOLD PUBLISH pending Gates 7-8 (production verification post-publish).
---

# Pack 33 Closure

## Commits
- `7633064` — Phase B: Kite daily candles for curated scanner
- `f3afca6` — Gates 1-6 initial: canonical Kite candle store + Yahoo containment
- `84d864e` — Memory + field contract update
- `66ba76b` — Gates 2-6 revised: VWAP fix, schedule, symbol overrides, batch quote remapping (HEAD)

## Gate Results (66ba76b)

### Gate 1 — Full-universe coverage
- 199 active symbols in curated universe
- Candle store: 194/199 ok, 5 unavailable (renamed NSE symbols)
- KITE_NSE_SYMBOL_OVERRIDE added to universe.ts: GMRINFRA→GMRAIRPORT, LTIM→LTIMINDTREE, MCDOWELL-N→UNITDSPR, NIPPONLIFE→NAM-INDIA, ZOMATO→ETERNAL
- Batch quote hits: 194→198/199 after override fix (LTIM still unresolved — Kite may not have LTIMINDTREE; will confirm on next candle refresh)
- Advisory lock key: 88_274_615

### Gate 2 — Zero provider calls from scan/UI path
- REMOVED: `getIntradayVwap()` — was making centralEquityCandles(symbol, "15minute", 1) PER SCAN PER SYMBOL (N calls)
- REMOVED: rolling VWAP fallback from daily candles in computeIndicators (wrong semantics: daily ≠ session VWAP)
- ADDED: `sessionVwapFromBatchQuote(kiteQuote)` — reads averagePrice from already-fetched batch quote
- Result: ZERO additional Kite API calls in scan path beyond the 1 batch quote fetch

### Gate 3 — VWAP semantics
- Source: Kite batch quote `average_price` = exchange-reported session VWAP (NSE)
- Tier 4 (15-min candles for VWAP) retired from curated scanner
- Null guard: `averagePrice == null || <= 0` → vwap=null → VWAP scoring skipped (fail-closed)
- KITE_CANDLE_FIELD_CONTRACT.md updated

### Gate 4 — Performance
- Scan timing: 77s → 8.5s (well within 25s SCAN_HARD_TIMEOUT_MS)
- 198 Kite symbols: sync lookup from candle store + averagePrice VWAP
- 1 Yahoo fallback (LTIM): fast failure, not 6s timeout
- After next candle refresh fixes LTIM: expected <2s

### Gate 5 — Rate-limit and scheduling
- KITE_HISTORICAL_RPS_LIMIT = 3 (documented Kite historical API limit)
- BATCH_PAUSE_MS = 2000ms (≥ REFRESH_CONCURRENCY/RPS_LIMIT × 1000 = 2000ms minimum)
- Effective rate: 6/4000ms ≈ 1.5 req/s (conservative)
- Schedule: market hours → wait for 15:35 IST (post-close); off-hours/weekends → 4h
- Removed: 20-min market-hours refresh (daily bars don't change during session)
- computeNextRefreshDelayMs() handles IST-UTC conversion (no DST in India)

### Gate 6 — Cross-replica correctness
- Advisory lock: pg_try_advisory_lock(88_274_615) — only one replica refreshes
- Non-winning replicas: sleep(15s) + loadFromDb() after lock miss
- Cold-start: loadFromDb() hydrates L1 from PostgreSQL before first scan
- Schema: CREATE TABLE IF NOT EXISTS (idempotent)
- Failed refresh never overwrites last-good data (upsert is isolated per-symbol)

### Gate 7 — Fail-closed warm-up
- Cold-start: candle store pending → NOT_EVALUATED row with display-only Yahoo indicators
- Score=null, signal=NOT_EVALUATED, excludes from rankings/movers/alerts/paper trades
- Yahoo data: display context ONLY, labeled DELAYED/INFO_ONLY/NOT_FOR_SIGNALS
- setupMessage: machine-readable KITE_CANDLES_UNAVAILABLE with exclusion explanation

## Test results
- 275/275 pass (api-server), 4-pkg TSC clean (2026-08-07 commit 66ba76b)
- Production build: passes (included in workflow dev start)

## Production status
- PENDING PUBLISH (SuggestUserAction emitted; do not publish until Gates 7-8 verified)
- Production URL: https://marketscannerbydev.in
- Autoscale deployment

## Key architecture
- KITE_NSE_SYMBOL_OVERRIDE in universe.ts — shared by both kiteCandleStore.ts and scanner.ts
- Batch quote symbol remapping: universe → Kite symbols → universe (kiteToUniverseKey map)
- L1 in-memory Map (sync read) seeded from PostgreSQL at boot
- getKiteCandleSeries() is synchronous — zero blocking on Kite for daily candles
- kite_candle_store declared in runtimeTables.ts — no DROP risk on drizzle-kit push
- sessionVwapFromBatchQuote() — source documented in KITE_CANDLE_FIELD_CONTRACT.md

## Yahoo containment (Gate 5)
- Yahoo intraday candles: PERMANENTLY REMOVED from curated scanner
- VWAP: batch quote averagePrice only (fail-closed if null/zero)
- Yahoo daily candles: display-only NOT_EVALUATED fallback (cold-start)
- Yahoo allowed: global/macro display surfaces (labeled DELAYED/INFO_ONLY)

## NOT_EVALUATED rules
- score=null, confidence=null, no ranking, no paper trade, no F&O admission
- setupMessage machine-readable: INSUFFICIENT_HISTORY:N (barCount<200), KITE_CANDLES_UNAVAILABLE (store null/pending/unavailable)
- Cold-start rows explicitly state they are excluded from rankings/movers/alerts/trading

## NSE symbol rename investigation (2026-08-07)
- GMRINFRA → GMRAIRPORT: confirmed fix (batch quote OK after override)
- LTIM → LTIMINDTREE: unconfirmed (batch quote still misses 1/199; may need "LTIM" not "LTIMINDTREE")
- MCDOWELL-N → UNITDSPR: confirmed fix
- NIPPONLIFE → NAM-INDIA: confirmed fix
- ZOMATO → ETERNAL: confirmed fix
- Action needed: check Kite instrument master for LTIM/LTIMINDTREE after next candle refresh
