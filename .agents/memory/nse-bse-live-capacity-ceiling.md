---
name: NSE+BSE live stock capacity vs Kite 9,000 ceiling
description: The real live-token count for every listed NSE+BSE stock and index — it FITS on one Kite key. Read before scoping full-universe live-data work, and before quoting any raw instrument count as a capacity figure.
---

# Full NSE+BSE listed-stock live coverage FITS a single Kite key

Live-subscribing every **listed NSE and BSE equity plus every index** fits inside
one Kite key's **3 x 3,000 = 9,000** ceiling. Classification:
FITS_WITH_SAFE_HEADROOM. **No second broker or paid feed is needed for capacity
reasons.**

## RETRACTED CLAIM — "~22,800 subscription tokens are required"

That figure is **withdrawn and must not be quoted**. It was the raw Kite
cash-segment instrument-master row count (NSE 10,022 + BSE 12,765 = 22,787), which
is ~87% corporate debt (NCDs, numeric symbols), state/central government securities
(`-SG`), sovereign gold bonds, T-bills, ETFs and mutual funds. It was never a stock
count and never a token requirement; treating it as one overstates the requirement
by roughly 3x and produces a false "impossible on Kite" conclusion.

## Accepted figures — DEVELOPMENT EVIDENCE ONLY, never runtime constants

Measured from the reconciled registry generation, not hardcoded anywhere:

| Quantity | Value |
| --- | --- |
| LIVE_REQUIRED instruments | 7,880 |
| of those, mapped to a provider token | 7,876 |
| of those, unmapped | 4 |
| provider capacity (3 sockets x 3,000) | 9,000 |
| headroom against capacity | 1,124 |

**Why development evidence only:** these are properties of one dated generation.
Any runtime path must recount from the manifest in force at that instant; a
constant would silently keep asserting last month's universe.

**Why:** Kite's `instrument_type` is `EQ` for nearly every cash-segment row
regardless of whether the security is a share, an NCD, or a government bond. The
field cannot be used to identify equity. Classification must come from the
exchange-published security masters, never from Kite metadata.

## Authoritative classification sources (both verified reachable)

- **NSE main board** — `EQUITY_L.csv` at
  `nsearchives.nseindia.com/content/equities/EQUITY_L.csv`. Carries SERIES + ISIN.
  Contains EQ / BE / BZ only. **It does not contain SME.**
- **NSE SME** — `SME_EQUITY_L.csv` at
  `nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv`
  (series SM / ST / SZ). Must be fetched separately or SME is silently missing.
- **NSE ETFs** — `eq_etfseclist.csv`, separate again.
- **BSE (all classes)** — `api.bseindia.com/BseIndiaAPI/api/ListofScripData/w`
  with `segment=Equity` and `status=Active|Suspended`. Returns SCRIP_CD, scrip_id,
  ISIN_NUMBER, GROUP, Status, Segment, Issuer_Name, Mktcap. Needs a browser
  User-Agent plus a `bseindia.com` Referer/Origin. Querying with empty
  segment+status returns `[]` — the filters are mandatory, so enumerate slices.
  BSE GROUP is the authoritative classifier: A/B/X/Z/Y/R = ordinary,
  T/XT/TS/ZP = trade-to-trade, M/MT/MS = SME, P = preference, IP/IF = REIT/InvIT.
  An `INF` ISIN prefix means fund/ETF and overrides group.

## Two join rules that are easy to get wrong

- **NSE:** Kite appends the series to non-EQ symbols — `GATECHDVR-BE`,
  `SANWARIA-BZ`, `OMFURN-SM`, `MDL-ST`. Only EQ-series symbols are bare. A naive
  exact-symbol join silently drops **every** BE, BZ and SME security (a perfect
  0-of-839 miss). Always try `SYMBOL-SERIES` before declaring a record unmapped.
  A suspiciously *perfect* zero-match is a join bug, not a data absence.
- **BSE:** join on BSE `SCRIP_CD` == Kite `exchange_token` (exact, no heuristics).
  Kite's `instrument_token` = `scrip_code * 256 + 4`. Never symbol-match BSE.

## Structural gap that remains

Kite's instrument master carries **no ISIN**, so cross-exchange canonical identity
cannot be built from Kite alone. Both exchange masters do supply ISIN — identity
must be sourced there and mapped down to Kite tokens.

## Operational caveat worth remembering

At ~7,800 tokens the design consumes **all 3 sockets** (~2,600 each). Token headroom
(~1,200) is real but **socket headroom is zero**: losing one socket strands ~2,600
tokens that cannot be redistributed, since the two survivors would need ~3,900 each
against a 3,000 cap. Full-coverage failover is impossible by construction — plan a
priority tier that reconnects first rather than assuming seamless failover.
