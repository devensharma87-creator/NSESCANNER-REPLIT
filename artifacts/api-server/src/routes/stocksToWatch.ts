import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, swingScanResultTable } from "@workspace/db";
import { getStocksToWatch } from "../lib/stocksToWatch";
import { getLatestSwingScan, getSchedulerState } from "../lib/swingScannerStore";
import { computeSectorCoverage, UNMAPPED_SECTOR } from "../lib/sectorMap";
import { getSession, requireOwner } from "../lib/userAuth";
import { isPublicAccessEnabled } from "../lib/publicAccess";

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

/**
 * GET /api/stocks-to-watch/diagnostics/sector-coverage
 *
 * Owner-only operational diagnostic. Reports how well the sector /
 * industry lookup table (UNIVERSE → curated EXTENSION → "Unmapped"
 * fallback) covers the symbols currently present in `swing_scan_result`.
 *
 * Reports two views:
 *   - **lookup**: deterministic from the in-memory `lookupSector` —
 *     answers "what would a fresh scan map?".
 *   - **db**: actual rows currently stored — answers "what's persisted
 *     right now?". Useful before/after backfill runs.
 *
 * Touches no trading logic. Read-only.
 */
router.get(
  "/stocks-to-watch/diagnostics/sector-coverage",
  // Strict owner-only: do NOT inherit `requireOwner`'s public-mode read
  // bypass. Diagnostics list internal symbol-mapping state and are owner-
  // only regardless of public-access mode.
  (req, res, next) => {
    const s = getSession(req);
    if (s?.role === "owner") return next();
    if (isPublicAccessEnabled()) {
      res.status(403).json({ error: "owner_only", code: "OWNER_ONLY_DIAGNOSTIC" });
      return;
    }
    res.status(401).json({ error: "unauthorized", code: "AUTH_REQUIRED" });
  },
  async (_req, res, next) => {
    try {
      const distinctRows = (await db
        .select({ symbol: swingScanResultTable.symbol })
        .from(swingScanResultTable)
        .groupBy(swingScanResultTable.symbol)) as Array<{ symbol: string }>;
      const distinctSymbols = distinctRows.map((r) => r.symbol);

      const lookupCoverage = computeSectorCoverage(distinctSymbols);

      const dbAgg = (await db.execute(sql`
        SELECT
          COUNT(*)::int                                                     AS total_rows,
          COUNT(*) FILTER (WHERE sector IS NOT NULL AND sector <> '')::int  AS rows_with_sector,
          COUNT(*) FILTER (WHERE industry IS NOT NULL AND industry <> '')::int AS rows_with_industry,
          COUNT(*) FILTER (WHERE sector = ${UNMAPPED_SECTOR})::int          AS rows_unmapped,
          COUNT(*) FILTER (WHERE sector IS NULL OR sector = '')::int        AS rows_null_sector
        FROM swing_scan_result;
      `)) as unknown as { rows: Array<Record<string, number>> };

      const dbCounts = dbAgg.rows[0] ?? {
        total_rows: 0,
        rows_with_sector: 0,
        rows_with_industry: 0,
        rows_unmapped: 0,
        rows_null_sector: 0,
      };

      res.json({
        generatedAt: new Date().toISOString(),
        lookup: {
          totalDistinctSymbols: lookupCoverage.total,
          mappedFromUniverse: lookupCoverage.bySource.universe,
          mappedFromExtension: lookupCoverage.bySource.extension,
          unmapped: lookupCoverage.bySource.unknown,
          sectorCoveragePct: lookupCoverage.sectorCoveragePct,
          industryCoveragePct: lookupCoverage.industryCoveragePct,
          unmappedSymbols: lookupCoverage.unmapped,
        },
        db: {
          totalRows: dbCounts["total_rows"],
          rowsWithSector: dbCounts["rows_with_sector"],
          rowsWithIndustry: dbCounts["rows_with_industry"],
          rowsMarkedUnmapped: dbCounts["rows_unmapped"],
          rowsNullSector: dbCounts["rows_null_sector"],
          sectorCoveragePct:
            dbCounts["total_rows"] === 0
              ? 0
              : Math.round(
                  ((dbCounts["rows_with_sector"] ?? 0) / (dbCounts["total_rows"] ?? 1)) * 1000,
                ) / 10,
          industryCoveragePct:
            dbCounts["total_rows"] === 0
              ? 0
              : Math.round(
                  ((dbCounts["rows_with_industry"] ?? 0) / (dbCounts["total_rows"] ?? 1)) * 1000,
                ) / 10,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
