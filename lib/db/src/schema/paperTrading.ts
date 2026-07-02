/**
 * Paper trading state.
 *
 * OWNER-ONLY system. There is exactly one paper account per segment
 * ("FNO" / "EQUITY").
 *
 *   - FNO is intraday by design: the account auto-refills balance to
 *     seed_capital and zeroes day counters once per IST trading day.
 *     Cumulative P&L lives on individual trade rows so the refill never
 *     erases history.
 *
 *   - EQUITY is a multi-day swing book: capital stays locked in OPEN
 *     positions across days, so the daily reset for EQUITY only zeroes
 *     day_trade_count + day_open_count and DOES NOT touch balance.
 *
 * paper_trade_fo represents one virtual options position. The composite
 * (signalDate, indexSymbol, setupKey, direction) refers to a row in
 * `option_signal_history` — there is at most one paper trade per signal
 * (enforced by a unique constraint on that 4-tuple) so we cannot
 * accidentally double-open if the lifecycle hook fires twice for the
 * same TRIGGERED transition.
 *
 * paper_trade_eq represents one virtual equity-delivery position. The
 * unique (symbol, openedDate) index prevents the swing scanner from
 * double-loading the same stock on the same IST day even if the
 * STRONG_BUY recommendation flips on/off between scanner ticks.
 */
import {
  pgTable,
  varchar,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  date,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One row per segment. PK is the segment string itself ("FNO" | "EQUITY")
 * so we can `INSERT ... ON CONFLICT (segment) DO ...` for upserts.
 */
export const paperAccountTable = pgTable("paper_account", {
  segment: text("segment").primaryKey(),
  /** Starting capital each new IST day refills back to this number. */
  seedCapital: numeric("seed_capital", { precision: 18, scale: 2 }).notNull(),
  /** Live cash balance (seed - capital_deployed_today + closed_proceeds_today). */
  balance: numeric("balance", { precision: 18, scale: 2 }).notNull(),
  /** Realised P&L for the current trading day. Reset on daily refill. */
  dayRealizedPnl: numeric("day_realized_pnl", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  /** Number of paper trades opened today (counts toward the 4/day F&O cap). */
  dayTradeCount: integer("day_trade_count").notNull().default(0),
  /** Number of paper trades currently OPEN. */
  dayOpenCount: integer("day_open_count").notNull().default(0),
  /** IST date string (YYYY-MM-DD) of the last refill. */
  lastResetDate: date("last_reset_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaperAccountRow = typeof paperAccountTable.$inferSelect;
export type NewPaperAccountRow = typeof paperAccountTable.$inferInsert;

/**
 * One row per paper F&O position. Linked to option_signal_history via
 * the 4-tuple key so the lifecycle hook can find / open / close.
 */
export const paperTradeFoTable = pgTable(
  "paper_trade_fo",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

    // Foreign-key tuple to option_signal_history (no DB FK declared because
    // option_signal_history's PK is a 4-tuple and Drizzle's compositeFK
    // ergonomics are noisy; the unique index below guarantees 1:1).
    signalDate: date("signal_date").notNull(),
    indexSymbol: text("index_symbol").notNull(),
    setupKey: text("setup_key").notNull(),
    direction: text("direction").notNull(), // BULLISH | BEARISH

    // Display fields denormalised so the UI doesn't need a join.
    indexName: text("index_name").notNull(),
    optionType: text("option_type").notNull(), // CE | PE
    strike: numeric("strike", { precision: 18, scale: 4 }).notNull(),

    // Position sizing.
    lots: integer("lots").notNull(),
    lotSize: integer("lot_size").notNull(),

    // Locked OPTION premium plan (NOT spot levels). Frozen at open.
    entryPremium: numeric("entry_premium", { precision: 18, scale: 4 }).notNull(),
    stopPremium: numeric("stop_premium", { precision: 18, scale: 4 }).notNull(),
    target1Premium: numeric("target1_premium", { precision: 18, scale: 4 }).notNull(),
    target2Premium: numeric("target2_premium", { precision: 18, scale: 4 }).notNull(),

    /** Capital deployed at open = lots * entryPremium * lotSize. */
    capitalDeployed: numeric("capital_deployed", { precision: 18, scale: 2 }).notNull(),

    /** Last known live option premium — updated on every lifecycle re-evaluation. */
    lastPremium: numeric("last_premium", { precision: 18, scale: 4 }).notNull(),

    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    status: text("status").notNull().default("OPEN"), // OPEN | CLOSED

    // Closed-trade fields (NULL while OPEN).
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    exitPremium: numeric("exit_premium", { precision: 18, scale: 4 }),
    /**
     * Why the trade closed. One of:
     *   TARGET1_HIT | TARGET2_HIT | STOPPED | EXPIRED | MANUAL_OVERRIDE
     */
    exitReason: text("exit_reason"),
    /** Realised P&L = (exitPremium - entryPremium) * lots * lotSize. */
    realizedPnl: numeric("realized_pnl", { precision: 18, scale: 2 }),

    /** Best unrealised P&L observed while the trade was open. */
    maxRunup: numeric("max_runup", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Worst unrealised P&L observed while the trade was open. */
    maxDrawdown: numeric("max_drawdown", { precision: 18, scale: 2 }).notNull().default("0"),

    /**
     * Forward premium-path capture (additive 2026-06-10, nullable on purpose).
     * The actual option-premium high/low watermarks observed by the MTM sweep
     * AFTER entry, plus the IST instant each watermark was set. These let the
     * cockpit compute a TRUE premium-path MFE/MAE for trades opened from this
     * point on. Pre-change rows are left NULL and stay HONESTLY unavailable —
     * never backfilled, never fabricated.
     */
    highestPremiumAfterEntry: numeric("highest_premium_after_entry", { precision: 18, scale: 2 }),
    highestPremiumAt: timestamp("highest_premium_at", { withTimezone: true }),
    lowestPremiumAfterEntry: numeric("lowest_premium_after_entry", { precision: 18, scale: 2 }),
    lowestPremiumAt: timestamp("lowest_premium_at", { withTimezone: true }),

    journal: text("journal"),
    tags: text("tags").array(),

    /**
     * F&O Exit Monitoring Reliability audit columns (additive 2026-07-02,
     * all nullable — pre-change rows stay honestly NULL, never backfilled).
     * Applied via raw `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in
     * `applyFnoExitMonitorSchemaColumns()` (fnoExitMonitorHealth.ts), NEVER
     * `drizzle-kit push` (would attempt to drop out-of-schema tables in
     * this DB). See fnoExitDecision.ts for the trust-gate that populates
     * these fields.
     */
    /** When the trade actually transitioned to a terminal exit status (may differ from exitedAt only in edge cases; kept for audit parity with quote checks). */
    exitDetectedAt: timestamp("exit_detected_at", { withTimezone: true }),
    /** DataQualityLabel of the spot quote that decided/attempted this exit check. */
    exitQuoteSource: text("exit_quote_source"),
    /** ms-epoch-derived timestamp of that quote, stored as a timestamptz. */
    exitQuoteAsOf: timestamp("exit_quote_as_of", { withTimezone: true }),
    /** Age of that quote in seconds at evaluation time. */
    exitQuoteFreshnessSec: integer("exit_quote_freshness_sec"),
    /** Whether the quote that produced this row's current state was trade-grade (Kite live, fresh, session active). */
    exitTradeGrade: boolean("exit_trade_grade"),
    /** MONITORED | BLOCKED | UNMONITORED — last exit-check outcome class for this row. */
    exitMonitorStatus: text("exit_monitor_status"),
    /** Wall-clock time of the most recent exit-monitor evaluation attempt for this row (updates even when the outcome is BLOCKED or HOLD). */
    lastExitCheckAt: timestamp("last_exit_check_at", { withTimezone: true }),
    /** Last exit-check error message, if the evaluation itself threw (distinct from a BLOCKED decision, which is not an error). */
    lastExitCheckError: text("last_exit_check_error"),
    /** SENT | FAILED | SKIPPED_CONFIG_MISSING — outcome of the exit Telegram notification for this trade, if it closed. */
    exitNotificationStatus: text("exit_notification_status"),
  },
  (t) => ({
    // 1:1 with the underlying signal — prevents the lifecycle hook from
    // ever opening a second paper trade if it fires twice for the same
    // TRIGGERED transition (e.g. due to retry).
    sigUq: uniqueIndex("paper_trade_fo_signal_uq").on(
      t.signalDate,
      t.indexSymbol,
      t.setupKey,
      t.direction,
    ),
    dateIdx: index("paper_trade_fo_date_idx").on(t.signalDate),
    statusIdx: index("paper_trade_fo_status_idx").on(t.status),
    openIdx: index("paper_trade_fo_open_idx").on(t.signalDate, t.status),
  }),
);

export type PaperTradeFoRow = typeof paperTradeFoTable.$inferSelect;
export type NewPaperTradeFoRow = typeof paperTradeFoTable.$inferInsert;

/**
 * One row per paper EQUITY (delivery) position. Linked to a real NSE
 * equity symbol; held across multiple IST trading days. The unique
 * (symbol, openedDate) index prevents the swing scanner from opening
 * the same stock twice on the same day even if STRONG_BUY toggles on
 * and off between scanner ticks.
 */
export const paperTradeEqTable = pgTable(
  "paper_trade_eq",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

    /** NSE trading symbol (e.g. "RELIANCE", "TCS"). */
    symbol: text("symbol").notNull(),
    /** Display name (company name as known by the scanner). */
    name: text("name").notNull(),
    /** Always "NSE" today; future-proofed for BSE delivery. */
    exchange: text("exchange").notNull().default("NSE"),

    /** IST date the signal fired (YYYY-MM-DD). */
    signalDate: date("signal_date").notNull(),
    /** Wall-clock instant the scanner first saw STRONG_BUY for this row. */
    signalTriggeredAt: timestamp("signal_triggered_at", {
      withTimezone: true,
    }).notNull(),

    /** Number of shares purchased. */
    qty: integer("qty").notNull(),

    /** Locked entry plan (frozen at open). */
    entryPrice: numeric("entry_price", { precision: 18, scale: 4 }).notNull(),
    stopPrice: numeric("stop_price", { precision: 18, scale: 4 }).notNull(),
    target1Price: numeric("target1_price", { precision: 18, scale: 4 }).notNull(),
    target2Price: numeric("target2_price", { precision: 18, scale: 4 }).notNull(),

    /**
     * True once price has touched target1 and the stop has been trailed
     * up to entry's target1 level. While true, the position rides for
     * target2 with stopPrice = (original) target1Price.
     */
    trailedToT1: integer("trailed_to_t1").notNull().default(0),

    /** Capital deployed at open = qty * entryPrice. */
    capitalDeployed: numeric("capital_deployed", { precision: 18, scale: 2 }).notNull(),

    /** Last LTP observed by the swing evaluator. */
    lastPrice: numeric("last_price", { precision: 18, scale: 4 }).notNull(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),

    status: text("status").notNull().default("OPEN"), // OPEN | CLOSED

    // Closed-trade fields (NULL while OPEN).
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    exitPrice: numeric("exit_price", { precision: 18, scale: 4 }),
    /**
     * One of:
     *   TARGET2_HIT | STOPPED | TRAIL_STOP_HIT | TIME_STOP |
     *   SIGNAL_FLIP | MANUAL_OVERRIDE
     */
    exitReason: text("exit_reason"),
    /** Realised P&L = (exitPrice - entryPrice) * qty. */
    realizedPnl: numeric("realized_pnl", { precision: 18, scale: 2 }),

    /** Best unrealised P&L observed while the trade was open (₹). */
    maxRunup: numeric("max_runup", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Worst unrealised P&L observed while the trade was open (₹). */
    maxDrawdown: numeric("max_drawdown", { precision: 18, scale: 2 }).notNull().default("0"),

    journal: text("journal"),
    tags: text("tags").array(),
  },
  (t) => ({
    // One open trade per symbol per IST day.
    symbolDayUq: uniqueIndex("paper_trade_eq_symbol_day_uq").on(
      t.symbol,
      t.signalDate,
    ),
    statusIdx: index("paper_trade_eq_status_idx").on(t.status),
    symbolStatusIdx: index("paper_trade_eq_symbol_status_idx").on(
      t.symbol,
      t.status,
    ),
    exitedAtIdx: index("paper_trade_eq_exited_at_idx").on(t.exitedAt),
  }),
);

export type PaperTradeEqRow = typeof paperTradeEqTable.$inferSelect;
export type NewPaperTradeEqRow = typeof paperTradeEqTable.$inferInsert;

/**
 * Equity-side decision audit trail. One row per "would-be trade" event:
 *   - OPEN  : an equity paper trade was actually opened
 *   - SKIP  : the auto/manual open was rejected by one of the gates
 *
 * `reason` is machine-readable (STOP_SANITY, DD_DAILY, QTY_LT_1, etc) so
 * the UI can group / colour-code; `detail` is the matching human-readable
 * message that previously only existed in server logs. Surfaces the same
 * information the user used to have to grep `pino` output for.
 *
 * Owner-only by design — exposed via GET /paper/audit/eq.
 */
export const paperEqAuditTable = pgTable(
  "paper_eq_audit",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    symbol: text("symbol").notNull(),
    /** Recommendation signal at the time of the decision (STRONG_BUY / BUY / etc). May be null for manual opens. */
    signal: text("signal"),
    /** Recommendation score 0-100 (or null for manual opens with no row). */
    score: numeric("score", { precision: 8, scale: 2 }),
    /** OPEN | SKIP */
    decision: text("decision").notNull(),
    /** Machine-readable reason code. See paperEqAudit.ts for the enum. */
    reason: text("reason").notNull(),
    /** Human-readable detail (mirrors the previous logger message). */
    detail: text("detail"),
    /** Snapshot of the planned entry / stop / qty / deploy / balance at decision time. All optional. */
    entry: numeric("entry", { precision: 18, scale: 4 }),
    stop: numeric("stop", { precision: 18, scale: 4 }),
    qty: integer("qty"),
    deploy: numeric("deploy", { precision: 18, scale: 2 }),
    balance: numeric("balance", { precision: 18, scale: 2 }),
    accountValue: numeric("account_value", { precision: 18, scale: 2 }),
    /** "AUTO" (swing scanner tick) or "MANUAL" (UI buy click). */
    source: text("source").notNull().default("AUTO"),
  },
  (t) => ({
    tsIdx: index("paper_eq_audit_ts_idx").on(t.ts),
    symbolTsIdx: index("paper_eq_audit_symbol_ts_idx").on(t.symbol, t.ts),
  }),
);

export type PaperEqAuditRow = typeof paperEqAuditTable.$inferSelect;
export type NewPaperEqAuditRow = typeof paperEqAuditTable.$inferInsert;

/**
 * Daily F&O paper-trader summary snapshot (2026-05-11.d, reviewer-requested
 * historical trail). One row per IST trading day. Persisted at EOD by the
 * scheduler in `optionSignals.ts` (15:35 IST latch, after the 15:20 force-
 * exit) AND on every read of the live endpoint as an upsert — so an
 * intra-day refresh updates the row in place and the EOD tick locks in
 * the final values. PK is the IST date so `ON CONFLICT (date) DO UPDATE`
 * is the natural shape.
 *
 * Mirrors the live `/paper/diagnostics/daily-summary/fo` payload one-to-one
 * so a future `…/history` query can be surfaced on the same UI without
 * any re-shaping. `skippedByReason` and `alerts` are stored as JSONB to
 * preserve the open-ended SkipReason union and forward-compat alert keys.
 */
export const paperDailySummaryFoTable = pgTable("paper_daily_summary_fo", {
  date: date("date").primaryKey(),
  signalsGenerated: integer("signals_generated").notNull(),
  tradesOpened: integer("trades_opened").notNull(),
  tradesClosed: integer("trades_closed").notNull(),
  baselineOpened: integer("baseline_opened").notNull(),
  hcOpened: integer("hc_opened").notNull(),
  validCandidates: integer("valid_candidates").notNull(),
  /** opened / (opened + skipped). NULL when no candidates (avoids 0/0). */
  tradeOpenRate: numeric("trade_open_rate", { precision: 6, scale: 4 }),
  skippedTotal: integer("skipped_total").notNull(),
  /** [{ key: SkipReason, count: number }, …] sorted desc by count. */
  skippedByReason: jsonb("skipped_by_reason").notNull().default([]),
  baselinePnl: numeric("baseline_pnl", { precision: 18, scale: 2 }).notNull(),
  hcPnl: numeric("hc_pnl", { precision: 18, scale: 2 }).notNull(),
  totalPnl: numeric("total_pnl", { precision: 18, scale: 2 }).notNull(),
  scratchesCount: integer("scratches_count").notNull(),
  manualOverridesCount: integer("manual_overrides_count").notNull(),
  /** { baselineStatsUnavailable: { count, lastAt } } — process-level counters
   *  snapshotted at write time. Process restart resets the counter, so
   *  the historical row preserves the *peak* observed value for that day. */
  alerts: jsonb("alerts").notNull().default({}),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaperDailySummaryFoRow = typeof paperDailySummaryFoTable.$inferSelect;
export type NewPaperDailySummaryFoRow = typeof paperDailySummaryFoTable.$inferInsert;

/**
 * Manual capital movements (owner top-ups and withdrawals) on a paper
 * account. Append-only ledger — one row per ADD_CAPITAL / WITHDRAW_CAPITAL
 * action. This is bookkeeping ONLY: capital moves are NOT trading P&L and
 * never feed realised/lifetime P&L, drawdown, or heat. The running cash
 * effect lives on paper_account.balance; this table records the trail so
 * the account card can show "capital added / withdrawn" honestly without
 * inferring it from balance deltas.
 *
 * Additive table — created via `CREATE TABLE IF NOT EXISTS` (never
 * `drizzle-kit push`, which would drop out-of-schema tables). No backfill.
 */
export const paperCapitalEventTable = pgTable(
  "paper_capital_event",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    /** "FNO" | "EQUITY" — matches paper_account.segment. */
    segment: text("segment").notNull(),
    /** "ADD_CAPITAL" | "WITHDRAW_CAPITAL". */
    kind: text("kind").notNull(),
    /** Always a positive magnitude in ₹. Direction is encoded by `kind`. */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    /** Cash balance AFTER this movement was applied. */
    balanceAfter: numeric("balance_after", { precision: 18, scale: 2 }).notNull(),
    /** Optional free-text annotation supplied by the owner (nullable). */
    note: text("note"),
    /**
     * Who initiated the movement (nullable). These routes are owner-only, so
     * this is "owner" in practice; kept additive/nullable for the historical
     * rows that predate the column.
     */
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    segmentCreatedIdx: index("paper_capital_event_segment_created_idx").on(
      t.segment,
      t.createdAt,
    ),
  }),
);

export type PaperCapitalEventRow = typeof paperCapitalEventTable.$inferSelect;
export type NewPaperCapitalEventRow = typeof paperCapitalEventTable.$inferInsert;
