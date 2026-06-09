import { Router, type IRouter } from "express";
import { requireOwner } from "../lib/userAuth";
import { buildDataDiagnostics, buildSymbolDiagnostic } from "../lib/marketData";

/**
 * /api/data/* — owner-only diagnostics for the central market-data layer.
 *
 * Surfaces the trust-tier policy and honest provider health (Kite authoritative,
 * INDstocks disabled scaffold, Yahoo analytics-only) plus a per-symbol probe
 * showing exactly what the trusted router would return for a symbol.
 *
 * Read-only. Does not place orders, mutate state, or feed any trading decision.
 */
const router: IRouter = Router();

router.use("/data", requireOwner);

router.get("/data/diagnostics", (_req, res, next) => {
  try {
    res.json(buildDataDiagnostics());
  } catch (err) {
    next(err);
  }
});

router.get("/data/diagnostics/symbol/:symbol", async (req, res, next) => {
  try {
    const raw = req.params["symbol"];
    const symbol = Array.isArray(raw) ? raw[0] : raw;
    if (!symbol || !symbol.trim()) {
      res.status(400).json({ error: "symbol is required" });
      return;
    }
    res.json(await buildSymbolDiagnostic(symbol.trim()));
  } catch (err) {
    next(err);
  }
});

export default router;
