/**
 * P0.1 — Unit-only Vitest configuration.
 *
 * This config runs ONLY pure-unit test files that have been confirmed as
 * not directly importing @workspace/db, not making DB queries, and not
 * calling external services (Telegram, Kite, broker).
 *
 * DB-backed tests must use the `test:db` script, which gates execution
 * through the dbTestPreflightRunner before spawning Vitest.
 *
 * HOW TO ADD A FILE TO THE UNIT SUITE:
 *   1. Confirm via grep that it does not import @workspace/db directly.
 *   2. Confirm that it does not transitively reach a module that calls
 *      pg.Pool, drizzle, or an external network service.
 *   3. Remove it from the `exclude` list below.
 *   4. Verify it passes under this config before committing.
 *
 * FILES EXCLUDED FROM THIS CONFIG (Stage A inventory — 2026-07-20):
 *   - DB_DIRECT: directly import @workspace/db
 *   - DB_TRANSITIVE: import route handler or application modules that reach @workspace/db
 *   - EXTERNAL_SERVICE_DIRECT: import Telegram/Kite adapters
 *   - UNKNOWN_REQUIRES_TRACE: reference DATABASE_URL, external services or are
 *     labelled integration/live/migration — require full tracing before classification.
 *
 * See memory/P0_1_TEST_COUPLING_INVENTORY_2026-07-20.md for the full file
 * classification table with source evidence.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],

    exclude: [
      // ── Routes (all have DB_TRANSITIVE via express app import) ────────────
      "src/routes/**",

      // ── Replay harness ───────────────────────────────────────────────────
      "src/__tests__/**",

      // ── Script tests ─────────────────────────────────────────────────────
      "src/scripts/**",

      // ── Global module tests (DB_DIRECT) ──────────────────────────────────
      "src/lib/global/**",

      // ── DB_DIRECT lib tests ───────────────────────────────────────────────
      "src/lib/bootScheduler.test.ts",
      "src/lib/dailyReportsDedupContract.test.ts",
      "src/lib/dailyReports.gatherPostMarket.integration.test.ts",
      "src/lib/durableChargesIdentity.test.ts",
      "src/lib/fnoFailureDiagnosis.test.ts",
      "src/lib/fnoObservability.test.ts",
      "src/lib/fnoPremiumExitOverlay.test.ts",
      "src/lib/fnoReasoningAnalytics.test.ts",
      "src/lib/fnoSignalReasoningLogger.test.ts",
      "src/lib/marketData/indstocksMapping.test.ts",
      "src/lib/marketData/indstocksTokenStore.test.ts",
      "src/lib/marketData/providerImportGuard.test.ts",
      "src/lib/optionSignalPlanImmutability.test.ts",
      "src/lib/paperCapitalEvents.test.ts",
      "src/lib/paperHeatSql.test.ts",
      "src/lib/paperReportsFoTimeExit.test.ts",
      "src/lib/paperTradingEqProvenance.test.ts",
      "src/lib/paperTradingFoExitMonitorApi.test.ts",
      "src/lib/paperTradingFoMtmSweep.test.ts",
      "src/lib/paperTradingFoOrphanExit.test.ts",
      "src/lib/paperTradingFO.premiumPath.test.ts",
      "src/lib/swingAlerts.test.ts",
      "src/lib/swingOrderStaging.test.ts",
      "src/lib/swingRegressionGate.test.ts",
      "src/lib/swingScannerStore.intradayRefresh.test.ts",
      "src/lib/swingShadowDiagnostic.test.ts",
      "src/lib/swingShadowScore.test.ts",
      "src/lib/swingTtlSweep.test.ts",
      "src/lib/systemAlertDedupSelfTest.test.ts",
      "src/lib/systemAlertDedup.test.ts",
      "src/lib/__tests__/**",
      "src/lib/tradeLifecycleParity.test.ts",

      // ── UNKNOWN_REQUIRES_TRACE (external service refs or live-DB labels) ──
      "src/lib/alerting.test.ts",
      "src/lib/buildInfo.test.ts",
      "src/lib/backtest/premiumReplay.test.ts",
      "src/lib/backtest/strategies/comparison.config-flow.test.ts",
      "src/lib/backtest/strategies/registry.candle-regression.test.ts",
      "src/lib/canonicalFnoReadiness.test.ts",
      "src/lib/dailyReports.test.ts",
      "src/lib/fnoDataHealthAlerts.test.ts",
      "src/lib/fnoDataRecoveryTransition.test.ts",
      "src/lib/fnoCostModel.test.ts",
      "src/lib/fnoMarketShadowCapture.test.ts",
      "src/lib/fnoSignalAlerts.test.ts",
      "src/lib/kiteTimeout.test.ts",
      "src/lib/marketData/gateBCD.migration.test.ts",
      "src/lib/optionChainSnapshotIngestor.test.ts",
      "src/lib/optionSignals.expiryDay.test.ts",
      "src/lib/optionSignals.triggerSemantics.test.ts",
      "src/lib/paperAccountReconciliation.test.ts",
      "src/lib/paperTradingCombo.test.ts",
      "src/lib/swingStagingSweepSafe.test.ts",
      "src/lib/telegramBotCommands.test.ts",
      "src/lib/tradeLifecycle/tradeEventParity.test.ts",
      "src/lib/tradeLifecycle/tradeLifecycle.test.ts",
      "src/lib/watchlist.test.ts",
    ],
  },
});
