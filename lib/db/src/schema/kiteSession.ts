import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Active Kite Connect access token. Single-row table (id = "active").
 * Zerodha invalidates the token at ~6 AM IST every day so a fresh login is
 * required each trading session. */
export const kiteSessionTable = pgTable("kite_session", {
  id: text("id").primaryKey(),
  apiKey: text("api_key").notNull(),
  accessToken: text("access_token").notNull(),
  publicToken: text("public_token"),
  userId: text("user_id"),
  userName: text("user_name"),
  loginTime: timestamp("login_time", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type KiteSessionRow = typeof kiteSessionTable.$inferSelect;
export type NewKiteSessionRow = typeof kiteSessionTable.$inferInsert;
