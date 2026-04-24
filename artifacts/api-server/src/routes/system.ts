import { Router, type IRouter } from "express";
import { runSecurityAudit } from "../lib/securityAudit";
import { buildStatusReport } from "../lib/systemStatus";

const router: IRouter = Router();

router.get("/security/audit", async (_req, res, next) => {
  try {
    res.json(await runSecurityAudit());
  } catch (err) {
    next(err);
  }
});

router.get("/system/status", async (_req, res, next) => {
  try {
    const report = await buildStatusReport();
    res.json(report);
  } catch (err) {
    next(err);
  }
});

export default router;
