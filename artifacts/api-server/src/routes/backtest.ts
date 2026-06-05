/**
 * Backtest Lab — F&O backtest runs (owner OR subscriber, ownerKey-scoped).
 *
 *   POST   /backtest/fno/runs              — run a backtest + persist the result
 *   GET    /backtest/fno/runs              — list the user's runs (metadata)
 *   GET    /backtest/fno/runs/:id          — one run (summary + dataQuality)
 *   GET    /backtest/fno/runs/:id/trades   — the run's trades
 *   GET    /backtest/fno/runs/:id/blocked  — the run's blocked-setup audit
 *   DELETE /backtest/fno/runs/:id          — delete a run (+children, cascade)
 *   GET    /backtest/fno/snapshot-coverage — Mode D capture coverage
 *
 * Two honest modes (see lib/backtest/*): REAL_REPLAY reads the engine's actual
 * captured history; DIRECTIONAL replays the reconstructable directional layer on
 * real historical spot candles with a clearly-LABELED option delta proxy.
 * Nothing here fabricates option premiums, IV, or OI.
 */

import { Router, type IRouter, type Request } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  backtestRunsTable,
  backtestTradesTable,
  backtestBlockedSetupsTable,
} from "@workspace/db/schema";
import { CreateBacktestRunBody } from "@workspace/api-zod";
import { getSession, requireSubscriberOrOwner } from "../lib/userAuth";
import { LOT_SIZES } from "../lib/optionChain";
import {
  buildReplayTrades,
  buildBlockedSetups,
  buildReplayDataQuality,
  type OshRow,
  type FsrAggRow,
} from "../lib/backtest/replay";
import {
  runDirectional,
  buildDirectionalDataQuality,
} from "../lib/backtest/directional";
import { loadHistoricalCandles, isSupportedInstrument } from "../lib/backtest/candleSource";
import { computeSummary } from "../lib/backtest/summary";
import type {
  BacktestTradeOut,
  BacktestBlockedOut,
  BacktestSnapshotCoverageOut,
  BacktestCoverageWindow,
} from "../lib/backtest/types";

const router: IRouter = Router();

const FNO_INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
const MAX_RUNS_PER_OWNER = 100;

function ownerKeyFor(req: Request): string | null {
  const s = getSession(req);
  if (!s) return null;
  return s.role === "owner" ? "owner" : `u:${s.userId}`;
}

function paramId(req: Request): string {
  const v = req.params["id"];
  return typeof v === "string" ? v : "";
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function instrumentsFor(instrument: string): string[] {
  return instrument === "ALL" ? [...FNO_INDICES] : [instrument];
}

/** Parameterized `IN (...)` fragment (drizzle won't bind a JS array to ANY()). */
function inList(values: string[]) {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
}

async function snapshotCoverage(): Promise<BacktestSnapshotCoverageOut> {
  const res = await db.execute(sql`
    SELECT MIN(captured_at) AS earliest,
           MAX(captured_at) AS latest,
           COUNT(*)::int    AS cnt,
           COALESCE(ARRAY_AGG(DISTINCT underlying), ARRAY[]::text[]) AS unders
    FROM option_chain_snapshot
  `);
  const row = (res.rows?.[0] ?? {}) as {
    earliest: string | Date | null;
    latest: string | Date | null;
    cnt: number | null;
    unders: string[] | null;
  };
  const toIso = (v: string | Date | null) =>
    v == null ? null : (v instanceof Date ? v : new Date(v)).toISOString();
  return {
    earliest: toIso(row.earliest),
    latest: toIso(row.latest),
    count: Number(row.cnt) || 0,
    underlyings: (row.unders ?? []).filter((u): u is string => typeof u === "string"),
  };
}

/** Map a stored run row + parsed blobs into the BacktestRun DTO. */
function runToDto(row: typeof backtestRunsTable.$inferSelect) {
  return {
    id: row.id,
    mode: row.mode,
    instrument: row.instrument,
    timeframe: row.timeframe,
    fromDate: row.fromDate,
    toDate: row.toDate,
    startingCapital: row.startingCapital,
    riskPerTradePct: row.riskPerTradePct,
    status: row.status,
    summary: (row.summary as unknown) ?? null,
    dataQuality: (row.dataQuality as unknown) ?? null,
    error: row.error ?? null,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    completedAt:
      row.completedAt == null
        ? null
        : row.completedAt instanceof Date
          ? row.completedAt.toISOString()
          : String(row.completedAt),
  };
}

// ---------------------------------------------------------------------------
// Mode A — REAL_REPLAY
// ---------------------------------------------------------------------------
async function runRealReplay(params: {
  instruments: string[];
  fromDate: string | null;
  toDate: string | null;
  lots: number;
}): Promise<{
  trades: BacktestTradeOut[];
  blocked: BacktestBlockedOut[];
  from: string;
  to: string;
  dataQuality: ReturnType<typeof buildReplayDataQuality>;
}> {
  const { instruments } = params;

  // Resolve the window (default to the full captured span).
  let from = params.fromDate;
  let to = params.toDate;
  if (!from || !to) {
    const span = await db.execute(sql`
      SELECT MIN(signal_date)::text AS lo, MAX(signal_date)::text AS hi
      FROM option_signal_history
      WHERE index_symbol IN (${inList(instruments)})
    `);
    const s = (span.rows?.[0] ?? {}) as { lo: string | null; hi: string | null };
    from = from ?? s.lo ?? "1970-01-01";
    to = to ?? s.hi ?? ymd(new Date());
  }

  const oshRes = await db.execute(sql`
    SELECT signal_date, index_symbol, setup_key, setup_name, direction, strike,
           option_type, confidence, tier, generated_at, status, triggered_at,
           exited_at, exit_reason, last_spot, option_entry, option_stop_loss,
           option_target1, option_target2, max_favorable_excursion,
           max_adverse_excursion
    FROM option_signal_history
    WHERE index_symbol IN (${inList(instruments)})
      AND signal_date >= ${from} AND signal_date <= ${to}
    ORDER BY generated_at ASC
  `);
  const oshRows = (oshRes.rows ?? []) as unknown as OshRow[];
  const trades = buildReplayTrades(oshRows, { lots: params.lots, lotSizes: LOT_SIZES });
  const takenCount = trades.length;

  const fsrRes = await db.execute(sql`
    SELECT index_symbol, setup_key, direction, decision, reason_code, regime,
           MAX(confidence)        AS confidence,
           AVG(confluence_score)  AS confluence_score,
           COUNT(*)::int          AS cnt
    FROM fno_signal_reasoning
    WHERE index_symbol IN (${inList(instruments)})
      AND signal_date >= ${from} AND signal_date <= ${to}
      AND decision IS NOT NULL AND decision <> 'EMITTED'
    GROUP BY index_symbol, setup_key, direction, decision, reason_code, regime
    ORDER BY cnt DESC
    LIMIT 200
  `);
  const blocked = buildBlockedSetups((fsrRes.rows ?? []) as unknown as FsrAggRow[]);

  const ivRes = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM iv_history
    WHERE record_date >= ${from} AND record_date <= ${to}
  `);
  const ivCount = Number((ivRes.rows?.[0] as { c: number } | undefined)?.c) || 0;

  const oiRes = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM fno_signal_reasoning
    WHERE index_symbol IN (${inList(instruments)})
      AND signal_date >= ${from} AND signal_date <= ${to}
      AND option_oi IS NOT NULL
  `);
  const oiAvailable = (Number((oiRes.rows?.[0] as { c: number } | undefined)?.c) || 0) > 0;

  const cov = await snapshotCoverage();
  const dataQuality = buildReplayDataQuality({
    trades,
    takenCount,
    ivCount,
    oiAvailable,
    blockedCount: blocked.length,
    snapshotCoverage: cov,
    lots: params.lots,
  });

  return { trades, blocked, from, to, dataQuality };
}

// ---------------------------------------------------------------------------
// Mode B — DIRECTIONAL
// ---------------------------------------------------------------------------
async function runDirectionalMode(params: {
  instruments: string[];
  fromDate: string | null;
  toDate: string | null;
  startingCapital: number;
  riskPerTradePct: number;
}): Promise<{
  trades: BacktestTradeOut[];
  from: string;
  to: string;
  dataQuality: ReturnType<typeof buildDirectionalDataQuality>;
}> {
  const trades: BacktestTradeOut[] = [];
  const missing: string[] = [];
  let covFrom: number | null = null;
  let covTo: number | null = null;
  let covCount = 0;

  for (const sym of params.instruments) {
    if (!isSupportedInstrument(sym)) {
      missing.push(sym);
      continue;
    }
    const { candles, available } = await loadHistoricalCandles(
      sym,
      params.fromDate,
      params.toDate,
    );
    if (!available || candles.length === 0) {
      missing.push(sym);
      continue;
    }
    covCount += candles.length;
    const lo = candles[0]!.t.getTime();
    const hi = candles[candles.length - 1]!.t.getTime();
    covFrom = covFrom === null ? lo : Math.min(covFrom, lo);
    covTo = covTo === null ? hi : Math.max(covTo, hi);

    const lotSize = LOT_SIZES[sym] ?? 1;
    const symTrades = runDirectional(candles, {
      indexSymbol: sym,
      lotSize,
      startingCapital: params.startingCapital,
      riskPerTradePct: params.riskPerTradePct,
    });
    trades.push(...symTrades);
  }

  trades.sort((a, b) => {
    const ta = a.entryAt ? Date.parse(a.entryAt) : 0;
    const tb = b.entryAt ? Date.parse(b.entryAt) : 0;
    return ta - tb;
  });

  const coverage: BacktestCoverageWindow | null =
    covFrom !== null && covTo !== null
      ? { from: ymd(new Date(covFrom)), to: ymd(new Date(covTo)), count: covCount }
      : null;

  const dataQuality = buildDirectionalDataQuality({
    coverage,
    tradeCount: trades.length,
    missingInstruments: missing,
  });

  return {
    trades,
    from: coverage?.from ?? params.fromDate ?? ymd(new Date()),
    to: coverage?.to ?? params.toDate ?? ymd(new Date()),
    dataQuality,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
router.post("/backtest/fno/runs", requireSubscriberOrOwner("BACKTEST_LAB"), async (req, res) => {
  const ownerKey = ownerKeyFor(req);
  if (!ownerKey) return res.status(403).json({ error: "forbidden" });

  const parsed = CreateBacktestRunBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  const body = parsed.data;

  const countRes = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM backtest_runs WHERE owner_key = ${ownerKey}
  `);
  if ((Number((countRes.rows?.[0] as { c: number } | undefined)?.c) || 0) >= MAX_RUNS_PER_OWNER) {
    return res.status(409).json({ error: "too_many_runs", limit: MAX_RUNS_PER_OWNER });
  }

  const timeframe = body.timeframe?.trim() || "15m";
  const startingCapital =
    typeof body.startingCapital === "number" && body.startingCapital > 0
      ? body.startingCapital
      : 1_000_000;
  const riskPerTradePct =
    typeof body.riskPerTradePct === "number" && body.riskPerTradePct > 0
      ? body.riskPerTradePct
      : 1;
  const lots = Math.max(1, Math.round(riskPerTradePct)); // Mode A position size

  const instruments = instrumentsFor(body.instrument);

  try {
    let trades: BacktestTradeOut[];
    let blocked: BacktestBlockedOut[] = [];
    let from: string;
    let to: string;
    let dataQuality: unknown;

    if (body.mode === "REAL_REPLAY") {
      const r = await runRealReplay({
        instruments,
        fromDate: body.fromDate ?? null,
        toDate: body.toDate ?? null,
        lots,
      });
      trades = r.trades;
      blocked = r.blocked;
      from = r.from;
      to = r.to;
      dataQuality = r.dataQuality;
    } else {
      const r = await runDirectionalMode({
        instruments,
        fromDate: body.fromDate ?? null,
        toDate: body.toDate ?? null,
        startingCapital,
        riskPerTradePct,
      });
      trades = r.trades;
      from = r.from;
      to = r.to;
      dataQuality = r.dataQuality;
    }

    const summary = computeSummary(trades, startingCapital);

    const [run] = await db
      .insert(backtestRunsTable)
      .values({
        ownerKey,
        mode: body.mode,
        instrument: body.instrument,
        timeframe,
        fromDate: from,
        toDate: to,
        startingCapital,
        riskPerTradePct,
        status: "COMPLETE",
        params: { ...body, resolvedLots: lots },
        summary,
        dataQuality,
        completedAt: new Date(),
      })
      .returning();

    if (!run) return res.status(500).json({ error: "insert_failed" });

    if (trades.length > 0) {
      await db.insert(backtestTradesTable).values(
        trades.map((t, i) => ({
          runId: run.id,
          indexSymbol: t.indexSymbol,
          setupKey: t.setupKey,
          setupName: t.setupName,
          direction: t.direction || "NA",
          optionType: t.optionType,
          strike: t.strike,
          entryAt: t.entryAt ? new Date(t.entryAt) : null,
          exitAt: t.exitAt ? new Date(t.exitAt) : null,
          entrySpot: t.entrySpot,
          exitSpot: t.exitSpot,
          optionEntry: t.optionEntry,
          optionExit: t.optionExit,
          optionStop: t.optionStop,
          optionTarget1: t.optionTarget1,
          optionTarget2: t.optionTarget2,
          lots: t.lots,
          lotSize: t.lotSize,
          qty: t.qty,
          pnl: t.pnl,
          exitReason: t.exitReason,
          confidence: t.confidence,
          tier: t.tier,
          regime: t.regime,
          modeled: t.modeled,
          maxFavorableExcursion: t.maxFavorableExcursion,
          maxAdverseExcursion: t.maxAdverseExcursion,
          sortIndex: i,
        })),
      );
    }

    if (blocked.length > 0) {
      await db.insert(backtestBlockedSetupsTable).values(
        blocked.map((b) => ({
          runId: run.id,
          indexSymbol: b.indexSymbol,
          setupKey: b.setupKey,
          direction: b.direction,
          decision: b.decision,
          reasonCode: b.reasonCode,
          confidence: b.confidence,
          confluenceScore: b.confluenceScore,
          regime: b.regime,
          count: b.count,
          note: b.note,
        })),
      );
    }

    return res.status(201).json(runToDto(run));
  } catch (err) {
    req.log?.error({ err: (err as Error).message }, "backtest run failed");
    return res.status(500).json({ error: "backtest_failed", message: (err as Error).message });
  }
});

router.get("/backtest/fno/runs", requireSubscriberOrOwner("BACKTEST_LAB"), async (req, res) => {
  const ownerKey = ownerKeyFor(req);
  if (!ownerKey) return res.json({ items: [] });
  const rows = await db
    .select()
    .from(backtestRunsTable)
    .where(eq(backtestRunsTable.ownerKey, ownerKey))
    .orderBy(desc(backtestRunsTable.createdAt))
    .limit(MAX_RUNS_PER_OWNER);

  const items = rows.map((r) => {
    const s = (r.summary as { totalPnl?: number; totalTrades?: number } | null) ?? null;
    return {
      id: r.id,
      mode: r.mode,
      instrument: r.instrument,
      timeframe: r.timeframe,
      fromDate: r.fromDate,
      toDate: r.toDate,
      status: r.status,
      totalPnl: s && typeof s.totalPnl === "number" ? s.totalPnl : null,
      totalTrades: s && typeof s.totalTrades === "number" ? s.totalTrades : null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      completedAt:
        r.completedAt == null
          ? null
          : r.completedAt instanceof Date
            ? r.completedAt.toISOString()
            : String(r.completedAt),
    };
  });
  return res.json({ items });
});

async function ownedRun(req: Request) {
  const ownerKey = ownerKeyFor(req);
  if (!ownerKey) return null;
  const id = paramId(req);
  if (!id) return null;
  const [row] = await db
    .select()
    .from(backtestRunsTable)
    .where(and(eq(backtestRunsTable.id, id), eq(backtestRunsTable.ownerKey, ownerKey)))
    .limit(1);
  return row ?? null;
}

router.get("/backtest/fno/runs/:id", requireSubscriberOrOwner("BACKTEST_LAB"), async (req, res) => {
  const row = await ownedRun(req);
  if (!row) return res.status(404).json({ error: "not_found" });
  return res.json(runToDto(row));
});

router.delete("/backtest/fno/runs/:id", requireSubscriberOrOwner("BACKTEST_LAB"), async (req, res) => {
  const row = await ownedRun(req);
  if (!row) return res.status(404).json({ error: "not_found" });
  await db.delete(backtestRunsTable).where(eq(backtestRunsTable.id, row.id));
  return res.json({ ok: true });
});

router.get("/backtest/fno/runs/:id/trades", requireSubscriberOrOwner("BACKTEST_LAB"), async (req, res) => {
  const row = await ownedRun(req);
  if (!row) return res.status(404).json({ error: "not_found" });
  const rows = await db
    .select()
    .from(backtestTradesTable)
    .where(eq(backtestTradesTable.runId, row.id))
    .orderBy(backtestTradesTable.sortIndex);
  const items = rows.map((t) => ({
    id: t.id,
    indexSymbol: t.indexSymbol,
    setupKey: t.setupKey,
    setupName: t.setupName,
    direction: t.direction,
    optionType: t.optionType,
    strike: t.strike,
    entryAt: t.entryAt instanceof Date ? t.entryAt.toISOString() : t.entryAt,
    exitAt: t.exitAt instanceof Date ? t.exitAt.toISOString() : t.exitAt,
    entrySpot: t.entrySpot,
    exitSpot: t.exitSpot,
    optionEntry: t.optionEntry,
    optionExit: t.optionExit,
    optionStop: t.optionStop,
    optionTarget1: t.optionTarget1,
    optionTarget2: t.optionTarget2,
    lots: t.lots,
    lotSize: t.lotSize,
    qty: t.qty,
    pnl: t.pnl,
    exitReason: t.exitReason,
    confidence: t.confidence,
    tier: t.tier,
    regime: t.regime,
    modeled: t.modeled,
    maxFavorableExcursion: t.maxFavorableExcursion,
    maxAdverseExcursion: t.maxAdverseExcursion,
  }));
  return res.json({ items });
});

router.get("/backtest/fno/runs/:id/blocked", requireSubscriberOrOwner("BACKTEST_LAB"), async (req, res) => {
  const row = await ownedRun(req);
  if (!row) return res.status(404).json({ error: "not_found" });
  const rows = await db
    .select()
    .from(backtestBlockedSetupsTable)
    .where(eq(backtestBlockedSetupsTable.runId, row.id))
    .orderBy(desc(backtestBlockedSetupsTable.count));
  const items = rows.map((b) => ({
    id: b.id,
    indexSymbol: b.indexSymbol,
    setupKey: b.setupKey,
    direction: b.direction,
    decision: b.decision,
    reasonCode: b.reasonCode,
    confidence: b.confidence,
    confluenceScore: b.confluenceScore,
    regime: b.regime,
    count: b.count,
    note: b.note,
  }));
  return res.json({ items });
});

router.get("/backtest/fno/snapshot-coverage", requireSubscriberOrOwner("BACKTEST_LAB"), async (_req, res) => {
  const cov = await snapshotCoverage();
  return res.json(cov);
});

export default router;
