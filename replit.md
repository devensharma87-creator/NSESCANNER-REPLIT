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
- **Public legal pages bypass LoginGate**: `/legal/disclaimer`, `/legal/methodology`, `/legal/terms`, `/legal/privacy` are reachable without auth via a path-based short-circuit in `login-gate.tsx` so disclaimers stay readable from a shared link. **`layout.tsx` mirrors the same path check** — when `location.startsWith("/legal/")` it returns a stripped chrome (brand header + minimal legal-only footer, no nav / IndianStrip / GlobalStrip / search / PublicModeBanner / paper-trade controls / Kite reauth). Without this mirror, an unauth visitor would still see the owner-only sidebar shell rendered around the legal copy.
- **Macro 5D sparklines via dedicated endpoint**: `GET /api/market/macroHistory` (handler in `routes/scanner.ts`, lib in `lib/macroHistory.ts`) returns 5-day daily closes for `^INDIAVIX`, `^VIX`, `DX-Y.NYB`, `CL=F` from Yahoo `5d/1d` charts; cached in-process for **5 minutes** (these tiles barely move intraday vs spot quotes — a tighter TTL would just thrash Yahoo). UI consumes via `<GlobalCuesStrip>` which renders a tiny inline SVG `<Sparkline>` next to VIX / DXY / India VIX / WTI Crude tiles. The `invert` flag flips the sparkline colour scale so a rising VIX/DXY/IndiaVIX paints red (bearish for equities) — same convention as the tile's pct-change colour. Series silently omitted (not zero-filled) on individual fetch failure.

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
- **F&O signal pipeline is STRICT KITE-ONLY (2026-05-06)**: Yahoo intraday fallback was ripped from `optionSignals.ts` (signal emission), `liveBias.ts` (per-index bias card), and `tradingConfig.isActionableForFno` (paper-trade entry gate). When Kite intraday is unavailable, signals **suppress** with reason `no_live_kite_intraday` and the live-bias card returns null (UI shows "Live data unavailable") — instead of emitting on 15-min-stale Yahoo bars that produced phantom triggers, wrong entries, and broker/signal mismatch. **Daily history still uses Yahoo** (EOD bars, no live-data sensitivity). **Escape hatch**: `PAPER_TRADE_ALLOW_YAHOO=1` re-permits Yahoo-quality paper-trade entries (default OFF). Every suppression is logged in the `MissedSignals` ring buffer and surfaced in the Paper Trading "Skipped & missed signals" card. **Yahoo intentionally KEPT** in `indicesBoard.ts` (global/commodity/ADR/FX rows — Kite has no US/EU/HK/Forex/commodity coverage), `financials.ts` (no Kite fundamentals API), `newsRss.ts` (Yahoo Finance RSS), `fullNseScanner.ts` + `scanner.ts` + `swingSignals.ts` (EQ scanner fallback when Kite session expires — without it the Stocks page would return zero rows during outages).
- **MissedSignal log dedup**: `recordMissedSignal()` returns `boolean` (true if newly added). All three skip-site `logger.info` calls in `paperTradingFO.ts` gate on that boolean to avoid the "MIDCPNIFTY missed-window logs every poll cycle for the rest of the day" spam pattern.
- **Signal-display rename**: When changing copy, DO NOT touch the `Signal` enum strings used by API/DB/paper-trade history. Only display-layer text in `signal-badge.tsx` and any hard-coded "Strong Buy"/"Strong Sell" page strings should change.
- **Outstanding audit backlog (next session)**: (1) Yahoo-fallback gating for F&O Top-50 (T012, server-side). (2) 15-second opening-window polling for F&O Top-50 (T013). (3) FVG / Liquidity Sweep / Volume-Δ engines (T014–T016, blocked by T012). All three SMC items must ship behind feature flags so any single one can be disabled by env var. **Shipped this batch (T001-T011)**: `/legal/*` chrome strip in `layout.tsx`; `mmi-gauge.tsx` parity guard with `market-mood.tsx`; `DataSourceBadge` on dashboard / sectors / news / deep-scan / option-chain (uses `chain.generatedAt` not `lastUpdated`); `strategies.tsx` model-assumptions disclosure card; `/api/market/macroHistory` endpoint + 5D sparklines on VIX / DXY / India VIX / WTI Crude tiles in `<GlobalCuesStrip>`. **T008 + T009 shipped (this batch)**: see "Indices Board hang protection" and "Empty-state copy" gotchas below.
- **Indices Board hang protection (T008)**: `getIndicesBoard()` now wraps `getKiteIndexQuotes()` and `getTvQuotes()` in an 8s `Promise.race` deadline (`OVERLAY_TIMEOUT_MS`), since Yahoo helpers self-timeout at 6s but Kite/TV did not — a hung HTTP socket on either could leave `/api/indices` pending forever and the UI stuck on "Loading indices board…". On timeout the overlay returns `null` / empty Map and the board falls back to Yahoo with `DELAYED` labels (graceful degradation, never throws). Client-side `<IndicesBoard>` adds a 25s `loadingTooLong` flag that swaps the bland "Loading…" card for an amber actionable Retry card — protects against any *future* hang we haven't yet found. Both layers needed: server fix kills the actual hang, client fix prevents the "infinite spinner" UX whenever any single request runs slow.
- **Empty-state copy with timestamps (T009)**: Pages with panels that can render empty after a successful upstream fetch now show explicit "No live data — last attempt X" + Retry button instead of generic "No data" or perpetual `Skeleton`. Implemented on: `flows.tsx` FII/DII Cash Market view (passes `fiiQ.dataUpdatedAt`), `flows.tsx` Participant OI section (uses `participantQ.dataUpdatedAt`), `option-chain.tsx` four summary cards — PCR / Max Pain / ATM IV / Total OI — gated on `analyticsEmpty = analyticsQ.isFetched && !analytics` so a *fetched-but-empty* response shows "No live chain data" rather than a Skeleton that looks like loading-forever. The distinction matters: `Skeleton` while `isFetching` is correct UX; `Skeleton` while `isFetched && !data` is misleading.
- **Index-detail pivots wired (`/api/index/:slug`)**: Endpoint now returns `previousHigh`, `previousLow`, and a classical-floor `pivots: {pivot, r1, r2, s1, s2}` block computed from the prior session's H/L/C via `lib/indicators.pivots()`. Block is omitted (not zeroed) when prev H/L missing — the client `<PivotLadder>` only renders when present, never falls back to a degenerate pivot.
- **Side-correct R/S in OI analytics**: `optionAnalytics.computeAnalytics()` AND `oiLab.computeAnalytics()` filter `topResistance` to CE strikes ≥ spot and `topSupport` to PE strikes ≤ spot before sorting by OI. Without the filter, ITM-side hedging OI bubbled up as the displayed wall — e.g. BANKNIFTY snapshot rendered `R=S=60000` with spot 54729 (60000 PE is deep-ITM, not real support). Aggregates (PCR / max-pain / total OI) are unfiltered. Snapshot UI renders "Pin: X" instead of "R: X · S: X" when top CE strike equals top PE strike (now meaningful: ATM magnet, not duplicate).
- **Paper-trade LTP is live, not lifecycle-cached**: `GET /paper/positions/fo` and the manual-close `POST /paper/positions/fo/:id/close` BOTH refresh `lastPremium` from a fresh `fetchOptionChain()` pull at request time (de-duplicated per underlying, gated by the chain's 15s in-process cache). Before this fix, the UI's 10s poll was bound to the lifecycle-hook write cadence (`TRIGGER_SWEEP_INTERVAL_MS` = 60s, now 30s) — so the displayed LTP could be 30–60s stale and a force-exit would settle at that stale price. Now: UI shows true live LTP; manual close settles at the latest LTP. `unrealizedPnl` and `lastEvaluatedAt` are recomputed from the live LTP. Falls back to stored `last_premium` if the chain fetch fails (logged as `Live LTP enrichment: option chain fetch failed`). UI column header is "LTP" (was "LAST"). See `paper.ts::fetchLiveLtpForOpenRows()`.
- **F&O signal sweep cadence: 30s (was 60s)**: Halved `TRIGGER_SWEEP_INTERVAL_MS` in `optionSignals.ts` so the "MISSED_WINDOW" anti-phantom race window is half what it was. A signal that triggers AND hits T1/T2/SL between two consecutive sweeps still cannot be opened (anti-phantom rule forbids same-cycle open+close), but the median catchable trade is now 2× faster. Kite per-second rate cap is comfortably under one F&O chain pass per index per 30s. **Do NOT drop below 15s** — that's where Kite throttling starts to bite.

## Pointers

- **Kite Connect API Documentation**: _Populate as you build_
- **Zerodha Kite Connect**: [https://kite.trade/docs/connect/v3/](https://kite.trade/docs/connect/v3/)
- **Drizzle ORM Documentation**: [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **Zod Documentation**: [https://zod.dev/](https://zod.dev/)
- **TanStack Query Documentation**: [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **OpenAPI Specification**: [https://swagger.io/specification/](https://swagger.io/specification/)