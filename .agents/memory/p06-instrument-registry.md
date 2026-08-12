---
name: Phase 0.6 authoritative instrument registry
description: Durable facts about the NSE/BSE instrument registry, its official sources, and the classification rules that hold across sessions.
---

# Official source facts (verified against real data)

- **`eq_etfseclist.csv` is Windows-1252, not UTF-8.** Decode `latin1` or security
  names corrupt into replacement characters. The other two NSE CSVs are valid
  UTF-8.
- **The NSE ETF publication shares ZERO symbols with `EQUITY_L.csv`.** Treating
  it as a reclassification overlay silently excludes every ETF. It must be
  ingested as official records in its own right, with a dedupe guard in case the
  two lists ever overlap.
- **BSE fetches need a browser UA plus a `bseindia.com` Referer/Origin.**
- Kite `instrument_type` is `EQ` for 100% of NSE and BSE equity rows — it
  classifies nothing.

# Classification authority

**The official BSE `Segment` field is the authority, never the group letter.**
Proven by the four `Segment='PreferenceShares'` rows, which span groups P and Y;
group P also carries ordinary equity. Group `IP` is ordinary equity, not a
REIT/InvIT. Group `R` with a blank `Segment` is a rights entitlement.

# Design rules that must not be re-litigated

- **Tier is a POLICY tier, not a mapping outcome.** An unmapped LIVE_REQUIRED
  security stays LIVE_REQUIRED and is reported as unmapped. Demoting it would
  erase the coverage gap instead of reporting it.
- **Duplicate provider token ⇒ reject ALL claimants.** Never pick a winner. The
  rejection must stay visible in its own counter, because the invariant counter
  (over *retained* tokens) necessarily reads zero once rejection works.
- **`firstSeenAt` is keyed on the stable official identity**, never on a
  canonical id derived from the trading symbol — otherwise a symbol or series
  change resets an instrument's history and it looks newly listed.
- **A symbol containing `:` cannot form an `EXCHANGE:SEGMENT:SYMBOL` canonical
  id.** Real case: BSE index `BSE SENSEX SIXTY 65:35`. Minting refuses it and the
  record is retained as UNRESOLVED rather than mangled or dropped.
- `EXCLUDED_NON_STOCK` reads 0 because only equity/ETF masters are ingested —
  that zero describes the input scope, not the market. Always state this when
  reporting the reconciliation.

# Outstanding

- `BSE_REFERENCE_FRESHNESS_POLICY = "OWNER_AUTHORIZATION_REQUIRED"` — BSE
  publishes no dated security master, so whether a reused snapshot may back a
  LIVE_REQUIRED tier is an owner decision.
- Consumer classification was never implemented: the manifest is authoritative
  in storage but no consumer reads it as its universe authority.
