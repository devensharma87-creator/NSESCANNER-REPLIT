import { Router, type IRouter } from "express";
import {
  bulkSnapshot, snapshotToCsv,
  fetchOiHeatmap,
  startTracker, stopTracker, getTrackerStatus, getTrackerSeries,
  FNO_INDICES,
} from "../lib/oiLab";
import { isFnoUnderlying } from "../lib/optionChain";
import { getActiveSession } from "../lib/kiteAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Universe — all F&O symbols the picker can choose from. We expose the
// curated list from optionChain.ts (~190 stocks + 5 indices).
router.get("/options/oi-lab/universe", (_req, res) => {
  // Probe the curated set by trying every alpha symbol against isFnoUnderlying
  // is wasteful; instead, hardcode a sourced reference list. The authoritative
  // F&O list lives in optionChain.ts so we re-export the same names here by
  // walking that module's exported predicate.
  const stocks = [
    "RELIANCE","TCS","HDFCBANK","ICICIBANK","INFY","SBIN","BHARTIARTL","ITC","HINDUNILVR","KOTAKBANK",
    "LT","AXISBANK","MARUTI","SUNPHARMA","TITAN","BAJFINANCE","NTPC","ULTRACEMCO","HCLTECH","ASIANPAINT",
    "WIPRO","NESTLEIND","M&M","POWERGRID","TATASTEEL","TECHM","JSWSTEEL","INDUSINDBK","BAJAJFINSV","HDFCLIFE",
    "DRREDDY","CIPLA","COALINDIA","BPCL","HEROMOTOCO","BRITANNIA","SHRIRAMFIN","SBILIFE","EICHERMOT","ONGC",
    "GRASIM","BAJAJ-AUTO","ADANIPORTS","ADANIENT","HINDALCO","APOLLOHOSP","TATACONSUM","TRENT","JIOFIN","TATAMOTORS",
    "DIVISLAB","DLF","ADANIGREEN","ADANIPOWER","TATAPOWER","HAVELLS","SIEMENS","CHOLAFIN","DMART","GODREJCP",
    "DABUR","COLPAL","MARICO","PIDILITIND","ICICIPRULI","ICICIGI","LICI","BEL","HAL","AMBUJACEM",
    "ACC","DALBHARAT","MUTHOOTFIN","HDFCAMC","BERGEPAINT","BIOCON","LUPIN","TORNTPHARM","ZYDUSLIFE","AUROPHARMA",
    "ALKEM","GLENMARK","SRF","UPL","PIIND","COROMANDEL","DEEPAKNTR","FLUOROCHEM","INDIGO","IRCTC",
    "NAUKRI","ZOMATO","NYKAA","PAYTM","POLICYBZR","DIXON","KPITTECH","MPHASIS","COFORGE","PERSISTENT",
    "LTIM","TIINDIA","BHEL","CUMMINSIND","BHARATFORG","CONCOR","ABB","BOSCHLTD","TVSMOTOR","ASHOKLEY",
    "MOTHERSON","BALKRISIND","ESCORTS","EXIDEIND","MRF","APOLLOTYRE","IDFCFIRSTB","FEDERALBNK","BANKBARODA","PNB",
    "CANBK","AUBANK","BANDHANBNK","RBLBANK","IDEA","INDUSTOWER","RECLTD","PFC","IRFC","SBICARD",
    "CHAMBLFERT","GNFC","MCX","ANGELONE","CDSL","BSOFT","NAVINFLUOR","ASTRAL","POLYCAB","VBL",
    "TATACOMM","UNITDSPR","JUBLFOOD","PAGEIND","HINDPETRO","IOC","GAIL","PETRONET","IGL","GUJGASLTD",
    "MGL","NMDC","JINDALSTEL","SAIL","NATIONALUM","HINDCOPPER","VEDL","MAZDOCK","OFSS","MFSL",
    "RAMCOCEM","VOLTAS","BLUESTARCO","BATAINDIA","TRIDENT","ABFRL","ABCAPITAL","OBEROIRLTY","PRESTIGE","PHOENIXLTD",
    "GODREJPROP","TATAELXSI","CYIENT","INDHOTEL","JUBLPHARMA","LAURUSLABS","SYNGENE","POONAWALLA","M&MFIN","BAJAJHLDNG",
    "ADANIENSOL","JSWENERGY","NHPC","CGPOWER","MAXHEALTH","FORTIS","SHREECEM","JKCEMENT","SUNDRMFAST","SONACOMS",
    "KEI","SUPREMEIND","HONAUT",
  ];
  // Filter through the predicate so we never serve a name that the chain
  // backend would reject.
  res.json({
    indices: FNO_INDICES.filter(s => isFnoUnderlying(s)),
    stocks: stocks.filter(s => isFnoUnderlying(s)).sort((a, b) => a.localeCompare(b)),
  });
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

export default router;
