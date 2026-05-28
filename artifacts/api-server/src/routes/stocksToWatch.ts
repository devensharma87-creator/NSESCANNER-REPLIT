import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, swingScanResultTable } from "@workspace/db";
import { getStocksToWatch } from "../lib/stocksToWatch";
import { getLatestSwingScan, getSchedulerState, getIntradayRefreshHealth, getSwingBenchmarkHealth, getLatestSwingScanSectorRows } from "../lib/swingScannerStore";
import { computeSectorCoverage, UNMAPPED_SECTOR } from "../lib/sectorMap";
import { computeSectorStrength } from "../lib/sectorStrength";
import {
  buildShadowDiagnostic,
  isSwingShadowDiagEnabled,
  memoKey as shadowMemoKey,
  getMemoizedPayload as getShadowMemo,
  setMemoizedPayload as setShadowMemo,
  type ShadowDiagnosticInputRow,
} from "../lib/swingShadowDiagnostic";
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

/**
 * GET /api/stocks-to-watch/diagnostics/swing-shadow-score
 *
 * H10b (2026-05-28) — owner-only READ-ONLY shadow-scoring diagnostic.
 *
 * Computes B1 (live − fundamental, clamped) and B3 (B1 − overextension /
 * RS-weak penalties, clamped) for every row of the LATEST persisted
 * `swing_scan_result` cohort, alongside a warning-prose verifier. Returns
 * per-row deltas, top lists, promotion / demotion buckets, score-delta
 * distributions, and a data-quality histogram (all lists capped at 25 rows).
 *
 * Feature-flag gated by `SWING_SHADOW_DIAG_ENABLED` (default ENABLED).
 * Disabled state returns 200 with `featureFlagEnabled: false` and no
 * computation — gives the owner a way to confirm the flag is off without
 * confusing 404s.
 *
 * STRICT READ-ONLY contract. Does NOT:
 *   - mutate the row's persisted `score` or `action`,
 *   - trigger a deep scan,
 *   - trigger intraday refresh,
 *   - call Kite or Yahoo or fetch outcomes,
 *   - mutate DB,
 *   - enqueue scheduler work,
 *   - touch the paper-equity or F&O paths.
 *
 * 5-minute in-process memoization keyed by (scan_date, row count).
 *
 * Same strict owner-only gate as the peer `/sector-coverage`,
 * `/intraday-refresh`, `/swing-benchmark`, `/sector-strength` diagnostics.
 */
router.get(
  "/stocks-to-watch/diagnostics/swing-shadow-score",
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
      // Feature flag — safe disabled response.
      if (!isSwingShadowDiagEnabled()) {
        res.json({
          generatedAt: new Date().toISOString(),
          featureFlagEnabled: false,
          flagEnvVar: "SWING_SHADOW_DIAG_ENABLED",
          message:
            "Diagnostic disabled. Set SWING_SHADOW_DIAG_ENABLED=1 (or remove the env var) to enable.",
        });
        return;
      }

      // Resolve latest scan_date.
      const latestRes = (await db.execute(sql`
        SELECT MAX(scan_date)::text AS latest FROM swing_scan_result;
      `)) as unknown as { rows: Array<{ latest: string | null }> };
      const scanDate = latestRes.rows[0]?.latest ?? null;

      if (scanDate == null) {
        res.json({
          generatedAt: new Date().toISOString(),
          featureFlagEnabled: true,
          scanDate: null,
          totalRows: 0,
          listCap: 25,
          highScoreThreshold: 60,
          message: "No rows in swing_scan_result yet.",
        });
        return;
      }

      // Load only the latest cohort, only the columns the diagnostic uses.
      const rowsRes = (await db.execute(sql`
        SELECT
          symbol,
          scan_date::text         AS scan_date,
          score,
          action,
          sector,
          industry,
          fundamental_score,
          rsi14,
          pct_from_52w_high,
          warnings
        FROM swing_scan_result
        WHERE scan_date = ${scanDate}::date;
      `)) as unknown as {
        rows: Array<{
          symbol: string;
          scan_date: string;
          score: number | string | null;
          action: string | null;
          sector: string | null;
          industry: string | null;
          fundamental_score: number | string | null;
          rsi14: number | string | null;
          pct_from_52w_high: number | string | null;
          warnings: unknown;
        }>;
      };

      const rows: ShadowDiagnosticInputRow[] = rowsRes.rows.map((r) => ({
        symbol: r.symbol,
        scanDate: r.scan_date,
        score: r.score,
        action: r.action,
        sector: r.sector,
        industry: r.industry,
        fundamentalScore: r.fundamental_score,
        rsi14: r.rsi14,
        pctFrom52wHigh: r.pct_from_52w_high,
        warnings: Array.isArray(r.warnings) ? (r.warnings as unknown[]) : null,
      }));

      // 5-minute in-process memo (scan_date + row count).
      const now = Date.now();
      const key = shadowMemoKey(scanDate, rows.length);
      const cached = getShadowMemo(now, key);
      if (cached != null) {
        res.json({ ...cached, cached: true });
        return;
      }

      const payload = buildShadowDiagnostic({
        generatedAt: new Date().toISOString(),
        scanDate,
        rows,
      });
      setShadowMemo(now, key, payload);
      res.json({ ...payload, cached: false });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/stocks-to-watch/diagnostics/intraday-refresh
 *
 * Owner-only operational diagnostic. Exposes the process-local health
 * snapshot for the NIFTY-500 swing-scanner intraday refresh loop
 * (`runIntradayRefresh` in `swingScannerStore.ts`). Used to confirm
 * that the 15-min market-hours refresh cycle is firing, populating
 * `intraday_last` / `intraday_change_pct` / `intraday_updated_at` /
 * `trigger_hit` on the latest `swing_scan_result` rows.
 *
 * READ-ONLY. Returns `getIntradayRefreshHealth()` verbatim. Does NOT
 * trigger a refresh, call Kite, query or mutate the DB, or enqueue
 * any scheduler work. Same strict owner-only gate as the peer
 * `/sector-coverage` diagnostic.
 */
router.get(
  "/stocks-to-watch/diagnostics/intraday-refresh",
  // Strict owner-only: do NOT inherit `requireOwner`'s public-mode read
  // bypass. Diagnostics list internal refresh-loop state and are owner-
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
  (_req, res) => {
    res.json(getIntradayRefreshHealth());
  },
);

/**
 * GET /api/stocks-to-watch/diagnostics/swing-benchmark
 *
 * S3a (2026-05-28) — owner-only operational diagnostic. Exposes the
 * process-local health snapshot for the NIFTY 50 swing benchmark
 * loader (`fetchBenchmarkBarsResilient` in `swingScannerData.ts`).
 *
 * Reports the last benchmark fetch's source (`yahoo` / `yahoo_retry` /
 * `kite` / `none`), bar count, first/last date, per-source errors,
 * duration, and whether RS was enabled. Used to confirm that the
 * resilient fallback chain is firing and to pinpoint which source
 * actually fed the latest deep-scan's RS calculation.
 *
 * READ-ONLY. Returns `getSwingBenchmarkHealth()` verbatim. Does NOT
 * trigger a deep scan, call Yahoo/Kite, query or mutate the DB, or
 * enqueue any scheduler work. Same strict owner-only gate as the peer
 * `/intraday-refresh` and `/sector-coverage` diagnostics.
 */
router.get(
  "/stocks-to-watch/diagnostics/swing-benchmark",
  // Strict owner-only: do NOT inherit `requireOwner`'s public-mode read
  // bypass. Diagnostics list internal benchmark-loader state and are
  // owner-only regardless of public-access mode.
  (req, res, next) => {
    const s = getSession(req);
    if (s?.role === "owner") return next();
    if (isPublicAccessEnabled()) {
      res.status(403).json({ error: "owner_only", code: "OWNER_ONLY_DIAGNOSTIC" });
      return;
    }
    res.status(401).json({ error: "unauthorized", code: "AUTH_REQUIRED" });
  },
  (_req, res) => {
    res.json(getSwingBenchmarkHealth());
  },
);

/**
 * GET /api/stocks-to-watch/diagnostics/sector-strength
 *
 * S4b (2026-05-28) — owner-only READ-ONLY sector-strength diagnostic.
 * Aggregates the latest `swing_scan_result` cohort by sector and
 * reports member count, average score / RS-score / rs20 / rs50 / rs120,
 * action histogram, top-N by score/rsScore, and a 1-based rank
 * (confident sectors only, memberCount ≥ SECTOR_STRENGTH_MIN_MEMBERS).
 *
 * READ-ONLY contract. Does NOT:
 *   - trigger deep scan,
 *   - trigger intraday refresh,
 *   - call Kite or Yahoo,
 *   - mutate DB,
 *   - enqueue scheduler work,
 *   - influence score / action / quality_grade / setup / entry /
 *     stop_loss / target1 / target2 / rr_to_t1 / trigger_hit /
 *     paper-equity execution.
 *
 * EMA-breadth / 20-day-high-breadth metrics are NOT computed —
 * `swing_scan_result` does not persist the underlying signals and
 * adding columns is out of S4b scope. The response lists these under
 * `unavailableMetrics` so the owner sees why they are absent.
 *
 * Same strict owner-only gate as the peer `/sector-coverage`,
 * `/intraday-refresh`, and `/swing-benchmark` diagnostics.
 */
router.get(
  "/stocks-to-watch/diagnostics/sector-strength",
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
      const { scanDate, rows } = await getLatestSwingScanSectorRows();
      const summary = computeSectorStrength(rows, { scanDate });
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
