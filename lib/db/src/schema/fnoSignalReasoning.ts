/**
 * F&O Signal Reasoning Logger persistence (Priority P14 — 2026-05-15).
 *
 * Append-only diagnostics table. One row is written every time the F&O
 * paper-trade decision pipeline emits a verdict for a signal:
 *
 *   - Trade OPENED (the signal passed every gate and a position was created)
 *   - Trade SKIPPED (a gate rejected the signal — `reason_code` carries
 *                    the SkipReason; one row per (signal, gate) per day
 *                    matching the existing missed-signal dedup contract)
 *   - Trade MISSED_WINDOW (signal exited before we could open it)
 *   - Trade CLOSED_* (post-trade lifecycle exit: stopped, target hit,
 *                     expired, force-exit, manual override)
 *
 * Read-only / additive. **Does NOT feed any signal, gate, sizing,
 * execution, scheduler, or scanner decision.** It is a pure observational
 * substrate so the owner can answer questions like:
 *
 *   - Why did this F&O signal appear / get rejected / get demoted?
 *   - Which gates are failing most often, by index and setup?
 *   - Did a stop-hit fail because of bad setup, tight stop, liquidity,
 *     IV, spread, timing, or missing option-chain confirmation?
 *   - Are new setups bypassing proof because win-rate sample size is
 *     below `MIN_SAMPLE=10`?
 *   - Do TARGET1_HIT trades later reverse to stops (i.e. is there an
 *     unrealised-edge gap the absence of partial booking is costing us)?
 *
 * The writer (`fnoSignalReasoningLogger.ts`) is non-blocking — every
 * insert is wrapped in try/catch and a logger.warn on failure. A DB
 * outage CANNOT block trading.
 *
 * Retention: no automatic purge. The data substrate is small (~50-200
 * rows/day in production based on current signal cadence). Operator can
 * truncate manually if it ever grows past comfort.
 *
 * Schema rationale:
 *
 *   - `decision` is the discriminator. `reason_code` is the free-form
 *     audit tag (SkipReason for SKIPPED rows, CloseReason for CLOSED_*
 *     rows, "OPENED" for opens). Together they answer "what happened"
 *     in one row without joining anything.
 *
 *   - `snapshot` is a JSONB catch-all for anything we want to capture
 *     opportunistically (gate-by-gate flags, OI inputs, EMA stack at
 *     decision time, VWAP relation, etc.) without locking in a column
 *     schema we can't evolve. New fields can be added to the snapshot
 *     without a migration.
 *
 *   - Numeric columns (premium / spot / strike) mirror the precision
 *     of `paper_trade_fo` so values round-trip without coercion.
 */

import {
  pgTable,
  bigserial,
  varchar,
  text,
  timestamp,
  numeric,
  integer,
  bigint,
  date,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const fnoSignalReasoningTable = pgTable(
  "fno_signal_reasoning",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    signalDate: date("signal_date").notNull(),

    /* identity */
    indexSymbol: varchar("index_symbol", { length: 32 }).notNull(),
    indexName: varchar("index_name", { length: 64 }),
    setupKey: varchar("setup_key", { length: 64 }),
    direction: varchar("direction", { length: 16 }),
    optionType: varchar("option_type", { length: 4 }),

    /* tier + decision */
    tier: varchar("tier", { length: 16 }),
    decision: varchar("decision", { length: 32 }).notNull(),
    reasonCode: varchar("reason_code", { length: 64 }),

    /* signal context at decision */
    confidence: integer("confidence"),
    confluenceScore: numeric("confluence_score", { precision: 6, scale: 2 }),
    regime: varchar("regime", { length: 24 }),
    vix: numeric("vix", { precision: 8, scale: 2 }),
    ivr: numeric("ivr", { precision: 6, scale: 2 }),
    ivp: numeric("ivp", { precision: 6, scale: 2 }),

    /* spot context */
    spot: numeric("spot", { precision: 14, scale: 2 }),
    spotEntry: numeric("spot_entry", { precision: 14, scale: 2 }),
    spotStop: numeric("spot_stop", { precision: 14, scale: 2 }),
    spotTarget1: numeric("spot_target1", { precision: 14, scale: 2 }),
    spotTarget2: numeric("spot_target2", { precision: 14, scale: 2 }),

    /* option leg context */
    selectedStrike: numeric("selected_strike", { precision: 12, scale: 2 }),
    optionEntry: numeric("option_entry", { precision: 14, scale: 4 }),
    optionStop: numeric("option_stop", { precision: 14, scale: 4 }),
    optionTarget1: numeric("option_target1", { precision: 14, scale: 4 }),
    optionTarget2: numeric("option_target2", { precision: 14, scale: 4 }),
    optionSpreadPct: numeric("option_spread_pct", { precision: 8, scale: 4 }),
    optionOi: bigint("option_oi", { mode: "number" }),
    optionLtp: numeric("option_ltp", { precision: 14, scale: 4 }),
    optionExit: numeric("option_exit", { precision: 14, scale: 4 }),
    realizedPnl: numeric("realized_pnl", { precision: 14, scale: 2 }),

    /* lifecycle */
    lifecycleStatus: varchar("lifecycle_status", { length: 24 }),
    exitReason: varchar("exit_reason", { length: 32 }),

    /* data quality */
    dataQuality: varchar("data_quality", { length: 32 }),

    /* sizing/risk */
    maxLossPct: numeric("max_loss_pct", { precision: 8, scale: 4 }),
    lots: integer("lots"),
    lotSize: integer("lot_size"),

    /* free-form catch-all for forward-compat (gate-by-gate flags, EMA stack,
     * VWAP/VP relation, OI confluence inputs, etc.) */
    snapshot: jsonb("snapshot"),

    /* free-form note for ad-hoc context */
    note: text("note"),
  },
  (t) => ({
    capturedAtIdx: index("fno_signal_reasoning_captured_at_idx").on(t.capturedAt),
    dateIndexIdx: index("fno_signal_reasoning_date_index_idx").on(t.signalDate, t.indexSymbol),
    decisionTimeIdx: index("fno_signal_reasoning_decision_time_idx").on(t.decision, t.capturedAt),
    reasonTimeIdx: index("fno_signal_reasoning_reason_time_idx").on(t.reasonCode, t.capturedAt),
    setupTimeIdx: index("fno_signal_reasoning_setup_time_idx").on(t.setupKey, t.capturedAt),
  }),
);

export type FnoSignalReasoningRow = typeof fnoSignalReasoningTable.$inferSelect;
export type NewFnoSignalReasoningRow = typeof fnoSignalReasoningTable.$inferInsert;
