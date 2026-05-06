/**
 * Paper trading account state.
 *
 * One row per segment ("FNO" | "EQUITY"), owner-only.
 *
 *   - FNO and EQUITY both treat the balance as a persistent bankroll.
 *     The daily rollover only zeroes day_trade_count, day_open_count
 *     and day_realized_pnl; the cash balance carries over so cumulative
 *     P&L is visible directly on the account row instead of being
 *     erased every IST midnight. Use `topupAccount()` to add capital
 *     manually when the bankroll is depleted.
 *
 *     (Until 2026-05 the FNO segment auto-refilled to seed_capital
 *     every IST day — that wiped real losses and made the dashboard
 *     misleading. Removed at owner request.)
 *
 *   - EQUITY balance has always been preserved across days because
 *     capital is locked in OPEN swing positions overnight.
 *
 * All state mutations run through SQL conditional updates on the
 * account row, so concurrent handlers cannot oversize a position or
 * double-debit the balance.
 */
import { db, paperAccountTable, paperTradeFoTable } from "@workspace/db";
import type { PaperAccountRow } from "@workspace/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { logger } from "./logger";
import { CONFIDENCE_THRESHOLDS } from "./tradingConfig";

export type Segment = "FNO" | "EQUITY";

/** Seed capital amounts (₹). User-decided in the planning Q&A. */
export const SEED_CAPITAL: Record<Segment, number> = {
  FNO: 200_000,
  EQUITY: 1_000_000,
};

/** F&O specific risk caps. */
export const FNO_RISK = {
  /** Max loss per single trade as a fraction of segment balance. */
  MAX_LOSS_PCT_PER_TRADE: 0.02, // 2%
  /** Max paper trades opened per IST trading day. */
  MAX_TRADES_PER_DAY: 4,
  /** Minimum signal confidence to auto-trade (wired from central tradingConfig). */
  MIN_CONFIDENCE: CONFIDENCE_THRESHOLDS.MIN_FNO_TRADE,
  /** Pause after this many consecutive stopped-out trades in a single IST day. */
  MAX_CONSECUTIVE_STOPS_PER_DAY: 2,
} as const;

/**
 * BASELINE auto-trade lane. Conservative fallback so the F&O book still
 * ticks when the high-conviction detectors are suppressed (e.g. partial
 * indicators because intraday bar history is thin). Half the per-trade
 * risk (1% vs 2%), a lower but still meaningful confidence floor, and
 * shares the same MAX_TRADES_PER_DAY / MAX_CONSECUTIVE_STOPS_PER_DAY
 * caps as the standard lane so overall daily exposure is unchanged.
 */
export const FNO_BASELINE_RISK = {
  /** Max loss per BASELINE trade as a fraction of segment balance — half of the standard lane. */
  MAX_LOSS_PCT_PER_TRADE: 0.01, // 1%
  /** Confidence floor for BASELINE auto-trade. Lower than standard but still gates out the weakest reads. */
  MIN_CONFIDENCE: 55,
} as const;

/** Equity (swing-cash) specific allocation rules. User-decided. */
export const EQUITY_RISK = {
  /**
   * Per-position allocation = account_value / max(BASE_SLOTS, open_count + 1).
   * BASE_SLOTS=4 means the first 4 positions each get 25% of account
   * value; a 5th concurrent position would get 20%, a 6th 16.7%, etc.
   */
  BASE_SLOTS: 4,
  /** Hard cap on concurrent OPEN equity positions. */
  MAX_CONCURRENT: 10,
  /** Hard cap on new OPEN trades per IST day (quality > quantity). */
  MAX_NEW_PER_DAY: 3,
  /** Minimum scanner score for a STRONG_BUY to qualify for paper buy. */
  MIN_SCORE: 24,
  /** Trading-days time stop: close any position still OPEN after this. */
  MAX_HOLD_TRADING_DAYS: 30,
} as const;

function istDateKey(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

function toMoney(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

/**
 * Look up (or lazily seed) the account row. Does NOT do daily refill —
 * call ensureDailyReset for that. Useful for read-only display.
 */
export async function getOrInitAccount(segment: Segment): Promise<PaperAccountRow> {
  const seed = SEED_CAPITAL[segment];
  // Insert ... ON CONFLICT DO NOTHING is safe under concurrency. If the
  // row already exists the insert is a no-op and we re-select.
  await db
    .insert(paperAccountTable)
    .values({
      segment,
      seedCapital: toMoney(seed),
      balance: toMoney(seed),
      dayRealizedPnl: "0",
      dayTradeCount: 0,
      dayOpenCount: 0,
      lastResetDate: istDateKey(),
    })
    .onConflictDoNothing();
  const rows = await db
    .select()
    .from(paperAccountTable)
    .where(eq(paperAccountTable.segment, segment))
    .limit(1);
  return rows[0]!;
}

/**
 * Daily auto-refill. If lastResetDate is null or before today (IST),
 * reset the balance to seed_capital and zero day counters. Idempotent —
 * called on every account read AND every mutation, so a server restart
 * mid-day cannot leave us with stale day counters.
 */
export async function ensureDailyReset(segment: Segment): Promise<PaperAccountRow> {
  const today = istDateKey();
  await getOrInitAccount(segment);

  // Pre-check whether a reset is due. We do reconcile-of-prior-day
  // orphans BEFORE the reset wipes the balance — that way the credit
  // goes into the about-to-be-wiped pre-reset balance (net no-op on
  // today's bankroll) while still writing the proper exit reason/price
  // and realized_pnl onto the orphaned trade row.
  //
  // Without this ordering, yesterday's settlements would inflate today's
  // freshly-reset seed balance — a real accounting bug the architect
  // surfaced. Doing it the other way around (reset, then reconcile) is
  // strictly worse than no reconciliation at all.
  const [pre] = await db
    .select({ lastResetDate: paperAccountTable.lastResetDate })
    .from(paperAccountTable)
    .where(eq(paperAccountTable.segment, segment))
    .limit(1);
  const resetDue = !pre?.lastResetDate || pre.lastResetDate < today;

  if (resetDue && segment === "FNO") {
    // Reconcile orphan paper trades whose underlying lifecycle row is
    // already terminal. CAS-based + idempotent, so concurrent ensureDailyReset
    // calls cannot double-credit.
    try {
      const { reconcileOrphanedPaperTrades } = await import("./paperTradingFO");
      await reconcileOrphanedPaperTrades();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Pre-reset reconcile failed (continuing)");
    }
  }

  // Both segments preserve `balance` across the day-rollover. FNO used
  // to auto-refill to seed_capital here, but that erased real losses
  // every IST midnight and made cumulative P&L invisible. The owner
  // now tops up manually via `topupAccount()` (POST /paper/account/topup).
  //
  // EQUITY also preserves dayOpenCount because OPEN swing positions
  // carry over the night and must keep being counted; FNO clears
  // dayOpenCount because the F&O lifecycle terminates intraday so any
  // count carrying over would be stale.
  const setClause =
    segment === "FNO"
      ? {
          dayRealizedPnl: "0",
          dayTradeCount: 0,
          dayOpenCount: 0,
          lastResetDate: today,
          updatedAt: new Date(),
        }
      : {
          dayRealizedPnl: "0",
          dayTradeCount: 0,
          lastResetDate: today,
          updatedAt: new Date(),
        };

  const updated = await db
    .update(paperAccountTable)
    .set(setClause)
    .where(
      and(
        eq(paperAccountTable.segment, segment),
        // Only reset if last reset was on a prior IST date (or never).
        // The same predicate guards both this UPDATE and our pre-reset
        // reconcile decision, so concurrent callers either both attempt
        // reconcile (idempotent) or one wins the UPDATE and the other
        // is a no-op — never re-resetting and never re-debiting.
        sql`(${paperAccountTable.lastResetDate} IS NULL OR ${paperAccountTable.lastResetDate} < ${today})`,
      ),
    )
    .returning();

  if (updated.length > 0) {
    logger.info(
      { segment, today, balance: updated[0]!.balance },
      segment === "FNO" ? "Paper account daily refill" : "Paper account day-counter rollover",
    );
    // Final stale-sweep for any rows that still have status=OPEN at
    // this point (no matching terminal lifecycle row, e.g. signal
    // history was wiped, or the lifecycle row never reached terminal).
    // Closes the trade ledger row only — does NOT mutate the account
    // because the account has just been reset above.
    if (segment === "FNO") {
      await sweepStaleOpenPaperTrades(today);
    }
  }

  const rows = await db
    .select()
    .from(paperAccountTable)
    .where(eq(paperAccountTable.segment, segment))
    .limit(1);
  return rows[0]!;
}

/**
 * Best-effort cleanup of paper_trade_fo rows that are still OPEN but
 * belong to a prior trading date. Always settled at lastPremium with
 * the realised P&L computed from that. We do NOT credit the segment
 * balance because the prior-day account state has already been wiped
 * by the daily refill — the trade still gets a correct exit row in
 * the ledger.
 */
async function sweepStaleOpenPaperTrades(today: string): Promise<void> {
  const stale = await db
    .select()
    .from(paperTradeFoTable)
    .where(
      and(
        eq(paperTradeFoTable.status, "OPEN"),
        lt(paperTradeFoTable.signalDate, today),
      ),
    );
  if (stale.length === 0) return;
  const now = new Date();
  for (const r of stale) {
    const exit = num(r.lastPremium);
    const entry = num(r.entryPremium);
    const pnl = (exit - entry) * r.lots * r.lotSize;
    await db
      .update(paperTradeFoTable)
      .set({
        status: "CLOSED",
        exitedAt: now,
        exitPremium: toMoney(exit),
        exitReason: "EXPIRED",
        realizedPnl: toMoney(pnl),
        lastEvaluatedAt: now,
      })
      .where(and(eq(paperTradeFoTable.id, r.id), eq(paperTradeFoTable.status, "OPEN")));
  }
  logger.info({ count: stale.length }, "Swept stale open paper F&O trades");
}

/**
 * Atomic debit. Returns null if insufficient balance OR if any concurrent
 * caller debited just before us. Caller must check the return.
 */
export async function tryDebit(segment: Segment, amount: number): Promise<{
  ok: boolean;
  newBalance: number;
}> {
  if (amount <= 0) return { ok: false, newBalance: 0 };
  await ensureDailyReset(segment);
  // Conditional update — only succeeds if balance is sufficient. This
  // is the single point of truth for debit serialisation; no app-level
  // lock required.
  const updated = await db
    .update(paperAccountTable)
    .set({
      balance: sql`${paperAccountTable.balance} - ${toMoney(amount)}::numeric`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(paperAccountTable.segment, segment),
        sql`${paperAccountTable.balance} >= ${toMoney(amount)}::numeric`,
      ),
    )
    .returning();
  if (updated.length === 0) return { ok: false, newBalance: 0 };
  return { ok: true, newBalance: num(updated[0]!.balance) };
}

/** Refund an aborted debit (e.g. if the trade-open flow failed after debit). */
export async function refund(segment: Segment, amount: number): Promise<void> {
  if (amount <= 0) return;
  await db
    .update(paperAccountTable)
    .set({
      balance: sql`${paperAccountTable.balance} + ${toMoney(amount)}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(paperAccountTable.segment, segment));
}

/** Credit proceeds + accumulate day P&L when a trade closes. */
export async function credit(
  segment: Segment,
  proceeds: number,
  realizedPnl: number,
): Promise<void> {
  if (proceeds < 0) return;
  await db
    .update(paperAccountTable)
    .set({
      balance: sql`${paperAccountTable.balance} + ${toMoney(proceeds)}::numeric`,
      dayRealizedPnl: sql`${paperAccountTable.dayRealizedPnl} + ${toMoney(realizedPnl)}::numeric`,
      dayOpenCount: sql`GREATEST(${paperAccountTable.dayOpenCount} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(paperAccountTable.segment, segment));
}

/** Bump day_trade_count + day_open_count when a position opens. */
export async function recordOpen(segment: Segment): Promise<void> {
  await db
    .update(paperAccountTable)
    .set({
      dayTradeCount: sql`${paperAccountTable.dayTradeCount} + 1`,
      dayOpenCount: sql`${paperAccountTable.dayOpenCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(paperAccountTable.segment, segment));
}

/**
 * Manual top-up. Adds `amount` (₹) to the segment cash balance. Used
 * by the owner via POST /paper/account/topup when the bankroll is
 * depleted. Does NOT bump seed_capital — seed remains the original
 * starting bankroll for "net vs seed" reporting; topups are tracked
 * via the cumulative balance + closed-trade ledger.
 *
 * Returns { ok, newBalance }. ok=false only when amount <= 0 or the
 * row update fails.
 */
export async function topupAccount(
  segment: Segment,
  amount: number,
): Promise<{ ok: boolean; newBalance: number }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, newBalance: 0 };
  }
  await ensureDailyReset(segment);
  const updated = await db
    .update(paperAccountTable)
    .set({
      balance: sql`${paperAccountTable.balance} + ${toMoney(amount)}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(paperAccountTable.segment, segment))
    .returning();
  if (updated.length === 0) return { ok: false, newBalance: 0 };
  const next = num(updated[0]!.balance);
  logger.info({ segment, amount, newBalance: next }, "Manual paper top-up");
  return { ok: true, newBalance: next };
}

/**
 * Fast read of just the day_trade_count without mutating anything.
 * Used by the F&O paper trader to decide whether to skip a new
 * trigger because we've already hit the daily cap.
 */
export async function getDayTradeCount(segment: Segment): Promise<number> {
  const row = await ensureDailyReset(segment);
  return row.dayTradeCount;
}
