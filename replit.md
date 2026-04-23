# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **api-server** (`artifacts/api-server`) — Express API. Routes under `/api/*` (scanner, market summary, index detail, stock detail, options, news, provider status). Yahoo is the live data source; `lib/dataProvider.ts` is a scaffold for switching to Zerodha Kite when KITE_API_KEY/SECRET/ACCESS_TOKEN are set.
- **scanner** (`artifacts/scanner`) — React + Vite NSE/BSE tracker. Pages: `/` dashboard (MMI gauge, clickable index cards w/ breadth), `/scanner` full table, `/index/:slug` index detail, `/stock/:symbol` enriched stock page (KeyStats + Sector Peers via Yahoo quoteSummary), `/sectors`, `/options`, `/news`.
- **mockup-sandbox** (`artifacts/mockup-sandbox`) — component preview server.

## NSE Scanner notes

- Stock universe defined in `artifacts/api-server/src/lib/universe.ts` (~280 NSE F&O / index constituents). `INDEX_CONSTITUENTS` maps each index slug → ticker list (NIFTY50, BANKNIFTY, FINNIFTY, IT, AUTO, PHARMA, FMCG, METAL, REALTY, ENERGY).
- `breadth.adRatio` is `null` when decliners=0 and advancers>0 (UI renders "∞").
- Fundamentals fetched lazily via `fetchFundamentals()` (Yahoo quoteSummary, 1h cache).
- **Option Chain (T002)**: `lib/optionChain.ts` orchestrates two sources for `/api/options/chain/:underlying` — (1) Kite Connect (`lib/kiteOptionChain.ts`, primary, works from any IP when user has authenticated daily) using NFO instrument dump + batched `getQuote`; (2) NSE direct (fallback, only works from Indian IPs). 15s response cache. F&O universe of 199 entries (5 indices + 194 equities, sector-grouped) lives in `artifacts/scanner/src/data/fnoUniverse.ts`. Chain page (`pages/option-chain.tsx`) has searchable picker, ATM-centered ±25-strike grid with OI/ΔOI heatmap, and informative error UI that shows live Kite-session state.
