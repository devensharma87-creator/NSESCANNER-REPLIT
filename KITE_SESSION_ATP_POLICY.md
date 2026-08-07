# Kite Session Average Traded Price — Strategy-Input Policy

**Status:** ACTIVE  
**Last reviewed:** 2026-08-07  
**Scope:** Curated NSE scanner (199-symbol universe), `artifacts/api-server`

---

## 1. Field Identity

| Layer | Name | Type | Source |
|---|---|---|---|
| Kite REST API (batch quote) | `average_price` | `number` | Kite Connect `getQuote()` response |
| Internal scanner variable | `sessionAtp` | `number \| null` | `getKiteSessionAtp(kiteQuote)` |
| API output field | `indicators.vwap` | `number \| undefined` | passed through from `sessionAtp` |
| Provenance label | — | — | `KITE_SESSION_AVERAGE_TRADED_PRICE` |

### What `average_price` is

Kite's `average_price` field is the **exchange-reported average traded price for the current session** — the total traded value divided by total traded volume for the day, published by NSE in real-time alongside the OHLCV quote. This is the exchange's own arithmetic: `Σ(price × qty) / Σqty` for all trades since market open.

### What `average_price` is not

- **Not a true intraday VWAP**: a true VWAP requires tick-level data. The exchange figure is a traded-price average but may use different aggregation granularity.
- **Not a multi-day or rolling VWAP**: it resets to zero at the start of each session.
- **Not derived from our candle data**: we do not compute it from the Kite daily candle series.

### Why we use it as a VWAP proxy

There is no zero-cost intraday VWAP available from Kite without N × 15-minute-candle calls (one per symbol per scan). The session average traded price is the closest single-field proxy. Its directional signal (is price above or below the daily average?) is semantically equivalent for the scoring rule it feeds. The field is sourced from the same batch-quote call already made for price/OHLC — **zero additional provider calls**.

---

## 2. Scoring Rule Dependency

### VWAP rule in `scoring.ts` (pre-existing, weight unchanged)

```typescript
// 4. VWAP (weight 10)
if (vwap != null) {
  if (price > vwap * 1.001) { score += 10; /* bullish */ }
  else if (price < vwap * 0.999) { score -= 10; /* bearish */ }
}
```

### Classification: OPTIONAL

| Property | Value |
|---|---|
| Guard | `if (vwap != null)` — rule is skipped when null |
| Weight | ±10 of a possible ±119 total score |
| Effect when null | 0 net score change (rule skipped) |
| Signal classification | Determined by total score; no VWAP-specific threshold |
| NOT_EVALUATED trigger? | **No** — null VWAP never causes NOT_EVALUATED alone |

### No threshold or weight changes

The weight of 10 has been constant since the original scoring implementation. This document's changes:
- Removed the rolling-daily-VWAP fallback (`rollingVwap(daily, 20)`), which was semantically wrong for session decisions (multi-day rolling average ≠ today's session price level).
- When ATP is null, the VWAP rule is now skipped (0 net points), rather than scoring against a daily-bar multi-day figure. **This is fail-closed, correct behavior.**
- Symbols whose Kite batch quote has `average_price == null || <= 0` receive `vwap=null` in indicators. Their total score is computed from the other 109+ possible points.

---

## 3. Policy Definitions

### Case A: ATP available (`average_price > 0`)

```
indicators.vwap = average_price   (sourced from KITE_SESSION_AVERAGE_TRADED_PRICE)
scoring:         VWAP rule fires ±10 points based on price vs ATP
signal:          determined by full score (may be STRONG_BUY…STRONG_SELL)
NOT_EVALUATED:   NO — ATP presence alone never drives NOT_EVALUATED
```

### Case B: ATP unavailable (`average_price == null || <= 0`)

```
indicators.vwap = null            (ATP_UNAVAILABLE)
scoring:         VWAP rule skipped (0 net points from this rule)
signal:          determined by remaining ≥109 possible points
NOT_EVALUATED:   NO — the stock is still evaluated on other indicators
```

### Case C: VWAP/ATP mandatory for scoring (for a hypothetical future formula)

If a future strategy revision makes VWAP/ATP **mandatory** (i.e., no score is meaningful without it), the policy must change:
```
signal:    NOT_EVALUATED
score:     null
confidence: null
action:    null
reason:    SESSION_VWAP_UNAVAILABLE
```
Any such change requires explicit strategy-specification update and sign-off before implementation.

---

## 4. Prior rolling-VWAP fallback — why it was removed

The code previously had:
```typescript
const vwapNum = intradayVwap ?? rollingVwap(daily, 20);
```
`rollingVwap(daily, 20)` computed the 20-session rolling average from daily close prices. This is a **multi-day price average**, not today's session VWAP. Using it:
- Inflated the VWAP-based score contribution for stocks where the intraday ATP was unavailable.
- Disguised missing data — it never surfaced as null, so the scoring appeared "complete" even without real session data.
- Violated the no-synthetic-data rule (substituting a derived multi-day figure for a session-specific one).

Removal is correct and documented. Score changes are expected for stocks with ATP unavailable (±10 points from the VWAP rule are now absent rather than computed from a daily-bar rolling figure).

---

## 5. Provenance

When a row uses ATP as the VWAP source, the `provenance` object includes:
```json
"sessionVwapSource": "KITE_SESSION_AVERAGE_TRADED_PRICE"
```
When ATP is unavailable, `indicators.vwap` is `undefined` (not emitted in the API response).

---

## 6. Verification checkpoints

| Check | Where | Expected |
|---|---|---|
| ATP function name | `scanner.ts` | `getKiteSessionAtp()` |
| Scoring guard | `scoring.ts:123` | `if (vwap != null)` |
| Weight unchanged | `scoring.ts:124` | `score += 10` (not changed) |
| Null propagation | `scanner.ts:251` | `vwap != null ? round2(vwap) : undefined` |
| No daily-bar VWAP | `scanner.ts` | no `rollingVwap` import or call |
| Provenance label | `scanner.ts` | `sessionVwapSource: "KITE_SESSION_AVERAGE_TRADED_PRICE"` |
