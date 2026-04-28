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
 * Allowed tab keys = the 10 tabs subscribers may be granted.
 * Mirrored on the frontend in `lib/tab-access.ts`. Keep the two in sync.
 */
export const ALLOWED_TAB_KEYS = [
  "HOME",
  "SCANNER",
  "OPTION_CHAIN",
  "OI_LAB",
  "WATCHLIST",
  "PREMARKET",
  "FLOWS",
  "STOCKS_TO_WATCH",
  "NEWS",
  "LEARN",
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
