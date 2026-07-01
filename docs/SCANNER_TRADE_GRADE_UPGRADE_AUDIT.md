# SCANNER TRADE-GRADE UPGRADE FEASIBILITY AUDIT

**Date:** 2026-07-01  
**Status:** PHASE A SHIPPED — Kite batch-quote price overlay live  
**Preconditions accepted:**
- `SCANNER_DEEP_SCAN_DATA_ACCURACY_PROD_VERIFIED`
- `CANONICAL_MARKET_DATA_HEALTH_PROD_VERIFIED`
- `HOME_MARKET_PULSE_DATA_ACCURACY_PROD_VERIFIED`

**Phase A delivery (2026-07-01):**
- `scanner.ts`: pre-fetches `centralBatchEquityQuotes()` before scan loop; `quoteFromChart()` uses Kite batch price/OHLC/prevClose/volume when available; falls back gracefully to Yahoo meta / WebSocket tick.
- `scannerProvenance.ts`: `kitePriceOverlay?: boolean` added to `BuildSourceProvenanceInput` + `SourceProvenance`; threaded through all three return paths.
- `scannerSourceHealth.ts`: `kitePriceRows` counter; `KITE_PARTIAL` branch fires before `YAHOO_INFO_ONLY` when batch overlay rows are present.
- `lib/api-spec/openapi.yaml`: `ScannerRowProvenance.kitePriceOverlay` (boolean, required) added + codegen regenerated.
- `providerImportAllowlist.json`: added `dailyReports.ts`, `marketDataHealth.ts`, `optionSignals.ts` as pre-existing burn-down entries (not introduced by Phase A).
- Tests: 7 new Phase A tests in `scannerSourceHealth.test.ts` (Tests 19–25). All 36 targeted + 749 scanner frontend + full typecheck green.
- **Signal source unchanged**: `provider: "yahoo"`, `canDriveSignals: false`. Phase B (candle warehouse) needed for full trade-grade promotion.

---

## 1. Executive Summary

The curated NSE scanner is 100% Yahoo-signal today: all technical indicators (EMA, RSI, MACD, ATR, ADX, VWAP, support/resistance, volume profile, pivots) are computed from 6-month Yahoo Finance daily candles. A live Kite LTP overlays the **price** only, but never promotes the indicator-derived **signal** to trade-grade. The scanner is correctly labeled `YAHOO_INFO_ONLY`.

Upgrading to a reliable Kite-first trade-grade scanner is **technically feasible** and **recommended** in two ordered phases:

1. **Phase A (immediate, low-risk):** Kite batch-quote scanner — replace the Yahoo chart-based LTP/OHLC/volume fetch with a single Kite REST batch call covering all 280 curated symbols in ~1 second. Indicators remain Yahoo-derived (still `YAHOO_INFO_ONLY`) but price data is now Kite-authoritative.

2. **Phase B (planned, moderate effort):** Candle warehouse scheduler for the curated universe — add a nightly post-market job that fetches Kite daily candles for all 280 symbols and stores them in the candle warehouse. Re-wire `buildRow()` to read from the warehouse instead of live Yahoo. Once all indicator inputs are Kite-derived, scanner rows qualify as `KITE_PARTIAL` or `KITE_TRADE_GRADE`.

**Do not** attempt full intraday Kite candle fetching on demand — the 2.5 req/s throttle means 280 symbols × 400ms = 112 seconds, far beyond the 25s scan hard-timeout.

---

## 2. Current Scanner State

### 2.1 Architecture

```
GET /api/stocks
  → routes/scanner.ts
  → scanner.ts (scanAll / performScan)
  │
  ├── getHistory(symbol, "6mo")             [Yahoo Finance REST — ~15min delayed daily bars]
  │    └── fetchChart(symbol, "6mo")
  │         └── analyticsYahoo.ts
  │
  ├── centralLiveQuote(symbol)              [Kite WebSocket tick — price/OHLC/volume overlay]
  │    └── kiteFeed.ts (getLiveQuote)
  │
  ├── getIntradayVwap(symbol)               [Kite 15min candles → sessionVwap]
  │    └── centralEquityCandles(symbol, "15minute", 1)
  │         └── kiteIntraday.ts
  │    └── Yahoo fallback: fetchIntraday()
  │
  ├── getDeliveryPct(symbol)               [NSE bhavcopy — real EOD reference]
  │    └── marketData/referenceData.ts
  │
  ├── computeIndicators(chart, quote, vwap) [pure math on Yahoo daily bars]
  │    └── indicators.ts (ema, rsi, atr, adx, macd, vwap, supportResistance, pivots, volumeProfile)
  │
  ├── buildRecommendation(...)             [scoring on indicator outputs]
  │    └── scoring.ts
  │
  └── buildSourceProvenance({provider:"yahoo"})  ← SIGNAL SOURCE IS YAHOO, always
       → rowSource: {sourceStatus: "YAHOO_INFO_ONLY", canDriveSignals: false, canDriveTradeAlerts: false}
```

### 2.2 Key Parameters

| Parameter | Value |
|---|---|
| Curated universe | ~280 NSE stocks (universe.ts) |
| Scan concurrency | 6 workers |
| Scan cache TTL | 60s |
| Hard scan timeout | 25s (partial cache on timeout) |
| History fetch | Yahoo 6mo daily candles per symbol |
| Signal source | Always Yahoo (labelled, never promoted by Kite LTP) |
| Current status | `YAHOO_INFO_ONLY` — `canDriveSignals = false` |

### 2.3 Deep Scan

```
GET /api/deep-scan/:symbol
  → deepscan.ts
  → fetchChart(yahooTicker, "6mo")     [Yahoo daily — ~15min delayed]
  → fetchFundamentals(yahooTicker)     [Yahoo fundamentals]
  → buildSourceProvenance({provider:"yahoo"})
```

Deep Scan supports ~2,486 NSE symbols + 23 indices (via bhavcopy + UNIVERSE fuzzy search). Fully Yahoo-sourced. Status correctly set to `"delayed"` as of 2026-07-01 fix.

---

## 3. Field-by-Field Data Inventory

| Field | UI Usage | Scoring Usage | Source Today | Freshness | Kite Available | Needs Candle History | Needs DB Storage | Info-Only | Risk if Used for Trading |
|---|---|---|---|---|---|---|---|---|---|
| `symbol` | Identity | Key | Universe (curated) | Static | ✅ via instrument master | No | No | No | None |
| `name` | Display | No | Universe / Kite instrument name | Static/24h | ✅ Kite instrument master | No | No | No | None |
| `sector`, `industry` | Display, filter | Sector RS gate | Universe (curated) | Static | ❌ Not from Kite | No | No | No | None |
| `exchange` | Display | No | Yahoo meta / hardcoded "NSE" | Static | ✅ Kite instrument master | No | No | No | None |
| `price` (LTP) | Price display | Score inputs | **Kite WebSocket tick** (Yahoo fallback) | Real-time / 15min delayed | ✅ Real-time | No | No | ⚠️ Only when Kite offline | HIGH if Yahoo-only |
| `change`, `changePercent` | Momentum display | Scoring | Derived: price − prevClose | Same as price + prevClose | Derived | No | No | ⚠️ prevClose is Yahoo | LOW if prevClose is Kite |
| `open` | OHLC display | Some scoring rules | Kite tick OHLC (Yahoo fallback) | Same as LTP | ✅ Kite batch quote | No | No | ⚠️ Only when Kite offline | LOW |
| `high` | OHLC display | Scoring | Kite tick OHLC (Yahoo fallback) | Same as LTP | ✅ Kite batch quote | No | No | ⚠️ Only when Kite offline | LOW |
| `low` | OHLC display | Scoring | Kite tick OHLC (Yahoo fallback) | Same as LTP | ✅ Kite batch quote | No | No | ⚠️ Only when Kite offline | LOW |
| `previousClose` | Change calc | Score calc | **Yahoo chart** (last daily bar) | ~15min delayed EOD | ✅ Kite batch quote OHLC.close field | No | No | ✅ YES | HIGH — drives changePct |
| `volume` | Display | Volume ratio | Kite tick volume (Yahoo fallback) | Same as LTP | ✅ Kite batch quote | No | No | ⚠️ Only when Kite offline | MEDIUM |
| `avgVolume` | Display | Volume ratio | **Yahoo chart** 20-day average | Daily EOD | ✅ Kite daily candles | ✅ Yes — 20+ daily bars | ✅ Yes (warehouse) | ✅ YES | MEDIUM — drives volume spike rule |
| `volumeRatio` | Volume spike | Scoring | Derived: volume / avgVolume | Same as volume + avgVolume | Derived | Derived | No | ✅ if avgVolume is Yahoo | MEDIUM |
| `fiftyTwoWeekHigh` | Display | No | **Yahoo meta** | ~15min delayed | ❌ Not in Kite batch quote | ✅ Yes — 52 weeks daily | ✅ Yes (warehouse) | ✅ YES | LOW (display only) |
| `fiftyTwoWeekLow` | Display | No | **Yahoo meta** | ~15min delayed | ❌ Not in Kite batch quote | ✅ Yes — 52 weeks daily | ✅ Yes (warehouse) | ✅ YES | LOW (display only) |
| `VWAP` (intraday) | Key indicator | Scoring | **Kite 15min** (Yahoo fallback) | 30s max staleness | ✅ Already Kite | ✅ Yes — session bars | No (in-memory) | ⚠️ Only when Kite offline | HIGH when used for signal |
| `EMA9`, `EMA21` | Trend display | EMA crossover | **Yahoo 6mo daily** | ~15min delayed EOD | ✅ Kite daily candles | ✅ Yes — 100+ daily bars | ✅ Yes (warehouse) | ✅ YES | HIGH — drives crossover signal |
| `EMA20`, `EMA50` | Trend display | Core scoring | **Yahoo 6mo daily** | ~15min delayed EOD | ✅ Kite daily candles | ✅ Yes — 200+ daily bars | ✅ Yes (warehouse) | ✅ YES | HIGH — drives trend/HTF gate |
| `EMA100`, `EMA200` | Trend display | HTF bias | **Yahoo 6mo daily** | ~15min delayed EOD | ✅ Kite daily candles | ✅ Yes — 400+ daily bars (need ~2y) | ✅ Yes (warehouse) | ✅ YES | HIGH — drives HTF bias |
| `RSI14` | Momentum | RSI scoring rule | **Yahoo 6mo daily** | ~15min delayed EOD | ✅ Kite daily candles | ✅ Yes — 30+ daily bars | ✅ Yes (warehouse) | ✅ YES | MEDIUM |
| `MACD`, `MACDSignal`, `MACDHist` | Momentum | MACD crossover | **Yahoo 6mo daily** | ~15min delayed EOD | ✅ Kite daily candles | ✅ Yes — 60+ daily bars | ✅ Yes (warehouse) | ✅ YES | MEDIUM |
| `ATR14` | Risk sizing | Stop placement | **Yahoo 6mo daily** | ~15min delayed EOD | ✅ Kite daily candles | ✅ Yes — 30+ daily bars | ✅ Yes (warehouse) | ✅ YES | HIGH — drives stop sizing |
| `ADX14` | Trend strength | Trend filter | **Yahoo 6mo daily** | ~15min delayed EOD | ✅ Kite daily candles | ✅ Yes — 60+ daily bars | ✅ Yes (warehouse) | ✅ YES | MEDIUM |
| `trendStrength` | Display | No | Derived: EMA20/EMA50 stack | Same as EMA | Derived | No | No | ✅ if EMA is Yahoo | LOW (display only) |
| `supportLevel`, `resistanceLevel` | Display | Scoring | **Yahoo 6mo daily** (40-bar H/L) | EOD | ✅ Kite daily candles | ✅ Yes — 40+ daily bars | ✅ Yes (warehouse) | ✅ YES | HIGH — drives S/R scoring rules |
| `pivot`, `r1`, `s1` | Display | Scoring | **Yahoo chart** (prev day OHLC) | EOD | ✅ Kite daily candles (prev session) | ✅ Yes — 2 daily bars | ✅ Yes (warehouse) | ✅ YES | HIGH — drives pivot scoring rule |
| `pointOfControl`, `valueAreaHigh/Low` | Display | VP scoring | **Yahoo 6mo daily** (60-bar VP) | EOD | ✅ Kite daily candles | ✅ Yes — 60+ daily bars | ✅ Yes (warehouse) | ✅ YES | MEDIUM |
| `deliveryPct` | Display | Delivery confirmation | **NSE bhavcopy** (official EOD) | EOD — REAL | ✅ Official NSE reference | No | No | ⚠️ EOD only | LOW — EOD reference is the official source |
| `score`, `confidence`, `signal` | Action label | Drive paper trades | Derived from all above | Same as indicator inputs | Derived | No | No | ✅ YES (all inputs Yahoo today) | CRITICAL — currently demoted |
| `entryQuality`, `stopLoss`, `target` | Action card | Block/allow entry | Derived from ATR, S/R | Same as ATR + S/R | Derived | No | No | ✅ YES | HIGH |
| `provenance` | Source badge | Trust gate | Built from signal source | Same as signal source | N/A | No | No | N/A | N/A |
| `rowSource` | Banner + consumer gate | `canDriveSignals`, `canDriveTradeAlerts` | Derived from provenance | Same | N/A | No | No | N/A | N/A |

**Signal source bottleneck:** The single blocker preventing trade-grade rows is the Yahoo daily candle dependency for all indicator inputs. Switching to Kite daily candles (candle warehouse) resolves it.

---

## 4. Kite Capability Matrix

### 4.1 What Kite Can Provide

| Input Required | Kite Classification | Existing Helper | Missing Helper | Rate-Limit Risk | Cache Needed | Market-Hours Behavior | After-Market Behavior |
|---|---|---|---|---|---|---|---|
| LTP / live price | `KITE_WEBSOCKET_TICK` | `kiteFeed.ts → getLiveQuote()` | None | None (in-memory) | In-memory (real-time) | Real-time | Stale (last tick) |
| Intraday OHLC + volume | `KITE_QUOTE_REALTIME` | `kiteScanner.ts → loadKiteQuotes()` | None | None for 280 symbols (1 batch call) | 60s TTL recommended | Fresh per call | Returns last trade data |
| Previous close (OHLC.close) | `KITE_QUOTE_REALTIME` | `loadKiteQuotes()` returns `.close` field | None | None | Same as above | Previous session close | Previous session close |
| Daily OHLCV candles (6mo) | `KITE_HISTORICAL_DAILY` | `fetchKiteHistoricalByToken()` (indexed by token) | Need symbol→token map + wrapper for curated universe | **HIGH** — 280 calls × 400ms = 112s | ✅ Required — candle warehouse | Fresh (today's session included after close) | Previous session data |
| Intraday VWAP (15min bars) | `KITE_HISTORICAL_INTRADAY` | `centralEquityCandles()` → `fetchKiteEquityIntraday()` | None — already wired | LOW for 280 symbols (60s cache per symbol) | 60s in-memory | Fresh per 30s TTL | Stale (last session) |
| NSE instrument master (token→symbol) | `KITE_QUOTE_REALTIME` | `loadKiteNseEqInstruments()` | None | None (24h cache) | 24h cache | Available | Available |
| EMA, RSI, MACD, ATR, ADX, S/R | `COMPUTED_FROM_KITE` | None (pure math in indicators.ts) | Need Kite-sourced candle array | None (pure math) | Requires candle warehouse | N/A | N/A |
| 52-week high/low | `REQUIRES_LOCAL_WAREHOUSE` | None | Need 252+ daily candles in warehouse | Same as daily candles | ✅ Required | N/A | N/A |
| deliveryPct | `REQUIRES_NON_KITE_PROVIDER` | `marketData/referenceData.ts → getDeliveryPct()` | None — NSE bhavcopy | None (cached daily) | Cached in bhavcopy module | N/A | N/A |
| Fundamentals (P/E, P/B, market cap) | `REQUIRES_NON_KITE_PROVIDER` | `fetchFundamentals()` — Yahoo | None | None | 30min cache | ~15min delayed | ~15min delayed |
| WebSocket real-time ticks for 280 equities | `KITE_WEBSOCKET_TICK` | `kiteFeed.ts → startTicker()` | Need `addTokens([...280 tokens])` | None (SDK supports 3000 tokens; current use ~50) | In-memory | Real-time | Stale (last tick) |

### 4.2 Rate Limit Analysis

| API | Limit | Current Load | For 280 Curated Symbols |
|---|---|---|---|
| `kc.getQuote()` REST batch | 480 symbols/call; no documented rate limit | ~5 index calls/min | 1 call (280 < 480) — ~1s ✅ |
| `kc.getHistoricalData()` | ~3 req/s (throttled to 2.5 req/s internally) | OI backfill (8 slots) + F&O signal (30 slots) | 280 calls → 112s ❌ for on-demand; fine for nightly job |
| `kc.getInstruments("NSE")` | Once-per-session recommended | 1 call / 24h | 1 call / 24h — no impact |
| WebSocket tokens | 3000 token SDK limit | ~50 tokens (NIFTY50 basket + indices) | 280 equity tokens well within limit ✅ |
| Full NSE scan (2,486 symbols) | 6 calls × 480 = ~5 REST calls | Not currently used for scanner | ~6 batch calls for quotes; daily candles → 2486 calls × 400ms = ~17 min ❌ |

---

## 5. Candle Warehouse Requirement

### 5.1 Current Status

| Question | Answer |
|---|---|
| Is the SQL bug fixed? | ✅ Yes — `ANY(($2,$3,$4)::bigint[])` → `= ANY($1::bigint[])` (Drizzle template literal) |
| Are rows being stored? | ✅ Yes — write-through on Kite historical fetches (F&O backtest, OI backfill) |
| Which timeframes? | 15-minute (primary); daily also supported by schema |
| Which symbols? | Currently driven by F&O signal sweep (NIFTY/BANKNIFTY/SENSEX indices + options) — NOT the 280 curated equity universe |
| Is warehouse used by scanner? | ❌ No — `buildRow()` still calls Yahoo directly |
| Does the scanner read from it? | ❌ No — `scanner.ts` calls `fetchChart()` (Yahoo) and `centralEquityCandles()` (Kite intraday in-memory) |
| BACKFILL mode available? | ✅ Yes — `CANDLE_WAREHOUSE_DAILY_BACKFILL_DAYS=400` (≈ 1.6 years of daily candles) |
| INCREMENTAL mode available? | ✅ Yes — `CANDLE_WAREHOUSE_INCREMENTAL_DAYS=7` (weekly top-up) |
| Write guard in place? | ✅ Yes — `WHERE excluded.source_priority <= candle.source_priority` |
| Provenance columns available? | ✅ Yes — `source_provider`, `source_priority`, `validated_by`, `fetched_at`, `asof`, `is_stale`, etc. |
| DB indexes sufficient? | ⚠️ Check — primary key is `(instrument_token, interval, ts)`. For scanner reads by `(instrument_token, interval, date range)` this is sufficient. May need a partial index on `interval='day'` for the daily scanner use-case. |

### 5.2 What Would Be Required

To use the candle warehouse as the indicator source for the curated scanner:

1. **Symbol → Kite instrument token mapping** for all 280 curated symbols. `loadKiteNseEqInstruments()` already builds this from the Kite instrument master (24h cache). Need a lookup wrapper: `symbol → instrumentToken`.

2. **Nightly post-market backfill job** (after 15:40 IST): call `fetchKiteHistoricalByToken(token, label, "day", 400)` for each of the 280 symbols. At 2.5 req/s throttle: 280 calls × 400ms = 112s ≈ 2 minutes. Perfectly feasible as a background job at 15:45 IST.

3. **Candle warehouse read helper**: `getCandlesFromWarehouse(symbol, interval, daysBack)` → `{high[], low[], close[], volume[], timestamps[]}`. Returns null if no Kite-sourced candles exist for this symbol (fall back to Yahoo gracefully).

4. **`buildRow()` re-wire**: replace `getHistory(symbol, "6mo")` with `getCandlesFromWarehouse(symbol, "day", 400)`. If warehouse returns null (cold boot, missing symbol), fall back to Yahoo and stamp provenance as `yahoo`.

5. **DB index**: `CREATE INDEX CONCURRENTLY IF NOT EXISTS candle_scanner_daily ON candle (instrument_token, interval, ts DESC) WHERE interval = 'day'` — ensures fast range scans for indicator windows.

6. **Freshness check**: warehouse row is fresh if `asof >= today's open (09:15 IST)` for intraday, or `asof >= yesterday's close (15:30 IST)` for daily. Use existing `isFreshFor()` with `"1D"` timeframe.

---

## 6. Architecture Options

### Option 1 — Honest Info-Only Scanner (current state)

Keep the existing Yahoo-delayed scanner. Source honesty is already implemented.

**Benefits:**
- Zero implementation effort
- Zero risk
- Already labeled correctly (`YAHOO_INFO_ONLY`)
- Works during Kite offline

**Risks:**
- Scanner cannot drive F&O or swing signals
- Score/signal labels are info-only, not actionable

**Implementation size:** Zero  
**API/rate-limit risk:** None  
**DB requirements:** None  
**Freshness guarantee:** ~15min delayed (Yahoo daily)  
**Can drive signals:** No  
**Complexity:** Zero  
**Recommendation:** NOT RECOMMENDED as end-state. Keep as fallback only.

---

### Option 2 — Hybrid: Kite Real-Time Quotes + Candle Warehouse Indicators ⭐ RECOMMENDED

Replace Yahoo chart calls with:
- Kite batch quote for LTP/OHLC/volume/prevClose (1 REST call for all 280 symbols)
- Kite daily candles in the candle warehouse for all indicators (nightly job)
- Kite intraday for VWAP (already done)

**Phase A (immediate):** Kite batch quotes replace Yahoo for price/OHLC/volume/prevClose. Indicators still Yahoo-derived → rows become `KITE_PARTIAL` (price fresh, indicators still info-only).

**Phase B (planned):** Candle warehouse scheduler + `buildRow()` re-wire. Indicators computed from Kite daily candles → rows qualify as `KITE_TRADE_GRADE` when all inputs are fresh.

**Benefits:**
- Curated 280-symbol universe fits in 1 Kite batch quote call (< 1s)
- Nightly candle backfill is ~2 min at throttle rate — no impact on live signal quota
- Clean separation: live price from REST batch, indicators from warehouse (deterministic, fast)
- Fallback to Yahoo if warehouse is empty (cold boot) — no service disruption
- `canDriveSignals = true`, `canDriveTradeAlerts = true` when all inputs are Kite-fresh

**Risks:**
- Kite session expiry → fall back to Yahoo (existing `KiteOfflineBanner` handles this)
- Warehouse cold-boot: first day after enabling backfill job, scanner reverts to Yahoo until job completes
- Rate-limit sharing: backfill job competes with OI backfill (30-slot queue shared); needs `isBackfill:true` flag (already built into `reserveHistoricalSlot`)
- No real-time candle updates mid-session (daily warehouse updates once after close) — intraday OHLCV changes won't affect EMA/RSI until next day, which is correct for daily timeframe indicators

**Implementation size:** Medium — 4 files changed + 1 new scheduler function + 1 new DB read helper  
**API/rate-limit risk:** LOW (1 batch quote call per scan; daily candle job runs once after market)  
**DB requirements:** candle warehouse already exists; need candle read helper + DB index  
**Freshness guarantee:** LTP/OHLC real-time; daily indicators up to 1 day stale (correct for daily TF)  
**Can drive signals:** YES — when all inputs are Kite-sourced and fresh  
**Complexity:** Medium  
**Recommendation:** ✅ RECOMMENDED

---

### Option 3 — Full Kite Live Intraday Scanner

Replace all indicator inputs with live Kite 15-minute intraday candles. Computes EMA, RSI, MACD, etc. from intraday bars for every scan cycle.

**Benefits:**
- Maximum freshness — all indicators reflect current session
- Fully trade-grade at all times during market hours

**Risks:**
- **CRITICAL rate-limit problem:** 280 symbols × `fetchKiteEquityIntraday()` × 400ms throttle = 112s per scan. This exceeds the 25s hard-timeout and the 30-slot queue cap. Completely infeasible without its own caching layer.
- Even with caching, the per-symbol 15-minute bar history provides much less data for EMA200 (needs 200+ bars = 200 × 15min = ~50 sessions, so 50 days of intraday bars) than daily candles. This inflates the candle requirement significantly.
- Daily timeframe indicators (EMA50, EMA200) computed from 15min bars produce different values than daily-bar indicators — this would invalidate the existing scoring calibration.
- Intraday bars only available 09:15–15:30 IST. Pre/post-market refreshes would show stale/no data.
- In practice, Option 3 reduces to Option 2 (requires a cached candle layer) — it just uses 15min instead of daily candles for indicator TF, which is a regression for swing indicators.

**Implementation size:** Very Large  
**API/rate-limit risk:** VERY HIGH — exceeds quota on demand  
**DB requirements:** Substantial — all intraday bars for all 280 symbols  
**Freshness guarantee:** Theoretically real-time; practically capped by throttle  
**Can drive signals:** Theoretically yes; practically limited by throttle  
**Complexity:** Very High  
**Recommendation:** ❌ NOT RECOMMENDED. The throttle math makes this infeasible without a full intraday warehouse, which is 10× the scope of Option 2.

---

## 7. Universe and Rate-Limit Analysis

| Parameter | Current | Feasible Target | Notes |
|---|---|---|---|
| Curated universe size | ~280 symbols | 280 — no change | Fits in 1 Kite batch quote call (480 cap) |
| Full NSE tradeable universe | ~2,486 symbols | Batch quotes feasible (~6 calls); daily candles → ~17 min nightly | Deep scan search uses full NSE for lookup only; scores only curated 280 |
| Kite batch quote limit | 480 per call | 1 call covers 280 | Each call ~1s including network |
| Kite historical throttle | 2.5 req/s (400ms interval) | 280 calls = 112s — nightly job only | Not feasible on-demand |
| WebSocket tokens in use | ~50 (NIFTY50 basket + F&O indices) | 280 equity tokens feasible | SDK cap 3000; adding 280 leaves ample headroom |
| Current subscribed tokens | ~50 (hardcoded NIFTY50 basket + NIFTY/BANKNIFTY/SENSEX/FINNIFTY/MIDCPNIFTY + INDIAVIX) | — | `kiteFeed.ts → subscribeNifty50()` |
| Expected scan frequency | Every 60s (cache TTL) | Same | No change needed — 1 batch call per scan ≈ 1s |
| Full NSE live scanning | Not feasible today | Phase C (deferred) | Would need 6 batch quote calls (~6s) — feasible for quotes; daily candles for 2,486 symbols = 17min nightly |
| Priority universe (curated 280) | ✅ Feasible | ✅ Same | Recommended starting point |
| Staged scanning (chunked) | Not needed for 280 | Not needed | One batch covers it |

---

## 8. Trade-Grade Row Definition

A scanner row is `KITE_TRADE_GRADE` only when **ALL** of the following are true:

```
1. INSTRUMENT RESOLVED
   symbol → Kite instrument_token resolved via loadKiteNseEqInstruments()
   (symbol is in NSE EQ master, not delisted)

2. PRICE DATA — Kite-fresh
   LTP from Kite REST batch quote (loadKiteQuotes) OR Kite WebSocket tick
   open, high, low from Kite batch quote OHLC
   previousClose from Kite batch quote OHLC.close
   volume from Kite batch quote
   quote.asOf freshness: < 5 minutes during market hours
   NO Yahoo fallback used for any price field

3. INDICATOR DATA — Kite daily candles from warehouse
   ALL indicator arrays sourced from candle warehouse where source_provider='kite'
   candles asOf: same day's session close OR prior session close (EOD — correct for daily TF)
   minimum history: 30 bars for RSI/ATR/ADX, 50 for EMA50, 200+ recommended for EMA200
   warehouse row is_stale = false (within 1D freshness budget)
   NO Yahoo fallback used for any indicator input

4. VWAP — Kite intraday
   sessionVwap from Kite 15-min bars (centralEquityCandles)
   asOf < 30 minutes (INTRADAY_TTL = 30s from scanner.ts + 60s from kiteIntraday cache)
   OR rollingVwap from warehouse daily bars (acceptable fallback, labelled)
   NO Yahoo fallback used for VWAP computation

5. SOURCE GATE
   provenance.sourceProvider = "kite"
   provenance.trustTier = "authoritative"
   provenance.isStale = false
   rowSource.canDriveSignals = true
   rowSource.canDriveTradeAlerts = true

6. MARKET SESSION COMPATIBLE
   query issued during market hours (09:15–15:30 IST) OR
   row is explicitly labelled EOD and consumer understands delayed signal
```

When ANY condition fails → row is `KITE_PARTIAL` or `YAHOO_INFO_ONLY` (not `KITE_TRADE_GRADE`). The `ScannerHealthBanner` and row-level `rowSource` expose this to all consumers.

**deliveryPct** from NSE bhavcopy is acceptable for trade-grade rows — it is the official EOD NSE reference, not a secondary analytics source.

**Fundamentals** (P/E, P/B, market cap from Yahoo) do not affect `canDriveSignals` — they are display-only enrichment and already labeled secondary.

---

## 9. Migration Plan

### Phase A — Kite Batch Quotes for Price Data (Low Risk, High Impact)

**Goal:** Replace Yahoo chart-based price fetch with a single Kite REST batch call. Price rows become Kite-authoritative. Indicators remain Yahoo-derived (`KITE_PARTIAL` status).

**Files likely affected:**
- `artifacts/api-server/src/lib/scanner.ts` — replace `quoteFromChart()` with a new `quoteFromKite()` that uses `loadKiteQuotes()`; retain Yahoo chart as fallback when Kite is offline
- `artifacts/api-server/src/lib/scannerProvenance.ts` — no change needed (already supports "kite" provider)
- `artifacts/api-server/src/lib/scannerSourceHealth.ts` — `toScannerRowSource()` will emit `KITE_PARTIAL` when provenance is split

**DB changes:** None

**Tests required:**
- `scanner.test.ts` — verify Kite quote path
- `scannerSourceHealth.test.ts` — verify `KITE_PARTIAL` status for mixed-source rows
- Ensure Yahoo fallback path still works (mock Kite offline)

**Production verification:** Check `GET /api/scan/health` → `sourceStatus: "KITE_PARTIAL"` when Kite online; `YAHOO_INFO_ONLY` when offline

**Rollback plan:** Revert `scanner.ts` — no DB changes, no breaking changes to API contract

**Risk level:** LOW — additive change; Yahoo fallback preserved; 1 Kite batch call per scan (60s TTL means 1 call/min max)

---

### Phase B — Candle Warehouse Scheduler for Curated Universe (Moderate Effort)

**Goal:** Nightly Kite daily candle backfill for all 280 curated symbols → indicator inputs become Kite-derived → full `KITE_TRADE_GRADE` rows.

**Files likely affected:**
- `artifacts/api-server/src/lib/candleWarehouseIngestor.ts` — add `syncCuratedEquities()` function that takes the 280-symbol universe, resolves tokens via `loadKiteNseEqInstruments()`, and calls `syncCandleWarehouse()` for daily interval
- `artifacts/api-server/src/lib/scanner.ts` — add `getCandlesFromWarehouse(symbol, "day", 400)` call; fall back to `getHistory()` (Yahoo) when warehouse returns null
- New file: `artifacts/api-server/src/lib/candleWarehouseReader.ts` — pure `getWarehouseCandles(token, interval, daysBack)` returning `{high[], low[], close[], volume[], ts[]}` from the candle table
- `artifacts/api-server/src/routes/scheduler.ts` (or wherever the nightly tick fires) — wire `syncCuratedEquities()` to run at 15:45 IST daily
- `lib/db/src/schema/candleWarehouse.ts` — no schema change needed (provenance columns already added)

**DB changes:** 
- New DB index: `CREATE INDEX CONCURRENTLY IF NOT EXISTS candle_scanner_daily ON candle (instrument_token, interval, ts DESC) WHERE interval = 'day'` — do NOT use drizzle-kit push; use `ALTER TABLE … ADD COLUMN IF NOT EXISTS` pattern (raw SQL)
- No new tables

**Tests required:**
- `candleWarehouseReader.test.ts` — verify candle read correctness
- `candleWarehouseIngestor.test.ts` — add test for `syncCuratedEquities()` 
- `scanner.test.ts` — verify warehouse read path + Yahoo fallback
- `scannerSourceHealth.test.ts` — verify `KITE_TRADE_GRADE` status when all inputs are warehouse-sourced

**Production verification:**
- After first nightly job: `GET /api/scan/health` → `sourceStatus: "KITE_TRADE_GRADE"` (or `KITE_PARTIAL` until all 280 symbols backfilled)
- Verify `rowSource.canDriveSignals = true` on rows

**Rollback plan:** Revert `scanner.ts` to Yahoo path; candle warehouse data remains harmless (write-only from Yahoo's perspective)

**Risk level:** MEDIUM — new scheduler function, new DB read path; fallback preserved

---

### Phase C — WebSocket Equity Subscriptions (Optional Enhancement)

**Goal:** Subscribe the 280 curated equity tokens to KiteTicker for real-time mid-session LTP updates (currently only NIFTY50 basket + indices are subscribed).

**Files likely affected:**
- `artifacts/api-server/src/lib/kiteFeed.ts` — add `subscribeEquityUniverse()` alongside existing `subscribeNifty50()`

**DB changes:** None

**Tests required:** Minimal — KiteTicker subscription logic is already tested; add coverage for new subscription path

**Risk level:** LOW — additive; existing WebSocket infrastructure unchanged; 280 tokens << 3000 SDK limit

---

### Phase D — Full NSE Trade-Grade Scanner (Future, Not Recommended Now)

**Goal:** Extend trade-grade scanning from 280 curated symbols to the full ~2,486 NSE tradeable universe.

**Complexity:** Requires candle warehouse backfill for ~2,486 symbols (17 min nightly), a curated → full-NSE scoring calibration review, and significant compute time increases.

**Recommendation:** Do NOT attempt until Phase B is stable and the 280-symbol path is validated in production.

---

### Phase E — Deep Scan Kite Integration (Future)

**Goal:** Replace Yahoo daily chart in Deep Scan with Kite daily candles from the warehouse.

**Dependency:** Phase B complete (warehouse populated for curated universe). Deep scan covers full NSE (2,486 symbols) — needs Phase D first for non-curated symbols.

**Risk level:** LOW for curated symbols (reuses Phase B warehouse); MEDIUM for full NSE.

---

## 10. Recommendation

### Should we upgrade scanner to Kite trade-grade now?

**Yes, in phases.** Phase A (batch quotes) is low-risk and should be implemented first. Phase B (candle warehouse) is the key enabler for full trade-grade status.

### Should we first fix candle warehouse?

The candle warehouse SQL bug is already fixed. The missing piece is a **scheduler** that populates it with the curated equity daily candles. This is Phase B.

### Should we use curated universe before full NSE?

**Yes.** The curated 280-symbol universe fits in 1 Kite batch call and the nightly job completes in 2 minutes. Starting with it validates the full pipeline before expanding to 2,486 symbols.

### Should we keep Yahoo scanner as info-only fallback?

**Yes.** The Yahoo path must be preserved as the Kite-offline fallback. `KiteOfflineBanner` will surface the degraded state. Never remove the Yahoo fallback.

### What is the safest first implementation task?

**Phase A — Kite batch quote scanner for curated universe:**
- Change `scanner.ts` `quoteFromChart()` to call `loadKiteQuotes([...universeSymbols])` at scan start (1 batch call, 480-symbol cap, ~1s)
- Use Kite quote for LTP/open/high/low/prevClose/volume
- Retain Yahoo chart as the candle source for indicators (unchanged)
- Retain Yahoo as Kite-offline fallback
- Provenance: label `provider: "kite"` for price fields; but signal source remains `"yahoo"` (indicators still Yahoo) → emit `KITE_PARTIAL` status
- Expected test changes: 2–3 tests in `scanner.test.ts`, 1 new status branch in `scannerSourceHealth.test.ts`
- Production impact: scanner rows show `KITE_PARTIAL` instead of `YAHOO_INFO_ONLY` when Kite is online; `canDriveSignals` remains false until Phase B completes

### What should not be attempted yet?

- ❌ On-demand Kite historical candle fetching (112s throttle, exceeds scan timeout)
- ❌ Full NSE 2,486-symbol trade-grade scanner (Phase D — needs Phase B first)
- ❌ Removing Yahoo fallback (must always be preserved for Kite-offline)
- ❌ Using intraday candles for daily-TF indicators (Option 3 — infeasible and breaks calibration)
- ❌ drizzle-kit push for any DB change (will prompt DROP on strategy tables)

---

## 11. Exact Next Implementation Task

**Task:** Phase A — Kite Batch Quote Scanner

**Objective:** Replace per-symbol Yahoo chart-based quote derivation with a single up-front Kite REST batch call for all 280 curated symbols.

**Exact changes:**

1. In `scanner.ts`, before `performScan()` loops, add:
   ```ts
   const kiteQuotes = await loadKiteQuotes(universe.map(u => u.symbol));
   // Pass kiteQuotes into buildRow() alongside chart
   ```

2. Modify `quoteFromChart()` to accept an optional `KiteScannerQuote | null` parameter. When provided and `kiteQuote.lastPrice > 0`, use Kite fields for `price`, `open`, `high`, `low`, `volume`, `change`, `changePercent`, and `previousClose` (from `kiteQuote.close`). Keep Yahoo chart for `fiftyTwoWeekHigh/Low`, `avgVolume`, and all historical OHLCV arrays needed by `computeIndicators()`.

3. Update `buildSourceProvenance()` call in `buildRow()`: the signal source remains `"yahoo"` (indicators computed from Yahoo chart), but add a Kite-price note to `warnings`. This correctly yields `sourceStatus: "KITE_PARTIAL"` via `toScannerRowSource()`.

4. `scannerSourceHealth.ts` `buildScannerSourceHealth()` already handles `KITE_PARTIAL` — no change needed.

5. Tests: add Kite-online and Kite-offline branches to `scanner.test.ts`; add `KITE_PARTIAL` row coverage to `scannerSourceHealth.test.ts`.

**Acceptance criteria:**
- `GET /api/scan/health` returns `sourceStatus: "KITE_PARTIAL"` when Kite online
- `GET /api/scan/health` returns `sourceStatus: "YAHOO_INFO_ONLY"` when Kite offline (fallback preserved)
- `rowSource.canDriveSignals` is still `false` (indicators still Yahoo — correct)
- Price fields in scanner rows reflect live Kite data (not ~15min delayed Yahoo)
- No F&O/swing/trading logic changed

---

## Appendix — Files Reference

| File | Role | Change Needed |
|---|---|---|
| `artifacts/api-server/src/lib/scanner.ts` | Scanner orchestration, `buildRow()` | Phase A: add Kite batch quote; Phase B: add warehouse candle read |
| `artifacts/api-server/src/lib/kiteScanner.ts` | `loadKiteQuotes()`, `loadKiteNseEqInstruments()` | No change — already complete |
| `artifacts/api-server/src/lib/kiteIntraday.ts` | Historical candle throttle, `fetchKiteEquityIntraday()` | No change for Phase A; Phase B uses existing throttle |
| `artifacts/api-server/src/lib/candleWarehouseIngestor.ts` | Candle write + BACKFILL/INCREMENTAL sync | Phase B: add `syncCuratedEquities()` |
| `artifacts/api-server/src/lib/scannerProvenance.ts` | Source provenance | No change |
| `artifacts/api-server/src/lib/scannerSourceHealth.ts` | `toScannerRowSource()`, `buildScannerSourceHealth()` | No change for Phase A; verify `KITE_PARTIAL` emits correctly |
| `artifacts/api-server/src/lib/indicators.ts` | Pure indicator math | No change — already provider-agnostic |
| `artifacts/api-server/src/lib/scoring.ts` | Scoring rules | No change |
| `lib/db/src/schema/candleWarehouse.ts` | Candle table schema | No change — provenance columns already present |
| New: `artifacts/api-server/src/lib/candleWarehouseReader.ts` | Read candles from warehouse for scanner | Phase B: create |
