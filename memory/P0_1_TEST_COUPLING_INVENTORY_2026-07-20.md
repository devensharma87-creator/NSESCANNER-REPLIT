# P0.1 — Test Coupling Inventory (corrected 2026-07-20)

**Branch:** `phase0/authorized-remediation-20260720`  
**Baseline SHA:** `47611aa6fad3785f02f97280570f025c71fb975a`  
**P0.1 partial SHA:** `83c58dd797a13b5607035231a25c180e4b6f4ca4`  
**Work order:** REPLIT_CODER_P0_1_CORRECTIVE_WORK_ORDER_2026-07-20_1784554592116.md  
**Method:** Static grep only — no module execution, no test runs  
**Status:** INCOMPLETE — transitive coupling requires full module-graph tracing

---

## Summary counts (api-server only)

| Category | Count | Basis |
|---|---|---|
| Total test files | ~146 | Prior estimate; not re-counted in this task |
| **PURE_UNIT_CONFIRMED** | **1** | `src/test-infra/dbTestGuard.test.ts` only — positive allowlist |
| DB_DIRECT | 51 | Direct `@workspace/db`, `drizzle-orm`, or `pg.Pool` import — static grep |
| DB_TRANSITIVE | 16+ | All `src/routes/__tests__/` — structural inference only |
| EXTERNAL_SERVICE_DIRECT | Not separately counted | Captured in UNKNOWN |
| EXTERNAL_SERVICE_TRANSITIVE | Not classified | Requires full module-graph trace |
| UNKNOWN_REQUIRES_TRACE | 24 | DATABASE_URL ref, Telegram/Kite module names, or live/integration labels |
| Files calling pool.end() | 11 | Static grep |
| INSERT/UPDATE/DELETE/TRUNCATE | 37 | Static grep |
| Migration/schema-ensure tests | 5 | Static grep |
| Live/dev/production-labelled | 37 | Static grep |

A file may appear in multiple categories.

---

## PURE_UNIT_CONFIRMED — 1 file

| File | Basis for classification |
|---|---|
| `src/test-infra/dbTestGuard.test.ts` | Imports only: `vitest`, `node:fs`, `node:path`, `node:url`, `./dbTestGuard.js`, `./dbTestPreflightRunner.js`. Both imported modules use only `node:url` and `node:child_process`. Zero `@workspace/*`, zero drizzle, zero pg, zero application code. Verified by direct read of all source files. |

**IMPORTANT:** "Not matched by grep" does NOT mean PURE_UNIT_CONFIRMED.  
All other ~145 test files remain unclassified until individually traced via full module-graph analysis.

The `vitest.config.unit.ts` file uses a POSITIVE ALLOWLIST containing exactly this one file.  
This is NOT a general CI unit suite. PURE_UNIT_CONFIRMED = 1 for this configuration.

---

## Classification method and limitations

### DB_DIRECT (51 files)
Classified by static grep for `import.*@workspace/db`, `import.*drizzle-orm`, `pg\.Pool`.

### DB_TRANSITIVE (routes)
All files under `src/routes/__tests__/` classified as transitive by **directory convention** (structural inference). Individual chains not verified by execution.

### UNKNOWN_REQUIRES_TRACE (24 files)
Files not in DB_DIRECT but flagged by grep for: `DATABASE_URL` reference, Telegram/Kite/broker import names, or live/integration/migration comment labels. These may prove pure upon full tracing — they are not confirmed DB-coupled.

### Transitive classification limitation
No file's full module graph was traced by module execution. All DB_TRANSITIVE labels are inferred from directory convention only. A complete accurate inventory requires per-file import-graph traversal.

---

## DB_DIRECT files (51) — lib/ subset

| File | Additional signals |
|---|---|
| bootScheduler.test.ts | |
| dailyReportsDedupContract.test.ts | vi.mock(@workspace/db), TELEGRAM |
| dailyReports.gatherPostMarket.integration.test.ts | TELEGRAM, "integration" label |
| durableChargesIdentity.test.ts | pool.end() |
| fnoFailureDiagnosis.test.ts | |
| fnoObservability.test.ts | DATABASE_URL, mutations |
| fnoPremiumExitOverlay.test.ts | DATABASE_URL, mutations, pool.end() |
| fnoReasoningAnalytics.test.ts | |
| fnoSignalReasoningLogger.test.ts | DATABASE_URL, mutations |
| global/dataLayer.failureIsolation.test.ts | vi.mock(@workspace/db) |
| global/disabledSymbols.failSoft.test.ts | vi.mock(@workspace/db) |
| global/presetScheduler.failureIsolation.test.ts | vi.mock(@workspace/db) |
| marketData/indstocksMapping.test.ts | "live" label |
| marketData/indstocksTokenStore.test.ts | DATABASE_URL, mutations |
| marketData/providerImportGuard.test.ts | vi.mock(@workspace/db) |
| optionSignalPlanImmutability.test.ts | DATABASE_URL, mutations, DDL, pool.end() |
| paperCapitalEvents.test.ts | DATABASE_URL, mutations, pool.end() |
| paperHeatSql.test.ts | DATABASE_URL, pool.end() — live-DB guard: `dbAvailable ? describe : describe.skip` |
| paperReportsFoTimeExit.test.ts | |
| paperTradingEqProvenance.test.ts | DATABASE_URL, mutations, DDL, pool.end() |
| paperTradingFoExitMonitorApi.test.ts | DATABASE_URL, mutations, pool.end() |
| paperTradingFoMtmSweep.test.ts | DATABASE_URL, mutations, pool.end() |
| paperTradingFoOrphanExit.test.ts | DATABASE_URL, mutations, DDL, pool.end() |
| paperTradingFO.premiumPath.test.ts | DATABASE_URL |
| swingAlerts.test.ts | TELEGRAM, Kite |
| swingOrderStaging.test.ts | DATABASE_URL, mutations, Kite, pool.end() |
| swingRegressionGate.test.ts | vi.mock(@workspace/db) |
| swingScannerStore.intradayRefresh.test.ts | DATABASE_URL, mutations, Kite, pool.end() |
| swingShadowDiagnostic.test.ts | Kite |
| swingShadowScore.test.ts | |
| swingTtlSweep.test.ts | DATABASE_URL, mutations, Kite, pool.end() |
| systemAlertDedupSelfTest.test.ts | vi.mock(@workspace/db) |
| systemAlertDedup.test.ts | DDL, vi.mock(@workspace/db) |
| __tests__/sectorStrength.test.ts | |
| tradeLifecycleParity.test.ts | Kite |

Routes/__tests__/ (16) — all also DB_TRANSITIVE:
backboneRouteAuth, backtestComparisonIgnoredFilters, backtestTradeTimes, buildInfoRoute,
dailyAnalysisTelegramPreviewRoute, dataParityRouteAuth, diagnosticRouteAuth, equityRouteDdLatch,
exitMonitorApiRoute, exitSafetyDiagnosticRoute, globalPresetRoutes, intradayRefreshDiagnostics,
kiteStatusAuth, mtmSweepDiagnosticRoute, portfolioRouteIsolation, portfolioRouteLimits.

Scripts: rotateKiteTokenEncKey.test.ts

---

## UNKNOWN_REQUIRES_TRACE (24 files)

| File | Signal |
|---|---|
| alerting.test.ts | TELEGRAM |
| buildInfo.test.ts | DATABASE_URL + TELEGRAM |
| backtest/premiumReplay.test.ts | Kite, `skip` guard |
| backtest/strategies/comparison.config-flow.test.ts | "live DB" label |
| backtest/strategies/registry.candle-regression.test.ts | "live DB" label |
| canonicalFnoReadiness.test.ts | TELEGRAM |
| dailyReports.test.ts | TELEGRAM, Kite |
| fnoDataHealthAlerts.test.ts | TELEGRAM |
| fnoDataRecoveryTransition.test.ts | TELEGRAM |
| fnoCostModel.test.ts | Kite |
| fnoMarketShadowCapture.test.ts | "live DB" skip |
| fnoSignalAlerts.test.ts | Kite |
| kiteTimeout.test.ts | Kite |
| marketData/gateBCD.migration.test.ts | "migration" label |
| optionChainSnapshotIngestor.test.ts | "live DB" skip |
| optionSignals.expiryDay.test.ts | "live DB" skip |
| optionSignals.triggerSemantics.test.ts | "live DB" skip |
| paperAccountReconciliation.test.ts | "live DB" skip |
| paperTradingCombo.test.ts | DATABASE_URL, mutations |
| swingStagingSweepSafe.test.ts | "live DB" label |
| telegramBotCommands.test.ts | TELEGRAM |
| tradeLifecycle/tradeEventParity.test.ts | TELEGRAM, Kite |
| tradeLifecycle/tradeLifecycle.test.ts | TELEGRAM, Kite |
| watchlist.test.ts | "live DB" skip |

---

## Critical unsafe default

`paperHeatSql.test.ts` (line ~80):
```typescript
const dbAvailable = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("dummy"));
const describeDb = dbAvailable ? describe : describe.skip;
```
Because `DATABASE_URL` is set in the Replit dev environment, this runs live SQL against the operational database on every `pnpm run test` invocation. At least 6 other test files use the same anti-pattern.

---

## Corrective change vs initial P0.1

The initial P0.1 used wildcard include + manually approximated exclusion list (75 entries).  
That approach was rejected: unreviewed files were implicitly treated as safe.

The corrected approach uses a POSITIVE ALLOWLIST. Only individually confirmed pure files are permitted. PURE_UNIT_CONFIRMED = 1.

---

## scanner tests

The scanner package has its own `vitest.config.ts` (vmThreads + forceExit + jsdom). Its test files do NOT import `@workspace/db`. Scanner is NOT affected by the DB isolation gap.
