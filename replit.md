# Indian Stock Market Scanner

A comprehensive platform for scanning and analyzing the Indian stock market, providing real-time insights for traders and investors.

## Run & Operate

_Populate as you build_

## Stack

- **Frameworks**: Express 5 (backend), React (frontend)
- **Runtime**: Node.js
- **Language**: TypeScript 5.9
- **ORM**: Drizzle ORM
- **Validation**: Zod v4, drizzle-zod
- **Build Tool**: Vite, esbuild
- **Monorepo**: pnpm

## Where things live

- `api-server/`: Express API backend
- `scanner/`: React + Vite frontend
- `global-scanner/`: Global multi-asset React + Vite frontend
- `api-server/src/db/schema.ts`: Database schema definition (Drizzle)
- `artifacts/api-server/src/openapi.yaml`: OpenAPI specifications for API
- `scanner/src/theme/`: UI theme configurations

## Architecture decisions

- **HMAC-SHA256 HttpOnly session cookies**: For secure authentication with role-based access control.
- **Public Access Mode**: Owner-toggleable feature to share the entire site via URL, allowing read-only access for unauthenticated visitors.
- **Kite Connect primary, Yahoo Finance fallback**: Prioritizes real-time data from Kite Connect with Yahoo Finance as a delayed alternative.
- **Windowed OI Delta Correctness**: Implemented four invariants (snapshot merging, baseline selection, market-hours guard, session/day guard) to ensure accurate per-strike Δ calculations.
- **F&O Signal Quality Hardening**: Incorporated ATR-aware minimum stop-loss floors, opening-noise gates for trend-class detectors, and raised high-conviction emission floors to improve signal reliability.

## Product

- Market scanning (NSE/BSE)
- Advanced options chain analysis (Black-Scholes, Greeks, PCR, Max Pain)
- F&O intraday signals (Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback)
- Stock-specific catalyst tracking
- Secure user authentication with role-based access
- Paper trading for F&O and equities
- P&L reports and journal analytics
- Global multi-asset scanning (Crypto, Commodities, Forex, Global Equities/Indices)

## User preferences

I prefer clear and concise communication. For coding, I favor functional programming paradigms where applicable. I expect an iterative development approach with regular updates on progress. Please ask for confirmation before implementing any major architectural changes or feature deprecations. Ensure that all new features are accompanied by appropriate tests and documentation. I prefer detailed explanations for complex logic or design decisions.

## Gotchas

- **Kite API Rate Limiting**: Kite Connect API calls are rate-limited and managed with exponential backoff; excessive concurrent requests can lead to throttling.
- **OI Change Calculation**: Relies on `oi_day_low`/`oi_day_high` from Kite quotes; discrepancies may arise if these values are not consistently provided.
- **Paper Trading Anti-phantom-trade rules**: Be aware of `tryOpenPaperTrades` routing to `closePaperTradeForSignal` for already-exited signals and `reconcileMissingPaperTrades` only backfilling LIVE lifecycle rows.

## Pointers

- **Kite Connect API Documentation**: _Populate as you build_
- **Zerodha Kite Connect**: [https://kite.trade/docs/connect/v3/](https://kite.trade/docs/connect/v3/)
- **Drizzle ORM Documentation**: [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **Zod Documentation**: [https://zod.dev/](https://zod.dev/)
- **TanStack Query Documentation**: [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **OpenAPI Specification**: [https://swagger.io/specification/](https://swagger.io/specification/)