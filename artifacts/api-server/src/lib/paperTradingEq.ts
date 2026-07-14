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
import type { PaperTradeEqRow, PaperTradeEqSource } from "@workspace/db";
import type { SwingOrderStagingRow } from "@workspace/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  ensureDailyReset,
  EQUITY_DD_CAPS,
  EQUITY_RISK,
  EQUITY_STOP_SANITY,
  PORTFOLIO_HEAT,
  SEED_CAPITAL,
  HEAT_SQL_EQ,
  parseHeatRow,
  getEqDailyRealizedDrawdown,
  getEqMonthlyRealizedDrawdown,
  getEqWeeklyRealizedDrawdown,
} from "./paperAccount";
import { logger } from "./logger";
import { isPaperAutoTradingEnabled } from "./paperAutoTradeFlag";
import { recordEqDecision, pushEqEvent, type EqEventType } from "./paperEqAudit";
import type { SwingSignal } from "./swingSignals";
import { computeSwingLevels } from "./swingSignals";
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

// ---------------------------------------------------------------------------
// Lifecycle provenance schema migration (Checkpoint 2, 2026-07-03, additive)
// ---------------------------------------------------------------------------

/**
 * Maps the write-path `opts.source` to the richer stored provenance.
 * `SWING_STAGED_APPROVAL` maps to the same-named DB enum value, representing
 * a paper trade opened from the swing staging queue after owner approval.
 */
export function mapWriteSourceToProvenance(source: "AUTO" | "MANUAL" | "SWING_STAGED_APPROVAL" | undefined): PaperTradeEqSource {
  if (source === "MANUAL") return "MANUAL_BUY";
  if (source === "SWING_STAGED_APPROVAL") return "SWING_STAGED_APPROVAL";
  return "AUTO_STRONG_BUY";
}

/**
 * Add the lifecycle-provenance columns to `paper_trade_eq` / `paper_eq_audit`
 * if they do not already exist, then run a one-time idempotent backfill for
 * rows written before these columns existed. Mirrors the proven
 * `swingTtlSweep.ts` / `fnoExitMonitorHealth.ts` pattern: raw
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — NEVER `drizzle-kit push`,
 * which wants to drop out-of-schema tables in this DB.
 *
 * Backfill steps (each idempotent, safe to re-run):
 *   1. Correlate `paper_eq_audit` OPENED rows to `paper_trade_eq` by
 *      (symbol, IST-calendar-day(ts) == signal_date) — the two writes
 *      happen seconds apart in the same request, and the trade table's
 *      (symbol, signal_date) uniqueness makes this a safe join key.
 *      AUTO -> AUTO_STRONG_BUY, MANUAL -> MANUAL_BUY.
 *   2. Any trade row still without a source after that correlation is
 *      honestly labelled LEGACY_UNKNOWN — never fabricated as AUTO/MANUAL.
 *   3. Symmetrically back-link `paper_eq_audit.paper_trade_id` for any
 *      OPENED row that matches an existing trade row (best-effort; new
 *      rows are linked directly at write time instead, see
 *      `openPaperEquityTrade`).
 */
export async function applyPaperEqProvenanceColumns(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE paper_trade_eq
      ADD COLUMN IF NOT EXISTS source TEXT,
      ADD COLUMN IF NOT EXISTS staged_order_id TEXT
  `);
  await db.execute(sql`
    ALTER TABLE paper_eq_audit
      ADD COLUMN IF NOT EXISTS paper_trade_id TEXT
  `);
  await db.execute(sql`
    UPDATE paper_trade_eq t
       SET source = CASE a.source WHEN 'MANUAL' THEN 'MANUAL_BUY' ELSE 'AUTO_STRONG_BUY' END
      FROM paper_eq_audit a
     WHERE t.source IS NULL
       AND a.decision = 'OPEN'
       AND a.symbol = t.symbol
       AND (a.ts AT TIME ZONE 'Asia/Kolkata')::date = t.signal_date
  `);
  await db.execute(sql`
    UPDATE paper_trade_eq
       SET source = 'LEGACY_UNKNOWN'
     WHERE source IS NULL
  `);
  await db.execute(sql`
    UPDATE paper_eq_audit a
       SET paper_trade_id = t.id
      FROM paper_trade_eq t
     WHERE a.paper_trade_id IS NULL
       AND a.decision = 'OPEN'
       AND a.symbol = t.symbol
       AND (a.ts AT TIME ZONE 'Asia/Kolkata')::date = t.signal_date
  `);
}

let paperEqProvenanceMigrationPromise: Promise<void> | null = null;

/**
 * Memoized, idempotent schema-ready gate — first caller triggers the
 * migration + backfill; every subsequent caller (this process lifetime)
 * awaits the same resolved promise. On failure the promise is cleared so a
 * later call can retry (a transient DB blip should not permanently wedge
 * equity paper trading).
 */
export function ensurePaperEqProvenanceColumns(): Promise<void> {
  if (!paperEqProvenanceMigrationPromise) {
    paperEqProvenanceMigrationPromise = applyPaperEqProvenanceColumns().catch((err: unknown) => {
      paperEqProvenanceMigrationPromise = null;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "paper eq provenance: schema column migration failed, will retry on next check",
      );
      throw err;
    });
  }
  return paperEqProvenanceMigrationPromise;
}

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
  opts?: { qtyOverride?: number; source?: "AUTO" | "MANUAL" | "SWING_STAGED_APPROVAL"; signalLabel?: string; stagedOrderId?: string | null },
): Promise<PaperTradeEqRow | null> {
  const sigLabel = opts?.signalLabel ?? "STRONG_BUY";
  const today = signal.signalDate;

  await ensurePaperEqProvenanceColumns();

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
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "INVALID_ENTRY",
      detail: `Invalid entry price ${signal.entryPrice}`, signal: sigLabel, score: signal.score,
      entry: signal.entryPrice, source: opts?.source ?? "AUTO",
    });
    return null;
  }
  if (!(signal.perShareRisk > 0)) {
    logger.info({ symbol: signal.symbol, risk: signal.perShareRisk }, "Paper EQ skip: invalid risk");
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "INVALID_RISK",
      detail: `Invalid per-share risk ${signal.perShareRisk}`, signal: sigLabel, score: signal.score,
      entry: signal.entryPrice, stop: signal.stopPrice, source: opts?.source ?? "AUTO",
    });
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
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "STOP_SANITY",
      detail: `Stop ${(stopPct * 100).toFixed(2)}% outside sanity bounds (${(EQUITY_STOP_SANITY.MIN_STOP_PCT * 100).toFixed(0)}–${(EQUITY_STOP_SANITY.MAX_STOP_PCT * 100).toFixed(0)}%)`,
      signal: sigLabel, score: signal.score,
      entry: signal.entryPrice, stop: signal.stopPrice, source: opts?.source ?? "AUTO",
      emitEvent: opts?.source === "MANUAL" ? {
        type: "BUY_SKIPPED", title: `${signal.symbol} buy rejected`, severity: "warn",
      } : undefined,
    });
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
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "DD_DAILY",
      detail: `Daily DD cap reached: ${(eqDaily.drawdownPct * 100).toFixed(2)}% > ${(EQUITY_DD_CAPS.MAX_DAILY_LOSS_PCT * 100).toFixed(2)}%`,
      signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
    });
    return null;
  }
  if (eqWeekly.capReached) {
    logger.info(
      { symbol: signal.symbol, drawdownPct: +eqWeekly.drawdownPct.toFixed(4),
        capPct: EQUITY_DD_CAPS.MAX_WEEKLY_LOSS_PCT },
      "Paper EQ skip: weekly DD cap reached (sticky)",
    );
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "DD_WEEKLY",
      detail: `Weekly DD cap reached: ${(eqWeekly.drawdownPct * 100).toFixed(2)}% > ${(EQUITY_DD_CAPS.MAX_WEEKLY_LOSS_PCT * 100).toFixed(2)}%`,
      signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
    });
    return null;
  }
  if (eqMonthly.capReached) {
    logger.info(
      { symbol: signal.symbol, drawdownPct: +eqMonthly.drawdownPct.toFixed(4),
        capPct: EQUITY_DD_CAPS.MAX_MONTHLY_LOSS_PCT },
      "Paper EQ skip: monthly DD cap reached (sticky)",
    );
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "DD_MONTHLY",
      detail: `Monthly DD cap reached: ${(eqMonthly.drawdownPct * 100).toFixed(2)}% > ${(EQUITY_DD_CAPS.MAX_MONTHLY_LOSS_PCT * 100).toFixed(2)}%`,
      signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
    });
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
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "NO_ACCT",
          detail: "No EQUITY account row (seed missing)",
          signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
        });
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
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "DAILY_CAP",
          detail: `Daily new-entry cap reached: ${dayCount} ≥ ${EQUITY_RISK.MAX_NEW_PER_DAY}`,
          signal: sigLabel, score: signal.score, balance, source: opts?.source ?? "AUTO",
        });
        return null;
      }
      if (openCount >= EQUITY_RISK.MAX_CONCURRENT) {
        logger.info(
          { symbol: signal.symbol, openCount },
          "Paper EQ skip: concurrent-open cap reached",
        );
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "CONCURRENT_CAP",
          detail: `Concurrent-open cap reached: ${openCount} ≥ ${EQUITY_RISK.MAX_CONCURRENT}`,
          signal: sigLabel, score: signal.score, balance, source: opts?.source ?? "AUTO",
        });
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
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "DEPLOY_LE_0",
          detail: `No deployable capital — balance ₹${balance.toFixed(2)}, accountValue ₹${accountValue.toFixed(2)}`,
          signal: sigLabel, score: signal.score,
          entry: signal.entryPrice, balance, accountValue, source: opts?.source ?? "AUTO",
        });
        return null;
      }
      const autoQty = Math.floor(deploy / signal.entryPrice);
      const qty = opts?.qtyOverride && opts.qtyOverride > 0
        ? Math.floor(opts.qtyOverride)
        : autoQty;
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
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "QTY_LT_1",
          detail: accountDepleted
            ? `Account depleted: deploy ₹${deploy.toFixed(2)} < entry ₹${signal.entryPrice.toFixed(2)} (balance ₹${balance.toFixed(2)})`
            : `Per-slot allocation < 1 share: deploy ₹${deploy.toFixed(2)} / entry ₹${signal.entryPrice.toFixed(2)} (slots ${slots})`,
          signal: sigLabel, score: signal.score,
          entry: signal.entryPrice, deploy, balance, accountValue, source: opts?.source ?? "AUTO",
          emitEvent: opts?.source === "MANUAL" ? {
            type: "BUY_SKIPPED", title: `${signal.symbol} buy rejected`, severity: "warn",
          } : undefined,
        });
        return null;
      }
      const capitalDeployed = qty * signal.entryPrice;
      if (balance < capitalDeployed) {
        logger.info(
          { symbol: signal.symbol, capitalDeployed, balance },
          "Paper EQ skip: insufficient balance after rounding",
        );
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "INSUFF_BAL",
          detail: `Insufficient balance after rounding: needed ₹${capitalDeployed.toFixed(2)}, have ₹${balance.toFixed(2)}`,
          signal: sigLabel, score: signal.score,
          entry: signal.entryPrice, qty, deploy: capitalDeployed, balance, source: opts?.source ?? "AUTO",
        });
        return null;
      }

      // ─── Pass-2B portfolio heat cap (EQUITY-segment) ───────────────
      // Sum of ₹-at-risk across every OPEN equity position must stay
      // below MAX_EQ_HEAT_PCT × seed. New trade's risk = qty × per-share
      // risk (entry - stop). Computed inside the txn so concurrent
      // closes that just freed up heat are honoured. FAIL CLOSED — we
      // do NOT silently shrink (would invalidate the planned RR).
      // Reads via tx.execute so the snapshot honours the account-row
      // FOR UPDATE lock — concurrent opens can't both pass the cap and
      // then collectively breach it on commit.
      const currentEqHeat = parseHeatRow(await tx.execute(HEAT_SQL_EQ));
      const newTradeHeat = qty * signal.perShareRisk;
      const projectedHeat = currentEqHeat + newTradeHeat;
      const heatCap = SEED_CAPITAL.EQUITY * PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT;
      if (projectedHeat > heatCap) {
        logger.info(
          {
            symbol: signal.symbol,
            currentHeat: +currentEqHeat.toFixed(2),
            newTradeHeat: +newTradeHeat.toFixed(2),
            projectedHeat: +projectedHeat.toFixed(2),
            heatCap: +heatCap.toFixed(2),
            maxHeatPct: PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT,
          },
          `Paper EQ skip: portfolio heat cap would be breached (${(projectedHeat / SEED_CAPITAL.EQUITY * 100).toFixed(2)}% > ${(PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT * 100).toFixed(2)}%)`,
        );
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "HEAT_CAP",
          detail: `Heat cap would be breached: ${(projectedHeat / SEED_CAPITAL.EQUITY * 100).toFixed(2)}% > ${(PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT * 100).toFixed(2)}%`,
          signal: sigLabel, score: signal.score,
          entry: signal.entryPrice, stop: signal.stopPrice, qty, source: opts?.source ?? "AUTO",
        });
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
          source: mapWriteSourceToProvenance(opts?.source),
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        logger.info({ symbol: signal.symbol }, "Paper EQ skip: trade row already exists for symbol+day");
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "DUPLICATE",
          detail: "Already opened today (symbol+day unique constraint)",
          signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
        });
        return null;
      }

      // Link to the originating staging order when opened from the swing queue.
      // staged_order_id is an out-of-schema column (added via ALTER TABLE in
      // applyPaperEqProvenanceColumns) — set it via raw SQL, never drizzle insert.
      if (opts?.stagedOrderId != null) {
        await tx.execute(
          sql`UPDATE paper_trade_eq SET staged_order_id = ${opts.stagedOrderId} WHERE id = ${inserted[0]!.id}`,
        );
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
      const isManual = opts?.source === "MANUAL";
      const isSwingApproval = opts?.source === "SWING_STAGED_APPROVAL";
      const actionLabel = isManual ? "Manual" : isSwingApproval ? "Swing queue" : "Auto";
      await recordEqDecision({
        symbol: signal.symbol, decision: "OPEN", reason: "OPENED",
        detail: `${actionLabel} buy filled: ${qty} × ₹${signal.entryPrice.toFixed(2)} (stop ₹${signal.stopPrice.toFixed(2)}, T1 ₹${signal.target1Price.toFixed(2)}, T2 ₹${signal.target2Price.toFixed(2)})`,
        signal: sigLabel, score: signal.score,
        entry: signal.entryPrice, stop: signal.stopPrice, qty,
        deploy: capitalDeployed, balance: num(debited[0]!.balance),
        source: opts?.source ?? "AUTO",
        paperTradeId: inserted[0]!.id,
        emitEvent: {
          type: isManual || isSwingApproval ? "MANUAL_BUY" : "BUY_EXECUTED",
          title: `${isManual ? "Manual buy" : isSwingApproval ? "Swing queue buy" : "Buy filled"}: ${signal.symbol}`,
          severity: "success",
        },
      });
      return inserted[0]!;
    });
  } catch (err) {
    if ((err as Error).message === "paper_eq_open_aborted_cap_or_balance") {
      logger.info(
        { symbol: signal.symbol },
        "Paper EQ skip: txn aborted (cap/balance lost the race)",
      );
      await recordEqDecision({
        symbol: signal.symbol, decision: "SKIP", reason: "TXN_ABORT",
        detail: "Transaction aborted — concurrent open won the cap/balance race",
        signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
      });
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
    const sevMap: Record<EquityExitReason, "success" | "warn" | "error" | "info"> = {
      TARGET2_HIT: "success",
      TRAIL_STOP_HIT: "success",
      STOPPED: "error",
      SIGNAL_FLIP: "warn",
      TIME_STOP: "info",
      MANUAL_OVERRIDE: "info",
    };
    const typeMap: Record<EquityExitReason, EqEventType> = {
      TARGET2_HIT: "TARGET2_HIT",
      TRAIL_STOP_HIT: "SL_HIT",
      STOPPED: "SL_HIT",
      SIGNAL_FLIP: "SIGNAL_FLIP",
      TIME_STOP: "TIME_STOP",
      MANUAL_OVERRIDE: "MANUAL_CLOSE",
    };
    const titleMap: Record<EquityExitReason, string> = {
      TARGET2_HIT: `Target 2 hit: ${row.symbol}`,
      TRAIL_STOP_HIT: `Trailed stop hit: ${row.symbol}`,
      STOPPED: `Stop loss hit: ${row.symbol}`,
      SIGNAL_FLIP: `Signal flipped — exit: ${row.symbol}`,
      TIME_STOP: `Time stop: ${row.symbol}`,
      MANUAL_OVERRIDE: `Manual close: ${row.symbol}`,
    };
    pushEqEvent({
      type: typeMap[reason],
      symbol: row.symbol,
      title: titleMap[reason],
      detail: `${row.qty} × ₹${num(row.entryPrice).toFixed(2)} → ₹${exitPrice.toFixed(2)} · P&L ₹${realizedPnl.toFixed(0)}`,
      source: reason === "MANUAL_OVERRIDE" ? "manual" : "auto",
      severity: sevMap[reason],
    });
    return updated[0]!;
  });
}

/**
 * Manual paper-buy from the UI. Bypasses the STRONG_BUY / score / sector
 * / volume filters that gate the auto-swing tick, but keeps every
 * capital / risk safety net (stop-sanity 1-8%, daily/weekly/monthly DD
 * caps, MAX_NEW_PER_DAY, MAX_CONCURRENT, balance check, heat cap, and
 * (symbol, signal_date) idempotency).
 *
 * Stop & targets are still derived from `computeSwingLevels` so the
 * lifecycle evaluator (trail-to-T1 / TARGET2_HIT / STOPPED / TIME_STOP)
 * works identically to an auto-opened trade.
 *
 * Caller supplies the `StockRow` from the scanner cache (so this
 * function stays free of any fullNseScanner import — the route handler
 * does the lookup). Returns `{ row, reason }` so the API can surface a
 * meaningful error to the user when a gate rejects the trade.
 */
export async function openManualPaperEquityTrade(
  row: StockRow,
  opts?: { qty?: number },
): Promise<{ row: PaperTradeEqRow | null; reason: string | null }> {
  const today = istDateKey();
  await ensurePaperEqProvenanceColumns();
  // Same-day duplicate guard. The DB has a UNIQUE (symbol, signalDate)
  // index and openPaperEquityTrade short-circuits to the existing row
  // on a hit — but it returns that row regardless of status, which the
  // manual route would otherwise mis-report as "Buy filled". Surface
  // the duplicate explicitly here so the UI can show "already traded
  // this symbol today" instead.
  const existing = await db
    .select()
    .from(paperTradeEqTable)
    .where(
      and(
        eq(paperTradeEqTable.symbol, row.symbol),
        eq(paperTradeEqTable.signalDate, today),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    const status = existing[0]!.status;
    return {
      row: null,
      reason: status === "OPEN"
        ? `${row.symbol} already has an OPEN paper position from earlier today — close it before re-entering.`
        : `${row.symbol} was already traded today (status: ${status}). Same-symbol re-entry is blocked until tomorrow.`,
    };
  }
  const ltp = row.quote.price;
  if (!(ltp > 0)) {
    return { row: null, reason: "Invalid LTP for symbol — scanner has no price." };
  }
  const levels = await computeSwingLevels(row.symbol);
  if (!levels) {
    return { row: null, reason: "Insufficient price history to compute ATR/swing-low stop." };
  }
  const entryPrice = ltp;
  const { atr14, swing20Low } = levels;
  const atrStop = entryPrice - 1.5 * atr14;
  const stopPrice = Math.max(atrStop, swing20Low);
  if (!(stopPrice > 0) || stopPrice >= entryPrice) {
    return { row: null, reason: "Computed stop is at or above entry — degenerate setup." };
  }
  const r = entryPrice - stopPrice;
  const target1Price = entryPrice + 2 * r;
  const target2Price = entryPrice + 3 * r;
  const now = new Date();
  const signal: SwingSignal = {
    symbol: row.symbol,
    name: row.name,
    exchange: "NSE",
    triggeredAt: now,
    signalDate: istDateKey(now),
    score: row.recommendation.score ?? 0,
    entryPrice,
    stopPrice,
    target1Price,
    target2Price,
    perShareRisk: r,
    atr14,
    swing20Low,
    // ATR and swing-low on this path always come from Yahoo daily bars (delayed).
    levelsSource: "yahoo",
    levelsWarnings: [],
  };
  logger.info(
    { symbol: row.symbol, entry: entryPrice, stop: stopPrice, t1: target1Price, t2: target2Price, qtyOverride: opts?.qty ?? null },
    "Paper EQ manual buy: attempting open",
  );
  const opened = await openPaperEquityTrade(signal, {
    qtyOverride: opts?.qty,
    source: "MANUAL",
    signalLabel: row.recommendation.signal,
  });
  if (!opened) {
    return {
      row: null,
      reason: "Trade rejected by a safety gate (cap, balance, drawdown, heat, or duplicate). See server logs for the specific reason.",
    };
  }
  return { row: opened, reason: null };
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
        pushEqEvent({
          type: "TRAIL_TO_T1",
          symbol: row.symbol,
          title: `Stop trailed to T1: ${row.symbol}`,
          detail: `LTP ₹${ltp.toFixed(2)} ≥ T1 ₹${t1.toFixed(2)} — new stop ₹${t1.toFixed(2)}`,
          source: "auto",
          severity: "success",
        });
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
  // Read-only-mode short-circuit on auto opens. Mark-to-market
  // (`evaluatePaperEquityTrades`) still runs so existing OPEN
  // positions move as expected — we only suppress the auto opener.
  const autoOpensEnabled = isPaperAutoTradingEnabled();

  // Open new trades first so they participate in this same tick's
  // evaluator pass (cheap because the new row's LTP is by definition
  // its entry → no immediate exit unless ATR was zero, which we
  // already rejected upstream).
  if (autoOpensEnabled) for (const s of signals) {
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

/**
 * Open a paper equity trade from an already-approved swing staging order.
 *
 * Builds the minimum-viable `SwingSignal` from the staging row's frozen plan
 * and delegates to `openPaperEquityTrade`. All safety gates (DD caps, heat
 * cap, stop-sanity, daily limits) still apply — an approved staging row is
 * NOT guaranteed to open if a cap was hit after approval.
 *
 * The staging row's `quantity` is used as `qtyOverride` so the pre-computed
 * sizing (set at stage time with full risk calculations) is stable across the
 * approval delay. The `atr14` is back-derived from the stop distance using
 * the standard 1.5× multiplier — it is only used for audit logging, never
 * for sizing.
 *
 * Returns the opened `PaperTradeEqRow`, or `null` if any gate blocked the
 * open. Never places real broker orders — paper only.
 */
export async function openPaperEquityTradeFromStagedOrder(
  stagingRow: SwingOrderStagingRow,
): Promise<PaperTradeEqRow | null> {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const signalDate = ist.toISOString().slice(0, 10);

  const perShareRisk = stagingRow.entryPrice - stagingRow.stopLoss;
  if (!(perShareRisk > 0)) {
    logger.warn(
      { stagingId: stagingRow.id, entry: stagingRow.entryPrice, stop: stagingRow.stopLoss },
      "openPaperEquityTradeFromStagedOrder: invalid per-share risk (entry ≤ stop) — skip",
    );
    return null;
  }
  // ATR(14) is not stored in the staging snapshot; approximate from the stop
  // formula (stop ≈ entry − 1.5 × ATR) so the SwingSignal type contract is
  // satisfied. The value only appears in audit log fields — it does not affect
  // sizing because qtyOverride overrides the quantity calculation entirely.
  const atr14Approx = perShareRisk / 1.5;

  const signal: SwingSignal = {
    symbol: stagingRow.symbol,
    name: stagingRow.symbol,              // no dedicated name column in staging
    exchange: stagingRow.exchange ?? "NSE",
    triggeredAt: now,
    signalDate,
    score: 0,                             // score not persisted in staging row
    entryPrice: stagingRow.entryPrice,
    stopPrice: stagingRow.stopLoss,
    target1Price: stagingRow.target1,
    target2Price: stagingRow.target2 ?? stagingRow.target1,
    perShareRisk,
    atr14: atr14Approx,
    swing20Low: stagingRow.stopLoss,      // conservative: swing low ≤ stop level
    levelsSource: "yahoo",                // conservative — original calc was Yahoo-based
    levelsWarnings: ["levels restored from staged snapshot; not re-computed at approval"],
  };

  return openPaperEquityTrade(signal, {
    qtyOverride: stagingRow.quantity,
    source: "SWING_STAGED_APPROVAL",
    stagedOrderId: stagingRow.id,
    signalLabel: "SWING_QUEUE_APPROVED",
  });
}

// `ne`/`istDateKey` re-exported for the routes layer's manual exits.
export { ne, istDateKey };
