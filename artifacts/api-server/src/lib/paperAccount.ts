/**
 * Paper trading account state.
 *
 * One row per segment ("FNO" | "EQUITY"), owner-only. Each segment has
 * an auto-seeded starting capital that auto-refills at the start of
 * every IST trading day. Cumulative P&L lives on individual trade
 * rows (paper_trade_fo etc.), so the daily refill never erases history.
 *
 * Why "auto-refill" rather than "carry the running balance forever"?
 * The user explicitly asked for this — they want a clean bankroll each
 * day so a single bad week doesn't pollute every following day's tests.
 * Per-day P&L is what's used to evaluate the strategy.
 *
 * All state mutations run inside a SERIALIZABLE-equivalent flow by
 * SELECT ... FOR UPDATE on the account row, so concurrent webhook
 * handlers cannot oversize a position or double-debit the balance.
 */
import { db, paperAccountTable, paperTradeFoTable } from "@workspace/db";
import type { PaperAccountRow } from "@workspace/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { logger } from "./logger";

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
  /** Minimum signal confidence to auto-trade. */
  MIN_CONFIDENCE: 70,
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

  const updated = await db
    .update(paperAccountTable)
    .set({
      balance: sql`${paperAccountTable.seedCapital}`,
      dayRealizedPnl: "0",
      dayTradeCount: 0,
      dayOpenCount: 0,
      lastResetDate: today,
      updatedAt: new Date(),
    })
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
    logger.info({ segment, today, balance: updated[0]!.balance }, "Paper account daily refill");
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
 * Fast read of just the day_trade_count without mutating anything.
 * Used by the F&O paper trader to decide whether to skip a new
 * trigger because we've already hit the daily cap.
 */
export async function getDayTradeCount(segment: Segment): Promise<number> {
  const row = await ensureDailyReset(segment);
  return row.dayTradeCount;
}
