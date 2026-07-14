/**
 * Pure summary computation for `GET /paper/lifecycle/:symbol` (Checkpoint 2).
 * Extracted from the route handler so the anomaly-detection rules — "a trade
 * row with no source" and "a staged order that expired while still pending
 * a human decision" — can be unit-tested without a live DB.
 */

export interface LifecycleTradeRow {
  source: string | null;
}

export interface LifecycleStagingRow {
  status: string;
  approvalStatus: string;
}

export interface LifecycleSummaryInput {
  trades: LifecycleTradeRow[];
  auditRowCount: number;
  stagingOrders: LifecycleStagingRow[];
  notificationCount: number;
}

export interface LifecycleSummary {
  tradeCount: number;
  /**
   * Should always be 0 post-backfill. A non-zero count means a trade row
   * bypassed `applyPaperEqProvenanceColumns()` — surfaced rather than
   * silently treated as fine. Never fabricated as AUTO/MANUAL.
   */
  tradesMissingSource: number;
  stagingOrderCount: number;
  /**
   * A staged order that expired while still PENDING approval never got a
   * human decision either way — distinct from EXPIRED+REJECTED (a real
   * decision was made) or a clean APPROVED path.
   */
  expiredWhilePendingCount: number;
  notificationCount: number;
}

export function computeLifecycleSummary(input: LifecycleSummaryInput): LifecycleSummary {
  const unsourced = input.trades.filter((t) => !t.source);
  const actionableExpiredStaging = input.stagingOrders.filter(
    (s) => s.status === "EXPIRED" && s.approvalStatus === "PENDING",
  );
  return {
    tradeCount: input.trades.length,
    tradesMissingSource: unsourced.length,
    stagingOrderCount: input.stagingOrders.length,
    expiredWhilePendingCount: actionableExpiredStaging.length,
    notificationCount: input.notificationCount,
  };
}
