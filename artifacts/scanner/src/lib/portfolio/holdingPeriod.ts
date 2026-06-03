/**
 * Portfolio Analyser — cost-basis holding-period classification + dividend
 * tracking (pure, tested).
 *
 * FACTUAL ONLY: classifies each holding's elapsed holding period as short- or
 * long-term against a configurable day threshold (default 365, the Indian
 * listed-equity LTCG boundary). This is NOT tax advice and computes no
 * tax-payable figure — only the holding-period bucket and invested split.
 * Dividend metrics are computed solely from user-entered amounts.
 */
import type { RawHolding, LiveMetrics, HoldingMetrics } from "./types";
import { investedValue } from "./calc";

export interface CostBasisRow {
  raw: RawHolding;
  live: LiveMetrics;
  metrics: HoldingMetrics;
}

export type HoldingClassification = "Short-term" | "Long-term" | "Unknown";

/** Default long-term threshold for Indian listed equity (days). Configurable. */
export const LONG_TERM_THRESHOLD_DAYS = 365;

export interface HoldingPeriodBucket {
  symbol: string;
  daysHeld: number | null;
  classification: HoldingClassification;
  invested: number;
}

export interface HoldingPeriodView {
  thresholdDays: number;
  shortTermInvested: number;
  longTermInvested: number;
  unknownInvested: number;
  shortTermCount: number;
  longTermCount: number;
  unknownCount: number;
  buckets: HoldingPeriodBucket[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function computeHoldingPeriods(
  rows: CostBasisRow[],
  thresholdDays: number = LONG_TERM_THRESHOLD_DAYS,
  now: Date = new Date(),
): HoldingPeriodView {
  let shortTermInvested = 0;
  let longTermInvested = 0;
  let unknownInvested = 0;
  let shortTermCount = 0;
  let longTermCount = 0;
  let unknownCount = 0;
  const buckets: HoldingPeriodBucket[] = [];

  for (const r of rows) {
    const invested = investedValue(r.raw.qty, r.raw.rate);
    const d = r.raw.purchaseDate ? new Date(r.raw.purchaseDate) : null;
    let daysHeld: number | null = null;
    let classification: HoldingClassification = "Unknown";
    if (d && !Number.isNaN(d.getTime())) {
      daysHeld = Math.max(0, daysBetween(d, now));
      classification = daysHeld >= thresholdDays ? "Long-term" : "Short-term";
    }

    if (classification === "Long-term") {
      longTermInvested += invested;
      longTermCount += 1;
    } else if (classification === "Short-term") {
      shortTermInvested += invested;
      shortTermCount += 1;
    } else {
      unknownInvested += invested;
      unknownCount += 1;
    }
    buckets.push({ symbol: r.raw.symbol, daysHeld, classification, invested });
  }

  return {
    thresholdDays,
    shortTermInvested,
    longTermInvested,
    unknownInvested,
    shortTermCount,
    longTermCount,
    unknownCount,
    buckets,
  };
}

export interface DividendView {
  /** True when at least one holding carries a user-entered dividend amount. */
  hasData: boolean;
  totalDividends: number;
  /** Sum of user-entered realised P&L across holdings (0 when none entered). */
  totalRealisedPnl: number;
  totalInvested: number;
  /** Dividends / invested (%), null when invested is zero. */
  yieldOnCostPct: number | null;
  /** Capital return (current − invested) summed where available, null if none. */
  capitalReturn: number | null;
  /**
   * Total return including income: current value + dividends + realised P&L −
   * invested. Null when no live capital return could be computed.
   */
  totalReturnInclDiv: number | null;
  totalReturnInclDivPct: number | null;
}

export function computeDividends(rows: CostBasisRow[]): DividendView {
  let totalDividends = 0;
  let totalRealisedPnl = 0;
  let totalInvested = 0;
  let capitalReturn = 0;
  let anyDividend = false;
  let anyCapital = false;

  for (const r of rows) {
    const invested = investedValue(r.raw.qty, r.raw.rate);
    totalInvested += invested;
    const div = r.raw.dividendReceived;
    if (div != null && Number.isFinite(div) && div !== 0) {
      totalDividends += div;
      anyDividend = true;
    } else if (div != null && Number.isFinite(div)) {
      // Zero is still "entered data".
      anyDividend = anyDividend || false;
    }
    const realised = r.raw.realisedPnl;
    if (realised != null && Number.isFinite(realised)) {
      totalRealisedPnl += realised;
    }
    const ret = r.metrics.totalReturn;
    if (ret != null) {
      capitalReturn += ret;
      anyCapital = true;
    }
  }

  // Total Return Including Dividends = Current Value + Dividend Received +
  // Realised P&L − Invested Value. capitalReturn already equals
  // Σ(currentValue − invested), so we add dividends and realised P&L on top.
  const income = totalDividends + totalRealisedPnl;
  const yieldOnCostPct = totalInvested > 0 ? (totalDividends / totalInvested) * 100 : null;
  const totalReturnInclDiv = anyCapital ? capitalReturn + income : null;
  const totalReturnInclDivPct =
    anyCapital && totalInvested > 0 ? ((capitalReturn + income) / totalInvested) * 100 : null;

  return {
    hasData: anyDividend,
    totalDividends,
    totalRealisedPnl,
    totalInvested,
    yieldOnCostPct,
    capitalReturn: anyCapital ? capitalReturn : null,
    totalReturnInclDiv,
    totalReturnInclDivPct,
  };
}
