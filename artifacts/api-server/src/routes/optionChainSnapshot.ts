/**
 * Owner-only diagnostics for the option-chain snapshot ingestor
 * (Priority 3 — write-only data infrastructure).
 *
 *   GET  /api/option-snapshots/diagnostics  — full status report
 *   POST /api/option-snapshots/run-now      — trigger one ingestion cycle
 *   GET  /api/option-snapshots/analytics    — pure-read analytics
 *   GET  /api/option-snapshots/storage      — storage projections (no DB)
 *   GET  /api/option-snapshots/gaps         — gap / completeness analysis
 *
 * Strict owner-gating: does NOT inherit `requireOwner`'s public-mode
 * read bypass. Diagnostics expose internal coverage state and a manual
 * trigger; both must remain owner-only regardless of public-access mode.
 *
 * NO SIGNAL OR PAPER-TRADING IMPACT: this router is a pure read/diagnostic
 * surface over the option_chain_snapshot tables. It has no connection to
 * F&O signals, swing signals, paper trading, scoring, Kite order placement,
 * or broker integrations. The only operational writes are to the two
 * option_chain_snapshot tables via runIngestionTick (run-now endpoint only).
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
  getCircuitState,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_RESET_MINUTES,
  ALERT_COOLDOWN_MINUTES,
  TICK_TIMEOUT_MS,
} from "../lib/optionChainSnapshotIngestor";
import { computeMarketStatus } from "../lib/marketEvents";
import {
  computeAnalytics,
  computeStaleness,
  DEFAULT_STALE_THRESHOLD_MINUTES,
  type AnalyticsRowInput,
} from "../lib/optionSnapshotAnalytics";
import {
  projectStorage,
  getArchivePath,
  getArchiveInfrastructureRequirement,
  readArchiveManifests,
  ESTIMATED_BYTES_PER_ROW_TOTAL,
  ROWS_PER_TICK_CONSERVATIVE,
  ROWS_PER_TICK_WORST_CASE,
  TICKS_PER_DAY,
} from "../lib/optionSnapshotArchive";

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

// ─── Diagnostics ──────────────────────────────────────────────────────────────

router.get("/option-snapshots/diagnostics", strictOwner, async (_req, res, next) => {
  try {
    const cfg = getSnapshotConfig();
    const enabled = isOptionSnapshotEnabled();
    const marketStatus = computeMarketStatus(new Date());
    const circuit = getCircuitState();
    const archiveConfigured = getArchivePath() != null;

    // IST day boundary.
    const istNowMs = Date.now() + 5.5 * 60 * 60_000;
    const istDayStart = new Date(
      Math.floor(istNowMs / 86_400_000) * 86_400_000 - 5.5 * 60 * 60_000,
    );

    const perUnderlying = (await db.execute(sql`
      SELECT
        underlying,
        COUNT(*)::int                                AS total_rows,
        COUNT(DISTINCT expiry)::int                  AS distinct_expiries,
        COUNT(DISTINCT strike)::int                  AS distinct_strikes,
        MAX(captured_at)                             AS latest_snapshot,
        MIN(captured_at)                             AS earliest_snapshot,
        COUNT(*) FILTER (WHERE captured_at >= ${istDayStart.toISOString()})::int AS rows_today,
        COUNT(DISTINCT captured_at) FILTER (WHERE captured_at >= ${istDayStart.toISOString()})::int AS ticks_today,
        MAX(source)                                  AS source
      FROM option_chain_snapshot
      WHERE underlying = ANY(ARRAY[${sql.join(SNAPSHOT_INDICES.map((u) => sql`${u}`), sql`, `)}])
      GROUP BY underlying
      ORDER BY underlying;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    const recentRuns = (await db.execute(sql`
      SELECT id, started_at, finished_at, duration_ms, underlyings_attempted,
             underlyings_ok, expiries_covered, rows_written, source, errors
      FROM option_chain_snapshot_run
      ORDER BY started_at DESC
      LIMIT 10;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    const totalsToday = (await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM option_chain_snapshot
         WHERE captured_at >= ${istDayStart.toISOString()}) AS rows_today,
        (SELECT COALESCE(SUM(rows_written), 0)::int FROM option_chain_snapshot_run
         WHERE started_at  >= ${istDayStart.toISOString()}) AS rows_written_today,
        (SELECT COUNT(*)::int FROM option_chain_snapshot_run
         WHERE started_at  >= ${istDayStart.toISOString()}) AS run_count_today;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    // Null-field availability across all historical snapshots (per-field null rate).
    const nullAvailability = (await db.execute(sql`
      SELECT
        COUNT(*)::int                                         AS total,
        COUNT(*) FILTER (WHERE ltp IS NULL)::int             AS null_ltp,
        COUNT(*) FILTER (WHERE bid IS NULL)::int             AS null_bid,
        COUNT(*) FILTER (WHERE ask IS NULL)::int             AS null_ask,
        COUNT(*) FILTER (WHERE iv  IS NULL)::int             AS null_iv,
        COUNT(*) FILTER (WHERE delta IS NULL)::int           AS null_delta,
        COUNT(*) FILTER (WHERE oi IS NULL)::int              AS null_oi,
        COUNT(*) FILTER (WHERE lot_size IS NULL)::int        AS null_lot_size
      FROM option_chain_snapshot;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    // Research-readiness: requires ≥ 6 months of consecutive daily coverage
    // for the 3-fold walk-forward validation in the Pack 9 protocol.
    const coverageStats = (await db.execute(sql`
      SELECT
        EXTRACT(EPOCH FROM (MAX(captured_at) - MIN(captured_at))) / 86400 AS days_span,
        COUNT(DISTINCT DATE_TRUNC('day', captured_at AT TIME ZONE 'Asia/Kolkata'))::int AS distinct_ist_days,
        COUNT(DISTINCT underlying)::int AS underlyings
      FROM option_chain_snapshot
      WHERE underlying = ANY(ARRAY[${sql.join(SNAPSHOT_INDICES.map((u) => sql`${u}`), sql`, `)}]);
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    const stats = coverageStats.rows[0] ?? {};
    const distinctDays = Number(stats["distinct_ist_days"] ?? 0);
    const underlyings = Number(stats["underlyings"] ?? 0);
    const requiredDays = 130; // 6 months of trading days
    const researchReady = distinctDays >= requiredDays && underlyings >= 3;

    // Archive manifests.
    const archiveManifests = readArchiveManifests();

    res.json({
      generatedAt: new Date().toISOString(),
      // IMPORTANT SAFETY STATEMENT — required by Pack 9A Gate 8.
      noSignalOrPaperTradingImpact: true,
      config: {
        enabled,
        marketStatus,
        universe: [...SNAPSHOT_INDICES],
        intervalMinutes: cfg.intervalMinutes,
        strikeWindow: cfg.strikeWindow,
        expiriesPerUnderlying: cfg.expiriesPerUnderlying,
        retentionDays: cfg.retentionDays,
        archiveConfigured,
        archivePath: archiveConfigured ? "[SET]" : null,
        archiveRequirement: archiveConfigured ? null : getArchiveInfrastructureRequirement(),
      },
      reliability: {
        circuitBreaker: {
          ...circuit,
          threshold: CIRCUIT_BREAKER_THRESHOLD,
          resetMinutes: CIRCUIT_RESET_MINUTES,
        },
        alertCooldownMinutes: ALERT_COOLDOWN_MINUTES,
        tickTimeoutMs: TICK_TIMEOUT_MS,
      },
      coverage: perUnderlying.rows,
      todayRowsTotal: totalsToday.rows[0]?.["rows_today"] ?? 0,
      todayRowsWritten: totalsToday.rows[0]?.["rows_written_today"] ?? 0,
      todayRunCount: totalsToday.rows[0]?.["run_count_today"] ?? 0,
      expectedTicksToday: TICKS_PER_DAY,
      lastRunInMemory: getLastRun(),
      recentRuns: recentRuns.rows,
      nullAvailability: nullAvailability.rows[0] ?? {},
      researchReadiness: {
        ready: researchReady,
        distinctTradingDaysCovered: distinctDays,
        requiredTradingDays: requiredDays,
        underlyingsCovered: underlyings,
        requiredUnderlyings: 3,
        reason: researchReady
          ? "Data foundation sufficient for Pack 9 qualification"
          : `Insufficient data: ${distinctDays}/${requiredDays} days covered across ${underlyings}/3 indices. ` +
            `Activate capture and wait ~${Math.max(0, requiredDays - distinctDays)} more trading days.`,
        earliestQualificationDate: researchReady
          ? "NOW — data available"
          : `Approximately ${Math.ceil((requiredDays - distinctDays) / 5)} calendar weeks from today`,
      },
      archive: {
        configured: archiveConfigured,
        manifestCount: archiveManifests.length,
        manifests: archiveManifests.slice(0, 10), // cap for response size
        infrastructureRequirement: archiveConfigured ? null : getArchiveInfrastructureRequirement(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Storage Projections ─────────────────────────────────────────────────────

/**
 * Returns schema-derived storage projections without any DB calls.
 * Safe to call regardless of ingestor state.
 */
router.get("/option-snapshots/storage", strictOwner, (_req, res) => {
  const projections = projectStorage();
  const cfg = getSnapshotConfig();
  res.json({
    generatedAt: new Date().toISOString(),
    noSignalOrPaperTradingImpact: true,
    methodology: {
      estimatedBytesPerRowData: ESTIMATED_BYTES_PER_ROW_TOTAL - 150,
      estimatedBytesPerRowIndexOverhead: 150,
      estimatedBytesPerRowTotal: ESTIMATED_BYTES_PER_ROW_TOTAL,
      rowsPerTickConservative: ROWS_PER_TICK_CONSERVATIVE,
      rowsPerTickWorstCase: ROWS_PER_TICK_WORST_CASE,
      ticksPerDay: TICKS_PER_DAY,
      universeSize: SNAPSHOT_INDICES.length,
      strikesPerExpiry: cfg.strikeWindow * 2 + 1,
      expiriesPerIndex: cfg.expiriesPerUnderlying,
      sidesPerStrike: 2,
    },
    projections,
    archiveRecommendation:
      "For 24-month research archive (Pack 9 multi-regime qualification), " +
      "allocate 4–8 GB of durable storage and set OPTION_SNAPSHOT_ARCHIVE_PATH.",
  });
});

// ─── Gap Analysis ────────────────────────────────────────────────────────────

/**
 * Analyse gaps in snapshot coverage by examining captured_at density.
 * Owner-only. Read-only. No Kite/NSE calls.
 */
router.get("/option-snapshots/gaps", strictOwner, async (req, res, next) => {
  try {
    const lookbackDays = Math.min(30, Math.max(1, parseInt(String(req.query["days"] ?? "7"), 10) || 7));
    const cutoff = new Date(Date.now() - lookbackDays * 86_400_000);

    // Per-underlying gap analysis: expected ticks vs actual distinct ticks per IST day.
    const gaps = (await db.execute(sql`
      WITH days AS (
        SELECT
          underlying,
          DATE_TRUNC('day', captured_at AT TIME ZONE 'Asia/Kolkata') AS ist_day,
          COUNT(DISTINCT captured_at)::int                            AS ticks_captured,
          COUNT(*)::int                                               AS rows_captured
        FROM option_chain_snapshot
        WHERE captured_at >= ${cutoff.toISOString()}
          AND underlying = ANY(ARRAY[${sql.join(SNAPSHOT_INDICES.map((u) => sql`${u}`), sql`, `)}])
        GROUP BY underlying, ist_day
        ORDER BY underlying, ist_day
      )
      SELECT
        underlying,
        ist_day::text,
        ticks_captured,
        ${TICKS_PER_DAY}  AS ticks_expected,
        rows_captured,
        ROUND(100.0 * ticks_captured / ${TICKS_PER_DAY}, 1)::numeric AS coverage_pct
      FROM days
      ORDER BY underlying, ist_day;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    // Overall summary.
    const summary = (await db.execute(sql`
      SELECT
        underlying,
        COUNT(DISTINCT DATE_TRUNC('day', captured_at AT TIME ZONE 'Asia/Kolkata'))::int AS days_with_data,
        MIN(captured_at)::text AS earliest,
        MAX(captured_at)::text AS latest,
        COUNT(*)::int AS total_rows,
        COUNT(*) FILTER (WHERE ltp IS NULL)::int AS null_ltp_rows,
        COUNT(*) FILTER (WHERE bid IS NULL OR ask IS NULL)::int AS null_book_rows
      FROM option_chain_snapshot
      WHERE captured_at >= ${cutoff.toISOString()}
        AND underlying = ANY(ARRAY[${sql.join(SNAPSHOT_INDICES.map((u) => sql`${u}`), sql`, `)}])
      GROUP BY underlying
      ORDER BY underlying;
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    const futureTsRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS future_count
      FROM option_chain_snapshot
      WHERE captured_at > NOW() + INTERVAL '5 seconds';
    `)) as unknown as { rows: Array<{ future_count: number }> };

    res.json({
      generatedAt: new Date().toISOString(),
      noSignalOrPaperTradingImpact: true,
      lookbackDays,
      perDayPerUnderlying: gaps.rows,
      underlyingSummary: summary.rows,
      futureTimestampRows: futureTsRows.rows[0]?.future_count ?? 0,
      interpretation: {
        coveragePctGreen: "≥ 80%",
        coveragePctYellow: "50–80%",
        coveragePctRed: "< 50%",
        note: "Ticks missed during market-closed periods (pre-open, lunch, post-close) are expected and not counted as gaps.",
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Manual trigger ───────────────────────────────────────────────────────────

router.post("/option-snapshots/run-now", strictOwner, async (req, res, next) => {
  try {
    const force = String(req.query["force"] ?? "") === "1";
    const canaryMarker = req.query["canaryMarker"] ? String(req.query["canaryMarker"]) : undefined;
    const r = await runIngestionTick({ force, canaryMarker });
    res.json({
      ok: true,
      forced: force,
      canaryMarker: canaryMarker ?? null,
      noSignalOrPaperTradingImpact: true,
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

// ─── Analytics ───────────────────────────────────────────────────────────────

const MAX_GROUPS_DEFAULT = 12;
const MAX_GROUPS_HARD_CAP = 50;
const MAX_ROWS_PER_GROUP = 200;
const MAX_LOOKBACK_MIN = 24 * 60;

function parsePosInt(raw: unknown, max: number): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || n > max) return null;
  return n;
}

function parseIsoDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? s : null;
}

function parseIsoTimestamp(raw: unknown): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

function pickUnderlying(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  return (SNAPSHOT_INDICES as readonly string[]).includes(s) ? s : null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

router.get("/option-snapshots/analytics", strictOwner, async (req, res, next) => {
  try {
    const filter = {
      underlying: pickUnderlying(req.query["underlying"]),
      expiry: parseIsoDate(req.query["expiry"]),
      capturedAt: parseIsoTimestamp(req.query["capturedAt"]),
      lookbackMinutes: parsePosInt(req.query["lookbackMinutes"], MAX_LOOKBACK_MIN),
      staleThresholdMin:
        parsePosInt(req.query["staleThresholdMin"], MAX_LOOKBACK_MIN) ??
        DEFAULT_STALE_THRESHOLD_MINUTES,
      maxGroups:
        parsePosInt(req.query["maxGroups"], MAX_GROUPS_HARD_CAP) ?? MAX_GROUPS_DEFAULT,
    };

    const universeFragment = sql.join(
      SNAPSHOT_INDICES.map((u) => sql`${u}`),
      sql`, `,
    );
    const underlyingFilter = filter.underlying
      ? sql`AND underlying = ${filter.underlying}`
      : sql``;
    const expiryFilter = filter.expiry ? sql`AND expiry = ${filter.expiry}` : sql``;
    const lookbackCutoff = filter.lookbackMinutes
      ? new Date(Date.now() - filter.lookbackMinutes * 60_000)
      : null;
    const lookbackFilter = lookbackCutoff
      ? sql`AND captured_at >= ${lookbackCutoff.toISOString()}`
      : sql``;

    let groups: Array<{ underlying: string; expiry: string; capturedAt: string }> = [];
    if (filter.capturedAt) {
      const exact = (await db.execute(sql`
        SELECT DISTINCT underlying, expiry::text AS expiry, captured_at
        FROM option_chain_snapshot
        WHERE underlying = ANY(ARRAY[${universeFragment}])
          AND captured_at = ${filter.capturedAt.toISOString()}
          ${underlyingFilter}
          ${expiryFilter}
        ORDER BY underlying, expiry
        LIMIT ${filter.maxGroups};
      `)) as unknown as { rows: Array<Record<string, unknown>> };
      groups = exact.rows.map((r) => ({
        underlying: String(r["underlying"]),
        expiry: String(r["expiry"]),
        capturedAt: new Date(r["captured_at"] as string | Date).toISOString(),
      }));
    } else {
      const latest = (await db.execute(sql`
        WITH expiries_per_underlying AS (
          SELECT
            underlying,
            expiry,
            ROW_NUMBER() OVER (PARTITION BY underlying ORDER BY expiry DESC) AS rn
          FROM (
            SELECT DISTINCT underlying, expiry
            FROM option_chain_snapshot
            WHERE underlying = ANY(ARRAY[${universeFragment}])
              ${underlyingFilter}
              ${expiryFilter}
              ${lookbackFilter}
          ) d
        )
        SELECT s.underlying,
               s.expiry::text AS expiry,
               MAX(s.captured_at) AS captured_at
        FROM option_chain_snapshot s
        JOIN expiries_per_underlying e
          ON e.underlying = s.underlying
         AND e.expiry     = s.expiry
        WHERE e.rn <= 2
          ${lookbackCutoff
            ? sql`AND s.captured_at >= ${lookbackCutoff.toISOString()}`
            : sql``}
        GROUP BY s.underlying, s.expiry
        ORDER BY s.underlying ASC, s.expiry DESC
        LIMIT ${filter.maxGroups};
      `)) as unknown as { rows: Array<Record<string, unknown>> };
      groups = latest.rows.map((r) => ({
        underlying: String(r["underlying"]),
        expiry: String(r["expiry"]),
        capturedAt: new Date(r["captured_at"] as string | Date).toISOString(),
      }));
    }

    const now = new Date();
    const out: Array<Record<string, unknown>> = [];
    for (const g of groups) {
      const legs = (await db.execute(sql`
        SELECT strike, opt_type, oi, oi_change, ltp, iv, bid, ask, spot, atm_strike
        FROM option_chain_snapshot
        WHERE underlying = ${g.underlying}
          AND expiry = ${g.expiry}
          AND captured_at = ${g.capturedAt}
        LIMIT ${MAX_ROWS_PER_GROUP};
      `)) as unknown as { rows: Array<Record<string, unknown>> };

      const inputs: AnalyticsRowInput[] = legs.rows
        .map((r) => {
          const optType = String(r["opt_type"]);
          if (optType !== "CE" && optType !== "PE") return null;
          const strike = num(r["strike"]);
          if (strike == null) return null;
          return {
            strike,
            optType: optType as "CE" | "PE",
            oi: num(r["oi"]),
            oiChange: num(r["oi_change"]),
            ltp: num(r["ltp"]),
            iv: num(r["iv"]),
            bid: num(r["bid"]),
            ask: num(r["ask"]),
            spot: num(r["spot"]),
            atmStrike: num(r["atm_strike"]),
          } satisfies AnalyticsRowInput;
        })
        .filter((x): x is AnalyticsRowInput => x !== null);

      const analytics = computeAnalytics(inputs);
      const staleness = computeStaleness(
        new Date(g.capturedAt),
        now,
        filter.staleThresholdMin,
      );

      out.push({
        underlying: g.underlying,
        expiry: g.expiry,
        capturedAt: g.capturedAt,
        staleness,
        analytics,
        sample: {
          legCount: inputs.length,
          truncated: legs.rows.length >= MAX_ROWS_PER_GROUP,
        },
      });
    }

    res.json({
      generatedAt: now.toISOString(),
      noSignalOrPaperTradingImpact: true,
      filters: {
        underlying: filter.underlying,
        expiry: filter.expiry,
        capturedAt: filter.capturedAt ? filter.capturedAt.toISOString() : null,
        lookbackMinutes: filter.lookbackMinutes,
        staleThresholdMin: filter.staleThresholdMin,
        maxGroups: filter.maxGroups,
      },
      universe: [...SNAPSHOT_INDICES],
      limits: {
        maxGroupsHardCap: MAX_GROUPS_HARD_CAP,
        maxRowsPerGroup: MAX_ROWS_PER_GROUP,
        maxLookbackMin: MAX_LOOKBACK_MIN,
      },
      groupCount: out.length,
      groups: out,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
