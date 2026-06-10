/**
 * Scanner / Sector / Benchmark provenance — a single pure helper that labels a
 * scanner/sector/benchmark data point with the SAME honesty vocabulary the repo
 * already uses for index analytics (`IndexAnalyticsProvenance` in
 * `indicesBoard.ts`) and the central market-data layer (`marketData/provenance.ts`).
 *
 * Policy (owner): Kite is authoritative for Indian prices/candles; Yahoo is a
 * delayed `secondary_analytics` reference that must NEVER drive scanner signals,
 * sector signals, risk scores, portfolio valuation or trade decisions. A data
 * point with no resolvable source is `unavailable` and carries a `missingReason`.
 *
 * This module intentionally adds NO new freshness thresholds: staleness is
 * decided by the shared `isFreshFor(asOfSec, tf, nowMs)` over `TIMEFRAME_CONFIG`,
 * and trust priority comes straight from `SOURCE_PRIORITY` / `UNKNOWN_SOURCE_PRIORITY`.
 */

import { isFreshFor, type ChartTimeframe } from "./chartDatafeed";
import { SOURCE_PRIORITY, UNKNOWN_SOURCE_PRIORITY } from "./marketData/provenance";

/** Provider that actually served the data point (null = nothing resolved). */
export type DataSourceProvider = "kite" | "yahoo" | null;

/** Coarse trust tier, matching `IndexAnalyticsProvenance.trustTier`. */
export type DataTrustTier = "authoritative" | "secondary_analytics" | "unavailable";

/**
 * Honest provenance envelope for a scanner/sector/benchmark data point.
 * Field shape mirrors `IndexAnalyticsProvenance` so the frontend can render the
 * same badge everywhere and a delayed reference feed can never be mistaken for
 * an authoritative trade input.
 */
export interface SourceProvenance {
  sourceProvider: DataSourceProvider;
  /** Trust priority: 1 authoritative, 3 secondary_analytics, 99 none. */
  sourcePriority: number;
  trustTier: DataTrustTier;
  /** True when the provider is a delayed / end-of-day feed for this timeframe. */
  delayed: boolean;
  /** Hard policy: this data point must never drive automated signals. */
  notForSignals: boolean;
  /** Hard policy: this data point must never drive trade decisions. */
  notForTradeDecisions: boolean;
  /** Epoch seconds of the newest bar/quote the point was derived from. */
  asOf: number | null;
  /** Seconds between `asOf` and build time (null when `asOf` is null). */
  freshnessSec: number | null;
  /** True when older than the per-timeframe freshness budget; null when no asOf. */
  isStale: boolean | null;
  /** User-facing reason the data point is unavailable (null when present). */
  missingReason: string | null;
  /** User-facing warnings (no raw provider-failure internals). */
  warnings: string[];
}

/** End-of-day timeframes: a fresh EOD bar is still EOD, so it is `delayed`,
 *  never "live" — matches the candle-source-honesty contract. */
const EOD_TIMEFRAMES: ReadonlySet<ChartTimeframe> = new Set<ChartTimeframe>([
  "1D",
  "1W",
  "1M",
]);

export function isEodTimeframe(tf: ChartTimeframe): boolean {
  return EOD_TIMEFRAMES.has(tf);
}

export interface BuildSourceProvenanceInput {
  /** Provider that served the point; null when nothing resolved. */
  provider: DataSourceProvider;
  /** Newest bar/quote instant in epoch SECONDS, or null when unknown. */
  asOfSec: number | null;
  /** Timeframe whose freshness budget governs staleness. */
  tf: ChartTimeframe;
  /** Build-time clock in ms (injectable for tests). */
  now?: number;
  /**
   * Reason string when `provider` is null. Required for an honest `unavailable`
   * envelope; a sensible default is used if omitted.
   */
  missingReason?: string | null;
  /** Extra user-facing warnings to surface alongside the point. */
  warnings?: readonly string[];
}

/**
 * Build a {@link SourceProvenance} envelope. Pure: depends only on its inputs.
 *
 * - `kite`  → authoritative (priority 1), allowed for signals/trades;
 *             `delayed` only for EOD timeframes (a fresh daily bar is still EOD).
 * - `yahoo` → secondary_analytics (priority 3), delayed, NOT for signals/trades.
 * - `null`  → unavailable (priority 99), NOT for signals/trades, with a reason.
 */
export function buildSourceProvenance(
  input: BuildSourceProvenanceInput,
): SourceProvenance {
  const now = input.now ?? Date.now();
  const warnings = input.warnings ? [...input.warnings] : [];

  if (input.provider == null) {
    return {
      sourceProvider: null,
      sourcePriority: UNKNOWN_SOURCE_PRIORITY,
      trustTier: "unavailable",
      delayed: false,
      notForSignals: true,
      notForTradeDecisions: true,
      asOf: null,
      freshnessSec: null,
      isStale: null,
      missingReason: input.missingReason ?? "No trusted source resolved for this data point",
      warnings,
    };
  }

  const hasAsOf = input.asOfSec != null && Number.isFinite(input.asOfSec);
  const asOf = hasAsOf ? (input.asOfSec as number) : null;
  const freshnessSec = asOf != null ? Math.max(0, Math.round(now / 1000 - asOf)) : null;
  const isStale = asOf != null ? !isFreshFor(asOf, input.tf, now) : null;

  if (input.provider === "kite") {
    return {
      sourceProvider: "kite",
      sourcePriority: SOURCE_PRIORITY.authoritative,
      trustTier: "authoritative",
      delayed: isEodTimeframe(input.tf),
      notForSignals: false,
      notForTradeDecisions: false,
      asOf,
      freshnessSec,
      isStale,
      missingReason: null,
      warnings,
    };
  }

  // Yahoo: always a delayed secondary-analytics reference.
  return {
    sourceProvider: "yahoo",
    sourcePriority: SOURCE_PRIORITY.secondary_analytics,
    trustTier: "secondary_analytics",
    delayed: true,
    notForSignals: true,
    notForTradeDecisions: true,
    asOf,
    freshnessSec,
    isStale,
    missingReason: null,
    warnings,
  };
}

/**
 * True when a scanner SIGNAL derived from this point must be demoted/warned:
 * any non-Kite source, or stale data, or no source at all. Pure.
 */
export function shouldDemoteSignal(p: SourceProvenance): boolean {
  return p.notForSignals || p.trustTier !== "authoritative" || p.isStale === true;
}
