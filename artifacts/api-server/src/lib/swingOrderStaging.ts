/**
 * Swing CASH Live-Readiness — Phase 2: order staging + fast-approval service.
 *
 * Persists validated swing-cash candidates as *staged* orders, runs a fresh
 * fail-closed Phase-1 re-check at approval time, and (in dry-run mode) records a
 * synthetic placement. NOTHING here ever places a real broker order — broker
 * execution is hard-disabled (`swingLiveExecutionConfig.ts`).
 *
 * ABSOLUTE RULES:
 *   - Touches ONLY `swing_order_staging` (+ kill-switch app_state read). Never
 *     the F&O engine/risk/option-chain/capital-ledger/F&O paper, never the swing
 *     scoring or entry/SL/target formulas (the plan is frozen at stage time).
 *   - Kill switch is checked before stage / approve / dry-run. Fail-closed.
 *   - When the hard broker flag is false, broker fields stay null /
 *     BROKER_DISABLED. Approval NEVER buys anything.
 *   - Missing data is labelled, never fabricated.
 */

import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  swingOrderStagingTable,
  type NewSwingOrderStagingRow,
  type SwingOrderStagingRow,
} from "@workspace/db/schema";
import {
  DEFAULT_SWING_CASH_CONFIG,
  evaluateSwingCashRisk,
} from "./swingCashRiskGuards";
import type {
  SwingCashCandidate,
  SwingCashPortfolioState,
  SwingCashRiskConfig,
  SwingCashRiskDecision,
} from "./swingCashTypes";
import {
  createKiteSwingQuoteFetcher,
  daysBetweenIstDates,
  istDateKey,
  rebuildCandidateForRecheck,
  type SwingEventOverride,
  type SwingLiveQuote,
  type SwingQuoteFetcher,
  type SwingRecheckAvailability,
} from "./swingCashLiveCandidateAdapter";
import { getSwingCashBookCapital, getSwingExecutionMode } from "./swingLiveExecutionConfig";
import { isKillSwitchActive } from "./swingKillSwitch";
import { placeOrderDryRun } from "./swingDryRunBroker";
import {
  alertSwingOrderStaged,
  alertSwingOrderExpired,
  alertSwingOrderRejected,
  alertSwingOrderApprovedDryRun,
} from "./swingAlerts";

// ---------------------------------------------------------------------------
// Lifecycle vocab (kept in sync with the schema CHECK constraints).
// ---------------------------------------------------------------------------

export type SwingOrderStatus =
  | "STAGED"
  | "APPROVAL_REQUIRED"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED"
  | "WATCH_ONLY"
  | "DRY_RUN_PLACED"
  | "BROKER_DISABLED";

export type SwingApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "WATCH_ONLY";

export type SwingBrokerStatus = "BROKER_DISABLED" | "DRY_RUN" | "DRY_RUN_PLACED";

/** Statuses on which an order may still be approved/rejected/expired. */
export const ACTIVE_STATUSES: readonly SwingOrderStatus[] = [
  "STAGED",
  "APPROVAL_REQUIRED",
  "WATCH_ONLY",
];

/** Default staged-order time-to-live: 8h (expiry-on-read marks them EXPIRED). */
export const DEFAULT_STAGING_TTL_MS = 8 * 60 * 60 * 1000;

function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** Frozen audit snapshot stored in `candidate_snapshot_json`. */
export interface SwingStagedSnapshot {
  candidate: SwingCashCandidate;
  portfolioState: SwingCashPortfolioState;
}

/** Re-check payload stored in `recheck_decision_json`. */
export interface SwingRecheckRecord {
  decision: SwingCashRiskDecision;
  availability: SwingRecheckAvailability;
  recheckedAt: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable without a DB).
// ---------------------------------------------------------------------------

export interface StageStatusDerivation {
  status: SwingOrderStatus;
  approvalStatus: SwingApprovalStatus;
  /** False for an un-reviewable hard block — such a candidate is never stored. */
  stageable: boolean;
}

/**
 * Map a composed risk decision onto the initial staged lifecycle state.
 *   - waiting for trigger        → WATCH_ONLY
 *   - needs manual review        → APPROVAL_REQUIRED (owner can override)
 *   - clean & allowed            → STAGED
 *   - hard block, no review path → REJECTED (not stored)
 */
export function deriveStageStatus(decision: SwingCashRiskDecision): StageStatusDerivation {
  if (decision.gates.entry.watchOnly) {
    return { status: "WATCH_ONLY", approvalStatus: "WATCH_ONLY", stageable: true };
  }
  if (decision.reviewRequired) {
    return { status: "APPROVAL_REQUIRED", approvalStatus: "PENDING", stageable: true };
  }
  if (decision.allowed) {
    return { status: "STAGED", approvalStatus: "PENDING", stageable: true };
  }
  return { status: "REJECTED", approvalStatus: "REJECTED", stageable: false };
}

export interface SwingMissedOpportunity {
  status: "MISSED_PNL_UNAVAILABLE" | "PRICE_AT_EXPIRY_RECORDED";
  reason: string;
  entry: number;
  stop: number;
  target1: number;
  target2: number | null;
  priceAtExpiry: number | null;
  priceAtExpirySource: string | null;
  /** Intraday path is never captured here, so these stay null (never fabricated). */
  pathHigh: null;
  pathLow: null;
  computedAt: string;
}

/**
 * Build the honest missed-opportunity record stamped when a staged order
 * expires. Without the post-stage intraday high/low path we CANNOT know whether
 * target/stop would have hit, so the true missed P&L is `MISSED_PNL_UNAVAILABLE`.
 * If a live quote is supplied we record the price at expiry only — never a
 * fabricated outcome.
 */
export function buildMissedOpportunity(
  row: Pick<SwingOrderStagingRow, "entryPrice" | "stopLoss" | "target1" | "target2">,
  quote: SwingLiveQuote | null,
  nowMs: number,
): SwingMissedOpportunity {
  const fresh = !!quote && quote.ok && quote.ltp != null && Number.isFinite(quote.ltp);
  return {
    status: fresh ? "PRICE_AT_EXPIRY_RECORDED" : "MISSED_PNL_UNAVAILABLE",
    reason:
      "Post-stage intraday high/low price path was not captured, so the true " +
      "missed P&L (whether target/stop would have hit) cannot be computed honestly.",
    entry: row.entryPrice,
    stop: row.stopLoss,
    target1: row.target1,
    target2: row.target2 ?? null,
    priceAtExpiry: fresh ? (quote!.ltp as number) : null,
    priceAtExpirySource: fresh ? (quote!.dataSource != null ? String(quote!.dataSource) : null) : null,
    pathHigh: null,
    pathLow: null,
    computedAt: new Date(nowMs).toISOString(),
  };
}

function withActiveMode(config?: SwingCashRiskConfig): SwingCashRiskConfig {
  return { ...(config ?? DEFAULT_SWING_CASH_CONFIG), mode: getSwingExecutionMode() };
}

function mergeOverride(
  row: Pick<SwingOrderStagingRow, "resultDateKnown" | "resultDate" | "corporateActionRisk">,
  provided?: SwingEventOverride | null,
): SwingEventOverride | null {
  const base: SwingEventOverride = {
    resultDateKnown: row.resultDateKnown,
    resultDate: row.resultDate,
    corporateActionRisk: row.corporateActionRisk,
  };
  const merged: SwingEventOverride = {
    resultDateKnown: provided?.resultDateKnown ?? base.resultDateKnown,
    resultDate: provided?.resultDate ?? base.resultDate,
    corporateActionRisk: provided?.corporateActionRisk ?? base.corporateActionRisk,
  };
  if (
    merged.resultDateKnown == null &&
    merged.resultDate == null &&
    merged.corporateActionRisk == null
  ) {
    return null;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export interface StageSwingOrderInput {
  ownerKey: string;
  candidate: SwingCashCandidate;
  portfolioState: SwingCashPortfolioState;
  exchange?: string | null;
  tradingSymbol?: string | null;
  instrumentToken?: number | null;
  setupKey?: string | null;
  signalId?: string | null;
  eventOverride?: SwingEventOverride | null;
  config?: SwingCashRiskConfig;
  ttlMs?: number;
  now?: Date;
}

export interface StageSwingOrderResult {
  staged: boolean;
  status: SwingOrderStatus;
  reason?: string;
  decision: SwingCashRiskDecision;
  row?: SwingOrderStagingRow;
}

// ---------------------------------------------------------------------------
// Portfolio-state builder (lane-scoped — committed orders only).
// ---------------------------------------------------------------------------

/** Statuses that represent capital actually committed in this lane. */
const COMMITTED_STATUSES: readonly SwingOrderStatus[] = ["APPROVED", "DRY_RUN_PLACED"];

/**
 * Build the `SwingCashPortfolioState` the risk engine needs, derived HONESTLY
 * from this owner's own staging rows. Only COMMITTED orders (APPROVED /
 * DRY_RUN_PLACED) count as deployed capital / open positions — pending staged
 * rows do not reserve exposure. This state is captured at STAGE time and frozen
 * into the candidate snapshot; the approval / refresh re-check re-fetches the
 * LIVE quote but re-evaluates exposure/entry caps against that stage-time
 * committed snapshot. Phase-2 scope: the broker is hard-disabled, so positions
 * are notional and no real capital is ever at risk — live per-approval
 * re-derivation of committed state (to close the concurrent-approval window) is
 * a documented Phase-3 follow-up. `totalSwingCapital` is the notional book
 * (NO real money moves). Never fabricates a position.
 */
export async function buildSwingPortfolioState(
  ownerKey: string,
  now: Date = new Date(),
): Promise<SwingCashPortfolioState> {
  const rows = await db
    .select()
    .from(swingOrderStagingTable)
    .where(
      and(
        eq(swingOrderStagingTable.ownerKey, ownerKey),
        inArray(swingOrderStagingTable.status, [...COMMITTED_STATUSES]),
      ),
    );

  const totalSwingCapital = getSwingCashBookCapital();
  const todayIst = istDateKey(now.getTime());

  const sectorExposureValueBySector: Record<string, number> = {};
  const singleStockExposureValueBySymbol: Record<string, number> = {};
  const sectorOpenCountBySector: Record<string, number> = {};
  const lastEntryDateBySymbolIst: Record<string, string> = {};
  const openPositionSymbols: string[] = [];
  let deployed = 0;
  let dailyEntriesUsed = 0;
  let weeklyEntriesUsed = 0;

  for (const r of rows) {
    const value = Number.isFinite(r.capitalRequired) ? r.capitalRequired : 0;
    deployed += value;
    if (!openPositionSymbols.includes(r.symbol)) openPositionSymbols.push(r.symbol);
    singleStockExposureValueBySymbol[r.symbol] =
      (singleStockExposureValueBySymbol[r.symbol] ?? 0) + value;
    const sector = r.sector ?? "UNKNOWN";
    sectorExposureValueBySector[sector] = (sectorExposureValueBySector[sector] ?? 0) + value;
    sectorOpenCountBySector[sector] = (sectorOpenCountBySector[sector] ?? 0) + 1;
    const entryMs = (r.approvedAt ?? r.createdAt).getTime();
    const entryIst = istDateKey(entryMs);
    lastEntryDateBySymbolIst[r.symbol] = entryIst;
    if (entryIst === todayIst) dailyEntriesUsed += 1;
    const gap = daysBetweenIstDates(todayIst, entryIst);
    if (gap != null && Math.abs(gap) <= 6) weeklyEntriesUsed += 1;
  }

  return {
    totalSwingCapital,
    availableCash: Math.max(0, totalSwingCapital - deployed),
    openPositionSymbols,
    sectorExposureValueBySector,
    singleStockExposureValueBySymbol,
    sectorOpenCountBySector,
    lastEntryDateBySymbolIst,
    todayIst,
    dailyEntriesUsed,
    weeklyEntriesUsed,
    openPositionsCount: openPositionSymbols.length,
  };
}

/**
 * Validate a candidate and (if stageable) persist it as a staged order. Refuses
 * to store an un-reviewable hard block, an invalid plan, a zero-qty sizing, or
 * anything while the kill switch is active.
 */
export async function stageSwingOrder(
  input: StageSwingOrderInput,
): Promise<StageSwingOrderResult> {
  const now = input.now ?? new Date();
  const config = withActiveMode(input.config);
  const candidate = input.candidate;
  const decision = evaluateSwingCashRisk(candidate, input.portfolioState, config);
  const { status, approvalStatus, stageable } = deriveStageStatus(decision);

  if (await isKillSwitchActive()) {
    return { staged: false, status: "REJECTED", reason: "KILL_SWITCH_ACTIVE", decision };
  }
  if (!stageable) {
    return { staged: false, status, reason: "NOT_STAGEABLE_HARD_BLOCK", decision };
  }
  if (!(candidate.entry > 0 && candidate.stop > 0 && candidate.target1 > 0)) {
    return { staged: false, status, reason: "INVALID_PLAN", decision };
  }
  const m = decision.metrics;
  if (!(m.qty >= 1)) {
    return { staged: false, status, reason: "SIZING_QTY_ZERO", decision };
  }

  const snapshot: SwingStagedSnapshot = { candidate, portfolioState: input.portfolioState };
  const values: NewSwingOrderStagingRow = {
    ownerKey: input.ownerKey,
    symbol: candidate.symbol,
    exchange: input.exchange ?? null,
    tradingSymbol: input.tradingSymbol ?? null,
    instrumentToken: input.instrumentToken ?? null,
    side: "BUY",
    productType: "CNC",
    orderType: "LIMIT",
    entryPrice: candidate.entry,
    limitPrice: candidate.entry,
    stopLoss: candidate.stop,
    target1: candidate.target1,
    target2: candidate.target2 ?? null,
    quantity: m.qty,
    capitalRequired: m.capitalRequired,
    maxRisk: m.maxLoss,
    riskPercent: m.riskPct,
    sector: candidate.sector ?? null,
    setupKey: input.setupKey ?? null,
    signalId: input.signalId ?? null,
    dataSource: String(candidate.dataSource ?? "unknown"),
    dataAsOf: candidate.ltpAsOfMs != null ? new Date(candidate.ltpAsOfMs) : null,
    candidateSnapshotJson: snapshot,
    riskDecisionJson: decision,
    status,
    approvalStatus,
    expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_STAGING_TTL_MS)),
    executionMode: config.mode,
    brokerStatus: "BROKER_DISABLED",
    resultDateKnown: input.eventOverride?.resultDateKnown ?? null,
    resultDate: input.eventOverride?.resultDate ?? null,
    corporateActionRisk: input.eventOverride?.corporateActionRisk ?? null,
    eventRiskStatus: m.eventClassification,
    manualReviewRequired: decision.reviewRequired,
    createdAt: now,
    updatedAt: now,
  };

  const [row] = await db.insert(swingOrderStagingTable).values(values).returning();
  // Alert after successful DB write — fire-and-forget, never rolls back staging.
  if (row) {
    try { alertSwingOrderStaged(row); } catch { /* safe-fail */ }
  }
  return { staged: true, status, decision, row };
}

// ---------------------------------------------------------------------------
// Expiry (expiry-on-read + manual sweep)
// ---------------------------------------------------------------------------

export interface ExpireStaleOptions {
  now?: Date;
  /** Optional fetcher to record price-at-expiry; omitted → MISSED_PNL_UNAVAILABLE. */
  fetchQuote?: SwingQuoteFetcher;
}

/**
 * Mark active orders whose TTL has passed as EXPIRED, stamping an honest
 * missed-opportunity record. Scoped to one owner when `ownerKey` is given, else
 * sweeps all owners (manual /expire-stale). Each transition is CAS-guarded.
 */
export async function expireStaleSwingOrders(
  ownerKey: string | null,
  opts: ExpireStaleOptions = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const conds = [
    inArray(swingOrderStagingTable.status, [...ACTIVE_STATUSES]),
    lt(swingOrderStagingTable.expiresAt, now),
  ];
  if (ownerKey) conds.push(eq(swingOrderStagingTable.ownerKey, ownerKey));
  const stale = await db
    .select()
    .from(swingOrderStagingTable)
    .where(and(...conds));

  let expired = 0;
  for (const r of stale) {
    let quote: SwingLiveQuote | null = null;
    if (opts.fetchQuote) quote = await opts.fetchQuote(r.symbol).catch(() => null);
    const missed = buildMissedOpportunity(r, quote, now.getTime());
    const res = await db
      .update(swingOrderStagingTable)
      .set({
        status: "EXPIRED",
        approvalStatus: "EXPIRED",
        missedOpportunityJson: missed,
        updatedAt: now,
      })
      .where(and(eq(swingOrderStagingTable.id, r.id), eq(swingOrderStagingTable.status, r.status)))
      .returning({ id: swingOrderStagingTable.id });
    if (res.length) {
      expired++;
      // Alert after successful expire — fire-and-forget, never rolls back expiry.
      try { alertSwingOrderExpired(r); } catch { /* safe-fail */ }
    }
  }
  return expired;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface ListSwingOrdersOptions {
  statuses?: string[];
  now?: Date;
}

export async function listSwingOrders(
  ownerKey: string,
  opts: ListSwingOrdersOptions = {},
): Promise<SwingOrderStagingRow[]> {
  const now = opts.now ?? new Date();
  await expireStaleSwingOrders(ownerKey, { now });
  const conds = [eq(swingOrderStagingTable.ownerKey, ownerKey)];
  if (opts.statuses?.length) conds.push(inArray(swingOrderStagingTable.status, opts.statuses));
  return db
    .select()
    .from(swingOrderStagingTable)
    .where(and(...conds))
    .orderBy(desc(swingOrderStagingTable.createdAt));
}

export async function getSwingOrder(
  ownerKey: string,
  id: string,
  now: Date = new Date(),
): Promise<SwingOrderStagingRow | null> {
  await expireStaleSwingOrders(ownerKey, { now });
  const [row] = await db
    .select()
    .from(swingOrderStagingTable)
    .where(and(eq(swingOrderStagingTable.id, id), eq(swingOrderStagingTable.ownerKey, ownerKey)))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Re-check (no state transition — refreshes recheck_decision_json)
// ---------------------------------------------------------------------------

export interface RecheckOptions {
  fetchQuote?: SwingQuoteFetcher;
  eventOverride?: SwingEventOverride | null;
  config?: SwingCashRiskConfig;
  now?: Date;
}

export type RecheckResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      decision: SwingCashRiskDecision;
      availability: SwingRecheckAvailability;
      row: SwingOrderStagingRow;
    };

export async function refreshAndRecheckSwingOrder(
  ownerKey: string,
  id: string,
  opts: RecheckOptions = {},
): Promise<RecheckResult> {
  const now = opts.now ?? new Date();
  const row = await getSwingOrder(ownerKey, id, now);
  if (!row) return { ok: false, reason: "NOT_FOUND" };

  const snap = row.candidateSnapshotJson as SwingStagedSnapshot;
  const override = mergeOverride(row, opts.eventOverride);
  const fetchQuote = opts.fetchQuote ?? createKiteSwingQuoteFetcher();
  const quote = await fetchQuote(row.symbol).catch(() => null);
  const { candidate, availability } = rebuildCandidateForRecheck(
    snap.candidate,
    quote,
    override,
    now.getTime(),
  );
  const decision = evaluateSwingCashRisk(candidate, snap.portfolioState, withActiveMode(opts.config));
  const recheck: SwingRecheckRecord = { decision, availability, recheckedAt: now.toISOString() };
  await db
    .update(swingOrderStagingTable)
    .set({ recheckDecisionJson: recheck, manualReviewRequired: decision.reviewRequired, updatedAt: now })
    .where(and(eq(swingOrderStagingTable.id, id), eq(swingOrderStagingTable.ownerKey, ownerKey)));
  return { ok: true, decision, availability, row };
}

// ---------------------------------------------------------------------------
// Approve (CAS + fresh fail-closed re-check)
// ---------------------------------------------------------------------------

export interface ApproveOptions {
  fetchQuote?: SwingQuoteFetcher;
  eventOverride?: SwingEventOverride | null;
  config?: SwingCashRiskConfig;
  now?: Date;
}

export type ApproveResult =
  | { approved: false; reason: string; decision?: SwingCashRiskDecision; availability?: SwingRecheckAvailability }
  | {
      approved: true;
      status: SwingOrderStatus;
      decision: SwingCashRiskDecision;
      availability: SwingRecheckAvailability;
      row: SwingOrderStagingRow;
    };

/**
 * Fast approval. Kill-switch checked first, then a FRESH live re-check that must
 * pass every Phase-1 gate (fail-closed). On success the order is finalised per
 * execution mode: dry-run records a SYNTHETIC placement; every other mode lands
 * APPROVED with broker fields null / BROKER_DISABLED. No real order is ever
 * placed. CAS on the prior status defends against double-approval races.
 */
export async function approveSwingOrder(
  ownerKey: string,
  id: string,
  approvedBy: string | null,
  opts: ApproveOptions = {},
): Promise<ApproveResult> {
  const now = opts.now ?? new Date();
  if (await isKillSwitchActive()) return { approved: false, reason: "KILL_SWITCH_ACTIVE" };

  await expireStaleSwingOrders(ownerKey, { now });
  const [row] = await db
    .select()
    .from(swingOrderStagingTable)
    .where(and(eq(swingOrderStagingTable.id, id), eq(swingOrderStagingTable.ownerKey, ownerKey)))
    .limit(1);
  if (!row) return { approved: false, reason: "NOT_FOUND" };
  if (!isActive(row.status)) return { approved: false, reason: `NOT_ACTIONABLE:${row.status}` };
  if (row.expiresAt.getTime() <= now.getTime()) return { approved: false, reason: "EXPIRED" };

  const snap = row.candidateSnapshotJson as SwingStagedSnapshot;
  const override = mergeOverride(row, opts.eventOverride);
  const fetchQuote = opts.fetchQuote ?? createKiteSwingQuoteFetcher();
  const quote = await fetchQuote(row.symbol).catch(() => null);
  const { candidate, availability } = rebuildCandidateForRecheck(
    snap.candidate,
    quote,
    override,
    now.getTime(),
  );
  // The owner's approval IS the required manual-review step, so clear that soft
  // gate for the approval recheck. Every HARD objective block (stale data,
  // chased entry, exposure/duplicate caps, weak R:R) and every data/event
  // review the owner cannot resolve by clicking approve still fails closed.
  const config = { ...withActiveMode(opts.config), requireManualApproval: false };
  const decision = evaluateSwingCashRisk(candidate, snap.portfolioState, config);
  const recheck: SwingRecheckRecord = { decision, availability, recheckedAt: now.toISOString() };

  if (!decision.allowed) {
    await db
      .update(swingOrderStagingTable)
      .set({
        recheckDecisionJson: recheck,
        manualReviewRequired: decision.reviewRequired,
        resultDateKnown: override?.resultDateKnown ?? row.resultDateKnown,
        resultDate: override?.resultDate ?? row.resultDate,
        corporateActionRisk: override?.corporateActionRisk ?? row.corporateActionRisk,
        updatedAt: now,
      })
      .where(and(eq(swingOrderStagingTable.id, id), eq(swingOrderStagingTable.status, row.status)));
    return { approved: false, reason: "RECHECK_BLOCKED", decision, availability };
  }

  // Allowed → finalise per execution mode. Broker stays HARD-disabled.
  let newStatus: SwingOrderStatus = "APPROVED";
  let brokerStatus: SwingBrokerStatus = "BROKER_DISABLED";
  let brokerOrderId: string | null = null;
  let brokerResponseJson: unknown = null;

  if (config.mode === "live_dry_run") {
    const dry = placeOrderDryRun(
      {
        symbol: row.symbol,
        side: row.side,
        quantity: row.quantity,
        entryPrice: row.entryPrice,
        limitPrice: row.limitPrice,
        orderType: row.orderType,
        productType: row.productType,
        exchange: row.exchange,
      },
      now,
    );
    newStatus = "DRY_RUN_PLACED";
    brokerStatus = "DRY_RUN_PLACED";
    brokerOrderId = dry.brokerOrderId;
    brokerResponseJson = dry;
  }

  const res = await db
    .update(swingOrderStagingTable)
    .set({
      status: newStatus,
      approvalStatus: "APPROVED",
      approvedBy: approvedBy ? approvedBy.slice(0, 80) : null,
      approvedAt: now,
      recheckDecisionJson: recheck,
      brokerStatus,
      brokerOrderId,
      brokerResponseJson,
      manualReviewRequired: false,
      resultDateKnown: override?.resultDateKnown ?? row.resultDateKnown,
      resultDate: override?.resultDate ?? row.resultDate,
      corporateActionRisk: override?.corporateActionRisk ?? row.corporateActionRisk,
      updatedAt: now,
    })
    .where(
      and(
        eq(swingOrderStagingTable.id, id),
        eq(swingOrderStagingTable.ownerKey, ownerKey),
        eq(swingOrderStagingTable.status, row.status),
        gt(swingOrderStagingTable.expiresAt, now),
      ),
    )
    .returning();
  if (res.length === 0) return { approved: false, reason: "CONCURRENT_MODIFICATION" };
  const approvedRow = res[0];
  // Alert dry-run approvals — fire-and-forget, never rolls back approval.
  if (newStatus === "DRY_RUN_PLACED") {
    try { alertSwingOrderApprovedDryRun(approvedRow); } catch { /* safe-fail */ }
  }
  return { approved: true, status: newStatus, decision, availability, row: approvedRow };
}

// ---------------------------------------------------------------------------
// Reject / watch-only / cancel (simple CAS transitions)
// ---------------------------------------------------------------------------

export type TransitionResult =
  | { ok: false; reason: string }
  | { ok: true; row: SwingOrderStagingRow };

async function loadActionable(ownerKey: string, id: string): Promise<SwingOrderStagingRow | "missing" | "inactive"> {
  const [row] = await db
    .select()
    .from(swingOrderStagingTable)
    .where(and(eq(swingOrderStagingTable.id, id), eq(swingOrderStagingTable.ownerKey, ownerKey)))
    .limit(1);
  if (!row) return "missing";
  if (!isActive(row.status)) return "inactive";
  return row;
}

export async function rejectSwingOrder(
  ownerKey: string,
  id: string,
  reason: string | null,
  now: Date = new Date(),
): Promise<TransitionResult> {
  const row = await loadActionable(ownerKey, id);
  if (row === "missing") return { ok: false, reason: "NOT_FOUND" };
  if (row === "inactive") return { ok: false, reason: "NOT_ACTIONABLE" };
  const res = await db
    .update(swingOrderStagingTable)
    .set({
      status: "REJECTED",
      approvalStatus: "REJECTED",
      rejectionReason: reason ? reason.slice(0, 300) : null,
      updatedAt: now,
    })
    .where(and(eq(swingOrderStagingTable.id, id), eq(swingOrderStagingTable.status, row.status)))
    .returning();
  if (!res.length) return { ok: false, reason: "CONCURRENT_MODIFICATION" };
  const rejectedRow = res[0];
  // Alert after successful rejection — fire-and-forget.
  try { alertSwingOrderRejected(rejectedRow); } catch { /* safe-fail */ }
  return { ok: true, row: rejectedRow };
}

export async function markWatchOnlySwingOrder(
  ownerKey: string,
  id: string,
  now: Date = new Date(),
): Promise<TransitionResult> {
  const row = await loadActionable(ownerKey, id);
  if (row === "missing") return { ok: false, reason: "NOT_FOUND" };
  if (row === "inactive") return { ok: false, reason: "NOT_ACTIONABLE" };
  const res = await db
    .update(swingOrderStagingTable)
    .set({ status: "WATCH_ONLY", approvalStatus: "WATCH_ONLY", updatedAt: now })
    .where(and(eq(swingOrderStagingTable.id, id), eq(swingOrderStagingTable.status, row.status)))
    .returning();
  if (!res.length) return { ok: false, reason: "CONCURRENT_MODIFICATION" };
  return { ok: true, row: res[0] };
}

/**
 * Owner-initiated immediate expiry of ONE active order (regardless of its TTL),
 * stamping the same honest missed-opportunity record as the TTL sweep. CAS on
 * the prior status guards against a concurrent transition.
 */
export async function manuallyExpireSwingOrder(
  ownerKey: string,
  id: string,
  opts: { fetchQuote?: SwingQuoteFetcher; now?: Date } = {},
): Promise<TransitionResult> {
  const now = opts.now ?? new Date();
  const row = await loadActionable(ownerKey, id);
  if (row === "missing") return { ok: false, reason: "NOT_FOUND" };
  if (row === "inactive") return { ok: false, reason: "NOT_ACTIONABLE" };
  let quote: SwingLiveQuote | null = null;
  if (opts.fetchQuote) quote = await opts.fetchQuote(row.symbol).catch(() => null);
  const missed = buildMissedOpportunity(row, quote, now.getTime());
  const res = await db
    .update(swingOrderStagingTable)
    .set({
      status: "EXPIRED",
      approvalStatus: "EXPIRED",
      missedOpportunityJson: missed,
      updatedAt: now,
    })
    .where(and(eq(swingOrderStagingTable.id, id), eq(swingOrderStagingTable.status, row.status)))
    .returning();
  if (!res.length) return { ok: false, reason: "CONCURRENT_MODIFICATION" };
  const expiredRow = res[0];
  // Alert after successful manual expire — fire-and-forget.
  try { alertSwingOrderExpired(expiredRow); } catch { /* safe-fail */ }
  return { ok: true, row: expiredRow };
}

export async function cancelSwingOrder(
  ownerKey: string,
  id: string,
  now: Date = new Date(),
): Promise<TransitionResult> {
  const row = await loadActionable(ownerKey, id);
  if (row === "missing") return { ok: false, reason: "NOT_FOUND" };
  if (row === "inactive") return { ok: false, reason: "NOT_ACTIONABLE" };
  const res = await db
    .update(swingOrderStagingTable)
    .set({ status: "CANCELLED", updatedAt: now })
    .where(and(eq(swingOrderStagingTable.id, id), eq(swingOrderStagingTable.status, row.status)))
    .returning();
  if (!res.length) return { ok: false, reason: "CONCURRENT_MODIFICATION" };
  return { ok: true, row: res[0] };
}
