/**
 * Quote/candle validation — freshness + completeness. Pure functions that turn
 * a raw provider datum into a validated `DataMeta` (and decide the
 * `validationStatus`). No network, fully unit-testable.
 */

import { computeFreshness } from "./freshness";
import { getPolicy } from "./policy";
import type {
  DataMeta,
  ProviderName,
  QuoteCore,
  TrustTier,
  ValidationStatus,
} from "./types";

export interface BuildMetaInput {
  source: ProviderName;
  trustTier: TrustTier;
  /** epoch ms of the data instant. */
  asOfMs: number | null;
  /** Yahoo/analytics → delayed + not-for-signals. */
  delayed: boolean;
  notForSignals: boolean;
  /** When set, overrides the default derivation from notForSignals. */
  notForTradeDecisions?: boolean;
  /** Seed warnings (e.g. "served from cache"). */
  warnings?: string[];
  /** When false, completeness validation marks the datum "incomplete". */
  complete?: boolean;
  nowMs?: number;
}

/**
 * Required fields for a quote to be considered COMPLETE enough to power a
 * trading decision. A positive last price + a positive previous close is the
 * minimum the rest of the app relies on (change/changePct are derivable).
 */
export function isQuoteComplete(q: Pick<QuoteCore, "lastPrice" | "previousClose">): boolean {
  return (
    typeof q.lastPrice === "number" &&
    q.lastPrice > 0 &&
    typeof q.previousClose === "number" &&
    (q.previousClose as number) > 0
  );
}

export function buildMeta(input: BuildMetaInput): DataMeta {
  const now = input.nowMs ?? Date.now();
  const fresh = computeFreshness(input.asOfMs, now);
  const warnings = [...(input.warnings ?? [])];

  let validationStatus: ValidationStatus;
  if (input.complete === false) {
    validationStatus = "incomplete";
    warnings.push("Required quote fields missing or non-positive.");
  } else if (input.notForSignals) {
    // Analytics data is never "validated" for trading; it is unvalidated by design.
    validationStatus = "unvalidated";
  } else if (fresh.isFutureTimestamp) {
    // B1.1-C1: future provider timestamp — unverified, fail closed.
    validationStatus = "stale";
    warnings.push(
      `FUTURE_TIMESTAMP: provider asOf is ${Math.abs(fresh.rawAgeSec ?? 0).toFixed(1)}s in the future ` +
      `(beyond CLOCK_SKEW_TOLERANCE_SEC). Not tradeable.`,
    );
  } else if (fresh.isHardStale) {
    validationStatus = "stale";
    warnings.push(`Data older than the hard-stale budget (${getPolicy().staleBudgetSec}s).`);
  } else if (fresh.isStale) {
    // Within strict mode the guard rejects this; otherwise it is usable-but-flagged.
    validationStatus = "validated";
    warnings.push(`Data older than the freshness budget (${getPolicy().freshnessBudgetSec}s).`);
  } else {
    validationStatus = "validated";
  }

  return {
    source: input.source,
    trustTier: input.trustTier,
    asOf: input.asOfMs != null && Number.isFinite(input.asOfMs)
      ? new Date(input.asOfMs).toISOString()
      : null,
    fetchedAt: new Date(now).toISOString(),
    freshnessSec: fresh.freshnessSec,
    isStale: fresh.isStale,
    delayed: input.delayed,
    notForSignals: input.notForSignals,
    notForTradeDecisions: input.notForTradeDecisions ?? input.notForSignals,
    validationStatus,
    warnings,
    // Propagate future-timestamp flag so callers can distinguish from "merely old" stale.
    isFutureTimestamp: fresh.isFutureTimestamp || undefined,
  };
}

/** Build the "no data" envelope — always carries a reason, never silent. */
export function unavailableMeta(
  source: ProviderName,
  trustTier: TrustTier,
  reason: string,
  nowMs: number = Date.now(),
): DataMeta {
  return {
    source,
    trustTier,
    asOf: null,
    fetchedAt: new Date(nowMs).toISOString(),
    freshnessSec: null,
    isStale: true,
    delayed: trustTier === "secondary_analytics",
    notForSignals: trustTier !== "authoritative",
    notForTradeDecisions: trustTier !== "authoritative",
    validationStatus: "unavailable",
    warnings: [reason],
  };
}
