/**
 * Paper trading state.
 *
 * OWNER-ONLY system. There is exactly one paper account per segment
 * ("FNO" / "EQUITY"). The account is auto-seeded on first read and
 * auto-refilled (reset balance to seed_capital, zero day counters)
 * once per IST trading day so that each day's signals can be tested
 * with the full bankroll. Cumulative P&L lives on individual trade
 * rows, not on the account row, so a daily refill never erases history.
 *
 * paper_trade_fo represents one virtual options position. The composite
 * (signalDate, indexSymbol, setupKey, direction) refers to a row in
 * `option_signal_history` — there is at most one paper trade per signal
 * (enforced by a unique constraint on that 4-tuple) so we cannot
 * accidentally double-open if the lifecycle hook fires twice for the
 * same TRIGGERED transition.
 */
import {
  pgTable,
  varchar,
  text,
  timestamp,
  numeric,
  integer,
  date,
  index,
  uniqueIndex,
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
