/**
 * Trust-tier guard — the runtime enforcement that pairs with the compile-time
 * brands in types.ts.
 *
 * `assertTradeable` is the ONLY way to obtain a `TradeableBrand`. It throws a
 * `TrustTierViolation` when handed data that is not authoritative-tier, stale
 * (under strict freshness), incomplete, or explicitly not-for-signals. Signal /
 * price / valuation / F&O / simulation entry points should call this (or accept
 * already-branded `TrustedQuote`/`TrustedCandleSeries`) so Yahoo/analytics data
 * can never silently power a trading decision.
 */

import { getPolicy, isTierTradeable } from "./policy";
import type {
  DataMeta,
  MarketQuote,
  CandleSeries,
  TrustedQuote,
  TrustedCandleSeries,
} from "./types";

export class TrustTierViolation extends Error {
  constructor(
    message: string,
    readonly meta: Pick<DataMeta, "source" | "trustTier" | "validationStatus">,
  ) {
    super(message);
    this.name = "TrustTierViolation";
  }
}

/** Pure predicate — true when `meta` is allowed to power a trading decision. */
export function isTradeableMeta(meta: DataMeta): boolean {
  if (meta.notForSignals) return false;
  if (!isTierTradeable(meta.trustTier)) return false;
  if (meta.validationStatus === "unavailable") return false;
  if (meta.validationStatus === "incomplete") return false;
  if (meta.validationStatus === "mismatch") return false;
  // Hard-stale (older than the stale budget) is NEVER tradeable, regardless of
  // strictFreshness — "no-compromise" means stale authoritative data still
  // cannot silently power a trading/signal decision.
  if (meta.validationStatus === "stale") return false;
  const policy = getPolicy();
  if (policy.strictFreshness && meta.isStale) return false;
  return true;
}

function reasonFor(meta: DataMeta): string {
  if (meta.notForSignals) {
    return `${meta.source} is tagged not-for-signals (trust tier ${meta.trustTier}).`;
  }
  if (!isTierTradeable(meta.trustTier)) {
    return `${meta.source} is trust tier "${meta.trustTier}", which is not authoritative.`;
  }
  if (meta.validationStatus === "unavailable") return "Data is unavailable.";
  if (meta.validationStatus === "incomplete") return "Data is incomplete.";
  if (meta.validationStatus === "mismatch") return "Cross-provider mismatch.";
  if (meta.validationStatus === "stale") return "Data is hard-stale (older than the stale budget).";
  if (meta.isStale) return "Data is stale and strict-freshness is enabled.";
  return "Data is not tradeable.";
}

/** Assert + brand a quote as tradeable, or throw `TrustTierViolation`. */
export function assertTradeable(quote: MarketQuote): TrustedQuote {
  if (!isTradeableMeta(quote.meta)) {
    throw new TrustTierViolation(
      `Refusing to use ${quote.symbol} for a trading/signal decision: ${reasonFor(quote.meta)}`,
      quote.meta,
    );
  }
  return quote as TrustedQuote;
}

/** Assert + brand a candle series as tradeable, or throw. */
export function assertTradeableCandles(series: CandleSeries): TrustedCandleSeries {
  if (!isTradeableMeta(series.meta)) {
    throw new TrustTierViolation(
      `Refusing to use ${series.symbol} candles for a trading/signal decision: ${reasonFor(series.meta)}`,
      series.meta,
    );
  }
  return series as TrustedCandleSeries;
}

/** Non-throwing variant — returns the branded value or null. */
export function tryTradeable(quote: MarketQuote): TrustedQuote | null {
  return isTradeableMeta(quote.meta) ? (quote as TrustedQuote) : null;
}
