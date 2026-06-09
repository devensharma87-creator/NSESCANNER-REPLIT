---
name: Watchlist must serve from scanner rows, not per-symbol Yahoo
description: Why the watchlist backend builds rows from scanAll() and only falls back to Yahoo for off-universe symbols.
---

The watchlist backend (`getWatchlist`) must build each basket row directly from the
Kite `scanAll()` scanner rows (price/OHLC/indicators/signal), using `rowFromScanner`.
Yahoo (`buildRow`) is a fallback **only** for `offUniverse` symbols that are not present
in the scan.

**Why:** The original bug pulled scanner rows but used them ONLY for the trend signal,
then re-fetched every basket symbol's price/OHLC from rate-limited per-symbol Yahoo
charts. Under rate limiting those per-symbol fetches dropped, so most baskets rendered
0 stocks (Sensex showed 8/30). The scanner already has live Kite data for the whole
universe, so re-fetching it per-symbol is both wasteful and fragile.

**How to apply:** Any change to watchlist data sourcing must keep scanner rows as the
PRIMARY source and reserve Yahoo for genuinely off-universe symbols. Honest partials:
symbols with no real data are omitted and surfaced via the existing "Stale" badge —
never fabricated. Observability fields `fromScanner` / `fromYahooFallback` / `offUniverse`
in the diagnostic log indicate whether scanner-primary serving is healthy.
