/**
 * Portfolio Analyser — decisive personal-use ADVISOR layer.
 *
 * Sits ON TOP of the neutral structure score (score.ts) and turns the available,
 * genuinely-fetched signals into ONE decisive verdict per holding
 * (ACCUMULATE / HOLD / TRIM / EXIT / AVOID / WATCHLIST, plus DATA_INCOMPLETE when
 * there is no live price).
 *
 * Design rules (mirrors the product spec):
 *   - Decisive, not vague: the residual is HOLD, but EXIT/TRIM/AVOID/ACCUMULATE
 *     are reached whenever the evidence supports them.
 *   - Every verdict is explainable: each contributing factor is recorded as a
 *     ReasonCode (audit trail).
 *   - Confidence is reduced automatically when data is sparse or internally
 *     conflicting; a STRONG verdict is never emitted at High confidence on
 *     partial data.
 *   - Targets and stops are ONLY ever real levels — support/resistance zones,
 *     50/200-DMA, 52-week high, or a defined 2:1 risk-reward off a real stop.
 *     Nothing is fabricated; when no level exists the field is null.
 *   - When the current price is unavailable the verdict is DATA_INCOMPLETE, never
 *     fake guidance.
 *
 * This is personal educational analysis, NOT public investment advice.
 */
import type {
  RawHolding,
  LiveMetrics,
  HoldingMetrics,
  DataSource,
  AdviceResult,
  Verdict,
  Confidence,
  AdviceRiskLevel,
  ReasonCode,
  ReasonImpact,
  PriceZone,
  DataQuality,
} from "./types";
import {
  WEIGHT_CONCENTRATION_PCT,
  SECTOR_CONCENTRATION_PCT,
  RSI_OVERBOUGHT,
} from "./score";

export const ADVICE_THRESHOLDS = {
  RSI_HEALTHY_LOW: 40,
  RSI_HEALTHY_HIGH: 65,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD: 30,
  /** P/E bands (absolute basis — NOT sector-relative; caveat surfaced in the view). */
  PE_CHEAP: 15,
  PE_FAIR: 30,
  PE_RICH: 45,
  ROE_STRONG: 15,
  ROE_WEAK: 8,
  ROCE_STRONG: 15,
  ROCE_WEAK: 8,
  DE_HEALTHY: 0.5,
  DE_HIGH: 2,
  BIG_RUNUP_PCT: 40,
  DEEP_DRAWDOWN_PCT: -15,
  /** RSI>70 AND price ≥ this multiple of the 50-DMA ⇒ stretched/overextended. */
  STRETCH_OVER_50DMA: 1.12,
  WEIGHT_CONCENTRATION_PCT,
  SECTOR_CONCENTRATION_PCT,
  /** Risk-reward used to derive a target off a real stop. */
  RR_MULTIPLE: 2,
} as const;

export interface AdviceInput {
  raw: RawHolding;
  live: LiveMetrics;
  metrics: HoldingMetrics;
  /** Weight of this holding's sector across the whole portfolio (%). */
  sectorWeightPct: number | null;
  /** False for ETFs/funds — fundamentals are not applicable, not "missing". */
  fundamentalsApplicable?: boolean;
  /** Where the live CMP came from (used for the data-quality note). */
  dataSource?: DataSource;
}

const money = (n: number): string => `₹${n.toFixed(2)}`;
const pctStr = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

function assessDataQuality(
  live: LiveMetrics,
  applicable: boolean,
): DataQuality {
  const hasPrice = live.cmp != null;
  const hasStructure = live.dma50 != null || live.dma200 != null;
  const hasMomentum = live.rsi14 != null;
  const hasFundamentals =
    live.peRatio != null || live.roe != null || live.roce != null || live.debtToEquity != null;

  const missing: string[] = [];
  if (!hasStructure) missing.push("50/200-DMA structure");
  if (!hasMomentum) missing.push("RSI / momentum");
  if (applicable && !hasFundamentals) missing.push("fundamentals (P/E, RoE, debt)");

  let level: DataQuality["level"];
  if (!hasPrice) {
    level = "none";
  } else {
    const fundOk = !applicable || hasFundamentals;
    if (hasStructure && hasMomentum && fundOk) level = "full";
    else if (hasStructure || hasMomentum) level = "partial";
    else level = "price-only";
  }

  // A lone CMP with no derivable history is the weakest, least-trustworthy state
  // — flagged so a strong verdict is never issued on it.
  const stale = hasPrice && !hasStructure && !hasMomentum;
  return { level, missing, stale };
}

// ---------------------------------------------------------------------------
// Trend strength label
// ---------------------------------------------------------------------------

function trendLabel(
  score: number | null,
  strongStructure: boolean,
  brokenStructure: boolean,
  hasStructure: boolean,
): string {
  if (score != null) {
    if (score >= 70) return "Strong uptrend";
    if (score >= 55) return "Uptrend";
    if (score >= 45) return "Sideways";
    if (score >= 30) return "Downtrend";
    return "Strong downtrend";
  }
  if (!hasStructure) return "Unavailable";
  if (strongStructure) return "Uptrend (price above key averages)";
  if (brokenStructure) return "Downtrend (price below key averages)";
  return "Mixed / sideways";
}

// ---------------------------------------------------------------------------
// Levels — only ever real numbers
// ---------------------------------------------------------------------------

/** Nearest meaningful support strictly below CMP (support zone / 50-DMA / 200-DMA). */
function nearestSupportBelow(live: LiveMetrics): number | null {
  if (live.cmp == null) return null;
  const cands = [live.supportZone, live.dma50, live.dma200].filter(
    (v): v is number => v != null && v < live.cmp!,
  );
  return cands.length ? Math.max(...cands) : null;
}

/** Nearest objective resistance strictly above CMP (resistance zone / 52-week high). */
function nearestResistanceAbove(live: LiveMetrics): number | null {
  if (live.cmp == null) return null;
  const cands = [live.resistanceZone, live.fiftyTwoWeekHigh].filter(
    (v): v is number => v != null && v > live.cmp!,
  );
  return cands.length ? Math.min(...cands) : null;
}

function deriveTargetZone(live: LiveMetrics, stop: number | null): {
  zone: PriceZone | null;
  upsidePct: number | null;
} {
  if (live.cmp == null) return { zone: null, upsidePct: null };
  const cmp = live.cmp;
  const resistance = nearestResistanceAbove(live);
  const rr =
    stop != null && cmp - stop > 0
      ? cmp + ADVICE_THRESHOLDS.RR_MULTIPLE * (cmp - stop)
      : null;

  const aboveCmp = [resistance, rr].filter((v): v is number => v != null && v > cmp);
  if (aboveCmp.length === 0) return { zone: null, upsidePct: null };

  const low = Math.min(...aboveCmp);
  const high = Math.max(...aboveCmp);
  return { zone: { low, high }, upsidePct: ((high - cmp) / cmp) * 100 };
}

function deriveAccumulationZone(live: LiveMetrics, support: number | null): PriceZone | null {
  if (live.cmp == null || support == null || support >= live.cmp) return null;
  // Lower half of the band between the nearest support and CMP — buy into dips.
  const mid = support + (live.cmp - support) * 0.5;
  return { low: support, high: mid };
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

const STRONG: ReadonlySet<Verdict> = new Set<Verdict>(["EXIT", "ACCUMULATE"]);

function deriveConfidence(
  quality: DataQuality,
  conflict: boolean,
  verdict: Verdict,
): Confidence {
  if (verdict === "DATA_INCOMPLETE" || verdict === "WATCHLIST") return "Low";

  let base: Confidence =
    quality.level === "full" ? "High" : quality.level === "partial" ? "Medium" : "Low";

  if (conflict) base = downgrade(base);
  // Never assert a strong verdict at High confidence without full, consistent data.
  if (STRONG.has(verdict) && quality.level !== "full") base = downgrade(base);
  if (quality.stale && base !== "Low") base = "Low";
  return base;
}

function downgrade(c: Confidence): Confidence {
  return c === "High" ? "Medium" : c === "Medium" ? "Low" : "Low";
}

// ---------------------------------------------------------------------------
// Risk level
// ---------------------------------------------------------------------------

function deriveRisk(
  live: LiveMetrics,
  deepDrawdown: boolean,
  overweight: boolean,
  belowBoth: boolean,
): AdviceRiskLevel {
  let pts = 1; // moderate baseline
  if (live.beta != null && live.beta > 1.3) pts += 1;
  if (live.beta != null && live.beta < 0.9) pts -= 1;
  if (deepDrawdown) pts += 1;
  if (overweight) pts += 1;
  if (live.debtToEquity != null && live.debtToEquity > ADVICE_THRESHOLDS.DE_HIGH) pts += 1;
  if (belowBoth) pts += 1;
  if (live.rsi14 != null && (live.rsi14 > 75 || live.rsi14 < 25)) pts += 1;

  if (pts <= 0) return "Low";
  if (pts === 1) return "Moderate";
  if (pts <= 3) return "Elevated";
  return "High";
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function computeAdvice(input: AdviceInput): AdviceResult {
  const { live, metrics, sectorWeightPct } = input;
  const applicable = input.fundamentalsApplicable ?? true;
  const t = ADVICE_THRESHOLDS;
  const quality = assessDataQuality(live, applicable);

  const reasons: ReasonCode[] = [];
  const push = (code: string, label: string, impact: ReasonImpact) =>
    reasons.push({ code, label, impact });

  // ---- DATA_INCOMPLETE: no live price → no guidance, ever. ----------------
  if (live.cmp == null) {
    push("NO_LIVE_PRICE", "Live price (CMP) unavailable — cannot assess.", "negative");
    return {
      verdict: "DATA_INCOMPLETE",
      confidence: "Low",
      headline: "Live price unavailable — DATA INCOMPLETE. Verdict withheld until a quote resolves.",
      reasonCodes: reasons,
      technicalView: "No live price; technical structure cannot be evaluated.",
      fundamentalView: applicable
        ? "Fundamentals not assessed without a live quote."
        : "Not applicable (ETF / basket instrument).",
      valuationView: "Not assessed — no live price.",
      trendStrength: { score: live.trendStrength, label: "Unavailable" },
      supportZone: live.supportZone,
      resistanceZone: live.resistanceZone,
      accumulationZone: null,
      riskLevel: "Elevated",
      stopLoss: null,
      targetZone: null,
      upsidePct: null,
      improveIf: ["A live CMP resolves (re-run Recalculate / check the symbol mapping)."],
      negativeIf: [],
      dataQuality: quality,
    };
  }

  const cmp = live.cmp;
  const ret = metrics.totalReturnPct;

  // ---- Structural / signal booleans --------------------------------------
  const hasStructure = live.dma50 != null || live.dma200 != null;
  const above200 = live.dma200 != null && cmp >= live.dma200;
  const below200 = live.dma200 != null && cmp < live.dma200;
  const above50 = live.dma50 != null && cmp >= live.dma50;
  const below50 = live.dma50 != null && cmp < live.dma50;
  const strongStructure = above200 && (live.dma50 == null || above50);
  const belowBoth =
    live.dma200 != null && live.dma50 != null && cmp < live.dma200 && cmp < live.dma50;
  const brokenStructure = below200 && (live.dma50 == null || below50);

  const rsi = live.rsi14;
  const overbought = rsi != null && rsi > t.RSI_OVERBOUGHT;
  const overextended =
    overbought && live.dma50 != null && cmp >= live.dma50 * t.STRETCH_OVER_50DMA;

  const pe = applicable ? live.peRatio : null;
  const noEarnings = pe != null && pe <= 0;
  const richValuation = pe != null && pe > t.PE_RICH;
  const cheapValuation = pe != null && pe > 0 && pe < t.PE_CHEAP;

  const roe = applicable ? live.roe : null;
  const roce = applicable ? live.roce : null;
  const de = applicable ? live.debtToEquity : null;
  const goodQuality =
    ((roe != null && roe >= t.ROE_STRONG) || (roce != null && roce >= t.ROCE_STRONG)) &&
    !(de != null && de > t.DE_HIGH);
  const poorQuality =
    (roe != null && roe < t.ROE_WEAK) ||
    (roce != null && roce < t.ROCE_WEAK) ||
    (de != null && de > t.DE_HIGH);

  const bigRunup = ret != null && ret >= t.BIG_RUNUP_PCT;
  const deepDrawdown = ret != null && ret <= t.DEEP_DRAWDOWN_PCT;

  const wt = metrics.weightPct;
  const overweightStock = wt != null && wt > t.WEIGHT_CONCENTRATION_PCT;
  const overweightSector = sectorWeightPct != null && sectorWeightPct > t.SECTOR_CONCENTRATION_PCT;
  const overweight = overweightStock || overweightSector;

  const ts = live.trendStrength;
  const weakTrend = ts != null && ts <= 35;

  // ---- Posture score (transparent) + reason codes ------------------------
  let posture = 0;
  if (live.dma200 != null) {
    if (above200) {
      posture += 2;
      push("ABOVE_200DMA", `Above 200-DMA (${money(cmp)} vs ${money(live.dma200)}).`, "positive");
    } else {
      posture -= 2;
      push("BELOW_200DMA", `Below 200-DMA (${money(cmp)} vs ${money(live.dma200)}).`, "negative");
    }
  }
  if (live.dma50 != null) {
    if (above50) {
      posture += 1;
      push("ABOVE_50DMA", `Above 50-DMA (${money(live.dma50)}).`, "positive");
    } else {
      posture -= 1;
      push("BELOW_50DMA", `Below 50-DMA (${money(live.dma50)}).`, "negative");
    }
  }
  if (live.dma50 != null && live.dma200 != null) {
    if (live.dma50 >= live.dma200) {
      posture += 1;
      push("DMA_STACK_BULL", "50-DMA above 200-DMA (bullish stack).", "positive");
    } else {
      posture -= 1;
      push("DMA_STACK_BEAR", "50-DMA below 200-DMA (bearish stack).", "negative");
    }
  }
  if (ts != null) {
    if (ts >= 60) {
      posture += 1;
      push("TREND_STRONG", `Trend strength ${ts.toFixed(0)}/100.`, "positive");
    } else if (ts <= 40) {
      posture -= 1;
      push("TREND_WEAK", `Weak trend strength ${ts.toFixed(0)}/100.`, "negative");
    }
  }
  if (rsi != null) {
    if (rsi >= t.RSI_HEALTHY_LOW && rsi <= t.RSI_HEALTHY_HIGH) {
      posture += 1;
      push("RSI_HEALTHY", `RSI ${rsi.toFixed(0)} (healthy momentum).`, "positive");
    } else if (overbought) {
      posture -= 1;
      push("RSI_OVERBOUGHT", `RSI ${rsi.toFixed(0)} (overbought).`, "negative");
    } else if (rsi < t.RSI_OVERSOLD) {
      push("RSI_OVERSOLD", `RSI ${rsi.toFixed(0)} (oversold).`, "neutral");
    }
  }
  if (pe != null) {
    if (noEarnings) {
      posture -= 1;
      push("NO_EARNINGS", "No positive earnings (P/E ≤ 0).", "negative");
    } else if (cheapValuation) {
      posture += 1;
      push("VALUATION_CHEAP", `Low P/E ${pe.toFixed(1)} (absolute basis).`, "positive");
    } else if (richValuation) {
      posture -= 1;
      push("VALUATION_RICH", `Rich P/E ${pe.toFixed(1)} (absolute basis).`, "negative");
    }
  }
  if (goodQuality) {
    posture += 1;
    push("QUALITY_STRONG", "Strong quality (RoE/RoCE ≥ 15%).", "positive");
  }
  if (poorQuality) {
    posture -= 1;
    push(
      "QUALITY_WEAK",
      de != null && de > t.DE_HIGH
        ? `High leverage (D/E ${de.toFixed(2)}).`
        : "Weak quality (RoE/RoCE < 8%).",
      "negative",
    );
  }
  if (deepDrawdown && ret != null) {
    posture -= 1;
    push("DEEP_DRAWDOWN", `Down ${pctStr(ret)} from cost.`, "negative");
  } else if (bigRunup && ret != null) {
    push("BIG_RUNUP", `Up ${pctStr(ret)} from cost (extended gains).`, "neutral");
  }
  if (overweightStock && wt != null) {
    push("WEIGHT_CONCENTRATION", `Single-stock weight ${wt.toFixed(1)}% (> ${t.WEIGHT_CONCENTRATION_PCT}%).`, "negative");
  }
  if (overweightSector && sectorWeightPct != null) {
    push("SECTOR_CONCENTRATION", `Sector weight ${sectorWeightPct.toFixed(1)}% (> ${t.SECTOR_CONCENTRATION_PCT}%).`, "negative");
  }

  // ---- Insufficient data → WATCHLIST -------------------------------------
  const canAssess = hasStructure || rsi != null || (applicable && pe != null);
  // ---- Verdict decision tree (decisive, priority-ordered) ----------------
  let verdict: Verdict;
  if (!canAssess) {
    verdict = "WATCHLIST";
  } else if (brokenStructure && (deepDrawdown || poorQuality || weakTrend || posture <= -3)) {
    verdict = "EXIT";
  } else if (posture <= -4) {
    verdict = "EXIT";
  } else if ((overextended || bigRunup) && !brokenStructure) {
    verdict = "TRIM";
  } else if (overweight && !brokenStructure && posture >= 0) {
    verdict = "TRIM";
  } else if (
    strongStructure &&
    posture >= 2 &&
    !overextended &&
    !overbought &&
    !overweight &&
    !richValuation &&
    !noEarnings &&
    (goodQuality || !applicable || pe == null)
  ) {
    verdict = "ACCUMULATE";
  } else if (
    !strongStructure &&
    posture <= -1 &&
    (richValuation || noEarnings || poorQuality || below200)
  ) {
    verdict = "AVOID";
  } else {
    verdict = "HOLD";
  }

  // ---- Hard stale-data gate ----------------------------------------------
  // A lone CMP with no derivable structure/momentum is too thin to back any
  // strong, actionable verdict. Even if other branches fired, cap the output
  // to WATCHLIST so stale data NEVER yields ACCUMULATE/TRIM/EXIT/AVOID.
  if (quality.stale && verdict !== "WATCHLIST" && verdict !== "HOLD") {
    push(
      "STALE_DATA_GATE",
      "Only a live price is available (no structure or momentum) — too thin for a strong call; capped to Watchlist.",
      "neutral",
    );
    verdict = "WATCHLIST";
  }

  // ---- Conflict (technical vs fundamental disagree) ----------------------
  const conflict =
    (above200 && (richValuation || poorQuality || noEarnings)) ||
    (below200 && goodQuality && pe != null && pe > 0 && pe < t.PE_FAIR);
  if (conflict) {
    push(
      "SIGNAL_CONFLICT",
      "Technical trend and fundamentals disagree — confidence reduced.",
      "neutral",
    );
  }

  const confidence = deriveConfidence(quality, conflict, verdict);

  // ---- Levels ------------------------------------------------------------
  const support = nearestSupportBelow(live);
  const stopLoss = support;
  const { zone: targetZone, upsidePct } = deriveTargetZone(live, stopLoss);
  const accumulationZone =
    verdict === "ACCUMULATE" ? deriveAccumulationZone(live, support) : null;
  const riskLevel = deriveRisk(live, deepDrawdown, overweight, belowBoth);

  // ---- Views -------------------------------------------------------------
  const technicalView = buildTechnicalView({
    cmp,
    live,
    above200,
    below200,
    above50,
    below50,
    overbought,
    rsi,
    hasStructure,
  });
  const fundamentalView = buildFundamentalView({ applicable, roe, roce, de, goodQuality, poorQuality });
  const valuationView = buildValuationView({ applicable, pe, pb: live.pbRatio, cheapValuation, richValuation, noEarnings });

  const trendStrength = {
    score: ts,
    label: trendLabel(ts, strongStructure, brokenStructure, hasStructure),
  };

  const improveIf = buildImproveIf({ live, cmp, below50, below200, overbought, richValuation, poorQuality, overweight, support, resistance: nearestResistanceAbove(live) });
  const negativeIf = buildNegativeIf({ live, cmp, above200, support, goodQuality, richValuation, deepDrawdown, ret });

  const headline = buildHeadline({ verdict, ret, rsi, live, cmp, richValuation, poorQuality, overextended, bigRunup, overweight, accumulationZone, quality });

  return {
    verdict,
    confidence,
    headline,
    reasonCodes: reasons,
    technicalView,
    fundamentalView,
    valuationView,
    trendStrength,
    supportZone: live.supportZone,
    resistanceZone: live.resistanceZone,
    accumulationZone,
    riskLevel,
    stopLoss,
    targetZone,
    upsidePct,
    improveIf,
    negativeIf,
    dataQuality: quality,
  };
}

// ---------------------------------------------------------------------------
// View builders (pure string assembly from real numbers only)
// ---------------------------------------------------------------------------

function buildTechnicalView(a: {
  cmp: number;
  live: LiveMetrics;
  above200: boolean;
  below200: boolean;
  above50: boolean;
  below50: boolean;
  overbought: boolean;
  rsi: number | null;
  hasStructure: boolean;
}): string {
  if (!a.hasStructure && a.rsi == null) {
    return "Only a live price is available — no moving-average or momentum history to assess structure.";
  }
  const parts: string[] = [];
  if (a.live.dma200 != null) {
    parts.push(a.above200 ? `holding above its 200-DMA (${money(a.live.dma200)})` : `trading below its 200-DMA (${money(a.live.dma200)})`);
  }
  if (a.live.dma50 != null) {
    parts.push(a.above50 ? `above the 50-DMA (${money(a.live.dma50)})` : `below the 50-DMA (${money(a.live.dma50)})`);
  }
  if (a.rsi != null) {
    parts.push(`RSI ${a.rsi.toFixed(0)}${a.overbought ? " (overbought)" : a.rsi < 30 ? " (oversold)" : ""}`);
  }
  const lead = a.above200 ? "Constructive: price is" : a.below200 ? "Under pressure: price is" : "Mixed: price is";
  return `${lead} ${parts.join(", ")}.`;
}

function buildFundamentalView(a: {
  applicable: boolean;
  roe: number | null;
  roce: number | null;
  de: number | null;
  goodQuality: boolean;
  poorQuality: boolean;
}): string {
  if (!a.applicable) return "Not applicable — ETF / basket instrument (no company fundamentals).";
  if (a.roe == null && a.roce == null && a.de == null) {
    return "Fundamentals not reported by the data source for this symbol.";
  }
  const parts: string[] = [];
  if (a.roe != null) parts.push(`RoE ${a.roe.toFixed(1)}%`);
  if (a.roce != null) parts.push(`RoCE ${a.roce.toFixed(1)}%`);
  if (a.de != null) parts.push(`D/E ${a.de.toFixed(2)}`);
  const lead = a.goodQuality ? "Strong quality —" : a.poorQuality ? "Weak quality —" : "Adequate quality —";
  return `${lead} ${parts.join(", ")}.`;
}

function buildValuationView(a: {
  applicable: boolean;
  pe: number | null;
  pb: number | null;
  cheapValuation: boolean;
  richValuation: boolean;
  noEarnings: boolean;
}): string {
  if (!a.applicable) return "Not applicable — ETF / basket instrument.";
  if (a.pe == null && a.pb == null) return "Valuation not reported by the data source.";
  const parts: string[] = [];
  if (a.pe != null) parts.push(`P/E ${a.pe.toFixed(1)}`);
  if (a.pb != null) parts.push(`P/B ${a.pb.toFixed(2)}`);
  let lead: string;
  if (a.noEarnings) lead = "Loss-making (no positive P/E) —";
  else if (a.cheapValuation) lead = "Inexpensive on an absolute basis —";
  else if (a.richValuation) lead = "Expensive on an absolute basis —";
  else lead = "Fair on an absolute basis —";
  return `${lead} ${parts.join(", ")} (absolute, not sector-relative — no sector benchmark available).`;
}

function buildImproveIf(a: {
  live: LiveMetrics;
  cmp: number;
  below50: boolean;
  below200: boolean;
  overbought: boolean;
  richValuation: boolean;
  poorQuality: boolean;
  overweight: boolean;
  support: number | null;
  resistance: number | null;
}): string[] {
  const out: string[] = [];
  if (a.below50 && a.live.dma50 != null) out.push(`Reclaim and hold above the 50-DMA (${money(a.live.dma50)}).`);
  if (a.below200 && a.live.dma200 != null) out.push(`Daily close back above the 200-DMA (${money(a.live.dma200)}).`);
  if (a.resistance != null) out.push(`Sustained breakout above resistance ${money(a.resistance)}.`);
  if (a.overbought) out.push("RSI cooling below 65 from the overbought zone.");
  if (a.richValuation) out.push("Valuation de-rating (P/E toward the 30s) or earnings catching up.");
  if (a.poorQuality) out.push("Improving RoE/RoCE above 15% or debt reduced (D/E below 1).");
  if (a.overweight) out.push(`Trimming the position so its weight falls below ${ADVICE_THRESHOLDS.WEIGHT_CONCENTRATION_PCT}%.`);
  if (out.length === 0) out.push("Continued higher highs with momentum intact would reinforce the trend.");
  return out.slice(0, 4);
}

function buildNegativeIf(a: {
  live: LiveMetrics;
  cmp: number;
  above200: boolean;
  support: number | null;
  goodQuality: boolean;
  richValuation: boolean;
  deepDrawdown: boolean;
  ret: number | null;
}): string[] {
  const out: string[] = [];
  if (a.above200 && a.live.dma200 != null) out.push(`Daily close below the 200-DMA (${money(a.live.dma200)}).`);
  if (a.support != null) out.push(`A break of support ${money(a.support)}.`);
  if (!a.deepDrawdown) out.push("Drawdown deepening beyond -20% from cost.");
  out.push("RSI rolling below 40 with price under the 50-DMA.");
  if (a.goodQuality) out.push("Deterioration in RoE/RoCE or a rise in debt.");
  if (a.richValuation) out.push("Further P/E expansion without earnings growth.");
  return out.slice(0, 4);
}

function buildHeadline(a: {
  verdict: Verdict;
  ret: number | null;
  rsi: number | null;
  live: LiveMetrics;
  cmp: number;
  richValuation: boolean;
  poorQuality: boolean;
  overextended: boolean;
  bigRunup: boolean;
  overweight: boolean;
  accumulationZone: PriceZone | null;
  quality: DataQuality;
}): string {
  switch (a.verdict) {
    case "ACCUMULATE": {
      const zone = a.accumulationZone
        ? ` Add on dips toward ${money(a.accumulationZone.low)}–${money(a.accumulationZone.high)}.`
        : " Add into strength while the trend holds.";
      return `Strong structure with supportive signals — accumulate.${zone}`;
    }
    case "HOLD":
      return a.richValuation
        ? "Trend intact but valuation is full — hold, no fresh buying here."
        : "Constructive but not compelling to add — hold and let it work.";
    case "TRIM": {
      if (a.overweight) return "Position has grown oversized — trim to manage concentration, keep a core.";
      const why = a.overextended ? "stretched above its average and overbought" : a.bigRunup && a.ret != null ? `up ${pctStr(a.ret)} and extended` : "extended";
      return `Profitable and ${why} — book partial gains, trail the rest.`;
    }
    case "EXIT": {
      const dd = a.ret != null && a.ret < 0 ? ` and down ${pctStr(a.ret)}` : "";
      return `Structure broken below key averages${dd} — exit and redeploy the capital.`;
    }
    case "AVOID": {
      const why = a.richValuation ? "rich valuation" : a.poorQuality ? "weak fundamentals" : "a weak trend";
      return `Weak structure with ${why} — avoid fresh buying; reduce into bounces.`;
    }
    case "WATCHLIST":
      return `Insufficient live data to act decisively — watchlist only${a.quality.missing.length ? ` (missing ${a.quality.missing.join(", ")})` : ""}.`;
    case "DATA_INCOMPLETE":
    default:
      return "Live price unavailable — DATA INCOMPLETE.";
  }
}

// ---------------------------------------------------------------------------
// Portfolio-level action summary
// ---------------------------------------------------------------------------

export interface AdviceSummary {
  counts: Record<Verdict, number>;
  /** Actionable groups (symbols per verdict), priority-ordered. */
  groups: { verdict: Verdict; symbols: string[] }[];
}

const VERDICT_ORDER: Verdict[] = [
  "EXIT",
  "TRIM",
  "AVOID",
  "ACCUMULATE",
  "HOLD",
  "WATCHLIST",
  "DATA_INCOMPLETE",
];

export function summarizeAdvice(items: { symbol: string; advice: AdviceResult }[]): AdviceSummary {
  const counts = {
    ACCUMULATE: 0,
    HOLD: 0,
    TRIM: 0,
    EXIT: 0,
    AVOID: 0,
    WATCHLIST: 0,
    DATA_INCOMPLETE: 0,
  } as Record<Verdict, number>;
  const bySymbol = new Map<Verdict, string[]>();
  for (const { symbol, advice } of items) {
    counts[advice.verdict] += 1;
    const arr = bySymbol.get(advice.verdict) ?? [];
    arr.push(symbol);
    bySymbol.set(advice.verdict, arr);
  }
  const groups = VERDICT_ORDER.filter(v => (bySymbol.get(v)?.length ?? 0) > 0).map(v => ({
    verdict: v,
    symbols: bySymbol.get(v) ?? [],
  }));
  return { counts, groups };
}
