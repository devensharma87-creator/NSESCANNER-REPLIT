import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scannerRouter from "./scanner";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scannerRouter);

export default router;
