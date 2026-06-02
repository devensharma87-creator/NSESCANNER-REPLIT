/**
 * Portfolio Analyser — transparent composite "structure" score + neutral
 * action-view label + risk-flag detection.
 *
 * SEBI-neutral: this is analytics, NOT advice. The score is a transparent,
 * explainable blend of OBJECTIVE signals that were actually available
 * (price-vs-DMA structure, RSI condition, realised return quality, and
 * portfolio concentration). Fundamentals (P/E etc.) are deliberately NOT
 * scored because no sector benchmark is available — they are display-only.
 * Labels are review-oriented ("Hold with Review", "Exit Review"), never
 * "Buy"/"Sell"/target/stop.
 */
import type {
  RawHolding,
  LiveMetrics,
  HoldingMetrics,
  AnalyticsResult,
  ActionView,
  RiskFlag,
} from "./types";

export const WEIGHT_CONCENTRATION_PCT = 20;
export const SECTOR_CONCENTRATION_PCT = 35;
export const DRAWDOWN_PCT = -10;
export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

interface AnalyticsInput {
  raw: RawHolding;
  live: LiveMetrics;
  metrics: HoldingMetrics;
  /** Weight of this holding's sector across the whole portfolio (%). */
  sectorWeightPct: number | null;
}

interface Component {
  score: number;
  weight: number;
  name: string;
}

function dmaComponent(live: LiveMetrics): Component | null {
  if (live.cmp == null || (live.dma50 == null && live.dma200 == null)) return null;
  let s = 50;
  if (live.dma200 != null) s += live.cmp >= live.dma200 ? 20 : -20;
  if (live.dma50 != null) s += live.cmp >= live.dma50 ? 15 : -15;
  if (live.trendStrength != null) s = 0.7 * s + 0.3 * clamp(live.trendStrength);
  return { score: clamp(s), weight: 0.4, name: "Price vs 50/200-DMA structure" };
}

function rsiComponent(live: LiveMetrics): Component | null {
  if (live.rsi14 == null) return null;
  const r = live.rsi14;
  let s: number;
  if (r >= 40 && r <= 65) s = 80;
  else if ((r >= 30 && r < 40) || (r > 65 && r <= 70)) s = 60;
  else if (r > 70) s = 40;
  else s = 35; // < 30
  return { score: s, weight: 0.25, name: "RSI condition" };
}

function returnComponent(metrics: HoldingMetrics): Component | null {
  if (metrics.totalReturnPct == null) return null;
  const p = metrics.totalReturnPct;
  let s: number;
  if (p >= 20) s = 90;
  else if (p >= 0) s = 60 + (p / 20) * 25; // 60..85
  else if (p >= -10) s = 40 + ((p + 10) / 10) * 20; // 40..60
  else s = clamp(40 + (p + 10), 10, 40); // below -10 → tapers toward 10
  return { score: clamp(s), weight: 0.2, name: "Realised return quality" };
}

function concentrationComponent(input: AnalyticsInput): Component | null {
  const w = input.metrics.weightPct;
  const sw = input.sectorWeightPct;
  if (w == null && sw == null) return null;
  let s = 90;
  if (w != null && w > WEIGHT_CONCENTRATION_PCT) s -= (w - WEIGHT_CONCENTRATION_PCT) * 2;
  if (sw != null && sw > SECTOR_CONCENTRATION_PCT) s -= (sw - SECTOR_CONCENTRATION_PCT) * 1.5;
  return { score: clamp(s, 10, 100), weight: 0.15, name: "Concentration risk" };
}

export function detectRiskFlags(input: AnalyticsInput): RiskFlag[] {
  const { raw, live, metrics, sectorWeightPct } = input;
  const flags: RiskFlag[] = [];

  if (!live.available || live.cmp == null) {
    flags.push({
      code: "DATA_UNAVAILABLE",
      severity: "warn",
      message: "Live price data unavailable — metrics shown are partial.",
    });
  }
  if (metrics.weightPct != null && metrics.weightPct > WEIGHT_CONCENTRATION_PCT) {
    flags.push({
      code: "WEIGHT_CONCENTRATION",
      severity: "high",
      message: `Single-stock weight ${metrics.weightPct.toFixed(1)}% (> ${WEIGHT_CONCENTRATION_PCT}%).`,
    });
  }
  if (sectorWeightPct != null && sectorWeightPct > SECTOR_CONCENTRATION_PCT) {
    flags.push({
      code: "SECTOR_CONCENTRATION",
      severity: "high",
      message: `Sector weight ${sectorWeightPct.toFixed(1)}% (> ${SECTOR_CONCENTRATION_PCT}%).`,
    });
  }
  if (live.cmp != null && live.dma200 != null && live.cmp < live.dma200) {
    flags.push({ code: "BELOW_200DMA", severity: "warn", message: "Trading below 200-DMA." });
  }
  if (live.cmp != null && live.dma50 != null && live.cmp < live.dma50) {
    flags.push({ code: "BELOW_50DMA", severity: "info", message: "Trading below 50-DMA." });
  }
  if (metrics.totalReturnPct != null && metrics.totalReturnPct < DRAWDOWN_PCT) {
    flags.push({
      code: "DRAWDOWN",
      severity: "warn",
      message: `Down ${Math.abs(metrics.totalReturnPct).toFixed(1)}% from cost.`,
    });
  }
  if (live.rsi14 != null && live.rsi14 > RSI_OVERBOUGHT) {
    flags.push({ code: "RSI_OVERBOUGHT", severity: "info", message: `RSI ${live.rsi14.toFixed(0)} — overbought zone.` });
  }
  if (live.rsi14 != null && live.rsi14 < RSI_OVERSOLD) {
    flags.push({ code: "RSI_OVERSOLD", severity: "info", message: `RSI ${live.rsi14.toFixed(0)} — oversold zone.` });
  }
  void raw;
  return flags;
}

function bandLabel(score: number): ActionView {
  if (score >= 70) return "Strong Structure";
  if (score >= 55) return "Hold with Review";
  if (score >= 40) return "Mixed / Watch";
  if (score >= 25) return "Weak Structure";
  return "Reduce Review";
}

export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const { live, metrics, sectorWeightPct } = input;
  const riskFlags = detectRiskFlags(input);

  const comps = [
    dmaComponent(live),
    rsiComponent(live),
    returnComponent(metrics),
    concentrationComponent(input),
  ].filter((c): c is Component => c != null);

  const unavailable: string[] = [];
  if (live.cmp == null) unavailable.push("Live price (CMP)");
  if (live.dma50 == null && live.dma200 == null) unavailable.push("50/200-DMA");
  if (live.rsi14 == null) unavailable.push("RSI");
  // Fundamentals are intentionally display-only:
  unavailable.push("Sector valuation benchmark");

  if (comps.length === 0 || live.cmp == null) {
    return {
      score: null,
      label: null,
      reasons: ["Live data unavailable — composite structure score not computed."],
      unavailable,
      componentsUsed: [],
      riskFlags,
    };
  }

  const totalWeight = comps.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(comps.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);

  // Reason text — factual, drawn from real numbers.
  const reasons: string[] = [];
  if (live.cmp != null && live.dma200 != null) {
    reasons.push(
      live.cmp >= live.dma200
        ? `Above 200-DMA (₹${live.cmp.toFixed(2)} vs ₹${live.dma200.toFixed(2)}).`
        : `Below 200-DMA (₹${live.cmp.toFixed(2)} vs ₹${live.dma200.toFixed(2)}).`,
    );
  }
  if (live.rsi14 != null) reasons.push(`RSI ${live.rsi14.toFixed(0)}.`);
  if (metrics.totalReturnPct != null) {
    reasons.push(
      metrics.totalReturnPct >= 0
        ? `Up ${metrics.totalReturnPct.toFixed(1)}% from cost.`
        : `Down ${Math.abs(metrics.totalReturnPct).toFixed(1)}% from cost.`,
    );
  }
  if (metrics.weightPct != null && metrics.weightPct > WEIGHT_CONCENTRATION_PCT) {
    reasons.push(`High single-stock weight (${metrics.weightPct.toFixed(1)}%).`);
  }
  if (sectorWeightPct != null && sectorWeightPct > SECTOR_CONCENTRATION_PCT) {
    reasons.push(`High sector concentration (${sectorWeightPct.toFixed(1)}%).`);
  }

  // Label: band first, then review-oriented overrides (highest priority wins).
  let label = bandLabel(score);
  const belowBoth =
    live.cmp != null &&
    live.dma50 != null &&
    live.dma200 != null &&
    live.cmp < live.dma50 &&
    live.cmp < live.dma200;
  const deepDrawdown = metrics.totalReturnPct != null && metrics.totalReturnPct < DRAWDOWN_PCT;
  const concentrated =
    (metrics.weightPct != null && metrics.weightPct > WEIGHT_CONCENTRATION_PCT) ||
    (sectorWeightPct != null && sectorWeightPct > SECTOR_CONCENTRATION_PCT);

  if (belowBoth && deepDrawdown) {
    label = "Exit Review";
  } else if (concentrated && score < 55) {
    label = "Reduce Review";
  } else if (live.rsi14 != null && live.rsi14 > RSI_OVERBOUGHT && score >= 55) {
    label = "Avoid Fresh Buy";
  }

  return {
    score,
    label,
    reasons,
    unavailable,
    componentsUsed: comps.map(c => c.name),
    riskFlags,
  };
}
