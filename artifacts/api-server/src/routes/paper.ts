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
} from "@workspace/api-zod";
import {
  db,
  paperTradeFoTable,
} from "@workspace/db";
import type { PaperTradeFoRow } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireOwner } from "../lib/userAuth";
import {
  ensureDailyReset,
  FNO_RISK,
  type Segment,
} from "../lib/paperAccount";
import { closePaperTradeForSignal } from "../lib/paperTradingFO";
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
    const data = GetPaperAccountResponse.parse({
      segment,
      seedCapital: num(acct.seedCapital),
      balance: num(acct.balance),
      dayRealizedPnl: num(acct.dayRealizedPnl),
      dayOpenCount: acct.dayOpenCount,
      dayTradeCount: acct.dayTradeCount,
      lastResetDate: acct.lastResetDate ?? istDateKey(),
      dailyTradeCap: segment === "FNO" ? FNO_RISK.MAX_TRADES_PER_DAY : 0,
      maxLossPctPerTrade: segment === "FNO" ? FNO_RISK.MAX_LOSS_PCT_PER_TRADE : 0,
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

export default router;
