import {
  pgTable,
  text,
  numeric,
  date,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const ivHistoryTable = pgTable(
  "iv_history",
  {
    underlying: text("underlying").notNull(),
    recordDate: date("record_date").notNull(),
    atmIv: numeric("atm_iv", { precision: 10, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    underlyingDateUq: uniqueIndex("iv_history_underlying_date_uq").on(t.underlying, t.recordDate),
    underlyingIdx: index("iv_history_underlying_idx").on(t.underlying),
  }),
);

export type IvHistoryRow = typeof ivHistoryTable.$inferSelect;
export type NewIvHistoryRow = typeof ivHistoryTable.$inferInsert;
