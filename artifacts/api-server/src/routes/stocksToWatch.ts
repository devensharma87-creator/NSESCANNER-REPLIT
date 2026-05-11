import { Router, type IRouter } from "express";
import { getStocksToWatch } from "../lib/stocksToWatch";
import { getLatestSwingScan, getSchedulerState } from "../lib/swingScannerStore";

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

/**
 * GET /api/stocks-to-watch/analysis
 *
 * NIFTY 500 swing-scanner deep-scan results (+ optional intraday LTP /
 * trigger-hit overlay). Cached in `swing_scan_result` keyed
 * (symbol, scan_date) — populated once per IST trading day after 15:35
 * by `swingScannerStore.runDeepScan` and refreshed every 15 min during
 * market hours by `runIntradayRefresh`.
 *
 * Same auth posture as the news catalyst endpoint above (open, public-
 * mode allowed) since the underlying `/stocks-to-watch` page itself is
 * public.
 *
 * Query params:
 *   ?limit=500              — cap rows (default 500, max 600)
 *   ?action=BUY%20ZONE...   — exact-match Action filter
 *   ?setup=...              — exact-match Setup filter
 *   ?minScore=60            — drop rows with score < N
 *   ?qualityGrade=A         — A / B+ / B / C / Watch Only / D / Avoid
 */
router.get("/stocks-to-watch/analysis", async (req, res, next) => {
  try {
    const limit = req.query["limit"] ? parseInt(String(req.query["limit"]), 10) : undefined;
    const minScore = req.query["minScore"] ? parseFloat(String(req.query["minScore"])) : undefined;
    const payload = await getLatestSwingScan({
      limit: Number.isFinite(limit ?? NaN) ? limit : undefined,
      action: typeof req.query["action"] === "string" ? req.query["action"] : undefined,
      setup: typeof req.query["setup"] === "string" ? req.query["setup"] : undefined,
      qualityGrade: typeof req.query["qualityGrade"] === "string" ? req.query["qualityGrade"] : undefined,
      minScore: Number.isFinite(minScore ?? NaN) ? minScore : undefined,
    });
    res.json({ ...payload, scheduler: getSchedulerState() });
  } catch (err) { next(err); }
});

export default router;
