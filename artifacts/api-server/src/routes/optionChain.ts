import { Router, type IRouter } from "express";
import { fetchOptionChain } from "../lib/optionChain";
import { computeAnalytics } from "../lib/optionAnalytics";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/options/chain/:underlying", async (req, res): Promise<void> => {
  const underlying = String(req.params.underlying ?? "").trim();
  const expiry = typeof req.query.expiry === "string" ? req.query.expiry : undefined;
  if (!underlying) { res.status(400).json({ error: "underlying required" }); return; }

  try {
    const chain = await fetchOptionChain(underlying, expiry);
    if (!chain) {
      res.status(503).json({
        error: "Option chain unavailable",
        detail:
          "NSE returned no data for this underlying. Either (a) the symbol is not in the NSE F&O list, or (b) this server is being geo-blocked by NSE — NSE's option-chain API silently rejects non-Indian IPs. To get live data either deploy to an Indian-region host or complete the Zerodha Kite Connect daily login from the Live Feed page.",
        underlying,
      });
      return;
    }
    res.json(chain);
  } catch (err) {
    logger.error({ err: (err as Error).message, underlying }, "Option chain handler crashed");
    res.status(500).json({ error: "Internal error fetching option chain" });
  }
});

router.get("/options/analytics/:underlying", async (req, res): Promise<void> => {
  const underlying = String(req.params.underlying ?? "").trim();
  const expiry = typeof req.query.expiry === "string" ? req.query.expiry : undefined;
  if (!underlying) { res.status(400).json({ error: "underlying required" }); return; }

  try {
    const chain = await fetchOptionChain(underlying, expiry);
    if (!chain) {
      res.status(503).json({ error: "Option chain unavailable", underlying });
      return;
    }
    res.json(computeAnalytics(chain));
  } catch (err) {
    logger.error({ err: (err as Error).message, underlying }, "Option analytics handler crashed");
    res.status(500).json({ error: "Internal error computing analytics" });
  }
});

export default router;
