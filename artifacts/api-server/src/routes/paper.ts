/**
 * Paper trading HTTP routes — owner-only.
 *
 * MTM (mark-to-market) for OPEN positions is read straight from
 * paper_trade_fo.last_premium, which is updated on every option-signal
 * lifecycle evaluation by the F&O paper-trading hook. We do NOT fetch
 * fresh quotes here — that would multiply load on Kite/NSE without
 * adding any data the lifecycle path doesn't already capture.
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
  FNO_RISK,
  EQUITY_RISK,
  type Segment,
} from "../lib/paperAccount";
import { closePaperTradeForSignal } from "../lib/paperTradingFO";
import { getMonthlyReport, getYearlyReport } from "../lib/paperReportsFO";
import {
  getMonthlyReport as getEqMonthlyReport,
  getYearlyReport as getEqYearlyReport,
} from "../lib/paperReportsEq";
import { forceClosePaperEquityTrade } from "../lib/paperTradingEq";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

function istDateKey(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function toOpenPosition(r: PaperTradeFoRow) {
  const entry = num(r.entryPremium);
  const last = num(r.lastPremium);
  const upnl = (last - entry) * r.lots * r.lotSize;
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
    lastEvaluatedAt: r.lastEvaluatedAt.toISOString(),
    status: "OPEN" as const,
  };
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
    const data = GetPaperAccountResponse.parse({
      segment,
      seedCapital: num(acct.seedCapital),
      balance: num(acct.balance),
      dayRealizedPnl: num(acct.dayRealizedPnl),
      dayOpenCount: acct.dayOpenCount,
      dayTradeCount: acct.dayTradeCount,
      lastResetDate: acct.lastResetDate ?? istDateKey(),
      dailyTradeCap,
      maxLossPctPerTrade,
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
    const data = GetPaperPositionsFOResponse.parse({
      positions: rows.map(toOpenPosition),
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

function toEqOpenPosition(r: PaperTradeEqRow) {
  const entry = num(r.entryPrice);
  const last = num(r.lastPrice);
  const upnl = (last - entry) * r.qty;
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
    capitalDeployed: num(r.capitalDeployed),
    lastPrice: last,
    unrealizedPnl: upnl,
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
    const data = GetPaperPositionsEqResponse.parse({
      positions: rows.map(toEqOpenPosition),
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

// `sql` is imported so future raw bound-query helpers can land here
// without re-touching the import block. Suppress unused-vars on it.
void sql;

export default router;
