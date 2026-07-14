/**
 * Central Analytics Router — the ONLY sanctioned entry point for display-only
 * / secondary analytics data that does NOT power trade/signal/valuation
 * decisions.
 *
 * This module wraps `analyticsYahoo.ts` (and any future display-only adapters)
 * with:
 *   - Strict `notForSignals`, `notForTradeDecisions` policy flags on every response
 *   - `delayed: true` on all Yahoo-sourced data
 *   - Human-readable source labels for UI badges
 *   - Compile-time branding (`AnalyticsQuote`, `AnalyticsCandleSeries`) that
 *     prevents accidental use in trade-grade paths
 *
 * Owner policy (2026-06-12):
 *   - Indian trade-grade paths: NEVER use this router. Use `router.ts`.
 *   - Indian display analytics: allowed TEMPORARILY via this router, clearly labelled.
 *   - Global cues / global indices / financials: allowed via this router
 *     (Yahoo is the ONLY source — Kite has no global coverage).
 *
 * Every response from this router carries:
 *   source: "yahoo"
 *   trustTier: "secondary_analytics"
 *   delayed: true
 *   notForSignals: true
 *   notForTradeDecisions: true
 */

import { getAnalyticsDaily, getAnalyticsQuote } from "./analyticsYahoo";
import type { AnalyticsCandleSeries, AnalyticsQuote } from "./types";

// ---------------------------------------------------------------------------
// Source badge labels for UI display
// ---------------------------------------------------------------------------

export type AnalyticsSourceBadge =
  | "YAHOO DELAYED · SECONDARY ANALYTICS · NOT FOR SIGNALS"
  | "YAHOO DELAYED · VISUAL ONLY · NOT FOR SIGNALS"
  | "UNAVAILABLE — TRUSTED SOURCE NOT AVAILABLE";

export interface AnalyticsResult<T> {
  ok: boolean;
  data: T | null;
  sourceBadge: AnalyticsSourceBadge;
  /** Human-readable reason when data is unavailable. */
  reason: string | null;
  /** True for all Yahoo-sourced data. */
  delayed: true;
  notForSignals: true;
  notForTradeDecisions: true;
}

function analyticsResult<T>(data: T | null, badge?: AnalyticsSourceBadge): AnalyticsResult<T> {
  if (data == null) {
    return {
      ok: false,
      data: null,
      sourceBadge: "UNAVAILABLE — TRUSTED SOURCE NOT AVAILABLE",
      reason: "Analytics data unavailable from Yahoo.",
      delayed: true,
      notForSignals: true,
      notForTradeDecisions: true,
    };
  }
  return {
    ok: true,
    data,
    sourceBadge: badge ?? "YAHOO DELAYED · SECONDARY ANALYTICS · NOT FOR SIGNALS",
    reason: null,
    delayed: true,
    notForSignals: true,
    notForTradeDecisions: true,
  };
}

// ---------------------------------------------------------------------------
// Public API — display-only analytics
// ---------------------------------------------------------------------------

type YahooRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "3y" | "5y";

/**
 * Daily candle series for display analytics (e.g. global index benchmark,
 * macro chart, portfolio comparison). NEVER for signals/trades.
 */
export async function getDisplayCandles(
  yahooSymbol: string,
  range: YahooRange = "1y",
): Promise<AnalyticsResult<AnalyticsCandleSeries>> {
  const data = await getAnalyticsDaily(yahooSymbol, range);
  return analyticsResult(data);
}

/**
 * Single-value quote for display analytics (e.g. VIX fallback strip,
 * global asset card). NEVER for signals/trades.
 */
export async function getDisplayQuote(
  yahooSymbol: string,
  range: YahooRange = "5d",
): Promise<AnalyticsResult<AnalyticsQuote>> {
  const data = await getAnalyticsQuote(yahooSymbol, range);
  return analyticsResult(data);
}

/**
 * Candles explicitly for chart visual-only fallback (when Kite is unavailable
 * for a global instrument). Shows "VISUAL ONLY" badge.
 */
export async function getVisualOnlyCandles(
  yahooSymbol: string,
  range: YahooRange = "1y",
): Promise<AnalyticsResult<AnalyticsCandleSeries>> {
  const data = await getAnalyticsDaily(yahooSymbol, range);
  return analyticsResult(data, "YAHOO DELAYED · VISUAL ONLY · NOT FOR SIGNALS");
}
