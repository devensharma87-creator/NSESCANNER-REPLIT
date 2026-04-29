/**
 * F&O paper trading executor.
 *
 * Sits as a side-effect hook on top of the existing option signal
 * lifecycle. It does NOT generate signals or fetch market data — it
 * only translates lifecycle transitions into virtual broker actions:
 *
 *   PENDING -> TRIGGERED  ⇒  open a paper position (1 row in paper_trade_fo)
 *   TRIGGERED -> STOPPED  ⇒  close at locked stop premium
 *   ANY      -> TARGET2_HIT  ⇒  close at locked T2 premium
 *   sweep at 15:30 IST ⇒  close at the row's appropriate premium
 *
 * Position sizing is risk-driven (max 2% loss per trade), not lot-fixed,
 * so the more dangerous a setup is the smaller the position. Combined
 * with the 4-trades-per-day cap and a 70-confidence floor, the goal is
 * to make the paper account behave the way a disciplined retail trader
 * would, not a YOLO scalper.
 *
 * Concurrency: the unique index on
 * (signalDate, indexSymbol, setupKey, direction) in paper_trade_fo
 * guarantees we cannot open two trades for the same signal even if the
 * lifecycle hook fires twice in parallel — the second insert just hits
 * `ON CONFLICT DO NOTHING` and we refund the (never-actually-debited)
 * balance.
 */
import {
  db,
  paperAccountTable,
  paperTradeFoTable,
} from "@workspace/db";
import type { PaperTradeFoRow } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { OptionSignal } from "@workspace/api-zod";
import { ensureDailyReset, FNO_RISK } from "./paperAccount";
import { LOT_SIZES } from "./optionChain";
import { logger } from "./logger";

type LifecycleStatus =
  | "PENDING"
  | "TRIGGERED"
  | "TARGET1_HIT"
  | "TARGET2_HIT"
  | "STOPPED"
  | "EXPIRED";

const PAST_TRIGGER: LifecycleStatus[] = [
  "TRIGGERED",
  "TARGET1_HIT",
  "TARGET2_HIT",
  "STOPPED",
];

export interface LifecycleHookInput {
  /** Status BEFORE this evaluation (null = brand-new row). */
  prev: LifecycleStatus | null;
  /** Status AFTER this evaluation. */
  next: LifecycleStatus;
  /** True when the lifecycle just wrote a non-null exitedAt for this row. */
  exited: boolean;
  /** The full signal we're tracking. */
  signal: OptionSignal;
  /** IST date string this signal lives under. */
  signalDate: string;
  /** Direction stored on the lifecycle row (BULLISH | BEARISH). */
  direction: "BULLISH" | "BEARISH";
}

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

function toDbNumeric(n: number, scale = 4): string {
  return Number.isFinite(n) ? n.toFixed(scale) : "0";
}

function lotSizeFor(indexSymbol: string): number | null {
  const ls = LOT_SIZES[indexSymbol.toUpperCase()];
  return ls && ls > 0 ? ls : null;
}

/**
 * Try to open a paper trade. Returns the row on success, or null with
 * a logged reason on every kind of failure (cap, sizing, balance, etc.).
 *
 * Single DB transaction — daily cap check, balance debit, trade insert
 * and counter bumps all commit together or none of them do. This is the
 * fix for two real-world races the architect surfaced:
 *
 *   1) Two concurrent triggers both pass the "dayTradeCount < 4" pre-check
 *      and both insert, taking the cap to 5. With the conditional UPDATE
 *      below, only one transaction can satisfy `dayTradeCount < cap` at a
 *      time, so the second one rolls back.
 *
 *   2) Money debited but trade insert errors mid-way. Without a tx the
 *      ledger silently leaks balance forever. With the tx, ANY failure
 *      after BEGIN rolls everything back.
 *
 * Idempotent on the (signalDate, indexSymbol, setupKey, direction) key —
 * a second call short-circuits to the existing row without re-debiting.
 */
async function openPaperTrade(input: LifecycleHookInput): Promise<PaperTradeFoRow | null> {
  const { signal, signalDate, direction } = input;
  const indexSymbol = signal.index;
  const setupKey = signal.setupKey;
  if (!setupKey) return null;

  // Pre-checks that do NOT touch the account.
  const confidence = Math.round(signal.confidence ?? 0);
  if (confidence < FNO_RISK.MIN_CONFIDENCE) {
    logger.info(
      { indexSymbol, setupKey, confidence, floor: FNO_RISK.MIN_CONFIDENCE },
      `Paper FO skip: confidence < ${FNO_RISK.MIN_CONFIDENCE}`,
    );
    return null;
  }
  const lotSize = lotSizeFor(indexSymbol);
  if (!lotSize) {
    logger.info({ indexSymbol }, "Paper FO skip: unknown lot size");
    return null;
  }

  // Existing-row short-circuit (idempotency, lock-free).
  const existing = await db
    .select()
    .from(paperTradeFoTable)
    .where(
      and(
        eq(paperTradeFoTable.signalDate, signalDate),
        eq(paperTradeFoTable.indexSymbol, indexSymbol),
        eq(paperTradeFoTable.setupKey, setupKey),
        eq(paperTradeFoTable.direction, direction),
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0]!;

  // Validate premium plan.
  const optionEntry = signal.optionEntry ?? signal.optionLtp ?? 0;
  const optionStop = signal.optionStopLoss ?? 0;
  const optionT1 = signal.optionTarget1 ?? optionEntry;
  const optionT2 = signal.optionTarget2 ?? optionT1;
  const perShareLoss = optionEntry - optionStop;
  if (!(optionEntry > 0) || !(perShareLoss > 0)) {
    logger.info(
      { indexSymbol, setupKey, optionEntry, optionStop },
      "Paper FO skip: invalid premium plan",
    );
    return null;
  }

  // Make sure the account row exists and has been refilled if a new
  // IST day rolled over since the last access.
  await ensureDailyReset("FNO");

  let openedRow: PaperTradeFoRow | null = null;
  try {
    openedRow = await db.transaction(async (tx) => {
      // SELECT ... FOR UPDATE on the account row serialises every
      // concurrent open for this segment — anything that mutates the
      // F&O account today must queue behind this lock.
      const acctRows = await tx.execute(sql`
        SELECT segment, balance, day_trade_count
          FROM paper_account
         WHERE segment = 'FNO'
         FOR UPDATE
      `);
      const rs = (acctRows as unknown as {
        rows: Array<{ balance: string | number; day_trade_count: number }>;
      }).rows;
      if (rs.length === 0) return null;
      const balance = num(rs[0]!.balance);
      const dayCount = rs[0]!.day_trade_count;

      if (dayCount >= FNO_RISK.MAX_TRADES_PER_DAY) {
        logger.info({ dayCount, indexSymbol, setupKey }, "Paper FO skip: daily cap reached (txn-checked)");
        return null;
      }

      const budget = balance * FNO_RISK.MAX_LOSS_PCT_PER_TRADE;
      const perLotLoss = perShareLoss * lotSize;
      const lots = Math.floor(budget / perLotLoss);
      if (lots < 1) {
        logger.info(
          { indexSymbol, setupKey, budget, perLotLoss },
          "Paper FO skip: position too risky for budget (lots < 1)",
        );
        return null;
      }
      const capitalDeployed = lots * optionEntry * lotSize;
      if (balance < capitalDeployed) {
        logger.info(
          { indexSymbol, setupKey, capitalDeployed, balance },
          "Paper FO skip: insufficient balance for premium",
        );
        return null;
      }

      const now = new Date();
      // Insert is still ON CONFLICT DO NOTHING — if a concurrent writer
      // somehow won the (date,idx,setup,dir) race despite our account
      // lock, we discover that here and roll the txn back cleanly.
      const inserted = await tx
        .insert(paperTradeFoTable)
        .values({
          signalDate,
          indexSymbol,
          setupKey,
          direction,
          indexName: signal.indexName,
          optionType: signal.leg.type,
          strike: toDbNumeric(signal.leg.strike, 4),
          lots,
          lotSize,
          entryPremium: toDbNumeric(optionEntry, 4),
          stopPremium: toDbNumeric(optionStop, 4),
          target1Premium: toDbNumeric(optionT1, 4),
          target2Premium: toDbNumeric(optionT2, 4),
          capitalDeployed: toDbNumeric(capitalDeployed, 2),
          lastPremium: toDbNumeric(signal.optionLtp ?? optionEntry, 4),
          openedAt: now,
          lastEvaluatedAt: now,
          status: "OPEN",
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        logger.info({ indexSymbol, setupKey }, "Paper FO skip: trade row already exists");
        return null;
      }

      // Atomic debit + counter bumps. Cap predicate repeated as
      // defence-in-depth — even if another path ever holds the account
      // row outside this codepath we still cannot oversize.
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
            eq(paperAccountTable.segment, "FNO"),
            sql`${paperAccountTable.balance} >= ${toDbNumeric(capitalDeployed, 2)}::numeric`,
            sql`${paperAccountTable.dayTradeCount} < ${FNO_RISK.MAX_TRADES_PER_DAY}`,
          ),
        )
        .returning();
      if (debited.length === 0) {
        // Cap or balance changed under us — abort. Throwing forces the
        // transaction to roll back, which removes the inserted row.
        throw new Error("paper_open_aborted_cap_or_balance");
      }

      logger.info(
        {
          indexSymbol,
          setupKey,
          direction,
          lots,
          lotSize,
          capitalDeployed: capitalDeployed.toFixed(2),
          entryPremium: optionEntry,
          stopPremium: optionStop,
          target1Premium: optionT1,
          target2Premium: optionT2,
          confidence,
          newBalance: num(debited[0]!.balance),
        },
        "Paper FO OPENED",
      );
      return inserted[0]!;
    });
  } catch (err) {
    if ((err as Error).message === "paper_open_aborted_cap_or_balance") {
      logger.info({ indexSymbol, setupKey }, "Paper FO skip: txn aborted (cap/balance lost the race)");
      return null;
    }
    throw err;
  }
  return openedRow;
}

/**
 * Update the live last-known premium on an open row so we have a fresh
 * value for MTM display and for the EXPIRED close fallback. Also keeps
 * max_runup / max_drawdown in step.
 */
async function markToMarket(input: LifecycleHookInput): Promise<void> {
  const { signal, signalDate, direction } = input;
  const setupKey = signal.setupKey;
  if (!setupKey) return;
  const ltp = signal.optionLtp;
  if (ltp == null) return;

  const row = await db
    .select()
    .from(paperTradeFoTable)
    .where(
      and(
        eq(paperTradeFoTable.signalDate, signalDate),
        eq(paperTradeFoTable.indexSymbol, signal.index),
        eq(paperTradeFoTable.setupKey, setupKey),
        eq(paperTradeFoTable.direction, direction),
        eq(paperTradeFoTable.status, "OPEN"),
      ),
    )
    .limit(1);
  if (row.length === 0) return;
  const r = row[0]!;
  const entry = num(r.entryPremium);
  const upnl = (ltp - entry) * r.lots * r.lotSize;
  await db
    .update(paperTradeFoTable)
    .set({
      lastPremium: toDbNumeric(ltp, 4),
      lastEvaluatedAt: new Date(),
      maxRunup: sql`GREATEST(${paperTradeFoTable.maxRunup}, ${toDbNumeric(upnl, 2)}::numeric)`,
      maxDrawdown: sql`LEAST(${paperTradeFoTable.maxDrawdown}, ${toDbNumeric(upnl, 2)}::numeric)`,
    })
    .where(and(eq(paperTradeFoTable.id, r.id), eq(paperTradeFoTable.status, "OPEN")));
}

export type CloseReason = "TARGET1_HIT" | "TARGET2_HIT" | "STOPPED" | "EXPIRED" | "MANUAL_OVERRIDE";

/**
 * Reconcile paper_trade_fo rows that are still OPEN despite the
 * underlying option_signal_history row having reached a terminal
 * lifecycle state. This is the safety net the architect surfaced —
 * if `onLifecycleUpsert()` ever crashed (transient DB error, network
 * blip) AFTER the lifecycle row had been advanced past trigger, the
 * paper trade would otherwise stay OPEN until manual intervention
 * because subsequent recordOrUpdate calls short-circuit on
 * `if (row.exitedAt)` and the EOD sweep skips already-exited rows.
 *
 * Called from ensureDailyReset (after the IST midnight refill) and
 * from expireOpenSignalsForToday (after the EOD lifecycle sweep) so
 * orphans get cleaned up at every natural boundary.
 *
 * Mapping is deliberate:
 *   lifecycle TARGET1_HIT  -> paper TARGET1_HIT (settles at T1)
 *   lifecycle TARGET2_HIT  -> paper TARGET2_HIT (settles at T2)
 *   lifecycle STOPPED      -> paper STOPPED     (settles at SL)
 *   lifecycle EXPIRED      -> paper EXPIRED     (settles at lastPremium)
 */
export async function reconcileOrphanedPaperTrades(): Promise<number> {
  // Inline SQL because we need a join across two tables; pulling both
  // sides into JS would race against concurrent writers.
  const orphans = await db.execute(sql`
    SELECT p.id, p.signal_date, p.index_symbol, p.setup_key, p.direction,
           h.status AS lifecycle_status
      FROM paper_trade_fo p
      JOIN option_signal_history h
        ON h.signal_date = p.signal_date
       AND h.index_symbol = p.index_symbol
       AND h.setup_key = p.setup_key
       AND h.direction = p.direction
     WHERE p.status = 'OPEN'
       AND h.exited_at IS NOT NULL
       AND h.status IN ('TARGET1_HIT','TARGET2_HIT','STOPPED','EXPIRED')
  `);
  const rows = (orphans as unknown as {
    rows: Array<{
      id: string;
      signal_date: string;
      index_symbol: string;
      setup_key: string;
      direction: "BULLISH" | "BEARISH";
      lifecycle_status: "TARGET1_HIT" | "TARGET2_HIT" | "STOPPED" | "EXPIRED";
    }>;
  }).rows;
  if (rows.length === 0) return 0;

  let closed = 0;
  for (const r of rows) {
    const reason: CloseReason =
      r.lifecycle_status === "TARGET2_HIT" ? "TARGET2_HIT" :
      r.lifecycle_status === "STOPPED" ? "STOPPED" :
      r.lifecycle_status === "TARGET1_HIT" ? "TARGET1_HIT" :
      "EXPIRED";
    try {
      const out = await closePaperTradeForSignal(
        r.signal_date,
        r.index_symbol,
        r.setup_key,
        r.direction,
        reason,
      );
      if (out) closed++;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, id: r.id },
        "reconcileOrphanedPaperTrades: close failed for one row, continuing",
      );
    }
  }
  if (closed > 0) {
    logger.info({ closed }, "Reconciled orphaned paper F&O trades against lifecycle");
  }
  return closed;
}

/**
 * Close a paper trade if one is OPEN for this signal. Idempotent — a
 * second call after CLOSED is a no-op. Caller passes the reason; we
 * pick the exit premium from the locked plan (or lastPremium for
 * EXPIRED / MANUAL).
 *
 * Single transaction: trade-row CAS, account credit and counter
 * decrement all commit together. Without this the architect surfaced
 * a real bug — if `credit()` failed after the row was set CLOSED, the
 * account would be permanently short-credited.
 */
export async function closePaperTradeForSignal(
  signalDate: string,
  indexSymbol: string,
  setupKey: string,
  direction: "BULLISH" | "BEARISH",
  reason: CloseReason,
): Promise<PaperTradeFoRow | null> {
  // Read row outside the txn — cheap, and lets us bail early when there
  // is nothing OPEN to close. The CAS inside the txn is what actually
  // protects against double-close races.
  const rows = await db
    .select()
    .from(paperTradeFoTable)
    .where(
      and(
        eq(paperTradeFoTable.signalDate, signalDate),
        eq(paperTradeFoTable.indexSymbol, indexSymbol),
        eq(paperTradeFoTable.setupKey, setupKey),
        eq(paperTradeFoTable.direction, direction),
        eq(paperTradeFoTable.status, "OPEN"),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0]!;
  const exitPremium = pickExitPremium(r, reason);
  const proceeds = exitPremium * r.lots * r.lotSize;
  const realizedPnl = proceeds - num(r.capitalDeployed);
  const now = new Date();

  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(paperTradeFoTable)
      .set({
        status: "CLOSED",
        exitedAt: now,
        exitPremium: toDbNumeric(exitPremium, 4),
        exitReason: reason,
        realizedPnl: toDbNumeric(realizedPnl, 2),
        lastPremium: toDbNumeric(exitPremium, 4),
        lastEvaluatedAt: now,
      })
      .where(and(eq(paperTradeFoTable.id, r.id), eq(paperTradeFoTable.status, "OPEN")))
      .returning();
    if (updated.length === 0) {
      // Lost the CAS race — another close already credited the account.
      // Returning null inside a tx that did no other writes is safe; the
      // empty txn commits as a no-op.
      return null;
    }
    await tx
      .update(paperAccountTable)
      .set({
        balance: sql`${paperAccountTable.balance} + ${toDbNumeric(proceeds, 2)}::numeric`,
        dayRealizedPnl: sql`${paperAccountTable.dayRealizedPnl} + ${toDbNumeric(realizedPnl, 2)}::numeric`,
        dayOpenCount: sql`GREATEST(${paperAccountTable.dayOpenCount} - 1, 0)`,
        updatedAt: now,
      })
      .where(eq(paperAccountTable.segment, "FNO"));
    logger.info(
      {
        id: r.id,
        indexSymbol,
        setupKey,
        direction,
        reason,
        lots: r.lots,
        entry: num(r.entryPremium),
        exit: exitPremium,
        realizedPnl: realizedPnl.toFixed(2),
      },
      "Paper FO CLOSED",
    );
    return updated[0]!;
  });
}

function pickExitPremium(r: PaperTradeFoRow, reason: CloseReason): number {
  switch (reason) {
    case "TARGET1_HIT":
      return num(r.target1Premium);
    case "TARGET2_HIT":
      return num(r.target2Premium);
    case "STOPPED":
      return num(r.stopPremium);
    case "EXPIRED":
    case "MANUAL_OVERRIDE":
    default:
      return num(r.lastPremium);
  }
}

/**
 * Single entry point invoked by the option signal lifecycle library
 * after every successful upsert. Quiet on failure — never throws.
 */
export async function onLifecycleUpsert(input: LifecycleHookInput): Promise<void> {
  try {
    const { prev, next, exited } = input;

    // Did we just trigger? OPEN if we never had this row before, or it
    // was PENDING last time AND is now past the trigger.
    const wasPreTrigger = prev === null || prev === "PENDING";
    const isPostTrigger = PAST_TRIGGER.includes(next);
    if (wasPreTrigger && isPostTrigger) {
      await openPaperTrade(input);
    }

    // Always mark-to-market — this also records max_runup / max_drawdown.
    await markToMarket(input);

    // Did the lifecycle just record an exit?
    if (exited) {
      const reason: CloseReason =
        next === "TARGET2_HIT" ? "TARGET2_HIT" :
        next === "STOPPED" ? "STOPPED" :
        next === "TARGET1_HIT" ? "TARGET1_HIT" :
        "EXPIRED";
      await closePaperTradeForSignal(
        input.signalDate,
        input.signal.index,
        input.signal.setupKey ?? "",
        input.direction,
        reason,
      );
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, idx: input.signal.index, setup: input.signal.setupKey },
      "Paper FO lifecycle hook failed",
    );
  }
}
