import { Router, type IRouter } from "express";
import { fetchOptionChain } from "../lib/optionChain";
import { computeAnalytics } from "../lib/optionAnalytics";
import { enrichAnalyticsWithIv } from "../lib/ivHistory";
import { getActiveSession } from "../lib/kiteAuth";
import { logger } from "../lib/logger";
import { sendExport } from "../lib/csvExport";

const router: IRouter = Router();

router.get("/options/chain/:underlying", async (req, res): Promise<void> => {
  const underlying = String(req.params.underlying ?? "").trim();
  const expiry = typeof req.query.expiry === "string" ? req.query.expiry : undefined;
  if (!underlying) { res.status(400).json({ error: "underlying required" }); return; }

  try {
    const chain = await fetchOptionChain(underlying, expiry);
    if (!chain) {
      const kiteSession = await getActiveSession().catch(() => null);
      const detail = kiteSession
        ? `Both data sources returned no chain for ${underlying}. Either the symbol is not in NSE's F&O list, or your Kite session has expired (Kite tokens expire daily at ~07:30 IST). Try re-authenticating from the Live Feed page.`
        : `Live data is currently unavailable from this server. NSE's option-chain API silently rejects non-Indian cloud IPs, and no Kite Connect session is active. To unblock: complete the daily Kite Connect login from the Live Feed page (recommended, works from any IP), or deploy this app to an Indian-region host.`;
      res.status(503).json({
        error: "Option chain unavailable",
        detail,
        kiteAuthenticated: !!kiteSession,
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
    const analytics = computeAnalytics(chain);
    const ivMetrics = await enrichAnalyticsWithIv(analytics);
    analytics.ivRank = ivMetrics.ivRank;
    analytics.ivPercentile = ivMetrics.ivPercentile;
    res.json(analytics);
  } catch (err) {
    logger.error({ err: (err as Error).message, underlying }, "Option analytics handler crashed");
    res.status(500).json({ error: "Internal error computing analytics" });
  }
});

/**
 * GET /api/options/chain/:underlying/export?format=csv|json[&expiry=YYYY-MM-DD]
 *
 * Streams the full strike-by-strike chain as a downloadable file. CE and PE
 * legs are flattened to a single row per strike (ce_* / pe_* prefix) so the
 * CSV opens cleanly in Excel/Sheets without per-cell JSON parsing.
 */
router.get("/options/chain/:underlying/export", async (req, res): Promise<void> => {
  const underlying = String(req.params.underlying ?? "").trim().toUpperCase();
  const expiry = typeof req.query.expiry === "string" ? req.query.expiry : undefined;
  const format = String(req.query.format ?? "csv").toLowerCase();
  if (!underlying) { res.status(400).json({ error: "underlying required" }); return; }

  try {
    const chain = await fetchOptionChain(underlying, expiry);
    if (!chain) { res.status(503).json({ error: "Option chain unavailable", underlying }); return; }
    const flat = chain.rows.map(r => ({
      strike: r.strike,
      atm: r.strike === chain.atmStrike ? "Y" : "",
      maxPain: r.isMaxPain ? "Y" : "",
      pcrOi: r.pcrOi ?? "",
      pcrVol: r.pcrVol ?? "",
      ce_ltp: r.ce?.ltp ?? "",
      ce_ltpChgPct: r.ce?.ltpChgPct ?? "",
      ce_iv: r.ce?.iv ?? "",
      ce_delta: r.ce?.delta ?? "",
      ce_gamma: r.ce?.gamma ?? "",
      ce_theta: r.ce?.theta ?? "",
      ce_vega: r.ce?.vega ?? "",
      ce_oi: r.ce?.oi ?? "",
      ce_oiChange: r.ce?.chgOi ?? "",
      ce_oiChgPct: r.ce?.oiChgPct ?? "",
      ce_volume: r.ce?.volume ?? "",
      ce_volOiRatio: r.ce?.volOiRatio ?? "",
      ce_intrinsic: r.ce?.intrinsic ?? "",
      ce_intrinsicPct: r.ce?.intrinsicPct ?? "",
      ce_timeValue: r.ce?.timeValue ?? "",
      ce_moneyness: r.ce?.moneyness ?? "",
      ce_buildup: r.ce?.oiBuildup ?? "",
      pe_ltp: r.pe?.ltp ?? "",
      pe_ltpChgPct: r.pe?.ltpChgPct ?? "",
      pe_iv: r.pe?.iv ?? "",
      pe_delta: r.pe?.delta ?? "",
      pe_gamma: r.pe?.gamma ?? "",
      pe_theta: r.pe?.theta ?? "",
      pe_vega: r.pe?.vega ?? "",
      pe_oi: r.pe?.oi ?? "",
      pe_oiChange: r.pe?.chgOi ?? "",
      pe_oiChgPct: r.pe?.oiChgPct ?? "",
      pe_volume: r.pe?.volume ?? "",
      pe_volOiRatio: r.pe?.volOiRatio ?? "",
      pe_intrinsic: r.pe?.intrinsic ?? "",
      pe_intrinsicPct: r.pe?.intrinsicPct ?? "",
      pe_timeValue: r.pe?.timeValue ?? "",
      pe_moneyness: r.pe?.moneyness ?? "",
      pe_buildup: r.pe?.oiBuildup ?? "",
      underlying: chain.underlying,
      spot: chain.spot,
      atmStrike: chain.atmStrike,
      maxPainStrike: chain.maxPainStrike ?? "",
      expiry: chain.expiry,
      asOf: chain.generatedAt,
    }));
    sendExport(res, `option-chain-${underlying}`, format, flat);
  } catch (err) {
    logger.error({ err: (err as Error).message, underlying }, "Option chain export crashed");
    res.status(500).json({ error: "Internal error exporting chain" });
  }
});

export default router;
