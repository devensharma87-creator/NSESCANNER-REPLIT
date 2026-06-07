/**
 * Backtest Lab — persisted F&O backtest runs and their results.
 *
 * Scoped per user via an opaque `ownerKey` ("owner" or "u:<userId>"), exactly
 * like `portfolio` / `personal_watchlist`, so owner and subscriber storage stay
 * unified without a hard FK to `users`.
 *
 * Two honest modes are persisted (`mode`):
 *  - REAL_REPLAY  — replays the engine's ACTUAL captured history
 *                   (`option_signal_history` + `fno_signal_reasoning` +
 *                   `iv_history`). 100% real, no fabrication, no look-ahead.
 *                   Trades carry `modeled = false`.
 *  - DIRECTIONAL  — replays the reconstructable directional layer (regime /
 *                   EMA / VWAP / RSI / ATR) on historical 15-min index SPOT
 *                   candles, with option P&L via a clearly-LABELED delta proxy.
 *                   Trades carry `modeled = true`.
 *
 * `summary` / `dataQuality` / `params` are JSONB result blobs computed by the
 * backtest libs — never hand-entered. `dataQuality` is the source of the UI's
 * "Historical option data unavailable" honesty panel.
 *
 * Numeric outputs use doublePrecision: this is a read-only analytics surface,
 * NOT the precision-critical paper-trading ledger.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const BACKTEST_MODES = ["REAL_REPLAY", "DIRECTIONAL"] as const;
export type BacktestMode = (typeof BACKTEST_MODES)[number];

export const BACKTEST_STATUSES = ["PENDING", "RUNNING", "COMPLETE", "FAILED"] as const;
export type BacktestStatus = (typeof BACKTEST_STATUSES)[number];

export const backtestRunsTable = pgTable(
  "backtest_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "owner" or "u:<userId>". Opaque key — no FK, unifies owner/subscriber. */
    ownerKey: text("owner_key").notNull(),
    /** REAL_REPLAY | DIRECTIONAL — see file header. */
    mode: text("mode").notNull(),
    /** "NIFTY" | "BANKNIFTY" | "SENSEX" | "ALL". */
    instrument: text("instrument").notNull(),
    /** e.g. "15m" | "1D" — the candle timeframe the run was driven on. */
    timeframe: text("timeframe").notNull(),
    /** Inclusive calendar window, stored as YYYY-MM-DD to dodge timezone shifts. */
    fromDate: text("from_date").notNull(),
    toDate: text("to_date").notNull(),
    startingCapital: doublePrecision("starting_capital").notNull(),
    riskPerTradePct: doublePrecision("risk_per_trade_pct").notNull(),
    /** PENDING | RUNNING | COMPLETE | FAILED. */
    status: text("status").notNull().default("PENDING"),
    /** Full request snapshot (instrument list, lot overrides, etc.). */
    params: jsonb("params"),
    /** Computed summary blob (totals, win-rate, PF, drawdown, expectancy, ...). */
    summary: jsonb("summary"),
    /** Data-quality blob driving the honesty panel (coverage, modeled fields, warnings). */
    dataQuality: jsonb("data_quality"),
    /** Populated only when status = FAILED. */
    error: text("error"),
    // ---- V2 Strategy-Research (additive; null for Official-engine runs) ------
    /** OFFICIAL_ENGINE | STRATEGY_RESEARCH | COMPARE_OFFICIAL_VS_STRATEGIES. */
    backtestMode: text("backtest_mode"),
    /** Strategy ids selected for STRATEGY_RESEARCH / COMPARE runs. */
    selectedStrategies: jsonb("selected_strategies"),
    /** Confirmation-filter config snapshot for the run. */
    filters: jsonb("filters"),
    /** Strategy entries-per-index-per-day cap the run was executed with (null for Official-engine runs). */
    maxTradesPerDay: integer("max_trades_per_day"),
    /** Computed multi-factor comparison + ranking blob (research/compare modes). */
    strategyComparison: jsonb("strategy_comparison"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    byOwner: index("backtest_runs_owner_idx").on(t.ownerKey),
    byOwnerCreated: index("backtest_runs_owner_created_idx").on(t.ownerKey, t.createdAt),
  }),
);

export const backtestTradesTable = pgTable(
  "backtest_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => backtestRunsTable.id, { onDelete: "cascade" }),
    indexSymbol: text("index_symbol").notNull(),
    setupKey: text("setup_key"),
    setupName: text("setup_name"),
    direction: text("direction").notNull(),
    optionType: text("option_type"),
    strike: doublePrecision("strike"),
    entryAt: timestamp("entry_at", { withTimezone: true }),
    exitAt: timestamp("exit_at", { withTimezone: true }),
    entrySpot: doublePrecision("entry_spot"),
    exitSpot: doublePrecision("exit_spot"),
    optionEntry: doublePrecision("option_entry"),
    optionExit: doublePrecision("option_exit"),
    optionStop: doublePrecision("option_stop"),
    optionTarget1: doublePrecision("option_target1"),
    optionTarget2: doublePrecision("option_target2"),
    lots: integer("lots"),
    lotSize: integer("lot_size"),
    qty: integer("qty"),
    /** Realized P&L in rupees (Σ sign·(exit−entry)·qty − costs where modeled). */
    pnl: doublePrecision("pnl"),
    exitReason: text("exit_reason"),
    confidence: doublePrecision("confidence"),
    tier: text("tier"),
    regime: text("regime"),
    /** TRUE for DIRECTIONAL delta-proxy fills; FALSE for REAL_REPLAY real fills. */
    modeled: boolean("modeled").notNull().default(false),
    maxFavorableExcursion: doublePrecision("max_favorable_excursion"),
    maxAdverseExcursion: doublePrecision("max_adverse_excursion"),
    // ---- V2 Strategy-Research attribution (additive; null for Official trades) -
    backtestMode: text("backtest_mode"),
    strategyId: text("strategy_id"),
    strategyName: text("strategy_name"),
    strategyCategory: text("strategy_category"),
    /** STRATEGY | ENGINE — which signal source produced this trade. */
    signalSource: text("signal_source"),
    /** Per-trade strategy params (stop/target1/target2/rMultiple/reachedT1/timeframe). */
    strategyParams: jsonb("strategy_params"),
    /** Confirmation filters that were active when the trade was taken. */
    confirmationFilters: jsonb("confirmation_filters"),
    strategyConfidence: doublePrecision("strategy_confidence"),
    historicalSetupMatch: text("historical_setup_match"),
    passedConditions: jsonb("passed_conditions"),
    failedConditions: jsonb("failed_conditions"),
    /** Preserves chronological order within the run. */
    sortIndex: integer("sort_index").notNull().default(0),
  },
  (t) => ({
    byRun: index("backtest_trades_run_idx").on(t.runId),
  }),
);

export const backtestBlockedSetupsTable = pgTable(
  "backtest_blocked_setups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => backtestRunsTable.id, { onDelete: "cascade" }),
    indexSymbol: text("index_symbol").notNull(),
    setupKey: text("setup_key"),
    direction: text("direction"),
    /** Engine decision (e.g. SKIP / BLOCK / DEMOTE) carried from reasoning. */
    decision: text("decision"),
    /** Why it was blocked (audit reason_code, e.g. HTF1H_CONFLICT, LOW_WINRATE). */
    reasonCode: text("reason_code"),
    confidence: doublePrecision("confidence"),
    confluenceScore: doublePrecision("confluence_score"),
    regime: text("regime"),
    /** Aggregated occurrence count for this (setup, decision, reasonCode) bucket. */
    count: integer("count").notNull().default(1),
    note: text("note"),
    // ---- V2 Strategy-Research attribution (additive; null for Official blocks) -
    strategyId: text("strategy_id"),
    strategyName: text("strategy_name"),
    /** STRATEGY | ENGINE. */
    signalSource: text("signal_source"),
    failedCondition: text("failed_condition"),
    blockedRule: text("blocked_rule"),
    /** FILTER | RISK | DATA — buckets the comparison's rejected/risk/data counts. */
    category: text("category"),
  },
  (t) => ({
    byRun: index("backtest_blocked_setups_run_idx").on(t.runId),
  }),
);

export type BacktestRunRow = typeof backtestRunsTable.$inferSelect;
export type NewBacktestRunRow = typeof backtestRunsTable.$inferInsert;
export type BacktestTradeRow = typeof backtestTradesTable.$inferSelect;
export type NewBacktestTradeRow = typeof backtestTradesTable.$inferInsert;
export type BacktestBlockedSetupRow = typeof backtestBlockedSetupsTable.$inferSelect;
export type NewBacktestBlockedSetupRow = typeof backtestBlockedSetupsTable.$inferInsert;
