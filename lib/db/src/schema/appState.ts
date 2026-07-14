import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Generic single key→value store for small, additive operational state that
 *  must survive process restarts but does not warrant its own dedicated table.
 *
 *  First consumer: `kite_offline_since` — the ISO timestamp at which the Kite
 *  session was first observed offline (cleared when a valid session returns),
 *  so the global readiness banner can honestly say "offline since 06:00".
 *
 *  Additive only. Created in dev via `CREATE TABLE IF NOT EXISTS` — never via an
 *  unguarded `drizzle-kit push`, which would try to DROP out-of-schema tables. */
export const appStateTable = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppStateRow = typeof appStateTable.$inferSelect;
export type NewAppStateRow = typeof appStateTable.$inferInsert;
