/**
 * Owner-only diagnostics for the option-chain snapshot ingestor
 * (Priority 3 — write-only data infrastructure).
 *
 *   GET  /api/option-snapshots/diagnostics  — full status report
 *   POST /api/option-snapshots/run-now      — trigger one ingestion cycle
 *
 * Strict owner-gating: does NOT inherit `requireOwner`'s public-mode
 * read bypass. Diagnostics expose internal coverage state and a manual
 * trigger; both must remain owner-only regardless of public-access mode.
 *
 * No write to anything except the two snapshot tables (via
 * `runIngestionTick`). Does not touch any trading-decision code.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getSession } from "../lib/userAuth";
import { isPublicAccessEnabled } from "../lib/publicAccess";
import {
  SNAPSHOT_INDICES,
  getSnapshotConfig,
  isOptionSnapshotEnabled,
  runIngestionTick,
  getLastRun,
} from "../lib/optionChainSnapshotIngestor";
import { computeMarketStatus } from "../lib/marketEvents";

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

router.get("/option-snapshots/diagnostics", strictOwner, async (_req, res, next) => {
  try {
    const cfg = getSnapshotConfig();
    const enabled = isOptionSnapshotEnabled();
    const marketStatus = computeMarketStatus(new Date());

    // Per-underlying coverage: latest snapshot, distinct expiries, distinct
    // strikes, rows today (IST day = UTC + 5:30; we use IST day boundary).
    const istNowMs = Date.now() + 5.5 * 60 * 60_000;
    const istDayStart = new Date(Math.floor(istNowMs / 86_400_000) * 86_400_000 - 5.5 * 60 * 60_000);

    const perUnderlying = (await db.execute(sql`
      SELECT
        underlying,
        COUNT(*)::int                                AS total_rows,
        COUNT(DISTINCT expiry)::int                  AS distinct_expiries,
        COUNT(DISTINCT strike)::int                  AS distinct_strikes,
        MAX(captured_at)                             AS latest_snapshot,
        COUNT(*) FILTER (WHERE captured_at >= ${istDayStart.toISOString()})::int AS rows_today,
        MAX(source)                                  AS source
      FROM option_chain_snapshot
      WHERE underlying = ANY(ARRAY[${sql.join(SNAPSHOT_INDICES.map((u) => sql`${u}`), sql`, `)}])
      GROUP BY underlying
      ORDER BY underlying;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    // Recent runs (last 10) for "what just happened?" panel.
    const recentRuns = (await db.execute(sql`
      SELECT id, started_at, finished_at, duration_ms, underlyings_attempted,
             underlyings_ok, expiries_covered, rows_written, source, errors
      FROM option_chain_snapshot_run
      ORDER BY started_at DESC
      LIMIT 10;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    // Today's totals across all underlyings. Two distinct counts:
    //   `rows_today`           — physical rows currently in the snapshot
    //                             table for the current IST day (post-
    //                             upsert, so it's a logical "coverage"
    //                             count, not an insert count).
    //   `rows_written_today`   — sum of `rows_written` across today's
    //                             ingestion cycles. Includes re-upserts
    //                             of the same PK and so is always >=
    //                             `rows_today`. Useful for spotting
    //                             cycles that wrote zero (broker issue).
    const totalsToday = (await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM option_chain_snapshot
         WHERE captured_at >= ${istDayStart.toISOString()}) AS rows_today,
        (SELECT COALESCE(SUM(rows_written), 0)::int FROM option_chain_snapshot_run
         WHERE started_at  >= ${istDayStart.toISOString()}) AS rows_written_today;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    res.json({
      generatedAt: new Date().toISOString(),
      config: {
        enabled,
        marketStatus,
        universe: [...SNAPSHOT_INDICES],
        intervalMinutes: cfg.intervalMinutes,
        strikeWindow: cfg.strikeWindow,
        expiriesPerUnderlying: cfg.expiriesPerUnderlying,
        retentionDays: cfg.retentionDays,
      },
      coverage: perUnderlying.rows,
      todayRowsTotal: totalsToday.rows[0]?.["rows_today"] ?? 0,
      todayRowsWritten: totalsToday.rows[0]?.["rows_written_today"] ?? 0,
      lastRunInMemory: getLastRun(),
      recentRuns: recentRuns.rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Manually trigger one ingestion cycle. Use `?force=1` to bypass the
 * market-hours guard (e.g. for one-off backfill testing). Owner-only.
 * Will write to the snapshot tables — do not call from automation.
 */
router.post("/option-snapshots/run-now", strictOwner, async (req, res, next) => {
  try {
    const force = String(req.query["force"] ?? "") === "1";
    const r = await runIngestionTick({ force });
    res.json({
      ok: true,
      forced: force,
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
