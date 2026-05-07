/**
 * Equity (delivery) paper trading executor.
 *
 * Sits as a side-effect hook on top of the fullNseScanner. It does NOT
 * generate signals or fetch market data — it translates SwingSignal
 * events into virtual broker actions and re-evaluates OPEN positions
 * against the latest LTP from the scanner cache:
 *
 *   STRONG_BUY (in F&O 200) ⇒ open one paper buy at the locked LTP
 *   ltp ≥ T2                ⇒ close at T2  (TARGET2_HIT)
 *   ltp ≤ stop              ⇒ close at stop (STOPPED, or TRAIL_STOP_HIT
 *                              once the stop has been trailed up to T1)
 *   ltp ≥ T1 (first time)   ⇒ trail stop to T1, do NOT exit
 *   30 trading days held    ⇒ close at LTP (TIME_STOP)
 *   STRONG_SELL on symbol   ⇒ close at LTP (SIGNAL_FLIP)
 *
 * Position sizing: per_position = account_value / max(BASE_SLOTS,
 * open_count + 1); deploy = min(per_position, available_cash); qty =
 * floor(deploy / entryPrice). Hard caps: ≤ MAX_CONCURRENT open at a
 * time, ≤ MAX_NEW_PER_DAY new entries per IST day.
 *
 * Concurrency:
 *   - The unique index on (symbol, signalDate) in paper_trade_eq
 *     prevents the same scanner tick from opening two trades for the
 *     same stock on the same IST day, even under parallel calls.
 *   - The transaction starts with SELECT … FOR UPDATE on the EQUITY
 *     account row, so the day-cap and balance checks are serialised.
 *   - All exits run as CAS updates (status='OPEN' → status='CLOSED')
 *     so a re-evaluator firing twice cannot double-credit.
 */
import {
  db,
  paperAccountTable,
  paperTradeEqTable,
} from "@workspace/db";
import type { PaperTradeEqRow } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  ensureDailyReset,
  EQUITY_DD_CAPS,
  EQUITY_RISK,
  EQUITY_STOP_SANITY,
  getEqDailyRealizedDrawdown,
  getEqMonthlyRealizedDrawdown,
  getEqWeeklyRealizedDrawdown,
} from "./paperAccount";
import { logger } from "./logger";
import type { SwingSignal } from "./swingSignals";
import type { StockRow } from "@workspace/api-zod";

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

function toDbNumeric(n: number, scale = 4): string {
  return Number.isFinite(n) ? n.toFixed(scale) : "0";
}

function istDateKey(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type EquityExitReason =
  | "TARGET2_HIT"
  | "STOPPED"
  | "TRAIL_STOP_HIT"
  | "TIME_STOP"
  | "SIGNAL_FLIP"
  | "MANUAL_OVERRIDE";

/**
 * Try to open a paper equity trade for the given SwingSignal. Returns
 * the inserted row on success, or null with a logged reason on every
 * kind of skip (cap, sizing, balance, duplicate).
 *
 * Single transaction:
 *   SELECT FOR UPDATE on the EQUITY account row
 *   → re-check day-trade cap and concurrent-open cap
 *   → INSERT (with ON CONFLICT DO NOTHING on the symbol+day index)
 *   → conditional UPDATE that debits cash and bumps day counters,
 *     re-asserting cap predicates as defence-in-depth.
 *
 * Idempotent on (symbol, signalDate) — a second call short-circuits
 * to the existing row without re-debiting.
 */
export async function openPaperEquityTrade(
  signal: SwingSignal,
): Promise<PaperTradeEqRow | null> {
  const today = signal.signalDate;

  // Pre-check (lock-free): if a row already exists for this symbol+day,
  // bail out before grabbing the account lock.
  const existing = await db
    .select()
    .from(paperTradeEqTable)
    .where(
      and(
        eq(paperTradeEqTable.symbol, signal.symbol),
        eq(paperTradeEqTable.signalDate, today),
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0]!;

  if (!(signal.entryPrice > 0)) {
    logger.info({ symbol: signal.symbol, entry: signal.entryPrice }, "Paper EQ skip: invalid entry");
    return null;
  }
  if (!(signal.perShareRisk > 0)) {
    logger.info({ symbol: signal.symbol, risk: signal.perShareRisk }, "Paper EQ skip: invalid risk");
    return null;
  }

  // ─── Pass-1 stop-loss sanity gate ──────────────────────────────────
  // perShareRisk = entryPrice - stopPrice for LONG swings. Reject if
  // the implied stop-distance pct is absurdly tight (noise zone) or
  // absurdly wide (scanner geometry bug — risk per share is unbounded).
  const stopPct = signal.perShareRisk / signal.entryPrice;
  if (stopPct < EQUITY_STOP_SANITY.MIN_STOP_PCT || stopPct > EQUITY_STOP_SANITY.MAX_STOP_PCT) {
    logger.info(
      {
        symbol: signal.symbol,
        entry: signal.entryPrice,
        stop: signal.stopPrice,
        stopPct: +stopPct.toFixed(4),
        floor: EQUITY_STOP_SANITY.MIN_STOP_PCT,
        ceiling: EQUITY_STOP_SANITY.MAX_STOP_PCT,
      },
      "Paper EQ skip: stop-loss outside sanity bounds (1%–8%)",
    );
    return null;
  }

  // ─── Pass-1 portfolio drawdown caps (D / W / M) ────────────────────
  // Sticky-once-hit. Daily 2% / Weekly 4% / Monthly 8% of seed.
  const [eqDaily, eqWeekly, eqMonthly] = await Promise.all([
    getEqDailyRealizedDrawdown(),
    getEqWeeklyRealizedDrawdown(),
    getEqMonthlyRealizedDrawdown(),
  ]);
  if (eqDaily.capReached) {
    logger.info(
      { symbol: signal.symbol, drawdownPct: +eqDaily.drawdownPct.toFixed(4),
        capPct: EQUITY_DD_CAPS.MAX_DAILY_LOSS_PCT },
      "Paper EQ skip: daily DD cap reached (sticky)",
    );
    return null;
  }
  if (eqWeekly.capReached) {
    logger.info(
      { symbol: signal.symbol, drawdownPct: +eqWeekly.drawdownPct.toFixed(4),
        capPct: EQUITY_DD_CAPS.MAX_WEEKLY_LOSS_PCT },
      "Paper EQ skip: weekly DD cap reached (sticky)",
    );
    return null;
  }
  if (eqMonthly.capReached) {
    logger.info(
      { symbol: signal.symbol, drawdownPct: +eqMonthly.drawdownPct.toFixed(4),
        capPct: EQUITY_DD_CAPS.MAX_MONTHLY_LOSS_PCT },
      "Paper EQ skip: monthly DD cap reached (sticky)",
    );
    return null;
  }

  await ensureDailyReset("EQUITY");

  let openedRow: PaperTradeEqRow | null = null;
  try {
    openedRow = await db.transaction(async (tx) => {
      // Lock the EQUITY account row — every concurrent equity open
      // queues here.
      const acctRows = await tx.execute(sql`
        SELECT segment, balance, day_trade_count, day_open_count
          FROM paper_account
         WHERE segment = 'EQUITY'
         FOR UPDATE
      `);
      const rs = (acctRows as unknown as {
        rows: Array<{
          balance: string | number;
          day_trade_count: number;
          day_open_count: number;
        }>;
      }).rows;
      if (rs.length === 0) {
        logger.warn({ symbol: signal.symbol }, "Paper EQ skip: no EQUITY account row (seed missing)");
        return null;
      }
      const balance = num(rs[0]!.balance);
      const dayCount = rs[0]!.day_trade_count;
      const openCount = rs[0]!.day_open_count;

      if (dayCount >= EQUITY_RISK.MAX_NEW_PER_DAY) {
        logger.info(
          { symbol: signal.symbol, dayCount },
          "Paper EQ skip: daily new-entry cap reached",
        );
        return null;
      }
      if (openCount >= EQUITY_RISK.MAX_CONCURRENT) {
        logger.info(
          { symbol: signal.symbol, openCount },
          "Paper EQ skip: concurrent-open cap reached",
        );
        return null;
      }

      // Account value = cash balance + book value of OPEN positions.
      // We compute book value as Σ(qty × entryPrice) — i.e. capital
      // deployed at entry, which is also exactly what was debited from
      // balance. This means (balance + bookValue) is invariant of
      // unrealised P&L, so position sizing is always reproducible
      // from cash alone and never grows just because open positions
      // happened to run up.
      const bookRows = await tx.execute(sql`
        SELECT COALESCE(SUM(capital_deployed), 0) AS book_value
          FROM paper_trade_eq
         WHERE status = 'OPEN'
      `);
      const bookValue = num(
        (bookRows as unknown as { rows: Array<{ book_value: string | number }> }).rows[0]
          ?.book_value,
      );
      const accountValue = balance + bookValue;

      // per_position = account_value / max(BASE_SLOTS, open_count + 1)
      // — reserves room for the position we're about to open.
      const slots = Math.max(EQUITY_RISK.BASE_SLOTS, openCount + 1);
      const perPosition = accountValue / slots;
      const deploy = Math.min(perPosition, balance);
      if (!(deploy > 0)) {
        logger.info(
          { symbol: signal.symbol, accountValue, balance, slots },
          "Paper EQ skip: deploy <= 0 (no capital available)",
        );
        return null;
      }
      const qty = Math.floor(deploy / signal.entryPrice);
      if (qty < 1) {
        // Surface the depleted-account case explicitly. When deploy is
        // tiny (a few rupees) the issue is almost never "price too high"
        // — it's that the EQ account balance was drained by losing
        // trades / never seeded. Logging accountValue + balance here
        // makes that obvious without having to query the DB.
        const accountDepleted = accountValue < signal.entryPrice;
        logger.info(
          {
            symbol: signal.symbol,
            deploy: +deploy.toFixed(2),
            entry: signal.entryPrice,
            balance: +balance.toFixed(2),
            accountValue: +accountValue.toFixed(2),
            slots,
            hint: accountDepleted
              ? "EQ account is depleted relative to entry price — top up via /api/paper/topup or wait for daily reset"
              : "perPosition allocation < 1 share at this entry; consider widening BASE_SLOTS or trimming open count",
          },
          "Paper EQ skip: qty < 1 (capital per slot insufficient for entry price)",
        );
        return null;
      }
      const capitalDeployed = qty * signal.entryPrice;
      if (balance < capitalDeployed) {
        logger.info(
          { symbol: signal.symbol, capitalDeployed, balance },
          "Paper EQ skip: insufficient balance after rounding",
        );
        return null;
      }

      const now = signal.triggeredAt;
      const inserted = await tx
        .insert(paperTradeEqTable)
        .values({
          symbol: signal.symbol,
          name: signal.name,
          exchange: signal.exchange,
          signalDate: today,
          signalTriggeredAt: now,
          qty,
          entryPrice: toDbNumeric(signal.entryPrice, 4),
          stopPrice: toDbNumeric(signal.stopPrice, 4),
          target1Price: toDbNumeric(signal.target1Price, 4),
          target2Price: toDbNumeric(signal.target2Price, 4),
          trailedToT1: 0,
          capitalDeployed: toDbNumeric(capitalDeployed, 2),
          lastPrice: toDbNumeric(signal.entryPrice, 4),
          lastEvaluatedAt: now,
          openedAt: now,
          status: "OPEN",
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        logger.info({ symbol: signal.symbol }, "Paper EQ skip: trade row already exists for symbol+day");
        return null;
      }

      // Atomic debit + counter bumps. Cap predicates repeated as
      // defence-in-depth even though the FOR UPDATE above already
      // serialised us — keeps the invariants enforced even if a
      // future caller bypasses the lock.
      const debited = await tx
        .update(paperAccountTable)
        .set({
          balance: sql`${paperAccountTable.balance} - ${toDbNumeric(capitalDeployed, 2)}::numeric`,
          dayTradeCount: sql`${paperAccountTable.dayTradeCount} + 1`,
          dayOpenCount: sql`${paperAccountTable.dayOpenCount} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(paperAccountTable.segment, "EQUITY"),
            sql`${paperAccountTable.balance} >= ${toDbNumeric(capitalDeployed, 2)}::numeric`,
            sql`${paperAccountTable.dayTradeCount} < ${EQUITY_RISK.MAX_NEW_PER_DAY}`,
            sql`${paperAccountTable.dayOpenCount} < ${EQUITY_RISK.MAX_CONCURRENT}`,
          ),
        )
        .returning();
      if (debited.length === 0) {
        throw new Error("paper_eq_open_aborted_cap_or_balance");
      }

      logger.info(
        {
          symbol: signal.symbol,
          qty,
          entry: signal.entryPrice,
          stop: signal.stopPrice,
          t1: signal.target1Price,
          t2: signal.target2Price,
          capitalDeployed: capitalDeployed.toFixed(2),
          newBalance: num(debited[0]!.balance),
          score: signal.score,
        },
        "Paper EQ OPENED",
      );
      return inserted[0]!;
    });
  } catch (err) {
    if ((err as Error).message === "paper_eq_open_aborted_cap_or_balance") {
      logger.info(
        { symbol: signal.symbol },
        "Paper EQ skip: txn aborted (cap/balance lost the race)",
      );
      return null;
    }
    throw err;
  }
  return openedRow;
}

/**
 * Close a paper equity trade. CAS on status='OPEN' protects against
 * a second evaluator firing on the same row. Inside one transaction:
 *   - flip the row to CLOSED with exit fields populated
 *   - credit the proceeds back to the EQUITY balance
 *   - decrement day_open_count (clamped at 0)
 *   - accumulate day_realized_pnl
 */
async function closePaperEquityTradeRow(
  row: PaperTradeEqRow,
  exitPrice: number,
  reason: EquityExitReason,
  now: Date,
): Promise<PaperTradeEqRow | null> {
  if (!(exitPrice > 0)) {
    logger.warn({ id: row.id, exitPrice, reason }, "Paper EQ close: refusing non-positive exit price");
    return null;
  }
  const proceeds = exitPrice * row.qty;
  const realizedPnl = (exitPrice - num(row.entryPrice)) * row.qty;

  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(paperTradeEqTable)
      .set({
        status: "CLOSED",
        exitedAt: now,
        exitPrice: toDbNumeric(exitPrice, 4),
        exitReason: reason,
        realizedPnl: toDbNumeric(realizedPnl, 2),
        lastPrice: toDbNumeric(exitPrice, 4),
        lastEvaluatedAt: now,
      })
      .where(and(eq(paperTradeEqTable.id, row.id), eq(paperTradeEqTable.status, "OPEN")))
      .returning();
    if (updated.length === 0) return null;
    await tx
      .update(paperAccountTable)
      .set({
        balance: sql`${paperAccountTable.balance} + ${toDbNumeric(proceeds, 2)}::numeric`,
        dayRealizedPnl: sql`${paperAccountTable.dayRealizedPnl} + ${toDbNumeric(realizedPnl, 2)}::numeric`,
        dayOpenCount: sql`GREATEST(${paperAccountTable.dayOpenCount} - 1, 0)`,
        updatedAt: now,
      })
      .where(eq(paperAccountTable.segment, "EQUITY"));
    logger.info(
      {
        id: row.id,
        symbol: row.symbol,
        reason,
        qty: row.qty,
        entry: num(row.entryPrice),
        exit: exitPrice,
        realizedPnl: realizedPnl.toFixed(2),
      },
      "Paper EQ CLOSED",
    );
    return updated[0]!;
  });
}

/**
 * Manual exit from the UI. Closes at the row's lastPrice (the most
 * recent LTP we marked the row to), so the trader sees the same number
 * shown in their open-positions view at the moment they clicked.
 */
export async function forceClosePaperEquityTrade(id: string): Promise<PaperTradeEqRow | null> {
  const rows = await db
    .select()
    .from(paperTradeEqTable)
    .where(and(eq(paperTradeEqTable.id, id), eq(paperTradeEqTable.status, "OPEN")))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return await closePaperEquityTradeRow(
    row,
    num(row.lastPrice) || num(row.entryPrice),
    "MANUAL_OVERRIDE",
    new Date(),
  );
}

/**
 * Count IST trading days (Mon–Fri) STRICTLY BETWEEN the open date and
 * the now date, exclusive of the open date itself, inclusive of the
 * now date if it is a weekday. Ignores exchange holidays — the user's
 * 30-day time-stop is loose enough that a 1–2 day drift never changes
 * the decision in practice.
 *
 * Implementation walks IST CALENDAR DAY KEYS (not 24h epoch buckets),
 * so a position opened at 09:30 IST and evaluated at 10:00 IST the
 * next weekday counts as exactly 1 trading day held — never 2 — even
 * after the 24h boundary trips. This was an off-by-one in the prior
 * implementation that could prematurely fire TIME_STOP.
 */
function tradingDaysBetween(open: Date, now: Date): number {
  const istKey = (d: Date) =>
    new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const openKey = istKey(open);
  const nowKey = istKey(now);
  if (nowKey <= openKey) return 0;
  // Walk IST calendar days from openKey+1 up to and including nowKey.
  let count = 0;
  // Anchor at noon UTC on the open IST day to avoid DST/midnight edge
  // cases when stepping in 24h increments.
  const [oy, om, od] = openKey.split("-").map(Number);
  let cursor = Date.UTC(oy!, om! - 1, od!, 12, 0, 0);
  // Step day-by-day, stopping once we've passed nowKey.
  while (true) {
    cursor += 24 * 60 * 60 * 1000;
    const cursorKey = new Date(cursor).toISOString().slice(0, 10);
    if (cursorKey > nowKey) break;
    // Mon–Fri only. UTC day on a noon-anchored cursor matches IST day.
    const dow = new Date(cursor).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/**
 * Mark-to-market and apply exit rules for one open row against the
 * latest scanner snapshot for its symbol. Returns the row's terminal
 * state (or the unchanged row when nothing happens).
 */
async function evaluateOne(
  row: PaperTradeEqRow,
  scannerRow: StockRow | null,
  now: Date,
): Promise<void> {
  // No fresh price → fall back to time-stop check only. Refuse to
  // invent a price.
  const ltp = scannerRow?.quote?.price;
  const stop = num(row.stopPrice);
  const t1 = num(row.target1Price);
  const t2 = num(row.target2Price);
  const entry = num(row.entryPrice);
  const trailedToT1 = (row.trailedToT1 ?? 0) > 0;

  // ── 1. SIGNAL_FLIP exit (works even if LTP is missing — the scanner
  //       at least gave us a recommendation).
  if (scannerRow && scannerRow.recommendation.signal === "STRONG_SELL") {
    const exit = ltp != null && ltp > 0 ? ltp : num(row.lastPrice) || entry;
    await closePaperEquityTradeRow(row, exit, "SIGNAL_FLIP", now);
    return;
  }

  if (ltp != null && ltp > 0) {
    // Update MTM + max runup/drawdown FIRST so the close path always
    // reads from the freshest stored levels. CAS on status='OPEN'
    // means a concurrent close still wins cleanly.
    const upnl = (ltp - entry) * row.qty;
    await db
      .update(paperTradeEqTable)
      .set({
        lastPrice: toDbNumeric(ltp, 4),
        lastEvaluatedAt: now,
        maxRunup: sql`GREATEST(${paperTradeEqTable.maxRunup}, ${toDbNumeric(upnl, 2)}::numeric)`,
        maxDrawdown: sql`LEAST(${paperTradeEqTable.maxDrawdown}, ${toDbNumeric(upnl, 2)}::numeric)`,
      })
      .where(and(eq(paperTradeEqTable.id, row.id), eq(paperTradeEqTable.status, "OPEN")));

    // ── 2. T2 hit — full exit.
    if (ltp >= t2) {
      await closePaperEquityTradeRow(row, t2, "TARGET2_HIT", now);
      return;
    }
    // ── 3. Stop hit (use the trailed stop if applicable).
    if (ltp <= stop) {
      const reason: EquityExitReason = trailedToT1 ? "TRAIL_STOP_HIT" : "STOPPED";
      await closePaperEquityTradeRow(row, stop, reason, now);
      return;
    }
    // ── 4. T1 hit and not yet trailed — trail the stop UP to T1.
    //       No partial exit per user spec; ride the rest for T2.
    if (!trailedToT1 && ltp >= t1) {
      const trailRes = await db
        .update(paperTradeEqTable)
        .set({
          trailedToT1: 1,
          stopPrice: toDbNumeric(t1, 4),
          lastEvaluatedAt: now,
        })
        .where(
          and(
            eq(paperTradeEqTable.id, row.id),
            eq(paperTradeEqTable.status, "OPEN"),
            eq(paperTradeEqTable.trailedToT1, 0),
          ),
        )
        .returning();
      if (trailRes.length > 0) {
        logger.info(
          { id: row.id, symbol: row.symbol, ltp, t1, newStop: t1 },
          "Paper EQ trailed stop to T1",
        );
      }
    }
  }

  // ── 5. Time stop — close at the freshest price we have.
  const days = tradingDaysBetween(row.openedAt, now);
  if (days >= EQUITY_RISK.MAX_HOLD_TRADING_DAYS) {
    const exit = ltp != null && ltp > 0 ? ltp : num(row.lastPrice) || entry;
    await closePaperEquityTradeRow(row, exit, "TIME_STOP", now);
  }
}

/**
 * Re-evaluate every OPEN equity paper trade against the latest
 * scanner snapshot. Called after each fullNseScanner refresh by the
 * background loop.
 */
export async function evaluatePaperEquityTrades(
  scannerRows: readonly StockRow[],
): Promise<void> {
  const open = await db
    .select()
    .from(paperTradeEqTable)
    .where(eq(paperTradeEqTable.status, "OPEN"));
  if (open.length === 0) return;
  const bySymbol = new Map<string, StockRow>();
  for (const r of scannerRows) bySymbol.set(r.symbol, r);
  const now = new Date();
  for (const row of open) {
    try {
      await evaluateOne(row, bySymbol.get(row.symbol) ?? null, now);
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, id: row.id, symbol: row.symbol },
        "Paper EQ evaluator failed for one row, continuing",
      );
    }
  }
}

/**
 * Full per-tick lifecycle: open new positions for fresh STRONG_BUY
 * SwingSignals, then mark-to-market and apply exit rules across every
 * existing OPEN position. Both phases are quiet on per-row failure so
 * one bad symbol never poisons the cycle.
 */
export async function runEquityPaperTradingTick(
  scannerRows: readonly StockRow[],
  signals: readonly SwingSignal[],
): Promise<void> {
  // Open new trades first so they participate in this same tick's
  // evaluator pass (cheap because the new row's LTP is by definition
  // its entry → no immediate exit unless ATR was zero, which we
  // already rejected upstream).
  for (const s of signals) {
    try {
      await openPaperEquityTrade(s);
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, symbol: s.symbol },
        "Paper EQ open failed for one signal, continuing",
      );
    }
  }
  await evaluatePaperEquityTrades(scannerRows);
}

/** True when the symbol currently has an OPEN equity paper trade. */
export async function hasOpenEquityTrade(symbol: string): Promise<boolean> {
  const rows = await db
    .select({ id: paperTradeEqTable.id })
    .from(paperTradeEqTable)
    .where(
      and(
        eq(paperTradeEqTable.symbol, symbol),
        eq(paperTradeEqTable.status, "OPEN"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// `ne`/`istDateKey` re-exported for the routes layer's manual exits.
export { ne, istDateKey };
