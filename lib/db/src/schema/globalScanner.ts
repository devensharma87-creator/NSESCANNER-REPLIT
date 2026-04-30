/**
 * Global Multi-Asset Scanner (Phase 1) — Crypto / Commodities / Forex.
 *
 * All tables are prefixed `global_*` so they never collide with the existing
 * NSE Stock Scanner schema. They are populated by the new
 * `/api/global/*` route namespace and are owned exclusively by the global
 * scanner artifact.
 *
 * Storage model:
 *  - `globalInstrumentsTable`   — master list of every supported symbol
 *    (canonical scanner symbol → data-source-specific symbol mapping).
 *  - `globalCandlesTable`       — cached OHLCV per (symbol, timeframe, ts).
 *  - `globalLivePricesTable`    — most-recent ticker snapshot per symbol.
 *  - `globalWatchlistTable`     — per-session personal watchlist.
 *  - `globalSyncLogsTable`      — last-success / last-error per data source
 *    so the UI can render a freshness strip.
 */

import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

export const globalInstrumentsTable = pgTable("global_instruments", {
  symbol: text("symbol").primaryKey(),                 // BTCUSDT, GOLD, EURUSD, …
  displayName: text("display_name").notNull(),
  assetClass: text("asset_class").notNull(),           // crypto | commodity | forex
  source: text("source").notNull(),                    // binance | yahoo | yahoo-fx
  sourceSymbol: text("source_symbol").notNull(),       // BTCUSDT, GC=F, EURUSD=X, …
  currency: text("currency"),                          // USD, INR, oz, bbl, …
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const globalCandlesTable = pgTable(
  "global_candles",
  {
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume"),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.symbol, t.timeframe, t.ts] }),
    bySymbolTfTs: index("global_candles_sym_tf_ts").on(t.symbol, t.timeframe, t.ts),
  }),
);

export const globalLivePricesTable = pgTable("global_live_prices", {
  symbol: text("symbol").primaryKey(),
  price: doublePrecision("price"),
  prevClose: doublePrecision("prev_close"),
  changeAbs: doublePrecision("change_abs"),
  changePct: doublePrecision("change_pct"),
  dayHigh: doublePrecision("day_high"),
  dayLow: doublePrecision("day_low"),
  volume: doublePrecision("volume"),
  source: text("source").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
});

export const globalWatchlistTable = pgTable(
  "global_watchlist",
  {
    sessionKey: text("session_key").notNull(),         // "owner" or hash bound to the global session cookie
    symbol: text("symbol").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionKey, t.symbol] }),
    bySession: index("global_watchlist_session_idx").on(t.sessionKey),
  }),
);

export const globalSyncLogsTable = pgTable("global_sync_logs", {
  source: text("source").primaryKey(),                 // binance | yahoo | yahoo-fx
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastError: text("last_error"),
  okCount: integer("ok_count").notNull().default(0),
  errCount: integer("err_count").notNull().default(0),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GlobalInstrumentRow = typeof globalInstrumentsTable.$inferSelect;
export type GlobalCandleRow = typeof globalCandlesTable.$inferSelect;
export type GlobalLivePriceRow = typeof globalLivePricesTable.$inferSelect;
export type GlobalWatchlistRow = typeof globalWatchlistTable.$inferSelect;
export type GlobalSyncLogRow = typeof globalSyncLogsTable.$inferSelect;
