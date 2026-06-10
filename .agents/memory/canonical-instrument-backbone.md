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

## NSDL / Yahoo-fallback honesty
NSDL is BSE-only and **Kite cannot serve it** in this path — it prices via Yahoo (.BO) only.
Do NOT remove the Yahoo fallback to satisfy a "Kite-only valuation" request: that re-breaks
NSDL. Instead surface `quote_source` per row (kite vs yahoo) so valuation provenance is honest.

**How to apply:** the owner-only diagnostics endpoint
`GET /api/data/diagnostics/portfolio-resolution` returns per-holding resolver attempts +
canonical mapping + `quote_found`/`quote_source`/`valuation_status`/`missing_reason`; default
payload is the 8 historically-broken symbols. Use it to prove resolution end-to-end without
fabricating CMP. Recommendation status is honestly `NO_SCANNER_ROW` for non-curated symbols
(they are not in the scan SET — the resolver/quote backbone is separate from the scan set).
