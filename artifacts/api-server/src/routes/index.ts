import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scannerRouter from "./scanner";
import tradingViewRouter from "./tradingview";
import instFlowsRouter from "./instFlows";
import kiteRouter from "./kite";
import { startInstFlowsRefresher } from "../lib/instFlows";
import { bootstrapKite } from "../lib/kiteFeed";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scannerRouter);
router.use(tradingViewRouter);
router.use(instFlowsRouter);
router.use(kiteRouter);

// Kick off background fetcher (FII/DII + participant OI) on first router import.
startInstFlowsRefresher();
// Try to resume Kite live feed if a valid session is already in the DB.
void bootstrapKite();

export default router;
