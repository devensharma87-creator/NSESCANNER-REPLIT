/**
 * Daily F&O paper-trader summary (2026-05-11.d, reviewer-requested
 * persistence layer).
 *
 * Two responsibilities, kept in one file so they can never drift:
 *   - `computeDailySummaryFo(date)` builds the live snapshot from
 *     option_signal_history + paper_trade_fo + the in-process
 *     MissedSignals ring + the operational-alerts counters. Pure read,
 *     no DB writes. Used by the live `/paper/diagnostics/daily-summary/fo`
 *     endpoint AND by the EOD persister.
 *   - `persistDailySummaryFo(date)` upserts the snapshot into
 *     `paper_daily_summary_fo` keyed on `date`. Idempotent — every
 *     intra-day refresh updates the row in place; the EOD tick at
 *     15:35 IST locks in the final values.
 *
 * Date semantics (architect-flagged 2026-05-11.d):
 *   - opened-today metrics  → `signal_date = date`
 *   - closed-today metrics  → `(exited_at AT TIME ZONE 'Asia/Kolkata')::date = date`
 *   - skipped-today metrics → MissedSignals ring filtered by `signalDate = date`
 *
 * The skips ring is an in-process structure that resets on restart, so
 * the snapshot for the current session may under-count if the API was
 * restarted mid-day. Trade/PnL data is DB-backed and unaffected.
 */
import { sql } from "drizzle-orm";
import {
  db,
  paperDailySummaryFoTable,
  type NewPaperDailySummaryFoRow,
} from "@workspace/db";
import { logger } from "./logger";
import {
  getMissedSignals,
  getOperationalAlerts,
  type PaperOperationalAlerts,
} from "./paperTradingFO";

/* ─────────────────── P17a durable skip-reason fallback ───────────────────
 * The in-memory `getMissedSignals()` ring resets on every process
 * restart, so a deploy / crash mid-day was losing the entire
 * `skipped_by_reason` histogram. The reasoning-logger writes a row to
 * `fno_signal_reasoning` (decision IN ('SKIPPED','MISSED_WINDOW')) for
 * the SAME events, and that table is durable. This helper consults
 * the durable source as a fallback whenever the in-memory ring is
 * empty for the requested IST date. Pure read; no decision impact.
 */
async function fetchDurableSkipReasons(
  date: string,
): Promise<{ total: number; byReason: Record<string, number> }> {
  try {
    const rows = (await db.execute(sql`
      SELECT reason_code AS r, COUNT(*)::int AS n
        FROM fno_signal_reasoning
       WHERE signal_date = ${date}
         AND decision IN ('SKIPPED','MISSED_WINDOW')
       GROUP BY reason_code
    `)) as unknown as { rows: Array<{ r: string | null; n: number | string }> };
    const byReason: Record<string, number> = {};
    let total = 0;
    for (const row of rows.rows) {
      const key = row.r ?? "UNKNOWN";
      const n = Number(row.n);
      byReason[key] = (byReason[key] ?? 0) + n;
      total += n;
    }
    return { total, byReason };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, date },
      "fetchDurableSkipReasons failed (diagnostics-only; falling back to in-memory ring)",
    );
    return { total: 0, byReason: {} };
  }
}

export interface DailySummaryFo {
  date: string;
  signalsGenerated: number;
  tradesOpened: number;
  tradesOpenedByTier: { BASELINE: number; HC: number };
  tradesClosed: number;
  validCandidates: number;
  /** opened / (opened + skipped). null when validCandidates === 0. */
  tradeOpenRate: number | null;
  skipped: {
    total: number;
    byReason: Array<{ key: string; count: number }>;
  };
  pnl: { baseline: number; hc: number; total: number };
  scratchesCount: number;
  manualOverridesCount: number;
  alerts: PaperOperationalAlerts;
  policy: { winRate: string; expectancy: string; manualOverride: string };
  generatedAt: string;
}

/** IST YYYY-MM-DD for "today" given a wall-clock instant. */
export function istDateOf(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const POLICY = {
  winRate: "WIN+LOSS only (SCRATCH excluded)",
  expectancy: "WIN+LOSS+SCRATCH (every filled system trade)",
  manualOverride: "EXCLUDED from autonomous setup calibration",
} as const;

/**
 * Build the snapshot for a given IST calendar day. `date` MUST be a
 * YYYY-MM-DD string in IST.
 */
export async function computeDailySummaryFo(date: string): Promise<DailySummaryFo> {
  // (1) Signals generated.
  const sigRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n
      FROM option_signal_history
     WHERE signal_date = ${date}
  `);
  const signalsGenerated = Number(
    (sigRows as unknown as { rows: Array<{ n: number | string }> }).rows[0]?.n ?? 0,
  );

  // (2) Trades opened (signal_date anchor).
  const openRows = await db.execute(sql`
    SELECT h.tier AS tier, COUNT(*)::int AS n
      FROM paper_trade_fo p
      LEFT JOIN option_signal_history h
        ON h.signal_date  = p.signal_date
       AND h.index_symbol = p.index_symbol
       AND h.setup_key    = p.setup_key
       AND h.direction    = p.direction
     WHERE p.signal_date = ${date}
     GROUP BY h.tier
  `);
  const oRows = (openRows as unknown as {
    rows: Array<{ tier: string | null; n: number | string }>;
  }).rows;

  // (3) Trades closed (exited_at IST anchor).
  const closeRows = await db.execute(sql`
    SELECT
      h.tier                                                   AS tier,
      COUNT(*)::int                                            AS n,
      COUNT(*) FILTER (
        WHERE p.exit_reason IN ('TARGET1_HIT','TARGET2_HIT','STOPPED','EXPIRED')
          AND p.realized_pnl = 0
      )::int                                                   AS scratches,
      COUNT(*) FILTER (
        WHERE p.exit_reason = 'MANUAL_OVERRIDE'
      )::int                                                   AS manual_overrides,
      COALESCE(SUM(p.realized_pnl), 0)::numeric                AS realized_pnl
    FROM paper_trade_fo p
    LEFT JOIN option_signal_history h
      ON h.signal_date  = p.signal_date
     AND h.index_symbol = p.index_symbol
     AND h.setup_key    = p.setup_key
     AND h.direction    = p.direction
    WHERE p.status = 'CLOSED'
      AND (p.exited_at AT TIME ZONE 'Asia/Kolkata')::date = ${date}::date
    GROUP BY h.tier
  `);
  const cRows = (closeRows as unknown as {
    rows: Array<{
      tier: string | null;
      n: number | string;
      scratches: number | string;
      manual_overrides: number | string;
      realized_pnl: number | string;
    }>;
  }).rows;

  let tradesOpened = 0;
  let baselineOpened = 0;
  let hcOpened = 0;
  for (const r of oRows) {
    const n = Number(r.n);
    tradesOpened += n;
    if (r.tier === "BASELINE") baselineOpened += n;
    else hcOpened += n;
  }

  let tradesClosed = 0;
  let scratchesCount = 0;
  let manualOverridesCount = 0;
  let baselinePnl = 0;
  let hcPnl = 0;
  for (const r of cRows) {
    const n = Number(r.n);
    const pnl = Number(r.realized_pnl);
    tradesClosed += n;
    scratchesCount += Number(r.scratches);
    manualOverridesCount += Number(r.manual_overrides);
    if (r.tier === "BASELINE") baselinePnl += pnl;
    else hcPnl += pnl;
  }

  // (4) Skips: prefer the durable `fno_signal_reasoning` source because
  // the in-memory ring is bounded and resets on every process restart
  // (P17a). The ring is only used as a fail-open fallback when the
  // durable query returned nothing — that way a mid-day restart that
  // re-populates the ring with NEW skips cannot overwrite the larger
  // persisted durable total with a smaller ring-only number.
  const ringSkips = getMissedSignals().filter(m => m.signalDate === date);
  const ringByReason: Record<string, number> = {};
  for (const m of ringSkips) {
    const r = m.skipReason ?? "UNKNOWN";
    ringByReason[r] = (ringByReason[r] ?? 0) + 1;
  }
  const durable = await fetchDurableSkipReasons(date);
  let skippedTotal: number;
  let skippedByReason: Record<string, number>;
  if (durable.total >= ringSkips.length) {
    skippedTotal = durable.total;
    skippedByReason = durable.byReason;
  } else {
    // Durable came back empty / errored → use the ring snapshot as a
    // fail-open backup. Never silently undercount a known datum.
    skippedTotal = ringSkips.length;
    skippedByReason = ringByReason;
  }
  const validCandidates = tradesOpened + skippedTotal;
  const tradeOpenRate = validCandidates > 0 ? tradesOpened / validCandidates : null;

  return {
    date,
    signalsGenerated,
    tradesOpened,
    tradesOpenedByTier: { BASELINE: baselineOpened, HC: hcOpened },
    tradesClosed,
    validCandidates,
    tradeOpenRate,
    skipped: {
      total: skippedTotal,
      byReason: Object.entries(skippedByReason)
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, count })),
    },
    pnl: {
      baseline: +baselinePnl.toFixed(2),
      hc: +hcPnl.toFixed(2),
      total: +(baselinePnl + hcPnl).toFixed(2),
    },
    scratchesCount,
    manualOverridesCount,
    alerts: getOperationalAlerts(),
    policy: POLICY,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Upsert the snapshot for `date` into `paper_daily_summary_fo`. Pure
 * write — caller is responsible for choosing the right `date` (today
 * for live refresh, yesterday for late-night EOD reruns, etc).
 *
 * THROWS on failure (architect-amended 2026-05-11.d). The previous
 * fail-OPEN swallow corrupted the EOD latch retry semantics — the
 * latch wrapper only re-tries when the call throws, so a swallowed
 * error would burn the latch on a failed write and lose the row for
 * the rest of the day. The live read endpoint wraps this call in its
 * own `.catch(() => {})` to preserve its fail-OPEN behaviour without
 * affecting the scheduler retry path.
 */
export async function persistDailySummaryFo(date: string): Promise<void> {
  const snap = await computeDailySummaryFo(date);
  const row: NewPaperDailySummaryFoRow = {
      date: snap.date,
      signalsGenerated: snap.signalsGenerated,
      tradesOpened: snap.tradesOpened,
      tradesClosed: snap.tradesClosed,
      baselineOpened: snap.tradesOpenedByTier.BASELINE,
      hcOpened: snap.tradesOpenedByTier.HC,
      validCandidates: snap.validCandidates,
      // numeric column accepts string for precise decimal storage.
      tradeOpenRate: snap.tradeOpenRate === null ? null : snap.tradeOpenRate.toFixed(4),
      skippedTotal: snap.skipped.total,
      skippedByReason: snap.skipped.byReason,
      baselinePnl: snap.pnl.baseline.toFixed(2),
      hcPnl: snap.pnl.hc.toFixed(2),
      totalPnl: snap.pnl.total.toFixed(2),
      scratchesCount: snap.scratchesCount,
      manualOverridesCount: snap.manualOverridesCount,
      alerts: snap.alerts,
      updatedAt: new Date(),
    };
  await db
    .insert(paperDailySummaryFoTable)
    .values(row)
    .onConflictDoUpdate({
      target: paperDailySummaryFoTable.date,
      // Don't touch capturedAt on update — it preserves the first-write
      // timestamp so we can tell when the snapshot was originally seeded.
      set: {
        signalsGenerated: row.signalsGenerated,
        tradesOpened: row.tradesOpened,
        tradesClosed: row.tradesClosed,
        baselineOpened: row.baselineOpened,
        hcOpened: row.hcOpened,
        validCandidates: row.validCandidates,
        tradeOpenRate: row.tradeOpenRate,
        skippedTotal: row.skippedTotal,
        skippedByReason: row.skippedByReason,
        baselinePnl: row.baselinePnl,
        hcPnl: row.hcPnl,
        totalPnl: row.totalPnl,
        scratchesCount: row.scratchesCount,
        manualOverridesCount: row.manualOverridesCount,
        alerts: row.alerts,
        updatedAt: row.updatedAt,
      },
    });
}

/* ────────── EOD scheduler latch ──────────
 * Runs on its OWN 60s interval (architect-amended 2026-05-11.d). The
 * previous version was piggy-backed on the trigger sweep, which
 * short-circuits unless `computeMarketStatus === "open"` — and
 * computeMarketStatus closes at 15:30 IST, so the 15:35 EOD target
 * was never reachable from that path.
 *
 * Single-replica assumption: this Replit deployment runs one process
 * per environment (the database skill confirms this; F&O caches and
 * latches throughout the codebase rely on it). If the project is ever
 * scaled horizontally, the EOD coordination must be moved to a DB
 * advisory lock or a `paper_daily_summary_fo`-keyed sentinel row.
 *
 * Latch advances ONLY on a thrown-clean persist (architect fix): the
 * underlying `persistDailySummaryFo` no longer swallows errors, so
 * a transient DB failure correctly leaves `lastEodPersistDate`
 * unchanged and the next 60s tick retries.
 */
let lastEodPersistDate: string | null = null;
const EOD_LATCH_HOUR = 15;
const EOD_LATCH_MIN = 35;
const EOD_LATCH_MIN_OF_DAY = EOD_LATCH_HOUR * 60 + EOD_LATCH_MIN;

export async function maybePersistEodDailySummary(): Promise<void> {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const istDay = ist.toISOString().slice(0, 10);
  const istMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (istMin < EOD_LATCH_MIN_OF_DAY) return;
  if (lastEodPersistDate === istDay) return;
  try {
    await persistDailySummaryFo(istDay);
    lastEodPersistDate = istDay; // burn latch only on a clean success
    logger.info({ date: istDay }, "EOD daily summary persisted");
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, date: istDay },
      "EOD daily summary persist threw — latch NOT burned, will retry next tick",
    );
  }
}

/**
 * Module-load side-effect: install a 60s interval that drives the EOD
 * latch unconditionally (no market-open guard). `.unref()` so it does
 * not keep the event loop alive in shutdown / test scenarios.
 */
const EOD_TICK_MS = 60_000;
setInterval(() => {
  void maybePersistEodDailySummary();
}, EOD_TICK_MS).unref?.();
