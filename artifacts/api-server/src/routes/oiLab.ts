import { Router, type IRouter } from "express";
import {
  bulkSnapshot, snapshotToCsv,
  fetchOiHeatmap, getOiHeatmapForExport,
  startTracker, stopTracker, getTrackerStatus, getTrackerSeries,
  fetchOiInsights,
  getDynamicFnoUniverse,
  FNO_INDICES,
} from "../lib/oiLab";
import { getActiveSession } from "../lib/kiteAuth";
import { logger } from "../lib/logger";
import { sendExport } from "../lib/csvExport";

const router: IRouter = Router();

// Static fallback universe (used only when Kite isn't connected). Keeping this
// here as a safety-net so the picker has SOMETHING to show on a fresh load
// before Kite login. The dynamic Kite-derived list is preferred and replaces
// this once available.
const STATIC_FALLBACK_STOCKS = [
  "RELIANCE","TCS","HDFCBANK","ICICIBANK","INFY","SBIN","BHARTIARTL","ITC","HINDUNILVR","KOTAKBANK",
  "LT","AXISBANK","MARUTI","SUNPHARMA","TITAN","BAJFINANCE","NTPC","ULTRACEMCO","HCLTECH","ASIANPAINT",
  "WIPRO","NESTLEIND","M&M","POWERGRID","TATASTEEL","TECHM","JSWSTEEL","INDUSINDBK","BAJAJFINSV","HDFCLIFE",
  "DRREDDY","CIPLA","COALINDIA","BPCL","HEROMOTOCO","BRITANNIA","SHRIRAMFIN","SBILIFE","EICHERMOT","ONGC",
];

// Universe — Kite-derived live F&O list. Falls back to a static list when
// Kite isn't connected so the picker always renders something.
router.get("/options/oi-lab/universe", async (_req, res) => {
  const dynamic = await getDynamicFnoUniverse();
  if (dynamic && dynamic.length > 0) {
    res.json({
      indices: [...FNO_INDICES],
      stocks: dynamic,
      source: "kite",
      count: dynamic.length,
    });
    return;
  }
  res.json({
    indices: [...FNO_INDICES],
    stocks: STATIC_FALLBACK_STOCKS,
    source: "fallback",
    count: STATIC_FALLBACK_STOCKS.length,
    note: "Connect Kite (Live Feed → Connect) to load the full live F&O universe (~210+ stocks).",
  });
});

// OI Insights — rich per-strike payload for ONE underlying (single network
// call powers the OI Insights tab: sentiment gauge + multi-strike OI chart +
// max-pain + PCR donut + plain-English analysis).
router.get("/options/oi-lab/insights/:underlying", async (req, res) => {
  const sym = String(req.params.underlying ?? "").toUpperCase().trim();
  if (!sym) {
    res.status(400).json({ error: "underlying required" });
    return;
  }
  const expiry = typeof req.query.expiry === "string" ? req.query.expiry : undefined;
  const strikesParam = String(req.query.strikes ?? "20");
  const strikesAround =
    strikesParam === "all" ? 999
    : strikesParam === "atm" ? 0
    : Math.max(0, Math.min(Number(strikesParam) || 20, 50));
  // Optional finite Δ window (e.g. "?window=5m"). The server keeps a
  // per-(underlying|expiry) snapshot history, so any window between the
  // sampling cadence (~30s) and 3h works the moment the page loads —
  // no client-side buffer warmup required. Unknown / malformed values
  // are silently ignored so the client falls back to the broker
  // since-open Δ rather than failing.
  const WINDOW_MAP: Record<string, number> = {
    "3m":  3 * 60_000,
    "5m":  5 * 60_000,
    "10m": 10 * 60_000,
    "15m": 15 * 60_000,
    "30m": 30 * 60_000,
    "1h":  60 * 60_000,
    "2h":  120 * 60_000,
    "3h":  180 * 60_000,
  };
  const windowParam = typeof req.query.window === "string" ? req.query.window : undefined;
  const windowMs = windowParam && WINDOW_MAP[windowParam] != null ? WINDOW_MAP[windowParam] : undefined;

  const session = await getActiveSession().catch(() => null);
  if (!session) {
    res.status(503).json({
      error: "kite_login_required",
      detail: "OI Insights needs an active Kite session. Open the Live Feed page and complete the daily login first.",
      kiteAuthenticated: false,
    });
    return;
  }
  try {
    const insights = await fetchOiInsights(sym, expiry, strikesAround, windowMs);
    if (!insights) {
      res.status(404).json({
        error: "no_chain_data",
        detail: `No option-chain data for ${sym} (instrument unavailable or expiry mismatch).`,
        kiteAuthenticated: true,
      });
      return;
    }
    // Per spec §12 "Debugging and Validation" — log every windowed Δ
    // resolution with the exact baseline pick, mode, and computed totals
    // so server-side log inspection can verify the math without round-
    // tripping through the client. Only logged for windowed requests
    // (since-open / "All" mode doesn't have a baseline pick to audit).
    if (windowMs != null) {
      req.log.info({
        sym,
        expiry: insights.expiry,
        windowParam,
        windowMs,
        windowMode: insights.windowMode,
        windowBaselineAt: insights.windowBaselineAt,
        bufferCount: insights.windowBufferCount,
        bufferOldestAt: insights.windowBufferOldestAt,
        strikesIncluded: insights.windowTotals?.strikesIncluded,
        callOiChangeCr: insights.windowTotals?.callOiChangeCr,
        putOiChangeCr:  insights.windowTotals?.putOiChangeCr,
        pcrEnd:         insights.windowPcr?.pcrEnd,
        pcrChange:      insights.windowPcr?.pcrChange,
        pcrOiChange:    insights.windowPcr?.pcrOiChange,
      }, "OI insights windowed Δ resolved");
    }
    res.json(insights);
  } catch (err) {
    logger.error({ err: (err as Error).message, sym }, "fetchOiInsights failed");
    res.status(500).json({
      error: "insights_failed",
      detail: (err as Error).message,
      kiteAuthenticated: true,
    });
  }
});

// Bulk snapshot — returns aggregated chain analytics for a list of underlyings.
// Body: { underlyings: string[], includeChain?: boolean, format?: "json"|"csv" }
router.post("/options/oi-lab/snapshot", async (req, res) => {
  const body = (req.body ?? {}) as { underlyings?: unknown; includeChain?: unknown; format?: unknown };
  const list = Array.isArray(body.underlyings) ? body.underlyings.map(String) : [];
  if (list.length === 0) {
    res.status(400).json({ error: "underlyings (string[]) required" });
    return;
  }
  if (list.length > 50) {
    res.status(400).json({ error: "Cannot request more than 50 underlyings per call (avoid Kite rate limits)" });
    return;
  }
  const session = await getActiveSession().catch(() => null);
  if (!session) {
    res.status(503).json({
      error: "kite_login_required",
      detail: "Bulk snapshot needs an active Kite session. Open the Live Feed page and complete the daily login first.",
    });
    return;
  }
  try {
    const snap = await bulkSnapshot(list, {
      includeChain: body.includeChain === true,
      concurrency: 6,
    });
    if (body.format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="oi-snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv"`,
      );
      res.send(snapshotToCsv(snap));
      return;
    }
    res.json(snap);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "bulkSnapshot failed");
    res.status(500).json({ error: "bulk_snapshot_failed", detail: (err as Error).message });
  }
});

// OI Heatmap — futures-based long/short buildup classification for all F&O stocks.
router.get("/options/oi-lab/heatmap", async (_req, res) => {
  try {
    const data = await fetchOiHeatmap();
    if (!data) {
      const session = await getActiveSession().catch(() => null);
      res.status(503).json({
        error: session ? "heatmap_unavailable" : "kite_login_required",
        detail: session
          ? "Could not load NFO instruments or quotes from Kite right now."
          : "OI heatmap needs an active Kite session. Login from the Live Feed page first.",
      });
      return;
    }
    res.json(data);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "fetchOiHeatmap failed");
    res.status(500).json({ error: "heatmap_failed", detail: (err as Error).message });
  }
});

// Tracker — start/stop/series for the in-memory snapshot loop.
router.post("/options/oi-lab/tracker/start", async (req, res) => {
  const body = (req.body ?? {}) as { underlyings?: unknown; intervalMinutes?: unknown };
  const list = Array.isArray(body.underlyings) ? body.underlyings.map(String) : [];
  const minutes = typeof body.intervalMinutes === "number" ? body.intervalMinutes : 5;
  try {
    const status = await startTracker({
      underlyings: list,
      intervalMs: Math.round(minutes * 60_000),
    });
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: "tracker_start_failed", detail: (err as Error).message });
  }
});

router.post("/options/oi-lab/tracker/stop", (req, res) => {
  const clearData = req.query.clear === "true" || req.query.clear === "1";
  res.json(stopTracker(clearData));
});

router.get("/options/oi-lab/tracker/status", (_req, res) => {
  res.json(getTrackerStatus());
});

router.get("/options/oi-lab/tracker/series", (req, res) => {
  const u = typeof req.query.underlying === "string" ? req.query.underlying : undefined;
  res.json({
    status: getTrackerStatus(),
    series: getTrackerSeries(u),
  });
});

// ── Exports (CSV/JSON download) ───────────────────────────────────────────

/** GET /api/options/oi-lab/heatmap/export?format=csv|json
 *  Streams every futures row from the latest heatmap snapshot. */
router.get("/options/oi-lab/heatmap/export", async (req, res) => {
  try {
    const data = await getOiHeatmapForExport();
    if (!data) { res.status(503).json({ error: "heatmap_unavailable" }); return; }
    const format = String(req.query.format ?? "csv").toLowerCase();
    sendExport(res, "oi-heatmap", format, data.rows.map(r => ({
      symbol: r.symbol,
      future: r.fut,
      expiry: r.expiry,
      ltp: r.ltp,
      prevClose: r.prevClose,
      priceChgPct: r.priceChgPct,
      oi: r.oi,
      baselineOi: r.baselineOi,
      oiChgAbs: r.oiChgAbs,
      oiChgPct: r.oiChgPct,
      bucket: r.bucket,
      notional: r.notional,
      lotSize: r.lotSize,
      volume: r.volume,
      generatedAt: data.generatedAt,
      baselineEstablishedAt: data.baselineEstablishedAt,
    })));
  } catch (err) {
    logger.error({ err: (err as Error).message }, "OI heatmap export failed");
    res.status(500).json({ error: "heatmap_export_failed" });
  }
});

/** GET /api/options/oi-lab/tracker/export?format=csv|json[&underlying=NIFTY]
 *  Streams every recorded tracker snapshot (optionally one underlying). */
router.get("/options/oi-lab/tracker/export", (req, res) => {
  try {
    const u = typeof req.query.underlying === "string" ? req.query.underlying : undefined;
    const series = getTrackerSeries(u);
    const format = String(req.query.format ?? "csv").toLowerCase();
    const base = u ? `oi-tracker-${u.toUpperCase()}` : "oi-tracker";
    sendExport(res, base, format, series.map(s => ({
      ts: s.ts,
      underlying: s.underlying,
      spot: s.spot,
      changePercent: s.changePercent,
      atmStrike: s.atmStrike,
      pcrOi: s.pcrOi,
      pcrVolume: s.pcrVolume,
      maxPain: s.maxPain,
      atmIv: s.atmIv ?? "",
      totalCallOi: s.totalCallOi,
      totalPutOi: s.totalPutOi,
      callOiAdded: s.callOiAdded,
      putOiAdded: s.putOiAdded,
      bias: s.bias,
    })));
  } catch (err) {
    logger.error({ err: (err as Error).message }, "OI tracker export failed");
    res.status(500).json({ error: "tracker_export_failed" });
  }
});

export default router;
