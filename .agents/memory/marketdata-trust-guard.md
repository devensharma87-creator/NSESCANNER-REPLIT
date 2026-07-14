---
name: Market-data trust-tier guard
description: How the central market-data layer enforces "only fresh authoritative data is tradeable", and the hard-stale gap to avoid reintroducing.
---

# Market-data trust-tier guard (lib/marketData)

The guard (`isTradeableMeta`/`assertTradeable`) is the ONLY way to obtain a branded `TrustedQuote`/`TrustedCandleSeries`. Trading/signal/valuation/F&O paths must consume branded values, so non-authoritative data can never silently power a decision.

## Rule: hard-stale is NEVER tradeable, independent of env
`validator.buildMeta` assigns `validationStatus="stale"` when data is older than `staleBudgetSec`. `isTradeableMeta` rejects `"stale"` UNCONDITIONALLY — it must not be gated behind `MARKETDATA_STRICT_FRESHNESS`.

**Why:** strictFreshness defaults to FALSE. Originally only the soft `meta.isStale` check was env-gated, so very old (hard-stale) authoritative Kite quotes could still be branded tradeable in the default config — a "no-compromise" violation. Architect caught this during Task #122 review.

**How to apply:** keep the explicit `if (meta.validationStatus === "stale") return false;` in `isTradeableMeta`. `strictFreshness` only controls rejection of SOFT-stale (freshness-budget breach, `validationStatus` still "validated" but `isStale=true`). Distinction: soft-stale = past freshness budget; hard-stale = past stale budget.

## Provider trust tiers (do not relax without a task)
- Kite = `authoritative` (the only tradeable tier; `isTierTradeable` returns true only for "authoritative").
- Yahoo = `secondary_analytics` + `notForSignals=true` → permanently blocked from tradeable paths; the router never falls back to Yahoo for trusted quote/candle methods. Yahoo is analytics-only (global assets, VIX fallback, portfolio benchmarks).
- INDstocks = `secondary_validation`, DISABLED by default (`INDSTOCKS_ENABLED` flag, fail-closed on unrecognised values); even when enabled it is validation/failover, never a trading primary.
