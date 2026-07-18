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
