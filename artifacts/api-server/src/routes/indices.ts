/**
 * Indices Board endpoint — backs the dedicated "Indices" tab.
 *
 * GET /api/indices → IndicesBoardSnapshot
 *
 * Returns one row per instrument (Indian indices, global benchmarks,
 * commodities) with the full fact pack defined in indicesBoard.ts. The
 * library handles caching (10s) and partial-data semantics; this route
 * just unwraps and serialises.
 */

import { Router, type IRouter } from "express";
import { getIndicesBoard } from "../lib/indicesBoard";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/indices", async (_req, res): Promise<void> => {
  try {
    const snap = await getIndicesBoard();
    res.json(snap);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "GET /api/indices failed");
    res.status(500).json({ error: "Indices board unavailable", detail: (err as Error).message });
  }
});

export default router;
