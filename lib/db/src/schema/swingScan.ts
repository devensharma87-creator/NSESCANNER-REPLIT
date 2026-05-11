/**
 * Swing-scanner cache (NIFTY 500 daily deep-scan + 15-min intraday refresh).
 *
 * The Python "Pro Swing Scanner v3" is ported into
 * `artifacts/api-server/src/lib/swingScanner.ts`. Its full output (Score /
 * Action / Setup / Buy Zone / Stop / Targets / sub-scores / fundamentals
 * snapshot / warnings / reasons) is heavy (~1.5 KB JSON per row × 500 rows)
 * and stable across the trading day — only the *last price* and *trigger
 * hit* flag move intraday. So we split the storage in half:
 *
 *   - `swing_scan_result` is upserted ONCE per IST trading day after
 *     close (15:35 IST latch, single replica). PK = (symbol, scan_date).
 *     Holds the locked trade plan that the UI shows for the rest of the
 *     day.
 *
 *   - The same row is updated in place every 15 min during market hours
 *     to refresh `intraday_last`, `intraday_change_pct`, and
 *     `trigger_hit` — these three columns are nullable and live cheap.
 *     No re-scoring; the plan is locked.
 *
 *   - `swing_scan_run` is one row per scan_date with run-level metadata
 *     (timing, error counts) so the UI can show "Last full scan
 *     completed N min ago, 487/500 stocks priced" honestly.
 *
 * Single-replica caveat: same as `paper_daily_summary_fo` — multi-replica
 * deployments would need an advisory lock for the EOD scheduler latch.
 */
import {
  pgTable,
  varchar,
  text,
  timestamp,
  numeric,
  integer,
  date,
  boolean,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const swingScanResultTable = pgTable(
  "swing_scan_result",
  {
    symbol: varchar("symbol", { length: 32 }).notNull(),
    scanDate: date("scan_date").notNull(),

    /* trade plan (locked at deep-scan time) */
    action: text("action").notNull(),
    setup: text("setup").notNull(),
    qualityGrade: text("quality_grade").notNull(),
    potential: text("potential").notNull(),

    /* aggregate + sub-scores */
    score: numeric("score", { precision: 6, scale: 2 }).notNull(),
    technicalScore: numeric("technical_score", { precision: 6, scale: 2 }).notNull(),
    smcScore: numeric("smc_score", { precision: 6, scale: 2 }).notNull(),
    volumeScore: numeric("volume_score", { precision: 6, scale: 2 }).notNull(),
    momentumScore: numeric("momentum_score", { precision: 6, scale: 2 }).notNull(),
    fundamentalScore: numeric("fundamental_score", { precision: 6, scale: 2 }).notNull(),
    riskScore: numeric("risk_score", { precision: 6, scale: 2 }).notNull(),
    contextScore: numeric("context_score", { precision: 6, scale: 2 }).notNull(),
    rsScore: numeric("rs_score", { precision: 6, scale: 2 }),

    /* prices + plan */
    closePrice: numeric("close_price", { precision: 18, scale: 2 }).notNull(),
    entry: numeric("entry", { precision: 18, scale: 2 }).notNull(),
    stopLoss: numeric("stop_loss", { precision: 18, scale: 2 }).notNull(),
    target1: numeric("target1", { precision: 18, scale: 2 }).notNull(),
    target2: numeric("target2", { precision: 18, scale: 2 }).notNull(),
    rrToT1: numeric("rr_to_t1", { precision: 8, scale: 2 }),
    buyZoneLower: numeric("buy_zone_lower", { precision: 18, scale: 2 }).notNull(),
    buyZoneUpper: numeric("buy_zone_upper", { precision: 18, scale: 2 }).notNull(),
    buyZoneBasis: text("buy_zone_basis").notNull(),
    triggerText: text("trigger_text").notNull(),
    triggerPrice: numeric("trigger_price", { precision: 18, scale: 2 }).notNull(),
    stopBasis: text("stop_basis").notNull(),
    targetBasis: text("target_basis").notNull(),

    /* indicators / context (display-only) */
    rsi14: numeric("rsi14", { precision: 6, scale: 2 }),
    adx14: numeric("adx14", { precision: 6, scale: 2 }),
    atr14: numeric("atr14", { precision: 18, scale: 2 }),
    atrPct: numeric("atr_pct", { precision: 6, scale: 2 }),
    volRatio: numeric("vol_ratio", { precision: 8, scale: 2 }),
    avgValueLakhs: numeric("avg_value_lakhs", { precision: 14, scale: 2 }),
    pctFrom52wLow: numeric("pct_from_52w_low", { precision: 8, scale: 2 }),
    pctFrom52wHigh: numeric("pct_from_52w_high", { precision: 8, scale: 2 }),
    weeklyTrend: text("weekly_trend").notNull(),
    candleSignal: text("candle_signal").notNull(),
    marketStructure: text("market_structure").notNull(),
    rs20: numeric("rs20", { precision: 8, scale: 2 }),
    rs50: numeric("rs50", { precision: 8, scale: 2 }),
    rs120: numeric("rs120", { precision: 8, scale: 2 }),
    sector: text("sector"),
    industry: text("industry"),
    fundamentalStatus: text("fundamental_status"),

    /* free-form narrative arrays */
    reasons: jsonb("reasons").notNull().default([]),
    warnings: jsonb("warnings").notNull().default([]),

    /* live-refreshed columns (15-min cadence) */
    intradayLast: numeric("intraday_last", { precision: 18, scale: 2 }),
    intradayChangePct: numeric("intraday_change_pct", { precision: 8, scale: 2 }),
    triggerHit: boolean("trigger_hit"),
    intradayUpdatedAt: timestamp("intraday_updated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite PRIMARY KEY (NOT just an index) — ON CONFLICT (symbol,
    // scan_date) DO UPDATE in `swingScannerStore.upsertResult` requires
    // a UNIQUE/PK constraint matching that tuple. A plain index won't
    // satisfy 42P10 ("there is no unique or exclusion constraint
    // matching the ON CONFLICT specification").
    pk: primaryKey({ columns: [t.symbol, t.scanDate] }),
    dateScoreIdx: index("swing_scan_result_date_score_idx").on(t.scanDate, t.score),
    dateActionIdx: index("swing_scan_result_date_action_idx").on(t.scanDate, t.action),
  }),
);

export type SwingScanResultRow = typeof swingScanResultTable.$inferSelect;
export type NewSwingScanResultRow = typeof swingScanResultTable.$inferInsert;

/**
 * Run-level metadata for the deep scan (one row per IST scan_date).
 * Used by the UI to show "last full scan: 487/500 priced, 14 errors,
 * completed 18m ago".
 */
export const swingScanRunTable = pgTable("swing_scan_run", {
  scanDate: date("scan_date").primaryKey(),
  scannedCount: integer("scanned_count").notNull(),
  errorCount: integer("error_count").notNull(),
  durationMs: integer("duration_ms").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  /** "DEEP_SCAN" = full scoring run; "INTRADAY_REFRESH" omitted from this table. */
  kind: text("kind").notNull().default("DEEP_SCAN"),
});

export type SwingScanRunRow = typeof swingScanRunTable.$inferSelect;
export type NewSwingScanRunRow = typeof swingScanRunTable.$inferInsert;
