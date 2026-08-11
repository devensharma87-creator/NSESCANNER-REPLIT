---
name: NSE+BSE full live coverage exceeds Kite capacity
description: The hard provider ceiling that makes "live quotes for every NSE and BSE listing" unachievable on a single Kite key — check this before scoping any full-universe live-data work.
---

# Full NSE+BSE live coverage does not fit a single Kite API key

Subscribing every NSE and BSE instrument (indices + all tradable scrips) requires
**~22,800 simultaneous tokens**. A single Kite Connect API key permits
**3 WebSockets x 3,000 tokens = 9,000**. The requirement is ~2.5x the ceiling.

**Why:** This is a provider contract limit, not a code or architecture defect. No
amount of sharding, batching, or refactoring inside the app can raise it. Any plan
that promises "live data for every NSE and BSE stock" on one Kite key is
arithmetically impossible and will fail acceptance no matter how well it is built.

**How to apply:** Before scoping full-universe live-data work, decide which of these
the owner is buying, and say so explicitly:
1. **Narrow the live tier** — live-subscribe a defined eligible subset, not everything.
2. **Tiered live + snapshot** — top-N by liquidity on WebSocket (LIVE), remainder on
   REST snapshot labelled as snapshot, never as LIVE. REST full sweep = ~46 calls
   at 500 instruments per batch.
3. **Add a second feed** (e.g. Upstox) purely for overflow capacity.
4. **Licensed direct exchange feed** — real vendor cost.

Never present option 2's snapshot rows as tick-streaming LIVE data.

## Two structural gaps that compound this

- **Kite's instrument master carries no ISIN.** Fields are limited to
  instrument_token / exchange_token / tradingsymbol / name / last_price / expiry /
  strike / tick_size / lot_size / instrument_type / segment / exchange. Any canonical
  cross-exchange security identity therefore *cannot* be built from Kite alone.
  NSE's EQUITY_L.csv does supply ISIN. Symbol-only NSE<->BSE joins are a diagnostic
  heuristic only and must never be treated as authoritative identity.
- **BSE has no authoritative security master wired.** NSE gained one (EQUITY_L.csv,
  giving series -> ordinary/T2T/SME classification). BSE never got the equivalent, so
  every BSE scrip is effectively unclassified — the same defect NSE had before that
  join existed. Classifying BSE requires sourcing a BSE-published list first;
  filtering BSE by Kite metadata alone cannot distinguish equity from debt or
  suspended scrips.

**Consequence:** the BSE side of any universe count is not trustworthy until a BSE
authoritative reference exists. Do not quote a "BSE eligible equity" number derived
purely from the Kite master.
