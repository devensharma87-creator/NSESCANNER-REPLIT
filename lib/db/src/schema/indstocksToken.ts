import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Active INDstocks REST access token. Single-row table (id = "active").
 * INDstocks invalidates the token roughly every 24h, so the owner hot-swaps a
 * fresh one daily via the in-app updater. The value is stored encrypted at rest
 * (shared kiteCrypto AES-256-GCM envelope); reads are DB-first with an env-secret
 * fallback. This table never feeds a trading decision — INDstocks stays a
 * secondary_validation source. */
export const indstocksTokenTable = pgTable("indstocks_token", {
  id: text("id").primaryKey(),
  /** Encrypted v1 envelope (or legacy plaintext when KITE_TOKEN_ENC_KEY unset). */
  token: text("token").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** Operator-supplied or default (+24h) expiry hint. Informational only. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedBy: text("updated_by"),
});

export type IndstocksTokenRow = typeof indstocksTokenTable.$inferSelect;
export type NewIndstocksTokenRow = typeof indstocksTokenTable.$inferInsert;
