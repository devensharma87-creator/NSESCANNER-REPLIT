/**
 * Owner-only diagnostics + manual sync trigger for the candle
 * warehouse (Priority 4 — write-only data infrastructure).
 *
 *   GET  /api/candles/diagnostics            — coverage report
 *   POST /api/candles/sync                   — trigger one cycle
 *
 * Strict owner gate: does NOT inherit `requireOwner`'s public-mode
 * read bypass. Both endpoints touch only the two new tables.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getSession } from "../lib/userAuth";
import { isPublicAccessEnabled } from "../lib/publicAccess";
import {
  isCandleWarehouseEnabled,
  getEnabledUniverses,
  getWarehouseConfig,
  syncCandles,
  getRecentResults,
  type CandleInterval,
  type CandleUniverse,
  type SyncKind,
} from "../lib/candleWarehouseIngestor";

const router: IRouter = Router();

function strictOwner(req: Request, res: Response, next: NextFunction): void {
  const s = getSession(req);
  if (s?.role === "owner") return next();
  if (isPublicAccessEnabled()) {
    res.status(403).json({ error: "owner_only", code: "OWNER_ONLY_DIAGNOSTIC" });
    return;
  }
  res.status(401).json({ error: "unauthorized", code: "AUTH_REQUIRED" });
}

const ALLOWED_INTERVALS = new Set<CandleInterval>(["day", "15minute"]);
const ALLOWED_UNIVERSES = new Set<CandleUniverse>(["indices", "fno-stocks", "swing-500"]);
const ALLOWED_KINDS = new Set<SyncKind>(["BACKFILL", "INCREMENTAL"]);

router.get("/candles/diagnostics", strictOwner, async (_req, res, next) => {
  try {
    const cfg = getWarehouseConfig();

    // Coverage by interval — total rows + distinct symbols per interval.
    const byInterval = (await db.execute(sql`
      SELECT
        interval,
        COUNT(*)::int                       AS rows,
        COUNT(DISTINCT symbol)::int         AS distinct_symbols,
        MIN(ts)                             AS earliest_ts,
        MAX(ts)                             AS latest_ts
      FROM candle
      GROUP BY interval
      ORDER BY interval;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    // Per-symbol latest snapshot (top 100 most-stale to surface drift).
    const perSymbol = (await db.execute(sql`
      SELECT symbol, exchange, interval,
             MAX(ts) AS latest_ts,
             COUNT(*)::int AS rows
      FROM candle
      GROUP BY symbol, exchange, interval
      ORDER BY MAX(ts) ASC NULLS FIRST
      LIMIT 100;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    // Recent runs.
    const recentRuns = (await db.execute(sql`
      SELECT id, started_at, finished_at, duration_ms, kind, interval, universe,
             symbols_attempted, symbols_ok, rows_written, errors
      FROM candle_sync_run
      ORDER BY started_at DESC
      LIMIT 20;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    res.json({
      generatedAt: new Date().toISOString(),
      config: {
        enabled: isCandleWarehouseEnabled(),
        universes: getEnabledUniverses(),
        intervals: ["day", "15minute"],
        ...cfg,
      },
      byInterval: byInterval.rows,
      perSymbolStaleTop100: perSymbol.rows,
      recentRuns: recentRuns.rows,
      lastResultsInMemory: getRecentResults(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Trigger a sync. Owner-only. Will write to the warehouse tables.
 *
 * Query params:
 *   - interval=day|15minute (required)
 *   - universe=indices|fno-stocks|swing-500 (required)
 *   - kind=BACKFILL|INCREMENTAL (optional — auto-detect when absent)
 *   - ignoreCap=1 (optional — bypass the per-cycle symbol cap; manual
 *                  backfills only)
 */
router.post("/candles/sync", strictOwner, async (req, res, next) => {
  try {
    const interval = String(req.query["interval"] ?? "") as CandleInterval;
    const universe = String(req.query["universe"] ?? "") as CandleUniverse;
    const kindRaw = String(req.query["kind"] ?? "").toUpperCase() as SyncKind;
    const ignoreCap = String(req.query["ignoreCap"] ?? "") === "1";

    if (!ALLOWED_INTERVALS.has(interval)) {
      res.status(400).json({ error: "bad_interval", allowed: [...ALLOWED_INTERVALS] });
      return;
    }
    if (!ALLOWED_UNIVERSES.has(universe)) {
      res.status(400).json({ error: "bad_universe", allowed: [...ALLOWED_UNIVERSES] });
      return;
    }
    const kind: SyncKind | undefined = kindRaw && ALLOWED_KINDS.has(kindRaw) ? kindRaw : undefined;

    const r = await syncCandles({ interval, universe, kind, ignoreSymbolCap: ignoreCap });
    res.json({
      ok: true,
      result: {
        ...r,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
