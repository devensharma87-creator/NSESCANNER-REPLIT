/**
 * Global Multi-Asset Scanner — Crypto / Commodities / Forex (Phase 1) plus
 * Global Equities and Indices (Phase 2).
 *
 * All tables are prefixed `global_*` so they never collide with the existing
 * NSE Stock Scanner schema. They are populated by the new
 * `/api/global/*` route namespace and are owned exclusively by the global
 * scanner artifact.
 *
 * Storage model:
 *  - `globalInstrumentsTable`   — master list of every supported symbol
 *    (canonical scanner symbol → data-source-specific symbol mapping).
 *    `assetClass` is `crypto | commodity | forex | equity | index` and
 *    `source` is `binance | yahoo | yahoo-fx | yahoo-equity | yahoo-index`.
 *  - `globalCandlesTable`       — cached OHLCV per (symbol, timeframe, ts).
 *  - `globalLivePricesTable`    — most-recent ticker snapshot per symbol.
 *  - `globalWatchlistTable`     — per-session personal watchlist.
 *  - `globalSyncLogsTable`      — last-success / last-error per data source
 *    so the UI can render a per-source freshness strip.
 */

import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  primaryKey,
  index,
  uniqueIndex,
  jsonb,
  uuid,
} from "drizzle-orm/pg-core";

export const globalInstrumentsTable = pgTable("global_instruments", {
  symbol: text("symbol").primaryKey(),                 // BTCUSDT, GOLD, EURUSD, …
  displayName: text("display_name").notNull(),
  assetClass: text("asset_class").notNull(),           // crypto | commodity | forex | equity | index
  source: text("source").notNull(),                    // binance | yahoo | yahoo-fx | yahoo-equity | yahoo-index
  sourceSymbol: text("source_symbol").notNull(),       // BTCUSDT, GC=F, EURUSD=X, AAPL, ASML.AS, ^GSPC, …
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
  /**
   * Number of consecutive refresh cycles where the per-symbol fetch failed
   * (counted by the dataLayer refreshers). Reset to 0 on every successful
   * upsert. Used by `/global/status` to surface "candidate dead symbols"
   * (e.g. delisted Binance pairs, retired Yahoo continuous-future codes)
   * so operators know which entries in `universe.ts` to prune.
   */
  failureStreak: integer("failure_streak").notNull().default(0),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
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
  source: text("source").primaryKey(),                 // binance | yahoo | yahoo-fx | yahoo-equity | yahoo-index
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastError: text("last_error"),
  okCount: integer("ok_count").notNull().default(0),
  errCount: integer("err_count").notNull().default(0),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `globalScreenerPresetsTable` — per-session named filter presets for the
 * Screener page. The preset `body` mirrors the request body accepted by
 * `POST /api/global/screen` (assetClasses, timeframe, filters, optional
 * limit) so loading a preset can be implemented as a simple replay.
 *
 * Preset names are unique per `sessionKey` so the UI can use the name as a
 * stable client-side identifier when listing presets in a sidebar.
 */
export const globalScreenerPresetsTable = pgTable(
  "global_screener_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionKey: text("session_key").notNull(),
    name: text("name").notNull(),
    body: jsonb("body").notNull(),                         // GlobalScreenerBody payload
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When non-null, the preset auto-runs every N minutes (clamped to
     * 1..1440 by the API). Null means manual-only (the legacy behaviour).
     * The background scheduler in `presetScheduler.ts` polls this column.
     */
    autoRunIntervalMin: integer("auto_run_interval_min"),
    /** Last time the scheduler executed this preset (success or failure). */
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    /** Last error message if the most recent scheduled run threw. */
    lastRunError: text("last_run_error"),
    /**
     * Symbols returned by the most recent successful scheduled run. Used
     * to dedupe — only symbols absent from this list become new "alert"
     * hits on the next cycle.
     */
    lastHitSymbols: jsonb("last_hit_symbols").notNull().default([]),
    /**
     * Symbols that appeared as fresh hits in the most recent scheduled
     * run (i.e. were not present in the prior `lastHitSymbols`). The UI
     * surfaces these as alerts and POSTs `…/acknowledge` to clear them.
     */
    lastNewHits: jsonb("last_new_hits").notNull().default([]),
    lastNewHitsAt: timestamp("last_new_hits_at", { withTimezone: true }),
    /**
     * Opaque, lazily-generated share token. Null until the owner clicks
     * "Copy share link" the first time. Recipients open the share URL,
     * which calls `GET /global/screener-presets/share/:token` to preview
     * the preset (only `name` and `body` are returned — no session key,
     * timestamps, or alert state — so nothing about the original owner
     * leaks). They then call `POST /global/screener-presets/import/:token`
     * to fork it into their own library.
     *
     * The owner can revoke the link by deleting the token; existing share
     * URLs immediately stop resolving.
     */
    shareToken: text("share_token"),
  },
  (t) => ({
    bySession: index("global_screener_presets_session_idx").on(t.sessionKey),
    uniqNamePerSession: uniqueIndex("global_screener_presets_session_name_uniq").on(
      t.sessionKey,
      t.name,
    ),
    uniqShareToken: uniqueIndex("global_screener_presets_share_token_uniq").on(
      t.shareToken,
    ),
  }),
);

/**
 * `globalInstrumentOverridesTable` — runtime, DB-backed overrides for
 * instruments listed in `universe.ts`. Currently used to "mute" a symbol
 * (`disabled = true`) without a code change: the universe rotation skips
 * it during refresh and the dashboard hides it. Operators reach for this
 * when a symbol crosses the per-symbol failure-streak threshold (see
 * `DEAD_SYMBOL_STREAK_THRESHOLD`) but pruning it from `universe.ts`
 * requires a developer + redeploy.
 *
 * The override is intentionally additive — we never delete a row from
 * `global_instruments` based on it, so re-enabling is a single boolean
 * flip and the symbol's prior state (live price, watchlist references,
 * screener history) is preserved.
 */
export const globalInstrumentOverridesTable = pgTable("global_instrument_overrides", {
  symbol: text("symbol").primaryKey(),
  disabled: integer("disabled").notNull().default(0), // 0/1 — kept as int to dodge driver-specific boolean coercion
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  /** Free-form operator note, e.g. "Binance delisted 2025-04-30". */
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GlobalInstrumentRow = typeof globalInstrumentsTable.$inferSelect;
export type GlobalCandleRow = typeof globalCandlesTable.$inferSelect;
export type GlobalLivePriceRow = typeof globalLivePricesTable.$inferSelect;
export type GlobalWatchlistRow = typeof globalWatchlistTable.$inferSelect;
export type GlobalSyncLogRow = typeof globalSyncLogsTable.$inferSelect;
export type GlobalScreenerPresetRow = typeof globalScreenerPresetsTable.$inferSelect;
