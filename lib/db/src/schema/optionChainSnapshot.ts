/**
 * Option-chain snapshot persistence (Priority 3 — data infrastructure).
 *
 * Durable per-contract option snapshots for the active F&O index universe
 * (NIFTY / BANKNIFTY / SENSEX — same as `OPTION_INDICES` and `FNO_INDICES`).
 * Captured every `OPTION_SNAPSHOT_INTERVAL_MIN` minutes during market
 * hours. Strike window is ATM ± `OPTION_SNAPSHOT_STRIKE_WINDOW` strikes,
 * across the **current expiry + next expiry** only (configurable in
 * `optionChainSnapshotIngestor.ts`).
 *
 * **NOT** wired into any live trading decision. Pure write-only research
 * substrate for future replay / OI buildup studies / IV term-structure /
 * straddle history / max-pain backtests.
 *
 * Schema rationale:
 *
 *   - PK = (underlying, expiry, strike, opt_type, captured_at). The
 *     ingestor rounds `captured_at` to the bucket boundary so re-runs in
 *     the same minute upsert the same row instead of duplicating.
 *
 *   - LTP / OI / volume / IV / bid / ask are nullable — Kite occasionally
 *     omits `oi` for stale contracts and the NSE-direct fallback never
 *     reports per-leg `bid`/`ask`. Storing `null` keeps the time series
 *     honest (never synthesise zeros).
 *
 *   - `oi_change` from `OcSide.chgOi` is intra-day OI delta vs prev close.
 *     `oi_change_pct` is computed downstream — not stored to keep the
 *     write path cheap.
 *
 *   - `depth_summary` keeps a tiny JSON of the L1/L5 buy/sell aggregates
 *     when Kite returns market depth (`bid_qty`/`ask_qty` already cover
 *     L1; this is L2-L5 totals, only when present).
 *
 *   - Retention: a daily sweeper deletes rows where
 *     `captured_at < now - OPTION_SNAPSHOT_RETENTION_DAYS` (default 30).
 *
 * Run-level book-keeping lives in `option_chain_snapshot_run` — one row
 * per ingestion cycle so the diagnostic endpoint can answer
 * "how many rows did we write today" / "what failed last cycle".
 *
 * Single-replica caveat: ingestion latch lives in-process via setInterval.
 * Multi-replica deployments would need an advisory lock similar to
 * `paper_trade_combo` (currently we run a single api-server replica).
 */

import {
  pgTable,
  varchar,
  text,
  timestamp,
  numeric,
  integer,
  bigint,
  date,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const optionChainSnapshotTable = pgTable(
  "option_chain_snapshot",
  {
    underlying: varchar("underlying", { length: 32 }).notNull(),
    expiry: date("expiry").notNull(),
    strike: numeric("strike", { precision: 12, scale: 2 }).notNull(),
    optType: varchar("opt_type", { length: 2 }).notNull(), // "CE" | "PE"
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),

    /* contract identity (best-effort — null when source lacks it) */
    tradingsymbol: varchar("tradingsymbol", { length: 64 }),
    instrumentToken: bigint("instrument_token", { mode: "number" }),

    /* spot context at capture time (denormalised so each row stands alone) */
    spot: numeric("spot", { precision: 14, scale: 2 }),
    atmStrike: numeric("atm_strike", { precision: 12, scale: 2 }),

    /* market data */
    ltp: numeric("ltp", { precision: 14, scale: 2 }),
    open: numeric("open", { precision: 14, scale: 2 }),
    high: numeric("high", { precision: 14, scale: 2 }),
    low: numeric("low", { precision: 14, scale: 2 }),
    close: numeric("close", { precision: 14, scale: 2 }),
    volume: bigint("volume", { mode: "number" }),
    oi: bigint("oi", { mode: "number" }),
    oiChange: bigint("oi_change", { mode: "number" }),
    iv: numeric("iv", { precision: 8, scale: 2 }),

    /* L1 book */
    bid: numeric("bid", { precision: 14, scale: 2 }),
    ask: numeric("ask", { precision: 14, scale: 2 }),
    bidQty: integer("bid_qty"),
    askQty: integer("ask_qty"),
    spread: numeric("spread", { precision: 14, scale: 2 }),

    /* optional L2-L5 aggregates when broker returns depth */
    depthSummary: jsonb("depth_summary"),

    /* greeks (Kite path computes them via Black-Scholes; NSE path emits them too) */
    delta: numeric("delta", { precision: 8, scale: 4 }),
    gamma: numeric("gamma", { precision: 10, scale: 6 }),
    theta: numeric("theta", { precision: 10, scale: 4 }),
    vega: numeric("vega", { precision: 10, scale: 4 }),

    /* provenance */
    source: varchar("source", { length: 32 }).notNull(),

    /**
     * Schema/contract version — bumped when the capture semantics change in a
     * way that breaks replay compatibility (e.g. lot-size convention change,
     * new Greek model). Current: "v1".
     */
    schemaVersion: varchar("schema_version", { length: 8 }).default("v1"),

    /**
     * Date-effective NSE lot size for the underlying at capture time.
     * Populated from the static LOT_SIZES map in the ingestor. Null for
     * legacy rows or when the underlying is not in the map.
     */
    lotSize: integer("lot_size"),

    /**
     * Market/session state at the moment of capture. One of:
     *   "open"      — within regular NSE/BSE trading hours
     *   "pre_open"  — pre-open session (9:00–9:15 IST)
     *   "closed"    — after 15:30 IST / weekend / holiday
     * Null for legacy rows.
     */
    marketStatus: varchar("market_status", { length: 16 }),

    /**
     * Canary / test-run marker. Set to a unique run identifier during
     * bounded canary captures (Gate 7, Pack 9A). Null for all production
     * rows. Used for exact-key deletion of canary-only rows.
     */
    canaryMarker: varchar("canary_marker", { length: 64 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.underlying, t.expiry, t.strike, t.optType, t.capturedAt],
    }),
    underlyingExpiryTimeIdx: index("option_chain_snapshot_uex_time_idx").on(
      t.underlying,
      t.expiry,
      t.capturedAt,
    ),
    capturedAtIdx: index("option_chain_snapshot_captured_at_idx").on(t.capturedAt),
  }),
);

export type OptionChainSnapshotRow = typeof optionChainSnapshotTable.$inferSelect;
export type NewOptionChainSnapshotRow = typeof optionChainSnapshotTable.$inferInsert;

/**
 * Ingestion run book-keeping (one row per ingestor tick).
 *
 *   - `started_at` / `finished_at` give wall-clock duration.
 *   - `underlyings_attempted` vs `underlyings_ok` flags partial outages.
 *   - `rows_written` = total upserts across all underlyings/expiries.
 *   - `errors` is a small JSON array of `{underlying, message}` for the
 *     diagnostic endpoint. Capped at 20 entries by the ingestor to avoid
 *     blowing the column up if Kite is wholly down.
 *   - `source` reflects which path served the cycle (`kite` / `nse` /
 *     `mixed` / `none`).
 */
export const optionChainSnapshotRunTable = pgTable(
  "option_chain_snapshot_run",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    underlyingsAttempted: integer("underlyings_attempted").notNull(),
    underlyingsOk: integer("underlyings_ok").notNull(),
    expiriesCovered: integer("expiries_covered").notNull(),
    rowsWritten: integer("rows_written").notNull(),
    source: varchar("source", { length: 16 }).notNull(),
    errors: jsonb("errors").notNull().default([]),
  },
  (t) => ({
    startedAtIdx: index("option_chain_snapshot_run_started_idx").on(t.startedAt),
  }),
);

export type OptionChainSnapshotRunRow = typeof optionChainSnapshotRunTable.$inferSelect;
export type NewOptionChainSnapshotRunRow = typeof optionChainSnapshotRunTable.$inferInsert;
