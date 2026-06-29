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
import {
  loadHistoricalCandles,
  isSupportedInstrument,
  candleDataVersion,
} from "../lib/backtest/candleSource";
import { computeBacktestRunKey } from "../lib/backtest/runKey";
import { computeSummary } from "../lib/backtest/summary";
import type {
  BacktestTradeOut,
  BacktestBlockedOut,
  BacktestSnapshotCoverageOut,
  BacktestCoverageWindow,
  BacktestDataQualityOut,
  BacktestStrategyComparisonOut,
} from "../lib/backtest/types";
import {
  DEFAULT_FILTERS,
  OPTION_DEPENDENT_FILTERS,
  buildContext,
  getStrategy,
  listStrategies,
  runStrategy,
  buildComparison,
  isStrategyId,
  type FilterConfig,
  type StrategyId,
  type ComparisonUnit,
} from "../lib/backtest/strategies";
import {
  runSnapshotPremiumReplay,
  buildUnderlyingCoverage,
} from "../lib/backtest/snapshotPremiumBacktest";
import {
  computeDiagnostics,
  type DiagTrade,
} from "../lib/backtest/diagnostics";

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
    backtestMode: row.backtestMode ?? null,
    selectedStrategies: (row.selectedStrategies as string[] | null) ?? null,
    filters: (row.filters as unknown) ?? null,
    maxTradesPerDay: row.maxTradesPerDay ?? null,
    strategyComparison: (row.strategyComparison as unknown) ?? null,
    runKey: row.runKey ?? null,
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
// Mode C/D — STRATEGY_RESEARCH / COMPARE_OFFICIAL_VS_STRATEGIES
// ---------------------------------------------------------------------------

/** Merge the request's partial filter toggles over the defaults; option-dependent
 *  filters are FORCE-disabled (no historical option data exists). */
function mergeFilters(input: Partial<FilterConfig> | null | undefined): FilterConfig {
  const merged: FilterConfig = { ...DEFAULT_FILTERS, ...(input ?? {}) };
  for (const k of OPTION_DEPENDENT_FILTERS) {
    (merged as unknown as Record<string, unknown>)[k] = false;
  }
  return merged;
}

const DEFAULT_MAX_TRADES_PER_DAY = 3;
const STRATEGY_TIMEFRAME = "15m";

function strategyDataQuality(params: {
  timeframe: string;
  coverage: BacktestCoverageWindow | null;
  missing: string[];
  unsupportedTimeframe: boolean;
  autoDisabled: string[];
  tradeCount: number;
}): BacktestDataQualityOut {
  const notes: string[] = [];
  const warnings: string[] = [];
  if (params.unsupportedTimeframe) {
    warnings.push(
      `Strategy Research only has real ${STRATEGY_TIMEFRAME} SPOT candles in this environment; timeframe "${params.timeframe}" is unavailable.`,
    );
  }
  if (params.missing.length > 0) {
    warnings.push(`Historical candles unavailable for: ${params.missing.join(", ")}.`);
  }
  if (params.autoDisabled.length > 0) {
    notes.push(
      `Auto-disabled option-dependent filters (no historical option data): ${params.autoDisabled.join(", ")}.`,
    );
  }
  notes.push(
    "Option P&L is a labeled ATM delta proxy (|Δ|≈0.5) on the real spot move; VWAP uses an equal-weighted session-mean substitute (index candles carry no volume).",
  );
  if (params.tradeCount === 0 && !params.unsupportedTimeframe && params.missing.length === 0) {
    notes.push("No strategy setups qualified in the selected window.");
  }
  return {
    mode: "STRATEGY_RESEARCH",
    candleCoverage: params.coverage,
    optionDataAvailable: false,
    ivAvailable: false,
    oiAvailable: false,
    snapshotCoverage: null,
    modeledFields: ["optionPnl(ATM-delta-proxy)", "vwap(session-mean)"],
    warnings,
    notes,
  };
}

/** Run the selected generic strategies across the instruments on REAL spot candles. */
async function runStrategyResearch(params: {
  instruments: string[];
  strategyIds: StrategyId[];
  fromDate: string | null;
  toDate: string | null;
  timeframe: string;
  filters: FilterConfig;
  maxTradesPerDay: number;
  includeCharges: boolean;
  includeSlippage: boolean;
  paramOverride?: Record<string, Record<string, number>> | null;
}): Promise<{
  trades: BacktestTradeOut[];
  blocked: BacktestBlockedOut[];
  comparison: BacktestStrategyComparisonOut;
  from: string;
  to: string;
  dataQuality: BacktestDataQualityOut;
}> {
  const trades: BacktestTradeOut[] = [];
  const blocked: BacktestBlockedOut[] = [];
  const units: ComparisonUnit[] = [];
  const missing: string[] = [];
  const autoDisabled = new Set<string>();
  let covFrom: number | null = null;
  let covTo: number | null = null;
  let covCount = 0;

  const unsupportedTimeframe = params.timeframe !== STRATEGY_TIMEFRAME;

  if (!unsupportedTimeframe) {
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
      const ctx = buildContext(sym, candles);
      if (!ctx) {
        missing.push(sym);
        continue;
      }
      covCount += candles.length;
      const lo = candles[0]!.t.getTime();
      const hi = candles[candles.length - 1]!.t.getTime();
      covFrom = covFrom === null ? lo : Math.min(covFrom, lo);
      covTo = covTo === null ? hi : Math.max(covTo, hi);

      for (const id of params.strategyIds) {
        const module = getStrategy(id);
        const result = runStrategy(ctx, module, params.filters, {
          timeframe: params.timeframe,
          maxTradesPerDay: params.maxTradesPerDay,
          includeCharges: params.includeCharges,
          includeSlippage: params.includeSlippage,
          paramOverride: params.paramOverride?.[id] ?? null,
        });
        for (const k of result.autoDisabledFilters) autoDisabled.add(k);
        trades.push(...result.trades);
        blocked.push(...result.blocked);
        units.push({
          strategyId: module.meta.id,
          strategyName: module.meta.name,
          indexSymbol: sym,
          timeframe: params.timeframe,
          ignoredFilters: [...module.meta.ignoredFilters],
          trades: result.trades,
          blocked: result.blocked,
        });
      }
    }
  }

  trades.sort((a, b) => (a.entryAt ? Date.parse(a.entryAt) : 0) - (b.entryAt ? Date.parse(b.entryAt) : 0));

  const coverage: BacktestCoverageWindow | null =
    covFrom !== null && covTo !== null
      ? { from: ymd(new Date(covFrom)), to: ymd(new Date(covTo)), count: covCount }
      : null;

  const comparison = buildComparison(units, {
    includeCharges: params.includeCharges,
    includeSlippage: params.includeSlippage,
  });

  const dataQuality = strategyDataQuality({
    timeframe: params.timeframe,
    coverage,
    missing,
    unsupportedTimeframe,
    autoDisabled: Array.from(autoDisabled),
    tradeCount: trades.length,
  });

  return {
    trades,
    blocked,
    comparison,
    from: coverage?.from ?? params.fromDate ?? ymd(new Date()),
    to: coverage?.to ?? params.toDate ?? ymd(new Date()),
    dataQuality,
  };
}

const OFFICIAL_STRATEGY_ID = "OFFICIAL_ENGINE";
const OFFICIAL_STRATEGY_NAME = "Official F&O Engine";

/** Tag a directional-engine trade as the "Official Engine" pseudo-strategy. */
function tagOfficialTrade(t: BacktestTradeOut, backtestMode: string): BacktestTradeOut {
  return {
    ...t,
    backtestMode,
    strategyId: OFFICIAL_STRATEGY_ID,
    strategyName: OFFICIAL_STRATEGY_NAME,
    strategyCategory: "Engine",
    signalSource: "ENGINE",
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

  // V2 — Backtest Mode selector. Defaults to OFFICIAL_ENGINE (legacy behaviour).
  const backtestMode = body.backtestMode ?? "OFFICIAL_ENGINE";
  const strategyIds: StrategyId[] = (body.strategies ?? []).filter(isStrategyId);
  const filters = mergeFilters(body.filters as Partial<FilterConfig> | null | undefined);
  const maxTradesPerDay =
    typeof body.maxTradesPerDay === "number" && body.maxTradesPerDay > 0
      ? Math.round(body.maxTradesPerDay)
      : DEFAULT_MAX_TRADES_PER_DAY;
  const includeCharges = body.includeCharges === true;
  const includeSlippage = body.includeSlippage === true;

  if (
    (backtestMode === "STRATEGY_RESEARCH" || backtestMode === "COMPARE_OFFICIAL_VS_STRATEGIES") &&
    strategyIds.length === 0
  ) {
    return res.status(400).json({ error: "no_strategies_selected" });
  }

  // ---- Run idempotency ------------------------------------------------------
  // Re-running byte-identical MODELED inputs reuses the existing run instead of
  // inflating history with a duplicate. The key folds a candle data-version, so
  // a CSV refresh invalidates the cache. REAL_REPLAY → null key (live, growing
  // data; never deduped — always fresh).
  const dataVersion = await candleDataVersion(instruments);
  const runKey = computeBacktestRunKey({
    mode: body.mode,
    backtestMode,
    instrument: body.instrument,
    timeframe,
    fromDate: body.fromDate ?? null,
    toDate: body.toDate ?? null,
    startingCapital,
    riskPerTradePct,
    maxTradesPerDay,
    includeCharges,
    includeSlippage,
    strategyIds,
    filters: backtestMode === "OFFICIAL_ENGINE" ? null : filters,
    strategyParams: body.strategyParams ?? null,
    dataVersion,
  });

  if (runKey) {
    const [existing] = await db
      .select()
      .from(backtestRunsTable)
      .where(and(eq(backtestRunsTable.ownerKey, ownerKey), eq(backtestRunsTable.runKey, runKey)))
      .limit(1);
    if (existing) return res.status(200).json({ ...runToDto(existing), cached: true });
  }

  // Only count toward the per-owner cap when we're actually about to insert a
  // NEW run — a cached hit must never 409.
  const countRes = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM backtest_runs WHERE owner_key = ${ownerKey}
  `);
  if ((Number((countRes.rows?.[0] as { c: number } | undefined)?.c) || 0) >= MAX_RUNS_PER_OWNER) {
    return res.status(409).json({ error: "too_many_runs", limit: MAX_RUNS_PER_OWNER });
  }

  try {
    let trades: BacktestTradeOut[];
    let blocked: BacktestBlockedOut[] = [];
    let from: string;
    let to: string;
    let dataQuality: unknown;
    let comparison: BacktestStrategyComparisonOut | null = null;
    let snapshotPremiumTotals: { totalGrossPnl: number; totalCosts: number; totalNetPnl: number } | null = null;

    if (backtestMode === "STRATEGY_RESEARCH") {
      const r = await runStrategyResearch({
        instruments,
        strategyIds,
        fromDate: body.fromDate ?? null,
        toDate: body.toDate ?? null,
        timeframe,
        filters,
        maxTradesPerDay,
        includeCharges,
        includeSlippage,
        paramOverride: body.strategyParams ?? null,
      });
      trades = r.trades;
      blocked = r.blocked;
      from = r.from;
      to = r.to;
      dataQuality = r.dataQuality;
      comparison = r.comparison;
    } else if (backtestMode === "COMPARE_OFFICIAL_VS_STRATEGIES") {
      // Official engine (directional, reconstructable layer) + the selected strategies.
      const off = await runDirectionalMode({
        instruments,
        fromDate: body.fromDate ?? null,
        toDate: body.toDate ?? null,
        startingCapital,
        riskPerTradePct,
      });
      const officialTrades = off.trades.map((t) => tagOfficialTrade(t, backtestMode));
      const strat = await runStrategyResearch({
        instruments,
        strategyIds,
        fromDate: body.fromDate ?? null,
        toDate: body.toDate ?? null,
        timeframe,
        filters,
        maxTradesPerDay,
        includeCharges,
        includeSlippage,
        paramOverride: body.strategyParams ?? null,
      });
      trades = [...officialTrades, ...strat.trades].sort(
        (a, b) => (a.entryAt ? Date.parse(a.entryAt) : 0) - (b.entryAt ? Date.parse(b.entryAt) : 0),
      );
      blocked = strat.blocked;
      from = off.from < strat.from ? off.from : strat.from;
      to = off.to > strat.to ? off.to : strat.to;
      // Build a combined comparison that includes the Official Engine as a unit per index.
      const officialUnits: ComparisonUnit[] = instruments.map((sym) => ({
        strategyId: OFFICIAL_STRATEGY_ID,
        strategyName: OFFICIAL_STRATEGY_NAME,
        indexSymbol: sym,
        timeframe,
        ignoredFilters: [],
        trades: officialTrades.filter((t) => t.indexSymbol === sym),
        blocked: [],
      }));
      const stratUnits: ComparisonUnit[] = [];
      for (const sym of instruments) {
        for (const id of strategyIds) {
          const module = getStrategy(id);
          stratUnits.push({
            strategyId: module.meta.id,
            strategyName: module.meta.name,
            indexSymbol: sym,
            timeframe,
            ignoredFilters: [...module.meta.ignoredFilters],
            trades: strat.trades.filter(
              (t) => t.indexSymbol === sym && t.strategyId === module.meta.id,
            ),
            blocked: strat.blocked.filter(
              (b) => b.indexSymbol === sym && b.strategyId === module.meta.id,
            ),
          });
        }
      }
      comparison = buildComparison([...officialUnits, ...stratUnits], {
        includeCharges,
        includeSlippage,
      });
      const dq = strat.dataQuality;
      dataQuality = {
        ...dq,
        mode: "COMPARE_OFFICIAL_VS_STRATEGIES",
        candleCoverage: strat.dataQuality.candleCoverage,
        notes: [
          "Compare mode: the Official F&O Engine (directional reconstructable layer) is shown alongside the selected strategies on the same real spot candles.",
          ...dq.notes,
        ],
      } satisfies BacktestDataQualityOut;
    } else if (backtestMode === "SNAPSHOT_PREMIUM_REPLAY") {
      const r = await runSnapshotPremiumReplay({
        instruments,
        fromDate: body.fromDate ?? null,
        toDate: body.toDate ?? null,
        startingCapital,
        riskPerTradePct,
        lots,
      });
      trades = r.trades;
      from = r.from;
      to = r.to;
      dataQuality = r.dataQuality;
      snapshotPremiumTotals = {
        totalGrossPnl: r.totalGrossPnl,
        totalCosts: r.totalCosts,
        totalNetPnl: r.totalNetPnl,
      };
    } else if (body.mode === "REAL_REPLAY") {
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

    const baseSummary = computeSummary(trades, startingCapital);
    const summary = snapshotPremiumTotals
      ? { ...baseSummary, ...snapshotPremiumTotals }
      : baseSummary;

    // The run row and its child trade/blocked rows are written in ONE
    // transaction so a run is never observable half-written. On the
    // idempotency conflict path, the loser's insert blocks on the unique
    // (owner_key, run_key) index until the winner commits — at which point the
    // winner (with all its children) is fully visible, so the cached return is
    // always complete.
    type RunResult =
      | { kind: "fresh"; run: typeof backtestRunsTable.$inferSelect }
      | { kind: "cached"; run: typeof backtestRunsTable.$inferSelect }
      | { kind: "failed" };

    const result: RunResult = await db.transaction(async (tx) => {
      const inserted = await tx
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
          backtestMode,
          selectedStrategies: strategyIds.length > 0 ? strategyIds : null,
          filters:
            backtestMode === "OFFICIAL_ENGINE"
              ? null
              : (filters as unknown as Record<string, unknown>),
          maxTradesPerDay: backtestMode === "OFFICIAL_ENGINE" ? null : maxTradesPerDay,
          strategyComparison: comparison as unknown as Record<string, unknown> | null,
          runKey,
          completedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [backtestRunsTable.ownerKey, backtestRunsTable.runKey],
        })
        .returning();

      const run = inserted[0];
      if (!run) {
        // Lost a race to an identical concurrent request — return the winner.
        if (runKey) {
          const [winner] = await tx
            .select()
            .from(backtestRunsTable)
            .where(
              and(eq(backtestRunsTable.ownerKey, ownerKey), eq(backtestRunsTable.runKey, runKey)),
            )
            .limit(1);
          if (winner) return { kind: "cached", run: winner };
        }
        return { kind: "failed" };
      }

      if (trades.length > 0) {
        await tx.insert(backtestTradesTable).values(
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
          backtestMode: t.backtestMode ?? backtestMode,
          strategyId: t.strategyId ?? null,
          strategyName: t.strategyName ?? null,
          strategyCategory: t.strategyCategory ?? null,
          signalSource: t.signalSource ?? (backtestMode === "OFFICIAL_ENGINE" ? "ENGINE" : null),
          strategyParams: (t.strategyParams as Record<string, unknown> | null) ?? null,
          confirmationFilters: t.confirmationFilters ?? null,
          strategyConfidence: t.strategyConfidence ?? null,
          historicalSetupMatch: t.historicalSetupMatch ?? null,
          passedConditions: t.passedConditions ?? null,
          failedConditions: t.failedConditions ?? null,
          sortIndex: i,
          // Stage 4: Snapshot Premium Replay fields (null for all other modes)
          pricingMode: t.pricingMode ?? null,
          entryPremiumSource: t.entryPremiumSource ?? null,
          exitPremiumSource: t.exitPremiumSource ?? null,
          entryIv: t.entryIv ?? null,
          entryDelta: t.entryDelta ?? null,
          entryTheta: t.entryTheta ?? null,
          grossPnl: t.grossPnl ?? null,
          costsJson: (t.costs as unknown as Record<string, unknown> | null) ?? null,
          netPnl: t.netPnl ?? null,
          withinTolerance: t.withinTolerance ?? null,
        })),
      );
    }

      if (blocked.length > 0) {
        await tx.insert(backtestBlockedSetupsTable).values(
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
            strategyId: b.strategyId ?? null,
            strategyName: b.strategyName ?? null,
            signalSource: b.signalSource ?? null,
            failedCondition: b.failedCondition ?? null,
            blockedRule: b.blockedRule ?? null,
            category: b.category ?? null,
          })),
        );
      }

      return { kind: "fresh", run };
    });

    if (result.kind === "failed") {
      return res.status(500).json({ error: "insert_failed" });
    }
    if (result.kind === "cached") {
      return res.status(200).json({ ...runToDto(result.run), cached: true });
    }
    return res.status(201).json({ ...runToDto(result.run), cached: false });
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
      filters: (r.filters as Record<string, unknown> | null) ?? null,
      maxTradesPerDay: typeof r.maxTradesPerDay === "number" ? r.maxTradesPerDay : null,
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
    backtestMode: t.backtestMode ?? null,
    strategyId: t.strategyId ?? null,
    strategyName: t.strategyName ?? null,
    strategyCategory: t.strategyCategory ?? null,
    signalSource: t.signalSource ?? null,
    strategyParams: (t.strategyParams as Record<string, unknown> | null) ?? null,
    confirmationFilters: (t.confirmationFilters as string[] | null) ?? null,
    strategyConfidence: t.strategyConfidence ?? null,
    historicalSetupMatch: t.historicalSetupMatch ?? null,
    passedConditions: (t.passedConditions as string[] | null) ?? null,
    failedConditions: (t.failedConditions as string[] | null) ?? null,
    // Stage 4: Snapshot Premium Replay fields
    pricingMode: t.pricingMode ?? null,
    entryPremiumSource: t.entryPremiumSource ?? null,
    exitPremiumSource: t.exitPremiumSource ?? null,
    entryIv: t.entryIv ?? null,
    entryDelta: t.entryDelta ?? null,
    entryTheta: t.entryTheta ?? null,
    grossPnl: t.grossPnl ?? null,
    costs: (t.costsJson as Record<string, unknown> | null) ?? null,
    netPnl: t.netPnl ?? null,
    withinTolerance: t.withinTolerance ?? null,
  }));
  return res.json({ items });
});

// ---------------------------------------------------------------------------
// GET /backtest/fno/runs/:id/diagnostics
// Read-only diagnostic analytics for a SNAPSHOT_PREMIUM_REPLAY run.
// Parts A–I from the F&O Diagnostic Pack spec.
// ---------------------------------------------------------------------------
router.get(
  "/backtest/fno/runs/:id/diagnostics",
  requireSubscriberOrOwner("BACKTEST_LAB"),
  async (req, res) => {
    const row = await ownedRun(req);
    if (!row) return res.status(404).json({ error: "not_found" });

    // Load all trades for this run
    const tradeRows = await db
      .select()
      .from(backtestTradesTable)
      .where(eq(backtestTradesTable.runId, row.id))
      .orderBy(backtestTradesTable.sortIndex);

    // For REAL_CAPTURED_PREMIUM trades, resolve the expiry date from
    // option_chain_snapshot using the stored entry_premium_source timestamp.
    // Safe cast: only join when entry_premium_source looks like a timestamp.
    const expiryMap = new Map<string, string>(); // tradeId → expiryDate YYYY-MM-DD
    try {
      const expiryRes = await db.execute(sql`
        WITH priced AS (
          SELECT id, index_symbol, strike, option_type, entry_premium_source
          FROM backtest_trades
          WHERE run_id = ${row.id}
            AND pricing_mode = 'REAL_CAPTURED_PREMIUM'
            AND entry_premium_source ~ '^[0-9]{4}'
        )
        SELECT p.id::text, TO_CHAR(ocs.expiry, 'YYYY-MM-DD') AS expiry
        FROM priced p
        JOIN option_chain_snapshot ocs
          ON  ocs.underlying  = p.index_symbol
          AND ocs.strike::float8 = ROUND(p.strike::float8)
          AND ocs.opt_type    = p.option_type
          AND ocs.captured_at = p.entry_premium_source::timestamptz
        LIMIT 500
      `);
      for (const r of expiryRes.rows ?? []) {
        const er = r as { id: string; expiry: string | null };
        if (er.id && er.expiry) expiryMap.set(er.id, er.expiry);
      }
    } catch {
      // Fail-open: expiry data missing → DTE bucketed as Unknown
    }

    // Map DB rows to DiagTrade
    const diagTrades: DiagTrade[] = tradeRows.map((t) => {
      const costs = (t.costsJson as Record<string, number> | null) ?? null;
      const spreadCost = costs?.spreadCost ?? null;
      const totalCosts = costs?.total ?? null;
      const explicitCosts =
        totalCosts !== null && spreadCost !== null ? totalCosts - spreadCost : null;
      return {
        id: t.id,
        indexSymbol: t.indexSymbol,
        setupKey: t.setupKey ?? null,
        setupName: t.setupName ?? null,
        direction: t.direction,
        optionType: t.optionType ?? null,
        strike: t.strike ?? null,
        entryAt: t.entryAt instanceof Date ? t.entryAt.toISOString() : (t.entryAt ?? null),
        exitAt: t.exitAt instanceof Date ? t.exitAt.toISOString() : (t.exitAt ?? null),
        optionEntry: t.optionEntry ?? null,
        optionExit: t.optionExit ?? null,
        grossPnl: t.grossPnl ?? null,
        spreadCost: spreadCost !== undefined ? spreadCost : null,
        explicitCosts: explicitCosts !== undefined ? explicitCosts : null,
        totalCosts: totalCosts !== undefined ? totalCosts : null,
        netPnl: t.netPnl ?? null,
        pricingMode: t.pricingMode ?? null,
        exitReason: t.exitReason ?? null,
        tier: t.tier ?? null,
        entryPremiumSource: t.entryPremiumSource ?? null,
        exitPremiumSource: t.exitPremiumSource ?? null,
        expiryDate: expiryMap.get(t.id) ?? null,
      };
    });

    const meta = {
      runId: row.id,
      backtestMode: row.backtestMode ?? null,
      fromDate: row.fromDate,
      toDate: row.toDate,
      instrument: row.instrument,
    };

    const diagnostics = computeDiagnostics(meta, diagTrades);
    return res.json(diagnostics);
  },
);

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
    strategyId: b.strategyId ?? null,
    strategyName: b.strategyName ?? null,
    signalSource: b.signalSource ?? null,
    failedCondition: b.failedCondition ?? null,
    blockedRule: b.blockedRule ?? null,
    category: b.category ?? null,
  }));
  return res.json({ items });
});

router.get("/backtest/fno/snapshot-coverage", requireSubscriberOrOwner("BACKTEST_LAB"), async (req, res) => {
  const { from, to, underlying } = req.query as {
    from?: string;
    to?: string;
    underlying?: string;
  };

  // Detail mode: when from+to+underlying are all provided, return per-underlying stats.
  if (from && to && underlying) {
    const syms = underlying.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const details = await Promise.all(syms.map((sym) => buildUnderlyingCoverage(sym, from, to)));
    return res.json({ underlyings: details });
  }

  const cov = await snapshotCoverage();
  return res.json(cov);
});

router.get("/backtest/fno/strategies", requireSubscriberOrOwner("BACKTEST_LAB"), async (_req, res) => {
  const items = listStrategies().map((m) => m.meta);
  return res.json({ items });
});

export default router;
