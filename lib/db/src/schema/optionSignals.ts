import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  date,
  index,
  primaryKey,
  varchar,
} from "drizzle-orm/pg-core";

export const optionSignalHistoryTable = pgTable(
  "option_signal_history",
  {
    signalDate: date("signal_date").notNull(),
    indexSymbol: text("index_symbol").notNull(),
    setupKey: text("setup_key").notNull(),
    direction: text("direction").notNull(),

    indexName: text("index_name").notNull(),
    strike: numeric("strike", { precision: 18, scale: 4 }).notNull(),
    optionType: text("option_type").notNull(),
    entry: numeric("entry", { precision: 18, scale: 4 }).notNull(),
    stopLoss: numeric("stop_loss", { precision: 18, scale: 4 }).notNull(),
    target1: numeric("target1", { precision: 18, scale: 4 }).notNull(),
    target2: numeric("target2", { precision: 18, scale: 4 }).notNull(),
    entryTrigger: text("entry_trigger"),

    // Option-premium plan locked at signal generation time. Nullable
    // because (a) existing rows pre-date this column, and (b) the option
    // chain may have been unavailable when the signal fired (Kite +
    // NSE both down). When present, these are the same locked premium
    // values the alert popup and the paper-trade engine see — never
    // recomputed once the lifecycle row exists.
    optionEntry: numeric("option_entry", { precision: 18, scale: 4 }),
    optionStopLoss: numeric("option_stop_loss", { precision: 18, scale: 4 }),
    optionTarget1: numeric("option_target1", { precision: 18, scale: 4 }),
    optionTarget2: numeric("option_target2", { precision: 18, scale: 4 }),
    // P0-00 (2026-07-09): wall-clock time the option-premium plan above was
    // first persisted (the one-and-only enrichment backfill). Null on legacy
    // rows written before this column existed — the UI renders those as
    // LEGACY_PLAN_FIELDS with an honest warning instead of fabricating an
    // asOf. Applied to the live DB via `ALTER TABLE … ADD COLUMN IF NOT
    // EXISTS` (never an unguarded `drizzle-kit push` — see replit.md).
    optionPremiumLockedAt: timestamp("option_premium_locked_at", {
      withTimezone: true,
    }),

    confidence: integer("confidence").notNull().default(0),
    tier: text("tier"),
    setupName: text("setup_name"),

    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    status: text("status").notNull().default("PENDING"),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    exitReason: text("exit_reason"),
    exitPrice: numeric("exit_price", { precision: 18, scale: 4 }),

    maxFavorableExcursion: numeric("max_favorable_excursion", {
      precision: 18,
      scale: 4,
    })
      .notNull()
      .default("0"),
    maxAdverseExcursion: numeric("max_adverse_excursion", {
      precision: 18,
      scale: 4,
    })
      .notNull()
      .default("0"),

    lastSpot: numeric("last_spot", { precision: 18, scale: 4 }).notNull(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /* ─── Stage 2 · v2 instrumentation columns (2026-07-16) ──────────────
     * Additive; populated only when `REASONING_WRITER_V2_ENABLED=1`.
     * Migration applied via direct `ALTER TABLE … ADD COLUMN IF NOT
     * EXISTS` on 2026-07-16 (P0.4 Step 1). See fnoCanonicalTaxonomy.ts
     * for the closed TS unions that govern the allowed string values. */
    signalFingerprint: varchar("signal_fingerprint", { length: 32 }),
    // Nullable FK-like reference to paper_trade_fo.id (a UUID string
    // in the paper_trade_fo schema) — no hard constraint (additive
    // discipline). Populated by the paper-writer path on successful
    // open; NULL for signals that never opened.
    paperTradeId: varchar("paper_trade_id", { length: 64 }),
    executionStatus: varchar("execution_status", { length: 24 }),
    executionBlockedReason: varchar("execution_blocked_reason", { length: 48 }),
    writerVersion: varchar("writer_version", { length: 32 }),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.signalDate, t.indexSymbol, t.setupKey, t.direction],
    }),
    dateIdx: index("option_signal_history_date_idx").on(t.signalDate),
    statusIdx: index("option_signal_history_status_idx").on(t.status),
  }),
);

export type OptionSignalHistoryRow =
  typeof optionSignalHistoryTable.$inferSelect;
export type NewOptionSignalHistoryRow =
  typeof optionSignalHistoryTable.$inferInsert;

/**
 * P0-00 (2026-07-09) — append-only audit ledger for F&O signal PLAN changes.
 *
 * The emitted trading plan (spot entry/SL/T1/T2, option premium plan,
 * strike, trigger) is IMMUTABLE after emission. If any plan field ever has
 * to change (owner correction, corporate action, data-error fix), the change
 * MUST land here as an explicit audit event — silent recalculation, polling
 * refresh overwrite, quote overwrite and cache overwrite are all forbidden.
 *
 * No automated code path writes this table. It exists so that (a) any future
 * sanctioned correction has a mandatory ledger, and (b) the UI can surface a
 * "plan revised" warning whenever a signal has audit rows.
 *
 * Created in the live DB via raw `CREATE TABLE IF NOT EXISTS` (never an
 * unguarded `drizzle-kit push`). Declared here so drizzle-kit never sees it
 * as out-of-schema and offers to DROP it.
 */
export const optionSignalPlanAuditTable = pgTable(
  "option_signal_plan_audit",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    // Composite signal key (matches option_signal_history's primary key).
    signalDate: date("signal_date").notNull(),
    indexSymbol: text("index_symbol").notNull(),
    setupKey: text("setup_key").notNull(),
    direction: text("direction").notNull(),

    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    /**
     * Allowed values (enforced by CHECK constraint in the DDL):
     * MANUAL_OWNER_EDIT, CONTRACT_CORRECTION_WITH_AUDIT,
     * CORPORATE_ACTION_ADJUSTMENT, DATA_ERROR_CORRECTION_WITH_AUDIT.
     */
    reason: text("reason").notNull(),
    changedBy: text("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    signalIdx: index("option_signal_plan_audit_signal_idx").on(
      t.signalDate,
      t.indexSymbol,
      t.setupKey,
      t.direction,
    ),
  }),
);

export type OptionSignalPlanAuditRow =
  typeof optionSignalPlanAuditTable.$inferSelect;
export type NewOptionSignalPlanAuditRow =
  typeof optionSignalPlanAuditTable.$inferInsert;
