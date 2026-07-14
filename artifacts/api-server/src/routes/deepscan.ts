import { Router, type IRouter } from "express";
import { searchUniverse, getDeepSnapshot, type LookupKind, type Range, RANGES_FOR_DEEPSCAN } from "../lib/deepscan";
import { requireSubscriberOrOwner } from "../lib/userAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Deep Scan is gated by the DEEP_SCAN tab — owner always allowed, plus any
// active subscriber whom the owner has granted that tab via /admin/users.
// Path-scoped to /deepscan/* — without the prefix this would intercept every
// request flowing through the parent router (express runs sub-router
// middleware for all paths until the request is handled).
router.use("/deepscan", requireSubscriberOrOwner("DEEP_SCAN"));

router.get("/deepscan/lookup", (req, res) => {
  const q = String(req.query["q"] ?? "").trim();
  if (!q) { res.json({ items: [] }); return; }
  res.json({ items: searchUniverse(q) });
});

router.get("/deepscan/snapshot/:symbol", async (req, res) => {
  const symbol = String(req.params["symbol"] ?? "").trim();
  if (!symbol) { res.status(400).json({ error: "symbol required" }); return; }
  const rangeRaw = String(req.query["range"] ?? "6mo");
  const range: Range = (RANGES_FOR_DEEPSCAN as readonly string[]).includes(rangeRaw)
    ? (rangeRaw as Range)
    : "6mo";
  const kindRaw = req.query["kind"];
  const kind: LookupKind | undefined =
    kindRaw === "stock" || kindRaw === "index" ? kindRaw : undefined;

  try {
    // Yahoo's free chart API rate-limits us under load. One quick retry with
    // a short backoff turns a transient "No data available for NIFTY" error
    // (which the user just hit on a fresh server boot) into a clean 200.
    let snap = await getDeepSnapshot(symbol, range, kind);
    if (!snap) {
      await new Promise(r => setTimeout(r, 600));
      snap = await getDeepSnapshot(symbol, range, kind);
    }
    if (!snap) {
      res.status(404).json({
        error: `No data available for ${symbol}. The chart provider rate-limited the request — please retry in a few seconds.`,
      });
      return;
    }
    res.json(snap);
  } catch (err) {
    logger.error({ err: (err as Error).message, symbol }, "Deep snapshot handler crashed");
    res.status(500).json({ error: "Internal error fetching snapshot" });
  }
});

export default router;
