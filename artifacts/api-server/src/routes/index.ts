import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scannerRouter from "./scanner";
import tradingViewRouter from "./tradingview";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scannerRouter);
router.use(tradingViewRouter);

export default router;
