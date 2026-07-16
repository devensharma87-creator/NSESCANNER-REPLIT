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

    /* P15b — deterministic correlation key tying EMITTED → OPENED → CLOSED_*
     * rows of the same signal/trade together. Computed by
     * `computeSignalFingerprint` in fnoSignalReasoningLogger.ts from the
     * 6-tuple (signalDate, indexSymbol, setupKey, direction, optionType,
     * selectedStrike). Nullable because SKIPPED / PRE_EMISSION_REJECTED
     * rows do not have all 6 fields in scope (no leg → no strike); those
     * rows continue to use the legacy 4-tuple proxy for grouping.
     *
     * Hash = SHA-256 hex truncated to 16 chars (64 bits) — collision
     * probability ~1e-10 for ≤100k rows, well inside diagnostics needs. */
    signalFingerprint: varchar("signal_fingerprint", { length: 16 }),

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

    /* ─── Stage 2 · v2 instrumentation columns (2026-07-16) ──────────────
     * Additive per §16 gate-storage mandate. Populated only when the
     * `REASONING_WRITER_V2_ENABLED` feature flag is on; NULL otherwise.
     * Migration applied via direct `ALTER TABLE ... ADD COLUMN IF NOT
     * EXISTS` on 2026-07-16 (P0.4 Step 1). See fnoCanonicalTaxonomy.ts
     * for the closed TS unions that govern the allowed string values. */
    gateName: varchar("gate_name", { length: 64 }),
    verdict: varchar("verdict", { length: 16 }),
    stage: varchar("stage", { length: 24 }),
    valuesTestedJson: jsonb("values_tested_json"),
    thresholdJson: jsonb("threshold_json"),
    configVersion: varchar("config_version", { length: 32 }),
    tradeClass: varchar("trade_class", { length: 16 }),
    canonicalDecision: varchar("canonical_decision", { length: 24 }),
    canonicalReason: varchar("canonical_reason", { length: 48 }),
  },
  (t) => ({
    capturedAtIdx: index("fno_signal_reasoning_captured_at_idx").on(t.capturedAt),
    dateIndexIdx: index("fno_signal_reasoning_date_index_idx").on(t.signalDate, t.indexSymbol),
    decisionTimeIdx: index("fno_signal_reasoning_decision_time_idx").on(t.decision, t.capturedAt),
    reasonTimeIdx: index("fno_signal_reasoning_reason_time_idx").on(t.reasonCode, t.capturedAt),
    setupTimeIdx: index("fno_signal_reasoning_setup_time_idx").on(t.setupKey, t.capturedAt),
    fingerprintIdx: index("fno_signal_reasoning_fingerprint_idx").on(t.signalFingerprint),
  }),
);

export type FnoSignalReasoningRow = typeof fnoSignalReasoningTable.$inferSelect;
export type NewFnoSignalReasoningRow = typeof fnoSignalReasoningTable.$inferInsert;

/**
 * One-time archive of the raw, pre-dedupe `fno_signal_reasoning` rows
 * (Signal Logging Fix — 2026-06-05).
 *
 * The original writer logged a reasoning row on every ~30s poll, inflating
 * the live table to ~88 duplicate rows per signal (worst case 307×). Before
 * switching the writer to once-per-state-change logging, the raw history is
 * snapshotted here so NOTHING is lost — this table is the immutable record
 * of what was actually written under the old contract.
 *
 * Schema is a verbatim mirror of `fnoSignalReasoningTable` (same columns,
 * same precision) so a row round-trips with zero coercion. It is:
 *   - additive (no change to the live table),
 *   - write-once (populated by the one-time migration script, then frozen),
 *   - diagnostics-only (feeds no signal, gate, sizing, execution, scheduler,
 *     or scanner decision).
 *
 * Index names are prefixed `fno_signal_reasoning_archive_*` so they never
 * collide with the live table's indexes.
 */
export const fnoSignalReasoningArchivePreDedupeTable = pgTable(
  "fno_signal_reasoning_archive_pre_dedupe",
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

    signalFingerprint: varchar("signal_fingerprint", { length: 16 }),

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

    snapshot: jsonb("snapshot"),
    note: text("note"),

    /* migration bookkeeping — when this row was copied into the archive.
     * Distinct from `capturedAt` (which preserves the original write time). */
    archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    archiveCapturedAtIdx: index("fno_signal_reasoning_archive_captured_at_idx").on(t.capturedAt),
    archiveDateIndexIdx: index("fno_signal_reasoning_archive_date_index_idx").on(t.signalDate, t.indexSymbol),
    archiveFingerprintIdx: index("fno_signal_reasoning_archive_fingerprint_idx").on(t.signalFingerprint),
  }),
);

export type FnoSignalReasoningArchiveRow = typeof fnoSignalReasoningArchivePreDedupeTable.$inferSelect;
export type NewFnoSignalReasoningArchiveRow = typeof fnoSignalReasoningArchivePreDedupeTable.$inferInsert;
