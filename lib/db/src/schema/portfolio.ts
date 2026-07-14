/**
 * Portfolio Analyser — DB-backed, per-user saved portfolios (Phase 2).
 *
 * Persistence model mirrors the existing per-user pattern used by
 * `personal_watchlist`: an opaque `ownerKey` ("owner" for the site owner,
 * "u:<userId>" for subscribers) scopes every row, so we never need a hard FK
 * to `users` and owner-vs-subscriber storage stays unified.
 *
 *  - `portfoliosTable`         — one row per named portfolio per user.
 *    Names are unique per ownerKey so the UI can list them in a switcher.
 *    At most one portfolio per user is flagged `isDefault`. This is enforced
 *    BOTH in the route layer (clear-then-set inside one transaction) AND by a
 *    partial unique index on `(ownerKey) WHERE is_default` — the DB-level
 *    guarantee makes the invariant impossible to violate under concurrent
 *    set-default requests or a future multi-replica deployment.
 *  - `portfolioHoldingsTable`  — the holdings belonging to a portfolio,
 *    FK CASCADE on delete. Stores exactly the user-supplied figures
 *    (qty/rate/date/etc.) — NEVER any fabricated or live-market value;
 *    CMP, returns and analytics are always recomputed client-side from
 *    live data, never persisted.
 *
 * Numeric user inputs use doublePrecision (clean JS numbers) — this is a
 * read-only analytics surface, not the precision-critical paper-trading
 * ledger, so we deliberately avoid the numeric→string round-trip.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const portfoliosTable = pgTable(
  "portfolios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "owner" or "u:<userId>". Opaque key — no FK, unifies owner/subscriber. */
    ownerKey: text("owner_key").notNull(),
    name: text("name").notNull(),
    /** At most one default per ownerKey (route-layer toggle + partial unique index below). */
    isDefault: boolean("is_default").notNull().default(false),
    /**
     * The user's chosen benchmark index key for this portfolio (e.g. "NIFTY",
     * "NIFTY500"). Stored server-side so the selection follows the user across
     * devices/browsers. Opaque string — the frontend validates the key against
     * its known options on read, so a stale/unknown key degrades gracefully.
     * Null when the user has never explicitly chosen one for this portfolio.
     */
    benchmark: text("benchmark"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOwner: index("portfolios_owner_idx").on(t.ownerKey),
    uniqNamePerOwner: uniqueIndex("portfolios_owner_name_uniq").on(t.ownerKey, t.name),
    // At most one default portfolio per owner — enforced at the DB level so the
    // invariant survives concurrent set-default requests / multi-replica deploys.
    uniqDefaultPerOwner: uniqueIndex("portfolios_owner_default_uniq")
      .on(t.ownerKey)
      .where(sql`${t.isDefault}`),
  }),
);

export const portfolioHoldingsTable = pgTable(
  "portfolio_holdings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfoliosTable.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    name: text("name"),
    exchange: text("exchange"),
    sector: text("sector"),
    /** ISO yyyy-mm-dd, stored as text to dodge timezone shifts; null when omitted. */
    purchaseDate: text("purchase_date"),
    qty: doublePrecision("qty").notNull(),
    rate: doublePrecision("rate").notNull(),
    isin: text("isin"),
    broker: text("broker"),
    tag: text("tag"),
    notes: text("notes"),
    /** Optional user-supplied dividend received to date (informational). */
    dividendReceived: doublePrecision("dividend_received"),
    /** Optional user-supplied realised P&L on partial exits (informational). */
    realisedPnl: doublePrecision("realised_pnl"),
    /**
     * Optional user-entered fallback price, used ONLY to value a holding that
     * has no live CMP (e.g. an unlisted/illiquid scrip the data providers can't
     * quote). User book-keeping — NOT a fetched/fabricated market value; it
     * never overrides a genuine live quote. Null when not supplied.
     */
    manualCmp: doublePrecision("manual_cmp"),
    /** Preserves the user's original row order within the portfolio. */
    sortIndex: doublePrecision("sort_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPortfolio: index("portfolio_holdings_portfolio_idx").on(t.portfolioId),
  }),
);

export type PortfolioRow = typeof portfoliosTable.$inferSelect;
export type NewPortfolioRow = typeof portfoliosTable.$inferInsert;
export type PortfolioHoldingRow = typeof portfolioHoldingsTable.$inferSelect;
export type NewPortfolioHoldingRow = typeof portfolioHoldingsTable.$inferInsert;
