/**
 * GET /api/data-health/market — PUBLIC canonical market data health endpoint.
 *
 * Returns the unified MarketDataHealth contract used across the whole website
 * for data-source status display. Combines Kite session readiness, WebSocket
 * feed state, and market session into one honest, non-contradictory signal.
 *
 * SAFETY:
 *   - No secrets, API keys, access tokens, chat IDs, or user PII.
 *   - No trading mutations.
 *   - Reads existing in-process state only (no additional DB or network calls
 *     beyond what getKiteReadiness() already does).
 *   - Exempt from requireAuth — this status is safe and useful for all users.
 */
import { Router, type IRouter } from "express";
import { buildMarketDataHealth } from "../lib/marketDataHealth";

const router: IRouter = Router();

router.get("/data-health/market", async (req, res) => {
  try {
    const health = await buildMarketDataHealth();
    res.json(health);
  } catch (err) {
    req.log.error({ err }, "data-health/market failed");
    res.status(500).json({ error: "health check failed" });
  }
});

export default router;
