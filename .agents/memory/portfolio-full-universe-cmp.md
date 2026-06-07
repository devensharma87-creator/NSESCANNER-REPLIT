---
name: Portfolio full-universe search + CMP
description: Why fixing "NA CMP" for non-curated NSE holdings needs BOTH a search-master AND a resolve fallback, and where the session-independent universe comes from.
---

# Full NSE universe for Portfolio Analyser search + live CMP

The scanner's curated equity catalog is only ~280 names. To support the full
~5,000-name NSE universe in instrument search AND to show a live CMP for any
held symbol, TWO changes are required **together** — fixing only one leaves the
other broken:

1. **Search** — `searchInstruments(query, segment, extraEquities?)` must be fed
   the full master so a non-curated symbol is *findable*. The master comes from
   the disk-cached Kite instrument dump (`.cache/kite_instruments_NSE.json`, read
   via `diskCache.loadBlob`), NOT the live Kite session. **Why:** that blob is
   written whenever the scanner loads Kite instruments, so it works with no live
   session (dev or cold prod). Empty cache → curated fallback only.
2. **Resolve/CMP** — `resolveInstrument(sym,"equity")` must return a generic
   `{segment:equity, exchange:NSE, yahoo:`${sym}.NS`}` for uncurated symbols, so
   the candle datafeed fetches a real Yahoo daily series. Without this, the
   enrich cascade's candle step returns "Unknown instrument" → "NA" CMP even
   when search found the symbol.

**How to apply:** if a future change makes uncurated holdings show "NA" again,
check BOTH paths, not just one. The generic equity fallback is deliberately
gated so a known index/global symbol in the equity segment still resolves null
(don't remove that guard). Invalid tickers stay honestly empty (Yahoo returns
nothing) — never fabricate a CMP.
