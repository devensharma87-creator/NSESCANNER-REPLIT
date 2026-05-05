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
- **Public Access Mode**: Owner-toggleable feature to share the entire site via URL, allowing read-only access for unauthenticated visitors. Non-owners see a "Shared view" badge but no relock form.
- **Kite Connect primary, Yahoo Finance fallback**: Prioritizes real-time data from Kite Connect with Yahoo Finance as a delayed alternative.
- **Windowed OI Delta Correctness**: Implemented four invariants (snapshot merging, baseline selection, market-hours guard, session/day guard) to ensure accurate per-strike Δ calculations.
- **F&O Signal Quality Hardening**: Incorporated ATR-aware minimum stop-loss floors, opening-noise gates for trend-class detectors, and raised high-conviction emission floors to improve signal reliability.
- **Signal labels are classifications, not instructions**: DB / API enums remain `STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL` (do NOT rename — drizzle migration + paper-trade history depend on them). Only the user-facing display strings render as `STRONG BULLISH / BULLISH / NEUTRAL / BEARISH / STRONG BEARISH` (see `signal-badge.tsx`). Compliance-driven, not cosmetic.
- **Public legal pages bypass LoginGate**: `/legal/disclaimer`, `/legal/methodology`, `/legal/terms`, `/legal/privacy` are reachable without auth via a path-based short-circuit in `login-gate.tsx` so disclaimers stay readable from a shared link.

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

- **Kite API Rate Limiting**: Kite Connect API calls are rate-limited and managed with exponential backoff; excessive concurrent requests can lead to throttling. **Never** poll faster than 15s for the F&O Top-50 — Kite's per-second cap will trip a temporary blacklist.
- **OI Change Calculation**: Relies on `oi_day_low`/`oi_day_high` from Kite quotes; discrepancies may arise if these values are not consistently provided.
- **Paper Trading Anti-phantom-trade rules**: Be aware of `tryOpenPaperTrades` routing to `closePaperTradeForSignal` for already-exited signals and `reconcileMissingPaperTrades` only backfilling LIVE lifecycle rows.
- **Signal-display rename**: When changing copy, DO NOT touch the `Signal` enum strings used by API/DB/paper-trade history. Only display-layer text in `signal-badge.tsx` and any hard-coded "Strong Buy"/"Strong Sell" page strings should change.
- **Outstanding audit backlog (next session)**: (1) `DataSourceBadge` shared component on every data page (AUD-005). (2) Blank-panel diagnosis on `deep-scan`, `flows`, `options` charts (AUD-007/008). (3) Pivots on `index-detail` (needs prev-OHLC piped through index-detail endpoint). (4) 5-day mini-sparklines for VIX/DXY/Crude (needs new `/api/market/macroHistory` endpoint). (5) Yahoo-fallback gating for F&O Top-50 (T012, server-side). (6) 15-second opening-window polling for F&O Top-50 (T013). (7) FVG / Liquidity Sweep / Volume-Δ engines (T014–T016, blocked by T012). All five SMC items must ship behind feature flags so any single one can be disabled by env var.

## Pointers

- **Kite Connect API Documentation**: _Populate as you build_
- **Zerodha Kite Connect**: [https://kite.trade/docs/connect/v3/](https://kite.trade/docs/connect/v3/)
- **Drizzle ORM Documentation**: [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **Zod Documentation**: [https://zod.dev/](https://zod.dev/)
- **TanStack Query Documentation**: [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **OpenAPI Specification**: [https://swagger.io/specification/](https://swagger.io/specification/)