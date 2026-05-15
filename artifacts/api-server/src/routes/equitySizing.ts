/**
 * Owner-only equity sizing diagnostic surface (Priority 5).
 *
 *   GET  /api/paper/eq/sizing-preview?symbol=&entry=&stop=  — single-shot
 *                                                            preview
 *   GET  /api/paper/eq/candidates-diagnostic                — pulls today's
 *                                                            STRONG_BUY
 *                                                            swing-scan
 *                                                            candidates and
 *                                                            previews each.
 *
 * Read-only. Pure helper output. Does NOT touch paper_account, paper_trade_eq,
 * the audit log, or any signal/order path.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getSession } from "../lib/userAuth";
import { isPublicAccessEnabled } from "../lib/publicAccess";
import {
  ensureDailyReset,
  getEqDailyRealizedDrawdown,
  getEqWeeklyRealizedDrawdown,
  getEqMonthlyRealizedDrawdown,
} from "../lib/paperAccount";
import {
  computeEquitySizingPreview,
  type EquitySizingInput,
  type EquitySizingResult,
} from "../lib/equitySizingHelper";

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

interface AccountSnapshot {
  balance: number;
  bookValue: number;
  openCount: number;
  dayTradeCount: number;
  currentHeat: number;
  ddDailyCapReached: boolean;
  ddWeeklyCapReached: boolean;
  ddMonthlyCapReached: boolean;
  ddDailyPct: number;
  ddWeeklyPct: number;
  ddMonthlyPct: number;
  observedAt: string;
}

/**
 * Read-only snapshot of the EQUITY paper account. Mirrors the
 * fields `openPaperEquityTrade` reads inside its FOR-UPDATE txn —
 * but we read OUTSIDE any lock because this is a preview, not a
 * gate. Race with concurrent opens is acceptable: the preview's
 * verdict can drift between snapshot and an immediate live open,
 * which is exactly what we want to surface.
 *
 * Calls `ensureDailyReset("EQUITY")` first so day_trade_count and
 * day_open_count are aligned with the live path's view (handles the
 * first-request-after-IST-rollover case).
 */
async function readEquitySnapshot(): Promise<AccountSnapshot | null> {
  await ensureDailyReset("EQUITY");

  const acct = (await db.execute(sql`
    SELECT balance, day_trade_count, day_open_count
    FROM paper_account
    WHERE segment = 'EQUITY'
    LIMIT 1;
  `)) as unknown as {
    rows: Array<{ balance: string | number; day_trade_count: number; day_open_count: number }>;
  };
  if (acct.rows.length === 0) return null;
  const a = acct.rows[0]!;

  const heat = (await db.execute(sql`
    SELECT
      COALESCE(SUM(capital_deployed), 0) AS book_value,
      COALESCE(SUM(qty * GREATEST(entry_price - stop_price, 0)), 0) AS heat
    FROM paper_trade_eq
    WHERE status = 'OPEN';
  `)) as unknown as {
    rows: Array<{ book_value: string | number; heat: string | number }>;
  };
  const h = heat.rows[0]!;

  const num = (v: string | number): number => (typeof v === "number" ? v : parseFloat(v));

  // DD-cap parity with live path. Sticky-once-hit latches live in
  // paperAccount; we just read them. Reading is cheap and idempotent.
  const [ddDaily, ddWeekly, ddMonthly] = await Promise.all([
    getEqDailyRealizedDrawdown(),
    getEqWeeklyRealizedDrawdown(),
    getEqMonthlyRealizedDrawdown(),
  ]);

  return {
    balance: num(a.balance),
    bookValue: num(h.book_value),
    openCount: a.day_open_count,
    dayTradeCount: a.day_trade_count,
    currentHeat: num(h.heat),
    ddDailyCapReached: ddDaily.capReached,
    ddWeeklyCapReached: ddWeekly.capReached,
    ddMonthlyCapReached: ddMonthly.capReached,
    ddDailyPct: ddDaily.drawdownPct,
    ddWeeklyPct: ddWeekly.drawdownPct,
    ddMonthlyPct: ddMonthly.drawdownPct,
    observedAt: new Date().toISOString(),
  };
}

router.get("/paper/eq/sizing-preview", strictOwner, async (req, res, next) => {
  try {
    const symbol = String(req.query["symbol"] ?? "").trim().toUpperCase();
    const entry = Number(req.query["entry"]);
    const stop = Number(req.query["stop"]);
    if (!symbol) {
      res.status(400).json({ error: "missing_symbol" });
      return;
    }
    if (!Number.isFinite(entry) || !Number.isFinite(stop)) {
      res.status(400).json({ error: "missing_or_invalid_prices", hint: "Pass numeric entry= and stop= query params" });
      return;
    }

    const snap = await readEquitySnapshot();
    if (!snap) {
      res.status(409).json({ error: "no_equity_account", hint: "Seed the EQUITY paper account first" });
      return;
    }

    const input: EquitySizingInput = {
      symbol, entry, stop,
      balance: snap.balance,
      bookValue: snap.bookValue,
      openCount: snap.openCount,
      dayTradeCount: snap.dayTradeCount,
      currentHeat: snap.currentHeat,
      ddDailyCapReached: snap.ddDailyCapReached,
      ddWeeklyCapReached: snap.ddWeeklyCapReached,
      ddMonthlyCapReached: snap.ddMonthlyCapReached,
      ddDailyPct: snap.ddDailyPct,
      ddWeeklyPct: snap.ddWeeklyPct,
      ddMonthlyPct: snap.ddMonthlyPct,
    };
    const result = computeEquitySizingPreview(input);

    res.json({
      generatedAt: new Date().toISOString(),
      input: { symbol, entry, stop },
      accountSnapshot: snap,
      preview: result,
      // Spelled-out warning so a UI can render it verbatim. We never
      // want a consumer to mistake this for a guaranteed live outcome.
      disclaimer: "Read-only preview. Mirrors openPaperEquityTrade gates exactly but does NOT place an order or reserve capital. Live verdict may differ if concurrent opens / close fire between this snapshot and the actual open.",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Batch preview over the latest swing-scan STRONG_BUY candidates.
 * Pulls the most recent stocks-to-watch run and feeds each candidate
 * through the helper so the owner can see, at a glance, which
 * candidates would actually open and which would be rejected (and why).
 */
router.get("/paper/eq/candidates-diagnostic", strictOwner, async (_req, res, next) => {
  try {
    const snap = await readEquitySnapshot();
    if (!snap) {
      res.status(409).json({ error: "no_equity_account" });
      return;
    }

    // Pull the top-scored "actionable" swing-scan candidates from the
    // latest scan date — i.e. anything except AVOID/NO TRADE that has
    // a locked entry + stop_loss. Note: the swing-scan `action` column
    // uses {WATCHLIST, WAIT FOR CONFIRMATION, WAIT FOR PULLBACK,
    // AVOID / NO TRADE} — there is no literal STRONG_BUY value here
    // (STRONG_BUY is a downstream label produced by `fullNseScanner`
    // when an actionable WATCHLIST row also clears the trade-trigger).
    // The helper's gate sequence will tell us which of these would
    // actually open against today's account state.
    const candidatesRaw = (await db.execute(sql`
      WITH latest AS (
        SELECT MAX(scan_date) AS d FROM swing_scan_result
      )
      SELECT symbol, action, score, entry, stop_loss, target1, target2
      FROM swing_scan_result, latest
      WHERE scan_date = latest.d
        AND action <> 'AVOID / NO TRADE'
        AND entry IS NOT NULL
        AND stop_loss IS NOT NULL
      ORDER BY score DESC NULLS LAST
      LIMIT 50;
    `)) as unknown as {
      rows: Array<Record<string, unknown>>;
    };

    const num = (v: unknown): number =>
      typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;

    type RowOut = {
      symbol: string;
      action: string | null;
      score: number | null;
      entry: number;
      stop: number;
      preview: EquitySizingResult;
    };
    const previews: RowOut[] = [];
    for (const r of candidatesRaw.rows) {
      const symbol = String(r["symbol"] ?? "");
      const entry = num(r["entry"]);
      const stop = num(r["stop_loss"]);
      if (!symbol || !Number.isFinite(entry) || !Number.isFinite(stop)) continue;
      const preview = computeEquitySizingPreview({
        symbol, entry, stop,
        balance: snap.balance,
        bookValue: snap.bookValue,
        openCount: snap.openCount,
        dayTradeCount: snap.dayTradeCount,
        currentHeat: snap.currentHeat,
        ddDailyCapReached: snap.ddDailyCapReached,
        ddWeeklyCapReached: snap.ddWeeklyCapReached,
        ddMonthlyCapReached: snap.ddMonthlyCapReached,
        ddDailyPct: snap.ddDailyPct,
        ddWeeklyPct: snap.ddWeeklyPct,
        ddMonthlyPct: snap.ddMonthlyPct,
      });
      const scoreVal = num(r["score"]);
      previews.push({
        symbol,
        action: (r["action"] as string | null) ?? null,
        score: Number.isFinite(scoreVal) ? scoreVal : null,
        entry, stop,
        preview,
      });
    }

    // Aggregate: how many would accept vs reject, and reason histogram.
    const accepted = previews.filter((p) => p.preview.verdict === "ACCEPT").length;
    const reasonHistogram: Record<string, number> = {};
    for (const p of previews) {
      const k = p.preview.reason ?? "ACCEPT";
      reasonHistogram[k] = (reasonHistogram[k] ?? 0) + 1;
    }

    res.json({
      generatedAt: new Date().toISOString(),
      accountSnapshot: snap,
      candidatesEvaluated: previews.length,
      acceptedCount: accepted,
      reasonHistogram,
      candidates: previews,
      disclaimer: "Read-only preview over the latest swing-scan STRONG_BUY candidates. Reflects helper math only; does not place orders.",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
