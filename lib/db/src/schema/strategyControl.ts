import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** Custom strategy definitions saved by the owner in the Options Strategy Builder.
 *  Additive-only table. Registered here so drizzle-kit push treats it as
 *  already-present and never issues a DROP on subsequent publishes.
 *
 *  WARNING: source file was missing between Stage 0 and Stage 1 deploy; the table
 *  survived publish only because drizzle-kit aborted the data-loss prompt in
 *  non-interactive CI. Re-added here (Stage 1 verify) to make it permanent. */
export const strategyDefinitionsTable = pgTable("strategy_definitions", {
  ownerKey: text("owner_key").notNull(),
  id: text("id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull().default(""),
  spec: jsonb("spec").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.ownerKey, t.id] }),
]);

/** Per-strategy engine-enable toggles used by the Custom Strategy Builder engine. */
export const strategyEngineStateTable = pgTable("strategy_engine_state", {
  ownerKey: text("owner_key").notNull(),
  strategyId: text("strategy_id").notNull(),
  enabledForEngine: integer("enabled_for_engine").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.ownerKey, t.strategyId] }),
]);

export type StrategyDefinitionRow = typeof strategyDefinitionsTable.$inferSelect;
export type StrategyEngineStateRow = typeof strategyEngineStateTable.$inferSelect;
