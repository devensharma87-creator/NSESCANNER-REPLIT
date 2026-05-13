/**
 * Paper-trading COMBO lane (Tier C, Phase 1).
 *
 * Separate from `paper_trade_fo` by design — see
 * `docs/combo-paper-trader-design.md` for the rationale. Single-leg signal
 * trades stay in `paper_trade_fo`; multi-leg manual combos live here so:
 *
 *   - F&O auto-trader (`runFnoPaperTradingTick`) cannot accidentally see
 *     combo legs (it only queries `paper_trade_fo`).
 *   - Combo P&L is rolled up at the combo level (the only level the user
 *     cares about) instead of being reconstructed from leg rows.
 *   - Combo lane has its own guardrails (no shared heat budget with single-
 *     leg F&O).
 *
 * v1 is MANUAL ENTRY ONLY. There is no auto-open path. The user clicks
 * "Open as combo" from the Strategy Builder; the server reprices every
 * leg from the live chain at open time and at every MTM tick. Client
 * never supplies premium / Greeks / margin / P&L — they are computed
 * server-side or stored from the server's own snapshot.
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
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One row per combo. The combo's frozen open-time snapshot lives here;
 * per-leg data lives in `paper_trade_combo_leg` for clean joins.
 *
 * `buildSnapshot` is the full server-computed `CustomStrategyResponse` at
 * open time — kept for audit so we can later answer "what did the server
 * actually fill this combo at?" without recomputing.
 */
export const paperTradeComboTable = pgTable(
  "paper_trade_combo",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

    // ── Position identity ────────────────────────────────────────────
    underlying: text("underlying").notNull(),
    expiry: date("expiry").notNull(),
    /** Optional human label, e.g. "BULL_CALL_SPREAD" / "Custom 4-leg". */
    strategyName: text("strategy_name"),
    lotSize: integer("lot_size").notNull(),

    // ── Lifecycle ────────────────────────────────────────────────────
    status: text("status").notNull().default("OPEN"), // OPEN | CLOSED
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** MANUAL | EXPIRY (Phase-1 supports MANUAL only; EXPIRY reserved). */
    closeReason: text("close_reason"),

    // ── Entry snapshot (frozen at open, all server-computed) ─────────
    spotAtEntry: numeric("spot_at_entry", { precision: 18, scale: 4 }).notNull(),
    /** ₹/share, signed (positive = debit, negative = credit). */
    netDebitEntry: numeric("net_debit_entry", { precision: 18, scale: 4 }).notNull(),
    /** Per-lot ₹. NULL = unbounded. */
    maxProfitEntry: numeric("max_profit_entry", { precision: 18, scale: 2 }),
    /** Per-lot ₹. NULL = unbounded. */
    maxLossEntry: numeric("max_loss_entry", { precision: 18, scale: 2 }),
    breakevensEntry: jsonb("breakevens_entry").notNull().default([]),
    netGreeksEntry: jsonb("net_greeks_entry").notNull().default({}),
    /** Server estimate at open. */
    marginRequired: numeric("margin_required", { precision: 18, scale: 2 }).notNull(),
    /** Capital actually committed to this combo (max(netDebit*qty, marginRequired)). */
    capitalDeployed: numeric("capital_deployed", { precision: 18, scale: 2 }).notNull(),

    // ── Live MTM (refreshed by tick + on read) ───────────────────────
    spotLast: numeric("spot_last", { precision: 18, scale: 4 }),
    /** Current mark, signed ₹. NULL until first MTM. */
    netMtm: numeric("net_mtm", { precision: 18, scale: 2 }),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),

    // ── Realised (set on CLOSED) ─────────────────────────────────────
    realizedPnl: numeric("realized_pnl", { precision: 18, scale: 2 }),

    // ── Audit ────────────────────────────────────────────────────────
    journal: text("journal"),
    /** Full server-computed `CustomStrategyResponse` at open time. */
    buildSnapshot: jsonb("build_snapshot").notNull(),
  },
  (t) => ({
    statusIdx: index("paper_trade_combo_status_idx").on(t.status),
    underlyingStatusIdx: index("paper_trade_combo_underlying_status_idx").on(
      t.underlying,
      t.status,
    ),
    openedAtIdx: index("paper_trade_combo_opened_at_idx").on(t.openedAt),
  }),
);

export type PaperTradeComboRow = typeof paperTradeComboTable.$inferSelect;
export type NewPaperTradeComboRow = typeof paperTradeComboTable.$inferInsert;

/**
 * One row per leg of a combo. Premium / IV / source / qty are all written
 * by the server from the live chain at open; the client cannot supply
 * these values.
 */
export const paperTradeComboLegTable = pgTable(
  "paper_trade_combo_leg",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    comboId: varchar("combo_id")
      .notNull()
      .references(() => paperTradeComboTable.id, { onDelete: "cascade" }),
    /** Stable display order (0-indexed). */
    legIndex: integer("leg_index").notNull(),

    action: text("action").notNull(),       // BUY | SELL
    optionType: text("option_type").notNull(), // CE | PE
    strike: numeric("strike", { precision: 18, scale: 4 }).notNull(),
    /** Total shares = lots × lotSize. */
    qty: integer("qty").notNull(),
    lots: integer("lots").notNull(),

    /** Per-share premium frozen at open (server-priced). */
    entryPremium: numeric("entry_premium", { precision: 18, scale: 4 }).notNull(),
    /** IV used at open (decimal, e.g. 0.18). NULL when unknown. */
    ivAtEntry: numeric("iv_at_entry", { precision: 8, scale: 4 }),
    /** chain | bs — where the open premium came from. */
    entrySource: text("entry_source").notNull(),

    // ── Live MTM ─────────────────────────────────────────────────────
    /** Last per-share premium observed. */
    lastPremium: numeric("last_premium", { precision: 18, scale: 4 }),
    /** ws | chain | bs — where lastPremium came from on the most recent tick. */
    lastSource: text("last_source"),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),

    // ── Exit (set on close) ──────────────────────────────────────────
    exitPremium: numeric("exit_premium", { precision: 18, scale: 4 }),
  },
  (t) => ({
    comboIdx: index("paper_trade_combo_leg_combo_idx").on(t.comboId),
  }),
);

export type PaperTradeComboLegRow = typeof paperTradeComboLegTable.$inferSelect;
export type NewPaperTradeComboLegRow = typeof paperTradeComboLegTable.$inferInsert;
