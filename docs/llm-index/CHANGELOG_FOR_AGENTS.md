# Changelog for Agents

Reverse-chronological log of significant changes. Add an entry **before** marking your task complete.

Format: `## YYYY-MM-DD — <short title>` then bullet points with: what changed, what files, what to re-read.

---

## 2026-08-08 — Pack 33 Control-Only Deployment (PROMPT_33_CONTROL_ONLY_DEPLOYMENT_AND_REMAINING_EVIDENCE_CLOSURE)

- **Classifier reformed (B)**: `inCurrentMaster: boolean` is now a required param. Instruments absent from the Kite master → `UNRESOLVED_SECURITY_TYPE` immediately regardless of suffix. `OMFURN-ST` (token NOT_FOUND in cache) → UNRESOLVED, not SME. Suffixes are supporting evidence for in-master instruments only. `ORDINARY_EQUITY_ELIGIBLE` requires affirmative evidence (inCurrentMaster=true + exchange=NSE + segment=NSE + instrument_type=EQ + no exclusion). All 46 eligibility tests updated to pass `inCurrentMaster`.
- **Transactional force-stop with idempotency (D)**: New `kite_warehouse_stop_audit` table (UNIQUE idempotency_key). `forceStopWarehouseTransactional()` wraps audit INSERT (status=SUCCESS) + progress UPDATE in one `db.transaction()`. Failed tx rolls back both; success audit record only exists when mutation committed. Same idempotency key → cached result, no new mutation. Failed attempt recorded with `_FAIL_<ts>` key (best effort, outside tx). Drizzle runtime table declaration added to prevent drizzle-kit DROP.
- **Reset route population lock gate (E)**: `POST /warehouse/reset` returns 409 `POPULATION_LOCK_PREVENTS_CANARY_RESTART` when `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED=false`. Cannot advance STOPPED→CANARY while no scheduler is registered.
- **Pre-publish verification (A)**: Both prod builds successful (api-server 7.3MB, scanner 2.9MB). Built artifact scan: `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false` and `PAUSED_BY_COMPILE_TIME_CONTROL` appears 4 times in bundle. No env-var bypass. All four lock constants confirmed `false as boolean` in source. Broker hard disable: `isLiveCashSwingOrderEnabled()` returns false when `LIVE_CASH_SWING_ORDER_ENABLED` env var absent.
- Battery: api-server **282 files / 6589 tests** PASS; scanner **52 files / 1250 tests** PASS; 4-pkg TSC clean; git diff clean.

---

## 2026-08-08 — Pack 33 Corrective R2 — Deployment Race Removal (PROMPT_33_CORRECTIVE_DEPLOYMENT_RACE_REMOVAL)

- **`FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean`** added to `candleEvaluationControl.ts` with `getWarehousePopulationLockStatus()`. Eliminates the post-deploy race: scheduler does NOT register unless this constant is true.
- **Three lock check points in `fullNseWarehouse.ts`**: (1) `initFullNseWarehouseScheduler()` returns without setTimeout; (2) `runFullNseWarehousePopulation()` returns `{skipped:true,skipReason:"PAUSED_BY_COMPILE_TIME_CONTROL"}` at first guard; (3) `fetchWarehouseEntry()` throws BUG-error belt-and-suspenders. `FullNseWarehouseMetrics` exposes `populationLockAuthorized`+`populationLockCode`.
- **Force-stop hardened**: `POST /api/scan/candle-store/warehouse/force-stop` now requires `expectedSnapshotId`+`expectedCurrentStatus` (409 on mismatch); writes structured audit record `{ts, event, idempotencyKey, actor, prevStatus, prevSnapshotId, prevStoppedReason, newStatus, newStoppedReason, evaluationLockUnchanged, candleHistoryDeleted, populationLockAtTimeOfStop}` before mutation.
- **Eligibility classifier reformed** (`instrumentEligibility.ts`): explicit precedence (exchange→segment→instrument_type→series→tradingsymbol→ISIN→inactive). New output fields: `seriesCode: string|null` (from tradingsymbol suffix — IS the Kite series code), `precedenceVector: string[]`. BZ reason no longer "non-equity". Tests rewritten (39 tests; canary 50 exact counts proved).
- **`GET /api/scan/candle-store/metrics`**: exposes `universeMetrics.warehousePopulationLock.{authorized, lockedCode, description}`.
- **New test file**: `fullNseWarehouse.compileTimeLock.test.ts` (17 tests): scheduler not registered, PAUSED skip, durable STOPPED 7 scenarios, losing-replica invariants.
- **`CANARY_50_MATRIX_2026-08-08.md`**: full instrument token matrix with 49/50 tokens from Kite cache.
- Battery: api-server **282 files / 6582 tests** PASS; scanner **52 files / 1250 tests** PASS; 4-pkg TSC CLEAN; git diff clean.
- Pre-publish verdict: `PROMPT_33_CONTROL_REMEDIATION_IMPLEMENTED — DEPLOYMENT_PENDING — WAREHOUSE_POPULATION_HARD_PAUSED`

---

## 2026-08-08 — Pack 33 Corrective Control Repair (PROMPT_33_CORRECTIVE_CONTROL_REPAIR)

- 11-point corrective package triggered by accidental owner-boundary test resetting production `kite_warehouse_progress` from STOPPED→CANARY via unauthenticated route.
- **Sliding-window rate limiter** (`lib/kiteCandle/tokenBucket.ts`): full rewrite replacing token-bucket; starts empty (no cold-burst); `resetMetrics()` preserves window timestamps; clock/sleeper injected for deterministic testing; 24 tests.
- **Canonical instrument eligibility classifier** (`lib/kiteCandle/instrumentEligibility.ts`): 10-class taxonomy (ORDINARY_EQUITY_ELIGIBLE, DEBT_GOVERNMENT_SECURITY, SOVEREIGN_GOLD_BOND, SME_EQUITY_POLICY_EXCLUDED, UNRESOLVED_SECURITY_TYPE…); `classifyInstrument()`, `classifyInstrumentBatch()`, `summarizeEligibility()`; 42 tests. Root cause of Aug 7 CANARY_VALIDATION_FAILED: 36/50 canary symbols were SDL bonds, gold bonds, SME-ST instruments.
- **Durable STOPPED state** (`lib/kiteCandle/fullNseWarehouse.ts`): when snapshotId changes (midnight IST roll) and status=STOPPED, preserve STOPPED (do not silently reset to CANARY); only IN_PROGRESS/CANARY/COMPLETE trigger a new snapshot cycle. New exports: `forceStopWarehouse()`, `getWarehouseProgressForReset()`.
- **Losing-replica hydration** (`lib/kiteCandle/kiteCandleStore.ts`): replaced fixed `sleep(15_000)` with bounded `pollForLockReleaseAndReload()` (10-min cap, 5s poll, exits when lock released or data appears); new `getKiteCandleStorePhysicalMetrics()` for DB-sourced split-count metrics.
- **Hardened reset route** (`routes/scanner.ts`): requires all 5 preconditions (confirmationPhrase, expectedSnapshotId, expectedCurrentStatus="STOPPED", idempotencyKey, dryRun=false); default dryRun=true.
- **New force-stop route** (`POST /api/scan/candle-store/warehouse/force-stop`): requireOwnerStrict; sets status=STOPPED with documented reason; guarantees evaluationLockUnchanged, candleHistoryDeleted=false, providerCallStarted=false; used to correct the accidental reset post-deploy.
- **Separate physicalStoreMetrics**: `GET /api/scan/candle-store/metrics` now includes `physicalStoreMetrics` (live DB row counts, split curated vs warehouse, liveQuerySuccess flag).
- Battery: api-server **281 files / 6568 tests** PASS; scanner **52 files / 1250 tests** PASS; 4-pkg TSC CLEAN; all 3 compile-time locks = false.
- Deliverables: `CANARY_50_MATRIX_2026-08-07.md`, `ADJACENT_DEFECTS_ROADMAP_2026-08-08.md` at workspace root.
- **Post-deploy required action**: Call `POST /api/scan/candle-store/warehouse/force-stop` on production with `confirmationPhrase: "AUTHORIZE_FORCE_STOP_KITE_WAREHOUSE"`, `stoppedReason: "ACCIDENTAL_OWNER_BOUNDARY_TEST_RESET_PENDING_REMEDIATION"`, within 5 min of deploy (before warehouse scheduler's first tick).
- **Re-read if**: modifying warehouse eligibility, rate-limiter behavior, force-stop/reset gate logic, physicalStoreMetrics query, or Phase B authorization.
- **Files**: `lib/kiteCandle/tokenBucket.ts` + `.test.ts`, `lib/kiteCandle/instrumentEligibility.ts` + `.test.ts`, `lib/kiteCandle/fullNseWarehouse.ts`, `lib/kiteCandle/kiteCandleStore.ts`, `routes/scanner.ts`; workspace root: `CANARY_50_MATRIX_2026-08-07.md`, `ADJACENT_DEFECTS_ROADMAP_2026-08-08.md`.

## 2026-08-06 — Pack 9: Professional F&O Strategy Research & Qualification (BLOCKED)

- Pre-registered, net-of-cost, out-of-sample qualification protocol executed for 7 F&O strategy archetypes (NIFTY/BANKNIFTY/SENSEX).
- Protocol frozen and SHA-256 hashed (`1d9309fee...`) before any backtest results were inspected; test period (2026-04-01→2026-07-17) sealed.
- Gate 1 finding: `option_chain_snapshot` = 0 rows (0 ingestion runs ever); all 7 candidates → `BLOCKED_DATA_FOUNDATION_INSUFFICIENT`; 0 strategies qualified.
- New test file: `artifacts/api-server/src/lib/p29.pack9.research.test.ts` (79 tests, 24 categories — all PASS); total api-server 6,043, scanner 1,250.
- Evidence files written to `artifacts/audit-evidence/`: p29_gate1_data_inventory.json, p29_gate2_research_protocol.md, p29_gate2_protocol_hash.txt, p29_gate4_cost_reconciliation.json, p29_gate5–8 JSONs, FAST_TRACK_PACK_9 main doc.
- Gate 0 carryover: Pack 8 obs log parsed — 208 obs, all MATCH_WITHIN_TOLERANCE, max Δ=4.28 bps; 10-minute window (30-min req. not met — market closed).
- No V2 strategies added, no FNO_PAPER_V2 activation, STRATEGY_REGISTRY still 6 entries, Global untouched.
- **Re-read if**: activating option_chain_snapshot ingestion, re-running Pack 9 qualification with real data, or adding strategies to STRATEGY_REGISTRY.
- **Files**: `artifacts/api-server/src/lib/p29.pack9.research.test.ts`, `artifacts/audit-evidence/FAST_TRACK_PACK_9_*.md`, `artifacts/audit-evidence/p29_gate*.json`.

## 2026-07-28 — Phase A0.3.2: Ctx.vwap→pivotRef/authVwap rename + 9-record setup contract

- `optionSignals.ts`: Removed `Ctx.vwap: number`; added `Ctx.pivotRef: number` (geometric ref = sessionVwap ?? spot) and `Ctx.authVwap: number | null` (null when vwapAvailable=false); 23 function-body replacements (c.authVwap! in VWAP-guarded paths, c.pivotRef for geometry/connectors)
- `toSignal` serializer: `vwap: round2(c.vwap)` → `vwap: c.authVwap != null ? round2(c.authVwap) : undefined` — spot-as-VWAP proxy can no longer leak into signal output
- `computeIndexFnoSetupAvailability`: signature changed from `(boolean)` to `(SupportedFnoIndex)`, always returns 3 entries with `indexSymbol` field; `computeAllIndexFnoSetupAvailability()` new export returns canonical 9-record contract (3 indices × 3 setups)
- `getOptionSignals`: `indexFnoSetupAvailability` now always `computeAllIndexFnoSetupAvailability()` (was accumulating via map, max 3 entries)
- `scanner.ts`: removed `?? []` fallback (source guarantees 9 records)
- Evidence: 241/241 across 6 A0.3.2 test files; 4279/4282 full suite; 4 typechecks clean; git diff --check clean
- **Re-read if**: touching F&O signal detectors (Ctx fields), setup availability contract, or scanner /options/signals route serialization
- **Files**: `artifacts/api-server/src/lib/optionSignals.ts`, `artifacts/api-server/src/routes/scanner.ts`, `artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts`

## 2026-07-02 — Swing TTL Staged Order Lifecycle (P1)

- Background scheduler (`swingTtlSweep.ts`) auto-expires stale staged swing orders every 10 min (all owners); `applySwingTtlSchemaColumns()` runs BEFORE the first tick (migration-before-tick ordering fix prevents "column does not exist" on fresh deployments)
- `expiredAt` / `expiryReason` nullable columns added to `swing_order_staging` via additive ALTER TABLE (not drizzle-kit push); `EXPIRED` status stamped on both `status` + `approval_status`
- Three new owner-only TTL endpoints: `GET /api/swing/ttl-sweep/status`, `POST /api/swing/ttl-sweep/run-dry`, `POST /api/swing/ttl-sweep/run-now`; `/api/swing/status` enriched with `ttlSweep` block
- UI: `TtlSweepWidget` in swing-cash sidebar; expired orders show `expiredAt` + human-readable `expiryReason` label
- **Scope**: NO F&O / scoring / broker / alert changes — pure lifecycle/scheduler only
- **Re-read if**: modifying swing staged order expiry logic, adding new sweep reasons, or wiring the sweep to additional triggers
- **Files**: `artifacts/api-server/src/lib/swingTtlSweep.ts` (+ `.test.ts`), `artifacts/api-server/src/lib/swingOrderStaging.ts` (+ `.test.ts`), `artifacts/api-server/src/routes/swingStaging.ts`, `artifacts/api-server/src/app.ts`, `artifacts/scanner/src/pages/swing-cash.tsx`, `lib/api-spec/openapi.yaml`, `lib/db/src/schema/swingOrderStaging.ts`

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
