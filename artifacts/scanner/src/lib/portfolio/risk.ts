/**
 * Portfolio Analyser — portfolio-level risk analytics (pure, tested).
 *
 * Every figure is derived only from real, available data. Where a datum is
 * missing (e.g. beta for some holdings) the function reports honest coverage
 * rather than imputing a value. SEBI-neutral: this is risk *measurement*, not
 * advice; no targets, stops, or buy/sell calls.
 */
import type { RawHolding, LiveMetrics, HoldingMetrics, RiskFlag } from "./types";

export interface RiskRow {
  raw: RawHolding;
  live: LiveMetrics;
  metrics: HoldingMetrics;
}

export interface Contributor {
  symbol: string;
  pnl: number;
}

export interface RiskAnalytics {
  /** Largest single-stock weight (% of current value), null when no live value. */
  topHoldingWeightPct: number | null;
  topHoldingSymbol: string | null;
  /** Combined weight (%) of the top-3 holdings by current value, null when no live value. */
  top3WeightPct: number | null;
  /** Largest single-sector weight (% of the current value that HAS a sector), null when no sector. */
  topSectorWeightPct: number | null;
  topSectorName: string | null;
  /** Share of current value (%) for which a sector was available. */
  sectorCoveragePct: number;
  /** Herfindahl-Hirschman Index on current-value weights, 0–10000. */
  hhi: number | null;
  hhiLabel: "Diversified" | "Moderately concentrated" | "Highly concentrated" | "Unavailable";
  /** Current-value-weighted beta over holdings that HAVE a beta. */
  weightedBeta: number | null;
  /** Share of current value (%) for which a beta was available. */
  betaCoveragePct: number;
  topContributor: Contributor | null;
  worstDrag: Contributor | null;
  winners: number;
  losers: number;
  /** Sum of positive unrealised returns (₹). */
  unrealisedGain: number | null;
  /** Sum of negative unrealised returns (₹, negative). */
  unrealisedLoss: number | null;
  /** % of holdings with a live CMP resolved. */
  dataAvailabilityPct: number;
  flags: RiskFlag[];
}

export const RISK_THRESHOLDS = {
  /** Single-stock weight above this is flagged. */
  SINGLE_STOCK_PCT: 20,
  /** Combined top-3 weight above this is flagged. */
  TOP3_PCT: 60,
  /** Single-sector weight above this is flagged. */
  SECTOR_PCT: 35,
  /** HHI above this is "highly concentrated". */
  HHI_HIGH: 2500,
  /** HHI above this is "moderately concentrated". */
  HHI_MODERATE: 1500,
  /** Below this data-availability we warn the analytics are partial. */
  DATA_AVAILABILITY_PCT: 70,
} as const;

function hhiLabel(hhi: number | null): RiskAnalytics["hhiLabel"] {
  if (hhi == null) return "Unavailable";
  if (hhi >= RISK_THRESHOLDS.HHI_HIGH) return "Highly concentrated";
  if (hhi >= RISK_THRESHOLDS.HHI_MODERATE) return "Moderately concentrated";
  return "Diversified";
}

export function computeRiskAnalytics(rows: RiskRow[]): RiskAnalytics {
  const flags: RiskFlag[] = [];
  if (rows.length === 0) {
    return {
      topHoldingWeightPct: null,
      topHoldingSymbol: null,
      top3WeightPct: null,
      topSectorWeightPct: null,
      topSectorName: null,
      sectorCoveragePct: 0,
      hhi: null,
      hhiLabel: "Unavailable",
      weightedBeta: null,
      betaCoveragePct: 0,
      topContributor: null,
      worstDrag: null,
      winners: 0,
      losers: 0,
      unrealisedGain: null,
      unrealisedLoss: null,
      dataAvailabilityPct: 0,
      flags,
    };
  }

  let totalCurrent = 0;
  let anyCurrent = false;
  for (const r of rows) {
    if (r.metrics.currentValue != null) {
      totalCurrent += r.metrics.currentValue;
      anyCurrent = true;
    }
  }

  // Concentration + HHI on current-value weights.
  let topWeight: number | null = null;
  let topSymbol: string | null = null;
  let top3WeightPct: number | null = null;
  let topSectorWeightPct: number | null = null;
  let topSectorName: string | null = null;
  let sectorCoveragePct = 0;
  let hhi: number | null = null;
  if (anyCurrent && totalCurrent > 0) {
    let sumSq = 0;
    const stockWeightsPct: number[] = [];
    const sectorValue = new Map<string, number>();
    let sectorCovered = 0;
    for (const r of rows) {
      if (r.metrics.currentValue == null) continue;
      const w = r.metrics.currentValue / totalCurrent;
      sumSq += w * w;
      const wPct = w * 100;
      stockWeightsPct.push(wPct);
      if (topWeight == null || wPct > topWeight) {
        topWeight = wPct;
        topSymbol = r.raw.symbol;
      }
      // Sector aggregation over the value that HAS a sector label.
      const sector = r.live.sector ?? r.raw.sector ?? null;
      if (sector && sector.trim() !== "") {
        sectorValue.set(sector, (sectorValue.get(sector) ?? 0) + r.metrics.currentValue);
        sectorCovered += r.metrics.currentValue;
      }
    }
    hhi = Math.round(sumSq * 10000);

    // Top-3 combined weight.
    const sortedDesc = [...stockWeightsPct].sort((a, b) => b - a);
    top3WeightPct = sortedDesc.slice(0, 3).reduce((s, w) => s + w, 0);

    // Largest sector as a share of the SECTOR-COVERED value (honest about coverage).
    if (sectorCovered > 0) {
      sectorCoveragePct = (sectorCovered / totalCurrent) * 100;
      for (const [name, val] of sectorValue) {
        const sPct = (val / sectorCovered) * 100;
        if (topSectorWeightPct == null || sPct > topSectorWeightPct) {
          topSectorWeightPct = sPct;
          topSectorName = name;
        }
      }
    }
  }

  // Weighted beta over the current value that HAS a beta.
  let betaValueCovered = 0;
  let betaWeightedSum = 0;
  for (const r of rows) {
    if (r.metrics.currentValue == null || r.live.beta == null) continue;
    betaValueCovered += r.metrics.currentValue;
    betaWeightedSum += r.metrics.currentValue * r.live.beta;
  }
  const weightedBeta = betaValueCovered > 0 ? betaWeightedSum / betaValueCovered : null;
  const betaCoveragePct = anyCurrent && totalCurrent > 0 ? (betaValueCovered / totalCurrent) * 100 : 0;

  // Contributors / winners / losers / unrealised split.
  let topContributor: Contributor | null = null;
  let worstDrag: Contributor | null = null;
  let winners = 0;
  let losers = 0;
  let gain = 0;
  let loss = 0;
  let anyReturn = false;
  let enriched = 0;
  for (const r of rows) {
    if (r.live.cmp != null) enriched += 1;
    const ret = r.metrics.totalReturn;
    if (ret == null) continue;
    anyReturn = true;
    if (ret > 0) {
      winners += 1;
      gain += ret;
    } else if (ret < 0) {
      losers += 1;
      loss += ret;
    }
    if (topContributor == null || ret > topContributor.pnl) {
      topContributor = { symbol: r.raw.symbol, pnl: ret };
    }
    if (worstDrag == null || ret < worstDrag.pnl) {
      worstDrag = { symbol: r.raw.symbol, pnl: ret };
    }
  }

  const dataAvailabilityPct = (enriched / rows.length) * 100;

  // Flags — factual thresholds.
  if (topWeight != null && topWeight > RISK_THRESHOLDS.SINGLE_STOCK_PCT && topSymbol) {
    flags.push({
      code: "SINGLE_STOCK_CONCENTRATION",
      severity: "high",
      message: `${topSymbol} is ${topWeight.toFixed(1)}% of the portfolio (> ${RISK_THRESHOLDS.SINGLE_STOCK_PCT}%).`,
    });
  }
  if (top3WeightPct != null && top3WeightPct > RISK_THRESHOLDS.TOP3_PCT && rows.length > 3) {
    flags.push({
      code: "TOP3_CONCENTRATION",
      severity: "high",
      message: `Top-3 holdings are ${top3WeightPct.toFixed(1)}% of the portfolio (> ${RISK_THRESHOLDS.TOP3_PCT}%).`,
    });
  }
  if (
    topSectorWeightPct != null &&
    topSectorWeightPct > RISK_THRESHOLDS.SECTOR_PCT &&
    topSectorName
  ) {
    flags.push({
      code: "SECTOR_CONCENTRATION",
      severity: "high",
      message: `${topSectorName} is ${topSectorWeightPct.toFixed(1)}% of sector-classified value (> ${RISK_THRESHOLDS.SECTOR_PCT}%).`,
    });
  }
  if (hhi != null && hhi >= RISK_THRESHOLDS.HHI_HIGH) {
    flags.push({
      code: "HHI_HIGH",
      severity: "high",
      message: `Concentration index ${hhi} indicates a highly concentrated book.`,
    });
  }
  if (dataAvailabilityPct < RISK_THRESHOLDS.DATA_AVAILABILITY_PCT) {
    flags.push({
      code: "LOW_DATA_AVAILABILITY",
      severity: "warn",
      message: `Live data resolved for only ${dataAvailabilityPct.toFixed(0)}% of holdings — analytics are partial.`,
    });
  }

  return {
    topHoldingWeightPct: topWeight,
    topHoldingSymbol: topSymbol,
    top3WeightPct,
    topSectorWeightPct,
    topSectorName,
    sectorCoveragePct,
    hhi,
    hhiLabel: hhiLabel(hhi),
    weightedBeta,
    betaCoveragePct,
    topContributor,
    worstDrag,
    winners,
    losers,
    unrealisedGain: anyReturn ? gain : null,
    unrealisedLoss: anyReturn ? loss : null,
    dataAvailabilityPct,
    flags,
  };
}
