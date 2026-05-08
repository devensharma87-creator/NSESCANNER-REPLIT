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
} from "@workspace/db";
import type { PaperTradeFoRow, PaperTradeEqRow } from "@workspace/db";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { requireOwner } from "../lib/userAuth";
import {
  ensureDailyReset,
  topupAccount,
  FNO_RISK,
  EQUITY_RISK,
  getDailyRealizedDrawdown,
  getWeeklyRealizedDrawdown,
  type Segment,
} from "../lib/paperAccount";
import { closePaperTradeForSignal, getMissedSignals } from "../lib/paperTradingFO";
import { fetchOptionChain } from "../lib/optionChain";
import { getFoAnalytics } from "../lib/paperAnalyticsFO";
import { getMonthlyReport, getYearlyReport } from "../lib/paperReportsFO";
import {
  getMonthlyReport as getEqMonthlyReport,
  getYearlyReport as getEqYearlyReport,
} from "../lib/paperReportsEq";
import { forceClosePaperEquityTrade, openManualPaperEquityTrade } from "../lib/paperTradingEq";
import { listEqAudit, summarizeEqAudit, getEqEventsSince } from "../lib/paperEqAudit";
import { getAllScannedRows } from "../lib/fullNseScanner";
import { logger } from "../lib/logger";
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

function toOpenPosition(r: PaperTradeFoRow, liveLtp?: number | null) {
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

function toClosedTrade(r: PaperTradeFoRow) {
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
      | "MANUAL_OVERRIDE",
    openedAt: r.openedAt.toISOString(),
    exitedAt: (r.exitedAt ?? r.openedAt).toISOString(),
    journal: r.journal ?? null,
    tags: r.tags ?? [],
  };
}

router.get("/paper/account", requireOwner, async (req, res, next) => {
  try {
    const segment = String(req.query.segment ?? "").toUpperCase();
    if (segment !== "FNO" && segment !== "EQUITY") {
      return res.status(400).json({ error: "segment must be FNO or EQUITY" });
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
    const data = GetPaperPositionsFOResponse.parse({
      positions: rows.map((r) => toOpenPosition(r, liveLtps.get(r.id))),
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
    const data = GetPaperTradesFOResponse.parse({
      date,
      trades: rows.map(toClosedTrade),
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
    const body = (req.body ?? {}) as { segment?: string; amount?: number };
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
    const result = await topupAccount(segment as Segment, amount);
    if (!result.ok) {
      return res.status(500).json({ error: "Top-up failed" });
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
    return res.json(data);
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

void sql;

export default router;
