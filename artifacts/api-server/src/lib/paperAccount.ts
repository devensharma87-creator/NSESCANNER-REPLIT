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
import {
  db,
  paperAccountTable,
  paperCapitalEventTable,
  paperTradeEqTable,
  paperTradeFoTable,
} from "@workspace/db";
import type { PaperAccountRow } from "@workspace/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { logger } from "./logger";
import { CONFIDENCE_THRESHOLDS } from "./tradingConfig";

export type Segment = "FNO" | "EQUITY";

/** Seed capital amounts (₹). User-decided in the planning Q&A. */
export const SEED_CAPITAL: Record<Segment, number> = {
  FNO: 200_000,
  EQUITY: 1_000_000,
};

/**
 * Per-index FIXED lot count for paper-trade sizing.
 *
 * When an entry exists for an index, the paper trader bypasses the
 * `lots = floor(budget / (perShareLoss × lotSize))` risk-budget formula
 * and opens EXACTLY this many lots — useful for the owner who wants
 * consistent position sizing across signals (apples-to-apples
 * back-comparison) regardless of how tight/wide the stop on a given
 * setup happens to be.
 *
 * NOTE: lotSize itself still comes from the exchange (Kite instruments
 * dump). These are LOT COUNTS, not share counts. The actual qty going
 * into the trade is `lots × lotSize`, e.g. NIFTY 10 lots × 65 share lot
 * = 650 shares (lot 65 per the Jan-2026 NSE revision).
 *
 * Indices NOT listed here (FINNIFTY, MIDCPNIFTY, NIFTYNXT50, BANKEX)
 * keep using the dynamic risk-budget formula.
 *
 * Owner override (2026-05-07): NIFTY 10, SENSEX 40, BANKNIFTY 30.
 *
 * Per-trade % loss caps and the daily/weekly DD caps still apply ON TOP
 * of fixed sizing — if the implied risk for the planned stop blows past
 * the configured ceiling we WARN but still open (the owner explicitly
 * chose fixed sizing). The "insufficient balance" gate also still fires
 * (a fixed-lot order we can't afford is rejected, not partially filled).
 */
export const PAPER_FIXED_LOTS: Record<string, number> = {
  NIFTY: 10,
  SENSEX: 40,
  BANKNIFTY: 30,
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
  /** Phase-1 daily/weekly portfolio drawdown caps. New entries are blocked
   *  once the cumulative realised loss for the IST day reaches this fraction
   *  of the seed capital. Prevents the "4 trades × 2% = 8% in a single day"
   *  failure mode the per-trade cap alone allows. */
  MAX_DAILY_LOSS_PCT: 0.025,  // 2.5%
  /** Same as above but over the trailing IST week (Mon-Sun). 5% weekly is the
   *  framework's bankroll-survival ceiling — at 5% per week, a 4-week drawdown
   *  caps total bleed at ~20% which is still recoverable. */
  MAX_WEEKLY_LOSS_PCT: 0.05,  // 5%
} as const;

/**
 * BASELINE auto-trade lane (2026-05-11 redesign).
 *
 * Conservative fallback so the F&O book still ticks when the high-
 * conviction detectors are suppressed (thin intraday bar history,
 * confluence haircut, P3 demote tags, etc.).
 *
 * Sub-tiered by confidence so a 55-conf "weak read" doesn't get the
 * same risk envelope as a 64-conf near-HC setup:
 *
 *   55-59 conf  → MICRO    : 0.25 % risk per trade  ("test" size)
 *   60-64 conf  → BASELINE : 0.50 % risk per trade  ("small" size)
 *   65+  conf   → STANDARD : 2.00 % risk per trade  (full HC sizing)
 *
 * Plus dedicated BASELINE-only guardrails on top of the global F&O
 * limits (MAX_TRADES_PER_DAY=4, MAX_CONSECUTIVE_STOPS_PER_DAY=2,
 * MAX_DAILY_LOSS_PCT=2.5%, MAX_WEEKLY_LOSS_PCT=5%):
 *
 *   - max 2 BASELINE opens per IST day (a quiet day shouldn't become
 *     a BASELINE-spam day just because conviction is weak everywhere)
 *   - daily BASELINE realised-loss cap = 0.75 % of seed (independent
 *     of and tighter than the global 2.5 % daily cap)
 *   - 2 consecutive BASELINE losses lock the BASELINE lane for the rest
 *     of the IST day (HC lane is unaffected — a lower-conviction streak
 *     of losses shouldn't kill a clean HC setup if one fires later)
 *   - no NEW BASELINE entries after 14:45 IST (HC stays at 15:25) —
 *     an under-conviction setup needs more runway, not less
 *
 * The dial values intentionally favour SAFETY over throughput. After
 * 20-30 closed BASELINE trades we'll have data to widen them or not.
 */
export const FNO_BASELINE_RISK = {
  /** Confidence floor for BASELINE auto-trade. Lower than standard but still gates out the weakest reads. */
  MIN_CONFIDENCE: 55,
  /** Sub-tier breakpoint: confidence ≥ this uses BASELINE_RISK_PCT, below uses MICRO_RISK_PCT. */
  MICRO_TO_BASELINE_BREAKPOINT: 60,
  /** 0.25 % per trade — applied to confidence 55-59 ("test" size). */
  MICRO_RISK_PCT: 0.0025,
  /** 0.50 % per trade — applied to confidence 60-64 ("small" baseline size). */
  BASELINE_RISK_PCT: 0.005,
  /** Old top-level constant kept for back-compat; equals BASELINE_RISK_PCT (used as the "max" sanity ceiling). */
  MAX_LOSS_PCT_PER_TRADE: 0.005,
} as const;

/**
 * BASELINE-lane-specific guardrails (independent of FNO_RISK / DD caps).
 * All checks fire BEFORE openPaperTrade reaches sizing, and each check
 * records a distinct MissedSignal SkipReason so the audit panel shows
 * exactly which guardrail rejected an entry.
 */
export const FNO_BASELINE_GUARDRAILS = {
  /** Max BASELINE trades opened per IST day (HC lane unaffected). */
  MAX_TRADES_PER_DAY: 2,
  /** Realised loss from BASELINE trades only — capped at 0.75 % of seed/day. */
  MAX_DAILY_LOSS_PCT: 0.0075,
  /** After this many consecutive BASELINE-tier stops in a single IST day, lock BASELINE for the day. */
  MAX_CONSECUTIVE_LOSSES: 2,
  /** No new BASELINE entries after this IST minute-of-day (14:45 = 14*60+45 = 885). */
  LATE_ENTRY_CUTOFF_IST_MIN: 14 * 60 + 45,
} as const;

/**
 * Resolve effective per-trade risk fraction from confidence and tier.
 * Pure function — no DB I/O. Used at trade-open sizing.
 */
export function riskPctForConfidence(
  tier: "STANDARD" | "BASELINE",
  confidence: number,
): number {
  if (tier === "STANDARD") return FNO_RISK.MAX_LOSS_PCT_PER_TRADE; // 2 %
  // BASELINE sub-tiers:
  if (confidence >= FNO_BASELINE_RISK.MICRO_TO_BASELINE_BREAKPOINT) {
    return FNO_BASELINE_RISK.BASELINE_RISK_PCT; // 0.5 %
  }
  return FNO_BASELINE_RISK.MICRO_RISK_PCT; // 0.25 %
}

/**
 * F&O option-leg liquidity gates (Pass-1 safety nets, 2026-05-07).
 *
 * Reject paper-trade entries on illiquid option legs — even a perfect
 * setup is uninvestable if you can't get out at a sane price. Three
 * orthogonal filters:
 *
 *   - MIN_OPTION_LTP: too-cheap options have asymmetric slippage; the
 *     bid-ask is often a meaningful fraction of LTP itself.
 *   - MAX_BID_ASK_SPREAD_PCT: tight book required, otherwise market-
 *     impact alone breaches the per-trade risk budget.
 *   - MIN_OPTION_OI: thin OI = thin book = wide effective spread when
 *     you actually need to exit. Cumulative session OI proxy.
 *
 * The MIN_OPTION_LTP gate uses `signal.optionEntry` (already populated
 * by the chain enricher, no extra fetch). The spread + OI gates need
 * a fresh chain pull at trade-open time; on chain-fetch failure we
 * FAIL OPEN with a warn-log (the LTP gate already filters the worst
 * cases) — paper trading should not hard-block on transient NSE
 * connectivity blips that the live system would never see.
 */
export const FNO_LIQUIDITY = {
  /** Reject if option entry premium < ₹20 (asymmetric slippage zone). */
  MIN_OPTION_LTP: 20,
  /** Reject if (ask - bid) / ltp > 1.5%. */
  MAX_BID_ASK_SPREAD_PCT: 0.015,
  /** Reject if open interest < 50,000 contracts (thin-book proxy). */
  MIN_OPTION_OI: 50_000,
} as const;

/**
 * Pass-2B post-stop cool-down.
 *
 * After a STOPPED close on an index, the next entry on the SAME index
 * within COOLDOWN_MINUTES uses SIZE_MULT × the otherwise-computed lots.
 * Rationale: revenge-trade reduction. A stop-out is a regime-disagreement
 * signal — sizing down on the next attempt acknowledges that the read
 * was wrong without sitting out completely.
 *
 * Applied to BOTH dynamic-budget AND fixed-lot sizing paths in
 * paperTradingFO. Floors at 1 lot (we never round to zero — the next
 * trade either happens or doesn't, no zero-size phantom rows).
 */
export const POST_STOP_COOLDOWN = {
  COOLDOWN_MINUTES: 60,
  SIZE_MULT: 0.5,
} as const;

/**
 * Pass-2B portfolio heat cap (per-segment).
 *
 * Sum of ₹-at-risk across all OPEN positions in the segment must stay
 * below this fraction of seed capital. Different from the daily/weekly
 * REALISED drawdown caps (those count CLOSED P&L) — heat counts
 * potential loss if every open position simultaneously hit its stop.
 *
 *   - F&O 6%: with 4 trades/day × 2% per-trade cap, the absolute
 *     theoretical max heat is 8% but real-world spread of openings
 *     usually keeps it under 6%; this gates the rare cluster-overlap
 *     case where 3-4 high-conf signals fire in the same 5-minute window.
 *   - EQUITY 6%: matches F&O for symmetry; with 10 concurrent open cap,
 *     a tight cluster of 8% stops would otherwise breach 8% × 10 = 80%
 *     of seed at risk simultaneously.
 *
 * Computed on entry-stop premium distance × lots × lot_size (F&O) or
 * (entry - stop) × qty (equity). FAIL CLOSED if the projected heat
 * (current OPEN heat + this trade's risk) would breach the cap.
 */
export const PORTFOLIO_HEAT = {
  MAX_FNO_HEAT_PCT: 0.06,
  MAX_EQ_HEAT_PCT: 0.06,
} as const;

/**
 * Pass-2B portfolio-level regime sizing scale.
 *
 * Independent of the per-signal vol-clamp soft-demote (Pass-2A): when
 * the SETUP itself is in a VOLATILE regime (high realised vol / wide
 * Bollinger band but stop envelope is intact), we still trade — but at
 * smaller size. Stacks multiplicatively with POST_STOP_COOLDOWN.
 *
 * EXPIRY_DAY is handled separately in the signal layer (force tier to
 * BASELINE) so it doesn't need a sizing scale here.
 */
export const REGIME_SIZING = {
  VOLATILE_MULT: 0.5,
} as const;

/**
 * Pass-3 (E): rolling per-setup win-rate calibration.
 *
 * Self-healing accuracy filter — every signal cycle queries CLOSED
 * paper_trade_fo rows over the last LOOKBACK_DAYS and groups by
 * setup_key. When a setup's empirical win-rate drops below MIN_WIN_RATE
 * (with at least MIN_SAMPLE closed trades to be statistically meaningful),
 * the emission loop demotes its HC candidates to BASELINE with a
 * `LOW_WINRATE` audit tag. New setups (sample < MIN_SAMPLE) get the
 * benefit of the doubt — gate is a no-op until enough data accumulates.
 */
export const WIN_RATE_CALIBRATION = {
  LOOKBACK_DAYS: 30,
  MIN_SAMPLE: 10,
  MIN_WIN_RATE: 0.4,
} as const;

/**
 * Pass-3 (D): sector relative-strength tolerance vs NIFTY benchmark.
 *
 * Per-cycle we compute NIFTY's 5-day spot return, and per-index its own
 * 5-day return. A BULLISH setup on a laggard (idxRet < niftyRet - TOL)
 * or a BEARISH setup on a leader (idxRet > niftyRet + TOL) is demoted
 * to BASELINE with `RS_CONFLICT` tag. Filters "right setup, wrong
 * sector" — the sector is fighting the broader tape. NIFTY itself is
 * the benchmark and exempt from the gate.
 */
export const RELATIVE_STRENGTH = {
  LOOKBACK_DAYS: 5,
  TOLERANCE_PCT: 1.0,
} as const;

/**
 * Pass-2B: portfolio-heat SQL helpers.
 *
 * Sum across all OPEN rows of (qty × per-share-risk). The max-with-zero
 * clamp guards against any inverted rows (stop above entry — shouldn't
 * happen for long-only paper book but defensive).
 *
 * IMPORTANT: heat reads MUST be transaction-scoped — they're cap-checks
 * that race with concurrent INSERTs. We therefore expose the SQL
 * fragments and let callers run them via their own `tx.execute(...)`
 * inside the same transaction that holds the account-row lock. Outside
 * a txn, two parallel opens could each read heat=0, both pass the cap,
 * and collectively breach it on commit.
 */
export const HEAT_SQL_FNO = sql`
  SELECT COALESCE(
    SUM(lots * lot_size * GREATEST(entry_premium - stop_premium, 0)),
    0
  )::numeric AS heat
  FROM paper_trade_fo
  WHERE status = 'OPEN'
`;
export const HEAT_SQL_EQ = sql`
  SELECT COALESCE(
    SUM(qty * GREATEST(entry_price - stop_price, 0)),
    0
  )::numeric AS heat
  FROM paper_trade_eq
  WHERE status = 'OPEN'
`;
export function parseHeatRow(result: unknown): number {
  const rows = (result as { rows: Array<{ heat: string | number }> }).rows;
  if (rows.length === 0) return 0;
  const v = rows[0]!.heat;
  return typeof v === "number" ? v : parseFloat(v);
}

/** Read a single numeric scalar (keyed) off a `db.execute` result. */
function parseNumericRow(result: unknown, key: string): number {
  const rows = (result as { rows: Array<Record<string, string | number | null>> }).rows;
  if (!rows || rows.length === 0) return 0;
  const v = rows[0]![key];
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

/**
 * Equity portfolio drawdown caps (Pass-1 safety nets, 2026-05-07).
 *
 * Mirrors the F&O DD latch system on the EQUITY segment so a string
 * of losing swings can't bleed the bankroll past these floors before
 * the human notices. Sticky-once-hit semantics, IST window rollover.
 *
 * Daily 2% / Weekly 4% / Monthly 8% — tighter than F&O because swing
 * losses compound across days (vs F&O where a bad day fully resets
 * tomorrow morning).
 */
export const EQUITY_DD_CAPS = {
  MAX_DAILY_LOSS_PCT: 0.02,
  MAX_WEEKLY_LOSS_PCT: 0.04,
  MAX_MONTHLY_LOSS_PCT: 0.08,
} as const;

/**
 * Equity stop-loss sanity bounds (Pass-1 safety nets, 2026-05-07).
 *
 * Reject swing entries with absurd stops:
 *   - too tight (< 1% from entry) ⇒ noise-driven, near-100% stop hit.
 *   - too wide  (> 8% from entry) ⇒ scanner geometry bug; risk per
 *     share is unbounded and torpedoes the per-position risk budget.
 *
 * Computed as `(entry - stop) / entry`. Direction-agnostic: all swing
 * paper trades today are LONG so stop is always below entry.
 */
export const EQUITY_STOP_SANITY = {
  MIN_STOP_PCT: 0.01,
  MAX_STOP_PCT: 0.08,
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
 * Normalise an optional owner-supplied ledger note: trim, collapse empty to
 * null, and cap length so a fat-finger paste can't bloat the row.
 */
function normaliseNote(note: string | null | undefined): string | null {
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 280);
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
  opts?: { note?: string | null; createdBy?: string | null },
): Promise<{ ok: boolean; newBalance: number }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, newBalance: 0 };
  }
  await ensureDailyReset(segment);
  // Balance bump + ledger row in ONE transaction so the audit trail can
  // never drift from the cash balance. The ledger amount is the positive
  // magnitude; direction is encoded by kind="ADD_CAPITAL".
  const result = await db.transaction(async (tx) => {
    const updated = await tx
      .update(paperAccountTable)
      .set({
        balance: sql`${paperAccountTable.balance} + ${toMoney(amount)}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(paperAccountTable.segment, segment))
      .returning();
    if (updated.length === 0) return { ok: false, newBalance: 0 };
    const next = num(updated[0]!.balance);
    await tx.insert(paperCapitalEventTable).values({
      segment,
      kind: "ADD_CAPITAL",
      amount: toMoney(amount),
      balanceAfter: toMoney(next),
      note: normaliseNote(opts?.note),
      createdBy: opts?.createdBy ?? null,
    });
    return { ok: true, newBalance: next };
  });
  if (result.ok) {
    logger.info({ segment, amount, newBalance: result.newBalance }, "Manual paper top-up (ADD_CAPITAL)");
  }
  return result;
}

/**
 * Manual withdrawal. Removes `amount` (₹) from the segment cash balance,
 * fail-closed: the withdrawal is BLOCKED when it would exceed the available
 * cash (balance). Open-position capital is locked separately (it is NOT in
 * `balance` — `tryDebit` already moved it out when the position opened), so
 * `balance` is exactly the withdrawable amount.
 *
 * Balance decrement + WITHDRAW_CAPITAL ledger row run in ONE transaction
 * under a FOR UPDATE lock so a concurrent open/withdraw cannot let the
 * balance go negative. A capital move is NOT P&L — it never touches
 * day_realized_pnl / seed_capital / heat.
 *
 * Returns { ok, newBalance, blocked, reason? }:
 *   - ok=true               → withdrawn; newBalance is the post-withdraw cash.
 *   - blocked=true          → amount > available cash; newBalance is current.
 *   - ok=false, blocked=false → invalid amount or missing account row.
 */
export async function withdrawAccount(
  segment: Segment,
  amount: number,
  opts?: { note?: string | null; createdBy?: string | null },
): Promise<{ ok: boolean; newBalance: number; blocked: boolean; reason?: string }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, newBalance: 0, blocked: false, reason: "INVALID_AMOUNT" };
  }
  await ensureDailyReset(segment);
  return db.transaction(async (tx) => {
    // Serialise against concurrent opens/withdraws on this segment.
    const lockRows = (
      (await tx.execute(sql`
        SELECT balance FROM paper_account WHERE segment = ${segment} FOR UPDATE
      `)) as unknown as { rows: Array<{ balance: string | number }> }
    ).rows;
    if (lockRows.length === 0) {
      return { ok: false, newBalance: 0, blocked: false, reason: "NO_ACCOUNT" };
    }
    const current = num(lockRows[0]!.balance);
    if (current < amount) {
      return { ok: false, newBalance: current, blocked: true, reason: "INSUFFICIENT_CASH" };
    }
    const updated = await tx
      .update(paperAccountTable)
      .set({
        balance: sql`${paperAccountTable.balance} - ${toMoney(amount)}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(paperAccountTable.segment, segment))
      .returning();
    const next = num(updated[0]!.balance);
    await tx.insert(paperCapitalEventTable).values({
      segment,
      kind: "WITHDRAW_CAPITAL",
      amount: toMoney(amount),
      balanceAfter: toMoney(next),
      note: normaliseNote(opts?.note),
      createdBy: opts?.createdBy ?? null,
    });
    logger.info({ segment, amount, newBalance: next }, "Manual paper withdrawal (WITHDRAW_CAPITAL)");
    return { ok: true, newBalance: next, blocked: false };
  });
}

/**
 * Cumulative capital movements for a segment, summed from the ledger.
 * Returns positive magnitudes: { added, withdrawn }. Capital moves are
 * NOT P&L — this is purely for the account surface so the owner can see
 * how much external cash they've injected/removed vs. trading P&L.
 */
export async function getCapitalMovements(
  segment: Segment,
): Promise<{ added: number; withdrawn: number }> {
  const rows = await db
    .select({
      kind: paperCapitalEventTable.kind,
      total: sql<string | null>`COALESCE(SUM(${paperCapitalEventTable.amount}), 0)`,
    })
    .from(paperCapitalEventTable)
    .where(eq(paperCapitalEventTable.segment, segment))
    .groupBy(paperCapitalEventTable.kind);
  let added = 0;
  let withdrawn = 0;
  for (const r of rows) {
    if (r.kind === "ADD_CAPITAL") added = num(r.total);
    else if (r.kind === "WITHDRAW_CAPITAL") withdrawn = num(r.total);
  }
  return { added, withdrawn };
}

/**
 * Capital currently LOCKED in OPEN positions for a segment (₹ notional
 * deployed, not ₹-at-risk). FNO = Σ lots × lot_size × entry_premium;
 * EQUITY = Σ qty × entry_price. Shown separately from withdrawable cash
 * so the owner sees why their balance is lower than total account value.
 */
export async function getDeployedCapital(segment: Segment): Promise<number> {
  const result =
    segment === "FNO"
      ? await db.execute(sql`
          SELECT COALESCE(SUM(lots * lot_size * entry_premium), 0)::numeric AS dep
          FROM paper_trade_fo WHERE status = 'OPEN'
        `)
      : await db.execute(sql`
          SELECT COALESCE(SUM(qty * entry_price), 0)::numeric AS dep
          FROM paper_trade_eq WHERE status = 'OPEN'
        `);
  return parseNumericRow(result, "dep");
}

/**
 * Current portfolio heat (₹-at-risk across OPEN positions) for a segment,
 * read OUTSIDE a transaction for display. Trade-open paths must keep using
 * the txn-scoped HEAT_SQL_* fragments (see note above) — this is read-only.
 */
export async function getSegmentHeat(segment: Segment): Promise<number> {
  const result = await db.execute(segment === "FNO" ? HEAT_SQL_FNO : HEAT_SQL_EQ);
  return parseHeatRow(result);
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

// ─── Phase-1 portfolio drawdown caps ─────────────────────────────────────
//
// Per-trade caps alone allow up to MAX_TRADES_PER_DAY × MAX_LOSS_PCT_PER_TRADE
// of bankroll to bleed in a single session. These helpers compute realised
// loss as a fraction of seed capital across the IST day / IST week and let
// the trade-open path block new entries once the cap is reached.
//
// Realised P&L is summed from `paperTradeFoTable.realizedPnl` for CLOSED
// rows only — open MTM doesn't count (the trade may still recover).

/** Monday of the current IST calendar week (Mon-Sun, ISO convention). */
function istWeekStartKey(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay(); // 0=Sun..6=Sat
  const diffToMon = day === 0 ? 6 : day - 1;
  ist.setUTCDate(ist.getUTCDate() - diffToMon);
  return ist.toISOString().slice(0, 10);
}

async function sumRealisedPnlSince(sinceDateKey: string): Promise<number> {
  const result = await db
    .select({ s: sql<string | null>`COALESCE(SUM(${paperTradeFoTable.realizedPnl}), 0)` })
    .from(paperTradeFoTable)
    .where(
      and(
        eq(paperTradeFoTable.status, "CLOSED"),
        gte(paperTradeFoTable.signalDate, sinceDateKey),
      ),
    );
  return num(result[0]?.s ?? 0);
}

export interface DrawdownReading {
  /** Realised P&L for the window (₹). Positive = net profit. */
  realisedPnl: number;
  /** Loss as a fraction of seed capital (positive). 0 when net profit. */
  drawdownPct: number;
  /** True iff drawdownPct >= the configured cap. */
  capReached: boolean;
  /** The configured cap fraction (e.g. 0.025). */
  capPct: number;
  /** Window start (IST date YYYY-MM-DD). */
  windowStart: string;
  /**
   * True ONLY on the call where the DD latch first fires for this window.
   * Subsequent calls (cap still reached, latch sticky) return false.
   * Use this to fire a once-per-event alert without spamming on every tick.
   */
  firstTrigger: boolean;
}

// Sticky DD latches. Once a cap is reached during an IST day / week, it
// stays reached for the remainder of that window even if a subsequent
// CLOSED winner pulls realised P&L back below the cap. This matches the
// trader-protection intent: "we hit the loss line today — stop, even if
// we partially recover" — and removes a small race where a stop-close
// pushing DD over cap between check and commit could let one extra
// trade slip through.
//   Latch is in-process only (single-process Node, intraday horizon).
//   Reset implicitly when the window key (date/week) advances.
let dailyDdLatch: { windowStart: string; reachedAt: Date } | null = null;
let weeklyDdLatch: { windowStart: string; reachedAt: Date } | null = null;

/** Daily realised drawdown for the FNO segment (today, IST). Sticky once cap hit. */
export async function getDailyRealizedDrawdown(): Promise<DrawdownReading> {
  const start = istDateKey();
  const realisedPnl = await sumRealisedPnlSince(start);
  const seed = SEED_CAPITAL.FNO;
  const lossPct = realisedPnl < 0 ? -realisedPnl / seed : 0;
  // Window-rollover invalidates a stale latch.
  if (dailyDdLatch && dailyDdLatch.windowStart !== start) dailyDdLatch = null;
  const wasLatched = dailyDdLatch !== null;
  const liveHit = lossPct >= FNO_RISK.MAX_DAILY_LOSS_PCT;
  if (liveHit && !dailyDdLatch) {
    dailyDdLatch = { windowStart: start, reachedAt: new Date() };
  }
  const capReached = liveHit || dailyDdLatch !== null;
  return {
    realisedPnl,
    drawdownPct: lossPct,
    capReached,
    capPct: FNO_RISK.MAX_DAILY_LOSS_PCT,
    windowStart: start,
    firstTrigger: capReached && !wasLatched,
  };
}

/** Trailing-week (Mon→today, IST) realised drawdown for the FNO segment. Sticky once cap hit. */
export async function getWeeklyRealizedDrawdown(): Promise<DrawdownReading> {
  const start = istWeekStartKey();
  const realisedPnl = await sumRealisedPnlSince(start);
  const seed = SEED_CAPITAL.FNO;
  const lossPct = realisedPnl < 0 ? -realisedPnl / seed : 0;
  if (weeklyDdLatch && weeklyDdLatch.windowStart !== start) weeklyDdLatch = null;
  const wasLatched = weeklyDdLatch !== null;
  const liveHit = lossPct >= FNO_RISK.MAX_WEEKLY_LOSS_PCT;
  if (liveHit && !weeklyDdLatch) {
    weeklyDdLatch = { windowStart: start, reachedAt: new Date() };
  }
  const capReached = liveHit || weeklyDdLatch !== null;
  return {
    realisedPnl,
    drawdownPct: lossPct,
    capReached,
    capPct: FNO_RISK.MAX_WEEKLY_LOSS_PCT,
    windowStart: start,
    firstTrigger: capReached && !wasLatched,
  };
}

// ─── Pass-1 Equity DD caps (mirrors the F&O latch system) ──────────────
//
// Same sticky-once-hit semantics as the F&O latches above, just on the
// EQUITY segment with daily/weekly/monthly windows (2/4/8 % of seed).
// `paperTradeEqTable.realizedPnl` is summed for CLOSED rows only —
// open swing P&L doesn't count.

/** First IST day of the current calendar month (YYYY-MM-01). */
function istMonthStartKey(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function sumEqRealisedPnlSince(sinceDateKey: string): Promise<number> {
  const result = await db
    .select({ s: sql<string | null>`COALESCE(SUM(${paperTradeEqTable.realizedPnl}), 0)` })
    .from(paperTradeEqTable)
    .where(
      and(
        eq(paperTradeEqTable.status, "CLOSED"),
        gte(paperTradeEqTable.signalDate, sinceDateKey),
      ),
    );
  return num(result[0]?.s ?? 0);
}

let eqDailyDdLatch: { windowStart: string; reachedAt: Date } | null = null;
let eqWeeklyDdLatch: { windowStart: string; reachedAt: Date } | null = null;
let eqMonthlyDdLatch: { windowStart: string; reachedAt: Date } | null = null;

/** Daily realised drawdown for the EQUITY segment. Sticky once cap hit. */
export async function getEqDailyRealizedDrawdown(): Promise<DrawdownReading> {
  const start = istDateKey();
  const realisedPnl = await sumEqRealisedPnlSince(start);
  const seed = SEED_CAPITAL.EQUITY;
  const lossPct = realisedPnl < 0 ? -realisedPnl / seed : 0;
  if (eqDailyDdLatch && eqDailyDdLatch.windowStart !== start) eqDailyDdLatch = null;
  const wasLatched = eqDailyDdLatch !== null;
  const liveHit = lossPct >= EQUITY_DD_CAPS.MAX_DAILY_LOSS_PCT;
  if (liveHit && !eqDailyDdLatch) {
    eqDailyDdLatch = { windowStart: start, reachedAt: new Date() };
  }
  const capReached = liveHit || eqDailyDdLatch !== null;
  return {
    realisedPnl,
    drawdownPct: lossPct,
    capReached,
    capPct: EQUITY_DD_CAPS.MAX_DAILY_LOSS_PCT,
    windowStart: start,
    firstTrigger: capReached && !wasLatched,
  };
}

/** Trailing-week realised drawdown for the EQUITY segment. Sticky once cap hit. */
export async function getEqWeeklyRealizedDrawdown(): Promise<DrawdownReading> {
  const start = istWeekStartKey();
  const realisedPnl = await sumEqRealisedPnlSince(start);
  const seed = SEED_CAPITAL.EQUITY;
  const lossPct = realisedPnl < 0 ? -realisedPnl / seed : 0;
  if (eqWeeklyDdLatch && eqWeeklyDdLatch.windowStart !== start) eqWeeklyDdLatch = null;
  const wasLatched = eqWeeklyDdLatch !== null;
  const liveHit = lossPct >= EQUITY_DD_CAPS.MAX_WEEKLY_LOSS_PCT;
  if (liveHit && !eqWeeklyDdLatch) {
    eqWeeklyDdLatch = { windowStart: start, reachedAt: new Date() };
  }
  const capReached = liveHit || eqWeeklyDdLatch !== null;
  return {
    realisedPnl,
    drawdownPct: lossPct,
    capReached,
    capPct: EQUITY_DD_CAPS.MAX_WEEKLY_LOSS_PCT,
    windowStart: start,
    firstTrigger: capReached && !wasLatched,
  };
}

/** Calendar-month realised drawdown for the EQUITY segment. Sticky once cap hit. */
export async function getEqMonthlyRealizedDrawdown(): Promise<DrawdownReading> {
  const start = istMonthStartKey();
  const realisedPnl = await sumEqRealisedPnlSince(start);
  const seed = SEED_CAPITAL.EQUITY;
  const lossPct = realisedPnl < 0 ? -realisedPnl / seed : 0;
  if (eqMonthlyDdLatch && eqMonthlyDdLatch.windowStart !== start) eqMonthlyDdLatch = null;
  const wasLatched = eqMonthlyDdLatch !== null;
  const liveHit = lossPct >= EQUITY_DD_CAPS.MAX_MONTHLY_LOSS_PCT;
  if (liveHit && !eqMonthlyDdLatch) {
    eqMonthlyDdLatch = { windowStart: start, reachedAt: new Date() };
  }
  const capReached = liveHit || eqMonthlyDdLatch !== null;
  return {
    realisedPnl,
    drawdownPct: lossPct,
    capReached,
    capPct: EQUITY_DD_CAPS.MAX_MONTHLY_LOSS_PCT,
    windowStart: start,
    firstTrigger: capReached && !wasLatched,
  };
}

/** Test/admin only — clear the in-process DD latches without waiting for the IST rollover. */
export function _resetDdLatchesForTest(): void {
  dailyDdLatch = null;
  weeklyDdLatch = null;
  eqDailyDdLatch = null;
  eqWeeklyDdLatch = null;
  eqMonthlyDdLatch = null;
  return;
}

