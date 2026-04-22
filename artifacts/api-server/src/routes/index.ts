import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scannerRouter from "./scanner";
import tradingViewRouter from "./tradingview";
import instFlowsRouter from "./instFlows";
import { startInstFlowsRefresher } from "../lib/instFlows";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scannerRouter);
router.use(tradingViewRouter);
router.use(instFlowsRouter);

// Kick off background fetcher (FII/DII + participant OI) on first router import.
startInstFlowsRefresher();

export default router;
