/**
 * Subscriber accounts + their (denormalised) annual subscription record +
 * per-account personal watchlist.
 *
 * Design notes:
 *  - The site OWNER logs in with APP_ACCESS_PASSWORD (legacy cookie) and is
 *    NOT represented by a row in `users`. They get a synthetic "owner" identity
 *    in code. Subscribers are real rows here.
 *  - One active subscription per user, denormalised onto the row. On renewal
 *    we just overwrite startedAt / expiresAt / payment fields. If a paper
 *    trail is needed later, add a separate `subscription_history` audit table.
 *  - `allowedTabs` is the per-user grant list (subset of the 10 subscriber
 *    tabs). Stored as text[] so we can index/contains-query if needed.
 *  - Personal watchlist uses an opaque `ownerKey` ("owner" for the site
 *    owner, "u:<id>" for subscribers) so we don't need a hard FK / split
 *    storage between owner-vs-subscriber.
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Allowed tab keys = every subscriber-grantable tab.
 *
 * Owner-only / internal tabs (Live Feed `/kite`, Audit, Status, the Admin
 * page itself) are deliberately excluded — they are surfaced exclusively
 * to the site owner via the `ownerOnly` flag in the frontend nav and the
 * `requireOwner` middleware on the corresponding API routes.
 *
 * Labels for these keys live in the admin UI (`pages/admin.tsx`
 * TAB_LABELS) and the navigation list (`components/layout.tsx`). Keep
 * those two surfaces aligned with this list whenever it grows or shrinks.
 */
export const ALLOWED_TAB_KEYS = [
  "HOME",
  "SCANNER",
  "DEEP_SCAN",
  "FNO",
  "STRATEGIES",
  "OPTION_CHAIN",
  "OI_LAB",
  "PREMARKET",
  "WATCHLIST",
  "SECTORS",
  "FLOWS",
  "STOCKS_TO_WATCH",
  "NEWS",
  "LEARN",
  "CHARTING",
  "PORTFOLIO_ANALYSER",
  "BACKTEST_LAB",
  "DIRECTIONAL_SCORER",
] as const;
export type AllowedTabKey = (typeof ALLOWED_TAB_KEYS)[number];

/** Subscriber account states. */
export const USER_STATUSES = ["pending", "active", "suspended", "expired"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),

    /** "subscriber" only for now — the owner is not stored here. */
    role: text("role").notNull().default("subscriber"),

    /** pending | active | suspended | expired */
    status: text("status").notNull().default("pending"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    // ----- subscription (denormalised: one active sub per user) -----
    subscriptionStartedAt: timestamp("subscription_started_at", { withTimezone: true }),
    subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
    /** Amount paid in INR paise (Rs 5500 = 550000 paise). */
    amountPaise: integer("amount_paise"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** Free-text reference: UPI txn id, bank ref, cheque number, etc. */
    paymentRef: text("payment_ref"),
    /** Owner's free-text notes about the account. */
    notes: text("notes"),

    /** Granted tab keys (subset of ALLOWED_TAB_KEYS). Defaults to []. */
    allowedTabs: text("allowed_tabs").array().notNull().default([]),
  },
  (t) => ({
    statusIdx: index("users_status_idx").on(t.status),
    expiresIdx: index("users_expires_idx").on(t.subscriptionExpiresAt),
  }),
);

export const personalWatchlistTable = pgTable(
  "personal_watchlist",
  {
    /** "owner" or "u:<userId>". Opaque key — no FK to keep owner-vs-subscriber unified. */
    ownerKey: text("owner_key").notNull(),
    symbol: text("symbol").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ownerKey, t.symbol] }),
    ownerIdx: index("personal_watchlist_owner_idx").on(t.ownerKey),
  }),
);

export type UserRow = typeof usersTable.$inferSelect;
export type NewUserRow = typeof usersTable.$inferInsert;
export type PersonalWatchlistRow = typeof personalWatchlistTable.$inferSelect;
