# Provider-import burn-down (trusted market-data layer)

**Status:** in progress — foundation locked, consumers migrating.
**Guard:** `artifacts/api-server/src/lib/marketData/providerImportGuard.ts`
(+ `providerImportGuard.test.ts`, allowlist `providerImportAllowlist.json`).

## Why this exists

Every price / candle / option-chain read is supposed to flow through the central
market-data layer (`artifacts/api-server/src/lib/marketData/`) so that trust,
freshness, provenance and failover are decided in ONE place. Code that reaches
around the layer and imports a raw provider directly (`./yahoo`, `./kiteFeed`,
`./kiteIntraday`, `./kiteScanner`, `./kiteOptionChain`, `./kiteIndexQuotes`,
`./kiteAuth`, `./kiteFnoInstruments`, `./nseBhavcopy`, or the `yahoo-finance2`
npm package) bypasses those guarantees.

The guard does **not** migrate consumers — it locks the boundary so the backlog
can only shrink, never grow.

## How the guard behaves (burn-down mode)

The guard scans `src/lib/**` + `src/routes/**` for direct provider imports and
compares the live set against the frozen allowlist. It **FAILS** when:

1. A **new** non-allowlisted file gains a direct provider import (no new
   bypasses), **and**
2. An **allowlisted** file is now clean — i.e. it was migrated onto the layer, so
   the allowlist entry is stale and must be removed (forces the list to shrink).

`import type { … }` is ignored (type-only imports carry no runtime coupling).
The layer itself, the provider wrappers, and test files are exempt.

## Reseeding the allowlist

After migrating a file off a provider (or when the scan legitimately changes),
regenerate the frozen list:

```
UPDATE_IMPORT_ALLOWLIST=1 pnpm --filter @workspace/api-server exec vitest run --pool=threads src/lib/marketData/providerImportGuard.test.ts
```

Commit the updated `providerImportAllowlist.json`. Only ever let it get shorter.

## Current backlog (migration targets)

The allowlist currently holds **16 files / 29 direct import-pairs**. (Note: the
`replit.md` architecture note quotes the original seed of "34 files / 64
import-pairs" — that figure is historical; the burn-down has already reduced it.)

Remaining files, each paired with the provider module(s) it still imports
directly:

| File | Direct provider imports |
|---|---|
| `lib/candleWarehouseIngestor.ts` | kiteFeed, kiteIntraday |
| `lib/dailyReports.ts` | kiteAuth, kiteFeed |
| `lib/dataProvider.ts` | kiteAuth, kiteFeed |
| `lib/indexFuturesVolume.ts` | kiteAuth, kiteFnoInstruments, kiteIntraday |
| `lib/kiteReadiness.ts` | kiteAuth, kiteFeed |
| `lib/marketDataHealth.ts` | kiteFeed |
| `lib/oiLab.ts` | kiteAuth, kiteFnoInstruments, kiteIntraday |
| `lib/optionChain.ts` | kiteFeed, kiteIndexQuotes, kiteOptionChain |
| `lib/optionSignals.ts` | kiteAuth |
| `lib/systemStatus.ts` | kiteAuth, kiteFeed |
| `routes/fno.ts` | kiteAuth, kiteFeed |
| `routes/index.ts` | kiteFeed |
| `routes/kite.ts` | kiteAuth, kiteFeed |
| `routes/oiLab.ts` | kiteAuth |
| `routes/optionChain.ts` | kiteAuth |
| `routes/optionStrategies.ts` | kiteAuth |

## Migration guidance (per file)

Migrating a consumer means replacing its direct provider import with the
equivalent trusted-layer facade, so the read is trust/freshness/provenance-tagged:

- Index / equity quotes → `router.getIndexQuote` / the batch quote facade.
- Option chains → `getOptionChain` / `evaluateOptionChain` (layer barrel).
- Candles → the layer's candle path (which stamps provenance and respects the
  `upsertCandles` write guard so a lower-trust row can never overwrite Kite).
- Session/auth (`kiteAuth`) reads are often the last to migrate — keep them
  behind the layer's session accessors rather than importing `kiteAuth` directly.

Do NOT change trading, signal, sizing, gate, or scheduler behaviour while
migrating — this is a sourcing-boundary refactor only. After a file is clean,
reseed the allowlist (above) so the guard records the win.
