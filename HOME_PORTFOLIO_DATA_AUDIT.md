# Home / Market Pulse + Portfolio Analyser — Data-Path Audit

**Date:** 2026-06-09
**Scope:** Home / Market Pulse landing page and Portfolio Analyser ONLY. Scanner, F&O, Charting, Sector pages, Reports and site-wide badges are explicitly out of scope.
**Method:** Derived from the codebase (provider-import burn-down allowlist + endpoint tracing), NOT from screenshots. This is the map that makes per-tab hand-holding unnecessary.

**Core data policy applied:** Kite is primary for Indian prices. INDstocks is validation/failover only, via the central layer. Yahoo is allowed ONLY as labelled secondary/delayed analytics where Kite has no source — never for official Indian prices, P&L, scanner/F&O signals, portfolio valuation, or risk. No fake `0.00`. No fake `n/a` hiding. No silent fallback. No synthetic production data. Missing data must show a reason + provenance.

---

## Part A — Home / Market Pulse

### A1. Top live ticker strip
- **Screenshot symptom:** generally OK; uses live LTP.
- **Frontend component:** `SentimentBar` (via `pages/dashboard.tsx`)
- **Endpoint:** `GET /api/market/summary`
- **Backend file:** `routes/scanner.ts`
- **Current provider path:** Kite index quotes (`getKiteIndexQuotes`) + Yahoo fallback
- **Central layer used:** PARTIAL (not via `marketDataRouter`)
- **Missing fields:** none material
- **Fake-zero / fake-n/a risk:** LOW
- **Yahoo dependency:** fallback only
- **Kite source available:** YES
- **Fix applied (this pass):** none
- **Remaining limitation:** not routed through central `marketDataRouter` (follow-up)

### A2. Global cues strip  ← PRIMARY FAKE-ZERO BUG
- **Screenshot symptom:** S&P 500 / Dow / Nasdaq / USD-INR showing `0.00`.
- **Frontend component:** `components/home/global-cues-strip.tsx`
- **Endpoint:** `GET /api/market/global` (+ `GET /api/market/macroHistory` for sparklines)
- **Backend file:** `lib/globalIndices.ts` (+ `lib/macroHistory.ts`)
- **Current provider path:** Yahoo directly (acceptable per policy — Kite has no global coverage)
- **Central layer used:** NO (Yahoo is the only legitimate source here; must be LABELLED secondary)
- **Missing fields:** price/change/pct when Yahoo returns empty
- **Fake-zero / fake-n/a risk:** **YES** — `lib/globalIndices.ts` builds `price = intra?... ?? daily?... ?? 0` and `pct = prev>0 ? ... : 0`. A failed/empty Yahoo fetch (which often does NOT throw) pushes an entry with `price:0, change:0, changePercent:0` → UI renders `0.00 / +0.00%`. Frontend also coerces `changePercent ?? 0`.
- **Yahoo dependency:** YES (allowed, secondary)
- **Kite source available:** NO
- **INDstocks source possible:** NO
- **Fix applied (this pass):** Backend now OMITS an entry entirely when no real price resolves (same discipline already used for GIFT NIFTY) — no `?? 0` fabrication; change/pct derived only from a real previous close. Frontend renders `—` for a missing `changePercent` instead of `+0.00%`. Pure builder extracted + unit-tested to prove a failed fetch never yields a `price:0` row.
- **Remaining limitation:** Explicit per-item "delayed/secondary (Yahoo)" provenance badge deferred (UI badge rollout is a separate approved step).

### A3. India / Global / Commodities / ADR / FX tabs
- **Frontend component:** `IndicesBoard`
- **Endpoint:** `GET /api/indices`
- **Backend file:** `lib/indicesBoard.ts`
- **Current provider path:** Kite (Indian LTP) + TradingView (`tvQuotes.ts`, global/commodity) + Yahoo (history/fallback)
- **Central layer used:** NO
- **Missing fields:** analytics (see A5)
- **Fake-zero risk:** LOW for quotes (null→`—`); analytics can be silently null
- **Yahoo dependency:** YES (history)
- **Kite source available:** quotes YES; history PARTIAL (no token for sectorals/NIFTY500)
- **Fix applied (this pass):** none
- **Remaining limitation:** see A5

### A4. Indian index cards (NIFTY 50 / BANK NIFTY / FIN NIFTY / MIDCAP / SENSEX / BANKEX)
- **Frontend component:** `IndexTabs` → `MiniCard`
- **Endpoint:** `GET /api/indices`
- **Backend file:** `lib/indicesBoard.ts` (`buildItem`)
- **Current provider path:** Kite LTP/OHLC; Yahoo for history
- **Central layer used:** NO
- **Fake-zero risk:** LOW (quote); analytics null on missing
- **Fix applied (this pass):** none (analytics tracked under A5)

### A5. Selected index detail card — 52W range / VWAP / daily EMAs / pivots / prev OHLC / momentum  ← SPLIT-PATH
- **Screenshot symptom:** live price present but 52W/VWAP/EMA/pivots/prev-OHLC blank; "Daily chart unavailable from Yahoo".
- **Frontend component:** `IndexExpandedPanel`
- **Endpoint:** `GET /api/indices` (+ `GET /api/home/enrichment`)
- **Backend file:** `lib/indicesBoard.ts` (`buildItem`, `pivotsR3`), `routes/home.ts` (`fetchIndexEnrichment`)
- **Current provider path:** **Quote path = Kite/TV; analytics path = Yahoo daily/intraday history.** These are SEPARATE code paths — when Yahoo history is empty the LTP still shows but every chart-derived analytic goes blank, and a raw "Daily chart unavailable from Yahoo" note is appended.
- **Central layer used:** NO
- **Missing fields:** 52W high/low, sessionVWAP, EMA9/20/50/100/200, classic pivots, previous OHLC, VAH/VAL/POC
- **Fake-zero / fake-n/a risk:** MEDIUM (silent blanks, dishonest provider-leak message)
- **Yahoo dependency:** **YES — this is the leak to control.**
- **Kite source available:** PARTIAL — Kite has historical candles for NIFTY/BANKNIFTY/etc. but NOT for several sectoral indices/NIFTY500 (no token), where Yahoo is genuinely the only source.
- **Fix applied (this pass):** none yet (T003).
- **Planned fix:** prefer the central Kite candle facade for analytics where a token exists; when Kite has no candle source, return an HONEST labelled "unavailable — no Kite candle source (Yahoo delayed)" instead of raw Yahoo-failure text, and mark any Yahoo-derived analytic as secondary/delayed.

### A6. Market breadth card
- **Frontend component:** `BreadthBar`; **Endpoint:** `GET /api/market/summary`; **Backend:** `routes/scanner.ts`
- **Provider:** Kite/Yahoo (constituent change %); **Central:** NO; **Fake-zero risk:** LOW; **Fix:** none.

### A7. Market mood index
- **Frontend component:** `MarketMoodGauge`; **Endpoints:** `/api/market/trend` + `/api/market/global`; **Backend:** `lib/marketTrend.ts`
- **Provider:** composite (breadth + VIX/Yahoo); **Central:** NO; **Fake-zero risk:** LOW (gauge clamps); **Fix:** none.

### A8. F&O ban list
- **Frontend component:** `FnoBanWidget`; **Endpoint:** `/api/fno/ban-list`; **Backend:** `lib/fnoBanList.ts`
- **Provider:** NSE directly; **Central:** N/A (not a price); **Fake-zero risk:** none; **Fix:** none.

### A9. Top gainers / losers
- **Frontend component:** `Home` → `MoverRow`; **Endpoint:** `/api/stocks`; **Backend:** `lib/scanner.ts`
- **Provider:** Kite LTP + Yahoo history; **Central:** NO; **Fake-zero risk:** LOW (no-synthetic policy → null→`—`); **Fix:** none.

### A10. Top bullish / bearish setups
- **Frontend component:** `Home` scan links; **Endpoint:** `/api/scanner/top`; **Backend:** `lib/scanner.ts` → `scoring.ts`
- **Provider:** Kite/Yahoo; **Central:** NO; **Fake-zero risk:** LOW; **Fix:** none.

---

## Part B — Portfolio Analyser

**Key finding:** the portfolio price path ALREADY runs through the central `marketDataRouter` (Kite-authoritative, **no silent Yahoo fallback for quotes**). So the "16 of 41 unpriced" is NOT a Yahoo-leak or fake-data problem — it is an **instrument-coverage** gap plus a **status-surfacing** gap.

### B1. Holding price enrichment cascade
- **Screenshot symptom:** "16 of 41 holdings could not be price-enriched"; rows with CMP `—`, P&L `n/a`, Action "Awaiting data source".
- **Frontend component:** `pages/portfolio-analyser.tsx` → `useQueries` → `lib/portfolio/enrich.ts` (`resolveHolding`)
- **Endpoints:** `getStockDetail` (`/api/stocks/:symbol`), `getEtfQuote` (`/api/kite/quote/:symbol`), `searchChartInstruments`, `getChartCandles`
- **Backend file:** `routes/stocksToWatch.ts` / `routes/kite.ts` / `routes/chart.ts` → all via `lib/marketData/router.ts` + `kiteProvider.ts`
- **Current provider path:** central `marketDataRouter` (Kite authoritative); candle fallback for price-only
- **Central layer used:** **YES** (already migrated)
- **Missing fields:** CMP for non-curated ETFs/MFs
- **Fake-zero / fake-n/a risk:** LOW for value (nulls render `—`); the issue is honesty of the REASON, not fabrication
- **Yahoo dependency:** NONE for valuation (good)
- **Kite source available:** YES for listed equities/ETFs in the Kite master; NO for mutual funds
- **Root cause of 16/41:**
  1. ETFs like `CPSE ETF`, `SETFGOLD`, `MON100` are not in the curated scored `UNIVERSE` (so `getStockDetail` 404s) AND are not matched by `classifyInstrument` (only `GOLD/SILVER/BEES/ETF/FUND` patterns), so the dedicated `etfQuote` branch is skipped → `searchInstruments` returns 0 → "No instrument match".
  2. Mutual-fund-like instruments have no Kite tradeable instrument at all → genuinely unpriceable from Kite.
- **Fix applied (this pass):** none yet (T004).
- **Planned fix:** broaden ETF classification to route more ETFs through the Kite `etfQuote` branch; classify true mutual funds as an unsupported instrument type with an explicit reason; surface per-holding `valuation_status` (PRICED / UNPRICED / UNSUPPORTED) + `missing_reason` + source provenance; keep uploaded qty/avg preserved.

### B2. Portfolio totals (current value / P&L / allocation / risk)
- **Backend/lib:** `lib/portfolio/calc.ts`, `risk.ts`, `allocation.ts`
- **Current behaviour:** `totalCurrentValue` sums ONLY priced holdings; unpriced invested value tracked separately as `investedNotEnriched`; risk/allocation use only enriched rows. **So priced/unpriced are already NOT silently merged.**
- **Fake-zero risk:** LOW
- **Fix applied (this pass):** none
- **Remaining limitation:** the priced-vs-unpriced split should be made MORE explicit in the summary UI (two labelled totals).

### B3. XIRR
- **Lib:** `lib/portfolio/calc.ts` (`xirr`, `approxXirr`)
- **Unavailable when:** <2 cashflows, no sign change, missing purchase date or CMP. `xirrExcluded` count tracks excluded rows.
- **Fake-zero risk:** none (returns null with reason)
- **Fix applied (this pass):** none
- **Remaining limitation:** surface the EXACT per-portfolio XIRR-unavailable reason string in the card.

### B4. Benchmark comparison
- **Lib:** `lib/portfolio/benchmark.ts`; **Endpoint:** `/api/chart/candles` (segment "index")
- **"Insufficient live data" when:** index series has <2 closes in the holding window.
- **Provider:** Kite index candles → Yahoo fallback for indices with no Kite token (sectorals/NIFTY500). Must be LABELLED secondary, never feeding valuation.
- **Fake-zero risk:** none (explicit unavailable state)
- **Fix applied (this pass):** none
- **Remaining limitation:** label benchmark source (Kite vs Yahoo-delayed) explicitly.

---

## Diagnostics endpoints (planned)
- `GET /api/data/diagnostics/home-market-pulse` — modules checked, provider used, missing fields, fake-zero detections, Yahoo dependencies, stale count, warnings.
- `GET /api/data/diagnostics/portfolio` — total/priced/unpriced/unresolved/unsupported counts, stale count, source_provider counts, XIRR status, benchmark status, warnings.

## Summary of fixes shipped in THIS pass
1. **Global cues fake-zero eliminated** (A2): backend omits price-less entries (no `?? 0`); frontend renders `—` for missing change %; pure builder + unit test.

## Remaining backlog (sequenced, money-first)
- T003: Index analytics → central Kite candle facade + honest "unavailable" labelling (A5).
- T004: Portfolio ETF/MF coverage + per-holding `valuation_status`/`missing_reason`/provenance + explicit priced/unpriced totals + XIRR/benchmark reason surfacing (B1–B4).
- Diagnostics endpoints + frontend secondary/delayed/stale badges (separate approved step).
