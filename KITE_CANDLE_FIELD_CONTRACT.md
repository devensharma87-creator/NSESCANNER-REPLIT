# Kite Candle Analytics — Field Contract

**Prompt 33 / Gate 3 — Frozen indicator and timeframe semantics.**

This document is the authoritative contract for every scored field in the curated
NSE Stock Scanner. Any change to a data source or timeframe requires a Gate-3-
level review and an update to this file.

---

## Data Source Hierarchy

| Tier | Source | Authority | Allowed uses |
|------|--------|-----------|--------------|
| 1 | Kite REST batch quote | Authoritative | CMP, change, open, high, low, previous, volume, session OHLC |
| 2 | Kite WebSocket tick | Authoritative | Real-time CMP override when batch quote is absent |
| 3 | Kite REST daily candles | Authoritative | EMA, RSI, MACD, 52W H/L, avgVolume, all scored indicators |
| 4 | Kite REST 15-min candles | Authoritative | Session VWAP only |
| 5 | NSE bhavcopy (REST) | Reference | Delivery percentage only |
| 6 | Yahoo Finance | **Display-only** | Global/macro surfaces, **never** Indian equity scoring |

---

## Field-by-Field Contract

### Price fields (from Kite batch quote — tier 1)

| Field | Source | Timeframe | Notes |
|-------|--------|-----------|-------|
| `quote.price` | Kite REST batch quote `.lastPrice` | Real-time (or last tick) | Authoritative |
| `quote.change` | `lastPrice - ohlc.close` | Current session | `ohlc.close` = previous session close |
| `quote.changePercent` | `change / prevClose * 100` | Current session | |
| `quote.open` | Kite `.ohlc.open` | Current session | |
| `quote.high` | Kite `.ohlc.high` | Current session | |
| `quote.low` | Kite `.ohlc.low` | Current session | |
| `quote.previousClose` | Kite `.ohlc.close` | Previous session close | Kite REST only |
| `quote.volume` | Kite `.volume` | Current session cumulative | |

### Indicator fields (from Kite daily candles — tier 3)

| Indicator | Source | Timeframe | Warm-up bars | Notes |
|-----------|--------|-----------|--------------|-------|
| `indicators.ema20` | Kite daily bars | EOD (≈1D) | 20 bars | EMA of close series |
| `indicators.ema50` | Kite daily bars | EOD (≈1D) | 50 bars | |
| `indicators.ema100` | Kite daily bars | EOD (≈1D) | 100 bars | |
| `indicators.ema200` | Kite daily bars | EOD (≈1D) | **200 bars** | Gate for full evaluation |
| `indicators.rsi` | Kite daily bars | EOD (≈1D) | 14 bars | Wilder-smoothed |
| `indicators.macdHist` | Kite daily bars | EOD (≈1D) | 35 bars (26+9) | Standard MACD |
| `indicators.avgVolume` | Last 20 completed Kite daily bars | EOD (≈1D) | 20 bars | Excludes partial current-day bar |
| `indicators.support` / `resistance` | Kite daily bars | EOD | — | Derived from pivot/swing analysis |

### 52-week range (hybrid — tiers 1 + 3)

| Field | Source | Notes |
|-------|--------|-------|
| `quote.fiftyTwoWeekHigh` | max(Kite daily high, last 252 bars) + today's Kite intraday high | 252 trading days from store + live quote |
| `quote.fiftyTwoWeekLow` | min(Kite daily low, last 252 bars) + today's Kite intraday low | Same |

### VWAP (from Kite 15-min candles — tier 4 only)

| Field | Source | Timeframe | Notes |
|-------|--------|-----------|-------|
| `indicators.vwap` | Kite 15-min candles, `sessionVwap()` | Current session | **Null when Kite intraday unavailable** |

**HARD RULE**: Yahoo intraday candles MUST NOT be used for Indian equity VWAP.
When Kite 15-min candles are unavailable, `vwap = null` and all VWAP-dependent
scoring conditions are skipped. This is the correct fail-closed behavior.

### Delivery percentage (from NSE bhavcopy — tier 5)

| Field | Source | Notes |
|-------|--------|-------|
| `indicators.deliveryPct` | NSE bhavcopy daily file | Only populated from authoritative EOD source; never fabricated |

### Score and signal

| Field | Rule |
|-------|------|
| `recommendation.score` | `null` for NOT_EVALUATED rows (pending, unavailable, insufficient history) |
| `recommendation.signal` | `NOT_EVALUATED` when score is null; `STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL` otherwise |
| `recommendation.confidence` | `null` for NOT_EVALUATED rows |

---

## Evaluation Gate

A full recommendation requires:
- Kite batch quote available (non-null lastPrice > 0)
- Kite daily candle store entry with `status = ok | stale` and `barCount >= 200`
- At least 200 completed trading-day bars in the Kite candle store

When `barCount < 200`:
- Signal = `NOT_EVALUATED`
- `setupMessage` = `INSUFFICIENT_HISTORY: N trading days (need ≥200)`
- Indicators are computed and displayed but score/confidence remain null

When candle store entry is pending/unavailable:
- `buildRowFromKiteCandles` returns null → Yahoo fallback path (KITE_CANDLES_UNAVAILABLE)
- Signal = `NOT_EVALUATED`
- `setupMessage` = `KITE_CANDLES_UNAVAILABLE: ...`

---

## Candle Store Freshness Policy

| Status | Meaning | Scanner behavior |
|--------|---------|-----------------|
| `ok` | Fresh Kite data from this session | Full indicators + recommendation |
| `stale` | Last-good data (age > 18h) | Indicators + recommendation with staleness warning in provenance |
| `unavailable` | Kite offline / symbol not in universe | NOT_EVALUATED, falls back to Yahoo display path |
| `insufficient` (barCount ≥ 30) | Too few bars for EMA200 | NOT_EVALUATED/INSUFFICIENT_HISTORY with partial indicators |
| `insufficient` (barCount < 30) | Far too short | NOT_EVALUATED, falls back to Yahoo display path |
| `pending` | Store not yet populated | NOT_EVALUATED, falls back to Yahoo display path |

---

## Yahoo Containment Policy (Gate 5)

For Indian equities (`exchange = NSE`):

| ✓ Allowed | ✗ Prohibited |
|-----------|-------------|
| Yahoo as GLOBAL/MACRO display source | Yahoo daily candles for indicator computation |
| Yahoo chart for stock detail page (INFO_ONLY badge) | Yahoo VWAP for session indicators |
| Yahoo fundamentals (revenue, P/E, etc.) with DELAYED label | Yahoo-derived scores or signals |
| | Yahoo as paper/trading decision input |

The candle store enforces this automatically: only Kite daily candles are stored,
and `buildRowFromKiteCandles` reads exclusively from the store.

---

## Timeframe Mapping

| Kite interval | Meaning | Used for |
|---------------|---------|----------|
| `day` | 1 EOD bar per trading day | All scored indicators (EMA, RSI, MACD, avgVol, 52W H/L) |
| `15minute` | 15-min intraday bars | Session VWAP only |
| `3minute` / `5minute` | Intraday | Not used in Phase B curated scanner |

---

*Last updated: 2026-08-07 | Prompt 33 Gate 3*
