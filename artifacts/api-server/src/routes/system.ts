import { Router, type IRouter } from "express";
import { runSecurityAudit } from "../lib/securityAudit";
import { buildStatusReport } from "../lib/systemStatus";
import { requireOwner } from "../lib/userAuth";

const router: IRouter = Router();

// Audit + Status tabs are owner-only operational dashboards.
// Path-scoped to the two route prefixes this router owns.
router.use(["/security", "/system"], requireOwner);

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
