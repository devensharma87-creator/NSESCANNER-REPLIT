# Scanner / Sector / Benchmark Data Audit

**Task:** Scanner / Sector / Benchmark data cleanup — guarantee these paths are honest,
source-labelled, and cannot silently use Yahoo / stale candles / fake zeros / incomplete
benchmarks / curated-only resolution as if authoritative.

**Data policy (owner):** Kite is primary for Indian equities, ETFs, indices, scanner prices
and candles where available. Yahoo is allowed ONLY as clearly-labelled **secondary_analytics**
where Kite has no source, and must NEVER power official scanner signals, sector signals, risk
scores, portfolio valuation, or F&O signals. No fake rows, no fake benchmark values, no silent
fallback. Missing data must carry an exact `missingReason`.

**Reused vocabulary:** the repo already ships the honesty envelope `IndexAnalyticsProvenance`
(`sourceProvider`, `sourcePriority`, `trustTier` ∈ `authoritative | secondary_analytics |
unavailable`, `delayed`, `notForSignals`, `notForTradeDecisions`, `intradaySourceProvider`,
`asOf`, `freshnessSec`, `isStale`, `missingReason`, `warnings`) — see `openapi.yaml` and the
central layer `artifacts/api-server/src/lib/marketData/` (`provenance.ts` `SOURCE_PRIORITY`
Kite=1 / INDstocks=2 / Yahoo=3, `optionChainProvenance.ts`). This audit reuses that vocabulary
rather than inventing a parallel one. Freshness is decided by the one shared
`isFreshFor(asOfSec, tf, nowMs)` over `TIMEFRAME_CONFIG` in `chartDatafeed.ts`.

**Status legend:** ✅ already honest · ⚠️ gap to fix · ❌ violation.

---

## Central backbone (reference)

- **Trusted router** `lib/marketData/router.ts` — Kite-only authoritative `TrustedQuote` via
  `assertTradeable`; the trust gate that signals/trades must pass.
- **Canonical instrument resolver** `lib/marketData/instrumentResolver.ts` — in-memory index
  over disk-cached Kite instrument dumps (NSE+BSE), `resolveInstrument(symbol)` →
  `CanonicalInstrument{kite_key,…}`. Session-independent. Powers Charting / Portfolio /
  search. **NOT** currently used by the equity scanners (they resolve their own universe).
- **Provenance** `lib/marketData/provenance.ts` (`SOURCE_PRIORITY`) + `optionChainProvenance.ts`.

---

## Per-module audit

### 1. Main Scanner — Full NSE (`/api/scan/full-nse`)
- **Frontend:** `artifacts/scanner/src/pages/scanner.tsx` (`useFullNseStocks`, `useFullNseStatus`)
- **Backend:** `lib/fullNseScanner.ts` (`performFullScan`); route `routes/scanner.ts`
- **Quote source:** Kite (`loadKiteQuotes`) → Yahoo batch (`fetchYahooBatchQuotes`) → NSE bhavcopy
- **Candle source:** Yahoo (`fetchChart` 1y/1d) for indicators (best-effort)
- **Benchmark src:** n/a · **Sector src:** `sectorMap.ts` / `universe.ts`
- **Central resolver used:** NO (uses full Kite NSE EQ instrument list via `loadKiteNseEqInstruments`, not `instrumentResolver`)
- **marketDataRouter used:** NO · **Direct provider call:** YES (kiteFeed / yahoo / nseBhavcopy)
- **Yahoo dependency:** YES (indicators always; quotes on Kite-offline)
- **Fake zero / n/a risk:** LOW — strict no-synthetic; missing fields → null/undefined, UI renders `—`
- **Stale risk:** MEDIUM — `lastUpdated` is response-level only; per-row freshness/source not surfaced
- **Source/freshness shown:** PARTIAL — `kiteOffline` flag + `lastUpdated`; NO per-row source/asOf/stale
- **Fix applied:** T006 — add additive per-row provenance (source/asOf/isStale/missingReason). Row provenance is stamped by the **SIGNAL source**, not the price source: `rowFromKitePlusIndicators` always labels `yahoo` (its indicators are Yahoo-derived) and emits a "live price from Kite; indicators from Yahoo" warning when the quote is Kite, so a live Kite tick can never silently promote a Yahoo signal to authoritative. `rowFromKiteOnly` (momentum-only, no Yahoo indicators) keeps its real Kite/Yahoo quote-source label.
- **Remaining limitation:** indicators remain Yahoo-derived (labelled secondary_analytics, not_for_signals)

### 2. Curated Scanner / Stocks list + Gainers-Losers (`/api/stocks`)
- **Frontend:** `Dashboard.tsx` (`useListStocks`, `MoverRow`)
- **Backend:** `lib/scanner.ts` (`buildRow`, `scanAll`, `getScanRowsFast`); route `routes/scanner.ts`
- **Quote source:** Kite live (`getLiveQuote`) → Yahoo (`fetchChart`/`fetchIntraday`)
- **Candle source:** Kite intraday (`fetchKiteEquityIntraday`) → Yahoo (`fetchIntraday`)
- **Sector src:** `universe.ts` (curated) via `sectorMap.ts`
- **Central resolver used:** NO (curated `UNIVERSE` only — ~280 names)
- **marketDataRouter used:** NO · **Direct provider call:** YES · **Yahoo dependency:** YES (fallback)
- **Fake zero / n/a risk:** LOW — strict no-synthetic (drops rows missing prevClose/OHLCV)
- **Stale risk:** MEDIUM — per-row source/freshness not on `StockRow` DTO (bare: symbol/name/sector/quote/indicators/recommendation)
- **Source/freshness shown:** NO (per row)
- **Fix applied:** T006 — additive per-row provenance + frontend badge. `buildRow` stamps provenance by the **SIGNAL source** (`yahoo` — the recommendation is computed entirely from Yahoo daily history); a live Kite LTP only overlays the price and adds a warning, never promoting the swing signal to authoritative. `asOf` still carries the freshest displayed instant (Kite LTP when present).
- **Remaining limitation:** curated scan SET unchanged by design; non-curated names resolve via Deep Scan / resolver, not this list (honest `NO_SCANNER_ROW`)

### 3. Top Bullish / Bearish setups (`/api/scanner/top-scans`)
- **Frontend:** `Dashboard.tsx` (`useGetTopScans`) · **Backend:** `routes/scanner.ts` + `lib/scoring.ts` (`buildRecommendation`)
- **Quote source:** Kite/Yahoo (inherits scanner) · **Candle/indicator source:** Yahoo daily/intraday
- **Central resolver:** NO · **marketDataRouter:** NO · **Direct provider:** YES · **Yahoo dependency:** YES (indicators)
- **Fake zero risk:** LOW · **Stale risk:** MEDIUM (indicator freshness not surfaced)
- **Source/freshness shown:** NO
- **Fix applied:** T006 — demote/warn when the underlying row is Yahoo-sourced or stale (these are scanner SIGNALS). Because rows are now stamped by signal source (T006, modules 1–2), the demotion fires honestly: curated/full-NSE picks (Yahoo-indicator-derived) are counted in `nonAuthoritativeCount` even when their price tick is live Kite.
- **Remaining limitation:** score still uses Yahoo indicators where Kite history is too short — labelled, demoted, never silently authoritative

### 4. Deep Scan (`/api/deepscan/snapshot/:symbol`, `/api/deepscan/lookup`)
- **Frontend:** `artifacts/scanner/src/pages/deep-scan.tsx` · **Backend:** `lib/deepscan.ts` (`getDeepSnapshot`)
- **Quote/candle source:** ❌ **Yahoo ONLY** (`fetchChart`/`fetchIntraday`); fundamentals Yahoo (`fetchFundamentals`)
- **Sector src:** `universe.ts` (curated) · **Central resolver used:** NO · **marketDataRouter:** NO
- **Direct provider call:** YES (yahoo) · **Yahoo dependency:** YES (exclusive)
- **Fake zero / n/a risk:** ❌ **HIGH** — candle build coerces missing OHLC with `round2(x ?? 0)` (fabricates 0 bars); silent intraday→daily fallback is unlabelled
- **Stale risk:** HIGH (Yahoo ~15min delayed, not surfaced)
- **Source/freshness shown:** NO
- **Fix applied:** T003 — remove `?? 0` fabrication (skip incomplete bars); add `provenance` envelope (yahoo → secondary_analytics, delayed, not_for_signals, not_for_trade_decisions, asOf, isStale, missingReason); label the intraday→daily fallback; frontend surfaces the label
- **Remaining limitation:** Deep Scan stays Yahoo-sourced (charts/snapshots are analytics, not signals) but is now explicitly labelled secondary/delayed; a Kite-first migration is a separate larger lane

### 5. Sector View / Sector Rotation (`/api/scanner/sectors`, `/api/scanner/sectors/:sector`)
- **Frontend:** `pages/sectors.tsx`, `pages/sector-detail.tsx`, `components/home/sectoral-heatmap.tsx`
- **Backend:** `routes/scanner.ts` over `getScanRowsFast()` aggregated by sector
- **Quote src:** scanner (Kite/Yahoo) · **Sector src:** `sectorMap.ts` (`lookupSector` → `Unmapped`)
- **Central resolver:** NO · **marketDataRouter:** NO · **Direct provider:** via scanner · **Yahoo dependency:** YES (fallback)
- **Fake zero risk:** LOW · **Stale risk:** MEDIUM
- **Source/freshness shown:** NO; ⚠️ **silently drops** stocks whose sector is null/Unmapped from aggregation
- **Fix applied:** T004 — surface excluded/unmapped count + reason, do not silently drop. `/scanner/sectors` now returns an object `{ sectors, coverage }` (`SectorCoverage`: totalRows/mappedRows/excludedUnmapped/coveragePct/unmappedSectors/reason) over the wire (OpenAPI + codegen); the route still LOUD-logs any exclusion, and the frontend renders an amber coverage note when `excludedUnmapped > 0`.
- **Remaining limitation:** sectoral indices (NIFTY BANK/IT…) are Kite-first/Yahoo-fallback and inherit benchmark labelling (T005)

### 6. Market Trend / Breadth (`/api/scanner/market/trend`, `/market/summary`)
- **Frontend:** `components/home/breadth-bar.tsx` · **Backend:** `lib/marketTrend.ts` (`getMarketTrend`)
- **Quote src:** cached scan rows (Kite/Yahoo) · **Candle src:** Kite 15m index (`fetchKiteIntraday`) → Yahoo (`fetchIntraday`)
- **Central resolver:** NO · **marketDataRouter:** NO · **Direct provider:** YES · **Yahoo dependency:** YES (fallback)
- **Fake zero risk:** ✅ LOW — explicitly skips an index rule when VWAP/EMA/RSI missing (no fabricated neutral)
- **Stale risk:** LOW — already surfaces `candleProvenance{source,asOf,fresh,kiteCount,yahooCount}`
- **Source/freshness shown:** ✅ YES (`candleProvenance`)
- **Fix applied:** ✅ already honest — T004 only adds sector-leadership exclusion count for parity
- **Remaining limitation:** none material

### 7. Sector-strength diagnostic (`/api/stocks-to-watch/diagnostics/sector-strength`)
- **Backend:** `lib/sectorStrength.ts` (`computeSectorStrength`, pure) over `swing_scan_result`
- **Central resolver:** n/a (reads persisted rows) · **Yahoo dependency:** NO (DB-only)
- **Fake zero risk:** ✅ LOW · **Stale risk:** LOW (scan_date surfaced)
- **Source/freshness shown:** ✅ YES — `scanDate` + `unavailableMetrics[]` with reasons
- **Fix applied:** ✅ already honest — T004 adds a dropped-null-sector count for transparency
- **Remaining limitation:** EMA breadth genuinely unavailable (not persisted) — already labelled

### 8. Portfolio Benchmark — NIFTY 50 series (`/api/chart/candles` segment=index)
- **Frontend:** `pages/portfolio-analyser.tsx` + `components/portfolio/analytics-panels.tsx` (`BenchmarkPanel`/`BenchmarkChart`)
- **Logic:** `lib/portfolio/benchmark.ts` (`compareToBenchmark`, `buildBenchmarkSeries`, `buildPortfolioValueSeries`)
- **Backend candle src:** `lib/chartDatafeed.ts` (`getChartCandles`) Kite-first → Yahoo fallback
- **Central resolver used:** YES (chartDatafeed resolves via curated + Kite master)
- **marketDataRouter:** NO (chartDatafeed predates it) · **Direct provider:** YES · **Yahoo dependency:** YES (fallback)
- **Fake zero / n/a risk:** ✅ LOW — explicit `unavailable` states; no fabricated path (portfolio path drawn as labelled reference line, not faked)
- **Stale risk:** MEDIUM — benchmark panel does not surface WHICH provider (kite/yahoo) served the index series, nor trust tier
- **Source/freshness shown:** PARTIAL — `asOf`/`stale` for the static sector reference; index-series provider not surfaced to the panel
- **Fix applied:** T005 — surface index-series `sourceProvider`/`trustTier`/`delayed`/`notForSignals`/`notForTradeDecisions` + completeness (covered window vs requested)
- **Remaining limitation:** portfolio's own intra-window path not reconstructable from one live CMP — already drawn as an honest endpoint reference line

### 9. NIFTY 500 sector reference / sector over-under weight (`benchmark.ts`)
- **Source:** static `NIFTY500_SECTOR_REFERENCE` (`NIFTY500_SECTOR_REFERENCE_SOURCE`, as-of 2026-06-03), refreshed via `scripts refresh-nifty500-sectors`
- **Yahoo dependency:** NO (static published NSE weights) · **Fake value risk:** ✅ LOW
- **Stale risk:** surfaced — `stale` when age > 180d
- **Source/freshness shown:** ✅ YES (`asOf` + `source` + `stale`); sector over/under-weight honestly `unavailable` when live weights absent
- **Fix applied:** ✅ already honest — T005 only adds explicit `trustTier`/`delayed`=false labelling for parity
- **Remaining limitation:** reference is a periodic static snapshot by design (refresh script documented in replit.md)

### 10. Swing Scanner (shared sector/scanner data only)
- **Backend:** `lib/swingScanner.ts` + `lib/swingScannerData.ts` (Kite-first, Yahoo fallback) + `swingScannerStore.ts`
- **In scope ONLY where it shares sector/scanner data** (feeds sector-strength via `swing_scan_result`)
- **Yahoo dependency:** YES (fallback) · **Source/freshness shown:** candle-source honesty already shipped (`/diagnostics/candle-source`)
- **Fix applied:** none required here — its candle-source honesty is a CLOSED prior lane; only its persisted sector rows are consumed by T004
- **Remaining limitation:** swing internals out of scope (closed lane)

---

## Summary of gaps → fixes

| # | Module | Gap | Fix task |
|---|---|---|---|
| 4 | Deep Scan | ❌ Yahoo-only + fabricated 0 OHLC + unlabelled | T003 |
| 5 | Sector view | ⚠️ silent drop of unmapped stocks | T004 |
| 8 | Portfolio benchmark | ⚠️ index-series provider/trust not surfaced | T005 |
| 1,2,3 | Scanners + top-scans | ⚠️ no per-row source/freshness; signals not demoted on Yahoo/stale | T006 |
| 6,7,9 | Market trend / sector-strength / NIFTY500 ref | ✅ already honest (minor parity additions) | T004/T005 |

## Remaining direct-provider paths (after fixes)
The equity scanners (`scanner.ts`, `fullNseScanner.ts`, `marketTrend.ts`, `deepscan.ts`) still
call providers directly rather than through `marketDataRouter`. This is intentional for this
task: they are migrated to be **honest and labelled**, not re-plumbed through the trusted
router (a separate, larger "final trusted-layer burn-down" lane). The regression-guard
allowlist (`providerImportAllowlist.json`) already tracks these as migration backlog.

## Shipped state (2026-06-10)

All in-scope fixes (T003–T006) are SHIPPED and verified:
- **T003 Deep Scan** — fabricated `?? 0` OHLC removed (incomplete bars skipped); `provenance`
  envelope on `DeepSnapshot` (yahoo → secondary_analytics / delayed / notForSignals /
  notForTradeDecisions / asOf / isStale / missingReason); silent intraday→daily fallback labelled.
- **T004 Sector honesty** — `/scanner/sectors` + `marketTrend` sector leadership +
  sector-strength surface excluded/unmapped count + reason (`sectorCoverage` / `excludedNoSector`);
  no silent drops. `/scanner/sectors` carries the coverage **over the wire**: the response is now
  `{ sectors, coverage }` (`SectorCoverage` schema, OpenAPI + codegen), both frontend consumers
  (`sectors.tsx`, `sectoral-heatmap.tsx`) read `data.sectors`, and the page shows an amber coverage
  note when anything is excluded.
- **T005 Benchmark** — benchmark comparison carries `BenchmarkProvenance` (source / trustTier /
  delayed / notForSignals / notForTradeDecisions / asOf / fresh / completeness); Yahoo index
  series labelled secondary_analytics; static NIFTY500 reference keeps source + as-of + stale.
- **T006 Scanner rows** — additive `ScannerRowProvenance` on `StockRow` stamped by the **SIGNAL
  source** (not the price source) in both `scanner.ts` (buildRow) and `fullNseScanner.ts`:
  `buildRow` and `rowFromKitePlusIndicators` label `yahoo` (their recommendations are Yahoo-indicator-derived)
  and warn when the live price is Kite; `rowFromKiteOnly` (momentum-only) keeps its real Kite/Yahoo
  quote-source label. A live Kite tick can never silently promote a Yahoo signal to authoritative.
  Per-row frontend flag (non-authoritative / stale only); `/scan/top` adds `warnings` +
  `nonAuthoritativeCount`, surfaced as a dashboard banner.

**Verification:** full `pnpm run typecheck` green; api-server vitest **1216 passed**; scanner
vitest **667 passed**. All changes additive / fail-closed; no consumer re-plumbed through the
trusted router (that remains the separate burn-down lane tracked by `providerImportAllowlist.json`).
