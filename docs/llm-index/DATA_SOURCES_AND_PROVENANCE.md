# Data Sources & Provenance

**This is the most critical policy document. Read before touching any data layer.**

---

## Source Trust Hierarchy

```
AUTHORITATIVE (tier 1)    → Kite Connect
SECONDARY_VALIDATION (2)  → INDstocks (DISABLED by default)
SECONDARY_ANALYTICS (3)   → Yahoo Finance (display-only)
LOCAL_CACHE               → DB candle warehouse, OI snapshots
SYNTHETIC / SAMPLE        → Test data, mock values (must NEVER reach production signals)
```

Governed by: `artifacts/api-server/src/lib/marketData/policy.ts`

---

## Source Catalog

### 1. Kite Connect (Zerodha) — AUTHORITATIVE

**What it is:** Primary live market data provider. WebSocket (KiteTicker) for real-time index spots + REST for historical candles, quotes, option chains.

**Allowed for:**
- All live scanner quotes
- F&O option chain data + signal engine inputs
- Swing cash order risk evaluation (LTP, daily OHLCV)
- Paper trading entry/exit pricing
- All trading decisions and signal generation
- Chart candle data (intraday + daily historical)

**NOT allowed for:** Nothing — Kite is the top-tier source for everything price-sensitive.

**Files:**
- `lib/kiteAuth.ts` — session management, token encryption
- `lib/kiteFeed.ts` — KiteTicker WebSocket (index spot streaming)
- `lib/kiteScanner.ts` — batch quote (up to 8787 instruments)
- `lib/kiteIntraday.ts` — 15-min historical candles
- `lib/kiteOptionChain.ts` — live option chain
- `lib/kiteIndexQuotes.ts` — index spot quotes
- `lib/marketData/kiteProvider.ts` — wrapped in the trusted layer

**Freshness:** Real-time during market hours. Session must be valid (stored in `kite_session` DB table). Stale if session expired → KiteOfflineBanner shown.

**Fallback behavior:** Falls back to Yahoo for display-only quotes ONLY when Kite is offline. This fallback is:
- Logged as WARN
- Labeled in UI (`KiteOfflineBanner`, `KiteOfflineNote`)
- NEVER used for signals or paper trading

**Overwrite rules:** Kite data can NEVER be overwritten by a lower-trust source. The candle warehouse write guard (`upsertCandles`) uses `WHERE excluded.source_priority <= candle.source_priority` so a non-Kite row can never replace a Kite row.

---

### 2. INDstocks — SECONDARY_VALIDATION (currently DISABLED)

**What it is:** Indian market data provider used ONLY for cross-validation against Kite. Hard-disabled by default.

**Enabled by:** `INDSTOCKS_ENABLED` env var (`policy.ts`) + `INDSTOCKS_API_TOKEN` secret.

**Allowed for:**
- Cross-validation of Kite quotes (comparison, conflict detection)
- Failover quote display ONLY when instrument mapping is VERIFIED + fresh + complete

**NOT allowed for:**
- Any trading decision or signal generation
- Any scanner result that feeds the trading engine
- Overwriting Kite data (enforced by `instrumentMapStore.ts` + candle write guard)

**Files:** `lib/marketData/indstocksProvider.ts`, `lib/marketData/indstocksClient.ts`, `lib/marketData/instrumentMapMatch.ts`, `lib/marketData/instrumentMapStore.ts`, `lib/marketData/sourceValidation.ts`

**UI labeling:** A failover quote from INDstocks is shown but NEVER branded as `tradeable` and never gets the Kite trust badge.

**Known danger:** INDstocks REST full-quote has NO server timestamp → `asOf=null`. Freshness is fetch-based with a loud warning in logs.

---

### 3. Yahoo Finance — SECONDARY_ANALYTICS (display-only)

**What it is:** Fallback data source for non-live analytics.

**Allowed for:**
- Fundamentals (P/E, P/B, market cap) displayed in stock detail
- News feed (via RSS + Yahoo enrichment)
- Pre-market / global cues display
- Historical return calculations in Portfolio Analyser
- Global scanner (non-NSE assets where Kite has no coverage)

**NOT allowed for:**
- Any live NSE/BSE equity signal
- Any F&O signal engine input
- Any paper trading decision
- Overwriting Kite prices in scanner results
- Being presented as live/authoritative data without a label

**Files:** `lib/yahoo.ts`, `lib/marketData/analyticsYahoo.ts`

**UI labeling requirement:** Any Yahoo-sourced value shown in the UI must carry a data source label. Any screen that uses Yahoo as fallback must be non-trading (no "BUY"/"SELL" signal amplification).

**Fallback behavior when Kite offline:** Yahoo quote may be shown with explicit `KiteOfflineBanner`. Scanner switches to Yahoo for LTP display only — signals are suppressed.

**Scanner provenance:** `scannerProvenance.ts` stamps each scanner row with the actual signal source (Yahoo vs Kite). A Kite LTP tick cannot retroactively promote a Yahoo-sourced signal to Kite-authoritative.

---

### 4. NSE Bhavcopy — EOD REFERENCE

**What it is:** End-of-day price/volume data from NSE's publicly published bhavcopy files.

**Allowed for:**
- Sector weight refresh (`refreshNifty500SectorReference.ts` script)
- EOD volume reference for scanner enrichment
- Historical symbol list / delistings

**NOT allowed for:**
- Intraday decisions
- Real-time signals

**Files:** `lib/nseBhavcopy.ts`

---

### 5. DB Candle Warehouse — LOCAL CACHE

**What it is:** Local PostgreSQL table (`candle` schema in `candleWarehouse.ts`) that stores fetched candles with source provenance.

**Allowed for:**
- Historical candle retrieval for backtests
- EOD enrichment caching
- Strategy research (DIRECTIONAL backtest)

**NOT allowed for:**
- Live intraday signals (the warehouse does NOT feed F&O signals or swing scanner live — both read directly from Kite historical API)

**Provenance columns:** `source_provider`, `source_priority`, `validated_by`, `validation_status`, `provider_conflict_status`, `asof`, `fetched_at`, `is_stale`, `fallback_used`, `data_quality`.

**Write guard:** Lower-trust sources cannot overwrite Kite rows (`onConflictDoUpdate` with `setWhere COALESCE(excluded.source_priority,99) <= COALESCE(candle.source_priority,99)`).

**Files:** `lib/candleWarehouseIngestor.ts`, `lib/marketData/provenance.ts`

---

### 6. Option Chain Snapshot Store — WRITE-ONLY LOCAL CACHE

**What it is:** PostgreSQL table (`option_chain_snapshot`) storing periodic OI snapshots.

**Allowed for:** Write-only analytics — OI delta analysis, max-pain computation, ATM IV tracking.

**NOT allowed for:** Live signal generation (write-only substrate — explicitly does not feed trading decisions).

**Analytics endpoint:** `GET /api/option-snapshots/analytics` (owner-only). Pure module: `lib/optionSnapshotAnalytics.ts`.

---

### 7. Sample / Test / Synthetic Data

**What it is:** In-code test fixtures, sample data for UI demos, mock data in test suites.

**Allowed for:** Unit tests, `*.test.ts` files, test endpoints explicitly marked with `[SAMPLE]`.

**NOT allowed for:** Any production data path. Any UI rendering without an explicit `[SAMPLE]` or `[TEST]` label.

**Known locations:**
- `POST /api/alerts/test-swing-staged-order` — explicitly labeled `[SAMPLE]` in Telegram message
- `POST /api/alerts/test-telegram` — test F&O alert
- Scanner sample portfolio in Portfolio Analyser (amber "preview only" banner required)

**Enforcement:** `swingAlerts.test.ts` has 4 enforcement tests verifying:
1. Sample alert is labeled `[SAMPLE]`
2. No `Data: kite` label in sample message
3. Real staged alert uses `Risk eval: kite`
4. Staged entry price note is present

---

## Swing Alert Wording (Production-Verified)

These exact strings are production-verified and must NOT change:

```
Risk eval: kite (as of <time>)
Note: Entry is the staged limit order price — not current market price
```

**Old forbidden wording:** `Data: kite` — this was misleading because it implied the entry price was the current Kite market price. The entry is always a staged limit order price chosen from technical levels, not the current LTP.

**Enforced by:** `swingAlerts.test.ts` lines 172–196 (4 tests).  
**Lives in:** `artifacts/api-server/src/lib/swingAlerts.ts` → `buildSwingOrderText()`.

---

## Data Trust Gate

All live quotes entering the trading/signal path must pass through:

```
artifacts/api-server/src/lib/marketData/router.ts
```

This gate:
- Accepts only `TrustedQuote` (Kite, fresh, complete)
- Rejects `secondary_analytics` tier for any signal use (blocked by `sourceValidation.ts`)
- Returns `MarketDataResult<T>` with explicit `ok: false` on trust failures
- Is the **only** place where provider switching (Kite → failover) is allowed

---

## Provenance Checklist for New Features

Before adding any new data fetch:

- [ ] What source? Kite / Yahoo / INDstocks / DB / Other
- [ ] What tier? (authoritative / secondary_validation / secondary_analytics)
- [ ] Does it affect any signal or trading decision?
- [ ] If yes → must go through `marketData/router.ts`
- [ ] If no → must still be labeled in UI
- [ ] Does it write to DB? → stamp provenance columns
- [ ] Can it overwrite Kite data? → NEVER allowed
- [ ] Test: is there a test asserting honest labeling?
