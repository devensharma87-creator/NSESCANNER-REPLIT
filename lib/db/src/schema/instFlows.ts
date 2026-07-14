import { pgTable, date, numeric, text, timestamp, primaryKey, integer } from "drizzle-orm/pg-core";

export const fiiDiiDailyTable = pgTable("fii_dii_daily", {
  date: date("date").primaryKey(),
  fiiBuy: numeric("fii_buy", { precision: 18, scale: 2 }).notNull(),
  fiiSell: numeric("fii_sell", { precision: 18, scale: 2 }).notNull(),
  fiiNet: numeric("fii_net", { precision: 18, scale: 2 }).notNull(),
  diiBuy: numeric("dii_buy", { precision: 18, scale: 2 }).notNull(),
  diiSell: numeric("dii_sell", { precision: 18, scale: 2 }).notNull(),
  diiNet: numeric("dii_net", { precision: 18, scale: 2 }).notNull(),
  source: text("source").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const participantOiDailyTable = pgTable(
  "participant_oi_daily",
  {
    date: date("date").notNull(),
    clientType: text("client_type").notNull(),
    futureIndexLong: integer("future_index_long").notNull().default(0),
    futureIndexShort: integer("future_index_short").notNull().default(0),
    futureStockLong: integer("future_stock_long").notNull().default(0),
    futureStockShort: integer("future_stock_short").notNull().default(0),
    optionIndexCallLong: integer("option_index_call_long").notNull().default(0),
    optionIndexPutLong: integer("option_index_put_long").notNull().default(0),
    optionIndexCallShort: integer("option_index_call_short").notNull().default(0),
    optionIndexPutShort: integer("option_index_put_short").notNull().default(0),
    optionStockCallLong: integer("option_stock_call_long").notNull().default(0),
    optionStockPutLong: integer("option_stock_put_long").notNull().default(0),
    optionStockCallShort: integer("option_stock_call_short").notNull().default(0),
    optionStockPutShort: integer("option_stock_put_short").notNull().default(0),
    totalLongContracts: integer("total_long_contracts").notNull().default(0),
    totalShortContracts: integer("total_short_contracts").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({ pk: primaryKey({ columns: [t.date, t.clientType] }) }),
);

export type FiiDiiDailyRow = typeof fiiDiiDailyTable.$inferSelect;
export type ParticipantOiDailyRow = typeof participantOiDailyTable.$inferSelect;
