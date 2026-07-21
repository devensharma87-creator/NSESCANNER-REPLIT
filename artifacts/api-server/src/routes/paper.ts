/**
 * Paper trading HTTP routes — owner-only.
 *
 * MTM (mark-to-market) for OPEN positions reads `paper_trade_fo.last_premium`
 * (updated by the F&O lifecycle hook every signal cycle) AS A FALLBACK, but
 * the GET /paper/positions/fo endpoint enriches every open row with a fresh
 * option-chain LTP at request time so the UI's 10s poll surfaces TRUE live
 * pricing instead of pricing that was at most 30s stale.
 *
 * The fresh-fetch path is bounded by `fetchOptionChain`'s own 15s in-process
 * cache, so even with 5 open positions across distinct underlyings the
 * upstream Kite/NSE load is at most one chain pull per underlying per 15s.
 */
import { Router, type IRouter } from "express";
import {
  GetPaperAccountResponse,
  GetPaperPositionsFOResponse,
  GetPaperTradesFOResponse,
  ClosePaperPositionFOResponse,
  GetPaperReportFoMonthlyResponse,
  GetPaperReportFoYearlyResponse,
  GetPaperPositionsEqResponse,
  GetPaperTradesEqResponse,
  ClosePaperPositionEqResponse,
  GetPaperReportEqMonthlyResponse,
  GetPaperReportEqYearlyResponse,
} from "@workspace/api-zod";
import {
  db,
  paperTradeFoTable,
  paperTradeEqTable,
  paperEqAuditTable,
  swingOrderStagingTable,
} from "@workspace/db";
import type { PaperTradeFoRow, PaperTradeEqRow } from "@workspace/db";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { requireOwner } from "../lib/userAuth";
import {
  ensureDailyReset,
  topupAccount,
  withdrawAccount,
  getCapitalMovements,
  getDeployedCapital,
  getSegmentHeat,
  PORTFOLIO_HEAT,
  FNO_RISK,
  EQUITY_RISK,
  getDailyRealizedDrawdown,
  getWeeklyRealizedDrawdown,
  type Segment,
} from "../lib/paperAccount";
import {
  closePaperTradeForSignal,
  evaluateSingleFnoTradeExit,
  getMissedSignals,
  getMtmSweepHealth,
  getOrphanExitSweepHealth,
  getTimeExit1520Health,
} from "../lib/paperTradingFO";
import { getPremiumOverlayHealth } from "../lib/fnoPremiumExitOverlay";
import { getFnoExitMonitorHealth, recordFnoExitCheck } from "../lib/fnoExitMonitorHealth";
import { buildGlobalDataHealth } from "../lib/globalDataHealth";
import type { LifecycleExitReason } from "../lib/optionSignalLifecycle";
import {
  getReasoningLoggerHealth,
  normaliseFilters,
  queryReasoning,
} from "../lib/fnoSignalReasoningLogger";
import { isPaperAutoTradingEnabled } from "../lib/paperAutoTradeFlag";
import {
  analyticsFiltersFromQuery,
  computeReasoningAnalytics,
  fetchReasoningRows,
} from "../lib/fnoReasoningAnalytics";
import { computeFailureDiagnosis } from "../lib/fnoFailureDiagnosis";
import { computeShadowCostReport } from "../lib/fnoShadowCosts";
import { isShadowCostsEnabled } from "../lib/fnoCostModel";
import { computeShadowExitReport, isShadowExitsEnabled, SHADOW_RULE_PARAMS } from "../lib/fnoShadowExits";
import {
  computeDailySummaryFo,
  istDateOf,
  persistDailySummaryFo,
} from "../lib/paperDailySummaryFo";
import { paperDailySummaryFoTable } from "@workspace/db";
import {
  loadSpotLifecycleByKey,
  lifecycleKeyOf,
  type FnoSpotLifecycle,
} from "../lib/fnoSpotLifecycle";
import { fetchOptionChain } from "../lib/optionChain";
import { getFoAnalytics } from "../lib/paperAnalyticsFO";
import { getMonthlyReport, getYearlyReport } from "../lib/paperReportsFO";
import {
  getMonthlyReport as getEqMonthlyReport,
  getYearlyReport as getEqYearlyReport,
} from "../lib/paperReportsEq";
import { forceClosePaperEquityTrade, openManualPaperEquityTrade } from "../lib/paperTradingEq";
import { computeEquitySessionAdmission, classifyStoredTimestamp } from "../lib/sessionAdmission";
import { computeLifecycleSummary } from "../lib/paperEqLifecycleSummary";
import { listEqAudit, summarizeEqAudit, getEqEventsSince } from "../lib/paperEqAudit";
import { getAllScannedRows } from "../lib/fullNseScanner";
import { logger } from "../lib/logger";
import { getEnvironmentLabel } from "../lib/paperAutoTradeFlag";
import { getJournalAnalytics } from "../lib/journalAnalytics";

const router: IRouter = Router();

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

function istDateKey(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function toOpenPosition(
  r: PaperTradeFoRow,
  liveLtp?: number | null,
  spotLifecycle?: FnoSpotLifecycle | null,
) {
  const entry = num(r.entryPremium);
  // Prefer the freshly-fetched chain LTP when present and valid; fall back
  // to the lifecycle-stored last_premium otherwise. This keeps the UI
  // showing true live LTP every poll instead of pricing that was at most
  // 30s stale, while preserving the legacy field semantics for clients
  // that only care about MTM correctness (lastPremium is still the "best
  // known premium right now").
  const last =
    liveLtp != null && Number.isFinite(liveLtp) && liveLtp > 0
      ? liveLtp
      : num(r.lastPremium);
  const upnl = (last - entry) * r.lots * r.lotSize;
  // If we did refresh from the chain, surface "right now" as the
  // evaluation time so the UI's "Updated" hint is honest.
  const evaluatedAt =
    liveLtp != null && Number.isFinite(liveLtp) && liveLtp > 0
      ? new Date()
      : r.lastEvaluatedAt;
  return {
    id: r.id,
    signalDate: r.signalDate,
    indexSymbol: r.indexSymbol,
    indexName: r.indexName,
    setupKey: r.setupKey,
    direction: r.direction as "BULLISH" | "BEARISH",
    optionType: r.optionType as "CALL" | "PUT",
    strike: num(r.strike),
    lots: r.lots,
    lotSize: r.lotSize,
    entryPremium: entry,
    stopPremium: num(r.stopPremium),
    target1Premium: num(r.target1Premium),
    target2Premium: num(r.target2Premium),
    capitalDeployed: num(r.capitalDeployed),
    lastPremium: last,
    unrealizedPnl: upnl,
    maxRunup: num(r.maxRunup),
    maxDrawdown: num(r.maxDrawdown),
    openedAt: r.openedAt.toISOString(),
    lastEvaluatedAt: evaluatedAt.toISOString(),
    status: "OPEN" as const,
    // F&O Exit Monitoring Reliability (T007) — read-only pass-through of the
    // audit columns `recordFnoExitCheck` stamps every ~30s sweep cycle. Never
    // mutated here; a null exitMonitorStatus just means no check has landed
    // yet for this row (e.g. freshly opened).
    exitMonitorStatus: (r.exitMonitorStatus ?? null) as "MONITORED" | "BLOCKED" | null,
    exitTradeGrade: r.exitTradeGrade ?? null,
    exitQuoteSource: r.exitQuoteSource ?? null,
    exitQuoteAsOf: r.exitQuoteAsOf ? r.exitQuoteAsOf.toISOString() : null,
    exitQuoteFreshnessSec: r.exitQuoteFreshnessSec ?? null,
    lastExitCheckAt: r.lastExitCheckAt ? r.lastExitCheckAt.toISOString() : null,
    lastExitCheckError: r.lastExitCheckError ?? null,
    spotLifecycle: spotLifecycle ?? null,
  };
}

/**
 * For each open paper-trade row, pull the freshest available option-chain
 * LTP for that (indexSymbol, optionType, strike). Chains are fetched
 * once per unique underlying and reused across all rows of that
 * underlying — fetchOptionChain has its own 15s cache, but de-duplicating
 * here also avoids 5 simultaneous in-flight fetches when the cache is
 * cold and several positions share an underlying.
 *
 * Returns a Map<rowId, liveLtp | null>. A null entry means we tried but
 * could not get a fresh price (chain miss, strike not present, no LTP);
 * the caller should fall back to the row's stored last_premium.
 */
async function fetchLiveLtpForOpenRows(
  rows: PaperTradeFoRow[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (rows.length === 0) return out;

  const uniqueUnderlyings = Array.from(new Set(rows.map((r) => r.indexSymbol)));
  const chains = new Map<string, Awaited<ReturnType<typeof fetchOptionChain>>>();
  await Promise.all(
    uniqueUnderlyings.map(async (sym) => {
      try {
        const chain = await fetchOptionChain(sym);
        chains.set(sym, chain);
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, sym },
          "Live LTP enrichment: option chain fetch failed",
        );
        chains.set(sym, null);
      }
    }),
  );

  for (const r of rows) {
    const chain = chains.get(r.indexSymbol);
    if (!chain) {
      out.set(r.id, null);
      continue;
    }
    const strike = num(r.strike);
    const row = chain.rows.find((cr) => cr.strike === strike);
    if (!row) {
      out.set(r.id, null);
      continue;
    }
    const side = r.optionType === "CALL" ? row.ce : row.pe;
    const ltp = side?.ltp;
    out.set(
      r.id,
      ltp != null && Number.isFinite(ltp) && ltp > 0 ? ltp : null,
    );
  }
  return out;
}

function toClosedTrade(
  r: PaperTradeFoRow,
  spotLifecycle?: FnoSpotLifecycle | null,
  telegramStatus?: "SENT" | "FAILED" | "DUPLICATE" | null,
) {
  return {
    id: r.id,
    signalDate: r.signalDate,
    indexSymbol: r.indexSymbol,
    indexName: r.indexName,
    setupKey: r.setupKey,
    direction: r.direction as "BULLISH" | "BEARISH",
    optionType: r.optionType as "CALL" | "PUT",
    strike: num(r.strike),
    lots: r.lots,
    lotSize: r.lotSize,
    entryPremium: num(r.entryPremium),
    exitPremium: num(r.exitPremium),
    capitalDeployed: num(r.capitalDeployed),
    realizedPnl: num(r.realizedPnl),
    exitReason: (r.exitReason ?? "EXPIRED") as
      | "TARGET1_HIT"
      | "TARGET2_HIT"
      | "STOPPED"
      | "EXPIRED"
      | "MANUAL_OVERRIDE"
      | "TIME_EXIT_1520"
      | "TIME_EXIT_1430_EXPIRY",
    openedAt: r.openedAt.toISOString(),
    exitedAt: (r.exitedAt ?? r.openedAt).toISOString(),
    journal: r.journal ?? null,
    tags: r.tags ?? [],
    // Read-only reporting fields (premium plan + MFE/MAE) for exit-clarity UI.
    stopPremium: r.stopPremium == null ? null : num(r.stopPremium),
    target1Premium: r.target1Premium == null ? null : num(r.target1Premium),
    target2Premium: r.target2Premium == null ? null : num(r.target2Premium),
    maxRunup: r.maxRunup == null ? null : num(r.maxRunup),
    maxDrawdown: r.maxDrawdown == null ? null : num(r.maxDrawdown),
    // F&O Exit Monitoring Reliability (T007) — read-only pass-through of the
    // audit columns stamped by `recordFnoExitCheck` before this trade closed.
    exitMonitorStatus: (r.exitMonitorStatus ?? null) as "MONITORED" | "BLOCKED" | null,
    exitTradeGrade: r.exitTradeGrade ?? null,
    exitQuoteSource: r.exitQuoteSource ?? null,
    exitQuoteAsOf: r.exitQuoteAsOf ? r.exitQuoteAsOf.toISOString() : null,
    exitQuoteFreshnessSec: r.exitQuoteFreshnessSec ?? null,
    exitDetectedAt: r.exitDetectedAt ? r.exitDetectedAt.toISOString() : null,
    lastExitCheckAt: r.lastExitCheckAt ? r.lastExitCheckAt.toISOString() : null,
    lastExitCheckError: r.lastExitCheckError ?? null,
    // Real Telegram delivery status lives in notification_delivery_log, NOT
    // the dead `exit_notification_status` column (never written anywhere —
    // see FNO_EXIT_MONITORING_RELIABILITY_REPORT.md for the documented gap).
    // Batched lookup by the caller; undefined param → null (fail-open).
    telegramStatus: telegramStatus ?? null,
    spotLifecycle: spotLifecycle ?? null,
    // Exit-premium market shadow (observation only — never affects P&L).
    // Null for pre-P1 rows (column not captured) and when the chain was
    // unavailable at exit time.
    exitPremiumMarket:
      r.exitPremiumMarket == null ? null : num(r.exitPremiumMarket),
    exitPremiumMarketSource: r.exitPremiumMarketSource ?? null,
    exitPremiumMarketAsOf: r.exitPremiumMarketAsOf
      ? r.exitPremiumMarketAsOf.toISOString()
      : null,
    exitPremiumMarketAgeSec: r.exitPremiumMarketAgeSec ?? null,
    exitPremiumMarketGap:
      r.exitPremiumMarketGap == null ? null : num(r.exitPremiumMarketGap),
    exitPremiumMarketGapPct:
      r.exitPremiumMarketGapPct == null
        ? null
        : num(r.exitPremiumMarketGapPct),
    marketShadowGrossPnl:
      r.marketShadowGrossPnl == null ? null : num(r.marketShadowGrossPnl),
    exitPremiumMarketUnavailableReason:
      r.exitPremiumMarketUnavailableReason ?? null,
  };
}

/**
 * Batched, read-only lookup of the most recent canonical Telegram delivery
 * status per closed F&O paper trade, from `notification_delivery_log`
 * (populated by the tradeLifecycle pipeline — see `buildFnoExitCanonicalEvent`
 * in fnoSignalAlerts.ts). Scoped to `domain='FNO_INTRADAY'` and the 5 EXIT_*
 * event types (`closeReasonToEventType`) — NOT the dead `paper_trade_fo
 * .exit_notification_status` column, which is never written. One query for
 * the whole page (no N+1). Fails OPEN: any DB error yields an empty map, so
 * callers fall back to telegramStatus=null rather than erroring the page.
 */
async function fetchTelegramStatusForClosedTrades(
  ids: string[],
): Promise<Map<string, "SENT" | "FAILED" | "DUPLICATE">> {
  const map = new Map<string, "SENT" | "FAILED" | "DUPLICATE">();
  if (ids.length === 0) return map;
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT ON (paper_trade_id) paper_trade_id, status
      FROM notification_delivery_log
      WHERE domain = 'FNO_INTRADAY'
        AND event_type IN ('EXIT_TARGET_1', 'EXIT_TARGET_2', 'EXIT_STOP_LOSS', 'EXIT_MANUAL', 'EXIT_TIME')
        AND paper_trade_id = ANY(${ids})
      ORDER BY paper_trade_id, created_at DESC
    `);
    for (const row of result.rows as Record<string, unknown>[]) {
      const paperTradeId = row["paper_trade_id"] != null ? String(row["paper_trade_id"]) : null;
      const status = row["status"];
      if (paperTradeId && (status === "SENT" || status === "FAILED" || status === "DUPLICATE")) {
        map.set(paperTradeId, status);
      }
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, count: ids.length },
      "fetchTelegramStatusForClosedTrades: notification_delivery_log lookup failed (fail-open, telegramStatus will be null)",
    );
  }
  return map;
}

router.get("/paper/account", requireOwner, async (req, res, next) => {
  try {
    const segment = String(req.query.segment ?? "").toUpperCase();
    if (segment !== "FNO" && segment !== "EQUITY") {
      return res.status(400).json({ error: "segment must be FNO or EQUITY" });
    }
    // B.1/B.2 sibling: `?reconcile=1` returns only the reconciliation
    // snapshot. Kept as a query flag on the existing /paper/account so
    // the UI never needs to make two round-trips for the same view.
    if (req.query.reconcile === "1") {
      const { reconcilePaperAccount } = await import("../lib/paperAccountReconciliation");
      const snap = await reconcilePaperAccount(segment as "FNO" | "EQUITY");
      return res.json(snap);
    }
    const acct = await ensureDailyReset(segment as Segment);
    const dailyTradeCap =
      segment === "FNO"
        ? FNO_RISK.MAX_TRADES_PER_DAY
        : EQUITY_RISK.MAX_NEW_PER_DAY;
    const maxLossPctPerTrade =
      segment === "FNO" ? FNO_RISK.MAX_LOSS_PCT_PER_TRADE : 0;
    // Phase-1 portfolio drawdown reading. FNO only — equity book has no
    // intraday DD-cap concept, so we leave the fields undefined for it.
    let dailyDD: { drawdownPct: number; capPct: number } | null = null;
    let weeklyDD: { drawdownPct: number; capPct: number } | null = null;
    if (segment === "FNO") {
      [dailyDD, weeklyDD] = await Promise.all([
        getDailyRealizedDrawdown(),
        getWeeklyRealizedDrawdown(),
      ]);
    }
    // Lifetime realised P&L = sum of realizedPnl across every CLOSED
    // trade for this segment. Computed server-side from the trade ledger
    // (NOT from balance - seed) so that manual `/paper/account/topup`
    // capital injections do not inflate the figure. Architect Sev-1 fix.
    const ledgerTable =
      segment === "FNO" ? paperTradeFoTable : paperTradeEqTable;
    // Aggregate in SQL (not JS) so the wire payload is a single scalar
    // even as the closed-trade ledger grows. Indexed on `status` already
    // (`paper_trade_{fo,eq}_status_idx`).
    const [{ sum: lifetimeSum } = { sum: null as string | null }] = await db
      .select({
        sum: sql<string | null>`COALESCE(SUM(${ledgerTable.realizedPnl}), 0)`,
      })
      .from(ledgerTable)
      .where(eq(ledgerTable.status, "CLOSED"));
    const lifetimeRealizedPnl = Number(lifetimeSum ?? 0);

    // Risk-base / heat / capital-movement surface. Risk-base = available
    // cash (balance), NOT seed — matches the dynamic lot-sizing change so
    // the UI shows the same base the sizing engine actually uses.
    const availableCash = num(acct.balance);
    const heatCapPct =
      segment === "FNO"
        ? PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT
        : PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT;
    const [deployedCapital, capital, heatUsed] = await Promise.all([
      getDeployedCapital(segment as Segment),
      getCapitalMovements(segment as Segment),
      getSegmentHeat(segment as Segment),
    ]);
    const riskBase = availableCash;
    const heatCapAmount = heatCapPct * riskBase;
    const heatAvailable = Math.max(heatCapAmount - heatUsed, 0);
    const riskPerTradePct = maxLossPctPerTrade;
    const riskPerTradeAmount = riskPerTradePct * riskBase;

    const data = GetPaperAccountResponse.parse({
      segment,
      seedCapital: num(acct.seedCapital),
      balance: num(acct.balance),
      dayRealizedPnl: num(acct.dayRealizedPnl),
      lifetimeRealizedPnl,
      dayOpenCount: acct.dayOpenCount,
      dayTradeCount: acct.dayTradeCount,
      lastResetDate: acct.lastResetDate ?? istDateKey(),
      dailyTradeCap,
      maxLossPctPerTrade,
      dailyDrawdownPct: dailyDD?.drawdownPct,
      dailyDrawdownCapPct: dailyDD?.capPct,
      weeklyDrawdownPct: weeklyDD?.drawdownPct,
      weeklyDrawdownCapPct: weeklyDD?.capPct,
      availableCash,
      deployedCapital,
      capitalAdded: capital.added,
      capitalWithdrawn: capital.withdrawn,
      heatUsed,
      heatCapAmount,
      heatAvailable,
      heatCapPct,
      riskBase,
      riskPerTradePct,
      riskPerTradeAmount,
    });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

router.get("/paper/positions/fo", requireOwner, async (_req, res, next) => {
  try {
    // Refill counters if a new IST day has rolled over since we last
    // touched the account. Cheap no-op when already current.
    await ensureDailyReset("FNO");
    const rows = await db
      .select()
      .from(paperTradeFoTable)
      .where(eq(paperTradeFoTable.status, "OPEN"))
      .orderBy(desc(paperTradeFoTable.openedAt));
    // Pull a fresh chain LTP for every open position so the UI's "LTP"
    // column reflects right-now pricing, not lifecycle-cycle staleness.
    // This is gated by fetchOptionChain's 15s in-process cache, so 10s
    // UI polling does ~1 cache-hit + ~1/3 fetches per underlying per
    // minute on average.
    const liveLtps = await fetchLiveLtpForOpenRows(rows);
    const lifecycles = await loadSpotLifecycleByKey(rows);
    const data = GetPaperPositionsFOResponse.parse({
      positions: rows.map((r) =>
        toOpenPosition(r, liveLtps.get(r.id), lifecycles.get(lifecycleKeyOf(r))),
      ),
      generatedAt: new Date().toISOString(),
    });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

router.get("/paper/trades/fo", requireOwner, async (req, res, next) => {
  try {
    // First call after IST midnight rolls over — ensure refill + sweep
    // run before we report the day's trades so the UI never shows a
    // mix of yesterday's stale OPEN rows alongside today's.
    await ensureDailyReset("FNO");
    const date = String(req.query.date ?? "").trim() || istDateKey();
    const rows = await db
      .select()
      .from(paperTradeFoTable)
      .where(
        and(
          eq(paperTradeFoTable.status, "CLOSED"),
          eq(paperTradeFoTable.signalDate, date),
        ),
      )
      .orderBy(desc(paperTradeFoTable.exitedAt));
    const lifecycles = await loadSpotLifecycleByKey(rows);
    const telegramStatuses = await fetchTelegramStatusForClosedTrades(rows.map((r) => r.id));
    const data = GetPaperTradesFOResponse.parse({
      date,
      trades: rows.map((r) =>
        toClosedTrade(r, lifecycles.get(lifecycleKeyOf(r)), telegramStatuses.get(r.id) ?? null),
      ),
      generatedAt: new Date().toISOString(),
    });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

router.post("/paper/positions/fo/:id/close", requireOwner, async (req, res, next) => {
  try {
    // Make sure today's account row exists / has been refilled before
    // we credit anything back into it.
    await ensureDailyReset("FNO");
    const id = String(req.params.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "id required" });
    const rows = await db
      .select()
      .from(paperTradeFoTable)
      .where(eq(paperTradeFoTable.id, id))
      .limit(1);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const row = rows[0]!;
    if (row.status !== "OPEN") {
      return res.status(409).json({ error: "Position is not OPEN" });
    }
    // Refresh last_premium to the freshest available chain LTP BEFORE
    // closing — pickExitPremium() routes MANUAL_OVERRIDE to lastPremium,
    // so without this pre-refresh a force-exit would settle at whatever
    // the lifecycle hook last wrote (up to 30s stale). Best-effort: if
    // the chain fetch fails, we close at the stored price (same as before).
    const liveLtps = await fetchLiveLtpForOpenRows([row]);
    const liveLtp = liveLtps.get(row.id);
    if (liveLtp != null && Number.isFinite(liveLtp) && liveLtp > 0) {
      await db
        .update(paperTradeFoTable)
        .set({
          lastPremium: sql`${liveLtp}::numeric`,
          lastEvaluatedAt: new Date(),
        })
        .where(and(eq(paperTradeFoTable.id, row.id), eq(paperTradeFoTable.status, "OPEN")));
    }
    const closed = await closePaperTradeForSignal(
      row.signalDate,
      row.indexSymbol,
      row.setupKey,
      row.direction as "BULLISH" | "BEARISH",
      "MANUAL_OVERRIDE",
    );
    if (!closed) {
      // Lost the race — re-read whatever the row is now and surface it.
      const fresh = await db
        .select()
        .from(paperTradeFoTable)
        .where(eq(paperTradeFoTable.id, id))
        .limit(1);
      if (fresh.length === 0 || fresh[0]!.status !== "CLOSED") {
        return res.status(409).json({ error: "Concurrent close lost the race" });
      }
      const data = ClosePaperPositionFOResponse.parse(toClosedTrade(fresh[0]!));
      return res.json(data);
    }
    logger.info({ id, indexSymbol: row.indexSymbol, setupKey: row.setupKey }, "Manual paper FO close");
    const data = ClosePaperPositionFOResponse.parse(toClosedTrade(closed));
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

router.post("/paper/account/topup", requireOwner, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { segment?: string; amount?: number; note?: string };
    const segment = String(body.segment ?? "").toUpperCase();
    if (segment !== "FNO" && segment !== "EQUITY") {
      return res.status(400).json({ error: "segment must be FNO or EQUITY" });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    if (amount > 10_00_00_000) {
      // Sanity cap at ₹10 crore per top-up so a fat-finger keystroke can't
      // distort analytics by orders of magnitude.
      return res.status(400).json({ error: "amount exceeds ₹10,00,00,000 cap" });
    }
    const result = await topupAccount(segment as Segment, amount, {
      note: typeof body.note === "string" ? body.note : null,
      createdBy: "owner",
    });
    if (!result.ok) {
      return res.status(500).json({ error: "Top-up failed" });
    }
    return res.json({ segment, amount, newBalance: result.newBalance });
  } catch (err) {
    return next(err);
  }
});

/**
 * Manual withdrawal of paper cash. Owner-only. Mirrors /paper/account/topup
 * but removes capital. Fail-closed: a withdrawal that exceeds available cash
 * (= balance) is rejected with 400 and the user-facing block message —
 * open-position capital is locked separately and cannot be withdrawn.
 */
router.post("/paper/account/withdraw", requireOwner, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { segment?: string; amount?: number; note?: string };
    const segment = String(body.segment ?? "").toUpperCase();
    if (segment !== "FNO" && segment !== "EQUITY") {
      return res.status(400).json({ error: "segment must be FNO or EQUITY" });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    if (amount > 10_00_00_000) {
      return res.status(400).json({ error: "amount exceeds ₹10,00,00,000 cap" });
    }
    const result = await withdrawAccount(segment as Segment, amount, {
      note: typeof body.note === "string" ? body.note : null,
      createdBy: "owner",
    });
    if (result.blocked) {
      return res.status(400).json({
        error:
          "Withdrawal blocked — exceeds available cash. Open-position capital is already locked separately.",
        newBalance: result.newBalance,
      });
    }
    if (!result.ok) {
      return res.status(500).json({ error: "Withdrawal failed" });
    }
    return res.json({ segment, amount, newBalance: result.newBalance });
  } catch (err) {
    return next(err);
  }
});

router.get("/paper/missed/fo", requireOwner, async (_req, res, next) => {
  try {
    const missed = getMissedSignals().map(m => ({
      signalDate: m.signalDate,
      indexSymbol: m.indexSymbol,
      indexName: m.indexName,
      setupKey: m.setupKey,
      direction: m.direction,
      confidence: m.confidence,
      tier: m.tier,
      status: m.status,
      reason: m.reason,
      skipReason: m.skipReason,
      dataQuality: m.dataQuality,
      optionEntry: m.optionEntry,
      optionStop: m.optionStop,
      optionTarget1: m.optionTarget1,
      optionTarget2: m.optionTarget2,
      observedAt: m.observedAt.toISOString(),
    }));
    return res.json({ missed, generatedAt: new Date().toISOString() });
  } catch (err) {
    return next(err);
  }
});

/**
 * "Why no trade?" terminal-reason diagnostics (2026-05-11).
 *
 * Same source as `/paper/missed/fo` (the in-process MissedSignals ring
 * buffer) but reshaped for at-a-glance debugging:
 *
 *   - `byReason` : count grouped by SkipReason (largest first) so you
 *                  immediately see the dominant terminal reason.
 *   - `byIndex`  : count grouped by indexSymbol so you see whether the
 *                  drought is index-specific (e.g. only BANKNIFTY).
 *   - `byTier`   : split STANDARD vs BASELINE — central question of the
 *                  2026-05-11 fix is "is the BASELINE lane even firing?"
 *   - `recent`   : last 50 raw rows for spot-check.
 *
 * Pure read; no DB I/O; no auth-state mutation; safe to poll. Fail-OPEN
 * on render error (returns empty buckets rather than 500).
 */
router.get("/paper/diagnostics/untriggered/fo", requireOwner, async (_req, res, next) => {
  try {
    const all = getMissedSignals();

    const byReason: Record<string, number> = {};
    const byIndex: Record<string, number> = {};
    const byTier: Record<string, number> = { STANDARD: 0, BASELINE: 0 };
    for (const m of all) {
      const r = m.skipReason ?? "UNKNOWN";
      byReason[r] = (byReason[r] ?? 0) + 1;
      byIndex[m.indexSymbol] = (byIndex[m.indexSymbol] ?? 0) + 1;
      const t = m.tier ?? "STANDARD";
      byTier[t] = (byTier[t] ?? 0) + 1;
    }

    const sortDesc = (rec: Record<string, number>) =>
      Object.entries(rec)
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, count }));

    const recent = all
      .slice(-50)
      .reverse()
      .map(m => ({
        signalDate: m.signalDate,
        indexSymbol: m.indexSymbol,
        setupKey: m.setupKey,
        direction: m.direction,
        confidence: m.confidence,
        tier: m.tier,
        skipReason: m.skipReason,
        observedAt: m.observedAt.toISOString(),
      }));

    return res.json({
      total: all.length,
      byReason: sortDesc(byReason),
      byIndex: sortDesc(byIndex),
      byTier: sortDesc(byTier),
      recent,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Daily summary (2026-05-11.d, reviewer-requested observability).
 *
 * Single-call snapshot the owner can hit each session to answer:
 *   - "Are signals firing?"             → signalsGenerated
 *   - "Are trades opening?"             → tradesOpened
 *   - "Why are they being skipped?"     → skippedByReason
 *   - "What's the open-rate?"           → tradeOpenRate (opened / candidates)
 *   - "How is each lane performing?"    → baselinePnl, hcPnl
 *   - "Any operator-influenced exits?"  → manualOverridesCount
 *   - "How many flat fills (scratches)?"→ scratchesCount
 *   - "Any guardrail-stats outages?"    → alerts.baselineStatsUnavailable
 *
 * `tradeOpenRate = opened / (opened + skipped_today)` where a "candidate"
 * is any signal that reached `openPaperTrade()` (so it produced either a
 * fill or a SkipReason). Pure observational endpoint — no DB writes,
 * no signal-logic mutation, safe to poll. Restricted to today's IST date
 * by design; multi-day analytics belong on `/paper/analytics/fo`.
 *
 * Win-rate vs expectancy semantics (confirmed per reviewer 2026-05-11.d):
 *   - SCRATCH outcomes (filled flat trades) are EXCLUDED from the
 *     win-rate denominator (no signed outcome to score) but INCLUDED
 *     in the filled-trade pool for expectancy. This endpoint exposes
 *     the SCRATCH count directly so the owner can verify the
 *     denominators match the policy in `winRateClassification.ts`.
 */
/**
 * Reports which environment the API process believes it's running in
 * and whether the auto-trader is currently allowed to open new paper
 * trades. Backs the dev/prod banner on `/paper-trading` so the owner
 * never confuses their local Replit preview with the live deployment.
 *
 * Public endpoint (no `requireOwner`) so the banner can render even
 * before the user logs in / on the public read-only mode. Returns no
 * secrets — only an `env` label and a one-line `reason`.
 */
router.get("/paper/diagnostics/environment", (_req, res) => {
  const info = getEnvironmentLabel();
  res.json({
    env: info.env,
    autoTradingEnabled: info.autoTradingEnabled,
    reason: info.reason,
  });
});

/**
 * F&O Signal Reasoning diagnostics (P14, 2026-05-15).
 *
 * Owner-only. Returns the most recent reasoning rows plus histograms
 * (by decision, reason, index, setup, tier, and per-setup stop-out count)
 * for the matching filter set.
 *
 * Filters (all optional, all case-sensitive strings unless noted):
 *   - index | indexSymbol  : exact match on index symbol (NIFTY, BANKNIFTY, SENSEX)
 *   - setup | setupKey     : exact match on setup key (TREND_CONTINUATION, etc.)
 *   - side  | direction    : exact match on direction (BULLISH | BEARISH)
 *   - tier                 : STANDARD | BASELINE | MICRO
 *   - status | decision    : OPENED | SKIPPED | MISSED_WINDOW | CLOSED_*
 *   - reason | reasonCode  : exact match on reason_code (e.g. LIQUIDITY_OI, STOPPED)
 *   - from                 : YYYY-MM-DD signal_date >=
 *   - to                   : YYYY-MM-DD signal_date <=
 *   - limit                : 1..500, default 100
 *
 * Pure read; no DB writes; no signal-logic mutation; safe to poll.
 */
router.get("/paper/diagnostics/fno-reasoning", requireOwner, async (req, res, next) => {
  try {
    const filters = normaliseFilters(req.query as Record<string, unknown>);
    const { rows, histogram, filters: applied } = await queryReasoning(filters);
    return res.json({
      filters: applied,
      total: histogram.total,
      histogram: {
        byDecision: histogram.byDecision,
        byReason: histogram.byReason,
        byIndex: histogram.byIndex,
        bySetup: histogram.bySetup,
        byTier: histogram.byTier,
        byStopReasonSetup: histogram.byStopReason,
      },
      rows: rows.map(r => ({
        id: r.id,
        capturedAt: r.capturedAt.toISOString(),
        signalDate: r.signalDate,
        indexSymbol: r.indexSymbol,
        indexName: r.indexName,
        setupKey: r.setupKey,
        direction: r.direction,
        optionType: r.optionType,
        tier: r.tier,
        decision: r.decision,
        reasonCode: r.reasonCode,
        confidence: r.confidence,
        confluenceScore: r.confluenceScore == null ? null : Number(r.confluenceScore),
        regime: r.regime,
        vix: r.vix == null ? null : Number(r.vix),
        ivr: r.ivr == null ? null : Number(r.ivr),
        ivp: r.ivp == null ? null : Number(r.ivp),
        spot: r.spot == null ? null : Number(r.spot),
        spotEntry: r.spotEntry == null ? null : Number(r.spotEntry),
        spotStop: r.spotStop == null ? null : Number(r.spotStop),
        spotTarget1: r.spotTarget1 == null ? null : Number(r.spotTarget1),
        spotTarget2: r.spotTarget2 == null ? null : Number(r.spotTarget2),
        selectedStrike: r.selectedStrike == null ? null : Number(r.selectedStrike),
        optionEntry: r.optionEntry == null ? null : Number(r.optionEntry),
        optionStop: r.optionStop == null ? null : Number(r.optionStop),
        optionTarget1: r.optionTarget1 == null ? null : Number(r.optionTarget1),
        optionTarget2: r.optionTarget2 == null ? null : Number(r.optionTarget2),
        optionSpreadPct: r.optionSpreadPct == null ? null : Number(r.optionSpreadPct),
        optionOi: r.optionOi,
        optionLtp: r.optionLtp == null ? null : Number(r.optionLtp),
        optionExit: r.optionExit == null ? null : Number(r.optionExit),
        realizedPnl: r.realizedPnl == null ? null : Number(r.realizedPnl),
        lifecycleStatus: r.lifecycleStatus,
        exitReason: r.exitReason,
        dataQuality: r.dataQuality,
        maxLossPct: r.maxLossPct == null ? null : Number(r.maxLossPct),
        lots: r.lots,
        lotSize: r.lotSize,
        snapshot: r.snapshot,
        note: r.note,
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * F&O Reasoning Analytics (P15, 2026-05-17).
 *
 * Owner-only, read-only. Computes setup/index/tier breakdowns plus
 * decision / reason / regime / demotion-tag / missing-data histograms
 * from the `fno_signal_reasoning` rows produced by P14 + P14b loggers.
 *
 * Does NOT change F&O signal generation, gates, sizing, execution,
 * scheduler, Kite, swing, paper-equity, scanner, strategy builder,
 * combo lane, option snapshot ingestion, or candle warehouse ingestion.
 *
 * Filters (all optional): index, setup, direction/side, optionType/option,
 * tier, decision/status, reason/reasonCode, regime, from (YYYY-MM-DD),
 * to (YYYY-MM-DD), latestN/limit (default 2000, max 10000).
 */
router.get("/paper/diagnostics/fno-reasoning/analytics", requireOwner, async (req, res, next) => {
  try {
    const filters = analyticsFiltersFromQuery(req.query as Record<string, unknown>);
    const rows = await fetchReasoningRows(filters);
    const analytics = computeReasoningAnalytics(rows);
    return res.json({
      filters,
      analytics,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * P16 — F&O Failure Diagnosis Report.
 *
 * Owner-only, READ-ONLY. Consumes `fno_signal_reasoning` rows via the
 * existing `fetchReasoningRows` helper. Supports the same filters as
 * the analytics endpoint plus `exactOnly=1` to restrict to rows
 * carrying a `signal_fingerprint`. Returns a structured report with
 * eight sections (A–H) and ten ranked hypotheses, each tagged with a
 * sample size and evidence-status ∈ {proven, likely, insufficient_data,
 * undetermined}. Does NOT change any trading behaviour.
 */
router.get("/paper/analytics/fo/failure-diagnosis", requireOwner, async (req, res, next) => {
  try {
    const filters = analyticsFiltersFromQuery(req.query as Record<string, unknown>);
    const rows = await fetchReasoningRows(filters);
    const report = computeFailureDiagnosis(rows, { exactOnly: filters.exactOnly === true });
    return res.json({ filters, report });
  } catch (err) {
    return next(err);
  }
});

/**
 * P17a — F&O Observability Substrate Health.
 *
 * Owner-only, READ-ONLY. Returns process-local logger counters plus DB
 * roll-ups so the operator can verify that the reasoning substrate is
 * actually capturing rows. Designed to answer in one call:
 *
 *   - Has the logger written anything since boot?
 *   - Are rows landing today by decision (EMITTED / OPENED / SKIPPED / ...)?
 *   - Is the auto-trader gated off (which explains 0 OPENED / SKIPPED)?
 *   - Are skip reasons being persisted (durable fallback in summary)?
 *   - Does `paper_trade_fo.setup_key` look like the real setup key, or
 *     like the tier label?
 *
 * Does NOT touch any signal, gate, sizing, exec, scheduler, Kite,
 * swing, equity, scanner, strategy, combo, snapshot, or candle path.
 */
router.get("/paper/diagnostics/fno-observability", requireOwner, async (_req, res, next) => {
  try {
    const today = istDateOf();
    const loggerHealth = getReasoningLoggerHealth();

    // (1) Decisions today + last row timestamp (durable substrate).
    const decisionRows = (await db.execute(sql`
      SELECT decision, COUNT(*)::int AS n
        FROM fno_signal_reasoning
       WHERE signal_date = ${today}
       GROUP BY decision
    `)) as unknown as { rows: Array<{ decision: string; n: number | string }> };
    const decisionsToday: Record<string, number> = {};
    let rowsToday = 0;
    for (const r of decisionRows.rows) {
      const n = Number(r.n);
      decisionsToday[r.decision] = n;
      rowsToday += n;
    }

    // (2) Total rows + last-seen timestamp (boot-to-now coverage).
    const totalRow = (await db.execute(sql`
      SELECT COUNT(*)::int AS n,
             MAX(captured_at) AS last_captured_at
        FROM fno_signal_reasoning
    `)) as unknown as { rows: Array<{ n: number | string; last_captured_at: string | null }> };
    const totalRows = Number(totalRow.rows[0]?.n ?? 0);
    const lastCapturedAt = totalRow.rows[0]?.last_captured_at ?? null;

    // (3) Upstream vs downstream split today — upstream means the
    // signal-generation orchestrator is firing the batch helper.
    const upstreamToday =
      (decisionsToday["EMITTED"] ?? 0) + (decisionsToday["PRE_EMISSION_REJECTED"] ?? 0);
    const downstreamToday = rowsToday - upstreamToday;

    // (4) Fingerprint coverage for downstream today — proves the P15b
    // exact-correlation feature is working end-to-end.
    const fpRow = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM fno_signal_reasoning
       WHERE signal_date = ${today}
         AND signal_fingerprint IS NOT NULL
    `)) as unknown as { rows: Array<{ n: number | string }> };
    const fingerprintedToday = Number(fpRow.rows[0]?.n ?? 0);

    // (5) Skip-reason capture: durable count for today.
    const skipDurableRow = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM fno_signal_reasoning
       WHERE signal_date = ${today}
         AND decision IN ('SKIPPED','MISSED_WINDOW')
    `)) as unknown as { rows: Array<{ n: number | string }> };
    const skippedReasonsDurableToday = Number(skipDurableRow.rows[0]?.n ?? 0);

    // (6) `setup_key` validity check. The valid set comes from the live
    // OptionSignal detectors. "BASELINE" is also a legitimate setup key
    // (always-on directional outlook in optionSignals.ts:985), so it is
    // not a tier-conflation bug despite sharing the tier label spelling.
    const VALID_SETUP_KEYS = new Set([
      "TREND_CONTINUATION",
      "VWAP_RECLAIM",
      "VOLUME_BREAKOUT",
      "EMA_PULLBACK",
      "MEAN_REVERSION",
      "BASELINE", // legitimate — see optionSignals.ts
    ]);
    const setupKeyRows = (await db.execute(sql`
      SELECT setup_key, COUNT(*)::int AS n
        FROM paper_trade_fo
       GROUP BY setup_key
       ORDER BY n DESC
       LIMIT 50
    `)) as unknown as { rows: Array<{ setup_key: string | null; n: number | string }> };
    const setupKeyDistribution = setupKeyRows.rows.map(r => ({
      setupKey: r.setup_key ?? "(null)",
      count: Number(r.n),
      looksValid: r.setup_key != null && VALID_SETUP_KEYS.has(r.setup_key),
      looksTierLike: r.setup_key === "BASELINE" || r.setup_key === "STANDARD" || r.setup_key === "MICRO",
    }));

    // (7) In-memory missed-signal ring snapshot (best-effort; bounded).
    const ringSnapshot = getMissedSignals();
    const ringToday = ringSnapshot.filter(m => m.signalDate === today).length;

    // (8) Derived health verdict — purely informational.
    const autoTradingEnabled = isPaperAutoTradingEnabled();
    const reasons: string[] = [];
    if (totalRows === 0)
      reasons.push("fno_signal_reasoning is empty — logger has never written");
    if (rowsToday === 0 && totalRows > 0)
      reasons.push("no rows captured today yet");
    if (!autoTradingEnabled)
      reasons.push("paper auto-trader is OFF — OPENED/SKIPPED rows will not appear");
    if (loggerHealth.writesFailed > 0)
      reasons.push(`logger reported ${loggerHealth.writesFailed} write failure(s) since boot`);
    const verdict: "OK" | "WARN" | "FAIL" =
      loggerHealth.writesFailed > 0
        ? "FAIL"
        : totalRows === 0 || rowsToday === 0
          ? "WARN"
          : "OK";

    return res.json({
      verdict,
      reasons,
      today,
      autoTradingEnabled,
      loggerHealth,
      durable: {
        totalRows,
        lastCapturedAt,
        rowsToday,
        decisionsToday,
        upstreamToday,
        downstreamToday,
        fingerprintedToday,
        // Coverage = fingerprinted / downstream rows today. Upstream
        // (EMITTED / PRE_EMISSION_REJECTED) rows never carry a
        // fingerprint by design, so including them in the denominator
        // would understate true correlation health.
        fingerprintCoveragePctToday:
          downstreamToday > 0 ? +((fingerprintedToday / downstreamToday) * 100).toFixed(2) : null,
        skippedReasonsDurableToday,
      },
      missedRing: {
        bufferSize: ringSnapshot.length,
        rowsForToday: ringToday,
      },
      setupKey: {
        knownValidKeys: Array.from(VALID_SETUP_KEYS).sort(),
        distribution: setupKeyDistribution,
        anyUnknown: setupKeyDistribution.some(d => !d.looksValid),
        baselineDetectorCount:
          setupKeyDistribution.find(d => d.setupKey === "BASELINE")?.count ?? 0,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * P17b — Shadow F&O Cost / Slippage / Spread report.
 *
 * Owner-only, READ-ONLY. Computes brokerage / STT / exchange / SEBI /
 * GST / stamp duty / spread / slippage estimates for every CLOSED
 * paper_trade_fo row and groups gross-vs-shadow-net P&L by setup,
 * index, tier, and exit reason. Also lists trades whose gross profit
 * turned into a net loss after estimated costs.
 *
 * IMPORTANT: this surface NEVER feeds back into realised P&L, DD caps,
 * heat caps, circuit breakers, sizing, gates, signal generation,
 * entry, exit, stops, targets, scheduler, Kite, swing, equity,
 * scanner, strategy, combo, snapshot, or candle paths. The feature
 * flag `PAPER_FO_COSTS_SHADOW_ENABLED` only gates this report; when
 * disabled, the endpoint returns the same shape with `enabled=false`
 * so the UI can render a "disabled" state without crashing.
 *
 * Query params (all optional):
 *   - from=YYYY-MM-DD  inclusive lower bound on signal_date
 *   - to=YYYY-MM-DD    inclusive upper bound on signal_date
 *   - topNFlipped      1..50, cap for the flipped-to-loss spotlight list
 */
router.get("/paper/analytics/fo/shadow-costs", requireOwner, async (req, res, next) => {
  try {
    if (!isShadowCostsEnabled()) {
      return res.json({
        enabled: false,
        generatedAt: new Date().toISOString(),
        range: { from: null, to: null },
        rowCount: 0,
        computableCount: 0,
        totals: {
          grossPnl: 0, totalCost: 0, netPnl: 0,
          avgCostPerTrade: 0, avgCostPctOfPremium: null,
          grossWins: 0, grossLosses: 0, netWins: 0, netLosses: 0,
          flippedToLossCount: 0,
        },
        bySetup: [], byIndex: [], byTier: [], byExitReason: [],
        flippedToLossTopN: [],
        parameters: null,
        note: "PAPER_FO_COSTS_SHADOW_ENABLED is disabled — report suppressed.",
      });
    }
    const parseDate = (v: unknown): string | undefined => {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
      return v;
    };
    const parseTopN = (v: unknown): number | undefined => {
      const n = typeof v === "string" ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? Math.min(50, n) : undefined;
    };
    const report = await computeShadowCostReport({
      from: parseDate(req.query.from),
      to: parseDate(req.query.to),
      topNFlipped: parseTopN(req.query.topNFlipped),
    });
    return res.json(report);
  } catch (err) {
    return next(err);
  }
});

/**
 * P20 — Shadow F&O exit-rule simulation (owner-only, read-only).
 *
 * Compares the realised exit on every CLOSED `paper_trade_fo` row against
 * four hypothetical exit-management rules (Rule 1: T1=+30%/T2=+60%; Rule
 * 2/3: book 50% at +30%/+50% then trail to BE; Rule 4: trail to BE after
 * MFE ≥ +50%). Pure projection over existing trade rows. Never writes,
 * never changes any live trading behaviour. Feature flag
 * `PAPER_FO_SHADOW_EXITS_ENABLED` only gates whether this report surfaces
 * values.
 *
 * Query params (all optional):
 *   - from=YYYY-MM-DD  inclusive lower bound on signal_date
 *   - to=YYYY-MM-DD    inclusive upper bound on signal_date
 *   - topN             1..50, cap for improved/reduced spotlight lists
 */
router.get("/paper/analytics/fo/shadow-exits", requireOwner, async (req, res, next) => {
  try {
    if (!isShadowExitsEnabled()) {
      return res.json({
        enabled: false,
        generatedAt: new Date().toISOString(),
        range: { from: null, to: null },
        rowCount: 0,
        mfeAvailableCount: 0,
        lowSampleWarning: true,
        lowSampleThreshold: 20,
        totals: {
          actualPnl: 0,
          rule1Pnl: 0, rule2Pnl: 0, rule3Pnl: 0, rule4Pnl: 0,
          rule1Delta: 0, rule2Delta: 0, rule3Delta: 0, rule4Delta: 0,
          rule1Better: 0, rule1Worse: 0,
          rule2Better: 0, rule2Worse: 0,
          rule3Better: 0, rule3Worse: 0,
          rule4Better: 0, rule4Worse: 0,
          bestRule: null,
          bestRuleDelta: 0,
        },
        bySetup: [], byIndex: [], byTier: [],
        improvedTopN: [], reducedTopN: [],
        parameters: SHADOW_RULE_PARAMS,
        limitations: [],
        note: "PAPER_FO_SHADOW_EXITS_ENABLED is disabled — report suppressed.",
      });
    }
    const parseDate = (v: unknown): string | undefined => {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
      return v;
    };
    const parseTopN = (v: unknown): number | undefined => {
      const n = typeof v === "string" ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? Math.min(50, n) : undefined;
    };
    const report = await computeShadowExitReport({
      from: parseDate(req.query.from),
      to: parseDate(req.query.to),
      topN: parseTopN(req.query.topN),
    });
    return res.json(report);
  } catch (err) {
    return next(err);
  }
});

router.get("/paper/diagnostics/daily-summary/fo", requireOwner, async (req, res, next) => {
  try {
    const today = istDateOf();
    const snap = await computeDailySummaryFo(today);
    // Best-effort persistence on every read so the historical row is
    // continuously refreshed during the session. EOD scheduler still
    // owns the final-of-day write at 15:35 IST. Fire-and-forget; the
    // persister now THROWS on failure (architect-amended 2026-05-11.d
    // so the EOD latch retries correctly), so we explicitly swallow
    // here to keep the live read endpoint fail-OPEN. Wrap with a real
    // logger.warn so the failure is visible without crashing the read.
    persistDailySummaryFo(today).catch(err => {
      req.log?.warn?.(
        { err: (err as Error).message, date: today },
        "live daily-summary upsert failed (read returned anyway)",
      );
    });
    return res.json(snap);
  } catch (err) {
    return next(err);
  }
});

/**
 * Historical daily-summary trail (2026-05-11.d, reviewer-requested).
 * Returns persisted rows from `paper_daily_summary_fo` for the
 * requested IST-date range. Defaults to the trailing 30 days. Read-only.
 *
 * Use this for trend analysis across 10–20 sessions:
 *   tradeOpenRate ↑/↓, top skip reason drift, BASELINE vs HC P&L
 *   divergence, scratches inflation, MO frequency, alert spikes.
 */
router.get("/paper/diagnostics/daily-summary/fo/history", requireOwner, async (req, res, next) => {
  try {
    // Architect-flagged 2026-05-11.d: regex alone allows impossible dates
    // like 2026-99-99. Reject anything Date.parse can't round-trip back
    // to the same YYYY-MM-DD string.
    const isValidIstDate = (s: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
      const t = Date.parse(`${s}T00:00:00Z`);
      if (Number.isNaN(t)) return false;
      return new Date(t).toISOString().slice(0, 10) === s;
    };
    const fromQ = String(req.query.from ?? "").trim();
    const toQ   = String(req.query.to ?? "").trim();
    if (fromQ && !isValidIstDate(fromQ)) return res.status(400).json({ error: "from must be a valid YYYY-MM-DD" });
    if (toQ   && !isValidIstDate(toQ))   return res.status(400).json({ error: "to must be a valid YYYY-MM-DD" });

    const today = istDateOf();
    const to = toQ || today;
    // Default lookback: 30 IST days back from `to`.
    const from = fromQ || (() => {
      const d = new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 29);
      return d.toISOString().slice(0, 10);
    })();

    const rows = await db
      .select()
      .from(paperDailySummaryFoTable)
      .where(
        and(
          gte(paperDailySummaryFoTable.date, from),
          // Drizzle's `lte` on `date` works with YYYY-MM-DD strings.
          sql`${paperDailySummaryFoTable.date} <= ${to}`,
        ),
      )
      .orderBy(desc(paperDailySummaryFoTable.date));

    // Cast numeric columns back to numbers for the JSON response.
    const data = rows.map(r => ({
      date: r.date,
      signalsGenerated: r.signalsGenerated,
      tradesOpened: r.tradesOpened,
      tradesClosed: r.tradesClosed,
      tradesOpenedByTier: { BASELINE: r.baselineOpened, HC: r.hcOpened },
      validCandidates: r.validCandidates,
      tradeOpenRate: r.tradeOpenRate === null ? null : Number(r.tradeOpenRate),
      skipped: { total: r.skippedTotal, byReason: r.skippedByReason },
      pnl: {
        baseline: Number(r.baselinePnl),
        hc: Number(r.hcPnl),
        total: Number(r.totalPnl),
      },
      scratchesCount: r.scratchesCount,
      manualOverridesCount: r.manualOverridesCount,
      alerts: r.alerts,
      capturedAt: r.capturedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return res.json({ from, to, count: data.length, rows: data });
  } catch (err) {
    return next(err);
  }
});

/**
 * P23a — Owner-only MTM Sweep Diagnostics.
 *
 * Owner-only, READ-ONLY. Exposes the process-local counters maintained by
 * `markAllOpenFnoTradesToMarket` (the P22 chain-driven MTM fallback) so
 * P23 live verification can read sweep health directly instead of having
 * to infer it from DB side-effects.
 *
 * This endpoint:
 *   - never triggers an MTM sweep,
 *   - never calls Kite / fetchOptionChain,
 *   - never reads or mutates paper_trade_fo or any other table,
 *   - never enqueues scheduler work,
 *   - simply returns the in-memory snapshot from getMtmSweepHealth().
 *
 * Counters reset on api-server restart (process-local by design — see
 * `paperTradingFO.ts` MtmSweepHealth declaration).
 */
router.get("/paper/diagnostics/fo/mtm-sweep", requireOwner, (_req, res) => {
  res.json(getMtmSweepHealth());
});

/**
 * F&O Exit Safety Observability — owner-only read-only roll-up.
 *
 * Aggregates the four existing in-process exit-safety health snapshots into
 * one payload so tomorrow's live validation is a single GET:
 *
 *   - premiumOverlay  → getPremiumOverlayHealth()   (premium hard-stop backstop)
 *   - orphanExit      → getOrphanExitSweepHealth()  (P0 orphaned-OPEN spot-exit)
 *   - mtmSweep        → getMtmSweepHealth()          (all-open MTM refresh)
 *   - timeExit1520    → getTimeExit1520Health()      (15:20 IST force-exit)
 *
 * Pure passthrough of the in-memory counters — does NOT trigger any sweep,
 * query Kite, touch the DB, or mutate trading state. Owner-gated like every
 * other `/paper/diagnostics/*` route. All counters are process-local and
 * reset on api-server restart (see each *Health declaration). `generatedAt`
 * is the read timestamp, NOT a sweep timestamp.
 */
router.get("/paper/diagnostics/fo/exit-safety", requireOwner, (_req, res) => {
  res.json({
    generatedAt: new Date().toISOString(),
    premiumOverlay: getPremiumOverlayHealth(),
    orphanExit: getOrphanExitSweepHealth(),
    mtmSweep: getMtmSweepHealth(),
    timeExit1520: getTimeExit1520Health(),
  });
});

/**
 * F&O Exit Monitoring Reliability (T005) — owner-only status roll-up.
 *
 * Merges the NEW `fnoExitMonitorHealth` scheduler-summary counters (T004)
 * alongside the four pre-existing exit-safety snapshots above and the
 * canonical global-data-health gate state, so a single GET answers
 * "is the exit monitor healthy AND is the underlying data trade-grade
 * right now". Pure passthrough/orchestration — does NOT trigger any sweep,
 * query Kite, touch the DB, or mutate trading state.
 *
 * NOTE: intentionally NOT registered in `lib/api-spec/openapi.yaml` —
 * matches the established convention for this entire family of owner-only
 * `/paper/diagnostics/fo/*` routes (exit-safety, mtm-sweep, fno-observability
 * etc.) and other owner-only diagnostics surfaces (`/api/option-snapshots/analytics`,
 * `/api/candles/diagnostics`, `/api/paper/eq/sizing-preview`) — none of which
 * are in the OpenAPI spec today; the frontend fetches them directly rather
 * than via generated hooks.
 */
router.get("/paper/diagnostics/fo/exit-monitor/status", requireOwner, async (_req, res, next) => {
  try {
    const globalDataHealth = await buildGlobalDataHealth();
    res.json({
      generatedAt: new Date().toISOString(),
      exitMonitor: getFnoExitMonitorHealth(),
      premiumOverlay: getPremiumOverlayHealth(),
      orphanExit: getOrphanExitSweepHealth(),
      mtmSweep: getMtmSweepHealth(),
      timeExit1520: getTimeExit1520Health(),
      globalDataHealth,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * F&O Exit Monitoring Reliability (T005) — owner-only dry-run evaluation.
 *
 * Evaluates ONE open F&O paper trade's exit eligibility via
 * `evaluateSingleFnoTradeExit` (same trust/freshness gate as the live
 * scheduler) with ZERO DB writes and ZERO Telegram side effects — a pure
 * read used to answer "what WOULD the monitor do right now" without
 * touching anything.
 */
router.post("/paper/diagnostics/fo/exit-monitor/run-dry", requireOwner, async (req, res, next) => {
  try {
    const id = String((req.body as { id?: unknown } | undefined)?.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "id (paper_trade_fo row id) is required" });
      return;
    }
    const result = await evaluateSingleFnoTradeExit(id);
    res.json({ generatedAt: new Date().toISOString(), ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * F&O Exit Monitoring Reliability (T005) — owner-only manual exit trigger.
 *
 * Re-evaluates the trade via the SAME `evaluateSingleFnoTradeExit` gate used
 * by run-dry (never a separate/looser check), audit-stamps the check via
 * `recordFnoExitCheck` either way, and ONLY when the decision is a
 * trade-grade `EXIT` does it call the existing `closePaperTradeForSignal`
 * CAS close path (no second close implementation) — which itself sends the
 * canonical Telegram exit alert after commit. A HOLD/BLOCKED decision is
 * never forced closed; a NOT_FOUND/NOT_OPEN/LIFECYCLE_NOT_FOUND/NO_FRESH_SPOT
 * evaluation status is surfaced as-is with no mutation.
 */
/**
 * `LifecycleExitReason` (optionSignalLifecycle.ts, the lifecycle-row exit
 * taxonomy) has three EXPIRED variants (EXPIRED_TRIGGERED / EXPIRED_PENDING /
 * STALE_TRIGGER) that `CloseReason` (paperTradingFO.ts, the paper-trade
 * settlement taxonomy) deliberately collapses to a single "EXPIRED" —
 * matching the existing collapse in `reconcileOrphanedPaperTrades`. TARGET1/
 * TARGET2/STOPPED pass through unchanged (identical labels in both enums).
 */
function toCloseReason(exitReason: LifecycleExitReason) {
  if (exitReason === "TARGET1_HIT") return "TARGET1_HIT" as const;
  if (exitReason === "TARGET2_HIT") return "TARGET2_HIT" as const;
  if (exitReason === "STOPPED") return "STOPPED" as const;
  return "EXPIRED" as const;
}

router.post("/paper/diagnostics/fo/exit-monitor/run-now", requireOwner, async (req, res, next) => {
  try {
    const id = String((req.body as { id?: unknown } | undefined)?.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "id (paper_trade_fo row id) is required" });
      return;
    }
    const evalResult = await evaluateSingleFnoTradeExit(id);
    if (evalResult.status !== "EVALUATED" || !evalResult.trade || !evalResult.decision) {
      const statusCode = evalResult.status === "NOT_FOUND" ? 404 : 409;
      res.status(statusCode).json({ generatedAt: new Date().toISOString(), ...evalResult });
      return;
    }
    const { trade, decision } = evalResult;
    await recordFnoExitCheck({ id: trade.id }, decision).catch((auditErr) => {
      req.log.warn(
        { err: (auditErr as Error).message, id: trade.id },
        "run-now: exit-monitor audit stamp failed (non-fatal)",
      );
    });

    if (decision.kind !== "EXIT") {
      res.json({
        generatedAt: new Date().toISOString(),
        closed: false,
        trade,
        decision,
      });
      return;
    }

    const closed = await closePaperTradeForSignal(
      trade.signalDate,
      trade.indexSymbol,
      trade.setupKey,
      trade.direction,
      toCloseReason(decision.exitReason),
    );
    if (!closed) {
      res.status(409).json({
        generatedAt: new Date().toISOString(),
        closed: false,
        trade,
        decision,
        note: "trade was already closed by a concurrent process before this request completed",
      });
      return;
    }
    res.json({
      generatedAt: new Date().toISOString(),
      closed: true,
      trade: closed,
      decision,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/paper/analytics/fo", requireOwner, async (req, res, next) => {
  try {
    const from = String(req.query.from ?? "").trim() || undefined;
    const to = String(req.query.to ?? "").trim() || undefined;
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (from && !re.test(from)) {
      return res.status(400).json({ error: "from must be YYYY-MM-DD" });
    }
    if (to && !re.test(to)) {
      return res.status(400).json({ error: "to must be YYYY-MM-DD" });
    }
    const data = await getFoAnalytics({ from, to });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

router.get("/paper/reports/fo/monthly", requireOwner, async (req, res, next) => {
  try {
    const month = String(req.query.month ?? "").trim();
    const m = month.match(/^(\d{4})-(\d{2})$/);
    if (!m) {
      return res.status(400).json({ error: "month required as YYYY-MM" });
    }
    const mm = Number(m[2]);
    if (mm < 1 || mm > 12) {
      return res.status(400).json({ error: "month component must be 01-12" });
    }
    const report = await getMonthlyReport(month);
    const data = GetPaperReportFoMonthlyResponse.parse(report);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

router.get("/paper/reports/fo/yearly", requireOwner, async (req, res, next) => {
  try {
    const fy = String(req.query.fy ?? "").trim();
    const m = fy.match(/^(\d{4})-(\d{4})$/);
    if (!m) {
      return res.status(400).json({ error: "fy required as YYYY-YYYY" });
    }
    if (Number(m[2]) !== Number(m[1]) + 1) {
      return res.status(400).json({ error: "fy years must be consecutive (eg 2026-2027)" });
    }
    const report = await getYearlyReport(fy);
    const data = GetPaperReportFoYearlyResponse.parse(report);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

// ─── EQUITY paper-trading routes ────────────────────────────────────────

function toEqOpenPosition(r: PaperTradeEqRow, prevClose?: number) {
  const entry = num(r.entryPrice);
  const last = num(r.lastPrice);
  const upnl = (last - entry) * r.qty;
  const capital = num(r.capitalDeployed);
  const upnlPct = capital > 0 ? (upnl / capital) * 100 : 0;
  let dayPnl: number | undefined;
  let dayPnlPct: number | undefined;
  if (prevClose != null && prevClose > 0) {
    dayPnl = (last - prevClose) * r.qty;
    dayPnlPct = ((last - prevClose) / prevClose) * 100;
  }
  return {
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    exchange: r.exchange,
    signalDate: r.signalDate,
    signalTriggeredAt: r.signalTriggeredAt.toISOString(),
    qty: r.qty,
    entryPrice: entry,
    stopPrice: num(r.stopPrice),
    target1Price: num(r.target1Price),
    target2Price: num(r.target2Price),
    trailedToT1: (r.trailedToT1 ?? 0) > 0,
    capitalDeployed: capital,
    lastPrice: last,
    prevClose,
    unrealizedPnl: upnl,
    unrealizedPnlPct: +upnlPct.toFixed(2),
    dayPnl,
    dayPnlPct: dayPnlPct != null ? +dayPnlPct.toFixed(2) : undefined,
    maxRunup: num(r.maxRunup),
    maxDrawdown: num(r.maxDrawdown),
    openedAt: r.openedAt.toISOString(),
    lastEvaluatedAt: r.lastEvaluatedAt.toISOString(),
    status: "OPEN" as const,
    source: r.source ?? null,
    stagedOrderId: r.stagedOrderId ?? null,
  };
}

function toEqClosedTrade(r: PaperTradeEqRow) {
  return {
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    exchange: r.exchange,
    signalDate: r.signalDate,
    qty: r.qty,
    entryPrice: num(r.entryPrice),
    exitPrice: num(r.exitPrice),
    capitalDeployed: num(r.capitalDeployed),
    realizedPnl: num(r.realizedPnl),
    exitReason: (r.exitReason ?? "MANUAL_OVERRIDE") as
      | "TARGET2_HIT"
      | "STOPPED"
      | "TRAIL_STOP_HIT"
      | "TIME_STOP"
      | "SIGNAL_FLIP"
      | "MANUAL_OVERRIDE",
    openedAt: r.openedAt.toISOString(),
    exitedAt: (r.exitedAt ?? r.openedAt).toISOString(),
    journal: r.journal ?? null,
    tags: r.tags ?? [],
    source: r.source ?? null,
    stagedOrderId: r.stagedOrderId ?? null,
  };
}

/**
 * IST-day [00:00, 24:00) bounds expressed as UTC Date objects, suitable
 * for indexing exited_at (which is stored as UTC timestamp).
 */
function istDayUtcRange(istDateKey: string): { start: Date; end: Date } {
  const m = istDateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid IST date key: ${istDateKey}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // IST midnight = 18:30 UTC of the previous day
  const start = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

router.get("/paper/positions/eq", requireOwner, async (_req, res, next) => {
  try {
    await ensureDailyReset("EQUITY");
    const rows = await db
      .select()
      .from(paperTradeEqTable)
      .where(eq(paperTradeEqTable.status, "OPEN"))
      .orderBy(desc(paperTradeEqTable.openedAt));
    const { rows: scanRows } = getAllScannedRows();
    const prevCloseMap = new Map<string, number>();
    for (const sr of scanRows) {
      if (sr.quote?.previousClose > 0) {
        prevCloseMap.set(sr.symbol, sr.quote.previousClose);
      }
    }
    const data = GetPaperPositionsEqResponse.parse({
      positions: rows.map(r => toEqOpenPosition(r, prevCloseMap.get(r.symbol))),
      generatedAt: new Date().toISOString(),
    });
    // P0.2-correction-4: augment each position with backend-derived session
    // provenance so the frontend can render provenance badges without any
    // client-side calendar logic. These fields are NOT in the generated Zod
    // schema (no codegen for display-only fields) so they are spread after
    // the parse. `rows[i]` is safe here — parse preserves the insertion order.
    return res.json({
      ...data,
      positions: data.positions.map((p, i) => ({
        ...p,
        ...classifyStoredTimestamp(rows[i]!.openedAt.toISOString()),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/paper/trades/eq", requireOwner, async (req, res, next) => {
  try {
    await ensureDailyReset("EQUITY");
    const date = String(req.query.date ?? "").trim() || istDateKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }
    // Equity positions can be held for many days, so we must bucket by
    // exitedAt (the day the trade was actually closed) rather than by
    // signalDate as the F&O book does.
    const { start, end } = istDayUtcRange(date);
    const rows = await db
      .select()
      .from(paperTradeEqTable)
      .where(
        and(
          eq(paperTradeEqTable.status, "CLOSED"),
          gte(paperTradeEqTable.exitedAt, start),
          lt(paperTradeEqTable.exitedAt, end),
        ),
      )
      .orderBy(desc(paperTradeEqTable.exitedAt));
    const data = GetPaperTradesEqResponse.parse({
      date,
      trades: rows.map(toEqClosedTrade),
      generatedAt: new Date().toISOString(),
    });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

router.post("/paper/positions/eq/manual", requireOwner, async (req, res, next) => {
  try {
    await ensureDailyReset("EQUITY");
    const body = (req.body ?? {}) as { symbol?: unknown; qty?: unknown };
    const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    const qtyRaw = body.qty;
    let qty: number | undefined;
    if (qtyRaw != null && qtyRaw !== "") {
      const n = Number(qtyRaw);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        return res.status(400).json({ error: "qty must be a positive integer" });
      }
      qty = n;
    }
    const { rows: scanRows } = getAllScannedRows();
    const row = scanRows.find(r => r.symbol === symbol);
    if (!row) {
      return res.status(404).json({
        error: `Symbol ${symbol} not found in current scanner cache. Wait for the next scan or check the spelling.`,
      });
    }
    // P0.2-correction-1: session gate applies to ALL sources including MANUAL.
    // Check here (before the durable writer) so the UI gets a structured,
    // actionable 422 instead of a generic 409 from the writer's null return.
    const sessionCheck = computeEquitySessionAdmission(new Date());
    if (!sessionCheck.allowed) {
      return res.status(422).json({
        error: `Equity paper buy rejected — market session gate (${sessionCheck.reason}): ${sessionCheck.detail}`,
        sessionRejection: {
          reason: sessionCheck.reason,
          detail: sessionCheck.detail,
          openedSessionValidity: sessionCheck.openedSessionValidity,
          calendarVersion: sessionCheck.calendarVersion,
        },
      });
    }
    const result = await openManualPaperEquityTrade(row, { qty });
    if (!result.row) {
      return res.status(409).json({ error: result.reason ?? "Trade rejected" });
    }
    logger.info({ symbol, id: result.row.id, qty: result.row.qty }, "Manual paper EQ buy");
    return res.json({
      id: result.row.id,
      symbol: result.row.symbol,
      qty: result.row.qty,
      entryPrice: num(result.row.entryPrice),
      stopPrice: num(result.row.stopPrice),
      target1Price: num(result.row.target1Price),
      target2Price: num(result.row.target2Price),
      capitalDeployed: num(result.row.capitalDeployed),
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/paper/positions/eq/:id/close", requireOwner, async (req, res, next) => {
  try {
    await ensureDailyReset("EQUITY");
    const id = String(req.params.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "id required" });
    const rows = await db
      .select()
      .from(paperTradeEqTable)
      .where(eq(paperTradeEqTable.id, id))
      .limit(1);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const row = rows[0]!;
    if (row.status !== "OPEN") {
      return res.status(409).json({ error: "Position is not OPEN" });
    }
    const closed = await forceClosePaperEquityTrade(id);
    if (!closed) {
      // Lost the race against an evaluator tick that closed it concurrently.
      const fresh = await db
        .select()
        .from(paperTradeEqTable)
        .where(eq(paperTradeEqTable.id, id))
        .limit(1);
      if (fresh.length === 0 || fresh[0]!.status !== "CLOSED") {
        return res.status(409).json({ error: "Concurrent close lost the race" });
      }
      const data = ClosePaperPositionEqResponse.parse(toEqClosedTrade(fresh[0]!));
      return res.json(data);
    }
    logger.info({ id, symbol: row.symbol }, "Manual paper EQ close");
    const data = ClosePaperPositionEqResponse.parse(toEqClosedTrade(closed));
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

router.get("/paper/reports/eq/monthly", requireOwner, async (req, res, next) => {
  try {
    const month = String(req.query.month ?? "").trim();
    const m = month.match(/^(\d{4})-(\d{2})$/);
    if (!m) {
      return res.status(400).json({ error: "month required as YYYY-MM" });
    }
    const mm = Number(m[2]);
    if (mm < 1 || mm > 12) {
      return res.status(400).json({ error: "month component must be 01-12" });
    }
    const report = await getEqMonthlyReport(month);
    const data = GetPaperReportEqMonthlyResponse.parse(report);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

router.get("/paper/reports/eq/yearly", requireOwner, async (req, res, next) => {
  try {
    const fy = String(req.query.fy ?? "").trim();
    const m = fy.match(/^(\d{4})-(\d{4})$/);
    if (!m) {
      return res.status(400).json({ error: "fy required as YYYY-YYYY" });
    }
    if (Number(m[2]) !== Number(m[1]) + 1) {
      return res.status(400).json({ error: "fy years must be consecutive (eg 2026-2027)" });
    }
    const report = await getEqYearlyReport(fy);
    const data = GetPaperReportEqYearlyResponse.parse(report);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

router.patch("/paper/trades/fo/:id/journal", requireOwner, async (req, res, next) => {
  try {
    const id = String(req.params.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "id required" });
    const body = req.body as { journal?: string | null; tags?: string[] | null };
    const updates: Record<string, unknown> = {};
    if ("journal" in body) updates.journal = body.journal ?? null;
    if ("tags" in body) updates.tags = body.tags ?? null;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Nothing to update — send journal and/or tags" });
    }
    const rows = await db
      .update(paperTradeFoTable)
      .set(updates)
      .where(eq(paperTradeFoTable.id, id))
      .returning();
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const r = rows[0]!;
    return res.json({
      id: r.id,
      journal: r.journal ?? null,
      tags: r.tags ?? [],
    });
  } catch (err) {
    return next(err);
  }
});

router.patch("/paper/trades/eq/:id/journal", requireOwner, async (req, res, next) => {
  try {
    const id = String(req.params.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "id required" });
    const body = req.body as { journal?: string | null; tags?: string[] | null };
    const updates: Record<string, unknown> = {};
    if ("journal" in body) updates.journal = body.journal ?? null;
    if ("tags" in body) updates.tags = body.tags ?? null;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Nothing to update — send journal and/or tags" });
    }
    const rows = await db
      .update(paperTradeEqTable)
      .set(updates)
      .where(eq(paperTradeEqTable.id, id))
      .returning();
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const r = rows[0]!;
    return res.json({
      id: r.id,
      journal: r.journal ?? null,
      tags: r.tags ?? [],
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/paper/journal-analytics", requireOwner, async (req, res, next) => {
  try {
    const segment = String(req.query.segment ?? "FNO").toUpperCase();
    if (segment !== "FNO" && segment !== "EQUITY") {
      return res.status(400).json({ error: "segment must be FNO or EQUITY" });
    }
    const data = await getJournalAnalytics(segment as "FNO" | "EQUITY");
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

/**
 * Owner-only equity audit trail. Each row records one auto/manual
 * decision (OPEN or SKIP) with the gate that fired and the snapshot
 * that drove it. Lets the user see *why* a STRONG_BUY didn't trade.
 */
router.get("/paper/audit/eq", requireOwner, async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 100);
    const rows = await listEqAudit(Number.isFinite(limit) ? limit : 100);
    return res.json({ items: rows, generatedAt: new Date().toISOString() });
  } catch (err) {
    return next(err);
  }
});

router.get("/paper/audit/eq/summary", requireOwner, async (req, res, next) => {
  try {
    const hours = Number(req.query.hours ?? 24);
    const rows = await summarizeEqAudit(Number.isFinite(hours) ? hours : 24);
    return res.json({ items: rows, hours, generatedAt: new Date().toISOString() });
  } catch (err) {
    return next(err);
  }
});

/**
 * Live event feed for UI toasts. Long-poll-friendly: client passes its
 * last-seen `since` id, server returns every event with a higher id +
 * the new latest id for the next poll.
 */
router.get("/paper/events/eq", requireOwner, (req, res) => {
  const since = Number(req.query.since ?? 0);
  const safeSince = Number.isFinite(since) && since >= 0 ? since : 0;
  const { events, latestId } = getEqEventsSince(safeSince);
  return res.json({ events, latestId, generatedAt: new Date().toISOString() });
});

/**
 * Lifecycle diagnostic — "why does this symbol look the way it does".
 *
 * Owner-only, read-only. Pulls every table that can explain how (or
 * whether) a symbol became an equity paper trade:
 *   - paper_trade_eq   — the trade row(s) themselves, incl. `source`/
 *                         `stagedOrderId` (Checkpoint 2 provenance).
 *   - paper_eq_audit   — every OPEN/SKIP decision, incl. `paperTradeId`
 *                         link-back for OPEN rows.
 *   - swing_order_staging — the separate, currently-unconnected Swing
 *                         Queue approval pipeline (never opens a paper
 *                         trade today — see replit.md Checkpoint 2 notes).
 *   - notification_delivery_log (domain=SWING_CASH) — Telegram delivery
 *                         history for this symbol, if any.
 *
 * Built to answer exactly the class of question the Phase-0 audit asked
 * of INDUSINDBK/RELIANCE: "was this AUTO, MANUAL, or from the swing
 * queue, and did it ever actually become a trade?" — without needing a
 * one-off DB query each time.
 */
router.get("/paper/lifecycle/:symbol", requireOwner, async (req, res, next) => {
  try {
    const raw = String(req.params.symbol ?? "");
    if (!/^[A-Z0-9&-]{1,20}$/i.test(raw)) {
      return res.status(400).json({ error: "Invalid symbol format" });
    }
    const symbol = raw.toUpperCase();

    const [trades, auditRows, stagingOrders, notifications] = await Promise.all([
      db
        .select()
        .from(paperTradeEqTable)
        .where(eq(paperTradeEqTable.symbol, symbol))
        .orderBy(desc(paperTradeEqTable.openedAt)),
      db
        .select()
        .from(paperEqAuditTable)
        .where(eq(paperEqAuditTable.symbol, symbol))
        .orderBy(desc(paperEqAuditTable.ts))
        .limit(100),
      db
        .select()
        .from(swingOrderStagingTable)
        .where(eq(swingOrderStagingTable.symbol, symbol))
        .orderBy(desc(swingOrderStagingTable.createdAt)),
      (async () => {
        try {
          const result = await db.execute(sql`
            SELECT id, event_type, order_id, paper_trade_id, destination,
                   status, error_code, sent_at, created_at
            FROM notification_delivery_log
            WHERE domain = 'SWING_CASH' AND symbol = ${symbol}
            ORDER BY created_at DESC
            LIMIT 50
          `);
          return result.rows;
        } catch (err) {
          logger.warn(
            { err: (err as Error).message, symbol },
            "paper/lifecycle: notification_delivery_log lookup failed (fail-open)",
          );
          return [];
        }
      })(),
    ]);

    const summary = computeLifecycleSummary({
      trades,
      auditRowCount: auditRows.length,
      stagingOrders,
      notificationCount: notifications.length,
    });

    return res.json({
      symbol,
      paperTrades: trades,
      auditRows,
      stagingOrders,
      notifications,
      summary,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return next(err);
  }
});

// ── F-37: Swing regression baseline ───────────────────────────────────────
router.get("/paper/swing-regression", requireOwner, async (_req, res, next) => {
  try {
    const { checkSwingRegressionBaseline } = await import("../lib/swingRegressionGate");
    const result = await checkSwingRegressionBaseline();
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

void sql;

export default router;
