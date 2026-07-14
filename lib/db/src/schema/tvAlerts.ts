import { pgTable, text, timestamp, numeric, jsonb, index } from "drizzle-orm/pg-core";

/** TradingView webhook alerts. We persist the parsed fields plus the raw
 * payload so we can re-derive new fields later without losing data. */
export const tvAlertsTable = pgTable(
  "tv_alerts",
  {
    id: text("id").primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    symbol: text("symbol"),
    ticker: text("ticker"),
    exchange: text("exchange"),
    interval: text("interval"),
    side: text("side"),
    strategy: text("strategy"),
    price: numeric("price", { precision: 18, scale: 4 }),
    message: text("message"),
    raw: jsonb("raw").notNull(),
  },
  t => ({
    receivedIdx: index("tv_alerts_received_idx").on(t.receivedAt),
    symbolIdx: index("tv_alerts_symbol_idx").on(t.symbol),
  }),
);

export type TvAlertRow = typeof tvAlertsTable.$inferSelect;
export type NewTvAlertRow = typeof tvAlertsTable.$inferInsert;
