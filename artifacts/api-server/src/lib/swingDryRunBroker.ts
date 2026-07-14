/**
 * Swing CASH Live-Readiness — Phase 2 DRY-RUN broker adapter.
 *
 * This module is a SIMULATOR. It NEVER imports a broker SDK and NEVER places a
 * real order. It exists so the `live_dry_run` execution mode has a clearly
 * labelled, synthetic placement path that records what *would* have been sent —
 * with zero chance of touching a real account.
 *
 * Every result is tagged `placed: false` and the order id is prefixed `DRYRUN-`.
 */

export interface SwingDryRunOrderRequest {
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  limitPrice?: number | null;
  orderType?: string | null;
  productType?: string | null;
  exchange?: string | null;
}

export interface SwingDryRunResult {
  /** Always false — this adapter can never place a real order. */
  placed: false;
  brokerStatus: "DRY_RUN_PLACED";
  /** Synthetic id, always prefixed `DRYRUN-`. */
  brokerOrderId: string;
  simulatedAt: string;
  note: string;
  request: SwingDryRunOrderRequest;
}

function synthId(now: Date): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `DRYRUN-${now.getTime()}-${rand}`;
}

/**
 * Simulate placing a swing-cash order. Returns a synthetic record only — no
 * network call, no broker, no real order.
 */
export function placeOrderDryRun(
  req: SwingDryRunOrderRequest,
  now: Date = new Date(),
): SwingDryRunResult {
  return {
    placed: false,
    brokerStatus: "DRY_RUN_PLACED",
    brokerOrderId: synthId(now),
    simulatedAt: now.toISOString(),
    note: "DRY RUN — no real broker order was placed. Broker execution is disabled.",
    request: req,
  };
}

export interface SwingDryRunStatus {
  brokerOrderId: string;
  placed: false;
  status: "DRY_RUN_SIMULATED";
  note: string;
}

/** Simulate an order-status query. Always reports the synthetic dry-run state. */
export function getDryRunOrderStatus(brokerOrderId: string): SwingDryRunStatus {
  return {
    brokerOrderId,
    placed: false,
    status: "DRY_RUN_SIMULATED",
    note: "DRY RUN — synthetic order, no real broker state exists.",
  };
}

export interface SwingDryRunCancel {
  brokerOrderId: string;
  placed: false;
  status: "DRY_RUN_CANCELLED";
  cancelledAt: string;
  note: string;
}

/** Simulate a cancel. No-op against any real system. */
export function cancelDryRunOrder(
  brokerOrderId: string,
  now: Date = new Date(),
): SwingDryRunCancel {
  return {
    brokerOrderId,
    placed: false,
    status: "DRY_RUN_CANCELLED",
    cancelledAt: now.toISOString(),
    note: "DRY RUN — nothing to cancel at a broker; synthetic order discarded.",
  };
}

export interface SwingDryRunReconcile {
  placed: false;
  reconciled: 0;
  note: string;
  reconciledAt: string;
}

/**
 * Simulate reconciliation. There is never any real broker state to reconcile,
 * so this is always a no-op that honestly reports zero.
 */
export function reconcileDryRunOrders(now: Date = new Date()): SwingDryRunReconcile {
  return {
    placed: false,
    reconciled: 0,
    note: "DRY RUN — no real broker orders exist to reconcile.",
    reconciledAt: now.toISOString(),
  };
}
