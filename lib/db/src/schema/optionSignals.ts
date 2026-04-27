import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  date,
  index,
  primaryKey,
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
