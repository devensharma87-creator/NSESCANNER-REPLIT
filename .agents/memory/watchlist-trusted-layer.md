---
name: Watchlist sources prices from the central trusted layer
description: How the watchlist backend sources prices (central Kite-authoritative layer) and uses the scanner only for enrichment.
---

# Watchlist data sourcing (post Task #125 migration)

Both watchlist paths now obtain PRICES exclusively from the central trusted
market-data layer (`marketRouter.getEquityQuotes`, Kite authoritative):
- `/watchlist/basket/:basketKey` → `buildBasket()` in `watchlistBasket.ts`
- `/watchlist/:key` → `getWatchlist()` in `watchlist.ts`

The live scanner (`scanAll()`) is reused ONLY to ENRICH a row with the system
signal (→ trend) and EMA20/EMA50/RSI14. It NEVER supplies price/OHLC/volume.
Yahoo is never consulted for watchlist prices/signals, and there is no direct
provider import in either consumer (enforced by the burn-down provider-import
guard + `watchlistConsumerImports.test.ts`).

**Why:** the old design built rows from scanner data and fell back to
per-symbol Yahoo fetches for off-universe symbols, which got rate-limited and
silently dropped rows → empty baskets. The trusted layer does ONE batched
Kite call per basket, so baskets stay full; constituents Kite cannot price are
reported as honest `provenance.missingSymbols` (never fabricated, never
back-filled from a delayed source).

**How to apply:** any change to watchlist data sourcing must keep the central
router as the only price source and the scanner as enrichment-only. The
response carries a `provenance` envelope (sourceProvider/sourcePriority/asOf/
freshnessSec/isStale/fallbackUsed/warnings/missingSymbols) — keep it honest
(`fallbackUsed` computed from the returned quotes' trust tier, not assumed).
Pure mapper is `rowFromTrustedQuote` with strict non-synthetic gating
(incomplete quote → null → missingSymbols).
