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
import homeRouter from "./home";
import { startInstFlowsRefresher } from "../lib/instFlows";
import { bootstrapKite } from "../lib/kiteFeed";

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
router.use(homeRouter);       // /home/enrichment — aggregated home dashboard data

// Kick off background fetcher (FII/DII + participant OI) on first router import.
startInstFlowsRefresher();
// Try to resume Kite live feed if a valid session is already in the DB.
void bootstrapKite();

export default router;
