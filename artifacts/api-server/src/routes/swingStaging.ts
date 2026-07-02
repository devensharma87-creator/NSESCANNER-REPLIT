/**
 * Swing CASH Live-Readiness — Phase 2 staging + fast-approval queue.
 *
 *   GET  /swing/status                      — execution mode + broker-disabled + kill-switch (read)
 *   POST /swing/kill-switch                 — owner: engage/disengage the kill switch
 *   GET  /swing/staged-orders               — list this owner's staged orders (read)
 *   POST /swing/staged-orders               — owner: stage a candidate (server fetches the live quote)
 *   POST /swing/staged-orders/expire-stale  — owner: sweep this owner's TTL-passed orders
 *   GET  /swing/staged-orders/:id           — one staged order (read)
 *   POST /swing/staged-orders/:id/refresh   — owner: live re-check (no transition)
 *   POST /swing/staged-orders/:id/approve   — owner: fast approval w/ fail-closed recheck (NO real order)
 *   POST /swing/staged-orders/:id/reject    — owner: reject with reason
 *   POST /swing/staged-orders/:id/watch     — owner: mark watch-only
 *   POST /swing/staged-orders/:id/expire    — owner: manually expire one order now
 *
 * ABSOLUTE: broker execution is hard-disabled — approval NEVER places a real
 * order. The client supplies ONLY the immutable swing plan + known context; the
 * server fetches every data-trust field itself (Kite authoritative, Yahoo never
 * trade-grade), so a caller can never assert trade-grade freshness. Reads are
 * subscriber+owner (ownerKey-scoped — each sees only their own rows; public mode
 * returns empty). All mutations are owner-only.
 */

import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import type { SwingOrderStagingRow } from "@workspace/db/schema";
import {
  StageSwingStagedOrderBody,
  SetSwingKillSwitchBody,
  RejectSwingStagedOrderBody,
  RefreshSwingStagedOrderBody,
  ApproveSwingStagedOrderBody,
  ListSwingStagedOrdersQueryParams,
} from "@workspace/api-zod";
import { getSession, requireOwner, requireSubscriberOrOwner } from "../lib/userAuth";
import { isPublicAccessEnabled } from "../lib/publicAccess";
import { getSwingExecutionStatus } from "../lib/swingLiveExecutionConfig";
import { getKillSwitch, setKillSwitch } from "../lib/swingKillSwitch";
import {
  createKiteSwingQuoteFetcher,
  rebuildCandidateForRecheck,
  type SwingEventOverride,
} from "../lib/swingCashLiveCandidateAdapter";
import type { SwingCashCandidate } from "../lib/swingCashTypes";
import {
  stageSwingOrder,
  listSwingOrders,
  getSwingOrder,
  refreshAndRecheckSwingOrder,
  approveSwingOrder,
  rejectSwingOrder,
  markWatchOnlySwingOrder,
  manuallyExpireSwingOrder,
  expireStaleSwingOrders,
  previewStaleSwingOrders,
  buildSwingPortfolioState,
} from "../lib/swingOrderStaging";
import {
  getSwingTtlSweepState,
  runSwingTtlSweepOnce,
} from "../lib/swingTtlSweep";
import { alertSwingOrderBlockedByRisk } from "../lib/swingAlerts";

const router: IRouter = Router();

function ownerKeyFor(req: Request): string | null {
  const s = getSession(req);
  if (!s) return null;
  return s.role === "owner" ? "owner" : `u:${s.userId}`;
}

function paramId(req: Request): string {
  const v = req.params["id"];
  return typeof v === "string" ? v : "";
}

/** Serialise a row into the documented `SwingStagedOrder` shape (broker fields stay disabled). */
function toOrder(row: SwingOrderStagingRow) {
  return {
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange,
    tradingSymbol: row.tradingSymbol,
    instrumentToken: row.instrumentToken,
    side: row.side,
    productType: row.productType,
    orderType: row.orderType,
    entryPrice: row.entryPrice,
    limitPrice: row.limitPrice,
    stopLoss: row.stopLoss,
    target1: row.target1,
    target2: row.target2,
    quantity: row.quantity,
    capitalRequired: row.capitalRequired,
    maxRisk: row.maxRisk,
    riskPercent: row.riskPercent,
    sector: row.sector,
    setupKey: row.setupKey,
    signalId: row.signalId,
    dataSource: row.dataSource,
    dataAsOf: row.dataAsOf,
    status: row.status,
    approvalStatus: row.approvalStatus,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    rejectionReason: row.rejectionReason,
    expiresAt: row.expiresAt,
    executionMode: row.executionMode,
    brokerStatus: row.brokerStatus,
    brokerOrderId: row.brokerOrderId,
    eventRiskStatus: row.eventRiskStatus,
    manualReviewRequired: row.manualReviewRequired,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    riskDecision: row.riskDecisionJson ?? null,
    recheckDecision: row.recheckDecisionJson ?? null,
    missedOpportunity: row.missedOpportunityJson ?? null,
  };
}

function executionSnapshot() {
  return getSwingExecutionStatus();
}

/**
 * Build the immutable snapshot candidate from the request. Data-trust fields
 * (dataSource / asOf / ohlc) are forced to UNAVAILABLE here — the server stamps
 * them from the live quote in `rebuildCandidateForRecheck`. A client can never
 * assert freshness. `ltp` starts as the entry price as a placeholder; the live
 * re-check overwrites it when (and only when) a fresh Kite quote arrives.
 */
function buildSnapshotCandidate(
  b: ReturnType<typeof StageSwingStagedOrderBody.parse>,
  nowMs: number,
): SwingCashCandidate {
  return {
    symbol: b.symbol,
    sector: b.sector ?? null,
    entry: b.entry,
    stop: b.stop,
    target1: b.target1,
    target2: b.target2 ?? null,
    atr: b.atr ?? null,
    ltp: b.entry,
    rr: b.rr ?? null,
    // Data-trust fields — server-owned, never taken from the client.
    dataSource: null,
    ohlc: null,
    dailyCandleAsOfMs: null,
    ltpAsOfMs: null,
    fallbackUsed: false,
    fallbackReason: null,
    sectorAvailable: b.sector != null,
    // Owner-supplied signal context (like `sector`), NOT a freshness claim. Only
    // an explicit `true` satisfies the Phase-1 benchmark gate; omitted/false →
    // undefined → REVIEW_REQUIRED (fail-closed). Never fabricated server-side.
    benchmarkAvailable: b.benchmarkAvailable === true ? true : undefined,
    // Entry freshness inputs.
    entryZoneLow: b.entryZoneLow ?? null,
    entryZoneHigh: b.entryZoneHigh ?? null,
    signalAgeDays: b.signalAgeDays ?? null,
    validityExpiryMs: b.validityExpiryMs ?? null,
    triggered: b.triggered ?? false,
    // Liquidity inputs.
    avgTradedValue: b.avgTradedValue ?? null,
    volume: b.volume ?? null,
    spreadPct: b.spreadPct ?? null,
    deliveryPct: b.deliveryPct ?? null,
    asmGsmStatus: b.asmGsmStatus ?? null,
    circuitRisk: b.circuitRisk ?? null,
    // Event inputs — conservative honest defaults (missing → review required).
    daysToResult: b.daysToResult ?? null,
    isResultDay: b.isResultDay ?? false,
    corporateActionRisk: b.corporateActionRisk ?? null,
    eventDataAvailable: b.eventDataAvailable ?? false,
    resultScheduleKnown: b.resultScheduleKnown ?? false,
    newsRiskAvailable: b.newsRiskAvailable ?? false,
    nowMs,
  };
}

function toEventOverride(o: { eventOverride?: unknown } | undefined): SwingEventOverride | null {
  const ov = o?.eventOverride as SwingEventOverride | null | undefined;
  if (!ov) return null;
  return {
    resultDateKnown: ov.resultDateKnown ?? null,
    resultDate: ov.resultDate ?? null,
    corporateActionRisk: ov.corporateActionRisk ?? null,
  };
}

// ---------------------------------------------------------------------------
// Status + kill switch
// ---------------------------------------------------------------------------

router.get("/swing/status", requireSubscriberOrOwner(), async (_req, res) => {
  const killSwitch = await getKillSwitch();
  res.json({ execution: executionSnapshot(), killSwitch, ttlSweep: getSwingTtlSweepState() });
});

router.post("/swing/kill-switch", requireOwner, async (req, res) => {
  const parsed = SetSwingKillSwitchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", code: "INVALID_BODY", issues: parsed.error.issues });
    return;
  }
  const actor = ownerKeyFor(req) ?? "owner";
  const killSwitch = await setKillSwitch(parsed.data.enabled, parsed.data.reason ?? null, actor);
  res.json({ killSwitch });
});

// ---------------------------------------------------------------------------
// List + stage
// ---------------------------------------------------------------------------

router.get("/swing/staged-orders", requireSubscriberOrOwner(), async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    if (isPublicAccessEnabled()) {
      res.json({ items: [], execution: executionSnapshot() });
      return;
    }
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = ListSwingStagedOrdersQueryParams.safeParse(req.query);
  const statusCsv = parsed.success ? parsed.data.status : undefined;
  const statuses = statusCsv
    ? statusCsv.split(",").map(s => s.trim()).filter(Boolean)
    : undefined;
  const rows = await listSwingOrders(owner, { statuses });
  res.json({ items: rows.map(toOrder), execution: executionSnapshot() });
});

router.post("/swing/staged-orders", requireOwner, async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = StageSwingStagedOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", code: "INVALID_BODY", issues: parsed.error.issues });
    return;
  }
  const b = parsed.data;
  const now = new Date();
  const snapshot = buildSnapshotCandidate(b, now.getTime());
  const eventOverride = toEventOverride(b);
  const fetchQuote = createKiteSwingQuoteFetcher();
  const quote = await fetchQuote(b.symbol).catch(() => null);
  const { candidate } = rebuildCandidateForRecheck(snapshot, quote, eventOverride, now.getTime());
  const portfolioState = await buildSwingPortfolioState(owner, now);
  const result = await stageSwingOrder({
    ownerKey: owner,
    candidate,
    portfolioState,
    exchange: b.exchange ?? null,
    tradingSymbol: b.tradingSymbol ?? null,
    instrumentToken: b.instrumentToken ?? null,
    setupKey: b.setupKey ?? null,
    signalId: b.signalId ?? null,
    eventOverride,
    now,
  });
  // BLOCKED_BY_RISK alert — fire-and-forget, never affects the response.
  if (!result.staged && result.reason === "NOT_STAGEABLE_HARD_BLOCK") {
    try {
      alertSwingOrderBlockedByRisk(candidate.symbol, b.setupKey ?? null, [result.reason]);
    } catch { /* safe-fail */ }
  }
  res.status(result.staged ? 201 : 200).json({
    staged: result.staged,
    status: result.status,
    reason: result.reason ?? null,
    order: result.row ? toOrder(result.row) : null,
    decision: result.decision,
    execution: executionSnapshot(),
  });
});

router.post("/swing/staged-orders/expire-stale", requireOwner, async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const result = await expireStaleSwingOrders(owner, {
    now: new Date(),
    fetchQuote: createKiteSwingQuoteFetcher(),
    expiryReason: "BATCH_EXPIRE",
  });
  res.json({ expired: result.expired, scanned: result.scanned, execution: executionSnapshot() });
});

// ---------------------------------------------------------------------------
// TTL sweep diagnostic endpoints (owner-only)
// ---------------------------------------------------------------------------

/** GET /swing/ttl-sweep/status — current in-memory sweep state. */
router.get("/swing/ttl-sweep/status", requireOwner, (_req, res) => {
  res.json(getSwingTtlSweepState());
});

/**
 * POST /swing/ttl-sweep/run-dry — count stale orders (all owners) without
 * expiring them. Safe read-only diagnostic. Rate limit: caller's discretion.
 */
router.post("/swing/ttl-sweep/run-dry", requireOwner, async (_req, res) => {
  const preview = await previewStaleSwingOrders(null);
  res.json({ dryRun: true, staleCount: preview.count, symbols: preview.symbols });
});

/**
 * POST /swing/ttl-sweep/run-now — immediately run a real sweep (all owners).
 * Useful when the owner wants to flush stale orders without waiting for the
 * next 10-minute tick. Rate limit: no enforced limit (trusted owner-only).
 */
router.post("/swing/ttl-sweep/run-now", requireOwner, async (_req, res) => {
  const result = await runSwingTtlSweepOnce();
  res.json({ expired: result.expired, scanned: result.scanned, durationMs: result.durationMs });
});

// ---------------------------------------------------------------------------
// Single order: get / refresh / approve / reject / watch / expire
// ---------------------------------------------------------------------------

router.get("/swing/staged-orders/:id", requireSubscriberOrOwner(), async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(isPublicAccessEnabled() ? 404 : 401).json({ error: "not_found" });
    return;
  }
  const row = await getSwingOrder(owner, paramId(req));
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ order: toOrder(row), execution: executionSnapshot() });
});

router.post("/swing/staged-orders/:id/refresh", requireOwner, async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = RefreshSwingStagedOrderBody.safeParse(req.body ?? {});
  const eventOverride = parsed.success ? toEventOverride(parsed.data) : null;
  const result = await refreshAndRecheckSwingOrder(owner, paramId(req), {
    eventOverride,
    fetchQuote: createKiteSwingQuoteFetcher(),
  });
  if (!result.ok) {
    res.status(result.reason === "NOT_FOUND" ? 404 : 200).json({
      ok: false,
      reason: result.reason,
      execution: executionSnapshot(),
    });
    return;
  }
  res.json({
    ok: true,
    order: toOrder(result.row),
    decision: result.decision,
    availability: result.availability,
    execution: executionSnapshot(),
  });
});

router.post("/swing/staged-orders/:id/approve", requireOwner, async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = ApproveSwingStagedOrderBody.safeParse(req.body ?? {});
  const eventOverride = parsed.success ? toEventOverride(parsed.data) : null;
  const result = await approveSwingOrder(owner, paramId(req), owner, {
    eventOverride,
    fetchQuote: createKiteSwingQuoteFetcher(),
  });
  if (!result.approved) {
    res.status(result.reason === "NOT_FOUND" ? 404 : 200).json({
      approved: false,
      reason: result.reason,
      decision: result.decision ?? null,
      availability: result.availability ?? null,
      execution: executionSnapshot(),
    });
    return;
  }
  res.json({
    approved: true,
    status: result.status,
    order: toOrder(result.row),
    decision: result.decision,
    availability: result.availability,
    execution: executionSnapshot(),
  });
});

router.post("/swing/staged-orders/:id/reject", requireOwner, async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = RejectSwingStagedOrderBody.safeParse(req.body ?? {});
  const reason = parsed.success ? parsed.data.reason ?? null : null;
  const result = await rejectSwingOrder(owner, paramId(req), reason);
  res.status(!result.ok && result.reason === "NOT_FOUND" ? 404 : 200).json({
    ok: result.ok,
    reason: result.ok ? null : result.reason,
    order: result.ok ? toOrder(result.row) : null,
    execution: executionSnapshot(),
  });
});

router.post("/swing/staged-orders/:id/watch", requireOwner, async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const result = await markWatchOnlySwingOrder(owner, paramId(req));
  res.status(!result.ok && result.reason === "NOT_FOUND" ? 404 : 200).json({
    ok: result.ok,
    reason: result.ok ? null : result.reason,
    order: result.ok ? toOrder(result.row) : null,
    execution: executionSnapshot(),
  });
});

router.post("/swing/staged-orders/:id/expire", requireOwner, async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const result = await manuallyExpireSwingOrder(owner, paramId(req), {
    fetchQuote: createKiteSwingQuoteFetcher(),
  });
  res.status(!result.ok && result.reason === "NOT_FOUND" ? 404 : 200).json({
    ok: result.ok,
    reason: result.ok ? null : result.reason,
    order: result.ok ? toOrder(result.row) : null,
    execution: executionSnapshot(),
  });
});

export default router;
