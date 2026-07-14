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
import { logger } from "../lib/logger";
import { randomUUID } from "node:crypto";
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

// ───────────── Guarded full backfill (PART 0 — async job) ─────────────
//
// POST /api/candle-warehouse/backfill        — owner-only; kicks off ONE
//                                              detached background job and
//                                              returns 202 + jobId.
// GET  /api/candle-warehouse/backfill/status — owner-only; in-memory
//                                              progress (per-universe
//                                              attempted/ok/rowsWritten/
//                                              errors). Persistent evidence
//                                              also lands in candle_sync_run.
//
// Deterministic order: indices(day) → NIFTY-500(day) → F&O-stocks(day) →
// indices(15m) → F&O-stocks(15m). swing-500 15m is intentionally excluded
// (too heavy for a single manual run). Writes are the EXISTING additive
// upserts via syncCandles({ ignoreSymbolCap:true, kind:"BACKFILL" }); this
// endpoint adds NO ingest logic and feeds NO user-facing feature (warehouse
// stays write-side only this stage). A single in-flight guard prevents
// accidental resource exhaustion. Long-running (minutes), hence detached +
// status-poll rather than a blocking request.

interface BackfillStepResult {
  universe: CandleUniverse;
  interval: CandleInterval;
  attempted: number;
  ok: number;
  rowsWritten: number;
  errors: number;
  errorSample: Array<{ symbol: string; message: string }>;
}

interface BackfillJob {
  jobId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  totalSteps: number;
  completedSteps: number;
  current: { universe: CandleUniverse; interval: CandleInterval } | null;
  steps: BackfillStepResult[];
  error: string | null;
}

let backfillJob: BackfillJob | null = null;

const DAY_UNIVERSE_ORDER: CandleUniverse[] = ["indices", "swing-500", "fno-stocks"];
// swing-500 15-minute intentionally excluded — 500 symbols of intraday is
// far too heavy for a single manual backfill.
const M15_UNIVERSE_ORDER: CandleUniverse[] = ["indices", "fno-stocks"];

function buildBackfillSteps(
  universesFilter: Set<CandleUniverse> | null,
  intervalsFilter: Set<CandleInterval> | null,
): Array<{ universe: CandleUniverse; interval: CandleInterval }> {
  const steps: Array<{ universe: CandleUniverse; interval: CandleInterval }> = [];
  const wantInterval = (i: CandleInterval): boolean => !intervalsFilter || intervalsFilter.has(i);
  const wantUniverse = (u: CandleUniverse): boolean => !universesFilter || universesFilter.has(u);
  if (wantInterval("day")) {
    for (const u of DAY_UNIVERSE_ORDER) if (wantUniverse(u)) steps.push({ universe: u, interval: "day" });
  }
  if (wantInterval("15minute")) {
    for (const u of M15_UNIVERSE_ORDER) if (wantUniverse(u)) steps.push({ universe: u, interval: "15minute" });
  }
  return steps;
}

function csvToSet<T extends string>(raw: string, allowed: Set<T>): Set<T> | null {
  const valid = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => allowed.has(s as T));
  return valid.length ? new Set(valid) : null;
}

async function runBackfillJob(
  job: BackfillJob,
  steps: Array<{ universe: CandleUniverse; interval: CandleInterval }>,
): Promise<void> {
  try {
    for (const step of steps) {
      job.current = step;
      try {
        const r = await syncCandles({
          interval: step.interval,
          universe: step.universe,
          kind: "BACKFILL",
          ignoreSymbolCap: true,
        });
        job.steps.push({
          universe: step.universe,
          interval: step.interval,
          attempted: r.symbolsAttempted,
          ok: r.symbolsOk,
          rowsWritten: r.rowsWritten,
          errors: r.errors.length,
          errorSample: r.errors.slice(0, 5),
        });
      } catch (err) {
        // syncCandles already swallows per-symbol errors; this only fires on
        // an unexpected throw. Record it as a failed step and keep going.
        job.steps.push({
          universe: step.universe,
          interval: step.interval,
          attempted: 0,
          ok: 0,
          rowsWritten: 0,
          errors: 1,
          errorSample: [{ symbol: "*", message: (err as Error).message }],
        });
      }
      job.completedSteps += 1;
    }
    job.status = "completed";
  } catch (err) {
    job.status = "failed";
    job.error = (err as Error).message;
  } finally {
    job.current = null;
    job.finishedAt = new Date().toISOString();
    logger.info(
      { jobId: job.jobId, status: job.status, completedSteps: job.completedSteps },
      "candle-warehouse: backfill job finished",
    );
  }
}

router.post("/candle-warehouse/backfill", strictOwner, (req, res) => {
  if (backfillJob && backfillJob.status === "running") {
    res.status(409).json({ ok: false, error: "already_running", job: backfillJob });
    return;
  }
  const universesFilter = csvToSet(String(req.query["universes"] ?? ""), ALLOWED_UNIVERSES);
  const intervalsFilter = csvToSet(String(req.query["intervals"] ?? ""), ALLOWED_INTERVALS);
  const steps = buildBackfillSteps(universesFilter, intervalsFilter);
  if (steps.length === 0) {
    res.status(400).json({
      ok: false,
      error: "no_steps",
      hint: "universes∈{indices,fno-stocks,swing-500}, intervals∈{day,15minute}",
    });
    return;
  }
  const job: BackfillJob = {
    jobId: randomUUID(),
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalSteps: steps.length,
    completedSteps: 0,
    current: null,
    steps: [],
    error: null,
  };
  backfillJob = job;
  logger.info({ jobId: job.jobId, totalSteps: steps.length }, "candle-warehouse: backfill job started");
  // Detached on purpose (multi-minute). Progress + errors land on the job
  // object and are observable via the status endpoint.
  void runBackfillJob(job, steps);
  res.status(202).json({ ok: true, jobId: job.jobId, status: job.status, totalSteps: job.totalSteps });
});

router.get("/candle-warehouse/backfill/status", strictOwner, (_req, res) => {
  res.json({ ok: true, job: backfillJob });
});

export default router;
