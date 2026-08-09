import {
  pgTable,
  text,
  integer,
  date,
  serial,
  timestamp,
  jsonb,
  bigint,
  unique,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Runtime-created tables declared in Drizzle to prevent drizzle-kit push from
 * issuing DROP TABLE statements on tables it does not recognise.
 *
 * These tables are originally created via raw SQL (CREATE TABLE IF NOT EXISTS)
 * inside application startup or migration helpers so that they can be applied
 * safely without going through drizzle-kit.  The declarations here exist purely
 * so that drizzle-kit push produces a zero-diff no-op for these tables.
 *
 * BRIGHT LINE: Never run `drizzle-kit push --force` without owner approval.
 * Column types here must exactly match the live DB schema; any mismatch will
 * cause an unwanted ALTER TABLE on next push.
 *
 * R0 declaration date: 2026-07-18  (R0 Replit re-baseline, Ruling A)
 */

export const dailyReportRuns = pgTable(
  "daily_report_runs",
  {
    id: serial("id").primaryKey(),
    reportType: text("report_type").notNull(),
    istDate: text("ist_date").notNull(),
    status: text("status").notNull().default("PENDING"),
    workerId: text("worker_id"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    telegramStatus: text("telegram_status"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata"),
  },
  (t) => [
    unique("daily_report_runs_report_type_ist_date_key").on(
      t.reportType,
      t.istDate,
    ),
  ],
);

export const notificationDeliveryLog = pgTable(
  "notification_delivery_log",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    eventId: text("event_id").notNull(),
    domain: text("domain").notNull(),
    eventType: text("event_type").notNull(),
    signalId: text("signal_id"),
    orderId: text("order_id"),
    paperTradeId: text("paper_trade_id"),
    symbol: text("symbol").notNull(),
    exchange: text("exchange").notNull(),
    destination: text("destination").notNull(),
    messageHash: text("message_hash").notNull(),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    environment: text("environment").notNull().default("production"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ndl_dedup_idx").on(
      t.domain,
      t.eventType,
      t.destination,
      sql`COALESCE(${t.orderId}, ${t.signalId}, ${t.paperTradeId}, ${t.eventId})`,
    ),
  ],
);

export const systemAlertDedup = pgTable("system_alert_dedup", {
  dedupKey: text("dedup_key").primaryKey(),
  family: text("family").notNull(),
  windowMs: bigint("window_ms", { mode: "number" }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  workerId: text("worker_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const systemAlertState = pgTable("system_alert_state", {
  family: text("family").primaryKey(),
  state: text("state").notNull(),
  incidentId: text("incident_id"),
  transitionedAt: timestamp("transitioned_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  workerId: text("worker_id"),
});

/**
 * Prompt 33 Gate 1 declaration (2026-08-07).
 *
 * `kite_candle_store` is created at runtime by `kiteCandleStore.ts` via
 * `CREATE TABLE IF NOT EXISTS` inside `ensureKiteCandleSchema()`.
 * Declared here so drizzle-kit push never sees it as out-of-schema and
 * offers to DROP it on next Publish.
 *
 * Column types match the live DDL in kiteCandleStore.ts exactly.
 */
export const kiteCandleStore = pgTable(
  "kite_candle_store",
  {
    symbol:           text("symbol").notNull(),
    exchange:         text("exchange").notNull().default("NSE"),
    timeframe:        text("timeframe").notNull().default("day"),
    sessionDate:      date("session_date"),
    barCount:         integer("bar_count"),
    barsJson:         jsonb("bars_json"),
    fetchedAt:        timestamp("fetched_at", { withTimezone: true }),
    status:           text("status").notNull().default("pending"),
    errorCode:        text("error_code"),
    refreshAttemptAt: timestamp("refresh_attempt_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.exchange, t.timeframe] })],
);

/**
 * W3a declaration (2026-07-18 Weekend work).
 *
 * `reconciliation_report` is created at runtime by `eodReconciliation.ts`
 * via raw `CREATE TABLE IF NOT EXISTS` (runs lazily on first EOD tick ≥15:35 IST
 * on a trading day). Declared here so drizzle-kit push never sees it as
 * out-of-schema and offers to DROP it on next Publish.
 *
 * Column types match the live DDL in eodReconciliation.ts exactly:
 *   id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 *   ist_date DATE NOT NULL UNIQUE,
 *   status TEXT NOT NULL,
 *   checks JSONB NOT NULL,
 *   live_note TEXT NOT NULL DEFAULT '',
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 */
/**
 * Pack 33 Corrective R2 declaration (2026-08-08).
 *
 * `kite_warehouse_stop_audit` is created at runtime by `fullNseWarehouse.ts`
 * via raw `CREATE TABLE IF NOT EXISTS`. Stores one row per force-stop idempotency
 * key. UNIQUE(idempotency_key) guarantees each key produces at most one mutation.
 * Declared here so drizzle-kit push never schedules a DROP.
 *
 * Column types match the live DDL in ensureWarehouseStopAuditSchema() exactly.
 */
export const kiteWarehouseStopAudit = pgTable(
  "kite_warehouse_stop_audit",
  {
    id: serial("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    prevStatus: text("prev_status"),
    prevSnapshotId: text("prev_snapshot_id"),
    prevStoppedReason: text("prev_stopped_reason"),
    newStatus: text("new_status").notNull().default("STOPPED"),
    stoppedReason: text("stopped_reason").notNull(),
    populationLockAtStop: text("population_lock_at_stop").notNull(),
    evaluationLockUnchanged: text("evaluation_lock_unchanged").notNull().default("true"),
    candleHistoryDeleted: text("candle_history_deleted").notNull().default("false"),
    errorMessage: text("error_message"),
    resultPayload: jsonb("result_payload"),
  },
  (t) => [
    unique("kite_warehouse_stop_audit_idempotency_key_key").on(t.idempotencyKey),
  ],
);

/**
 * Pack 33B Predeploy Evidence Correction (2026-08-09).
 *
 * `nse_security_master_snapshots` holds validated, versioned copies of the NSE
 * EQUITY_L.csv reference file, persisted durably in PostgreSQL so all replicas
 * can hydrate without hitting NSE on restart.
 *
 * Created at runtime via `ensureNseMasterSnapshotSchema()` in nseSecurityMaster.ts.
 * Declared here so drizzle-kit push never offers to DROP it.
 *
 * Advisory lock key 8274613 is used for refresh single-flight across replicas.
 */
export const nseSecurityMasterSnapshots = pgTable(
  "nse_security_master_snapshots",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sourceUrl: text("source_url").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    effectiveDate: date("effective_date").notNull(),
    sha256: text("sha256").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    rowCount: integer("row_count").notNull(),
    validationResult: text("validation_result").notNull(),
    records: jsonb("records").notNull(),
    seriesCounts: jsonb("series_counts").notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("nse_security_master_snapshots_retrieved_at_idx").on(t.retrievedAt),
    index("nse_security_master_snapshots_sha256_idx").on(t.sha256),
  ],
);

export const reconciliationReport = pgTable("reconciliation_report", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  istDate: date("ist_date").notNull().unique(),
  status: text("status").notNull(),
  checks: jsonb("checks").notNull(),
  liveNote: text("live_note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
