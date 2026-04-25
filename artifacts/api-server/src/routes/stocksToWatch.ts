import { Router, type IRouter } from "express";
import { getStocksToWatch } from "../lib/stocksToWatch";

const router: IRouter = Router();

/**
 * GET /api/stocks-to-watch
 *
 * Daily deck of NSE stocks with positive (WATCH) or negative (AVOID) catalysts
 * extracted from the last 24h of news from Moneycontrol, Mint, Economic Times,
 * CNBC TV18, Business Standard, Investing.com, Yahoo Finance.
 *
 * Query params:
 *   ?lookback=24   — hours of news to scan (default 24, max 96)
 */
router.get("/stocks-to-watch", async (req, res, next) => {
  try {
    const lookback = Math.max(1, Math.min(96, parseInt(String(req.query["lookback"] ?? "24"), 10) || 24));
    const payload = await getStocksToWatch(lookback);
    res.json(payload);
  } catch (err) { next(err); }
});

export default router;
