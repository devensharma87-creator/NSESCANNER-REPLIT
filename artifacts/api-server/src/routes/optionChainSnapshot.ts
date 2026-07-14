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
import {
  computeAnalytics,
  computeStaleness,
  DEFAULT_STALE_THRESHOLD_MINUTES,
  type AnalyticsRowInput,
} from "../lib/optionSnapshotAnalytics";

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

/**
 * Read-only analytics over already-stored option_chain_snapshot rows
 * (Priority 9). Owner-only. Pure read path — no Kite calls, no NSE
 * calls, no writes, no mutation of the ingestor or schema.
 *
 *   GET /api/option-snapshots/analytics
 *
 * Query params (all optional, all safety-bounded):
 *   - underlying          One of SNAPSHOT_INDICES. Filters groups.
 *   - expiry              ISO date (YYYY-MM-DD). Filters groups.
 *   - capturedAt          ISO timestamp. When provided, the route
 *                         analyses the snapshot whose captured_at
 *                         exactly matches this value (per the bucket
 *                         the ingestor rounds to). When absent, the
 *                         route analyses the LATEST snapshot per
 *                         (underlying, expiry).
 *   - lookbackMinutes     Integer 1..1440. Restricts candidate
 *                         capturedAt values to `now - lookbackMinutes`
 *                         and later. Useful to skip groups that have
 *                         not received a fresh snapshot recently.
 *   - staleThresholdMin   Integer 1..1440. Overrides the default
 *                         staleness threshold (30 min) used to flag
 *                         groups in the response.
 *   - maxGroups           Integer 1..50. Caps the number of (underlying,
 *                         expiry) groups returned. Default 12.
 *
 * Hard safety limits enforced by the handler:
 *   - Always restricted to the SNAPSHOT_INDICES universe.
 *   - The query reads at most `MAX_ROWS_PER_GROUP` legs per group
 *     (sized to comfortably cover ATM±10 strikes × 2 sides × the
 *     current+next expiries).
 *   - Without `capturedAt` the route uses the at-most-2 most-recent
 *     expiries per underlying — never the full historical fan-out.
 */
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

    // Step 1: pick the (underlying, expiry, captured_at) tuples to analyse.
    // Either the operator pinned a specific timestamp, or we pick the latest
    // capture per (underlying, expiry) — bounded by lookbackMinutes when set.
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
      // Operator pinned a timestamp — verify the snapshot exists at that
      // bucket for the requested (or every) underlying/expiry pair.
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
      // Latest snapshot per (underlying, expiry), but ONLY for the at
      // most 2 most-recent expiries per underlying (matches what the
      // ingestor actually captures: current + next expiry per index).
      // Without this cap, an operator who hasn't pruned old expiries
      // could pull arbitrarily many groups before the global maxGroups
      // even kicks in.
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

    // Step 2: load the legs for each group and compute analytics. Each
    // group is bounded by MAX_ROWS_PER_GROUP so a malformed snapshot
    // (e.g. an ingestor bug widening the window) cannot blow this up.
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
