/**
 * Candle warehouse (Priority 4 — write-only data infrastructure).
 *
 * Durable OHLCV+OI candle persistence for Indian market instruments.
 * Two tables:
 *
 *   1. `candle` — one row per (instrument, interval, ts).
 *      Composite PK enforces idempotency for the ingestor's
 *      ON CONFLICT upsert.
 *
 *   2. `candle_sync_run` — one row per ingestion cycle (BACKFILL or
 *      INCREMENTAL) so the diagnostic endpoint can show
 *      "what just happened, what failed".
 *
 * **NOT** consumed by any live trading decision. Pure substrate for
 * future backtesting / charting / replay / regime studies. The swing
 * scanner / F&O signal pipeline / paper-trader continue to read from
 * `kiteIntraday.fetchKiteHistoricalByToken` directly (cache-fronted,
 * throttled) — they do NOT read from this table.
 *
 * Schema notes:
 *   - `instrument_token` is the canonical Kite identifier (numeric);
 *     it's the only thing that's stable across NSE/BSE renames and the
 *     only key Kite's `getHistoricalData` accepts. `symbol` and
 *     `exchange` are denormalised tags for human-readable diagnostics.
 *   - `oi` is nullable — equity candles never carry OI; F&O contracts
 *     do. The ingestor only sets `oi=true` on the Kite call when the
 *     instrument is known to be a derivative (currently we ingest
 *     equities + indices only, so always null in v1).
 *   - `volume` is `bigint` because index cash candles can hit
 *     8-digit aggregate volumes on rebalance days.
 *   - `source` records which feed produced the row ("kite" or "yahoo")
 *     so a future audit can drop one source's data wholesale.
 *   - Retention: daily candles are kept indefinitely (252-day
 *     backfill needs the runway); intraday candles are swept by
 *     `CANDLE_WAREHOUSE_RETENTION_DAYS_INTRADAY` (default 60).
 */

import {
  pgTable,
  varchar,
  timestamp,
  numeric,
  integer,
  bigint,
  boolean,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const candleTable = pgTable(
  "candle",
  {
    instrumentToken: bigint("instrument_token", { mode: "number" }).notNull(),
    interval: varchar("interval", { length: 16 }).notNull(), // "day" | "15minute" | "5minute" | …
    ts: timestamp("ts", { withTimezone: true }).notNull(),

    /* denormalised identity tags (display-only — never join on these) */
    symbol: varchar("symbol", { length: 64 }).notNull(),
    exchange: varchar("exchange", { length: 8 }).notNull(),

    /* OHLCV */
    open: numeric("open", { precision: 16, scale: 4 }).notNull(),
    high: numeric("high", { precision: 16, scale: 4 }).notNull(),
    low: numeric("low", { precision: 16, scale: 4 }).notNull(),
    close: numeric("close", { precision: 16, scale: 4 }).notNull(),
    volume: bigint("volume", { mode: "number" }).notNull().default(0),

    /* derivatives only — null for cash equities + indices */
    oi: bigint("oi", { mode: "number" }),

    source: varchar("source", { length: 16 }).notNull(), // "kite" | "yahoo"

    /* trusted-layer provenance (Task #124 Phase 1) — all nullable/additive.
     * `sourcePriority` (lower = higher trust) powers the write-guard so a
     * lower-trust or source-less row can never overwrite a Kite row. */
    sourceProvider: varchar("source_provider", { length: 16 }),
    sourcePriority: integer("source_priority"),
    validatedBy: varchar("validated_by", { length: 16 }),
    validationStatus: varchar("validation_status", { length: 16 }),
    providerConflictStatus: varchar("provider_conflict_status", { length: 24 }),
    asof: timestamp("asof", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    freshnessSec: integer("freshness_sec"),
    isStale: boolean("is_stale"),
    tradingsymbol: varchar("tradingsymbol", { length: 64 }),
    kiteKey: varchar("kite_key", { length: 64 }),
    kiteInstrumentToken: bigint("kite_instrument_token", { mode: "number" }),
    indstocksScripCode: varchar("indstocks_scrip_code", { length: 32 }),
    fallbackUsed: boolean("fallback_used"),
    dataQuality: varchar("data_quality", { length: 16 }),
    warnings: jsonb("warnings"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.instrumentToken, t.interval, t.ts] }),
    symbolIntervalTsIdx: index("candle_symbol_interval_ts_idx").on(t.symbol, t.interval, t.ts),
    intervalTsIdx: index("candle_interval_ts_idx").on(t.interval, t.ts),
  }),
);

export type CandleRow = typeof candleTable.$inferSelect;
export type NewCandleRow = typeof candleTable.$inferInsert;

/**
 * One row per ingestion cycle. `kind` distinguishes a one-shot
 * BACKFILL (deep history pull) from a recurring INCREMENTAL (top-up
 * tick). `universe` is a free-text tag (e.g. "indices",
 * "fno-stocks") — kept opaque so we can add new universes without a
 * schema change.
 *
 * `errors` is capped at 20 entries by the ingestor.
 */
export const candleSyncRunTable = pgTable(
  "candle_sync_run",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    kind: varchar("kind", { length: 16 }).notNull(), // "BACKFILL" | "INCREMENTAL"
    interval: varchar("interval", { length: 16 }).notNull(),
    universe: varchar("universe", { length: 32 }).notNull(),
    symbolsAttempted: integer("symbols_attempted").notNull(),
    symbolsOk: integer("symbols_ok").notNull(),
    rowsWritten: integer("rows_written").notNull(),
    errors: jsonb("errors").notNull().default([]),
  },
  (t) => ({
    startedIdx: index("candle_sync_run_started_idx").on(t.startedAt),
    intervalUniverseIdx: index("candle_sync_run_interval_universe_idx").on(t.interval, t.universe),
  }),
);

export type CandleSyncRunRow = typeof candleSyncRunTable.$inferSelect;
export type NewCandleSyncRunRow = typeof candleSyncRunTable.$inferInsert;
