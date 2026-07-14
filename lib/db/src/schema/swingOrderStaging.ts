/**
 * Swing CASH Live-Readiness — Phase 2: Order Staging + Fast Approval Queue.
 *
 * ADDITIVE table only. Captures a validated swing-cash candidate as a *staged*
 * order awaiting fast owner approval. This is NOT a broker order and NOT a
 * paper-trade ledger — broker execution is hard-disabled (see
 * `swingLiveExecutionConfig.ts`). No row here ever places a real order.
 *
 * ABSOLUTE RULES (mirrored from Phase 1):
 *   - Swing CASH / equity ONLY. Never touches F&O engine/risk/option-chain/
 *     capital-ledger/F&O paper. This table is read/written exclusively by the
 *     swing-staging service + routes.
 *   - Every staged order stores the FULL frozen candidate snapshot
 *     (`candidateSnapshotJson`) and the FULL composed risk decision
 *     (`riskDecisionJson`) at stage time, plus the latest live re-check
 *     (`recheckDecisionJson`) — for audit and honest "why".
 *   - Missing data is labelled, never fabricated. `missedOpportunityJson` uses
 *     `MISSED_PNL_UNAVAILABLE` when the price path cannot be obtained honestly.
 *
 * Per-user scoping mirrors `personal_watchlist` / `portfolios`: an opaque
 * `ownerKey` ("owner" for the site owner, "u:<userId>" for subscribers).
 *
 * Numeric figures use doublePrecision — this is a staging/queue surface (no
 * real money moves), not the precision-critical paper-trading ledger, so we
 * deliberately avoid the numeric→string round-trip.
 *
 * MIGRATION: applied via raw `CREATE TABLE IF NOT EXISTS` (see
 * `docs/swing-cash-live-readiness/`), NEVER `drizzle-kit push` — push wants to
 * DROP out-of-schema tables in this repo. The Drizzle definition exists so a
 * future guarded push would not try to re-create/alter it.
 *
 * ADDITIVE COLUMNS (TTL sweep audit, 2026-07-02): `expired_at` and
 * `expiry_reason` applied via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in
 * `swingTtlSweep.ts` on startup — never via drizzle-kit push.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";

export const SWING_ORDER_STATUSES = [
  "STAGED",
  "APPROVAL_REQUIRED",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "WATCH_ONLY",
  "DRY_RUN_PLACED",
  "BROKER_DISABLED",
] as const;

export const SWING_APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "WATCH_ONLY",
] as const;

export const SWING_EXECUTION_MODES = [
  "paper_only",
  "live_dry_run",
  "live_staged_approval",
  "live_auto_small_size",
] as const;

export const SWING_BROKER_STATUSES = [
  "BROKER_DISABLED",
  "DRY_RUN",
  "DRY_RUN_PLACED",
] as const;

export const swingOrderStagingTable = pgTable(
  "swing_order_staging",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "owner" or "u:<userId>". Opaque key — no FK, unifies owner/subscriber. */
    ownerKey: text("owner_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    // ── Instrument identity ──────────────────────────────────────────
    symbol: text("symbol").notNull(),
    exchange: text("exchange"),
    tradingSymbol: text("trading_symbol"),
    instrumentToken: integer("instrument_token"),

    // ── Order intent (BUY long cash only in v1) ─────────────────────
    side: text("side").notNull().default("BUY"),
    productType: text("product_type").notNull().default("CNC"),
    orderType: text("order_type").notNull().default("LIMIT"),

    // ── Immutable swing plan (from existing scanner — never recomputed) ─
    entryPrice: doublePrecision("entry_price").notNull(),
    limitPrice: doublePrecision("limit_price"),
    stopLoss: doublePrecision("stop_loss").notNull(),
    target1: doublePrecision("target_1").notNull(),
    target2: doublePrecision("target_2"),
    quantity: integer("quantity").notNull(),
    capitalRequired: doublePrecision("capital_required").notNull(),
    maxRisk: doublePrecision("max_risk").notNull(),
    riskPercent: doublePrecision("risk_percent").notNull(),

    // ── Classification / provenance ──────────────────────────────────
    sector: text("sector"),
    setupKey: text("setup_key"),
    signalId: text("signal_id"),
    dataSource: text("data_source").notNull(),
    dataAsOf: timestamp("data_as_of", { withTimezone: true }),

    // ── Frozen audit snapshots (full JSON, never partial) ────────────
    /** SwingCashCandidate at stage time. */
    candidateSnapshotJson: jsonb("candidate_snapshot_json").notNull(),
    /** SwingCashRiskDecision at stage time. */
    riskDecisionJson: jsonb("risk_decision_json").notNull(),
    /** Latest live re-check decision (set by refresh/approve). */
    recheckDecisionJson: jsonb("recheck_decision_json"),

    // ── Lifecycle ────────────────────────────────────────────────────
    status: text("status").notNull(),
    approvalStatus: text("approval_status").notNull().default("PENDING"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    executionMode: text("execution_mode").notNull(),

    // ── Broker (HARD-DISABLED — never a real order) ──────────────────
    brokerOrderId: text("broker_order_id"),
    brokerStatus: text("broker_status").notNull().default("BROKER_DISABLED"),
    brokerResponseJson: jsonb("broker_response_json"),

    // ── Manual event / corporate-action override (Part H) ────────────
    resultDateKnown: boolean("result_date_known"),
    /** ISO yyyy-mm-dd; text to dodge timezone shifts. */
    resultDate: text("result_date"),
    corporateActionRisk: boolean("corporate_action_risk"),
    eventRiskStatus: text("event_risk_status"),
    manualReviewRequired: boolean("manual_review_required").notNull().default(false),

    // ── Missed-opportunity tracker (Part F) ──────────────────────────
    missedOpportunityJson: jsonb("missed_opportunity_json"),

    // ── TTL sweep audit (additive nullable — applied via ALTER TABLE IF NOT EXISTS) ─
    /** Timestamp when the order was expired; null for non-EXPIRED rows. */
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    /** Why the order expired: 'TTL_EXPIRED' | 'MANUAL_EXPIRE' | 'BATCH_EXPIRE'. */
    expiryReason: text("expiry_reason"),
  },
  (t) => ({
    byOwner: index("swing_order_staging_owner_idx").on(t.ownerKey),
    byStatus: index("swing_order_staging_status_idx").on(t.status),
    byOwnerStatus: index("swing_order_staging_owner_status_idx").on(t.ownerKey, t.status),
    byExpiresAt: index("swing_order_staging_expires_at_idx").on(t.expiresAt),
    // Lifecycle invariants — defense in depth against direct SQL writes.
    statusChk: check(
      "swing_order_staging_status_chk",
      sql`${t.status} in ('STAGED','APPROVAL_REQUIRED','APPROVED','REJECTED','EXPIRED','CANCELLED','WATCH_ONLY','DRY_RUN_PLACED','BROKER_DISABLED')`,
    ),
    approvalStatusChk: check(
      "swing_order_staging_approval_status_chk",
      sql`${t.approvalStatus} in ('PENDING','APPROVED','REJECTED','EXPIRED','WATCH_ONLY')`,
    ),
    sideChk: check("swing_order_staging_side_chk", sql`${t.side} in ('BUY','SELL')`),
    executionModeChk: check(
      "swing_order_staging_execution_mode_chk",
      sql`${t.executionMode} in ('paper_only','live_dry_run','live_staged_approval','live_auto_small_size')`,
    ),
    brokerStatusChk: check(
      "swing_order_staging_broker_status_chk",
      sql`${t.brokerStatus} in ('BROKER_DISABLED','DRY_RUN','DRY_RUN_PLACED')`,
    ),
    quantityChk: check("swing_order_staging_quantity_chk", sql`${t.quantity} > 0`),
    entryPriceChk: check("swing_order_staging_entry_price_chk", sql`${t.entryPrice} > 0`),
    stopLossChk: check("swing_order_staging_stop_loss_chk", sql`${t.stopLoss} > 0`),
    target1Chk: check("swing_order_staging_target_1_chk", sql`${t.target1} > 0`),
  }),
);

export type SwingOrderStagingRow = typeof swingOrderStagingTable.$inferSelect;
export type NewSwingOrderStagingRow = typeof swingOrderStagingTable.$inferInsert;
