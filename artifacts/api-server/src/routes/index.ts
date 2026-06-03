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
import { startInstFlowsRefresher } from "../lib/instFlows";
import { scheduleBootJob, BOOT_STAGGER_MS } from "../lib/bootScheduler";
import { bootstrapKite } from "../lib/kiteFeed";
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

// Kick off background fetcher (FII/DII + participant OI) on first router import.
// W6-P4A: staggered to the back of the cold-start window (heaviest boot job —
// 45-day NSE backfill) so it doesn't contend with the other boot jobs for the
// shared DB pool. Internal 15-min refresh cadence + OI lookback unchanged.
scheduleBootJob("inst-flows-refresher", BOOT_STAGGER_MS.instFlowsRefresher, startInstFlowsRefresher);
// Try to resume Kite live feed if a valid session is already in the DB.
void bootstrapKite();
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
