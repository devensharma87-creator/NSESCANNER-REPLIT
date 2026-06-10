---
name: Canonical instrument backbone (resolve + autocomplete dedupe)
description: How NSE/BSE symbol resolution + the /chart/instruments autocomplete merge behave, and the dual-listing dedupe rule.
---

# Canonical instrument backbone

The single symbol→instrument→quote path is the resolver lib + the `/chart/instruments`
search that feeds Charting, Portfolio Add-Holdings autocomplete, and search. It merges the
curated UNIVERSE (~280 + indices + global) with the **full Kite disk master** (NSE+BSE,
session-independent on disk) so any real listed symbol/ETF resolves, not just curated names.

## Dual-listing dedupe rule (why autocomplete showed duplicates)
Many tickers are listed on BOTH NSE and BSE (TRIDENT/BDL/ARE&M/INDHOTEL/BLS). Merging
curated + master naively shows each twice. Dedupe by **uppercased symbol**:
- curated rows rank first and win ties;
- among master hits, `searchMaster` already ranks NSE ahead of BSE, so the NSE listing wins;
- **BSE-only names (e.g. NSDL) must survive** because no NSE/curated row shadows them.

**Why:** a symbol-key dedupe that drops on first-seen both removes NSE/BSE dupes AND preserves
BSE-only listings in one pass. Keep the merge as a pure helper so it stays unit-testable.

## Provenance
DTO/autocomplete rows carry `source: "curated" | "kite_master"`. The UI shows the label so the
operator can tell a curated name from a long-tail master hit.

## BSE-via-Kite pricing (NSDL) — Kite CAN serve BSE by instrument_token
Kite serves BSE-listed equities through `getHistoricalData(instrument_token, …)` /
`getQuote("BSE:NSDL")` — the only reason BSE names (e.g. NSDL, BSE token 139383556) used to
fall to Yahoo (.BO) was that the chart datafeed's Kite path resolved a token via the
**NSE-only** `getInstrumentToken` symbol lookup. Fix: the resolver threads its
`instrument_token` through `ChartInstrumentMeta.instrumentToken`; `chartDatafeed.tryKite`
prefers a token-based fetch (`fetchKiteEquityIntradayByToken`) for equities when a token is
present, so BSE prices via Kite first. NSDL now resolves `source=kite` (last ≈ 822).
- **Keep the Yahoo (.BO) fallback** — it is the honest labeled fallback when the Kite token
  fetch returns null, NOT the primary. Surface `quote_source` per row (kite vs yahoo).
- Curated NSE names carry NO `instrumentToken` (from `resolveInstrument`) so their behaviour is
  unchanged — only master-fallback (long-tail) rows get the token path.
- **Why:** historical cache keys are label-based; the token path keys the cache by
  `EQ:<symbol>@<token>` so a dual-listed name can't serve wrong-exchange candles.

**How to apply:** the owner-only diagnostics endpoint
`GET /api/data/diagnostics/portfolio-resolution` returns per-holding resolver attempts +
canonical mapping + `quote_found`/`quote_source`/`valuation_status`/`missing_reason`; default
payload is the 8 historically-broken symbols. Use it to prove resolution end-to-end without
fabricating CMP. Recommendation status is honestly `NO_SCANNER_ROW` for non-curated symbols
(they are not in the scan SET — the resolver/quote backbone is separate from the scan set).
