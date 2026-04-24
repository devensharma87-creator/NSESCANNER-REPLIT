import { Router, type IRouter } from "express";
import { fetchOptionChain } from "../lib/optionChain";
import { computeAnalytics } from "../lib/optionAnalytics";
import { buildStrategies } from "../lib/optionStrategies";
import { getActiveSession } from "../lib/kiteAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/options/strategies/:underlying", async (req, res): Promise<void> => {
  const underlying = String(req.params.underlying ?? "").trim();
  const expiry = typeof req.query.expiry === "string" ? req.query.expiry : undefined;
  if (!underlying) { res.status(400).json({ error: "underlying required" }); return; }

  try {
    const chain = await fetchOptionChain(underlying, expiry);
    if (!chain) {
      const kiteSession = await getActiveSession().catch(() => null);
      const detail = kiteSession
        ? `Both data sources returned no chain for ${underlying}. Either the symbol is not in NSE's F&O list, or your Kite session has expired (Kite tokens expire daily at ~07:30 IST). Try re-authenticating from the Live Feed page.`
        : `Live data is currently unavailable. NSE's option-chain API silently rejects non-Indian cloud IPs, and no Kite Connect session is active. Authenticate from the Live Feed page (works from any IP) to enable strategies.`;
      res.status(503).json({
        error: "Option chain unavailable",
        detail,
        kiteAuthenticated: !!kiteSession,
        underlying,
      });
      return;
    }
    const analytics = computeAnalytics(chain);
    const bundle = buildStrategies(chain, analytics);
    res.json({ ...bundle, analytics });
  } catch (err) {
    logger.error({ err: (err as Error).message, underlying }, "Strategies handler crashed");
    res.status(500).json({ error: "Internal error building strategies" });
  }
});

export default router;
