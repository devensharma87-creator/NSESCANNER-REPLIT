# Home / Market Pulse — Index Analytics Data-Authenticity Audit (T003)

Scope: the **chart-derived analytics** on the Home Index Tabs and the Markets
Board (`/`). These are a SEPARATE data path from the live index quote:

- **Quote** (`ltp` / `change` / `changePercent` / `source` / `asOf`) — already
  Kite/TradingView-authoritative with a Yahoo *delayed* fallback. Out of scope
  for this audit except for the fake-zero rendering fix in the MiniCard.
- **Analytics** (52-week extrema, daily EMAs 9/20/50/100/200, previous-day
  OHLC, floor pivots, intraday VWAP + value-area / POC) — **computed from a
  daily/intraday history series**. For Indian indices Kite's historical daily
  series is only ~60 sessions, too short for 52W / EMA200, so these analytics
  are derived from **Yahoo** history.

The problem this fixes: the analytics were rendered indistinguishably from the
authoritative quote, and the only signal that they were a delayed/secondary
feed was a raw, leaky diagnostic note ("Daily chart unavailable from Yahoo").
There was no honest provenance, and a genuinely-missing change rendered as a
fabricated `+0.00%`.

## Policy applied

1. **Kite / central layer is primary** for Indian index quotes.
2. **Yahoo must never silently power official index analytics.** Where Yahoo is
   the only available source, the analytics are LABELLED `secondary_analytics`,
   `delayed`, `notForSignals`, `notForTradeDecisions`.
3. **No fake `0.00`** in the MiniCard — genuinely-missing change/changePercent
   renders `—`.
4. **No raw provider-leak text** in diagnostic notes ("…from Yahoo").
5. **Honest null + missingReason + provenance** when analytics are unavailable.

## Per-field provenance (Indian indices, today)

| Field group | Source today | Trust tier | Delayed | For signals/trades | When unavailable |
|---|---|---|---|---|---|
| Live quote (ltp/change/%) | Kite (TV for GIFT) → Yahoo fallback | authoritative (live) / delayed fallback | quote-dependent | quote path (separate) | MiniCard renders `—` (no fake 0.00) |
| 52W high/low | Yahoo daily 1y | `secondary_analytics` | yes | **no** | honest `unavailable` + reason |
| Daily EMAs 9/20/50/100/200 | Yahoo daily 1y | `secondary_analytics` | yes | **no** | honest `unavailable` + reason; <200 bars → EMA200 warning |
| Previous-day OHLC | Yahoo daily 1y | `secondary_analytics` | yes | **no** | note: "Previous-day OHLC unavailable from trusted source" |
| Floor pivots (S/R, pivot, CPR) | Yahoo daily 1y (from prev OHLC) | `secondary_analytics` | yes | **no** | derived only when prev OHLC present |
| Intraday VWAP / VAH / VAL / POC | Kite 5min (preferred) → Yahoo 5min | `secondary_analytics` (intradaySourceProvider records kite vs yahoo) | yahoo path delayed | **no** | note: "Intraday session data unavailable from trusted source" / "too sparse" |

## Provenance contract (new)

`IndexBoardItem.analytics?: IndexAnalyticsProvenance` (additive, optional;
omitted for rows with no analytics, e.g. GIFT NIFTY):

| Field | Meaning |
|---|---|
| `sourceProvider` | `kite \| yahoo \| null` — provider of the daily-derived analytics |
| `sourcePriority` | 1 authoritative / 3 secondary_analytics / 99 none |
| `trustTier` | `authoritative \| secondary_analytics \| unavailable` |
| `delayed` | true when the analytics provider is a delayed/EOD feed |
| `notForSignals` / `notForTradeDecisions` | hard policy flags, always protective |
| `intradaySourceProvider` | `kite \| yahoo \| null` — provider of VWAP/profile |
| `asOf` | epoch seconds of the latest daily bar |
| `freshnessSec` | seconds between `asOf` and snapshot-build time |
| `isStale` | true when older than `STALE_DAILY_ANALYTICS_SEC` (4 days) |
| `missingReason` | user-facing reason analytics are missing (null when present) |
| `warnings` | user-facing notes (proxy disclosure, EMA200 bar-count) — no raw provider internals |

Pure builder: `buildAnalyticsProvenance(cfg, daily, intraSource, now)` in
`artifacts/api-server/src/lib/indicesBoard.ts`. Single place to upgrade
`sourceProvider`/`trustTier` to `authoritative` when a Kite daily-candle facade
later supplies long history.

## Changes

### Backend (`artifacts/api-server/src/lib/indicesBoard.ts`)
- Added `IndexAnalyticsProvenance` interface + optional `analytics` on `IndexBoardItem`.
- Added `STALE_DAILY_ANALYTICS_SEC` + pure `buildAnalyticsProvenance` (exported).
- `buildItem` now takes `intraSource` + `now`, sets `item.analytics`, and is exported.
- `getIndicesBoard` tracks the real intraday provider (kite vs yahoo) and passes it.
- De-leaked notes:
  - "Previous-day OHLC unavailable from Yahoo" → "…from trusted source"
  - "Daily chart unavailable from Yahoo" → "Index analytics unavailable: no trusted daily candles"
  - "Intraday chart unavailable from Yahoo" → "Intraday session data unavailable from trusted source"

### API contract
- `lib/api-spec/openapi.yaml`: added `IndexAnalyticsProvenance` schema + `analytics` on `IndexBoardItem`; regenerated client/zod.

### Frontend
- `components/home/index-tabs.tsx`: exported pure `formatSignedPct` / `formatSignedNum` (return `—` for null/NaN); MiniCard no longer coerces to `+0.00%`.
- `components/home/index-expanded-panel.tsx`: momentum tiles (RSI/ADX/MACD/Vol) show "No data" instead of a fabricated "Neutral/Range/Flat/Normal" when the value is missing; added `AnalyticsProvenanceNote` footer.
- `components/indices-board.tsx`: added `AnalyticsProvenanceNote` footer to `InstrumentCard`.

### Tests
- `artifacts/api-server/src/lib/indicesBoard.analytics.test.ts` (9): provenance tiers, honest unavailable+reason, staleness, EMA200 warning, proxyNote warning, note de-leak (`/yahoo/i` never matches), no fabricated zero change.
- `artifacts/scanner/src/components/home/index-tabs.format.test.ts` (5): formatters return `—` for missing, format real zero/positive/negative honestly.

## Out of scope (unchanged)
- Portfolio Analyser (T004 — closed/accepted), Watchlist, Backtest Lab.
- Full trusted-layer consumer migration (#124 / #125–127) — `getEquityQuoteResolved` failover signal-block enforcement still deferred.
- Gold/silver basis note (commodities) — left as-is.
