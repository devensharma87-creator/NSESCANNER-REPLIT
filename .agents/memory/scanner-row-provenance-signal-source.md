---
name: Scanner row provenance = signal source, not price source
description: Why scanner StockRow provenance must be stamped by the indicator/signal source, never the live LTP source.
---

# Scanner row provenance must be stamped by the SIGNAL source, not the price source

Scanner rows carry a provenance envelope consumed by `shouldDemoteSignal`
(`scannerProvenance.ts`). Stamp it by the source of the **recommendation/score
(the indicators)**, NOT by the source of the live price/LTP.

**Why:** the curated scanner (`scanner.ts buildRow`) and the full-NSE
`rowFromKitePlusIndicators` compute their swing recommendation ENTIRELY from
Yahoo daily history — there is no Kite candle path feeding those indicators. A
live Kite LTP only overlays the displayed *price*. The original code stamped
`provider: live ? "kite" : "yahoo"`, so a live Kite tick silently flipped a
Yahoo-derived signal to `authoritative` and `shouldDemoteSignal` stopped
demoting it — a real honesty leak caught in architect review.

**How to apply:** for any row whose signal/score is Yahoo-derived, pass
`provider: "yahoo"` to `buildSourceProvenance` regardless of price source; keep
`asOf` = freshest displayed instant (Kite LTP when live) so freshness still
tracks the price, and add a warning like "live price from Kite; indicators from
delayed Yahoo". The exception is `rowFromKiteOnly` (momentum-only, NO Yahoo
indicators) — its degenerate price-change signal genuinely comes from the quote
source, so it keeps the real Kite/Yahoo quote-source label.
