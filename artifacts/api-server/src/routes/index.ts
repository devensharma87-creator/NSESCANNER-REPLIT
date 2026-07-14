import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scannerRouter from "./scanner";
import tradingViewRouter from "./tradingview";
import instFlowsRouter from "./instFlows";
import kiteRouter from "./kite";
import optionChainRouter from "./optionChain";
import oiLabRouter from "./oiLab";
import optionStrategiesRouter from "./optionStrategies";
import deepScanRouter from "./deepscan";
import systemRouter from "./system";
import stocksToWatchRouter from "./stocksToWatch";
import indicesRouter from "./indices";
import userAuthRouter from "./userAuth";
import adminRouter from "./admin";
import paperRouter from "./paper";
import paperComboRouter from "./paperCombo";
import homeRouter from "./home";
import optionChainSnapshotRouter from "./optionChainSnapshot";
import candleWarehouseRouter from "./candleWarehouse";
import equitySizingRouter from "./equitySizing";
import chartRouter from "./chart";
import portfolioRouter from "./portfolio";
import fnoRouter from "./fno";
import backtestRouter from "./backtest";
import dataRouter from "./data";
import swingStagingRouter from "./swingStaging";
import alertsRouter from "./alerts";
import dailyAnalysisRouter from "./dailyAnalysis";
import dataHealthRouter from "./dataHealth";
import secretsVaultRouter from "./secretsVault";
import systemStatusRouter from "./systemStatus";
import parityRouter from "./parity";
import dataParityRouter from "./dataParity";
import buildInfoRouter from "./buildInfo";
import { startInstFlowsRefresher } from "../lib/instFlows";
import { triggerKiteWarmup } from "../lib/kiteWarmup";
import { scheduleBootJob, BOOT_STAGGER_MS } from "../lib/bootScheduler";
import { bootstrapKite } from "../lib/kiteFeed";
import { startKiteReadinessScheduler } from "../lib/kiteReadinessScheduler";
import { startSwingScanScheduler } from "../lib/swingScannerStore";
import { startOptionSnapshotIngestor } from "../lib/optionChainSnapshotIngestor";
import { startCandleWarehouse } from "../lib/candleWarehouseIngestor";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scannerRouter);
router.use(tradingViewRouter);
router.use(instFlowsRouter);
router.use(kiteRouter);
router.use(optionChainRouter);
router.use(oiLabRouter);
router.use(optionStrategiesRouter);
router.use(deepScanRouter);
router.use(systemRouter);
router.use(stocksToWatchRouter);
router.use(indicesRouter);
router.use(userAuthRouter);   // /auth/signup, /auth/user-login, /auth/me, /personal-watchlist/*
router.use(adminRouter);      // /admin/users[/:id] — owner-only via router-level requireOwner
router.use(paperRouter);      // /paper/* — owner-only paper trading (per-route requireOwner)
router.use(paperComboRouter); // /paper/combos/* — owner-only manual multi-leg combo lane (Tier C)
router.use(homeRouter);       // /home/enrichment — aggregated home dashboard data
router.use(optionChainSnapshotRouter); // /option-snapshots/* — owner-only diagnostics for write-only F&O snapshot store
router.use(candleWarehouseRouter);     // /candles/* — owner-only diagnostics + manual sync for the candle warehouse
router.use(equitySizingRouter);        // /paper/eq/sizing-preview + /paper/eq/candidates-diagnostic — owner-only read-only sizing helper (Priority 5)
router.use(chartRouter);               // /chart/instruments + /chart/candles — read-only Charting tab datafeed (public-mode read like scanner)
router.use(portfolioRouter);           // /portfolios/* — per-user saved Portfolio Analyser portfolios (owner OR subscriber; ownerKey-scoped)
router.use(fnoRouter);                  // /fno/* — owner-only READ-ONLY consolidating F&O diagnostics facade (data-health, today, gate-waterfall, no-trade-reasons, setup-performance)
router.use(backtestRouter);             // /backtest/fno/* — Backtest Lab (owner OR subscriber; ownerKey-scoped) — REAL_REPLAY + DIRECTIONAL honest backtests, no fabricated option data
router.use(dataRouter);                 // /data/* — owner-only diagnostics for the central market-data layer (trust-tier policy + Kite/INDstocks/Yahoo health + per-symbol probe)
router.use(swingStagingRouter);         // /swing/* — Phase 2 Swing CASH live-readiness staging + fast-approval queue (broker HARD-DISABLED; reads subscriber+owner, mutations owner-only)
router.use(alertsRouter);               // /alerts/* — owner-only alert diagnostics (GET /alerts/status, includes lastFnoSignalAlert) + test endpoints (test-telegram, test-swing-staged-order, test-fno-trade-signal)
router.use(dailyAnalysisRouter);        // /daily-analysis/* — owner-only pre/post market daily analysis report management (PREPOST bot, DB dedup, history)
router.use(dataHealthRouter);           // /data-health/market — PUBLIC canonical market data health (session+feed+market-session, no secrets)
router.use(secretsVaultRouter);         // /secrets-vault/* — owner-only (strict) credential intake, masked status only
router.use(systemStatusRouter);         // /system/mode, /system/mode-override, /metrics — BUG-28/29/89
router.use(parityRouter);               // /parity/* — owner-only Deterministic Parity Verification Harness (dry_run, replay, status — no Telegram to real channel)
router.use(dataParityRouter);           // /data-parity/* — owner-only Checkpoint 3 Data Parity API (requireOwnerStrict; cross-module symbol/index observation diff, read-only)
router.use(buildInfoRouter);            // /build-info   — PUBLIC read-only build/deploy identity (no secrets; registered in PUBLIC_ROUTES)

// Kick off background fetcher (FII/DII + participant OI) on first router import.
// W6-P4A: staggered to the back of the cold-start window (heaviest boot job —
// 45-day NSE backfill) so it doesn't contend with the other boot jobs for the
// shared DB pool. Internal 15-min refresh cadence + OI lookback unchanged.
scheduleBootJob("inst-flows-refresher", BOOT_STAGGER_MS.instFlowsRefresher, startInstFlowsRefresher);
// Prime Kite F&O data (index quotes + candles + option chain) once at boot if a
// session was resumed. Single-flight + debounced + fail-closed on no session
// inside triggerKiteWarmup; scheduleBootJob's fail-open wrapper catches throws.
scheduleBootJob("kite-warmup", BOOT_STAGGER_MS.kiteWarmup, async () => {
  await triggerKiteWarmup("boot");
});
// Try to resume Kite live feed if a valid session is already in the DB.
void bootstrapKite();
// Pre-open Kite reconnect safeguard — visibility-only escalating log if the
// session is offline as the market open approaches (08:40–09:20 IST).
startKiteReadinessScheduler();
// Swing-scanner scheduler — once-per-IST-day deep scan after 15:35 +
// 15-min intraday LTP refresh during market hours. Single-replica
// assumption (latches live in-process).
startSwingScanScheduler();
// Option-chain snapshot ingestor — gated by `OPTION_SNAPSHOT_ENABLED`
// (or auto-detected REPLIT_DEPLOYMENT). Default-OFF in dev so writes
// don't fight production. Write-only data layer — does not feed any
// trading decision.
startOptionSnapshotIngestor();
// Candle warehouse — daily EOD sync after 15:40 IST + 15-min intraday
// during market hours. Gated by `CANDLE_WAREHOUSE_ENABLED` (auto-off
// in dev). Write-only data substrate — does not feed any trading
// decision (swing scanner / F&O signals continue to read from
// fetchKiteHistoricalByToken directly).
startCandleWarehouse();

export default router;
