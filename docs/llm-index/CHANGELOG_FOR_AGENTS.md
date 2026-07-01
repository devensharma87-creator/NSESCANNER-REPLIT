# Changelog for Agents

Reverse-chronological log of significant changes. Add an entry **before** marking your task complete.

Format: `## YYYY-MM-DD — <short title>` then bullet points with: what changed, what files, what to re-read.

---

## 2026-07-01 — Home / Market Pulse Per-Section Source Honesty (Phase 1)

- Every Home page section now renders a visible source/freshness label from a single pure contract: `artifacts/scanner/src/lib/homeMarketPulseSourceMap.ts` (`resolveHomeSectionSource` — `canDriveSignals` true ONLY when descriptor permits AND status is `TRADE_GRADE`)
- New `SectionSourceLabel` (`components/ui/section-source-label.tsx`, `data-testid=section-source-<id>`) wired across all Home components (sentiment-bar, breadth-bar, sectoral-heatmap, market-breadth, fno-ban-widget, indices-board, index-tabs, trend-card, mmi-gauge, market-take, dashboard movers+setups)
- Row-aware board grades: `home-markets` + `home-indices` trade-grade only when every displayed row is a Kite tick + session live; aggregate `asOf` = OLDEST row; dashboard `moversRuntime` treats missing provenance as non-trade-grade
- Fake-zero fixes: VIX null→"—", breadth 0→unavailable, sector null→"—", market-take breadth narrative gated on finite `advanceDeclineRatio`
- Scope: frontend + pure contract/tests ONLY — no trading/F&O/swing/broker/scheduler/DB/schema change
- **Re-read if**: touching Home page data labels or adding a new Home section — extend the descriptor table in `homeMarketPulseSourceMap.ts`
- **Files**: `artifacts/scanner/src/lib/homeMarketPulseSourceMap.ts` (+ `.test.ts`), `artifacts/scanner/src/components/ui/section-source-label.tsx`, `artifacts/scanner/src/pages/dashboard.tsx`, `artifacts/scanner/src/components/home/*`, `artifacts/scanner/src/components/{indices-board,trend-card,mmi-gauge,fno-ban-widget}.tsx`

## 2026-07-01 — LLM Index System Formally Verified

- Full verification audit conducted against all acceptance criteria (Parts A–K)
- Stale-index detection proved: exit 1 on change, exit 0 after regeneration
- Secret scan: CLEAN — no tokens, passwords, or DB credentials in any generated file
- 472 vs 307 count difference documented: test files summarized but not tracked; 2 YAML files tracked but not TypeScript-summarizable — intentional design
- Implementation report created: `docs/llm-index/LLM_INDEXING_IMPLEMENTATION_REPORT.md`
- Known gap documented: staleness tracker uses one-level flat walk; ~24 production files in subdirectories are summarized but not hash-tracked
- **Re-read if**: debugging why stale check doesn't detect a changed file (check if it's in a subdirectory)
- **Files**: `docs/llm-index/LLM_INDEXING_IMPLEMENTATION_REPORT.md`, `scripts/src/checkLlmIndex.ts`, `scripts/src/generateLlmIndex.ts`

## 2026-06-30 — LLM Index System Created

- Created `docs/llm-index/` with 8 index files covering project map, routes, DB, data sources, critical flows, tests, and changelog
- Created `scripts/src/generateLlmIndex.ts` + `scripts/src/checkLlmIndex.ts` for automated index maintenance
- Created `scripts/install-git-hooks.sh` for pre-commit staleness check
- Added `index:llm` + `index:llm:check` scripts to `scripts/package.json`
- Created root `AGENT.md` pointing to this index system
- **Re-read if**: starting a new agent session on this repo
- **Files**: `docs/llm-index/`, `AGENT.md`, `scripts/src/generateLlmIndex.ts`, `scripts/src/checkLlmIndex.ts`

---

## 2026-06-30 — F&O Operational Readiness Fix (completed)

All 6 tasks confirmed implemented and verified:
- **T001 DAILY_HISTORY_WARMUP**: `optionSignals.ts` lines 2292–2347 classify session-fresh warmup vs hard unavailability; surfaced in `suppressedSummary`
- **T002 no-signal-gap endpoint**: `GET /api/fno/no-signal-gap` in `routes/fno.ts`; hand-written hook at `scanner/src/lib/fno/diagnostics-fetch.ts:253`; NOT in openapi.yaml (intentional — owner-only diagnostic endpoint)
- **T003 alerting**: `lib/alerting.ts` has `alertOwner()` with 1h dedup, Telegram delivery (best-effort background), and `FNO_DATA_GAP_DETECTED` alert wired in `routes/fno.ts:463`
- **T004 Frontend**: `FnoKiteSessionBanner` + `deriveSessionBannerState()` in `fnoEmptyState.ts`; banner in `options.tsx:782`; isDataIssue="Data issue, not market condition" explicit
- **T005 Infra Health**: `FnoSignalGapSection` in `infra-health.tsx`; `FNO_TRADE_READY`/`FNO_DISABLED_KITE_SESSION`/`FNO_DISABLED_DAILY_HISTORY_GAP` state machine
- **T006 Tests**: 14/14 fnoTradingDays, 721/721 scanner, typecheck clean
- **Re-read if**: adding new suppression reasons, changing alert logic, modifying infra-health
- **Files**: `routes/fno.ts`, `lib/optionSignals.ts`, `lib/alerting.ts`, `lib/fnoTradingDays.ts`, `lib/fnoEmptyState.ts`, `pages/options.tsx`, `pages/infra-health.tsx`

---

## 2026-06-29 — F&O Paper Risk Guard Pack (shadow mode)

- `fnoPaperRiskGuards.ts`: G1=NEAR_EXPIRY_THETA_RISK, G2=LOW_ENTRY_PREMIUM, G3=SAME_STRIKE_DIRECTION_STOP_COOLDOWN, G4=SENSEX_DISABLED
- Mode: `shadow` (logs but never blocks). To enable blocking → change `FNO_GUARD_CONFIG.mode` to `"paper_block"`
- 27 unit tests in `fnoPaperRiskGuards.test.ts`
- Simulation: `GET /api/backtest/fno/runs/:id/risk-guard-simulation`
- UI: Section 11 in `ReplayDiagnosticsPanel`
- **Re-read if**: changing guard thresholds, enabling blocking mode
- **Files**: `lib/fnoPaperRiskGuards.ts`, `routes/backtest.ts`, `pages/backtest-lab.tsx`

---

## 2026-06-09 — INDstocks Secondary Provider + Trusted Layer Phase 1

- INDstocks: `DISABLED` by default. Enable via `INDSTOCKS_ENABLED` env + `INDSTOCKS_API_TOKEN` secret
- Trusted-layer foundation: `marketData/` directory now has full provider import guard
- `providerImportAllowlist.json`: 34 files / 64 import-pairs (migration backlog)
- Write guard in `upsertCandles`: lower-trust source cannot overwrite Kite row
- Candle provenance columns added via `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- **Re-read if**: adding new data providers, touching the import guard, schema migration
- **Files**: `lib/marketData/`, `lib/candleWarehouseIngestor.ts`, `providerImportAllowlist.json`

---

## 2026-06-05 — Backtest Candle Timezone Fix

- Fixed: `modeled` backtest trades were stored +05:30 ahead (IST-wall-clock as UTC)
- Fix: `candleUtcIso()` helper for correct candle time representation
- Backfill script: `pnpm --filter @workspace/scripts run fix-backtest-trade-times [-- --write]`
- Applied to dev DB. For prod: run after deploy
- **Re-read if**: touching backtest candle time handling
- **Files**: `scripts/src/fixBacktestTradeTimes.ts`, `lib/backtest/`

---

## 2026-06-02 — Portfolio Analyser Phase 2 (DB persistence)

- `portfolios` + `portfolio_holdings` tables added
- Routes: `GET/POST/PUT/DELETE /api/portfolios/:id` (subscriber/owner, ownerKey-scoped)
- OpenAPI: `Portfolio/PortfolioHolding/PortfolioHoldingInput/PortfolioSummary` schemas + codegen
- `paramId(req)` helper for Express-5 param typing
- New pure libs: `returnLabel.ts`, `risk.ts`, `allocation.ts`, `holdingPeriod.ts`, `benchmark.ts`
- **Re-read if**: extending portfolio features, adding new holding fields
- **Files**: `lib/db/src/schema/portfolio.ts`, `routes/portfolio.ts`, `lib/portfolio/`, `pages/portfolio-analyser.tsx`

---

## 2026-05-15 — Owner Data Infrastructure Health Dashboard

- New page: `/infra-health` (INFRA tab, owner-only)
- Five sections: Security, Sector, Candle Warehouse, F&O Snapshots, Equity Risk
- Pure severity helpers: `lib/infraHealth.ts` (16 tests)
- Zero backend/signal/scheduler changes
- **Re-read if**: adding new infra sections, modifying severity helpers
- **Files**: `pages/infra-health.tsx`, `lib/infraHealth.ts`

---

## 2026-05-13 — Combo Paper Trader Lane (Tier C, Phase 1)

- `paper_trade_combo` + `paper_trade_combo_leg` tables
- `POST /api/paper/combos` — defined-risk only (rejects naked shorts)
- Concurrency: `pg_advisory_xact_lock(7593721)` for open cap
- Isolated from FNO heat budget and 15:20 force-exit
- **Re-read if**: adding combo legs, changing combo P&L formula
- **Files**: `lib/db/src/schema/paperTradeCombo.ts`, `lib/paperTradingCombo.ts`, `routes/paperCombo.ts`

---

## 2026-05-13 — Dev/Prod Paper Trading Isolation

- `isPaperAutoTradingEnabled()` in `lib/paperAutoTradeFlag.ts` — fail-closed
- `PAPER_TRADING_ENABLED` env override; auto-detects `REPLIT_DEPLOYMENT=1` in prod
- Manual buys and closes are NOT gated
- **Re-read if**: adding new auto-trade paths — must respect the gate
- **Files**: `lib/paperAutoTradeFlag.ts`, `lib/paperTradingFO.ts`, `lib/paperTradingEq.ts`

---

## 2026-04-01 — STT Rate Update

- STT rates updated: 0.15% delivery / 0.05% intraday (effective 2026-04-01)
- Shadow cost model only — does NOT affect realized P&L/DD/heat (those are GROSS)
- **Re-read if**: changing cost model
- **Files**: `lib/fnoCostModel.ts`, `lib/swingCashCostModel.ts`

---

## Template for New Entries

```markdown
## YYYY-MM-DD — <Short title>

- What changed (not implementation detail — the durable lesson)
- Breaking changes or invariants
- **Re-read if**: <when does a future agent need to read this?>
- **Files**: `path/to/key/files`
```
