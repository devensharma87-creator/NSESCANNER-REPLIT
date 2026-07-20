# P0.1 — Test Coupling Inventory
**Date**: 2026-07-20  
**Branch**: phase0/authorized-remediation-20260720  
**Scope**: artifacts/api-server (146 test files), artifacts/scanner (~30 test files)  
**Method**: Static grep analysis only — no test execution, no DB connection.

---

## Summary counts (api-server)

| Category | Count |
|---|---|
| Total test files | 146 |
| DB_DIRECT (import @workspace/db directly) | 51 |
| References DATABASE_URL in source | 22 |
| DB mutation patterns (.insert/.update/.delete) | 37 |
| Pool close (.end()) | 11 |
| Schema-ensure / DDL | 5 |
| vi.mock(@workspace/db) | 21 |
| TELEGRAM references | 12 |
| Kite/broker references | 21 |

---

## Classification key

- **DB_DIRECT** — test file directly imports `@workspace/db`, `drizzle-orm`, `pg.Pool`, or equivalent.
- **DB_TRANSITIVE** — no direct DB import, but imports an express route handler or application module that transitively reaches `@workspace/db`.
- **EXTERNAL_SERVICE_DIRECT** — directly imports a Telegram or Kite adapter module.
- **UNKNOWN_REQUIRES_TRACE** — does not appear in DB_DIRECT, but references `DATABASE_URL`, external-service env vars, or is labelled `integration`/`live`/`migration` in comments. Needs full transitive trace before classifying as safe.
- **PURE_UNIT_CONFIRMED** — confirmed safe for unit runner: no DB import, no external service, no DATABASE_URL reference, no live-DB skip guard.

---

## DB_DIRECT files (51) — excluded from vitest.config.unit.ts

All 51 confirmed via `grep -rln "@workspace/db|drizzle-orm|pg.Pool"`.

### lib/ (35)

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

### routes/__tests__/ (16) — all also DB_TRANSITIVE (import express app)

backboneRouteAuth.test.ts, backtestComparisonIgnoredFilters.test.ts,  
backtestTradeTimes.test.ts, buildInfoRoute.test.ts,  
dailyAnalysisTelegramPreviewRoute.test.ts, dataParityRouteAuth.test.ts,  
diagnosticRouteAuth.test.ts, equityRouteDdLatch.test.ts,  
exitMonitorApiRoute.test.ts, exitSafetyDiagnosticRoute.test.ts,  
globalPresetRoutes.test.ts, intradayRefreshDiagnostics.test.ts,  
kiteStatusAuth.test.ts, mtmSweepDiagnosticRoute.test.ts,  
portfolioRouteIsolation.test.ts, portfolioRouteLimits.test.ts

### scripts/

rotateKiteTokenEncKey.test.ts

---

## DB_TRANSITIVE — all routes (not already in DB_DIRECT)

All `src/routes/__tests__/` files not listed above import the express application which transitively reaches `@workspace/db`.

Additional route test files confirmed by file listing:
- etfQuoteRoute.test.ts
- swingStagingSweepSafe.test.ts
- observabilityRoutes.test.ts (if present)
- observabilitySummaryRoute.test.ts (if present)

---

## UNKNOWN_REQUIRES_TRACE — requires full transitive trace before reclassifying

These files do **not** appear in DB_DIRECT, but have signals that preclude confirming them as PURE_UNIT:

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

**Migration backlog**: All 24 files above must be fully traced before reclassifying. The most common remediation pattern is `vi.mock("@workspace/db")` + a stub pool that never opens a socket, or restructuring the module under test to accept an injected db handle.

---

## Critical unsafe default identified

**`paperHeatSql.test.ts` live-DB skip guard (line 80):**
```typescript
const dbAvailable = Boolean(
  process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("dummy")
);
const describeDb = dbAvailable ? describe : describe.skip;
```

Because `DATABASE_URL` IS set in the Replit dev environment, this test **runs live SQL** against the operational database every time `pnpm run test` is invoked. This is the canonical example of the unsafe default this P0.1 task addresses.

The same pattern (variations of `DATABASE_URL ? describe : describe.skip`) appears in at least 6 other test files.

---

## Remediation priority order

1. **Immediate (P0.1 done)**: Guard + unit runner established. `test:unit` safe, `test:db` gated.
2. **Next (P0.2)**: Replace `DATABASE_URL ? describe : describe.skip` guards with `TEST_DATABASE_URL` + `dbTestGuard` check in files that genuinely need DB state.
3. **Medium**: Trace and reclassify the 24 UNKNOWN_REQUIRES_TRACE files.
4. **Long**: Add vi.mock(@workspace/db) stubs to files that only need DB for side-effect setup.

---

## scanner tests

The scanner package has its own `vitest.config.ts` (vmThreads + forceExit + jsdom). Its test files do NOT import `@workspace/db`. Scanner is NOT affected by the DB isolation gap.

Known scanner files with Kite/broker references:
- fnoReasonCategories.test.ts
- portfolio/csv.test.ts
- portfolio/persistence.test.ts

These reference Kite data SHAPES (pure type assertions), not live connections — classified as safe under the existing scanner vitest config.
