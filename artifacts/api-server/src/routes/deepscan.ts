import { Router, type IRouter } from "express";
import { searchUniverse, getDeepSnapshot, type LookupKind, type Range, RANGES_FOR_DEEPSCAN } from "../lib/deepscan";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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
    const snap = await getDeepSnapshot(symbol, range, kind);
    if (!snap) {
      res.status(404).json({ error: "No data available for this symbol" });
      return;
    }
    res.json(snap);
  } catch (err) {
    logger.error({ err: (err as Error).message, symbol }, "Deep snapshot handler crashed");
    res.status(500).json({ error: "Internal error fetching snapshot" });
  }
});

export default router;
