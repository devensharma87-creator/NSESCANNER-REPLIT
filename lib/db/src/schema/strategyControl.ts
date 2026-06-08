/**
 * Strategy control (Task #105) — owner-only persistence for:
 *
 *  - `strategy_definitions`  — owner-defined custom strategies. The full
 *    declarative spec lives in the `spec` JSONB column (validated by
 *    `CustomStrategySpecSchema` before write). These appear on BOTH the live
 *    engine selection list and the Backtest Lab.
 *  - `strategy_engine_state` — the live-engine allow-list. One row per
 *    (ownerKey, strategyId) recording whether that strategy may emit through
 *    the auto-engine. Builtin engine setups default ENABLED (a missing row =
 *    enabled); custom strategies default DISABLED for the live engine (a
 *    missing row = disabled) so a freshly-defined strategy can never silently
 *    start trading before the owner opts it in.
 *
 * Both tables are ownerKey-scoped, mirroring the existing override-table
 * pattern. They never bypass any paper-trader safety gate or the dev/prod
 * auto-trading isolation — they only narrow WHICH setups are considered.
 */
import { pgTable, text, integer, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const strategyDefinitionsTable = pgTable(
  "strategy_definitions",
  {
    ownerKey: text("owner_key").notNull(),
    id: text("id").notNull(), // CUSTOM_<slug>
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull().default(""),
    spec: jsonb("spec").notNull(), // CustomStrategySpec
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ownerKey, t.id] }),
  }),
);

export const strategyEngineStateTable = pgTable(
  "strategy_engine_state",
  {
    ownerKey: text("owner_key").notNull(),
    strategyId: text("strategy_id").notNull(),
    enabledForEngine: integer("enabled_for_engine").notNull(), // 0 | 1
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ownerKey, t.strategyId] }),
  }),
);

export type StrategyDefinitionRow = typeof strategyDefinitionsTable.$inferSelect;
export type StrategyEngineStateRow = typeof strategyEngineStateTable.$inferSelect;
